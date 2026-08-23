-- P0 채널 통합 entitlement ledger. 적용 순서:
-- schema.sql → schema_stage3.sql → schema_subscriptions.sql → schema_settings.sql
-- → schema_recipients.sql → schema_security.sql → schema_consent_deletion.sql
-- → schema_stage4_share_security.sql → 이 파일
--
-- 결제 provider의 원문은 inbox에만 기록하고, 앱이 읽는 유일한 권한 원천은
-- subscriptions projection이다. 이 migration은 provider credential/product/가격을 넣지 않는다.

alter table subscriptions drop constraint if exists subscriptions_status_check;
alter table subscriptions add constraint subscriptions_status_check
  check (status in ('active', 'expired', 'canceled', 'revoked'));
alter table subscriptions add column if not exists source_provider text;
alter table subscriptions add column if not exists entitlement_id text;
alter table subscriptions add column if not exists auto_renew boolean;
alter table subscriptions add column if not exists canceled_at timestamptz;
alter table subscriptions add column if not exists last_effective_at timestamptz;
alter table subscriptions add column if not exists last_event_id text;

create table if not exists billing_event_inbox (
  id bigint generated always as identity primary key,
  provider text not null check (provider in ('revenuecat', 'polar', 'apple', 'google_play', 'sandbox')),
  provider_event_id text not null,
  user_id uuid not null,
  event_type text not null check (event_type in ('purchase', 'renewal', 'restore', 'product_change', 'cancellation', 'expiration', 'refund', 'revoke')),
  product_id text,
  effective_at timestamptz not null,
  received_at timestamptz not null default clock_timestamp(),
  payload jsonb not null default '{}'::jsonb,
  processing_state text not null default 'received'
    check (processing_state in ('received', 'applied', 'ignored_stale', 'dead_letter')),
  processing_error text,
  processed_at timestamptz,
  replay_of bigint references billing_event_inbox(id) on delete set null,
  unique (provider, provider_event_id)
);
create index if not exists billing_event_inbox_replay
  on billing_event_inbox(processing_state, received_at)
  where processing_state in ('received', 'dead_letter');
create index if not exists billing_event_inbox_user_effective
  on billing_event_inbox(user_id, effective_at desc);
alter table billing_event_inbox enable row level security;
drop policy if exists "service role ledger access" on billing_event_inbox;
create policy "service role ledger access" on billing_event_inbox
  for all to service_role using (true) with check (true);

-- Product map is intentionally code-controlled rather than provider configuration. Register a new
-- product only in a reviewed migration, then replay the corresponding dead-letter event.
create or replace function entitlement_tier_for_product(p_product_id text)
returns text language sql immutable as $$
  select case p_product_id
    when 'carenote.standard.monthly' then 'standard'
    when 'carenote.standard.yearly' then 'standard'
    when 'carenote.family.monthly' then 'family'
    when 'carenote.family.yearly' then 'family'
    else null
  end
$$;

create or replace function ingest_entitlement_event(
  p_provider text,
  p_provider_event_id text,
  p_user_id uuid,
  p_event_type text,
  p_product_id text,
  p_effective_at timestamptz,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_event billing_event_inbox;
  v_tier text;
  v_existing subscriptions;
  v_expires_at timestamptz;
  v_outcome text;
begin
  if p_provider_event_id is null or length(trim(p_provider_event_id)) = 0 or p_effective_at is null then
    raise exception 'provider event id와 effective_at은 필수입니다' using errcode = '22023';
  end if;

  -- A user without a projection row cannot be protected by SELECT ... FOR UPDATE alone. The
  -- transaction advisory lock serializes first purchase/restore deliveries for that user as well
  -- as normal updates, so a late older delivery always sees the newer effective_at projection.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  insert into billing_event_inbox(provider, provider_event_id, user_id, event_type, product_id, effective_at, payload)
  values (p_provider, p_provider_event_id, p_user_id, p_event_type, p_product_id, p_effective_at, coalesce(p_payload, '{}'::jsonb))
  on conflict (provider, provider_event_id) do nothing
  returning * into v_event;

  if v_event.id is null then
    return jsonb_build_object('outcome', 'duplicate');
  end if;

  if not exists (select 1 from auth.users where id = p_user_id) then
    update billing_event_inbox set processing_state = 'dead_letter', processing_error = 'unknown user', processed_at = clock_timestamp()
    where id = v_event.id;
    return jsonb_build_object('outcome', 'dead_letter', 'reason', 'unknown_user');
  end if;

  if p_event_type in ('purchase', 'renewal', 'restore', 'product_change') then
    v_tier := entitlement_tier_for_product(p_product_id);
    if v_tier is null then
      update billing_event_inbox set processing_state = 'dead_letter', processing_error = 'unknown product', processed_at = clock_timestamp()
      where id = v_event.id;
      return jsonb_build_object('outcome', 'dead_letter', 'reason', 'unknown_product');
    end if;
  elsif p_event_type not in ('cancellation', 'expiration', 'refund', 'revoke') then
    update billing_event_inbox set processing_state = 'dead_letter', processing_error = 'unsupported event type', processed_at = clock_timestamp()
    where id = v_event.id;
    return jsonb_build_object('outcome', 'dead_letter', 'reason', 'unsupported_event');
  end if;

  select * into v_existing from subscriptions where user_id = p_user_id for update;
  -- Equal timestamps are ignored too: providers must issue a strictly newer effective_at to
  -- transition a projection, preventing retry ordering from becoming a hidden tie-breaker.
  if v_existing.last_effective_at is not null and p_effective_at <= v_existing.last_effective_at then
    update billing_event_inbox set processing_state = 'ignored_stale', processed_at = clock_timestamp()
    where id = v_event.id;
    return jsonb_build_object('outcome', 'ignored_stale');
  end if;

  v_expires_at := nullif(p_payload ->> 'expires_at', '')::timestamptz;
  if p_event_type in ('purchase', 'renewal', 'restore', 'product_change') then
    insert into subscriptions (user_id, tier, status, store, expires_at, updated_at, source_provider, entitlement_id, auto_renew, canceled_at, last_effective_at, last_event_id)
    values (p_user_id, v_tier, 'active', nullif(p_payload ->> 'store', ''), v_expires_at, clock_timestamp(), p_provider,
            nullif(p_payload ->> 'entitlement_id', ''), true, null, p_effective_at, p_provider_event_id)
    on conflict (user_id) do update set
      tier = excluded.tier, status = 'active', store = excluded.store, expires_at = excluded.expires_at,
      updated_at = excluded.updated_at, source_provider = excluded.source_provider,
      entitlement_id = excluded.entitlement_id, auto_renew = true, canceled_at = null,
      last_effective_at = excluded.last_effective_at, last_event_id = excluded.last_event_id;
  elsif p_event_type = 'cancellation' then
    insert into subscriptions (user_id, tier, status, updated_at, source_provider, auto_renew, canceled_at, last_effective_at, last_event_id)
    values (p_user_id, 'free', 'canceled', clock_timestamp(), p_provider, false, p_effective_at, p_effective_at, p_provider_event_id)
    on conflict (user_id) do update set
      auto_renew = false, canceled_at = p_effective_at, updated_at = clock_timestamp(), source_provider = p_provider,
      last_effective_at = p_effective_at, last_event_id = p_provider_event_id;
  else
    insert into subscriptions (user_id, tier, status, updated_at, source_provider, auto_renew, canceled_at, last_effective_at, last_event_id)
    values (p_user_id, 'free', case when p_event_type in ('refund', 'revoke') then 'revoked' else 'expired' end,
            clock_timestamp(), p_provider, false, null, p_effective_at, p_provider_event_id)
    on conflict (user_id) do update set
      tier = 'free', status = excluded.status, expires_at = null, updated_at = excluded.updated_at,
      source_provider = excluded.source_provider, auto_renew = false, canceled_at = null,
      last_effective_at = excluded.last_effective_at, last_event_id = excluded.last_event_id;
  end if;

  update billing_event_inbox set processing_state = 'applied', processed_at = clock_timestamp()
  where id = v_event.id;
  return jsonb_build_object('outcome', 'applied');
end;
$$;

-- Dead-letter replay is one event at a time and emits a linked, new inbox delivery. Keeping the
-- original idempotency key immutable preserves the failed delivery audit while the synthetic replay
-- gets its own unique key and can be safely retried again after a product-map/provider fix.
create or replace function replay_entitlement_event(p_inbox_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_event billing_event_inbox;
  v_result jsonb;
begin
  select * into v_event from billing_event_inbox where id = p_inbox_id for update;
  if not found then raise exception 'event를 찾을 수 없습니다' using errcode = 'P0002'; end if;
  if v_event.processing_state = 'applied' then return jsonb_build_object('outcome', 'already_applied'); end if;
  v_result := ingest_entitlement_event(
    v_event.provider,
    v_event.provider_event_id || ':replay:' || v_event.id::text,
    v_event.user_id,
    v_event.event_type,
    v_event.product_id,
    v_event.effective_at,
    v_event.payload
  );
  update billing_event_inbox
  set replay_of = p_inbox_id
  where provider = v_event.provider
    and provider_event_id = v_event.provider_event_id || ':replay:' || v_event.id::text;
  return v_result;
end;
$$;

revoke all on table billing_event_inbox from public, anon, authenticated;
revoke all on function ingest_entitlement_event(text, text, uuid, text, text, timestamptz, jsonb) from public;
revoke all on function replay_entitlement_event(bigint) from public;
-- Supabase service_role bypasses RLS in production. The fresh-PG fixture models the explicit
-- table privilege too, so service workers can read the projection they just processed.
grant select on subscriptions to service_role;
grant select on billing_event_inbox to service_role;
grant execute on function ingest_entitlement_event(text, text, uuid, text, text, timestamptz, jsonb) to service_role;
grant execute on function replay_entitlement_event(bigint) to service_role;
