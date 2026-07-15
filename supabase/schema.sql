-- kidcare: 아이 건강 관리 앱 스키마 (Supabase PostgreSQL)
-- 적용: supabase db push 또는 SQL Editor에서 실행

create extension if not exists "pgcrypto";

-- ─────────────────────────────── 보호자 ───────────────────────────────
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null,
  phone       text,
  relationship text default '엄마',            -- 엄마/아빠/조부모/기타
  created_at  timestamptz not null default now()
);

-- ─────────────────────────────── 아이 ────────────────────────────────
create table children (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  nickname           text,
  birth_date         date not null,
  sex                text not null check (sex in ('male','female')),
  birth_weight_g     integer,
  birth_height_cm    numeric(4,1),
  gestational_weeks  integer,                  -- 재태주수
  is_preterm         boolean not null default false,
  blood_type         text,
  allergies          text[] not null default '{}',
  chronic_conditions text[] not null default '{}',
  surgeries          jsonb  not null default '[]',  -- [{name, date, hospital}]
  hospitalizations   jsonb  not null default '[]',
  primary_doctor     text,
  primary_hospital   text,
  guardian_phone     text,
  other_notes        text,                     -- 건강 정보 기타(자유 기재)
  created_at         timestamptz not null default now(),
  deleted_at         timestamptz               -- 소프트 삭제 후 배치 완전삭제
);

-- 보호자-아이 관계 (다자녀 + 공동 관리)
create table guardian_child (
  guardian_id uuid not null references profiles(id) on delete cascade,
  child_id    uuid not null references children(id) on delete cascade,
  role        text not null default 'owner' check (role in ('owner','editor','viewer')),
  invited_by  uuid references profiles(id),
  created_at  timestamptz not null default now(),
  primary key (guardian_id, child_id)
);

-- ─────────────────────────────── 동의 ────────────────────────────────
-- 만 14세 미만 법정대리인 동의 + 건강정보(민감정보) 별도 동의
create table consents (
  id          uuid primary key default gen_random_uuid(),
  child_id    uuid not null references children(id) on delete cascade,
  guardian_id uuid not null references profiles(id) on delete cascade,
  type        text not null check (type in ('guardian_legal','sensitive_health','share')),
  granted_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  doc_version text not null default 'v1'      -- 동의서 문서 버전
);
create index on consents (child_id, type);

-- ─────────────────────────── 일자별 기록 ─────────────────────────────
create table daily_records (
  id          uuid primary key default gen_random_uuid(),
  child_id    uuid not null references children(id) on delete cascade,
  author_id   uuid not null references profiles(id),
  record_date date not null,
  record_time time,
  type        text not null check (type in
    ('condition','behavior','meal','sleep','excretion','activity',
     'symptom','medication_dose','incident','media_use','school','note')),
  categories  text[] not null default '{}',   -- 건강관리 영역 14종 슬러그
  payload     jsonb  not null default '{}',   -- 유형별 세부값 (docs/02 규약)
  memo        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on daily_records (child_id, record_date);
create index on daily_records (child_id, type, record_date);
create index on daily_records using gin (categories);

create table record_files (
  id           uuid primary key default gen_random_uuid(),
  record_id    uuid not null references daily_records(id) on delete cascade,
  storage_path text not null,                 -- 버킷 record-files 내 경로
  mime_type    text not null,
  created_at   timestamptz not null default now()
);

-- ─────────────────────────── 성장 측정 ───────────────────────────────
create table growth_measurements (
  id          uuid primary key default gen_random_uuid(),
  child_id    uuid not null references children(id) on delete cascade,
  measured_on date not null,
  height_cm   numeric(5,1),
  weight_kg   numeric(5,2),
  head_cm     numeric(4,1),
  bmi         numeric(4,1) generated always as
              (case when height_cm > 0 and weight_kg is not null
                    then round(weight_kg / ((height_cm/100)^2), 1) end) stored,
  created_at  timestamptz not null default now(),
  unique (child_id, measured_on)
);

-- ─────────────────────────── 복용약 ─────────────────────────────────
-- 주의: 용량(dose_text)은 보호자/처방 그대로 기록하는 자유 텍스트.
-- 앱은 용량 계산·추천을 하지 않는다.
create table medications (
  id            uuid primary key default gen_random_uuid(),
  child_id      uuid not null references children(id) on delete cascade,
  name          text not null,
  dose_text     text,
  schedule_text text,                          -- "1일 3회 식후" 등
  start_date    date,
  end_date      date,
  prescriber    text,                          -- 처방 병원/의사
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ────────────────────── 예방접종 / 건강검진 ─────────────────────────
create table vaccinations (
  id               uuid primary key default gen_random_uuid(),
  child_id         uuid not null references children(id) on delete cascade,
  vaccine_name     text not null,              -- 수동 입력 (BCG, DTaP 등)
  dose_no          integer not null default 1, -- 차수
  due_date         date,
  done_date        date,
  hospital         text,
  lot_no           text,
  adverse_reaction text,                       -- 이상반응 메모
  created_at       timestamptz not null default now()
);

create table checkups (
  id             uuid primary key default gen_random_uuid(),
  child_id       uuid not null references children(id) on delete cascade,
  checkup_name   text not null,                -- 영유아검진 n차 등
  due_date       date,
  done_date      date,
  hospital       text,
  result_summary text,
  created_at     timestamptz not null default now()
);

-- ─────────────────────── 레포트 / 공유 링크 ─────────────────────────
create table reports (
  id                   uuid primary key default gen_random_uuid(),
  child_id             uuid not null references children(id) on delete cascade,
  created_by           uuid not null references profiles(id),
  period_start         date not null,
  period_end           date not null,
  questions_for_doctor text[] not null default '{}',
  storage_path         text,                   -- 버킷 reports 내 PDF 경로
  created_at           timestamptz not null default now()
);

create table share_links (
  id         uuid primary key default gen_random_uuid(),
  report_id  uuid not null references reports(id) on delete cascade,
  token      text not null unique default encode(gen_random_bytes(24),'hex'),
  expires_at timestamptz not null,             -- 만료 필수
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- ══════════════════════════ RLS 정책 ════════════════════════════════
alter table profiles            enable row level security;
alter table children            enable row level security;
alter table guardian_child      enable row level security;
alter table consents            enable row level security;
alter table daily_records       enable row level security;
alter table record_files        enable row level security;
alter table growth_measurements enable row level security;
alter table medications         enable row level security;
alter table vaccinations        enable row level security;
alter table checkups            enable row level security;
alter table reports             enable row level security;
alter table share_links         enable row level security;

-- 헬퍼: 내가 이 아이에 대해 가진 역할
create or replace function my_role(cid uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from guardian_child
  where child_id = cid and guardian_id = auth.uid()
$$;

-- 헬퍼: 유효한 민감정보 동의가 있는가
create or replace function has_sensitive_consent(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from consents
    where child_id = cid and type = 'sensitive_health'
      and revoked_at is null)
$$;

create policy "own profile" on profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

create policy "read my children" on children
  for select using (my_role(id) is not null and deleted_at is null);
create policy "insert child" on children
  for insert with check (true);  -- 생성 직후 guardian_child(owner) 삽입은 앱 트랜잭션에서 수행
create policy "edit my children" on children
  for update using (my_role(id) in ('owner','editor'));
create policy "owner deletes child" on children
  for delete using (my_role(id) = 'owner');

create policy "see my links" on guardian_child
  for select using (guardian_id = auth.uid() or my_role(child_id) = 'owner');
create policy "owner manages links" on guardian_child
  for all using (my_role(child_id) = 'owner' or guardian_id = auth.uid());

create policy "read consents" on consents
  for select using (my_role(child_id) is not null);
create policy "grant own consent" on consents
  for insert with check (guardian_id = auth.uid() and my_role(child_id) is not null);
create policy "revoke own consent" on consents
  for update using (guardian_id = auth.uid());

-- 민감정보 동의 없으면 건강 기록 자체를 차단
create policy "read records" on daily_records
  for select using (my_role(child_id) is not null);
create policy "write records" on daily_records
  for insert with check (my_role(child_id) in ('owner','editor')
                         and has_sensitive_consent(child_id));
create policy "edit records" on daily_records
  for update using (my_role(child_id) in ('owner','editor'));
create policy "delete records" on daily_records
  for delete using (my_role(child_id) in ('owner','editor'));

create policy "files via record" on record_files
  for all using (exists (select 1 from daily_records r
                         where r.id = record_id and my_role(r.child_id) is not null));

create policy "growth rw" on growth_measurements
  for all using (my_role(child_id) is not null)
  with check (my_role(child_id) in ('owner','editor') and has_sensitive_consent(child_id));

create policy "meds rw" on medications
  for all using (my_role(child_id) is not null)
  with check (my_role(child_id) in ('owner','editor'));

create policy "vacc rw" on vaccinations
  for all using (my_role(child_id) is not null)
  with check (my_role(child_id) in ('owner','editor'));

create policy "checkups rw" on checkups
  for all using (my_role(child_id) is not null)
  with check (my_role(child_id) in ('owner','editor'));

create policy "reports rw" on reports
  for all using (my_role(child_id) is not null)
  with check (my_role(child_id) in ('owner','editor'));

create policy "share links by owner" on share_links
  for all using (exists (select 1 from reports r
                         where r.id = report_id and my_role(r.child_id) in ('owner','editor')));

-- 외부(비로그인) 공유 조회는 DB 함수가 아니라 Edge Function
-- (supabase/functions/share-report)이 담당한다. 서명 URL은 발급 후 회수할 수
-- 없으므로, 매 요청마다 만료/회수를 재검사한 뒤 짧은 수명의 서명 URL을 새로
-- 발급해야 "회수" 버튼이 실제로 접근을 끊을 수 있다. 자세한 내용은
-- docs/02_db_schema.md의 "4단계 추가" 절 참조.

-- updated_at 자동 갱신
create or replace function touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create trigger daily_records_touch before update on daily_records
  for each row execute function touch_updated_at();

-- ══════════════════════ Storage 버킷 + 정책 ═════════════════════════
-- 기록 사진(record-files)과 레포트 PDF(reports). 모두 비공개 버킷 —
-- 앱은 서명 URL로만 접근한다. 파일 경로 규약: <child_id>/<record_id>/<파일명>
insert into storage.buckets (id, name, public)
values ('record-files', 'record-files', false), ('reports', 'reports', false)
on conflict (id) do nothing;

-- 경로 첫 세그먼트(child_id)로 보호자 권한 확인
create policy "record files read" on storage.objects for select
  using (bucket_id in ('record-files','reports')
         and public.my_role((split_part(name, '/', 1))::uuid) is not null);

create policy "record files write" on storage.objects for insert
  with check (bucket_id in ('record-files','reports')
              and public.my_role((split_part(name, '/', 1))::uuid) in ('owner','editor')
              and public.has_sensitive_consent((split_part(name, '/', 1))::uuid));

create policy "record files delete" on storage.objects for delete
  using (bucket_id in ('record-files','reports')
         and public.my_role((split_part(name, '/', 1))::uuid) in ('owner','editor'));
