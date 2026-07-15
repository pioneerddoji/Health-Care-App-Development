// 결제(스토어 구독) 추상화 계층 — 결제 SDK 연동 전에 미리 준비해 둔 구조.
//
// 아키텍처 (docs/07_monetization.md 참조):
//   페이월 UI → 이 파일(purchaseWithStore/restorePurchases) → 스토어 SDK(RevenueCat)
//                                                              → RevenueCat 웹훅
//                                                              → supabase/functions/billing-webhook
//                                                              → subscriptions 테이블(service_role)
//   클라이언트는 subscriptions를 "읽기만" 한다 — 티어의 진실 원천은 항상 서버.
//
// 실연동 시 교체 지점은 이 파일의 purchaseWithStore / restorePurchases 두 함수뿐이다.
// (smsAuth.ts의 sendSms()와 같은 패턴)
import type { PaidTier, BillingPeriod } from '../types';

export type { PaidTier, BillingPeriod };

/**
 * 스토어 상품 ID — Play Console / App Store Connect에 이 ID로 구독 상품을 등록한다.
 * (Play: 티어당 구독 1개 + base plan 월간/연간 2개 구성 권장 — ID는 basePlanId까지 포함)
 * 웹훅(billing-webhook)의 product_id → tier 매핑과 반드시 일치해야 한다.
 */
export const PRODUCT_IDS: Record<PaidTier, Record<BillingPeriod, string>> = {
  standard: { monthly: 'kidcare.standard.monthly', yearly: 'kidcare.standard.yearly' },
  family: { monthly: 'kidcare.family.monthly', yearly: 'kidcare.family.yearly' },
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

/**
 * 스토어 결제 실행 — RevenueCat 연동 시 이 함수 내부만 교체한다.
 *
 * 교체 가이드 (react-native-purchases 설치 후 — development build 필요, Expo Go 불가):
 *   1. 앱 시작 시 1회: Purchases.configure({ apiKey: <public key> })
 *   2. 로그인 직후:    Purchases.logIn(<supabase user id>)   ← 웹훅의 app_user_id가 됨
 *   3. 이 함수:
 *        const offerings = await Purchases.getOfferings();
 *        const pkg = offerings.current?.availablePackages
 *          .find((p) => p.product.identifier === PRODUCT_IDS[tier][period]);
 *        if (!pkg) throw new Error('상품 정보를 불러오지 못했습니다.');
 *        await Purchases.purchasePackage(pkg);
 *      구매 성공 → RevenueCat 웹훅 → billing-webhook → subscriptions 갱신
 *      → 앱은 loadAll()로 새 티어를 읽는다 (여기서 티어를 직접 쓰지 않는다).
 *
 * 얼리버드 할인 (docs/07 §가격 전략): Play Console에서 base plan을 정가(₩3,900/₩5,900)로
 * 만들고 "개발자 지정 오퍼(developer determined offer)"로 -₩1,000 얼리버드 오퍼를 추가.
 * RevenueCat Offering을 'default'(정가)/'earlybird'(할인) 둘로 구성하고, 자격
 * (auth.users.created_at < 과금 출시일)을 서버에서 판정해 해당 Offering을 노출한다.
 */
export const purchaseWithStore = async (tier: PaidTier, period: BillingPeriod): Promise<void> => {
  void tier; void period;
  throw new Error(
    '스토어 결제가 아직 연동되지 않았습니다. 연동 절차는 docs/07_monetization.md, '
    + '교체 지점은 src/services/billing.ts의 purchaseWithStore()입니다.',
  );
};

/**
 * 구매 복원 — iOS 심사 필수 버튼. RevenueCat 연동 시:
 *   await Purchases.restorePurchases();  → 웹훅 경유로 subscriptions 갱신
 */
export const restorePurchases = async (): Promise<void> => {
  throw new Error('스토어 결제가 아직 연동되지 않았습니다. (billing.ts restorePurchases 교체)');
};
