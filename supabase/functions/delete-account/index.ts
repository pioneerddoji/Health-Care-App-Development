// Full-account deletion contract. Deploy separately; never expose the service-role key to the app.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { deleteAccountContract, type AccountDeletionService } from './contract.ts';

const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

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

  const collectFiles = async (bucket: 'record-files' | 'reports', prefix: string): Promise<string[]> => {
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
  const removeStorage: AccountDeletionService['removeStorage'] = async (bucket, childIds) => {
    for (const childId of childIds) {
      const files = await collectFiles(bucket, childId);
      if (files.length) {
        const { error } = await service.storage.from(bucket).remove(files);
        if (error) throw error;
      }
    }
  };
  const idsFor = async (table: string, childIds: string[], column: string): Promise<string[]> => {
    if (!childIds.length) return [];
    const { data, error } = await service.from(table).select('id').in(column, childIds);
    if (error) throw error;
    return (data ?? []).map((row: { id: string }) => row.id);
  };
  const deletionService: AccountDeletionService = {
    listOwnedChildIds: async () => {
      const { data, error } = await service.from('guardian_child').select('child_id')
        .eq('guardian_id', userId).eq('role', 'owner');
      if (error) throw error;
      return (data ?? []).map((row: { child_id: string }) => row.child_id);
    },
    listRecordIds: (childIds) => idsFor('daily_records', childIds, 'child_id'),
    listReportIds: (childIds) => idsFor('reports', childIds, 'child_id'),
    removeStorage,
    deleteRows: async (table, ids, column) => {
      if (!ids.length) return;
      const { error } = await service.from(table).delete().in(column, ids);
      if (error) throw error;
    },
    deleteAuthUser: async () => {
      const { error } = await service.auth.admin.deleteUser(userId);
      if (error) throw error;
    },
  };

  const result = await deleteAccountContract(deletionService);
  if (result.status === 'deleted') return json({ status: 'deleted', deletedUserId: userId });
  return json(result, 207);
});
