export type DeletionStep = 'storage' | 'database' | 'auth';
export type ContractResult =
  | { status: 'deleted' }
  | { status: 'partial'; completed: DeletionStep[]; failed: { step: DeletionStep; message: string }[]; retryable: true };

export interface AccountDeletionService {
  listOwnedChildIds(): Promise<string[]>;
  listRecordIds(childIds: string[]): Promise<string[]>;
  listReportIds(childIds: string[]): Promise<string[]>;
  removeStorage(bucket: 'record-files' | 'reports', childIds: string[]): Promise<void>;
  deleteRows(table: string, ids: string[], column: string): Promise<void>;
  deleteAuthUser(): Promise<void>;
}

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

/**
 * The deletion order is deliberate: dependent rows first, then their parent children,
 * and Auth only once all application-data work succeeds. All operations are idempotent
 * so a partial failure can safely retry with the retained authenticated session.
 */
export const deleteAccountContract = async (service: AccountDeletionService): Promise<ContractResult> => {
  const completed: DeletionStep[] = [];
  try {
    const childIds = await service.listOwnedChildIds();
    await service.removeStorage('record-files', childIds);
    await service.removeStorage('reports', childIds);
    completed.push('storage');

    const [recordIds, reportIds] = await Promise.all([
      service.listRecordIds(childIds), service.listReportIds(childIds),
    ]);
    await service.deleteRows('record_files', recordIds, 'record_id');
    await service.deleteRows('daily_records', childIds, 'child_id');
    await service.deleteRows('share_links', reportIds, 'report_id');
    await service.deleteRows('reports', childIds, 'child_id');
    await service.deleteRows('consents', childIds, 'child_id');
    await service.deleteRows('growth_measurements', childIds, 'child_id');
    await service.deleteRows('medications', childIds, 'child_id');
    await service.deleteRows('vaccinations', childIds, 'child_id');
    await service.deleteRows('checkups', childIds, 'child_id');
    await service.deleteRows('guardian_child', childIds, 'child_id');
    await service.deleteRows('children', childIds, 'id');
    completed.push('database');
  } catch (error) {
    return { status: 'partial', completed, failed: [{ step: completed.includes('storage') ? 'database' : 'storage', message: messageOf(error) }], retryable: true };
  }
  try {
    await service.deleteAuthUser();
    return { status: 'deleted' };
  } catch (error) {
    return { status: 'partial', completed, failed: [{ step: 'auth', message: messageOf(error) }], retryable: true };
  }
};
