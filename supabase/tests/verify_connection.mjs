// 실 Supabase 프로젝트 연결 검증 — 프로젝트 생성 직후 1회 실행하는 스모크.
//
// 사전 조건:
//   1) SQL Editor에서 schema.sql → schema_stage3.sql 실행
//   2) Authentication → Email Provider에서 "Confirm email" 끄기 (검증 후 다시 켜도 됨)
//   3) (선택) supabase functions deploy share-report --no-verify-jwt
//
// 실행 (carenote 디렉터리에서):
//   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_ANON_KEY=eyJ... npm run verify:supabase
//
// 하는 일: 2계정 가입 → 아이/동의/기록 → 사진 업로드+서명URL → RLS 격리 →
//   초대 RPC → 권한 강등 → 레포트+공유링크 → Edge Function 응답 → cascade 삭제.
// 주의: 테스트 계정 2개가 auth.users에 남는다 (대시보드에서 삭제 가능).
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;
if (!URL || !KEY) {
  console.error('SUPABASE_URL / SUPABASE_ANON_KEY 환경변수가 필요합니다.\n예) SUPABASE_URL=https://xxxx.supabase.co SUPABASE_ANON_KEY=eyJ... npm run verify:supabase');
  process.exit(2);
}

let pass = 0, fail = 0;
const ok = (cond, label, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label} ${detail}`); }
};
const newClient = () => createClient(URL, KEY, { auth: { persistSession: false } });

const ts = Date.now();
const emailA = `verify-a-${ts}@example.com`;
const emailB = `verify-b-${ts}@example.com`;
const password = `Verify!${ts}`;

console.log('== 1. 가입/로그인 ==');
const a = newClient();
const b = newClient();
const upA = await a.auth.signUp({ email: emailA, password });
if (upA.error) { console.error('가입 실패:', upA.error.message); process.exit(1); }
if (!upA.data.session) {
  console.error('가입 직후 세션이 없습니다 — Authentication에서 "Confirm email"을 끄고 다시 실행하세요.');
  process.exit(1);
}
const upB = await b.auth.signUp({ email: emailB, password });
ok(!upB.error && !!upB.data.session, 'A/B 계정 가입 + 세션');
const uidA = upA.data.user.id, uidB = upB.data.user.id;

await a.from('profiles').upsert({ id: uidA, name: '검증A', relationship: '엄마' });
await b.from('profiles').upsert({ id: uidB, name: '검증B', relationship: '아빠' });

console.log('== 2. 아이 생성 + 동의 + 기록 ==');
const child = (await a.from('children').insert({
  name: '검증아이', birth_date: '2022-01-01', sex: 'female',
}).select().single()).data;
ok(!!child?.id, '아이 생성');
ok(!(await a.from('guardian_child').insert({ guardian_id: uidA, child_id: child.id, role: 'owner' })).error,
  'owner 부트스트랩');

const preConsent = await a.from('daily_records').insert({
  child_id: child.id, author_id: uidA, record_date: '2026-01-01', type: 'note', payload: {},
});
ok(!!preConsent.error, '동의 전 기록 차단(RLS)', preConsent.error ? '' : '— 차단돼야 함!');

await a.from('consents').insert([
  { child_id: child.id, guardian_id: uidA, type: 'guardian_legal' },
  { child_id: child.id, guardian_id: uidA, type: 'sensitive_health' },
]);
const rec = await a.from('daily_records').insert({
  child_id: child.id, author_id: uidA, record_date: '2026-01-01', record_time: '10:00',
  type: 'symptom', categories: ['infection_symptom'],
  payload: { symptom: '발열', temperatureC: 38.1, severity: 3 },
}).select().single();
ok(!rec.error, '동의 후 기록 허용');

console.log('== 3. Storage 업로드 + 서명 URL ==');
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG 매직만
const photoPath = `${child.id}/${rec.data.id}/verify.png`;
const up = await a.storage.from('record-files').upload(photoPath, png, { contentType: 'image/png' });
ok(!up.error, '사진 업로드 (record-files)', up.error?.message ?? '');
const signed = await a.storage.from('record-files').createSignedUrl(photoPath, 60);
let fetchOk = false;
if (signed.data?.signedUrl) {
  const res = await fetch(signed.data.signedUrl);
  fetchOk = res.ok;
}
ok(fetchOk, '서명 URL로 파일 접근');

console.log('== 4. RLS 격리 + 구독 한도 + 초대 RPC ==');
ok(((await b.from('children').select('id')).data ?? []).length === 0, 'B는 초대 전 아이 안 보임');
const selfJoin = await b.from('guardian_child').insert({ guardian_id: uidB, child_id: child.id, role: 'owner' });
ok(!!selfJoin.error, 'B 임의 참여 차단');

// free 티어: 공동 보호자 초대는 서버(RPC)가 차단해야 정상
const freeInvite = await a.rpc('invite_guardian', { cid: child.id, invitee_email: emailB, invite_role: 'editor' });
ok(!!freeInvite.error, 'free 티어 초대 차단(서버 강제)', freeInvite.error ? '' : '— 차단돼야 함!');

// SERVICE_ROLE 키가 있으면 스토어 웹훅을 시뮬레이션해 standard로 올리고 전체 초대 플로우 검증
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (SERVICE_KEY) {
  const admin = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });
  await admin.from('subscriptions').upsert({ user_id: uidA, tier: 'standard' });
  const invite = await a.rpc('invite_guardian', { cid: child.id, invitee_email: emailB, invite_role: 'editor' });
  ok(!invite.error, '(standard) 초대 RPC(editor)', invite.error?.message ?? '');
  ok(((await b.from('children').select('id')).data ?? []).length === 1, 'B 초대 후 아이 보임');
  ok(!(await b.from('daily_records').insert({
    child_id: child.id, author_id: uidB, record_date: '2026-01-02', type: 'note', payload: {},
  })).error, 'B(editor) 기록 허용');
  const promote = await b.from('guardian_child').update({ role: 'owner' }).eq('guardian_id', uidB).select();
  ok((promote.data ?? []).length === 0, 'B 자기승격 무효');
  await a.from('guardian_child').update({ role: 'viewer' }).eq('guardian_id', uidB).eq('child_id', child.id);
  ok(!!(await b.from('daily_records').insert({
    child_id: child.id, author_id: uidB, record_date: '2026-01-03', type: 'note', payload: {},
  })).error, 'B(viewer) 기록 차단');
} else {
  console.log('  ⚠️ SUPABASE_SERVICE_ROLE_KEY 미설정 — 유료 티어 초대 플로우 생략');
  console.log('     (전체 플로우 검증: SERVICE_ROLE 키를 함께 넘기거나 CI의 rls_test.sql 참조)');
}

console.log('== 5. 레포트 + 공유 링크 + Edge Function ==');
const report = (await a.from('reports').insert({
  child_id: child.id, created_by: uidA, period_start: '2026-01-01', period_end: '2026-01-07',
}).select().single()).data;
const pdfPath = `${child.id}/${report.id}.pdf`;
await a.storage.from('reports').upload(pdfPath, new Uint8Array([0x25, 0x50, 0x44, 0x46]), { contentType: 'application/pdf' });
await a.from('reports').update({ storage_path: pdfPath }).eq('id', report.id);
const issued = (await a.rpc('create_secure_share_link', {
  p_report_id: report.id, p_expires_in_hours: 24,
})).data;
const token = issued?.token;
ok(typeof token === 'string' && /^[0-9a-f]{64}$/.test(token), 'hash-only 공유 링크 생성');
try {
  const fnRes = await fetch(`${URL}/functions/v1/share-report?token=${encodeURIComponent(token)}`, { redirect: 'manual' });
  if (fnRes.status === 302) ok(true, 'Edge Function: 유효 토큰 → 서명 URL 리다이렉트');
  else if (fnRes.status === 404 && (await fnRes.text()).includes('NOT_FOUND')) {
    console.log('  ⚠️ Edge Function 미배포 — supabase functions deploy share-report --no-verify-jwt 후 재실행');
  } else ok(fnRes.status === 302, 'Edge Function 응답', `status=${fnRes.status}`);
} catch (e) { console.log('  ⚠️ Edge Function 호출 실패:', e.message); }

console.log('== 6. 동의 철회 + 완전 삭제 ==');
await a.from('consents').update({ revoked_at: new Date().toISOString() })
  .eq('child_id', child.id).eq('type', 'sensitive_health').is('revoked_at', null);
ok(!!(await a.from('daily_records').insert({
  child_id: child.id, author_id: uidA, record_date: '2026-01-04', type: 'note', payload: {},
})).error, '동의 철회 후 기록 차단');
await a.storage.from('record-files').remove([photoPath]);
await a.storage.from('reports').remove([pdfPath]);
const del = await a.from('children').delete().eq('id', child.id).select();
ok((del.data ?? []).length === 1, 'owner 아이 삭제(cascade)');
ok(((await a.from('daily_records').select('id')).data ?? []).length === 0, '삭제 후 기록 없음');

console.log(`\n===== 결과: PASS ${pass} / FAIL ${fail} =====`);
console.log(`테스트 계정 정리: 대시보드 Authentication에서 ${emailA}, ${emailB} 삭제 가능`);
process.exit(fail > 0 ? 1 : 0);
