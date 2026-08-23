export type DeletionStep = 'storage' | 'database' | 'auth';
export type ContractResult =
  | { status: 'deleted' }
  | { status: 'partial'; completed: DeletionStep[]; failed: { step: DeletionStep; message: string }[]; retryable: true };

type Bucket = 'record-files' | 'reports';

export interface AccountDeletionService {
  listOwnedChildIds(): Promise<string[]>;
  listAuthoredRecordIds(): Promise<string[]>;
  listAuthoredReportIds(): Promise<string[]>;
  listRecordStoragePaths(recordIds: string[]): Promise<string[]>;
  listReportStoragePaths(reportIds: string[]): Promise<string[]>;
  removeOwnedStorage(bucket: Bucket, childIds: string[]): Promise<void>;
  removeStoragePaths(bucket: Bucket, paths: string[]): Promise<void>;
  deleteRows(table: string, ids: string[], column: string): Promise<void>;
  clearInvitedBy(): Promise<void>;
  countProfileReferences(): Promise<number>;
  deleteAuthUser(): Promise<void>;
}

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

/**
 * Deletion policy: shared recipients remain with their other guardians; the departing
 * guardian's records, reports, and exact Storage objects are erased rather than
 * reassigned. `invited_by` is nullable audit metadata, so it is cleared (never forged).
 * Auth is deleted only after every non-cascading profile FK has been verified at zero.
 */
export const deleteAccountContract = async (service: AccountDeletionService): Promise<ContractResult> => {
  const completed: DeletionStep[] = [];
  try {
    const [ownedChildIds, recordIds, reportIds] = await Promise.all([
      service.listOwnedChildIds(), service.listAuthoredRecordIds(), service.listAuthoredReportIds(),
    ]);
    const [recordPaths, reportPaths] = await Promise.all([
      service.listRecordStoragePaths(recordIds), service.listReportStoragePaths(reportIds),
    ]);
    await service.removeStoragePaths('record-files', recordPaths);
    await service.removeStoragePaths('reports', reportPaths);
    await service.removeOwnedStorage('record-files', ownedChildIds);
    await service.removeOwnedStorage('reports', ownedChildIds);
    completed.push('storage');

    await service.deleteRows('record_files', recordIds, 'record_id');
    await service.deleteRows('daily_records', recordIds, 'id');
    await service.deleteRows('share_links', reportIds, 'report_id');
    await service.deleteRows('reports', reportIds, 'id');
    await service.clearInvitedBy();
    await service.deleteRows('consents', ownedChildIds, 'child_id');
    await service.deleteRows('growth_measurements', ownedChildIds, 'child_id');
    await service.deleteRows('medications', ownedChildIds, 'child_id');
    await service.deleteRows('vaccinations', ownedChildIds, 'child_id');
    await service.deleteRows('checkups', ownedChildIds, 'child_id');
    await service.deleteRows('guardian_child', ownedChildIds, 'child_id');
    await service.deleteRows('children', ownedChildIds, 'id');
    if (await service.countProfileReferences() !== 0) throw new Error('profile foreign-key references remain after cleanup');
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
