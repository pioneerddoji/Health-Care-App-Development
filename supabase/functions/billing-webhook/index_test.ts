import { createBillingWebhookHandler, type BillingAdmin } from './index.ts';

type Call = { name: string; args: Record<string, unknown> };
const calls: Call[] = [];
const admin: BillingAdmin = {
  rpc: async (name, args) => {
    calls.push({ name, args });
    return { data: { outcome: 'applied' }, error: null };
  },
};

const handler = createBillingWebhookHandler(() => admin, {
  revenuecatToken: 'rc-test-token',
  sandboxToken: 'sandbox-test-token',
});

Deno.test('revenuecat purchase is normalized into the ledger ingest contract', async () => {
  calls.length = 0;
  const response = await handler(new Request('https://fn.example/billing-webhook', {
    method: 'POST',
    headers: { authorization: 'Bearer rc-test-token', 'content-type': 'application/json' },
    body: JSON.stringify({ event: {
      id: 'rc-event-1', type: 'INITIAL_PURCHASE', app_user_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      product_id: 'carenote.standard.monthly', event_timestamp_ms: 1780000000000,
      expiration_at_ms: 1781000000000, store: 'APP_STORE', entitlement_id: 'premium',
    } }),
  }));
  if (response.status !== 200) throw new Error(`expected success, got ${response.status}`);
  if (calls.length !== 1 || calls[0].name !== 'ingest_entitlement_event') throw new Error('ledger RPC was not called');
  if (calls[0].args.p_provider !== 'revenuecat' || calls[0].args.p_event_type !== 'purchase') throw new Error('event was not normalized');
  if (calls[0].args.p_product_id !== 'carenote.standard.monthly') throw new Error('product was lost');
});

Deno.test('sandbox test double requires its isolated token and can submit a refund', async () => {
  calls.length = 0;
  const response = await handler(new Request('https://fn.example/billing-webhook', {
    method: 'POST',
    headers: { authorization: 'Bearer sandbox-test-token', 'content-type': 'application/json', 'x-entitlement-provider': 'sandbox' },
    body: JSON.stringify({ provider: 'sandbox', event: {
      id: 'sandbox-refund-1', user_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', type: 'refund', effective_at: '2026-08-04T00:00:00Z',
    } }),
  }));
  if (response.status !== 200 || calls[0]?.args.p_event_type !== 'refund') throw new Error('sandbox refund was not accepted');
});

Deno.test('unknown credentials and unverified production providers never write the ledger', async () => {
  calls.length = 0;
  const unauthorized = await handler(new Request('https://fn.example/billing-webhook', { method: 'POST' }));
  if (unauthorized.status !== 401 || calls.length !== 0) throw new Error('missing credential reached the ledger');
  const apple = await handler(new Request('https://fn.example/billing-webhook', {
    method: 'POST', headers: { authorization: 'Bearer rc-test-token', 'content-type': 'application/json', 'x-entitlement-provider': 'apple' },
    body: JSON.stringify({ provider: 'apple', event: { id: 'apple-1' } }),
  }));
  if (apple.status !== 503 || calls.length !== 0) throw new Error('unverified Apple event reached the ledger');
});
