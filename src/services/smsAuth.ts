// 휴대폰 문자 인증(6자리 OTP) — 플로우 완성본.
//
// ⚠️ 실제 SMS 발송은 국내 공급자(알리고/NHN Cloud/솔라피 등) 또는 Twilio 계약이
// 필요하다. 현재 sendSms()는 데모 구현으로, 발송 대신 코드를 반환해 화면에
// 표시한다. 실서비스 전환 시 sendSms() 내부만 공급자 API 호출로 교체하고
// 'live' 모드로 전환하면 된다 (호출부 변경 불필요).
//
// ⚠️ 이 모듈의 OTP 생성·검증은 앱 안에서 일어난다(데모 전용 설계). 'live' 전환
// 시에는 발송뿐 아니라 검증도 서버(Edge Function)로 옮겨야 한다 — 클라이언트
// 검증은 우회 가능하고 요청 횟수 제한도 걸 수 없다. docs/09 §3 참조.

/**
 * 문자 인증 동작 모드:
 *  - 'demo' 실발송 없이 인증번호를 화면에 표시 (mock 모드 기본값)
 *  - 'off'  문자 인증 단계를 건너뜀 — 가입은 이메일 확인만으로 완료
 *           (supabase 모드 기본값 = 1차 출시안. SMS 공급자 계약 전 안전 기본값)
 *  - 'live' 실제 SMS 발송 (공급자 연동 + 서버측 검증 이전 후 사용)
 */
export type SmsMode = 'demo' | 'off' | 'live';

export const resolveSmsMode = (repoMode: 'mock' | 'supabase'): SmsMode => {
  const env = process.env.EXPO_PUBLIC_SMS_MODE;
  if (env === 'demo' || env === 'off' || env === 'live') return env;
  return repoMode === 'mock' ? 'demo' : 'off';
};

const codes = new Map<string, { code: string; expiresAt: number }>();
const OTP_TTL_MS = 3 * 60 * 1000; // 3분

const generateCode = (): string =>
  String(Math.floor(100000 + Math.random() * 900000));

const sendSms = async (_phone: string, _text: string): Promise<void> => {
  // TODO(실서비스): SMS 공급자 API 호출로 교체
};

export interface OtpRequestResult {
  /** 데모 전용 — 실서비스에서는 undefined로 바꾸고 문자로만 전달 */
  demoCode?: string;
  expiresInSec: number;
}

/** 인증번호 발송 (재요청 시 기존 코드 무효화) — 'off' 모드에서는 호출하지 않는다 */
export const requestOtp = async (phone: string, mode: SmsMode = 'demo'): Promise<OtpRequestResult> => {
  if (mode === 'off') throw new Error('문자 인증이 꺼진 빌드입니다 (EXPO_PUBLIC_SMS_MODE=off).');
  const code = generateCode();
  codes.set(phone, { code, expiresAt: Date.now() + OTP_TTL_MS });
  await sendSms(phone, `[아이케어] 인증번호 ${code} (3분 내 입력)`);
  return { demoCode: mode === 'demo' ? code : undefined, expiresInSec: OTP_TTL_MS / 1000 };
};

/** 인증번호 확인 — 성공 시 코드 소진 */
export const verifyOtp = (phone: string, input: string): { ok: boolean; reason?: string } => {
  const entry = codes.get(phone);
  if (!entry) return { ok: false, reason: '인증번호를 먼저 요청해 주세요.' };
  if (Date.now() > entry.expiresAt) {
    codes.delete(phone);
    return { ok: false, reason: '인증번호가 만료되었습니다. 다시 요청해 주세요.' };
  }
  if (entry.code !== input.trim()) return { ok: false, reason: '인증번호가 일치하지 않습니다.' };
  codes.delete(phone);
  return { ok: true };
};
