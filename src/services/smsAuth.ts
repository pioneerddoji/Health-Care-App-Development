// 휴대폰 문자 인증(6자리 OTP) — 플로우 완성본.
//
// ⚠️ 실제 SMS 발송은 국내 공급자(알리고/NHN Cloud/솔라피 등) 또는 Twilio 계약이
// 필요하다. 현재 sendSms()는 데모 구현으로, 발송 대신 코드를 반환해 화면에
// 표시한다. 실서비스 전환 시 sendSms() 내부만 공급자 API 호출로 교체하고
// demoCode 노출을 제거하면 된다 (호출부 변경 불필요).
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

/** 인증번호 발송 (재요청 시 기존 코드 무효화) */
export const requestOtp = async (phone: string): Promise<OtpRequestResult> => {
  const code = generateCode();
  codes.set(phone, { code, expiresAt: Date.now() + OTP_TTL_MS });
  await sendSms(phone, `[아이케어] 인증번호 ${code} (3분 내 입력)`);
  return { demoCode: code, expiresInSec: OTP_TTL_MS / 1000 };
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
