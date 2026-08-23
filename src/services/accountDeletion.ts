export type DeletionStep = 'storage' | 'database' | 'auth';
export type AccountDeletionResult =
  | { status: 'deleted'; deletedUserId?: string }
  | { status: 'partial'; completed: DeletionStep[]; failed: { step: DeletionStep; message: string }[]; retryable: boolean };

const isStep = (value: unknown): value is DeletionStep =>
  value === 'storage' || value === 'database' || value === 'auth';

export const parseDeletionResponse = (value: unknown): AccountDeletionResult => {
  if (!value || typeof value !== 'object') throw new Error('계정 삭제 서버 응답이 올바르지 않습니다.');
  const data = value as Record<string, unknown>;
  if (data.status === 'deleted') {
    return { status: 'deleted', deletedUserId: typeof data.deletedUserId === 'string' ? data.deletedUserId : undefined };
  }
  if (data.status === 'partial' && Array.isArray(data.completed) && Array.isArray(data.failed)) {
    const completed = data.completed.filter(isStep);
    const failed = data.failed.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const row = item as Record<string, unknown>;
      return isStep(row.step) && typeof row.message === 'string'
        ? [{ step: row.step, message: row.message }] : [];
    });
    if (!failed.length) throw new Error('계정 삭제 부분 실패 응답에 실패 단계가 없습니다.');
    return { status: 'partial', completed, failed, retryable: data.retryable === true };
  }
  throw new Error('계정 삭제 서버 응답이 올바르지 않습니다.');
};

export interface AccountDeletionClient {
  reauthenticate(): Promise<void>;
  invoke(): Promise<unknown>;
  clearSession(): Promise<void>;
}

/** 서버가 완전 삭제를 확정한 경우에만 로컬 세션을 지운다. */
export const runAccountDeletion = async (client: AccountDeletionClient): Promise<AccountDeletionResult> => {
  await client.reauthenticate();
  const result = parseDeletionResponse(await client.invoke());
  if (result.status === 'deleted') await client.clearSession();
  return result;
};
