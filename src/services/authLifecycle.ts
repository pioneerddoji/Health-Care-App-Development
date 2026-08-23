import type { Profile } from '../types';

export interface MetadataUser {
  id: string;
  user_metadata?: Record<string, unknown> | null;
}

export const metadataProfile = (user: MetadataUser, email: string): Profile => {
  const meta = user.user_metadata ?? {};
  const text = (key: string): string | undefined =>
    typeof meta[key] === 'string' && (meta[key] as string).trim() ? (meta[key] as string).trim() : undefined;
  return {
    id: user.id,
    name: text('name') ?? email.split('@')[0],
    relationship: text('relationship') ?? '보호자',
    phone: text('phone'),
  };
};

export interface RecoveryCompletionClient {
  updatePassword(password: string): Promise<void>;
  signOut(): Promise<void>;
}

/** update와 signOut 중 어느 오류도 숨기지 않는다. */
export const completeRecoveryWithClient = async (
  client: RecoveryCompletionClient, newPassword: string,
): Promise<void> => {
  await client.updatePassword(newPassword);
  await client.signOut();
};

export type RecoveryLinkOutcome =
  | { status: 'ignored' }
  | { status: 'ready' }
  | { status: 'error'; message: string };

export interface RecoveryLinkClient {
  setSession(tokens: { access_token: string; refresh_token: string }): Promise<void>;
  notifyRecovery(): void;
}

const paramsOf = (url: string): URLSearchParams => {
  const hash = url.includes('#') ? url.slice(url.indexOf('#') + 1) : '';
  const query = url.includes('?') ? url.slice(url.indexOf('?') + 1).split('#')[0] : '';
  return new URLSearchParams([query, hash].filter(Boolean).join('&'));
};

export const processRecoveryUrl = async (
  client: RecoveryLinkClient, url: string,
): Promise<RecoveryLinkOutcome> => {
  const params = paramsOf(url);
  const isRecovery = params.get('type') === 'recovery';
  if (!isRecovery) return { status: 'ignored' };
  const linkError = params.get('error_description') ?? params.get('error');
  if (linkError) {
    const decoded = linkError.replace(/\+/g, ' ');
    const expired = /expired|invalid/i.test(decoded);
    return { status: 'error', message: expired
      ? '비밀번호 재설정 링크가 만료되었거나 유효하지 않습니다. 새 링크를 요청해 주세요.'
      : `비밀번호 재설정 링크를 확인할 수 없습니다: ${decoded}` };
  }
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  if (!access_token || !refresh_token) {
    return { status: 'error', message: '비밀번호 재설정 링크가 올바르지 않습니다. 새 링크를 요청해 주세요.' };
  }
  try {
    await client.setSession({ access_token, refresh_token });
    client.notifyRecovery();
    return { status: 'ready' };
  } catch (error) {
    return { status: 'error', message: `비밀번호 재설정 세션을 열 수 없습니다: ${error instanceof Error ? error.message : String(error)}` };
  }
};
