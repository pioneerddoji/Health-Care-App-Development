-- P0 공동관리 RLS·대상자 생성 원자성·감사 무결성 강화
--
-- 적용 순서:
--   schema.sql → schema_stage3.sql → schema_subscriptions.sql → schema_settings.sql
--   → schema_recipients.sql → 이 파일
--
-- 이 마이그레이션은 기존 데이터 행을 변경하거나 삭제하지 않는다. 직접 INSERT로
-- 생성된 기존 children/guardian_child/consents 관계도 그대로 읽고 관리할 수 있다.
-- 새 대상자 생성만 create_recipient() 단일 트랜잭션 RPC로 제한한다.

-- ── 직접 쓰기 우회 제거 ────────────────────────────────────────────
drop policy if exists "insert child" on children;
drop policy if exists "bootstrap or owner insert" on guardian_child;
drop policy if exists "owner updates roles" on guardian_child;

-- owner가 타 보호자를 제거하거나 editor/viewer가 본인 관계를 끊는 정책은 유지한다.
-- invitation과 role 변경은 아래 SECURITY DEFINER RPC만 수행한다.

-- ── 감사 작성자 위조 차단 ──────────────────────────────────────────
drop policy if exists "write records" on daily_records;
create policy "write records as current guardian" on daily_records
  for insert with check (
    author_id = auth.uid()
    and my_role(child_id) in ('owner','editor')
    and has_sensitive_consent(child_id)
  );

drop policy if exists "edit records" on daily_records;
create policy "edit records without author rewrite" on daily_records
  for update using (my_role(child_id) in ('owner','editor'))
  with check (my_role(child_id) in ('owner','editor'));

drop policy if exists "reports rw" on reports;
create policy "read reports" on reports
  for select using (my_role(child_id) is not null);
create policy "publish reports as current guardian" on reports
  for insert with check (
    created_by = auth.uid() and my_role(child_id) in ('owner','editor')
  );
create policy "edit reports without creator rewrite" on reports
  for update using (my_role(child_id) in ('owner','editor'))
  with check (my_role(child_id) in ('owner','editor'));
create policy "delete reports" on reports
  for delete using (my_role(child_id) in ('owner','editor'));

create or replace function protect_audit_columns() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.author_id is distinct from auth.uid() then
    raise exception '기록 작성자는 현재 로그인한 보호자여야 합니다' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.author_id is distinct from old.author_id then
    raise exception '기록 작성자를 변경할 수 없습니다' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists daily_records_protect_audit_columns on daily_records;
create trigger daily_records_protect_audit_columns
  before insert or update on daily_records
  for each row execute function protect_audit_columns();

create or replace function protect_report_creator() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.created_by is distinct from auth.uid() then
    raise exception '레포트 작성자는 현재 로그인한 보호자여야 합니다' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.created_by is distinct from old.created_by then
    raise exception '레포트 작성자를 변경할 수 없습니다' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists reports_protect_creator on reports;
create trigger reports_protect_creator
  before insert or update on reports
  for each row execute function protect_report_creator();

-- ── 대상자 + 최초 owner + 필수 동의 원자 생성 ──────────────────────
-- recipient의 키는 DB snake_case다. id는 테스트/오프라인 재시도 멱등 키 용도이며,
-- 일반 앱 호출은 생략해 DB가 UUID를 만든다.
create or replace function create_recipient(recipient jsonb)
returns public.children
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  recipient_id uuid := coalesce((recipient ->> 'id')::uuid, gen_random_uuid());
  recipient_name text := nullif(trim(recipient ->> 'name'), '');
  recipient_birth_date date := (recipient ->> 'birth_date')::date;
  recipient_sex text := recipient ->> 'sex';
  recipient_type text := coalesce(recipient ->> 'recipient_type', 'child');
  recipient_is_self boolean := coalesce((recipient ->> 'is_self')::boolean, false);
  recipient_age int;
  max_children int;
  existing public.children;
  created public.children;
begin
  if actor is null then
    raise exception '로그인이 필요합니다' using errcode = '42501';
  end if;
  if not exists (select 1 from profiles where id = actor) then
    raise exception '보호자 프로필이 필요합니다' using errcode = '42501';
  end if;
  if recipient_name is null or recipient_birth_date is null
     or recipient_sex not in ('male', 'female')
     or recipient_type not in ('child', 'adult') then
    raise exception '대상자 필수 정보 또는 유형이 올바르지 않습니다' using errcode = '22023';
  end if;
  if recipient_birth_date > current_date then
    raise exception '생년월일은 미래일 수 없습니다' using errcode = '22023';
  end if;

  -- 같은 보호자의 동시 생성 요청도 한도를 넘지 않도록 직렬화한다.
  perform pg_advisory_xact_lock(hashtext(actor::text));

  select * into existing from children where id = recipient_id;
  if found then
    if my_role(recipient_id) = 'owner' then
      return existing; -- 네트워크 재시도: 이미 완전히 생성된 자기 대상자는 성공으로 처리
    end if;
    raise exception '이미 사용 중인 대상자 식별자입니다' using errcode = '23505';
  end if;

  max_children := tier_max_children(my_tier());
  if (select count(*) from guardian_child where guardian_id = actor and role = 'owner') >= max_children then
    raise exception '현재 플랜에서는 대상자를 %명까지 등록할 수 있어요. 플랜을 업그레이드해 주세요.', max_children
      using errcode = 'P0001';
  end if;

  insert into children (
    id, name, nickname, birth_date, sex, birth_weight_g, birth_height_cm,
    gestational_weeks, is_preterm, blood_type, allergies, chronic_conditions,
    surgeries, hospitalizations, primary_doctor, primary_hospital, guardian_phone,
    other_notes, recipient_type, is_self
  ) values (
    recipient_id, recipient_name, recipient ->> 'nickname', recipient_birth_date, recipient_sex,
    nullif(recipient ->> 'birth_weight_g', '')::integer,
    nullif(recipient ->> 'birth_height_cm', '')::numeric,
    nullif(recipient ->> 'gestational_weeks', '')::integer,
    coalesce((recipient ->> 'is_preterm')::boolean, false), recipient ->> 'blood_type',
    coalesce(array(select jsonb_array_elements_text(coalesce(recipient -> 'allergies', '[]'::jsonb))), '{}'),
    coalesce(array(select jsonb_array_elements_text(coalesce(recipient -> 'chronic_conditions', '[]'::jsonb))), '{}'),
    coalesce(recipient -> 'surgeries', '[]'::jsonb), coalesce(recipient -> 'hospitalizations', '[]'::jsonb),
    recipient ->> 'primary_doctor', recipient ->> 'primary_hospital', recipient ->> 'guardian_phone',
    recipient ->> 'other_notes', recipient_type, recipient_is_self
  ) returning * into created;

  insert into guardian_child (guardian_id, child_id, role, invited_by)
  values (actor, recipient_id, 'owner', actor);

  recipient_age := extract(year from age(current_date, recipient_birth_date));
  if recipient_age < 19 then
    insert into consents (child_id, guardian_id, type) values
      (recipient_id, actor, 'guardian_legal'),
      (recipient_id, actor, 'sensitive_health');
  elsif recipient_is_self then
    insert into consents (child_id, guardian_id, type)
    values (recipient_id, actor, 'sensitive_health');
  else
    insert into consents (child_id, guardian_id, type) values
      (recipient_id, actor, 'adult_delegated'),
      (recipient_id, actor, 'sensitive_health');
  end if;

  return created;
end $$;

-- ── 공동 보호자 초대/역할 변경 RPC ─────────────────────────────────
create or replace function invite_guardian(cid uuid, invitee_email text, invite_role text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  invitee uuid;
  co_count int;
  max_co int;
begin
  if actor is null or my_role(cid) is distinct from 'owner' then
    raise exception '대상자의 소유자만 보호자를 초대할 수 있습니다' using errcode = '42501';
  end if;
  if invite_role not in ('editor', 'viewer') then
    raise exception '부여할 수 있는 권한은 editor 또는 viewer입니다' using errcode = '22023';
  end if;
  select id into invitee from auth.users where lower(email) = lower(trim(invitee_email));
  if invitee is null then
    raise exception '해당 이메일로 가입된 보호자가 없습니다. 먼저 회원가입을 안내해 주세요.' using errcode = 'P0001';
  end if;
  if invitee = actor then
    raise exception '본인은 초대할 수 없습니다' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext(cid::text));
  if exists (select 1 from guardian_child where guardian_id = invitee and child_id = cid) then
    update guardian_child set role = invite_role, invited_by = actor
      where guardian_id = invitee and child_id = cid;
    return json_build_object('guardian_id', invitee, 'updated', true);
  end if;

  select count(*) into co_count from guardian_child where child_id = cid and role <> 'owner';
  max_co := tier_max_co_guardians(my_tier());
  if co_count >= max_co then
    if max_co = 0 then
      raise exception '공동 보호자 초대는 스탠다드 플랜부터 가능해요.' using errcode = 'P0001';
    end if;
    raise exception '현재 플랜에서는 대상자당 공동 보호자를 %명까지 초대할 수 있어요.', max_co using errcode = 'P0001';
  end if;

  insert into profiles (id, name)
  select invitee, split_part(invitee_email, '@', 1)
  where not exists (select 1 from profiles where id = invitee);
  insert into guardian_child (guardian_id, child_id, role, invited_by)
  values (invitee, cid, invite_role, actor);
  return json_build_object('guardian_id', invitee, 'updated', false);
end $$;

create or replace function set_guardian_role(cid uuid, target_guardian_id uuid, new_role text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null or my_role(cid) is distinct from 'owner' then
    raise exception '대상자의 소유자만 역할을 변경할 수 있습니다' using errcode = '42501';
  end if;
  if target_guardian_id = actor or new_role not in ('editor', 'viewer') then
    raise exception '본인 또는 owner 역할은 변경할 수 없으며 editor/viewer만 지정할 수 있습니다' using errcode = '22023';
  end if;
  update guardian_child set role = new_role
    where child_id = cid and guardian_id = target_guardian_id and role <> 'owner';
  if not found then
    raise exception '변경할 공동 보호자를 찾을 수 없습니다' using errcode = 'P0001';
  end if;
  return json_build_object('guardian_id', target_guardian_id, 'role', new_role);
end $$;

-- 소유권 이전은 기존 editor에게만 허용한다. 두 UPDATE는 한 SECURITY DEFINER 함수 안에서
-- 실행되므로 owner가 0명/2명인 중간 상태를 클라이언트가 관찰하거나 재사용할 수 없다.
create or replace function transfer_guardian_ownership(cid uuid, target_guardian_id uuid)
returns json
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null or my_role(cid) is distinct from 'owner' then
    raise exception '대상자의 소유자만 소유권을 이전할 수 있습니다' using errcode = '42501';
  end if;
  if target_guardian_id = actor then
    raise exception '본인에게 소유권을 이전할 수 없습니다' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext(cid::text));
  if not exists (
    select 1 from guardian_child
    where child_id = cid and guardian_id = target_guardian_id and role = 'editor'
  ) then
    raise exception '소유권은 현재 편집자에게만 이전할 수 있습니다' using errcode = 'P0001';
  end if;
  update guardian_child set role = 'editor'
    where child_id = cid and guardian_id = actor and role = 'owner';
  if not found then
    raise exception '현재 소유자 관계를 찾을 수 없습니다' using errcode = 'P0001';
  end if;
  update guardian_child set role = 'owner'
    where child_id = cid and guardian_id = target_guardian_id and role = 'editor';
  if not found then
    raise exception '소유권을 받을 편집자 관계를 찾을 수 없습니다' using errcode = 'P0001';
  end if;
  return json_build_object('previous_owner_id', actor, 'owner_id', target_guardian_id);
end $$;

-- FK cascade로 대상자가 삭제되는 경우를 제외하고 모든 care circle은 commit 시 owner 정확히
-- 한 명을 가져야 한다. DEFERRABLE이므로 소유권 이전 RPC의 두 행 swap은 중간 상태 없이
-- 하나의 트랜잭션으로 검증된다.
create or replace function enforce_guardian_child_exactly_one_owner() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  affected_child_id uuid := case when tg_op = 'DELETE' then old.child_id else new.child_id end;
begin
  if exists (select 1 from children where id = affected_child_id)
     and (select count(*) from guardian_child where child_id = affected_child_id and role = 'owner') <> 1 then
    raise exception '대상자에는 정확히 한 명의 소유자가 필요합니다' using errcode = '23514';
  end if;
  return null;
end $$;
drop trigger if exists guardian_child_exactly_one_owner on guardian_child;
create constraint trigger guardian_child_exactly_one_owner
after insert or update or delete on guardian_child
deferrable initially deferred for each row
execute function enforce_guardian_child_exactly_one_owner();

-- RPC는 authenticated 클라이언트만 실행한다. public 기본 EXECUTE를 명시적으로 제거한다.
revoke all on function create_recipient(jsonb) from public;
revoke all on function invite_guardian(uuid, text, text) from public;
revoke all on function set_guardian_role(uuid, uuid, text) from public;
revoke all on function transfer_guardian_ownership(uuid, uuid) from public;
revoke all on function enforce_guardian_child_exactly_one_owner() from public;
grant execute on function create_recipient(jsonb) to authenticated;
grant execute on function invite_guardian(uuid, text, text) to authenticated;
grant execute on function set_guardian_role(uuid, uuid, text) to authenticated;
grant execute on function transfer_guardian_ownership(uuid, uuid) to authenticated;
