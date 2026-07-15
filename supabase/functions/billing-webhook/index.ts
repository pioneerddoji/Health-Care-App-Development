// Edge Function: RevenueCat 웹훅 수신 → subscriptions 테이블 갱신.
// 티어의 진실 원천은 subscriptions 테이블이며, 쓰기는 이 함수(service_role)만 한다
// (RLS: 클라이언트는 자기 행 SELECT만 가능 — schema_subscriptions.sql 참조).
//
// 배포:
//   supabase secrets set RC_WEBHOOK_TOKEN=<임의의 긴 랜덤 문자열>
//   supabase functions deploy billing-webhook --no-verify-jwt
//   RevenueCat 대시보드 → Integrations → Webhooks:
//     URL   = {SUPABASE_URL}/functions/v1/billing-webhook
//     Authorization 헤더 = Bearer <위 RC_WEBHOOK_TOKEN>
//
// 전제: 앱이 로그인 직후 Purchases.logIn(<supabase user id>)를 호출해야
// 이벤트의 app_user_id가 auth.users.id와 일치한다 (billing.ts 교체 가이드 참조).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WEBHOOK_TOKEN = Deno.env.get('RC_WEBHOOK_TOKEN');

// src/services/billing.ts의 PRODUCT_IDS와 반드시 일치 (월간/연간 → 같은 티어)
const PRODUCT_TO_TIER: Record<string, 'standard' | 'family'> = {
  'kidcare.standard.monthly': 'standard',
  'kidcare.standard.yearly': 'standard',
  'kidcare.family.monthly': 'family',
  'kidcare.family.yearly': 'family',
};

// RevenueCat 이벤트 타입 → subscriptions.status
// (CANCELLATION은 "자동갱신 해지 예약"일 뿐 만료 전까지 이용 가능 → active 유지,
//  실제 강등은 EXPIRATION에서. my_tier()가 expires_at 지난 행도 free로 강등한다.)
const ACTIVATE = new Set(['INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'PRODUCT_CHANGE']);
const EXPIRE = new Set(['EXPIRATION']);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  // 웹훅 인증 — 토큰 불일치는 즉시 거부
  if (!WEBHOOK_TOKEN || req.headers.get('authorization') !== `Bearer ${WEBHOOK_TOKEN}`) {
    return json({ error: 'unauthorized' }, 401);
  }

  let event: {
    type?: string;
    app_user_id?: string;
    product_id?: string;
    store?: string;
    expiration_at_ms?: number;
  };
  try {
    event = (await req.json())?.event ?? {};
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  const type = event.type ?? '';
  const userId = event.app_user_id ?? '';
  // 익명 ID($RCAnonymousID:...)는 Purchases.logIn 누락 — 매칭 불가이므로 기록만 하고 통과
  if (!userId || userId.startsWith('$RCAnonymousID')) {
    console.warn('billing-webhook: app_user_id가 supabase uid가 아님', { type, userId });
    return json({ ok: true, skipped: 'anonymous app_user_id' });
  }

  if (!ACTIVATE.has(type) && !EXPIRE.has(type)) {
    // CANCELLATION / BILLING_ISSUE / TRANSFER 등: 상태 변경 없음 (로그만)
    return json({ ok: true, skipped: type });
  }

  const tier = PRODUCT_TO_TIER[event.product_id ?? ''];
  if (ACTIVATE.has(type) && !tier) {
    return json({ error: `unknown product_id: ${event.product_id}` }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const row = ACTIVATE.has(type)
    ? {
        user_id: userId,
        tier,
        status: 'active',
        store: event.store?.toLowerCase() === 'app_store' ? 'app_store' : 'play_store',
        expires_at: event.expiration_at_ms ? new Date(event.expiration_at_ms).toISOString() : null,
        updated_at: new Date().toISOString(),
      }
    : {
        user_id: userId,
        status: 'expired',
        updated_at: new Date().toISOString(),
      };

  const { error } = await admin.from('subscriptions').upsert(row, { onConflict: 'user_id' });
  if (error) {
    console.error('billing-webhook upsert 실패', error);
    return json({ error: error.message }, 500); // 5xx → RevenueCat이 재시도
  }
  return json({ ok: true, type, tier: tier ?? null });
});
