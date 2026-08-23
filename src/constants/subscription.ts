// 구독 3티어 정의 — 게이팅 원칙: 핵심 안전 기능(기록, 차트, 알레르기, 접종 알림,
// PDF 직접 공유, 동의/삭제)은 전 티어 무료. 규모·편의 기능만 티어로 나눈다.
// 서버 강제: 대상자 수(children 트리거), 공동 보호자 수(invite_guardian RPC).
import type { SubscriptionTier } from '../types';

export interface TierEntitlements {
  /** 등록 가능한 대상자 수 — 아이·성인 합산 (Infinity = 무제한) */
  maxChildren: number;
  /** 대상자당 초대 가능한 공동 보호자 수 */
  maxCoGuardians: number;
  /** 기록당 사진 첨부 장수 */
  maxPhotosPerRecord: number;
  /** 대시보드 기간 옵션 (일) */
  dashboardPeriods: number[];
  /** 병원 제출용 레포트 기간 옵션 (일) — 대시보드와 동일 정책 */
  reportPeriods: number[];
  /** 공유 링크 만료 옵션 (시간) */
  shareExpiryHours: number[];
  /** 동시에 활성 상태일 수 있는 공유 링크 수 */
  maxActiveShareLinks: number;
}

export const TIER_ORDER: SubscriptionTier[] = ['free', 'standard', 'family'];

// ── 가격 전략 (2026-07-12 결정, docs/07 §가격 전략 참조) ─────────────
//   정가: 스탠다드 월 ₩2,900 / 패밀리 월 ₩4,900.
//   얼리버드(무료 출시 기간 가입자): 월 ₩1,000 할인 → ₩1,900 / ₩3,900.
//   연간: 월 정가 ×10 ("2개월 무료" ≈ 17% 할인). 얼리버드 연간도 ×10 → 연 ₩10,000 할인.
//   ⚠️ 표시광고법: 취소선 정가는 "실제 판매(될) 가격"이어야 함 — 과금 시작 후
//   얼리버드가 아닌 신규 가입자에게는 반드시 정가를 부과한다(가공 정가 금지).
import type { PaidTier, BillingPeriod } from '../types';

export const PRICING: Record<PaidTier, Record<BillingPeriod, { list: number; early: number }>> = {
  standard: {
    monthly: { list: 2_900, early: 1_900 },
    yearly: { list: 29_000, early: 19_000 },
  },
  family: {
    monthly: { list: 4_900, early: 3_900 },
    yearly: { list: 49_000, early: 39_000 },
  },
};

export const won = (n: number): string => `₩${n.toLocaleString('ko-KR')}`;

export const TIER_META: Record<SubscriptionTier, {
  label: string; emoji: string;
  /** 표시 가격 (월간 얼리버드 적용가) */
  priceLabel: string;
  tagline: string;
}> = {
  free: {
    label: '무료', emoji: '🌱', priceLabel: '₩0',
    tagline: '가족 1명의 기록·그래프·레포트, 핵심 기능 전부',
  },
  standard: {
    label: '스탠다드', emoji: '🌿', priceLabel: `월 ${won(PRICING.standard.monthly.early)}`,
    tagline: '가족 셋까지 + 배우자와 함께 기록',
  },
  family: {
    label: '패밀리', emoji: '🌳', priceLabel: `월 ${won(PRICING.family.monthly.early)}`,
    tagline: '가족·보호자 무제한 + 긴 공유 링크',
  },
};

/** 얼리버드 안내 — 페이월/숨김 모드 공용 문구 */
export const EARLY_BIRD_NOTE =
  '🐦 얼리버드 혜택: 무료 출시 기간에 가입한 회원은 유료 플랜을 월 ₩1,000(연간 ₩10,000) 할인된 가격으로 이용할 수 있어요.';

/** 연간 결제 안내 */
export const YEARLY_NOTE = '연간 결제는 월간 12개월 대비 2개월 무료(약 17% 할인)예요.';

export const ENTITLEMENTS: Record<SubscriptionTier, TierEntitlements> = {
  free: {
    maxChildren: 1,
    maxCoGuardians: 0,
    maxPhotosPerRecord: 1,
    dashboardPeriods: [7],
    reportPeriods: [7],
    shareExpiryHours: [24],
    maxActiveShareLinks: 1,
  },
  standard: {
    maxChildren: 3,
    maxCoGuardians: 2,
    maxPhotosPerRecord: 3,
    dashboardPeriods: [7, 14],
    reportPeriods: [7, 14],
    shareExpiryHours: [24, 72],
    maxActiveShareLinks: 5,
  },
  family: {
    maxChildren: Infinity,
    maxCoGuardians: Infinity,
    maxPhotosPerRecord: 10,
    dashboardPeriods: [7, 14, 30],
    reportPeriods: [7, 14, 30],
    shareExpiryHours: [24, 72, 24 * 7],
    maxActiveShareLinks: Infinity,
  },
};

/** 페이월 비교표용 행 정의 */
export const FEATURE_ROWS: { label: string; value: (e: TierEntitlements) => string }[] = [
  { label: '대상자 등록', value: (e) => (e.maxChildren === Infinity ? '무제한' : `${e.maxChildren}명`) },
  { label: '공동 보호자 초대', value: (e) => (e.maxCoGuardians === Infinity ? '무제한' : e.maxCoGuardians === 0 ? '—' : `대상자당 ${e.maxCoGuardians}명`) },
  { label: '기록당 사진', value: (e) => `${e.maxPhotosPerRecord}장` },
  { label: '대시보드 기간', value: (e) => e.dashboardPeriods.map((d) => `${d}일`).join('/') },
  { label: '레포트 기간', value: (e) => e.reportPeriods.map((d) => `${d}일`).join('/') },
  { label: '공유 링크 만료', value: (e) => e.shareExpiryHours.map((h) => (h >= 24 * 7 ? '7일' : `${h}시간`)).join('/') },
  { label: '활성 공유 링크', value: (e) => (e.maxActiveShareLinks === Infinity ? '무제한' : `${e.maxActiveShareLinks}개`) },
];

/** 전 티어 공통(과금 게이트 없음) — 페이월에 명시해 신뢰 확보 */
export const ALWAYS_FREE = [
  '일자별 건강 기록 무제한', '체온·수면·식사·배변 그래프', '성장 그래프',
  'PDF 레포트 생성·직접 공유', '예방접종/검진 예정일 알림', '데이터 삭제·동의 관리',
];
