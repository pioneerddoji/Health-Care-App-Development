// 결제(스토어 구독) 추상화 계층 — RevenueCat 연동 완료(코드 측).
//
// 아키텍처 (docs/07_monetization.md 참조):
//   페이월 UI → 이 파일(purchaseWithStore/restorePurchases) → 스토어 SDK(RevenueCat)
//                                                              → RevenueCat 웹훅
//                                                              → supabase/functions/billing-webhook
//                                                              → subscriptions 테이블(service_role)
//   클라이언트는 subscriptions를 "읽기만" 한다 — 티어의 진실 원천은 항상 서버.
//
// SDK(react-native-purchases)는 네이티브 모듈이라 development build에서만 동작한다
// (Expo Go/웹 불가) → 지연 require + live 모드 게이트로 감싸, 결제를 켜지 않은
// 빌드(demo/hidden)에서는 SDK를 아예 로드하지 않는다. 남은 작업은 계정 측뿐:
// 스토어 상품 등록 + RevenueCat 대시보드 + env 키 주입 (docs/07 §실연동 절차).
import type { PaidTier, BillingPeriod } from '../types';

export type { PaidTier, BillingPeriod };

/**
 * 스토어 상품 ID — Play Console / App Store Connect에 이 ID로 구독 상품을 등록한다.
 * (Play: 티어당 구독 1개 + base plan 월간/연간 2개 구성 권장 — ID는 basePlanId까지 포함)
 * 웹훅(billing-webhook)의 product_id → tier 매핑과 반드시 일치해야 한다.
 */
export const PRODUCT_IDS: Record<PaidTier, Record<BillingPeriod, string>> = {
  standard: { monthly: 'carenote.standard.monthly', yearly: 'carenote.standard.yearly' },
  family: { monthly: 'carenote.family.monthly', yearly: 'carenote.family.yearly' },
};

/** 웹훅과 공유하는 역매핑 규칙 (테스트에서 일관성 검증) — 주기와 무관하게 티어 결정 */
export const productIdToTier = (productId: string): PaidTier | null => {
  for (const [tier, byPeriod] of Object.entries(PRODUCT_IDS) as [PaidTier, Record<BillingPeriod, string>][]) {
    if (Object.values(byPeriod).includes(productId)) return tier;
  }
  return null;
};

/**
 * 페이월 동작 모드:
 *  - 'demo'   데모 체험 — 결제 없이 즉시 티어 전환 (mock 모드 기본값)
 *  - 'hidden' 전환 버튼 숨김 — 비교표만 안내로 표시 (supabase 모드 기본값)
 *             ⚠️ Play 정책: 결제 수단 없이 "구매 가능해 보이는" UI를 노출하면 리젝
 *             사유이므로, 결제 연동 전 운영 빌드는 반드시 이 모드여야 한다.
 *  - 'live'   실결제 — purchaseWithStore()가 스토어 SDK를 호출 (RevenueCat 연동 후)
 */
export type PaywallMode = 'demo' | 'hidden' | 'live';

export const resolvePaywallMode = (repoMode: 'mock' | 'supabase'): PaywallMode => {
  const env = process.env.EXPO_PUBLIC_PAYWALL_MODE;
  if (env === 'demo' || env === 'hidden' || env === 'live') return env;
  // 안전 기본값: 실서버 빌드는 결제 연동을 명시적으로 켜기 전까지 구매 UI를 숨긴다
  return repoMode === 'mock' ? 'demo' : 'hidden';
};

// ── RevenueCat SDK 연동 ─────────────────────────────────────────
// 네이티브 모듈 없는 환경(Expo Go/웹/Node 테스트)에서는 require가 실패하거나
// 호출이 실패한다 → null로 강등해 명확한 안내 오류를 던진다.
/* eslint-disable @typescript-eslint/no-explicit-any */
type PurchasesModule = any;
const loadPurchases = (): PurchasesModule | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('react-native-purchases').default ?? null;
  } catch {
    return null;
  }
};
/* eslint-enable @typescript-eslint/no-explicit-any */

/** RevenueCat 공개(public) SDK 키 — 대시보드 발급 후 EAS Secrets로 주입 */
const rcApiKey = (): string | undefined => {
  let ios = false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ios = require('react-native').Platform.OS === 'ios';
  } catch { /* Node 테스트 환경 — Android 키 기준 */ }
  return ios
    ? process.env.EXPO_PUBLIC_RC_API_KEY_IOS
    : process.env.EXPO_PUBLIC_RC_API_KEY_ANDROID;
};

let configured = false;

/**
 * 결제 세션 초기화 — 로그인 직후/세션 복원 직후 호출한다 (AppContext).
 * live 모드 + API 키 + 네이티브 SDK가 모두 갖춰졌을 때만 동작하고,
 * 그 외에는 조용히 no-op (demo/hidden 빌드는 SDK를 로드하지 않는다).
 * userId(supabase uid)가 웹훅의 app_user_id가 된다 — billing-webhook과의 연결 고리.
 */
export const initBilling = async (
  repoMode: 'mock' | 'supabase', userId: string,
): Promise<void> => {
  if (resolvePaywallMode(repoMode) !== 'live') return;
  const apiKey = rcApiKey();
  if (!apiKey) return;
  const Purchases = loadPurchases();
  if (!Purchases) return;
  if (!configured) {
    Purchases.configure({ apiKey });
    configured = true;
  }
  await Purchases.logIn(userId).catch(() => {});
};

/** 로그아웃 시 결제 세션 정리 — 익명 상태 오류는 무시 */
export const endBillingSession = async (): Promise<void> => {
  if (!configured) return;
  const Purchases = loadPurchases();
  await Purchases?.logOut().catch(() => {});
};

const NOT_READY_MSG =
  '스토어 결제를 사용할 수 없습니다. 결제는 정식 빌드에서 제공되며, '
  + '연동 절차는 docs/07_monetization.md §실연동 절차를 참조하세요.';

// Google Play 구독은 "상품ID:basePlanId" 형식으로 내려올 수 있다
// (예: carenote.standard:monthly) → 마지막 구분자를 유연하게 대조
const matchesProduct = (identifier: string, productId: string): boolean =>
  identifier === productId || identifier === productId.replace(/\.(\w+)$/, ':$1');

/**
 * 스토어 결제 실행. 구매 성공 → RevenueCat 웹훅 → billing-webhook →
 * subscriptions 갱신 → 앱은 loadAll()로 새 티어를 읽는다 (티어를 직접 쓰지 않음).
 *
 * 얼리버드 할인 (docs/07 §가격 전략): Play Console base plan은 정가로 두고
 * 개발자 지정 오퍼로 -₩1,000을 구성한다. 어떤 Offering을 노출할지는 RevenueCat
 * 대시보드의 Targeting(가입일 기준)으로 서버에서 결정 — 앱 코드는 current
 * offering만 읽으므로 얼리버드 전환에 앱 업데이트가 필요 없다.
 */
export const purchaseWithStore = async (tier: PaidTier, period: BillingPeriod): Promise<void> => {
  const Purchases = loadPurchases();
  if (!Purchases || !configured) throw new Error(NOT_READY_MSG);
  const productId = PRODUCT_IDS[tier][period];
  const offerings = await Purchases.getOfferings();
  const pkg = offerings.current?.availablePackages
    .find((p: { product: { identifier: string } }) => matchesProduct(p.product.identifier, productId));
  if (!pkg) throw new Error('상품 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
  try {
    await Purchases.purchasePackage(pkg);
  } catch (e) {
    // 사용자가 결제 시트를 닫은 경우는 오류가 아니다
    if ((e as { userCancelled?: boolean }).userCancelled) {
      throw new Error('구매가 취소되었습니다.');
    }
    throw e;
  }
};

/** 구매 복원 — iOS 심사 필수 버튼. 웹훅 경유로 subscriptions가 갱신된다. */
export const restorePurchases = async (): Promise<void> => {
  const Purchases = loadPurchases();
  if (!Purchases || !configured) throw new Error(NOT_READY_MSG);
  await Purchases.restorePurchases();
};
