import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { deleteAccountContract, type AccountDeletionService } from './contract.ts';

const makeService = (failAt?: string) => {
  const calls: string[] = [];
  let authDeleted = false;
  let references = 0;
  const service: AccountDeletionService = {
    listOwnedChildIds: async () => ['owned-child'],
    listAuthoredRecordIds: async () => ['owned-record', 'shared-record'],
    listAuthoredReportIds: async () => ['owned-report', 'shared-report'],
    listRecordStoragePaths: async () => ['owned-child/owned-record/a.jpg', 'shared-child/shared-record/b.jpg'],
    listReportStoragePaths: async () => ['owned-child/owned-report.pdf', 'shared-child/shared-report.pdf'],
    removeOwnedStorage: async (bucket, childIds) => { calls.push(`owned-storage:${bucket}:${childIds.join(',')}`); },
    removeStoragePaths: async (bucket, paths) => { calls.push(`authored-storage:${bucket}:${paths.join(',')}`); },
    deleteRows: async (table, ids, column) => {
      calls.push(`db:${table}:${column}:${ids.join(',')}`);
      if (table === failAt) throw new Error(`${table}-down`);
    },
    clearInvitedBy: async () => { calls.push('db:guardian_child:invited_by:null'); },
    countProfileReferences: async () => references,
    deleteAuthUser: async () => { authDeleted = true; calls.push('auth'); },
  };
  return { service, calls, authDeleted: () => authDeleted, setReferences: (value: number) => { references = value; } };
};

Deno.test('deletes only the departing author content from shared recipients and preserves their recipient', async () => {
  const state = makeService();
  const result = await deleteAccountContract(state.service);
  assertEquals(result, { status: 'deleted' });
  assertEquals(state.calls, [
    'authored-storage:record-files:owned-child/owned-record/a.jpg,shared-child/shared-record/b.jpg',
    'authored-storage:reports:owned-child/owned-report.pdf,shared-child/shared-report.pdf',
    'owned-storage:record-files:owned-child', 'owned-storage:reports:owned-child',
    'db:record_files:record_id:owned-record,shared-record',
    'db:daily_records:id:owned-record,shared-record',
    'db:share_links:report_id:owned-report,shared-report',
    'db:reports:id:owned-report,shared-report',
    'db:guardian_child:invited_by:null',
    'db:consents:child_id:owned-child', 'db:growth_measurements:child_id:owned-child',
    'db:medications:child_id:owned-child', 'db:vaccinations:child_id:owned-child',
    'db:checkups:child_id:owned-child', 'db:guardian_child:child_id:owned-child',
    'db:children:id:owned-child', 'auth',
  ]);
});

Deno.test('a database failure retains Auth and the authenticated retry can finish', async () => {
  const failed = makeService('reports');
  const first = await deleteAccountContract(failed.service);
  assertEquals(first.status, 'partial');
  if (first.status !== 'partial') throw new Error('expected partial deletion result');
  assertEquals(first.failed[0].step, 'database');
  assertEquals(first.retryable, true);
  assertEquals(failed.authDeleted(), false);

  const retry = makeService();
  assertEquals(await deleteAccountContract(retry.service), { status: 'deleted' });
  assertEquals(retry.authDeleted(), true);
});

Deno.test('a remaining profile FK reference blocks Auth deletion', async () => {
  const state = makeService();
  state.setReferences(1);
  const result = await deleteAccountContract(state.service);
  assertEquals(result.status, 'partial');
  if (result.status !== 'partial') throw new Error('expected partial deletion result');
  assertEquals(result.failed[0].step, 'database');
  assertEquals(state.authDeleted(), false);
});
