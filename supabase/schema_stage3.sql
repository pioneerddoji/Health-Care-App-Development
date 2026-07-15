-- 3단계: 보호자 공동 관리 — schema.sql 실행 후 이어서 실행한다.
-- (기존 설치본에도 이 파일만 추가 실행하면 된다)

-- ── 헬퍼 ────────────────────────────────────────────────────────
-- 아이에게 보호자가 하나라도 있는가 (같은 테이블 정책의 재귀 방지용 definer)
create or replace function child_has_guardians(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from guardian_child where child_id = cid)
$$;

-- 같은 아이를 공동 관리하는 보호자인가 (프로필 열람 허용 판정)
create or replace function is_co_guardian(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from guardian_child a
    join guardian_child b on a.child_id = b.child_id
    where a.guardian_id = auth.uid() and b.guardian_id = pid)
$$;

-- ── guardian_child 정책 교체 ────────────────────────────────────
-- 기존 "owner manages links"(for all, guardian_id = auth.uid() 허용)는
-- ① 아무나 임의 아이에 자기 행을 삽입 가능 ② editor가 자기 role을
-- owner로 승격 가능 — 두 구멍이 있어 폐기하고 세분화한다.
drop policy if exists "owner manages links" on guardian_child;

-- 삽입: (a) 아이 생성 직후 본인 owner 행 부트스트랩 (b) owner의 직접 추가
--       (이메일 초대는 아래 invite_guardian RPC 사용)
create policy "bootstrap or owner insert" on guardian_child for insert
  with check (
    (guardian_id = auth.uid() and role = 'owner' and not child_has_guardians(child_id))
    or my_role(child_id) = 'owner'
  );

-- 역할 변경: owner만, 자기 행은 불가, owner로 승격 불가(소유권 이전은 비범위)
create policy "owner updates roles" on guardian_child for update
  using (my_role(child_id) = 'owner' and guardian_id <> auth.uid())
  with check (role in ('editor','viewer'));

-- 해제: owner가 다른 보호자를 제거하거나, editor/viewer가 스스로 나가기
create policy "owner removes or self leave" on guardian_child for delete
  using (
    (my_role(child_id) = 'owner' and guardian_id <> auth.uid())
    or (guardian_id = auth.uid() and role <> 'owner')
  );

-- ── 공동 보호자 프로필 열람 ─────────────────────────────────────
-- 보호자 목록에 이름/관계를 표시하기 위해 필요 (본인 프로필 정책은 유지)
create policy "read co-guardian profiles" on profiles for select
  using (is_co_guardian(id));

-- ── 이메일 초대 RPC ─────────────────────────────────────────────
-- 클라이언트는 auth.users를 조회할 수 없으므로 definer 함수로 처리.
-- owner만 호출 가능, editor/viewer 역할만 부여 가능.
create or replace function invite_guardian(cid uuid, invitee_email text, invite_role text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  uid uuid;
begin
  if my_role(cid) is distinct from 'owner' then
    raise exception '아이의 소유자만 보호자를 초대할 수 있습니다';
  end if;
  if invite_role not in ('editor','viewer') then
    raise exception '부여할 수 있는 권한은 editor 또는 viewer입니다';
  end if;

  select id into uid from auth.users where lower(email) = lower(invitee_email);
  if uid is null then
    raise exception '해당 이메일로 가입된 보호자가 없습니다. 먼저 회원가입을 안내해 주세요.';
  end if;
  if uid = auth.uid() then
    raise exception '본인은 초대할 수 없습니다';
  end if;

  -- 초대받은 쪽 프로필이 아직 없으면 이메일 앞부분으로 생성
  insert into profiles (id, name)
  select uid, split_part(invitee_email, '@', 1)
  where not exists (select 1 from profiles where id = uid);

  insert into guardian_child (guardian_id, child_id, role, invited_by)
  values (uid, cid, invite_role, auth.uid())
  on conflict (guardian_id, child_id) do update set role = excluded.role;

  return json_build_object('guardian_id', uid);
end $$;
