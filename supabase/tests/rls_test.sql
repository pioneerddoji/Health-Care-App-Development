-- RLS 통합 테스트 — 로컬 PostgreSQL에서 Supabase 환경(auth/storage)을 셈으로 만들어
-- schema.sql부터 schema_settings.sql까지 전부 적용하고 2계정 권한 시나리오를 검증한다.
--
-- 실행 (이 디렉터리 kidcare/supabase/tests 에서 — \i 경로 기준):
--   initdb로 임시 클러스터를 만든 뒤:
--   psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f rls_test.sql
--   출력에서 FAIL이 없으면 통과. (매 실행마다 새 DB 필요)
--
-- 검증 항목: 민감정보 동의 게이트, 임의 참여 차단, 자기승격 차단, 초대 RPC,
-- editor/viewer 권한, 공동 보호자 프로필 열람, Storage 경로 정책,
-- 나가기/외부인 차단, owner 삭제 cascade.
\set ON_ERROR_STOP on
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

\i ../schema.sql
\i ../schema_stage3.sql
\i ../schema_subscriptions.sql
\i ../schema_settings.sql
\i ../schema_recipients.sql

grant usage on schema public to authenticated;
grant all on all tables in schema public to authenticated;
grant usage on schema storage to authenticated;
grant all on storage.objects, storage.buckets to authenticated;

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

set role authenticated;

-- ── A(엄마): 가입 → 아이 → 동의 → 기록 ──
select set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select expect_ok($q$insert into profiles(id, name) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '엄마')$q$, 'A 프로필 생성');
select expect_ok($q$insert into children(id, name, birth_date, sex) values ('11111111-1111-1111-1111-111111111111', '하은', '2023-01-01', 'female')$q$, 'A 아이 생성');
select expect_ok($q$insert into guardian_child(guardian_id, child_id, role) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'owner')$q$, 'A owner 부트스트랩');
select expect_error($q$insert into daily_records(child_id, author_id, record_date, type) values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', current_date, 'note')$q$, '민감정보 동의 전 기록 차단');
select expect_ok($q$insert into consents(child_id, guardian_id, type) values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'guardian_legal'), ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sensitive_health')$q$, 'A 동의 기록');
select expect_ok($q$insert into daily_records(child_id, author_id, record_date, type) values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', current_date, 'note')$q$, '동의 후 기록 허용');

-- ── 구독 한도 (free → standard 업그레이드) ──
select expect_ok($q$insert into children(id, name, birth_date, sex) values ('33333333-3333-3333-3333-333333333333', '둘째', '2024-06-01', 'male')$q$, 'A 두번째 아이 행 생성');
select expect_error($q$insert into guardian_child(guardian_id, child_id, role) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'owner')$q$, 'free 티어 아이 1명 한도(트리거)');
select expect_error($q$select invite_guardian('11111111-1111-1111-1111-111111111111'::uuid, 'dad@example.com', 'editor')$q$, 'free 티어 공동 보호자 초대 차단(RPC)');
-- 스토어 결제 웹훅 시뮬레이션: service_role만 subscriptions에 쓸 수 있다
reset role;
insert into subscriptions (user_id, tier) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'standard');
set role authenticated;
select expect_ok($q$insert into guardian_child(guardian_id, child_id, role) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'owner')$q$, 'standard 업그레이드 후 두번째 아이 허용');

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
select expect_rows($q$update guardian_child set role = 'viewer' where guardian_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' and child_id = '11111111-1111-1111-1111-111111111111'$q$, 1, 'A가 B를 viewer로 변경');
select set_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
select expect_error($q$insert into daily_records(child_id, author_id, record_date, type) values ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', current_date, 'note')$q$, 'B(viewer) 기록 차단');
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
select expect_rows($q$update consents set revoked_at = now() where child_id = '11111111-1111-1111-1111-111111111111' and type = 'sensitive_health' and revoked_at is null$q$, 1, 'A 민감정보 동의 철회');
select expect_error($q$insert into daily_records(child_id, author_id, record_date, type) values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', current_date, 'note')$q$, '철회 후 기록 차단');
select expect_ok($q$insert into consents(child_id, guardian_id, type) values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sensitive_health')$q$, 'A 재동의');
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
select expect_ok($q$insert into children(id, name, birth_date, sex, recipient_type) values ('44444444-4444-4444-4444-444444444444', '아버지', '1955-03-02', 'male', 'adult')$q$, '성인 대상자 생성');
select expect_ok($q$insert into guardian_child(guardian_id, child_id, role) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'owner')$q$, '성인 대상자 owner 연결');
select expect_error($q$insert into children(id, name, birth_date, sex, recipient_type) values ('55555555-5555-5555-5555-555555555555', '잘못된유형', '2000-01-01', 'male', 'pet')$q$, '허용되지 않은 recipient_type 차단');
-- 동의 없이는 성인 대상자도 기록 불가 (has_sensitive_consent 게이트 불변)
select expect_error($q$insert into daily_records(child_id, author_id, record_date, type) values ('44444444-4444-4444-4444-444444444444', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', current_date, 'note')$q$, '성인 대상자 — 동의 전 기록 차단');
select expect_ok($q$insert into consents(child_id, guardian_id, type) values ('44444444-4444-4444-4444-444444444444', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'adult_delegated'), ('44444444-4444-4444-4444-444444444444', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sensitive_health')$q$, '성인 위임 동의 + 민감정보 동의 기록');
select expect_ok($q$insert into daily_records(child_id, author_id, record_date, type) values ('44444444-4444-4444-4444-444444444444', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', current_date, 'note')$q$, '성인 대상자 — 동의 후 기록 허용');
-- 위임 동의만 철회해도 민감정보 동의가 살아 있으면 기록은 계속된다(게이트는 sensitive_health 하나)
select expect_rows($q$update consents set revoked_at = now() where child_id = '44444444-4444-4444-4444-444444444444' and type = 'sensitive_health' and revoked_at is null$q$, 1, '성인 대상자 민감정보 동의 철회');
select expect_error($q$insert into daily_records(child_id, author_id, record_date, type) values ('44444444-4444-4444-4444-444444444444', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', current_date, 'note')$q$, '성인 대상자 — 철회 후 기록 차단');
select case when (select count(*) from children where recipient_type = 'child') = 2 then 'PASS 기존 행은 child 기본값 유지' else 'FAIL recipient_type 기본값' end;

-- ── owner의 아이 삭제 cascade ──
select set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select expect_rows($q$delete from children where id = '11111111-1111-1111-1111-111111111111'$q$, 1, 'A(owner) 아이 삭제');
-- 삭제한 대상자의 기록만 사라져야 한다 (다른 대상자의 기록은 남아 있어야 정상)
select case when (select count(*) from daily_records where child_id = '11111111-1111-1111-1111-111111111111') = 0 then 'PASS 기록 cascade 삭제' else 'FAIL cascade' end;
select case when (select count(*) from daily_records where child_id = '44444444-4444-4444-4444-444444444444') = 1 then 'PASS 다른 대상자 기록은 보존' else 'FAIL 무관한 기록까지 삭제됨' end;
