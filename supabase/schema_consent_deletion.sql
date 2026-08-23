-- P0 서버 동의 증빙·완전 탈퇴 계약
--
-- 적용 순서:
--   schema.sql → schema_stage3.sql → schema_subscriptions.sql → schema_settings.sql
--   → schema_recipients.sql → schema_security.sql → 이 파일
--
-- 운영 DB에 바로 적용하지 않는다. fresh PostgreSQL 16 RLS test와 스테이징 Edge Function
-- dry-run을 통과한 뒤 별도 승인으로 적용한다.

begin;

-- ── 문서 버전과 불변 동의 증빙 ────────────────────────────────────
-- item 목록은 동의 당시의 항목 스냅샷이다. 앱 라벨이나 현재 전문을 다시 읽어
-- 과거 동의를 해석하지 않는다.
create table consent_documents (
  scope            text not null check (scope in ('account', 'recipient')),
  document_type    text not null,
  document_version text not null,
  document_items   jsonb not null check (jsonb_typeof(document_items) = 'array' and jsonb_array_length(document_items) > 0),
  published_at     timestamptz not null default now(),
  primary key (scope, document_type, document_version),
  unique (document_type, document_version)
);

-- 현재 앱 전문의 버전 식별자와 항목 제목만 서버 계약에 고정한다. 전문 변경 시 UPDATE가
-- 아니라 새 version INSERT를 추가해야 과거 증빙의 의미가 바뀌지 않는다.
insert into consent_documents(scope, document_type, document_version, document_items) values
  ('account', 'terms', 'v1', '["service_terms","adult_account","health_record_not_medical_advice"]'::jsonb),
  ('recipient', 'guardian_legal', 'v1', '["legal_guardian_authority","recipient_registration"]'::jsonb),
  ('recipient', 'sensitive_health', 'v1', '["sensitive_health_collection","purpose","retention","withdrawal"]'::jsonb),
  ('recipient', 'adult_delegated', 'v1', '["adult_delegation_confirmation","recipient_notice"]'::jsonb),
  ('recipient', 'share', 'v1', '["share_purpose","recipient_scope","expiry_and_withdrawal"]'::jsonb)
on conflict (scope, document_type, document_version) do nothing;

create table recipient_consent_evidence (
  id               uuid primary key default gen_random_uuid(),
  consent_id       uuid not null unique references consents(id) on delete cascade,
  child_id         uuid not null references children(id) on delete cascade,
  guardian_id      uuid not null references profiles(id) on delete cascade,
  document_type    text not null,
  document_version text not null,
  document_items   jsonb not null check (jsonb_typeof(document_items) = 'array' and jsonb_array_length(document_items) > 0),
  subject_role     text not null check (subject_role in ('guardian', 'self', 'delegated_adult')),
  accepted_at      timestamptz not null,
  recorded_at      timestamptz not null default now(),
  foreign key (document_type, document_version)
    references consent_documents(document_type, document_version) deferrable initially immediate
);

-- PostgreSQL FK는 scope를 포함하지 못하므로 recipient 트리거/RPC가 scope='recipient'를
-- 강제한다. 문서 버전/항목/시각/주체는 evidence 생성 뒤 변경할 수 없다.
create table account_consent_evidence (
  id               uuid primary key default gen_random_uuid(),
  subject_id       uuid not null references auth.users(id) on delete cascade,
  document_type    text not null,
  document_version text not null,
  document_items   jsonb not null check (jsonb_typeof(document_items) = 'array' and jsonb_array_length(document_items) > 0),
  subject_role     text not null check (subject_role = 'self'),
  accepted_at      timestamptz not null,
  recorded_at      timestamptz not null default now(),
  unique (subject_id, document_type, document_version, accepted_at)
);

create index recipient_consent_evidence_child_idx on recipient_consent_evidence(child_id, document_type);
create index account_consent_evidence_subject_idx on account_consent_evidence(subject_id, document_type);

alter table consent_documents enable row level security;
alter table recipient_consent_evidence enable row level security;
alter table account_consent_evidence enable row level security;

create policy "read published consent documents" on consent_documents
  for select using (true);
create policy "read recipient consent evidence" on recipient_consent_evidence
  for select using (my_role(child_id) is not null);
create policy "read own account consent evidence" on account_consent_evidence
  for select using (subject_id = auth.uid());
-- An explicit failed UPDATE check turns a client mutation into an RLS error rather
-- than a silent zero-row update; evidence is append-only after server capture.
create policy "account consent evidence is immutable" on account_consent_evidence
  for update using (subject_id = auth.uid()) with check (false);

create or replace function expected_recipient_consent_subject(cid uuid, consent_type text)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  recipient children;
begin
  select * into recipient from children where id = cid;
  if not found then
    raise exception '대상자를 찾을 수 없습니다' using errcode = '22023';
  end if;
  if consent_type = 'guardian_legal' then return 'guardian'; end if;
  if consent_type = 'adult_delegated' then return 'delegated_adult'; end if;
  if consent_type = 'sensitive_health' then
    if extract(year from age(current_date, recipient.birth_date)) < 19 then return 'guardian'; end if;
    if recipient.is_self then return 'self'; end if;
    return 'delegated_adult';
  end if;
  return 'self'; -- share
end $$;

create or replace function capture_recipient_consent_evidence() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  doc consent_documents;
  evidence_subject_role text;
begin
  select * into doc from consent_documents
    where scope = 'recipient'
      and document_type = new.type
      and document_version = coalesce(new.doc_version, 'v1');
  if not found then
    raise exception '서버에 등록되지 않은 동의 문서 버전입니다' using errcode = '22023';
  end if;

  evidence_subject_role := expected_recipient_consent_subject(new.child_id, new.type);

  insert into recipient_consent_evidence(
    consent_id, child_id, guardian_id, document_type, document_version,
    document_items, subject_role, accepted_at
  ) values (
    new.id, new.child_id, new.guardian_id, new.type, new.doc_version,
    doc.document_items, evidence_subject_role, new.granted_at
  );
  return new;
end $$;

drop trigger if exists consents_capture_evidence on consents;
create trigger consents_capture_evidence
  after insert on consents
  for each row execute function capture_recipient_consent_evidence();

-- 기존 행은 당시 기록된 granted_at/doc_version으로 한 번만 이관한다. 문서 버전을
-- 확인할 수 없는 행은 임의로 증빙을 꾸며내지 않고 운영자가 별도 처리한다.
insert into recipient_consent_evidence(
  consent_id, child_id, guardian_id, document_type, document_version,
  document_items, subject_role, accepted_at
)
select c.id, c.child_id, c.guardian_id, c.type, c.doc_version, d.document_items,
  expected_recipient_consent_subject(c.child_id, c.type),
  c.granted_at
from consents c
join consent_documents d on d.scope = 'recipient' and d.document_type = c.type and d.document_version = c.doc_version
on conflict (consent_id) do nothing;

-- 기존 raw INSERT/UPDATE는 문서 버전·시각 증빙을 우회하므로 폐기한다.
drop policy if exists "grant own consent" on consents;
drop policy if exists "revoke own consent" on consents;

create or replace function record_recipient_consent(
  cid uuid, consent_type text, p_document_version text, subject_role text
) returns public.consents
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  doc consent_documents;
  created public.consents;
begin
  if actor is null or coalesce(my_role(cid), '') not in ('owner', 'editor') then
    raise exception '대상자 동의를 기록할 권한이 없습니다' using errcode = '42501';
  end if;
  if consent_type not in ('guardian_legal', 'sensitive_health', 'adult_delegated')
     or subject_role not in ('guardian', 'self', 'delegated_adult') then
    raise exception '동의 유형 또는 주체가 올바르지 않습니다' using errcode = '22023';
  end if;
  select * into doc from consent_documents d
    where d.scope = 'recipient' and d.document_type = consent_type and d.document_version = p_document_version;
  if not found then
    raise exception '서버에 등록되지 않은 동의 문서 버전입니다' using errcode = '22023';
  end if;
  if subject_role <> expected_recipient_consent_subject(cid, consent_type) then
    raise exception '동의 유형과 주체가 일치하지 않습니다' using errcode = '22023';
  end if;
  insert into consents(child_id, guardian_id, type, doc_version)
  values (cid, actor, consent_type, p_document_version)
  returning * into created;
  return created;
end $$;

create or replace function revoke_recipient_consent(cid uuid, consent_type text)
returns public.consents
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  revoked public.consents;
begin
  if actor is null then
    raise exception '로그인이 필요합니다' using errcode = '42501';
  end if;
  update consents set revoked_at = now()
    where child_id = cid and guardian_id = actor and type = consent_type and revoked_at is null
    returning * into revoked;
  if not found then
    raise exception '철회할 유효 동의를 찾을 수 없습니다' using errcode = 'P0001';
  end if;
  return revoked;
end $$;

create or replace function record_account_consent(
  consent_type text, p_document_version text, subject_role text
) returns public.account_consent_evidence
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  doc consent_documents;
  created public.account_consent_evidence;
begin
  if actor is null or subject_role <> 'self' then
    raise exception '본인 약관 동의만 기록할 수 있습니다' using errcode = '42501';
  end if;
  select * into doc from consent_documents d
    where d.scope = 'account' and d.document_type = consent_type and d.document_version = p_document_version;
  if not found then
    raise exception '서버에 등록되지 않은 약관 문서 버전입니다' using errcode = '22023';
  end if;
  insert into account_consent_evidence(subject_id, document_type, document_version, document_items, subject_role, accepted_at)
  values (actor, consent_type, p_document_version, doc.document_items, subject_role, now())
  returning * into created;
  return created;
end $$;

-- ── 탈퇴 요청: DB는 authorization/idempotency/audit를, Edge Function은 외부 파기를 담당 ──
create table account_deletion_jobs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid, -- 완료 시 NULL로 소거한다; 재시도 중에만 Auth 삭제 대상 식별에 사용
  status       text not null default 'requested'
                 check (status in ('requested', 'processing', 'partial', 'completed', 'failed')),
  phase        text not null default 'requested',
  attempt_count integer not null default 0 check (attempt_count >= 0),
  lease_id     uuid,
  lease_expires_at timestamptz,
  last_error   text,
  requested_at timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz,
  check ((status <> 'completed') or user_id is null)
);
create unique index account_deletion_jobs_one_active_user
  on account_deletion_jobs(user_id) where user_id is not null and status in ('requested', 'processing', 'partial');
create table account_deletion_audit (
  id         uuid primary key default gen_random_uuid(),
  job_id     uuid not null references account_deletion_jobs(id) on delete cascade,
  phase      text not null,
  outcome    text not null check (outcome in ('started', 'succeeded', 'partial', 'failed')),
  detail     jsonb not null default '{}'::jsonb
               check (jsonb_typeof(detail) = 'object'
                 and (detail - array['owned_children', 'shared_relationships_to_remove']) = '{}'::jsonb),
  created_at timestamptz not null default now()
);

alter table account_deletion_jobs enable row level security;
alter table account_deletion_audit enable row level security;
create policy "read own active deletion jobs" on account_deletion_jobs
  for select using (user_id = auth.uid());
-- No client policy for audit: an Edge Function may retain only non-PII operational detail.

-- 탈퇴가 요청된 세션은 Edge Function의 snapshot과 경합하지 못하게 한다. partial 상태도
-- 재시도를 기다리는 삭제 의사 표시이므로 새 건강정보/공유 파일을 받지 않는다.
create or replace function account_deletion_active() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from account_deletion_jobs
    where user_id = auth.uid() and status in ('requested', 'processing', 'partial')
  )
$$;

drop policy if exists "write records as current guardian" on daily_records;
create policy "write records as current guardian" on daily_records
  for insert with check (
    author_id = auth.uid() and my_role(child_id) in ('owner', 'editor')
    and has_sensitive_consent(child_id) and not account_deletion_active()
  );
drop policy if exists "edit records without author rewrite" on daily_records;
create policy "edit records without author rewrite" on daily_records
  for update using (my_role(child_id) in ('owner', 'editor') and not account_deletion_active())
  with check (my_role(child_id) in ('owner', 'editor') and not account_deletion_active());
drop policy if exists "delete records" on daily_records;
create policy "delete records" on daily_records
  for delete using (my_role(child_id) in ('owner', 'editor') and not account_deletion_active());
drop policy if exists "publish reports as current guardian" on reports;
create policy "publish reports as current guardian" on reports
  for insert with check (
    created_by = auth.uid() and my_role(child_id) in ('owner', 'editor')
    and not account_deletion_active()
  );
drop policy if exists "edit reports without creator rewrite" on reports;
create policy "edit reports without creator rewrite" on reports
  for update using (my_role(child_id) in ('owner', 'editor') and not account_deletion_active())
  with check (my_role(child_id) in ('owner', 'editor') and not account_deletion_active());
drop policy if exists "delete reports" on reports;
create policy "delete reports" on reports
  for delete using (my_role(child_id) in ('owner', 'editor') and not account_deletion_active());
drop policy if exists "share links by owner" on share_links;
create policy "share links by owner" on share_links
  for all using (
    exists (select 1 from reports r where r.id = report_id and my_role(r.child_id) in ('owner', 'editor'))
    and not account_deletion_active()
  ) with check (
    exists (select 1 from reports r where r.id = report_id and my_role(r.child_id) in ('owner', 'editor'))
    and not account_deletion_active()
  );
drop policy if exists "record files write" on storage.objects;
create policy "record files write" on storage.objects for insert
  with check (bucket_id in ('record-files', 'reports')
              and public.my_role((split_part(name, '/', 1))::uuid) in ('owner','editor')
              and public.has_sensitive_consent((split_part(name, '/', 1))::uuid)
              and not public.account_deletion_active());
drop policy if exists "files via record" on record_files;
create policy "files via record" on record_files for all
  using (exists (select 1 from daily_records r where r.id = record_id and my_role(r.child_id) is not null)
         and not account_deletion_active())
  with check (exists (select 1 from daily_records r where r.id = record_id and my_role(r.child_id) in ('owner', 'editor'))
              and not account_deletion_active());
drop policy if exists "record files delete" on storage.objects;
create policy "record files delete" on storage.objects for delete
  using (bucket_id in ('record-files', 'reports')
         and public.my_role((split_part(name, '/', 1))::uuid) in ('owner','editor')
         and not public.account_deletion_active());

create or replace function require_recent_reauthentication() returns void
language plpgsql stable security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
  reauthenticated_at timestamptz;
begin
  if actor is null or claims ->> 'sub' is distinct from actor::text then
    raise exception '최근 재인증이 필요합니다' using errcode = '42501';
  end if;
  begin
    reauthenticated_at := (claims ->> 'reauthenticated_at')::timestamptz;
  exception when others then
    raise exception '최근 재인증이 필요합니다' using errcode = '42501';
  end;
  if reauthenticated_at is null or reauthenticated_at < now() - interval '10 minutes'
     or reauthenticated_at > now() + interval '1 minute' then
    raise exception '최근 재인증이 필요합니다' using errcode = '42501';
  end if;
end $$;

create or replace function request_account_deletion(dry_run boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  existing account_deletion_jobs;
  job account_deletion_jobs;
  owned_children integer;
  shared_children integer;
  record_files integer;
  report_files integer;
begin
  perform require_recent_reauthentication();
  if actor is null then
    raise exception '로그인이 필요합니다' using errcode = '42501';
  end if;

  select count(*) filter (where role = 'owner'), count(*) filter (where role <> 'owner')
    into owned_children, shared_children from guardian_child where guardian_id = actor;
  select count(*) into record_files from record_files rf
    join daily_records dr on dr.id = rf.record_id
    join guardian_child gc on gc.child_id = dr.child_id
    where gc.guardian_id = actor and gc.role = 'owner';
  select count(*) into report_files from reports r
    join guardian_child gc on gc.child_id = r.child_id
    where gc.guardian_id = actor and gc.role = 'owner';

  if dry_run then
    return jsonb_build_object('dry_run', true, 'owned_children', owned_children,
      'shared_relationships_to_remove', shared_children, 'record_files', record_files,
      'report_files', report_files, 'deletion_order', jsonb_build_array('revoke_share_tokens', 'delete_storage', 'delete_auth'));
  end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into existing from account_deletion_jobs
    where user_id = actor and status in ('requested', 'processing', 'partial')
    order by requested_at desc limit 1;
  if found then
    return jsonb_build_object('job_id', existing.id, 'status', existing.status, 'idempotent', true);
  end if;

  insert into account_deletion_jobs(user_id, status, phase)
  values (actor, 'requested', 'requested') returning * into job;
  insert into account_deletion_audit(job_id, phase, outcome, detail)
  values (job.id, 'requested', 'started', jsonb_build_object('owned_children', owned_children, 'shared_relationships_to_remove', shared_children));
  return jsonb_build_object('job_id', job.id, 'status', job.status, 'idempotent', false);
end $$;

create or replace function claim_account_deletion_job(requested_job_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  claimed account_deletion_jobs;
  next_lease uuid := gen_random_uuid();
begin
  perform require_recent_reauthentication();
  update account_deletion_jobs set
    status = 'processing', phase = 'revoke_share_tokens', attempt_count = attempt_count + 1,
    lease_id = next_lease, lease_expires_at = now() + interval '30 minutes', updated_at = now(), last_error = null
  where id = requested_job_id and user_id = actor
    and (status in ('requested', 'partial') or (status = 'processing' and lease_expires_at < now()))
  returning * into claimed;
  if not found then
    raise exception '이미 처리 중이거나 완료된 탈퇴 요청입니다' using errcode = 'P0001';
  end if;
  insert into account_deletion_audit(job_id, phase, outcome)
  values (claimed.id, 'revoke_share_tokens', 'started');
  return jsonb_build_object('job_id', claimed.id, 'lease_id', next_lease, 'status', claimed.status);
end $$;

create or replace function renew_account_deletion_lease(requested_job_id uuid, requested_lease_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update account_deletion_jobs set lease_expires_at = now() + interval '30 minutes', updated_at = now()
  where id = requested_job_id and user_id = auth.uid() and lease_id = requested_lease_id
    and status = 'processing' and lease_expires_at >= now();
  if not found then
    raise exception '탈퇴 작업 lease가 만료되었거나 소유자가 아닙니다' using errcode = 'P0001';
  end if;
end $$;

revoke all on function record_recipient_consent(uuid, text, text, text) from public;
revoke all on function revoke_recipient_consent(uuid, text) from public;
revoke all on function record_account_consent(text, text, text) from public;
revoke all on function request_account_deletion(boolean) from public;
revoke all on function claim_account_deletion_job(uuid) from public;
revoke all on function expected_recipient_consent_subject(uuid, text) from public;
revoke all on function renew_account_deletion_lease(uuid, uuid) from public;
grant execute on function record_recipient_consent(uuid, text, text, text) to authenticated;
grant execute on function revoke_recipient_consent(uuid, text) to authenticated;
grant execute on function record_account_consent(text, text, text) to authenticated;
grant execute on function request_account_deletion(boolean) to authenticated;
grant execute on function claim_account_deletion_job(uuid) to authenticated;
grant execute on function renew_account_deletion_lease(uuid, uuid) to authenticated;

commit;
