-- Traffic-independent share-link audit retention schedule.
--
-- This is deployment configuration, intentionally versioned but NOT applied by CI or this change.
-- Apply only after a separately approved migration in a Supabase project with pg_cron enabled:
--   psql ... -v ON_ERROR_STOP=1 -f supabase/retention_schedule.sql
-- Rollback: SELECT cron.unschedule('share-link-audit-retention-hourly');
--
-- `run_scheduled_share_link_audit_retention` is SECURITY DEFINER and service_role-only.
-- It drains at most 100 batches x 1,000 rows = 100,000 legacy raw rows/hour plus 1,000
-- aggregate rows. New application audit is globally aggregated into exactly four hourly
-- outcome buckets, so admitted audit-row input is <=4/hour and remains below the drain.

create extension if not exists pg_cron;

select cron.unschedule(jobid)
from cron.job
where jobname = 'share-link-audit-retention-hourly';

select cron.schedule(
  'share-link-audit-retention-hourly',
  '0 * * * *',
  $job$select public.run_scheduled_share_link_audit_retention();$job$
);
