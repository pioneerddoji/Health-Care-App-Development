import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { deleteAccountContract, type AccountDeletionService } from './contract.ts';

const makeService = (failAt?: string) => {
  const calls: string[] = [];
  let authDeleted = false;
  const service: AccountDeletionService = {
    listOwnedChildIds: async () => ['owned-child'],
    listRecordIds: async () => ['record-1'],
    listReportIds: async () => ['report-1'],
    removeStorage: async (bucket, childIds) => { calls.push(`storage:${bucket}:${childIds.join(',')}`); },
    deleteRows: async (table, ids, column) => {
      calls.push(`db:${table}:${column}:${ids.join(',')}`);
      if (table === failAt) throw new Error(`${table}-down`);
    },
    deleteAuthUser: async () => { authDeleted = true; calls.push('auth'); },
  };
  return { service, calls, authDeleted: () => authDeleted };
};

Deno.test('owned child and FK descendants delete in safe order while non-owned shared child is untouched', async () => {
  const state = makeService();
  const result = await deleteAccountContract(state.service);
  assertEquals(result, { status: 'deleted' });
  assertEquals(state.calls, [
    'storage:record-files:owned-child', 'storage:reports:owned-child',
    'db:record_files:record_id:record-1', 'db:daily_records:child_id:owned-child',
    'db:share_links:report_id:report-1', 'db:reports:child_id:owned-child',
    'db:consents:child_id:owned-child', 'db:growth_measurements:child_id:owned-child',
    'db:medications:child_id:owned-child', 'db:vaccinations:child_id:owned-child',
    'db:checkups:child_id:owned-child', 'db:guardian_child:child_id:owned-child',
    'db:children:id:owned-child', 'auth',
  ]);
});

Deno.test('database failure is retryable and never deletes Auth', async () => {
  const state = makeService('reports');
  const result = await deleteAccountContract(state.service);
  assertEquals(result.status, 'partial');
  if (result.status !== 'partial') throw new Error('expected partial deletion result');
  assertEquals(result.failed[0].step, 'database');
  assertEquals(result.retryable, true);
  assertEquals(state.authDeleted(), false);
});
