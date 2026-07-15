-- 구독(수익화) 스키마 — schema.sql → schema_stage3.sql 다음에 실행한다.
--
-- 원칙:
--  · 티어의 진실 원천은 이 테이블. 쓰기는 스토어 결제 웹훅(Edge Function,
--    service_role)만 가능하고 클라이언트는 자기 행 읽기만 가능하다.
--  · 서버에서 강제하는 한도: 아이 수(트리거), 아이당 공동 보호자 수(invite RPC).
--    사진 장수·대시보드 기간·공유 링크 개수는 클라이언트 게이팅(우회해도 피해가
--    본인 한정이라 서버 강제 대상에서 제외).

create table subscriptions (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  tier       text not null default 'free' check (tier in ('free','standard','family')),
  status     text not null default 'active' check (status in ('active','expired','canceled')),
  store      text,                              -- 'app_store' | 'play_store'
  expires_at timestamptz,                       -- null = 무기한(무료) 또는 미정
  updated_at timestamptz not null default now()
);

alter table subscriptions enable row level security;

-- 본인 행 읽기만 허용 — INSERT/UPDATE 정책 없음 = service_role(웹훅)만 쓴다
create policy "read own subscription" on subscriptions
  for select using (user_id = auth.uid());

-- 현재 유효 티어 (만료된 유료 구독은 free로 강등)
create or replace function my_tier() returns text
language sql stable security definer set search_path = public as $$
  select case
    when s.tier is null then 'free'
    when s.status <> 'active' then 'free'
    when s.expires_at is not null and s.expires_at < now() then 'free'
    else s.tier
  end
  from (select 1) _
  left join subscriptions s on s.user_id = auth.uid()
$$;

create or replace function tier_max_children(t text) returns int
language sql immutable as $$
  select case t when 'free' then 1 when 'standard' then 3 else 2147483647 end
$$;

create or replace function tier_max_co_guardians(t text) returns int
language sql immutable as $$
  select case t when 'free' then 0 when 'standard' then 2 else 2147483647 end
$$;

-- ── 아이 수 한도 트리거 ──────────────────────────────────────────
-- 아이 생성 직후의 owner 부트스트랩 행에서만 검사한다 (초대 행은 무관).
create or replace function enforce_child_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  current_count int;
  max_allowed int;
begin
  if new.role <> 'owner' then return new; end if;
  select count(*) into current_count from guardian_child
    where guardian_id = new.guardian_id and role = 'owner';
  max_allowed := tier_max_children(my_tier());
  if current_count >= max_allowed then
    raise exception '현재 플랜에서는 아이를 %명까지 등록할 수 있어요. 플랜을 업그레이드해 주세요.', max_allowed
      using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists guardian_child_limit on guardian_child;
create trigger guardian_child_limit before insert on guardian_child
  for each row execute function enforce_child_limit();

-- ── 초대 RPC에 공동 보호자 한도 추가 (schema_stage3 버전 대체) ──
create or replace function invite_guardian(cid uuid, invitee_email text, invite_role text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  uid uuid;
  co_count int;
  max_co int;
begin
  if my_role(cid) is distinct from 'owner' then
    raise exception '아이의 소유자만 보호자를 초대할 수 있습니다';
  end if;
  if invite_role not in ('editor','viewer') then
    raise exception '부여할 수 있는 권한은 editor 또는 viewer입니다';
  end if;

  -- 티어별 공동 보호자 한도
  select count(*) into co_count from guardian_child
    where child_id = cid and role <> 'owner';
  max_co := tier_max_co_guardians(my_tier());
  if co_count >= max_co then
    if max_co = 0 then
      raise exception '공동 보호자 초대는 스탠다드 플랜부터 가능해요.';
    end if;
    raise exception '현재 플랜에서는 아이당 공동 보호자를 %명까지 초대할 수 있어요.', max_co;
  end if;

  select id into uid from auth.users where lower(email) = lower(invitee_email);
  if uid is null then
    raise exception '해당 이메일로 가입된 보호자가 없습니다. 먼저 회원가입을 안내해 주세요.';
  end if;
  if uid = auth.uid() then
    raise exception '본인은 초대할 수 없습니다';
  end if;

  insert into profiles (id, name)
  select uid, split_part(invitee_email, '@', 1)
  where not exists (select 1 from profiles where id = uid);

  insert into guardian_child (guardian_id, child_id, role, invited_by)
  values (uid, cid, invite_role, auth.uid())
  on conflict (guardian_id, child_id) do update set role = excluded.role;

  return json_build_object('guardian_id', uid);
end $$;
