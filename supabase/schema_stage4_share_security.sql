-- P0: 병원 공유 링크 보안 강화 — schema.sql → schema_stage3.sql →
-- schema_subscriptions.sql 다음에 실행한다.
--
-- 이 migration은 기존 원문 token을 회수하고 hash-only 구조로 전환한다. 이전 링크는
-- 의도적으로 즉시 무효화되며, 보호자가 새 링크를 발급해야 한다.

create extension if not exists "pgcrypto";

-- 기존 설치본: 원문 token을 절대 보존하지 않는다. 이미 배포된 원문 token은 모두 회수한다.
alter table share_links add column if not exists token_hash text;
update share_links
set revoked_at = coalesce(revoked_at, now()),
    token_hash = coalesce(token_hash, encode(digest(coalesce(token, id::text), 'sha256'), 'hex'))
where token_hash is null;
alter table share_links alter column token_hash set not null;
alter table share_links alter column token_hash set default encode(digest(gen_random_bytes(32), 'sha256'), 'hex');
alter table share_links drop constraint if exists share_links_token_hash_format;
alter table share_links add constraint share_links_token_hash_format
  check (token_hash ~ '^[0-9a-f]{64}$');
alter table share_links drop column if exists token;
create unique index if not exists share_links_token_hash_key on share_links(token_hash);
create index if not exists share_links_active_lookup on share_links(token_hash)
  where revoked_at is null;

alter table share_links add column if not exists last_access_at timestamptz;
alter table share_links add column if not exists access_count integer not null default 0
  check (access_count >= 0);
-- 거절 폭주를 감사 행/갱신 폭주로 바꾸지 않는다. 링크별 분당 1회만 표본을 남긴다.
alter table share_links add column if not exists rate_limit_audit_at timestamptz;

-- 원문 token, IP, User-Agent, 수신자 식별자는 보존하지 않는다.
create table if not exists share_link_access_audit (
  id          bigint generated always as identity primary key,
  share_link_id uuid references share_links(id) on delete set null,
  outcome     text not null check (outcome in ('issued', 'granted', 'rate_limited', 'revoked')),
  occurred_at timestamptz not null default now()
);
create index if not exists share_link_access_audit_retention
  on share_link_access_audit(occurred_at);
alter table share_link_access_audit enable row level security;

-- 최소 보존: service_role의 예약 작업만 오래된 비식별 접근 표본을 지운다.
create or replace function purge_share_link_access_audit(
  p_retention interval default interval '30 days',
  p_batch_size integer default 1000
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  deleted_count integer;
begin
  if p_retention < interval '1 day' or p_retention > interval '90 days'
     or p_batch_size not between 1 and 1000 then
    raise exception '허용되지 않는 감사 보존 기간입니다' using errcode = '22023';
  end if;
  -- 예약 작업이 반복 호출한다. 한 트랜잭션을 1,000행으로 제한해 WAL/잠금 폭주를 피한다.
  delete from share_link_access_audit
  where id in (
    select id from share_link_access_audit
    where occurred_at < clock_timestamp() - p_retention
    order by id
    limit p_batch_size
  );
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

-- 기본 스키마의 for-all 정책은 원문/해시를 임의 삽입하거나 만료·회수를 되돌릴 수 있다.
drop policy if exists "share links by owner" on share_links;
create policy "share link metadata by editor" on share_links for select
  using (exists (
    select 1 from reports r where r.id = report_id
      and my_role(r.child_id) in ('owner', 'editor')
  ));
-- insert/update/delete는 공개 테이블 API로 허용하지 않는다. 아래 RPC만 사용한다.

create or replace function create_secure_share_link(p_report_id uuid, p_expires_in_hours integer)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_child_id uuid;
  v_link_id uuid;
  v_token text;
  v_expires_at timestamptz;
begin
  -- 고정 정책: 24h/72h/7d만 허용. 클라이언트가 임의 TTL을 늘릴 수 없다.
  if p_expires_in_hours not in (24, 72, 168) then
    raise exception '허용되지 않는 공유 기간입니다' using errcode = '22023';
  end if;

  select r.child_id into v_child_id
  from reports r join children c on c.id = r.child_id
  where r.id = p_report_id and c.deleted_at is null;

  if v_child_id is null
     or my_role(v_child_id) not in ('owner', 'editor')
     or not has_sensitive_consent(v_child_id) then
    raise exception '공유 링크를 발급할 권한이 없습니다' using errcode = '42501';
  end if;

  -- 32 random bytes = 256 bits. 반환은 이 한 번뿐이고 DB에는 SHA-256만 저장한다.
  v_token := encode(gen_random_bytes(32), 'hex');
  v_expires_at := now() + make_interval(hours => p_expires_in_hours);
  insert into share_links(report_id, token_hash, expires_at)
  values (p_report_id, encode(digest(v_token, 'sha256'), 'hex'), v_expires_at)
  returning id into v_link_id;
  insert into share_link_access_audit(share_link_id, outcome) values (v_link_id, 'issued');

  return jsonb_build_object('id', v_link_id, 'token', v_token, 'expires_at', v_expires_at);
end;
$$;

create or replace function revoke_secure_share_link(p_link_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_link_id uuid;
begin
  update share_links l set revoked_at = coalesce(l.revoked_at, now())
  from reports r
  where l.id = p_link_id and l.report_id = r.id
    and my_role(r.child_id) in ('owner', 'editor')
  returning l.id into v_link_id;
  if v_link_id is null then
    raise exception '공유 링크를 회수할 권한이 없습니다' using errcode = '42501';
  end if;
  insert into share_link_access_audit(share_link_id, outcome) values (v_link_id, 'revoked');
end;
$$;

-- Edge Function이 호출하는 소비 경로다. 행 잠금으로 동시 replay에서 한 요청만 1초 창을 통과한다.
create or replace function consume_share_link_token(p_token_hash text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_link record;
begin
  if p_token_hash !~ '^[0-9a-f]{64}$' then return null; end if;

  select l.id, l.revoked_at, l.expires_at, l.last_access_at, l.rate_limit_audit_at,
         r.storage_path, has_sensitive_consent(r.child_id) as has_sensitive_consent
  into v_link
  from share_links l
  join reports r on r.id = l.report_id
  join children c on c.id = r.child_id and c.deleted_at is null
  where l.token_hash = p_token_hash
  for update of l;

  if not found or v_link.revoked_at is not null or v_link.expires_at <= now()
     or not v_link.has_sensitive_consent
     or v_link.storage_path is null then
    return null;
  end if;

  if v_link.last_access_at > clock_timestamp() - interval '1 second' then
    -- 링크당 분당 한 번만 표본 INSERT한다. 그 외 거절은 추가 DB write를 만들지 않는다.
    if v_link.rate_limit_audit_at is null
       or v_link.rate_limit_audit_at <= clock_timestamp() - interval '1 minute' then
      update share_links set rate_limit_audit_at = clock_timestamp() where id = v_link.id;
      insert into share_link_access_audit(share_link_id, outcome) values (v_link.id, 'rate_limited');
    end if;
    return null;
  end if;

  update share_links
  set last_access_at = clock_timestamp(), access_count = access_count + 1
  where id = v_link.id;
  insert into share_link_access_audit(share_link_id, outcome) values (v_link.id, 'granted');
  return jsonb_build_object('storage_path', v_link.storage_path);
end;
$$;

-- anonymous/authenticated REST RPC는 모두 차단한다. consume/purge는 no-JWT Edge
-- Function 또는 예약 보존 작업의 service_role만 호출한다.
revoke all on function create_secure_share_link(uuid, integer) from public;
revoke all on function revoke_secure_share_link(uuid) from public;
revoke all on function consume_share_link_token(text) from public;
revoke all on function purge_share_link_access_audit(interval, integer) from public;
grant execute on function create_secure_share_link(uuid, integer) to authenticated;
grant execute on function revoke_secure_share_link(uuid) to authenticated;
grant execute on function consume_share_link_token(text) to service_role;
grant execute on function purge_share_link_access_audit(interval, integer) to service_role;
