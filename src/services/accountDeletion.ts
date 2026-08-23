export type DeletionStep = 'storage' | 'database' | 'auth';
const ACCOUNT_DELETION_CONTRACT_VERSION = 1;
export type AccountDeletionResult =
  | { status: 'completed'; jobId: string }
  | { status: 'partial' | 'processing'; jobId: string; failed: { step: DeletionStep; message: string }[]; retryable: true };

const isStep = (value: unknown): value is DeletionStep =>
  value === 'storage' || value === 'database' || value === 'auth';

export const parseDeletionResponse = (value: unknown): AccountDeletionResult => {
  if (!value || typeof value !== 'object') throw new Error('계정 삭제 서버 응답이 올바르지 않습니다.');
  const data = value as Record<string, unknown>;
  if (data.contract_version !== ACCOUNT_DELETION_CONTRACT_VERSION) {
    throw new Error('지원하지 않는 계정 삭제 서버 계약입니다. 앱을 업데이트한 뒤 다시 시도해 주세요.');
  }
  if (data.status === 'completed' && typeof data.job_id === 'string') {
    return { status: 'completed', jobId: data.job_id };
  }
  if ((data.status === 'partial' || data.status === 'processing')
    && typeof data.job_id === 'string' && data.retryable === true) {
    const phase = typeof data.phase === 'string' ? data.phase : 'retry_required';
    const step: DeletionStep = phase === 'delete_storage' ? 'storage'
      : phase === 'delete_auth' ? 'auth' : 'database';
    return { status: data.status, jobId: data.job_id, failed: [{ step, message: phase }], retryable: true };
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
  if (result.status === 'completed') await client.clearSession();
  return result;
};
