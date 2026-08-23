import type { ISODate } from '../types';
import { ageOf } from '../lib/recipient';

export type SensitiveConsentSubject = 'guardian' | 'self' | 'delegated_adult';

/**
 * 서버의 expected_recipient_consent_subject(child_id, 'sensitive_health')와 같은
 * 후보 주체를 계산한다. 서버 RPC가 최종적으로 다시 검증하므로, 날짜 경계가 달라도
 * 잘못된 동의가 기록되지 않고 오류로 끝난다.
 */
export const sensitiveConsentSubject = (
  input: { birthDate: ISODate; isSelf?: boolean },
  on?: ISODate,
): SensitiveConsentSubject => {
  if (ageOf(input.birthDate, on) < 19) return 'guardian';
  return input.isSelf ? 'self' : 'delegated_adult';
};

/** RPC가 실제 동의 행을 반환한 경우에만 Context가 로컬 동의 상태를 바꾼다. */
export const assertSensitiveConsentMutationResult = (result: {
  data: { id: string } | null;
  error: { message: string } | null;
}, action: '철회' | '재동의'): void => {
  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw new Error(`건강정보 동의 ${action} 결과를 확인할 수 없습니다`);
};
