// 소셜 로그인 노출 플래그 — billing/smsAuth의 모드 플래그와 같은 패턴.
//
// 모든 공급자는 **Supabase OAuth를 경유**한다. 앱은 공급자 SDK를 직접 붙이지
// 않으므로, 새 공급자를 늘려도 앱 코드는 이 파일의 목록 + 버튼 하나가 전부다.
//
// 실제 동작에는 계정 측 설정이 선행돼야 한다 (docs/09 §2-2-1):
//   1. 공급자 콘솔에서 앱 생성 → Redirect URI 에
//      https://<프로젝트ref>.supabase.co/auth/v1/callback 등록
//   2. Supabase → Authentication → Providers 에 키/시크릿 입력
//   3. Supabase → Authentication → URL Configuration → Redirect URLs 에
//      **우리 앱 주소**(웹 배포 주소 + carenote://) 등록
// 설정 전 운영 빌드에서 버튼이 보이면 눌러도 실패하므로, supabase 모드 기본값은
// off(버튼 숨김) — 설정 완료 후 env 로 켠다.
// mock 모드는 데모 체험용 시뮬레이션이 있어 기본 on.

/** Supabase OAuth 로 붙일 소셜 공급자.
 *  iOS 출시 시 'apple' 추가 필요 — App Store 심사지침 4.8 은 서드파티 소셜
 *  로그인을 제공하는 앱에 Apple 로그인 병행 제공을 요구한다. */
export type SocialProvider = 'kakao' | 'google';

interface ProviderDef {
  /** 버튼 라벨 */
  label: string;
  /** 오류 메시지에 쓰는 짧은 이름 ("카카오 로그인이 취소되었습니다") */
  short: string;
  /** 버튼 배경 / 글자색 — 공급자 브랜드 가이드를 따른다 */
  bg: string;
  fg: string;
}

export const SOCIAL_PROVIDERS: Record<SocialProvider, ProviderDef> = {
  kakao: {
    label: '💬 카카오로 시작하기', short: '카카오',
    bg: '#FEE500', fg: 'rgba(0,0,0,0.87)',   // 카카오 지정 색
  },
  google: {
    label: 'G 구글로 시작하기', short: '구글',
    bg: '#FFFFFF', fg: '#1F1F1F',             // 구글은 흰 버튼 + 테두리
  },
};

/** env 는 빌드 시점에 인라인되므로 process.env[key] 동적 접근이 통하지 않는다.
 *  (Expo/Metro 는 `process.env.EXPO_PUBLIC_*` 를 **정적 문자열로 치환**한다)
 *  그래서 키를 문자열로 돌리지 않고 이렇게 하나씩 적어 둔다. */
const rawFlag = (provider: SocialProvider): string | undefined => {
  switch (provider) {
    case 'kakao': return process.env.EXPO_PUBLIC_KAKAO_LOGIN;
    case 'google': return process.env.EXPO_PUBLIC_GOOGLE_LOGIN;
  }
};

export const resolveSocialLogin = (
  provider: SocialProvider,
  repoMode: 'mock' | 'supabase',
): boolean => {
  const env = rawFlag(provider);
  if (env === 'on') return true;
  if (env === 'off') return false;
  return repoMode === 'mock';
};

/** 화면에 노출할 공급자 목록 (설정된 것만) */
export const enabledSocialProviders = (
  repoMode: 'mock' | 'supabase',
): SocialProvider[] =>
  (Object.keys(SOCIAL_PROVIDERS) as SocialProvider[])
    .filter((p) => resolveSocialLogin(p, repoMode));
