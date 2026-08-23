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
    -- `token` was dropped after the first successful stage4 application. JSON extraction keeps
    -- this upgrade idempotent while still hashing a pre-stage4 plaintext token when it exists.
    token_hash = coalesce(token_hash, encode(digest(coalesce(to_jsonb(share_links)->>'token', id::text), 'sha256'), 'hex'))
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

alter table share_links add column if not exists issued_by uuid references profiles(id) on delete set null;
-- 기존 stage4 hashed 링크는 실제 발행자를 증명할 수 없다. 보고서 작성자로 추정 backfill하면
-- editor 발행 링크가 owner 권한으로 되살아날 수 있으므로, 미귀속 활성 링크는 fail-closed 회수한다.
update share_links set revoked_at = coalesce(revoked_at, clock_timestamp())
where issued_by is null and revoked_at is null;
create index if not exists share_links_active_issuer on share_links(issued_by)
  where revoked_at is null;

alter table share_links add column if not exists last_access_at timestamptz;
alter table share_links add column if not exists access_count integer not null default 0
  check (access_count >= 0);
-- 성공·거절 모두 링크별 분당 1개 표본으로 제한한다. 단일 링크의 최대 audit 유입은
-- 120행/시간(각 outcome 60)이며, 예약 drain 100,000행/시간보다 충분히 작다.
alter table share_links add column if not exists granted_audit_at timestamptz;
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

-- 새 이벤트는 링크별 원시 행이 아니라 전역 시간대·outcome 집계로만 남긴다. 따라서 임의의
-- 발급/접속 폭주도 매시간 정확히 네 행(issued/granted/rate_limited/revoked)만 새로 허용한다.
-- 기존 원시 행은 아래 retention runner가 호환 목적으로 정리한다.
create table if not exists share_link_access_audit_hourly (
  bucket_at   timestamp without time zone not null,
  outcome     text not null check (outcome in ('issued', 'granted', 'rate_limited', 'revoked')),
  event_count bigint not null default 1 check (event_count > 0),
  primary key (bucket_at, outcome)
);
alter table share_link_access_audit_hourly enable row level security;

create or replace function record_share_link_access_audit(p_outcome text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_bucket_at timestamp without time zone := date_trunc('hour', clock_timestamp() at time zone 'UTC');
begin
  if p_outcome not in ('issued', 'granted', 'rate_limited', 'revoked') then
    raise exception '허용되지 않는 감사 outcome입니다' using errcode = '22023';
  end if;
  insert into share_link_access_audit_hourly(bucket_at, outcome, event_count)
  values (v_bucket_at, p_outcome, 1)
  on conflict (bucket_at, outcome)
  do update set event_count = share_link_access_audit_hourly.event_count + 1;
end;
$$;

create or replace function share_link_audit_max_rows_per_hour() returns integer
language sql immutable as $$ select 4 $$;

-- 서비스가 살아 있는 동안 자동 보존 작업은 전역적으로 시간당 한 번만 실행한다.
create table if not exists share_link_audit_maintenance (
  singleton boolean primary key default true check (singleton),
  last_purged_at timestamptz
);
insert into share_link_audit_maintenance(singleton) values (true) on conflict do nothing;
alter table share_link_audit_maintenance enable row level security;

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

-- 예약 작업은 한 번에 원시 legacy audit 100배치(100,000행)와 aggregate 1,000행만 drain한다.
-- 새로 허용되는 audit row 입력은 전역 4행/시간이므로, 모든 admitted input보다 용량이 크다.
create or replace function run_scheduled_share_link_audit_retention() returns integer
language plpgsql security definer set search_path = public as $$
declare
  deleted_count integer := 0;
  batch_count integer;
  aggregate_deleted integer;
begin
  if share_link_audit_max_rows_per_hour() >= 1000 then
    raise exception '감사 입력 상한이 예약 drain 용량을 초과합니다';
  end if;
  delete from share_link_access_audit_hourly
  where ctid in (
    select ctid from share_link_access_audit_hourly
    where bucket_at < (clock_timestamp() at time zone 'UTC') - interval '30 days'
    order by bucket_at limit 1000
  );
  get diagnostics aggregate_deleted = row_count;
  deleted_count := aggregate_deleted;
  for batch_no in 1..100 loop
    batch_count := purge_share_link_access_audit(interval '30 days', 1000);
    deleted_count := deleted_count + batch_count;
    exit when batch_count < 1000;
  end loop;
  return deleted_count;
end;
$$;

-- guardian 관계가 제거되면 해당 guardian이 발행한 bearer URL을 같은 트랜잭션에서 회수한다.
-- 계정 삭제의 auth→profile cascade도 guardian_child DELETE를 발생시켜 동일 계약을 따른다.
create or replace function revoke_issued_share_links_on_guardian_removal() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update share_links l set revoked_at = coalesce(l.revoked_at, clock_timestamp())
  from reports r
  where l.report_id = r.id and r.child_id = old.child_id
    and l.issued_by = old.guardian_id and l.revoked_at is null;
  return old;
end;
$$;
drop trigger if exists guardian_removal_revokes_issued_share_links on guardian_child;
create trigger guardian_removal_revokes_issued_share_links
  before delete on guardian_child
  for each row execute function revoke_issued_share_links_on_guardian_removal();

-- 기본 스키마의 for-all 정책은 원문/해시를 임의 삽입하거나 만료·회수를 되돌릴 수 있다.
drop policy if exists "share links by owner" on share_links;
drop policy if exists "share link metadata by editor" on share_links;
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
  insert into share_links(report_id, token_hash, expires_at, issued_by)
  values (p_report_id, encode(digest(v_token, 'sha256'), 'hex'), v_expires_at, auth.uid())
  returning id into v_link_id;
  perform record_share_link_access_audit('issued');

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
  perform record_share_link_access_audit('revoked');
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

  select l.id, l.revoked_at, l.expires_at, l.last_access_at, l.granted_audit_at, l.rate_limit_audit_at,
         r.storage_path, has_sensitive_consent(r.child_id) as has_sensitive_consent,
         exists (
           select 1 from guardian_child gc
           where gc.child_id = r.child_id and gc.guardian_id = l.issued_by
             and gc.role in ('owner', 'editor')
         ) as issuer_authorized
  into v_link
  from share_links l
  join reports r on r.id = l.report_id
  join children c on c.id = r.child_id and c.deleted_at is null
  where l.token_hash = p_token_hash
  for update of l;

  if not found or v_link.revoked_at is not null or v_link.expires_at <= now()
     or not v_link.has_sensitive_consent or not v_link.issuer_authorized
     or v_link.storage_path is null then
    return null;
  end if;

  if v_link.last_access_at > clock_timestamp() - interval '1 second' then
    -- 링크당 분당 한 번만 표본 INSERT한다. 그 외 거절은 추가 DB write를 만들지 않는다.
    if v_link.rate_limit_audit_at is null
       or v_link.rate_limit_audit_at <= clock_timestamp() - interval '1 minute' then
      update share_links set rate_limit_audit_at = clock_timestamp() where id = v_link.id;
      perform record_share_link_access_audit('rate_limited');
    end if;
    return null;
  end if;

  update share_links
  set last_access_at = clock_timestamp(), access_count = access_count + 1
  where id = v_link.id;
  if v_link.granted_audit_at is null
     or v_link.granted_audit_at <= clock_timestamp() - interval '1 minute' then
    update share_links set granted_audit_at = clock_timestamp() where id = v_link.id;
    perform record_share_link_access_audit('granted');
  end if;
  return jsonb_build_object('storage_path', v_link.storage_path);
end;
$$;

-- anonymous/authenticated REST RPC는 모두 차단한다. consume/purge는 no-JWT Edge
-- Function 또는 예약 보존 작업의 service_role만 호출한다.
revoke all on function create_secure_share_link(uuid, integer) from public;
revoke all on function revoke_secure_share_link(uuid) from public;
revoke all on function consume_share_link_token(text) from public;
revoke all on function purge_share_link_access_audit(interval, integer) from public;
revoke all on function run_scheduled_share_link_audit_retention() from public;
revoke all on function revoke_issued_share_links_on_guardian_removal() from public;
revoke all on function record_share_link_access_audit(text) from public;
grant execute on function create_secure_share_link(uuid, integer) to authenticated;
grant execute on function revoke_secure_share_link(uuid) to authenticated;
grant execute on function consume_share_link_token(text) to service_role;
grant execute on function purge_share_link_access_audit(interval, integer) to service_role;
grant execute on function run_scheduled_share_link_audit_retention() to service_role;
