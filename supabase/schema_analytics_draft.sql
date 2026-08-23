-- REVIEW-ONLY DRAFT — do not apply to Supabase or production PostgreSQL.
-- This file is deliberately not referenced by schema.sql, CI, or deployment instructions.
-- A privacy/security approval must define the pseudonymization service, analytics consent
-- source, deletion queue, retention scheduler, and isolated analytics role before adoption.

begin;

create table if not exists analytics_events_draft (
  event_id text primary key check (event_id ~ '^evt_[a-z0-9_-]{3,64}$'),
  event_name text not null,
  event_version integer not null check (event_version = 1),
  occurred_at timestamptz not null,
  received_at timestamptz not null,
  user_pseudonym text not null check (user_pseudonym ~ '^usr_[a-z0-9_-]{3,64}$'),
  care_circle_pseudonym text not null check (care_circle_pseudonym ~ '^cc_[a-z0-9_-]{3,64}$'),
  subject_pseudonym text check (subject_pseudonym is null or subject_pseudonym ~ '^sub_[a-z0-9_-]{3,64}$'),
  episode_pseudonym text check (episode_pseudonym is null or episode_pseudonym ~ '^ep_[a-z0-9_-]{3,64}$'),
  payload jsonb not null,
  expires_at timestamptz not null default (now() + interval '30 days')
);

-- Fail closed until an approved isolated analytics role and policy are authored.
alter table analytics_events_draft enable row level security;
revoke all on analytics_events_draft from anon, authenticated;

rollback;
