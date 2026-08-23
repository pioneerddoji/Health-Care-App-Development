-- RLS 통합 테스트 — 로컬 PostgreSQL에서 Supabase 환경(auth/storage)을 셈으로 만들어
-- schema.sql부터 schema_security.sql까지 전부 적용하고 2계정 권한 시나리오를 검증한다.
--
-- 실행 (이 디렉터리 carenote/supabase/tests 에서 — \i 경로 기준):
--   initdb로 임시 클러스터를 만든 뒤:
--   psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f rls_test.sql
--   출력에서 FAIL이 없으면 통과. (매 실행마다 새 DB 필요)
--
-- 검증 항목: 민감정보 동의 게이트, 임의 참여 차단, 자기승격 차단, 초대 RPC,
-- editor/viewer 권한, 공동 보호자 프로필 열람, Storage 경로 정책,
-- 나가기/외부인 차단, owner 삭제 cascade.
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
-- ── Supabase 환경 셈 (auth / storage 스키마) ──
create schema auth;
create table auth.users (id uuid primary key, email text unique);
create function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create role authenticated;
create role anon;

\i ../schema.sql
\i ../schema_stage3.sql
\i ../schema_subscriptions.sql
\i ../schema_settings.sql
\i ../schema_recipients.sql
\i ../schema_security.sql
\i ../schema_consent_deletion.sql

grant usage on schema public to authenticated;
grant all on all tables in schema public to authenticated;
grant usage on schema auth to authenticated;
grant usage on schema storage to authenticated;
grant all on storage.objects, storage.buckets to authenticated;
-- Supabase의 anon 역할은 스키마 이름을 해석할 수 있지만 인증 전용 RPC EXECUTE는 없어야 한다.
grant usage on schema public, auth to anon;

-- 테스트 사용자
insert into auth.users values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'mom@example.com'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'dad@example.com'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'stranger@example.com');

-- 헬퍼
create function set_user(uid text) returns void language sql
  as $$ select set_config('test.uid', uid, false)::void $$;
create function expect_ok(stmt text, label text) returns text language plpgsql as $fn$
begin execute stmt; return 'PASS(허용) ' || label;
exception when others then return 'FAIL ' || label || ' — 오류: ' || sqlerrm; end $fn$;
create function expect_error(stmt text, label text) returns text language plpgsql as $fn$
begin execute stmt; return 'FAIL ' || label || ' — 차단돼야 하는데 성공';
exception when others then return 'PASS(차단) ' || label; end $fn$;
create function expect_rows(stmt text, expected int, label text) returns text language plpgsql as $fn$
declare n int;
begin execute stmt; get diagnostics n = row_count;
  if n = expected then return 'PASS(rows=' || n || ') ' || label;
  else return 'FAIL ' || label || ' — rows=' || n || ', expected ' || expected; end if;
end $fn$;

-- create_recipient가 children INSERT를 마친 뒤 다음 쓰기에서 실패하도록 만드는 테스트 전용 fault.
-- quota 선검사 실패가 아니라 실제 트랜잭션 중간 실패의 rollback을 검증한다.
create function fail_guardian_link_after_child_insert() returns trigger language plpgsql as $fn$
begin
  if new.child_id = '66666666-6666-6666-6666-666666666666'::uuid then
    raise exception 'TEST_ONLY failure after children INSERT';
  end if;
  return new;
end $fn$;
create trigger test_fail_guardian_link_after_child_insert
  before insert on guardian_child
  for each row execute function fail_guardian_link_after_child_insert();

-- ── SECURITY DEFINER 메타데이터·익명 실행 경계 ──
select case when (
  select count(*) from pg_proc
  where oid in (
    'create_recipient(jsonb)'::regprocedure,
    'invite_guardian(uuid,text,text)'::regprocedure,
    'set_guardian_role(uuid,uuid,text)'::regprocedure
  ) and prosecdef and proconfig = array['search_path=public']
) = 3 then 'PASS SECURITY DEFINER RPC는 고정 search_path 사용' else 'FAIL SECURITY DEFINER/search_path 설정' end;
select case when
  has_function_privilege('authenticated', 'create_recipient(jsonb)', 'EXECUTE')
  and has_function_privilege('authenticated', 'invite_guardian(uuid,text,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'set_guardian_role(uuid,uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'create_recipient(jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'invite_guardian(uuid,text,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'set_guardian_role(uuid,uuid,text)', 'EXECUTE')
  then 'PASS RPC EXECUTE는 authenticated에만 최소 부여' else 'FAIL RPC EXECUTE 권한 범위' end;

set role anon;
select expect_error($q$select create_recipient('{}'::jsonb)$q$, 'anon EXECUTE 차단 — create_recipient');
select expect_error($q$select invite_guardian(gen_random_uuid(), 'x@example.com', 'viewer')$q$, 'anon EXECUTE 차단 — invite_guardian');
select expect_error($q$select set_guardian_role(gen_random_uuid(), gen_random_uuid(), 'viewer')$q$, 'anon EXECUTE 차단 — set_guardian_role');

set role authenticated;

-- ── A(엄마): 원자적 대상자 생성 → 동의 → 기록 ──
select set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select expect_ok($q$insert into profiles(id, name) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '엄마')$q$, 'A 프로필 생성');
select expect_error($q$insert into children(id, name, birth_date, sex) values ('11111111-1111-1111-1111-111111111111', '직접생성', '2023-01-01', 'female')$q$, '직접 대상자 생성 차단');
select expect_ok($q$select create_recipient('{"id":"11111111-1111-1111-1111-111111111111","name":"하은","birth_date":"2023-01-01","sex":"female"}'::jsonb)$q$, 'A 대상자·owner·필수 동의 원자 생성');
select case when (select count(*) from guardian_child where child_id = '11111111-1111-1111-1111-111111111111' and guardian_id = auth.uid() and role = 'owner') = 1
  and (select count(*) from consents where child_id = '11111111-1111-1111-1111-111111111111' and type = 'guardian_legal' and revoked_at is null) = 1
  and (select count(*) from consents where child_id = '11111111-1111-1111-1111-111111111111' and type = 'sensitive_health' and revoked_at is null) = 1
  then 'PASS 대상자 생성은 owner·필수 동의와 함께 커밋' else 'FAIL 대상자 생성 원자성/필수 동의' end;
select expect_ok($q$select create_recipient('{"id":"11111111-1111-1111-1111-111111111111","name":"하은","birth_date":"2023-01-01","sex":"female"}'::jsonb)$q$, '동일 id 재시도 멱등 성공');
select case when
  (select count(*) from children where id = '11111111-1111-1111-1111-111111111111') = 1
  and (select count(*) from guardian_child where child_id = '11111111-1111-1111-1111-111111111111') = 1
  and (select count(*) from consents where child_id = '11111111-1111-1111-1111-111111111111') = 2
  then 'PASS 재시도 멱등 — 대상자·owner·동의 중복 없음' else 'FAIL 재시도 중복 생성' end;
-- 서버 trigger가 초기 원자 동의의 증빙을 실제 문서 snapshot으로 남긴다.
select case when (select count(*) from recipient_consent_evidence where child_id = '11111111-1111-1111-1111-111111111111') = 2
  then 'PASS 초기 대상자 동의 증빙 2건 캡처' else 'FAIL 초기 대상자 동의 증빙 누락' end;
select case when exists (select 1 from recipient_consent_evidence where child_id = '11111111-1111-1111-1111-111111111111' and document_type = 'guardian_legal' and subject_role = 'guardian')
  then 'PASS 법정대리인 증빙 주체 서버 결정' else 'FAIL 법정대리인 증빙 주체' end;
select case when exists (select 1 from recipient_consent_evidence where child_id = '11111111-1111-1111-1111-111111111111' and document_type = 'sensitive_health' and document_version = 'v1' and jsonb_array_length(document_items) > 0)
  then 'PASS 민감정보 증빙 문서 snapshot' else 'FAIL 민감정보 증빙 snapshot' end;
select expect_error($q$insert into consents(child_id, guardian_id, type, doc_version) values ('11111111-1111-1111-1111-111111111111', auth.uid(), 'sensitive_health', 'v1')$q$, '대상자 동의 직접 INSERT 차단');
select expect_error($q$insert into recipient_consent_evidence(consent_id, child_id, guardian_id, document_type, document_version, document_items, subject_role, accepted_at) values (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', auth.uid(), 'sensitive_health', 'v1', '["forged"]'::jsonb, 'guardian', now())$q$, '대상자 증빙 직접 INSERT 차단');
select expect_ok($q$insert into daily_records(child_id, author_id, record_date, type) values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', current_date, 'note')$q$, '원자 생성 후 기록 허용');
select expect_error($q$insert into daily_records(child_id, author_id, record_date, type) values ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', current_date, 'note')$q$, '기록 author_id 위조 차단');
select expect_error($q$update daily_records set author_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' where child_id = '11111111-1111-1111-1111-111111111111'$q$, '기록 author_id 재작성 차단');

-- ── 구독 한도 (free → standard 업그레이드) ──
select expect_error($q$select create_recipient('{"id":"33333333-3333-3333-3333-333333333333","name":"둘째","birth_date":"2024-06-01","sex":"male"}'::jsonb)$q$, 'free 티어 대상자 한도·실패 원자성');
select case when (select count(*) from children where id = '33333333-3333-3333-3333-333333333333') = 0 then 'PASS 한도 실패는 고아 대상자를 남기지 않음' else 'FAIL 한도 실패 후 고아 대상자' end;
select expect_error($q$select invite_guardian('11111111-1111-1111-1111-111111111111'::uuid, 'dad@example.com', 'editor')$q$, 'free 티어 공동 보호자 초대 차단(RPC)');
-- 스토어 결제 웹훅 시뮬레이션: service_role만 subscriptions에 쓸 수 있다
reset role;
insert into subscriptions (user_id, tier) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'standard');
set role authenticated;
select expect_ok($q$select create_recipient('{"id":"33333333-3333-3333-3333-333333333333","name":"둘째","birth_date":"2024-06-01","sex":"male"}'::jsonb)$q$, 'standard 업그레이드 후 두번째 대상자 허용');
select expect_error($q$select create_recipient('{"id":"66666666-6666-6666-6666-666666666666","name":"롤백검증","birth_date":"2022-06-01","sex":"female"}'::jsonb)$q$, 'children INSERT 이후 guardian 연결 실패');
select case when
  (select count(*) from children where id = '66666666-6666-6666-6666-666666666666') = 0
  and (select count(*) from guardian_child where child_id = '66666666-6666-6666-6666-666666666666') = 0
  and (select count(*) from consents where child_id = '66666666-6666-6666-6666-666666666666') = 0
  then 'PASS INSERT 이후 실패는 전체 트랜잭션 rollback' else 'FAIL INSERT 이후 실패가 부분 행을 남김' end;

-- ── B(아빠): 초대 전에는 아무것도 못 함 ──
select set_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
select expect_ok($q$insert into profiles(id, name) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '아빠')$q$, 'B 프로필 생성');
select expect_error($q$insert into guardian_child(guardian_id, child_id, role) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'owner')$q$, 'B 임의 참여(구멍①) 차단');
select case when (select count(*) from children) = 0 then 'PASS B는 초대 전 아이 안 보임' else 'FAIL B가 아이를 봄' end;
select case when (select count(*) from subscriptions) = 0 then 'PASS B는 타인 구독 정보 안 보임' else 'FAIL 구독 정보 노출' end;
select expect_error($q$select invite_guardian('11111111-1111-1111-1111-111111111111'::uuid, 'stranger@example.com', 'editor')$q$, '비소유자 초대 시도 차단');

-- ── A가 B를 편집자로 초대 (RPC) ──
select set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select expect_ok($q$select invite_guardian('11111111-1111-1111-1111-111111111111'::uuid, 'dad@example.com', 'editor')$q$, 'A가 B를 editor로 초대');
select expect_error($q$select invite_guardian('11111111-1111-1111-1111-111111111111'::uuid, 'nobody@example.com', 'editor')$q$, '미가입 이메일 초대 차단');
select expect_error($q$select invite_guardian('11111111-1111-1111-1111-111111111111'::uuid, 'stranger@example.com', 'owner')$q$, 'owner 권한 초대 차단');

-- ── B(editor): 열람/기록 가능, 자기승격 불가 ──
select set_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
select case when (select count(*) from children) = 1 then 'PASS B가 초대 후 아이 보임' else 'FAIL B가 아이 안 보임' end;
select case when (select count(*) from profiles) = 2 then 'PASS B가 공동 보호자 프로필(A) 열람' else 'FAIL 프로필 열람 실패' end;
select expect_ok($q$insert into daily_records(child_id, author_id, record_date, type) values ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', current_date, 'meal')$q$, 'B(editor) 기록 허용');
select expect_rows($q$update guardian_child set role = 'owner' where guardian_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$q$, 0, 'B 자기승격(구멍②) 무효');

-- ── A가 B를 열람자로 강등 → B 기록 차단 ──
select set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select expect_rows($q$update guardian_child set role = 'viewer' where guardian_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' and child_id = '11111111-1111-1111-1111-111111111111'$q$, 0, '직접 역할 변경 차단');
select expect_ok($q$select set_guardian_role('11111111-1111-1111-1111-111111111111'::uuid, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, 'viewer')$q$, 'A가 RPC로 B를 viewer로 변경');
select set_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
select expect_error($q$insert into daily_records(child_id, author_id, record_date, type) values ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', current_date, 'note')$q$, 'B(viewer) 기록 차단');
select expect_error($q$select record_recipient_consent('11111111-1111-1111-1111-111111111111'::uuid, 'sensitive_health', 'v1', 'guardian')$q$, 'B(viewer) 민감정보 동의 증빙 생성 차단');
select case when (select count(*) from daily_records) = 2 then 'PASS B(viewer) 열람은 가능' else 'FAIL viewer 열람 실패' end;

-- ── Storage 정책 ──
select set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select expect_ok($q$insert into storage.objects(bucket_id, name) values ('record-files', '11111111-1111-1111-1111-111111111111/rec1/a.jpg')$q$, 'A 사진 업로드 허용');
select set_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
select expect_error($q$insert into storage.objects(bucket_id, name) values ('record-files', '11111111-1111-1111-1111-111111111111/rec1/b.jpg')$q$, 'B(viewer) 사진 업로드 차단');
select case when (select count(*) from storage.objects) = 1 then 'PASS B(viewer) 사진 열람 가능' else 'FAIL 사진 열람' end;

-- ── 레포트 발행 / 공유 링크 (4단계) ──
select set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select expect_ok($q$insert into reports(id, child_id, created_by, period_start, period_end) values ('99999999-9999-9999-9999-999999999999', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', current_date - 13, current_date)$q$, 'A(owner) 레포트 발행');
select expect_error($q$insert into reports(child_id, created_by, period_start, period_end) values ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', current_date - 13, current_date)$q$, '레포트 created_by 위조 차단');
select expect_error($q$update reports set created_by = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' where id = '99999999-9999-9999-9999-999999999999'$q$, '레포트 created_by 재작성 차단');
select expect_ok($q$insert into storage.objects(bucket_id, name) values ('reports', '11111111-1111-1111-1111-111111111111/99999999-9999-9999-9999-999999999999.pdf')$q$, 'A(owner) 레포트 PDF 업로드 허용');
select expect_ok($q$insert into share_links(id, report_id, expires_at) values ('88888888-8888-8888-8888-888888888888', '99999999-9999-9999-9999-999999999999', now() + interval '72 hours')$q$, 'A(owner) 공유 링크 생성');

select set_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
select case when (select count(*) from reports) = 1 then 'PASS B(viewer) 레포트 메타 열람 가능' else 'FAIL' end;
select expect_error($q$insert into reports(child_id, created_by, period_start, period_end) values ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', current_date, current_date)$q$, 'B(viewer) 레포트 발행 차단');
select case when (select count(*) from share_links) = 0 then 'PASS B(viewer) 공유 링크 목록 비공개(owner/editor만)' else 'FAIL B가 공유 링크를 봄' end;

select set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select expect_rows($q$update share_links set revoked_at = now() where id = '88888888-8888-8888-8888-888888888888'$q$, 1, 'A(owner) 공유 링크 회수');

-- ── B 스스로 나가기 / C(외부인) 완전 차단 ──
select set_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'); -- 이하 B 본인 시점으로 복귀
select expect_rows($q$delete from guardian_child where guardian_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$q$, 1, 'B 스스로 나가기');
select case when (select count(*) from children) = 0 then 'PASS 나간 후 아이 안 보임' else 'FAIL' end;
select set_user('cccccccc-cccc-cccc-cccc-cccccccccccc');
select case when (select count(*) from children) + (select count(*) from daily_records) + (select count(*) from storage.objects) = 0 then 'PASS 외부인 C 완전 차단' else 'FAIL 외부인 접근' end;

-- ── 동의 철회/재동의 (5단계) ──
select set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select expect_ok($q$select revoke_recipient_consent('11111111-1111-1111-1111-111111111111'::uuid, 'sensitive_health')$q$, 'A 민감정보 동의 철회');
select expect_error($q$insert into daily_records(child_id, author_id, record_date, type) values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', current_date, 'note')$q$, '철회 후 기록 차단');
select expect_ok($q$select record_recipient_consent('11111111-1111-1111-1111-111111111111'::uuid, 'sensitive_health', 'v1', 'guardian')$q$, 'A 재동의');
select case when (select count(*) from recipient_consent_evidence where child_id = '11111111-1111-1111-1111-111111111111' and document_type = 'sensitive_health') = 2
  then 'PASS 재동의는 별도 민감정보 증빙 보존' else 'FAIL 재동의 증빙 누락' end;
select case when (select count(*) from recipient_consent_evidence where child_id = '11111111-1111-1111-1111-111111111111') = 3
  then 'PASS 철회 전 증빙은 재동의 후에도 보존' else 'FAIL 철회 증빙 보존' end;
select expect_ok($q$insert into daily_records(child_id, author_id, record_date, type) values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', current_date, 'note')$q$, '재동의 후 기록 허용');

-- ── 사용자별 설정 (user_settings) — 본인 행만 읽기/쓰기 ──
select set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select expect_ok($q$insert into user_settings(user_id, settings) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '{"dashboardOrder":["sleep","temp"]}'::jsonb)$q$, 'A 설정 저장');
select set_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
select case when (select count(*) from user_settings) = 0 then 'PASS 타인 설정 비노출' else 'FAIL B가 타인 설정을 봄' end;
select expect_error($q$insert into user_settings(user_id, settings) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '{}'::jsonb)$q$, '타인 user_id로 설정 쓰기 차단');
select expect_rows($q$update user_settings set settings = '{}'::jsonb where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$q$, 0, '타인 설정 수정 무효');

-- ── 전연령 확대: 성인 대상자도 동일한 동의 게이트가 걸린다 ──
select set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select expect_ok($q$select create_recipient('{"id":"44444444-4444-4444-4444-444444444444","name":"아버지","birth_date":"1955-03-02","sex":"male","recipient_type":"adult","is_self":false}'::jsonb)$q$, '성인 대상자·위임 동의 원자 생성');
select expect_error($q$select create_recipient('{"id":"55555555-5555-5555-5555-555555555555","name":"잘못된유형","birth_date":"2000-01-01","sex":"male","recipient_type":"pet"}'::jsonb)$q$, '허용되지 않은 recipient_type 차단');
select expect_ok($q$insert into daily_records(child_id, author_id, record_date, type) values ('44444444-4444-4444-4444-444444444444', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', current_date, 'note')$q$, '성인 대상자 — 동의 후 기록 허용');
select case when exists (select 1 from recipient_consent_evidence where child_id = '44444444-4444-4444-4444-444444444444' and document_type = 'sensitive_health' and subject_role = 'delegated_adult')
  then 'PASS 성인 민감정보 증빙 위임 주체 서버 결정' else 'FAIL 성인 민감정보 증빙 주체' end;
-- 위임 동의만 철회해도 민감정보 동의가 살아 있으면 기록은 계속된다(게이트는 sensitive_health 하나)
select expect_ok($q$select revoke_recipient_consent('44444444-4444-4444-4444-444444444444'::uuid, 'sensitive_health')$q$, '성인 대상자 민감정보 동의 철회');
select expect_error($q$insert into daily_records(child_id, author_id, record_date, type) values ('44444444-4444-4444-4444-444444444444', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', current_date, 'note')$q$, '성인 대상자 — 철회 후 기록 차단');
select case when (select count(*) from children where recipient_type = 'child') = 2 then 'PASS 기존 행은 child 기본값 유지' else 'FAIL recipient_type 기본값' end;

-- ── owner의 아이 삭제 cascade ──
-- ── 동의 증빙과 계정 삭제 요청 계약 ───────────────────────────────
-- account deletion은 Edge Function이 실제 Storage/Auth 파기를 수행한다. 여기서는
-- DB 신뢰 경계(재인증 claim, RLS, dry-run, 멱등 request)를 fresh PG에서 공격한다.
select set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select expect_error($q$insert into account_consent_evidence(document_type, document_version, document_items, subject_id, accepted_at) values ('terms', 'v1', '[]'::jsonb, auth.uid(), now())$q$, '계정 약관 증빙 직접 INSERT 차단');
select expect_error($q$insert into account_consent_evidence(document_type, document_version, document_items, subject_id, subject_role, accepted_at) values ('terms', 'v1', '["forged"]'::jsonb, auth.uid(), 'self', now())$q$, '계정 약관 증빙 유효형 직접 INSERT 차단');
select expect_error($q$select record_account_consent('terms', 'unknown', 'self')$q$, '알 수 없는 약관 버전 차단');
select expect_ok($q$select record_account_consent('terms', 'v1', 'self')$q$, '계정 약관 버전·항목·시각 서버 증빙');
select case when (select count(*) from account_consent_evidence where subject_id = auth.uid() and document_type = 'terms' and document_version = 'v1' and jsonb_array_length(document_items) > 0) = 1
  then 'PASS 계정 약관 증빙은 문서 항목을 스냅샷한다' else 'FAIL 계정 약관 증빙 스냅샷' end;
select case when (select document_items from account_consent_evidence where subject_id = auth.uid() and document_type = 'terms' order by recorded_at desc limit 1) = '["service_terms","adult_account","health_record_not_medical_advice"]'::jsonb
  then 'PASS 계정 약관 증빙 항목은 서버 문서와 일치' else 'FAIL 계정 약관 증빙 항목' end;
select expect_error($q$update account_consent_evidence set document_version = 'v2'$q$, '계정 약관 증빙 수정 차단');
select expect_error($q$select request_account_deletion(false)$q$, '재인증 claim 없는 탈퇴 요청 차단');
select set_config('request.jwt.claims', json_build_object('sub', auth.uid(), 'reauthenticated_at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF'))::text, false);
select expect_ok($q$select request_account_deletion(true)$q$, '재인증 후 dry-run 탈퇴 계획 생성');
select case when (select count(*) from account_deletion_jobs where user_id = auth.uid()) = 0
  then 'PASS dry-run은 삭제 작업을 만들지 않음' else 'FAIL dry-run이 삭제 작업을 남김' end;
select expect_ok($q$select request_account_deletion(false)$q$, '재인증 후 탈퇴 작업 생성');
select expect_ok($q$select request_account_deletion(false)$q$, '동일 탈퇴 요청 멱등 성공');
select case when (select count(*) from account_deletion_jobs where user_id = auth.uid() and status = 'requested') = 1
  then 'PASS 탈퇴 재시도는 활성 작업 하나만 유지' else 'FAIL 탈퇴 작업 중복 생성' end;
select set_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
select case when (select count(*) from account_deletion_jobs) = 0
  then 'PASS 공동 보호자는 타인 탈퇴 작업을 볼 수 없음' else 'FAIL 탈퇴 작업 정보 노출' end;
select expect_error($q$select request_account_deletion(false)$q$, '재인증 claim의 다른 계정 재사용 차단');

-- ── owner의 아이 삭제 cascade ──
select set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select expect_error($q$insert into daily_records(child_id, author_id, record_date, type) values ('11111111-1111-1111-1111-111111111111', auth.uid(), current_date, 'note')$q$, '탈퇴 요청 후 새 건강 기록 차단');
select expect_rows($q$delete from children where id = '11111111-1111-1111-1111-111111111111'$q$, 1, 'A(owner) 아이 삭제');
-- 삭제한 대상자의 기록만 사라져야 한다 (다른 대상자의 기록은 남아 있어야 정상)
select case when (select count(*) from daily_records where child_id = '11111111-1111-1111-1111-111111111111') = 0 then 'PASS 기록 cascade 삭제' else 'FAIL cascade' end;
select case when (select count(*) from daily_records where child_id = '44444444-4444-4444-4444-444444444444') = 1 then 'PASS 다른 대상자 기록은 보존' else 'FAIL 무관한 기록까지 삭제됨' end;

\echo RLS_SUITE_COMPLETE expected=93
