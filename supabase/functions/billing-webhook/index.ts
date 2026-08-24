// P0 unified billing webhook. Provider payloads are normalized then written only through the
// service-role ledger RPC; clients never write subscriptions or the inbox directly.
//
// Deployment deliberately has no product, price, or provider secret values in source:
//   supabase secrets set RC_WEBHOOK_TOKEN=... SANDBOX_WEBHOOK_TOKEN=...
//   supabase functions deploy billing-webhook --no-verify-jwt
// Apple App Store Server Notifications, Google RTDN, and Polar each require a verified provider
// adapter (JWS/OAuth provider signature validation) before being enabled. This handler fails
// closed (503, no DB write) for those sources rather than treating a bearer token as a signature.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type BillingAdmin = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

type Config = { revenuecatToken?: string; sandboxToken?: string };
type NormalizedEvent = {
  provider: 'revenuecat' | 'sandbox';
  id: string;
  userId: string;
  type: 'purchase' | 'renewal' | 'restore' | 'product_change' | 'cancellation' | 'expiration' | 'refund' | 'revoke';
  productId: string | null;
  effectiveAt: string;
  payload: Record<string, unknown>;
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

const revenueCatEventType: Record<string, NormalizedEvent['type']> = {
  INITIAL_PURCHASE: 'purchase', RENEWAL: 'renewal', UNCANCELLATION: 'restore',
  PRODUCT_CHANGE: 'product_change', CANCELLATION: 'cancellation', EXPIRATION: 'expiration',
  REFUND: 'refund', REVOKE: 'revoke',
};

function isoFromMs(value: unknown): string | null {
  return typeof value === 'number' && Number.isFinite(value) ? new Date(value).toISOString() : null;
}

function normalizeRevenueCat(body: Record<string, unknown>): NormalizedEvent | null {
  const event = body.event as Record<string, unknown> | undefined;
  const type = typeof event?.type === 'string' ? revenueCatEventType[event.type] : undefined;
  const id = typeof event?.id === 'string' ? event.id : null;
  const userId = typeof event?.app_user_id === 'string' ? event.app_user_id : null;
  const effectiveAt = isoFromMs(event?.event_timestamp_ms) ?? isoFromMs(event?.expiration_at_ms);
  if (!type || !id || !userId || userId.startsWith('$RCAnonymousID') || !effectiveAt) return null;
  return {
    provider: 'revenuecat', id, userId, type,
    productId: typeof event?.product_id === 'string' ? event.product_id : null,
    effectiveAt,
    payload: {
      expires_at: isoFromMs(event?.expiration_at_ms),
      store: typeof event?.store === 'string' ? event.store.toLowerCase() : null,
      entitlement_id: typeof event?.entitlement_id === 'string' ? event.entitlement_id : null,
    },
  };
}

function normalizeSandbox(body: Record<string, unknown>): NormalizedEvent | null {
  const event = body.event as Record<string, unknown> | undefined;
  const allowed = new Set<NormalizedEvent['type']>(['purchase', 'renewal', 'restore', 'product_change', 'cancellation', 'expiration', 'refund', 'revoke']);
  const type = typeof event?.type === 'string' && allowed.has(event.type as NormalizedEvent['type'])
    ? event.type as NormalizedEvent['type'] : null;
  const id = typeof event?.id === 'string' ? event.id : null;
  const userId = typeof event?.user_id === 'string' ? event.user_id : null;
  const effectiveAt = typeof event?.effective_at === 'string' ? event.effective_at : null;
  if (!type || !id || !userId || !effectiveAt) return null;
  return {
    provider: 'sandbox', id, userId, type,
    productId: typeof event?.product_id === 'string' ? event.product_id : null,
    effectiveAt,
    payload: {
      expires_at: typeof event?.expires_at === 'string' ? event.expires_at : null,
      store: 'sandbox', entitlement_id: typeof event?.entitlement_id === 'string' ? event.entitlement_id : null,
    },
  };
}

export function createBillingWebhookHandler(createAdmin: () => BillingAdmin, config: Config) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
    // Provider identity is selected before reading untrusted JSON, so an unauthenticated request
    // cannot use a malformed body as an authentication oracle. RevenueCat remains the default.
    const requestedProvider = req.headers.get('x-entitlement-provider') ?? 'revenuecat';
    const authorization = req.headers.get('authorization');
    let event: NormalizedEvent | null = null;
    if (requestedProvider === 'revenuecat') {
      if (!config.revenuecatToken || authorization !== `Bearer ${config.revenuecatToken}`) return json({ error: 'unauthorized' }, 401);
      let body: Record<string, unknown>;
      try { body = await req.json(); } catch { return json({ error: 'invalid json' }, 400); }
      event = normalizeRevenueCat(body);
    } else if (requestedProvider === 'sandbox') {
      if (!config.sandboxToken || authorization !== `Bearer ${config.sandboxToken}`) return json({ error: 'unauthorized' }, 401);
      let body: Record<string, unknown>;
      try { body = await req.json(); } catch { return json({ error: 'invalid json' }, 400); }
      event = normalizeSandbox(body);
    } else if (requestedProvider === 'polar' || requestedProvider === 'apple' || requestedProvider === 'google_play') {
      // Do not accept an event until its vendor-specific cryptographic verifier is installed.
      return json({ error: 'provider verifier is not configured' }, 503);
    } else {
      return json({ error: 'unknown provider' }, 400);
    }
    if (!event) return json({ error: 'invalid verified event' }, 400);

    try {
      const { data, error } = await createAdmin().rpc('ingest_entitlement_event', {
        p_provider: event.provider,
        p_provider_event_id: event.id,
        p_user_id: event.userId,
        p_event_type: event.type,
        p_product_id: event.productId,
        p_effective_at: event.effectiveAt,
        p_payload: event.payload,
      });
      if (error) return json({ error: 'ledger unavailable' }, 500);
      return json({ ok: true, result: data });
    } catch {
      return json({ error: 'ledger unavailable' }, 500);
    }
  };
}

if (import.meta.main) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  Deno.serve(createBillingWebhookHandler(
    () => createClient(supabaseUrl, serviceRoleKey),
    { revenuecatToken: Deno.env.get('RC_WEBHOOK_TOKEN'), sandboxToken: Deno.env.get('SANDBOX_WEBHOOK_TOKEN') },
  ));
}
