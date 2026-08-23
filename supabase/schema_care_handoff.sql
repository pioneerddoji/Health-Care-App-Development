-- P0 공동 확인·담당·진료 후 지시. schema_recipients.sql 뒤에 적용한다.
-- 보호자 간 전달 상태만 저장하며 진단·처방·용량 추천을 다루지 않는다.

create table record_acknowledgements (
  record_id uuid not null references daily_records(id) on delete cascade,
  guardian_id uuid not null references profiles(id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  primary key (record_id, guardian_id)
);

create table care_tasks (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references children(id) on delete cascade,
  record_id uuid references daily_records(id) on delete set null,
  title text not null check (char_length(trim(title)) between 1 and 240),
  note text,
  assignee_id uuid references profiles(id) on delete set null,
  due_date date,
  completed_at timestamptz,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);
create index care_tasks_child_created on care_tasks (child_id, created_at desc);

alter table record_acknowledgements enable row level security;
alter table care_tasks enable row level security;

create policy "read acknowledgements as guardian" on record_acknowledgements for select
  using (exists (select 1 from daily_records r where r.id = record_id and my_role(r.child_id) is not null));
create policy "acknowledge own readable record" on record_acknowledgements for insert
  with check (guardian_id = auth.uid() and exists (
    select 1 from daily_records r where r.id = record_id and my_role(r.child_id) is not null
      and has_sensitive_consent(r.child_id)));

create policy "read care tasks as guardian" on care_tasks for select using (my_role(child_id) is not null);
create policy "create care tasks as editor" on care_tasks for insert
  with check (created_by = auth.uid() and my_role(child_id) in ('owner', 'editor') and has_sensitive_consent(child_id)
    and (assignee_id is null or exists (select 1 from guardian_child g where g.child_id = care_tasks.child_id and g.guardian_id = care_tasks.assignee_id))
    and (record_id is null or exists (select 1 from daily_records r where r.id = care_tasks.record_id and r.child_id = care_tasks.child_id)));
-- RLS decides who may complete. A trigger makes the care-task payload immutable,
-- so an assignee cannot turn a completion endpoint into an assignment/content edit.
create function enforce_care_task_completion() returns trigger
language plpgsql set search_path = public as $fn$
begin
  if new.child_id is distinct from old.child_id
    -- Preserve FK lifecycle semantics without reopening payload edits: PostgreSQL
    -- may null these columns only after the referenced row has been deleted.
    or (new.record_id is distinct from old.record_id and not (
      new.record_id is null and old.record_id is not null
      and not exists (select 1 from daily_records where id = old.record_id)))
    or new.title is distinct from old.title
    or new.note is distinct from old.note
    or (new.assignee_id is distinct from old.assignee_id and not (
      new.assignee_id is null and old.assignee_id is not null
      and not exists (select 1 from profiles where id = old.assignee_id)))
    or new.due_date is distinct from old.due_date
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception 'care task payload is immutable';
  end if;
  -- Referential actions preserve completion state; they are not a second
  -- completion transition and must remain possible after a task is completed.
  if new.completed_at is not distinct from old.completed_at
    and (new.record_id is distinct from old.record_id
      or new.assignee_id is distinct from old.assignee_id) then
    return new;
  end if;
  if old.completed_at is not null or new.completed_at is null then
    raise exception 'care task completion is write-once';
  end if;
  return new;
end $fn$;
create trigger enforce_care_task_completion_before_update
  before update on care_tasks for each row execute function enforce_care_task_completion();

create policy "complete care tasks as assignee or owner" on care_tasks for update
  using (my_role(child_id) = 'owner' or assignee_id = auth.uid())
  with check (my_role(child_id) is not null and has_sensitive_consent(child_id)
    and completed_at is not null);
