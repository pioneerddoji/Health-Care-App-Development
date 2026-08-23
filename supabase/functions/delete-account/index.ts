// Full-account deletion contract. Deploy separately; never expose the service-role key to the app.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
type Step = 'storage' | 'database' | 'auth';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const authorization = request.headers.get('Authorization');
  if (!authorization) return json({ error: 'unauthorized' }, 401);
  const body = await request.json().catch(() => null) as { confirmation?: string } | null;
  if (body?.confirmation !== 'delete-my-account') return json({ error: 'confirmation_required' }, 400);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
  });
  const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: userData, error: userError } = await anon.auth.getUser();
  if (userError || !userData.user) return json({ error: 'unauthorized' }, 401);
  const userId = userData.user.id;
  const completed: Step[] = [];
  const failed: { step: Step; message: string }[] = [];

  // Only owner recipients are removed. Shared recipients owned by someone else remain,
  // while this user's guardian links disappear via FK cascade when auth is deleted.
  const { data: owned, error: ownedError } = await service.from('guardian_child')
    .select('child_id').eq('guardian_id', userId).eq('role', 'owner');
  if (ownedError) failed.push({ step: 'database', message: ownedError.message });

  const collectFiles = async (bucket: string, prefix: string): Promise<string[]> => {
    const pending = [prefix], files: string[] = [];
    while (pending.length) {
      const dir = pending.pop()!;
      const { data, error } = await service.storage.from(bucket).list(dir, { limit: 1000 });
      if (error) throw error;
      for (const item of data ?? []) {
        const path = `${dir}/${item.name}`;
        if (item.id === null) pending.push(path); else files.push(path);
      }
    }
    return files;
  };

  try {
    for (const { child_id } of owned ?? []) {
      for (const bucket of ['record-files', 'reports']) {
        const files = await collectFiles(bucket, child_id);
        if (files.length) {
          const { error } = await service.storage.from(bucket).remove(files);
          if (error) throw error;
        }
      }
    }
    completed.push('storage');
  } catch (error) {
    failed.push({ step: 'storage', message: error instanceof Error ? error.message : String(error) });
  }

  // Do not delete Auth if storage/database discovery failed: the authenticated session is
  // retained so the same idempotent request can safely retry and finish cleanup.
  if (!failed.length) {
    const { error } = await service.auth.admin.deleteUser(userId);
    if (error) failed.push({ step: 'auth', message: error.message });
    else completed.push('database', 'auth');
  }

  if (failed.length) return json({ status: 'partial', completed, failed, retryable: true }, 207);
  return json({ status: 'deleted', deletedUserId: userId });
});
