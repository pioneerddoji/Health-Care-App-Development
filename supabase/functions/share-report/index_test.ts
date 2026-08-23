import { createShareReportHandler, type ShareReportAdmin } from './index.ts';

type RpcResult = { data: unknown; error: unknown };

type FakeState = {
  rpcResults: RpcResult[];
  signedUrl?: string;
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
  signedCalls: Array<{ path: string; ttl: number }>;
};

const token = 'a'.repeat(64);

function fakeAdmin(state: FakeState): ShareReportAdmin {
  return {
    rpc: async (name, args) => {
      state.rpcCalls.push({ name, args });
      return state.rpcResults.shift() ?? { data: null, error: null };
    },
    storage: {
      from: () => ({
        createSignedUrl: async (path: string, ttl: number) => {
          state.signedCalls.push({ path, ttl });
          return state.signedUrl
            ? { data: { signedUrl: state.signedUrl }, error: null }
            : { data: null, error: { message: 'not found' } };
        },
      }),
    },
  };
}

function handler(state: FakeState) {
  return createShareReportHandler(() => fakeAdmin(state));
}

async function responseFor(result: RpcResult, requestToken = token) {
  const state: FakeState = {
    rpcResults: [result], signedUrl: 'https://storage.example/signed.pdf', rpcCalls: [], signedCalls: [],
  };
  const response = await handler(state)(new Request(`https://fn.example/share-report?token=${requestToken}`));
  return { response, state };
}

Deno.test('tampered token has the uniform minimal response and never calls Supabase', async () => {
  const state: FakeState = { rpcResults: [], rpcCalls: [], signedCalls: [] };
  const response = await handler(state)(new Request('https://fn.example/share-report?token=forged'));
  if (response.status !== 404 || await response.text() !== 'Not found') throw new Error('tampering leaked a distinct response');
  if (state.rpcCalls.length !== 0 || state.signedCalls.length !== 0) throw new Error('tampered token touched backend');
});

for (const [name, result] of [
  ['expired', { data: null, error: null }],
  ['revoked', { data: null, error: { message: 'revoked' } }],
  ['deleted recipient', { data: {}, error: null }],
] as const) {
  Deno.test(`${name} token uses the same minimal response`, async () => {
    const { response, state } = await responseFor(result);
    if (response.status !== 404 || await response.text() !== 'Not found') throw new Error(`${name} was distinguishable`);
    if (state.signedCalls.length !== 0) throw new Error(`${name} issued storage URL`);
  });
}

Deno.test('valid token redirects once to a 300-second signed URL', async () => {
  const { response, state } = await responseFor({ data: { storage_path: 'recipient/report.pdf' }, error: null });
  if (response.status !== 302 || response.headers.get('location') !== 'https://storage.example/signed.pdf') throw new Error('missing redirect');
  if (state.signedCalls.length !== 1 || state.signedCalls[0].ttl !== 300) throw new Error('signed URL TTL is not 300 seconds');
  if (response.headers.get('cache-control') !== 'no-store, max-age=0') throw new Error('cache control missing');
  if (state.rpcCalls[0]?.name !== 'consume_share_link_token') throw new Error('wrong consume RPC');
});

Deno.test('concurrent replay has exactly one redirect and one storage signing call', async () => {
  const state: FakeState = {
    rpcResults: [
      { data: { storage_path: 'recipient/report.pdf' }, error: null },
      { data: null, error: null },
    ],
    signedUrl: 'https://storage.example/signed.pdf', rpcCalls: [], signedCalls: [],
  };
  const invoke = () => handler(state)(new Request(`https://fn.example/share-report?token=${token}`));
  const [first, second] = await Promise.all([invoke(), invoke()]);
  const statuses = [first.status, second.status].sort().join(',');
  if (statuses !== '302,404') throw new Error(`expected one accepted replay, got ${statuses}`);
  if (state.signedCalls.length !== 1) throw new Error('replay signed more than once');
});
