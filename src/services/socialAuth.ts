// 소셜 로그인(카카오) 노출 플래그 — billing/smsAuth의 모드 플래그와 같은 패턴.
//
// 카카오 로그인은 Supabase OAuth(provider: 'kakao')를 경유한다. 실제 동작에는
// 계정 측 설정 2가지가 선행돼야 한다 (docs/09 §2-2):
//   1. Kakao Developers에 앱 생성 → Redirect URI에
//      https://<프로젝트ref>.supabase.co/auth/v1/callback 등록
//   2. Supabase 대시보드 Authentication → Providers → Kakao에
//      REST API 키/Client Secret 입력
// 설정 전 운영 빌드에서 버튼이 보이면 눌러도 실패하므로, supabase 모드 기본값은
// off(버튼 숨김) — 설정 완료 후 EXPO_PUBLIC_KAKAO_LOGIN=on으로 켠다.
// mock 모드는 데모 체험용 시뮬레이션이 있어 기본 on.

export const resolveKakaoLogin = (repoMode: 'mock' | 'supabase'): boolean => {
  const env = process.env.EXPO_PUBLIC_KAKAO_LOGIN;
  if (env === 'on') return true;
  if (env === 'off') return false;
  return repoMode === 'mock';
};
