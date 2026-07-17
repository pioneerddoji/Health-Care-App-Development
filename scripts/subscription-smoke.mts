import { memoryRepo as repo } from '../src/services/memoryRepo';
import { ENTITLEMENTS, PRICING, TIER_META, TIER_ORDER } from '../src/constants/subscription';
import { PRODUCT_IDS, productIdToTier, resolvePaywallMode } from '../src/services/billing';
import { resolveSmsMode } from '../src/services/smsAuth';
import type { PaidTier } from '../src/types';

const childInput = (name: string) => ({
  name, birthDate: '2024-01-01', sex: 'female' as const, isPreterm: false,
  allergies: [], chronicConditions: [], surgeries: [], hospitalizations: [],
});
let pass = 0, fail = 0;
const ok = (c: boolean, l: string) => { c ? pass++ : (fail++, console.log('❌', l)); };

await repo.signIn('demo@kidcare.app', 'pw');
let all = await repo.loadAll();
ok(all.subscription.tier === 'standard', '데모 기본 티어 standard');

// standard: 아이 2명 보유 → 3번째 OK, 4번째 차단
const c3 = await repo.createChild(childInput('셋째'));
ok(!!c3.id, 'standard 3번째 아이 허용');
try { await repo.createChild(childInput('넷째')); ok(false, 'standard 4번째 차단'); }
catch (e) { ok(String(e).includes('3명'), 'standard 4번째 차단 + 한도 메시지'); }

// standard: 공동 보호자 2명까지 (child-1은 이미 1명)
await repo.inviteGuardian('child-1', 'aunt@example.com', 'viewer');
try { await repo.inviteGuardian('child-1', 'uncle@example.com', 'viewer'); ok(false, 'standard 공동보호자 3번째 차단'); }
catch { ok(true, 'standard 공동보호자 2명 한도'); }

// free 강등: 아이 추가/초대 모두 차단
await repo.setSubscriptionTier('free');
try { await repo.createChild(childInput('다섯째')); ok(false, 'free 아이 추가 차단'); }
catch { ok(true, 'free 아이 추가 차단'); }
try { await repo.inviteGuardian('child-2', 'x@example.com', 'viewer'); ok(false, 'free 초대 차단'); }
catch (e) { ok(String(e).includes('스탠다드'), 'free 초대 차단 + 업그레이드 안내'); }

// family: 무제한
await repo.setSubscriptionTier('family');
await repo.createChild(childInput('넷째'));
await repo.createChild(childInput('다섯째'));
ok((await repo.loadAll()).children.length === 5, 'family 아이 무제한');
await repo.inviteGuardian('child-2', 'g1@example.com', 'viewer');
await repo.inviteGuardian('child-2', 'g2@example.com', 'viewer');
await repo.inviteGuardian('child-2', 'g3@example.com', 'viewer');
ok((await repo.listGuardians('child-2')).length === 4, 'family 공동보호자 무제한');

// 엔타이틀먼트 단조성: 상위 티어는 하위 티어보다 좁으면 안 됨
const [f, s, fam] = [ENTITLEMENTS.free, ENTITLEMENTS.standard, ENTITLEMENTS.family];
ok(f.maxChildren <= s.maxChildren && s.maxChildren <= fam.maxChildren, '아이 한도 단조 증가');
ok(f.maxPhotosPerRecord <= s.maxPhotosPerRecord, '사진 한도 단조 증가');
ok(f.dashboardPeriods.every((p) => s.dashboardPeriods.includes(p))
   && s.dashboardPeriods.every((p) => fam.dashboardPeriods.includes(p)), '대시보드 기간 포함 관계');
ok(f.reportPeriods.every((p) => s.reportPeriods.includes(p))
   && s.reportPeriods.every((p) => fam.reportPeriods.includes(p)), '레포트 기간 포함 관계');
ok(f.shareExpiryHours.every((h) => s.shareExpiryHours.includes(h))
   && s.shareExpiryHours.every((h) => fam.shareExpiryHours.includes(h)), '공유 만료 옵션 포함 관계');

// 결제 준비 계층(billing.ts) 일관성 — 티어 × 주기(월간/연간) 4개 상품
const paidTiers = TIER_ORDER.filter((t): t is PaidTier => t !== 'free');
const allProductIds = paidTiers.flatMap((t) => Object.values(PRODUCT_IDS[t]));
ok(allProductIds.length === 4 && new Set(allProductIds).size === 4,
  '상품 ID 4개(티어×주기) 존재·중복 없음');
ok(paidTiers.every((t) =>
  productIdToTier(PRODUCT_IDS[t].monthly) === t && productIdToTier(PRODUCT_IDS[t].yearly) === t),
  '상품 ID ↔ 티어 역매핑 일치(월간·연간)');
ok(productIdToTier('unknown.product') === null, '미지의 상품 ID는 null');
// 안전 기본값: env 미지정 시 실서버 빌드는 구매 UI를 숨긴다(Play 정책), mock은 데모
delete process.env.EXPO_PUBLIC_PAYWALL_MODE;
ok(resolvePaywallMode('supabase') === 'hidden', '기본 페이월 모드(supabase)=hidden');
ok(resolvePaywallMode('mock') === 'demo', '기본 페이월 모드(mock)=demo');
process.env.EXPO_PUBLIC_PAYWALL_MODE = 'live';
ok(resolvePaywallMode('supabase') === 'live', 'env로 live 전환 가능');
delete process.env.EXPO_PUBLIC_PAYWALL_MODE;

// 문자 인증 모드 안전 기본값: SMS 공급자 계약 전 실서버 빌드는 자동 off(이메일 확인만)
delete process.env.EXPO_PUBLIC_SMS_MODE;
ok(resolveSmsMode('supabase') === 'off', '기본 SMS 모드(supabase)=off');
ok(resolveSmsMode('mock') === 'demo', '기본 SMS 모드(mock)=demo');
process.env.EXPO_PUBLIC_SMS_MODE = 'off';
ok(resolveSmsMode('mock') === 'off', 'env로 off 전환 가능(웹 검증용)');
process.env.EXPO_PUBLIC_SMS_MODE = 'live';
ok(resolveSmsMode('supabase') === 'live', 'env로 live 전환 가능(공급자 연동 후)');
delete process.env.EXPO_PUBLIC_SMS_MODE;

// 가격표 일관성: 얼리버드 = 정가 - ₩1,000(월간), 연간 = 월간 ×10 ("2개월 무료")
for (const t of paidTiers) {
  const p = PRICING[t];
  ok(p.monthly.list - p.monthly.early === 1000, `${t}: 월간 얼리버드 할인 = ₩1,000`);
  ok(p.yearly.list === p.monthly.list * 10, `${t}: 연간 정가 = 월간 ×10`);
  ok(p.yearly.early === p.monthly.early * 10, `${t}: 연간 얼리버드 = 월간 ×10`);
  ok(TIER_META[t].priceLabel.replace(/[^\d]/g, '') === String(p.monthly.early),
    `${t}: TIER_META 표시가 = 월간 얼리버드가`);
}

console.log(`\n결과: PASS ${pass} / FAIL ${fail}`);
if (fail) process.exit(1);
