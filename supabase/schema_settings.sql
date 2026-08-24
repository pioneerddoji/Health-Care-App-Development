-- 사용자별 앱 설정 — schema.sql → schema_stage3.sql → schema_subscriptions.sql
-- 다음에 실행한다.
--
-- 기기 로컬(AsyncStorage)에만 있던 개인 설정(대시보드 그래프 순서 등)을 계정
-- 단위로 보관해, 같은 기기에서 계정을 바꾸거나 기기를 바꿔도 설정이 유지되게
-- 한다. settings는 열린 JSONB 한 컬럼 — 설정 항목이 늘어도 스키마 변경이 없다.
-- (키 규약은 src/types의 UserSettings 인터페이스가 단일 원천)

create table user_settings (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  settings   jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table user_settings enable row level security;

-- 본인 행만 읽기/쓰기 — 타인 설정은 존재 여부조차 보이지 않는다
create policy "own settings" on user_settings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
