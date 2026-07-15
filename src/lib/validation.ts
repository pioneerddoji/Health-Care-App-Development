// 입력 검증 유틸 — 화면들이 공통으로 사용

/** 이메일 형식 검증 */
export const isValidEmail = (email: string): boolean =>
  /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email.trim());

/**
 * 비밀번호 규칙: 8자 이상, 영문(대소문자 구분)·숫자·특수문자만 허용(한글/공백 불가),
 * 영문 1자 이상 포함. 통과하면 null, 아니면 안내 문구 반환.
 */
export const passwordError = (pw: string): string | null => {
  if (pw.length < 8) return '비밀번호는 8자 이상이어야 합니다.';
  if (!/^[A-Za-z0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]+$/.test(pw)) {
    return '비밀번호는 영문(대소문자)·숫자·특수문자만 사용할 수 있습니다.';
  }
  if (!/[A-Za-z]/.test(pw)) return '비밀번호에 영문자를 1자 이상 포함해 주세요.';
  return null;
};

/** 숫자만 남기기 (연락처 입력용 — 하이픈 등 제거) */
export const digitsOnly = (s: string): string => s.replace(/\D/g, '');

/** 휴대폰 번호 형식(01로 시작, 10~11자리) */
export const isValidPhone = (phone: string): boolean =>
  /^01\d{8,9}$/.test(digitsOnly(phone));
