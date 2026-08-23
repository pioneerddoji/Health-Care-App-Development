// 트랙 A: 저장소 계층 E2E — 전체 기능 워크플로우 × 5 사이클
// 각 사이클: 아이 생성 → 기록 5종 → 집계 검증 → 성장/접종/검진 → 레포트 발행
//   → 공유 링크 생성/목록/회수 → 보호자 초대/역할변경/해제 → 동의 철회/차단/재동의
//   → 완전 삭제 → 베이스라인 복귀 불변식
import { memoryRepo as repo } from '../src/services/memoryRepo';
import {
  inPeriod, aggregateTemperature, aggregateSleep, aggregateMeals,
  aggregateExcretion, symptomTimeline, summarizePeriod,
} from '../src/services/records';
import { buildReportHtml } from '../src/services/reportHtml';
import { today, daysAgo } from '../src/lib/date';
import { consentPlanFor, showsChildFeatures } from '../src/lib/recipient';
import { recordTypesFor } from '../src/constants/recordTypes';
import {
  completeRecoveryWithClient, metadataProfile, processRecoveryUrl, reauthenticateSocialPreservingSession,
} from '../src/services/authLifecycle';
import {
  parseDeletionResponse, runAccountDeletion,
} from '../src/services/accountDeletion';
import { socialAuthFailureMessage } from '../src/services/socialAuth';
import { deletionSubmitDisabled, focusAccessibilityError, recoverySubmitDisabled } from '../src/services/authUxState';

let pass = 0, fail = 0;
const issues: string[] = [];
const ok = (cond: boolean, label: string, detail?: string) => {
  if (cond) { pass++; }
  else { fail++; issues.push(`${label}${detail ? ` — ${detail}` : ''}`); console.log('  ❌', label, detail ?? ''); }
};

await repo.signIn('demo@kidcare.app', 'password123');
const base = await repo.loadAll();
const baseline = {
  children: base.children.length,
  records: base.records.length,
  vacc: base.vaccinations.length,
  checkups: base.checkups.length,
  links: (await Promise.all(base.children.map((c) => repo.listShareLinks(c.id)))).flat().length,
};
console.log('baseline:', JSON.stringify(baseline));

for (let cycle = 1; cycle <= 5; cycle++) {
  console.log(`\n== Cycle ${cycle} ==`);

  // 1) 아이 생성
  const child = await repo.createChild({
    name: `사이클${cycle}`, birthDate: '2021-03-15', sex: cycle % 2 ? 'female' : 'male',
    isPreterm: false, allergies: ['우유'], chronicConditions: [],
    surgeries: [], hospitalizations: [],
  });
  const guardians0 = await repo.listGuardians(child.id);
  ok(guardians0.length === 1 && guardians0[0].role === 'owner' && guardians0[0].isMe,
    `C${cycle} 아이 생성 시 owner 자동 부여`);

  // 2) 기록 5종 (오늘 + 어제)
  const mk = (type: any, payload: any, date = today(), time = '10:00') =>
    repo.createRecord(child.id, { recordDate: date, recordTime: time, type, categories: [], payload, photoUris: [] });
  await mk('symptom', { symptom: '발열', temperatureC: 38.2, severity: 3 });
  await mk('symptom', { symptom: '발열', temperatureC: 37.9, severity: 2 }, daysAgo(1), '20:00');
  await mk('sleep', { sleepStart: '21:00', sleepEnd: '07:00', nightWakings: 1 });
  await mk('meal', { mealType: '점심', amount: '절반', waterMl: 200 });
  await mk('excretion', { kind: '대변', count: 2, stoolForm: '묽음' });
  await mk('medication_dose', { medicationName: '해열제', givenAt: '11:00', doseText: '처방대로' });

  const all1 = await repo.loadAll();
  const mine = all1.records.filter((r) => r.childId === child.id);
  ok(mine.length === 6, `C${cycle} 기록 6건 저장`, `실제 ${mine.length}`);

  // 3) 집계 검증
  const period = inPeriod(mine, daysAgo(6), today());
  const temps = aggregateTemperature(period);
  ok(temps.length === 2 && Math.max(...temps.map((t) => t.value)) === 38.2, `C${cycle} 체온 집계`);
  const sleep = aggregateSleep(period, daysAgo(6), today());
  ok(sleep.find((s) => s.date === today())?.totalHours === 10, `C${cycle} 수면 집계(10h)`);
  const meals = aggregateMeals(period, daysAgo(6), today());
  ok(meals.find((m) => m.date === today())?.waterMl === 200, `C${cycle} 수분 집계`);
  const excr = aggregateExcretion(period, daysAgo(6), today());
  ok(excr.find((e) => e.date === today())?.loose === 2, `C${cycle} 묽은 변 집계`);
  const summary = summarizePeriod(period, daysAgo(6), today());
  ok(summary.feverDayCount === 2 && summary.medicationDoseCount === 1, `C${cycle} 요약 집계`);

  // 4) 접종/검진 + 완료 처리
  const vacc = await repo.addVaccination({ childId: child.id, vaccineName: `백신${cycle}`, doseNo: 1, dueDate: daysAgo(-10) });
  await repo.updateVaccination(vacc.id, { doneDate: today(), adverseReaction: '이상 없음' });
  const all2 = await repo.loadAll();
  ok(all2.vaccinations.find((v) => v.id === vacc.id)?.doneDate === today(), `C${cycle} 접종 완료 처리`);
  await repo.addCheckup({ childId: child.id, checkupName: `검진${cycle}`, dueDate: daysAgo(-30) });

  // 5) 레포트 HTML + 발행 + 공유 링크
  const html = buildReportHtml({
    child, records: mine, growth: [], medications: [], vaccinations: all2.vaccinations,
    periodStart: daysAgo(6), periodEnd: today(),
    questionsForDoctor: [`사이클${cycle} 질문`],
    briefingNote: `사이클${cycle} 진료 전 전달 메모`,
    guardianName: 'e2e',
  });
  ok(html.includes('발열') && html.includes(`사이클${cycle} 질문`)
    && html.includes(`사이클${cycle} 진료 전 전달 메모`) && (html.match(/<svg/g) ?? []).length === 6,
    `C${cycle} 레포트 HTML(그래프 6종)`);
  const report = await repo.publishReport({
    childId: child.id, localPdfUri: 'file:///tmp/fake.pdf',
    periodStart: daysAgo(6), periodEnd: today(), questionsForDoctor: [],
  });
  const link = await repo.createShareLink(report.id, 72);
  ok(!!link.url && new Date(link.expiresAt).getTime() > Date.now(), `C${cycle} 공유 링크 생성`);
  await repo.revokeShareLink(link.id);
  const links1 = await repo.listShareLinks(child.id);
  ok(links1.length === 1 && !!links1[0].revokedAt, `C${cycle} 공유 링크 회수`);

  // 6) 보호자 초대 → 역할 변경 → 해제
  await repo.inviteGuardian(child.id, `helper${cycle}@example.com`, 'viewer');
  let gs = await repo.listGuardians(child.id);
  const invited = gs.find((g) => !g.isMe);
  ok(gs.length === 2 && invited?.role === 'viewer', `C${cycle} 보호자 초대(viewer)`);
  await repo.updateGuardianRole(child.id, invited!.guardianId, 'editor');
  gs = await repo.listGuardians(child.id);
  ok(gs.find((g) => !g.isMe)?.role === 'editor', `C${cycle} 역할 변경(editor)`);
  await repo.removeGuardian(child.id, invited!.guardianId);
  gs = await repo.listGuardians(child.id);
  ok(gs.length === 1, `C${cycle} 보호자 해제`);

  // 7) 동의 철회 → 기록 차단 → 재동의 → 허용
  await repo.revokeSensitiveConsent(child.id);
  let blocked = false;
  try { await mk('note', { note: 'should fail' }); } catch { blocked = true; }
  ok(blocked, `C${cycle} 철회 후 기록 차단`);
  await repo.grantSensitiveConsent(child.id);
  await mk('note', { note: '재동의 후' });
  ok((await repo.loadAll()).records.filter((r) => r.childId === child.id).length === 7,
    `C${cycle} 재동의 후 기록 허용`);

  // 8) 완전 삭제 → 베이스라인 복귀
  await repo.deleteChildAndData(child.id);
  const end = await repo.loadAll();
  const endLinks = (await Promise.all(end.children.map((c) => repo.listShareLinks(c.id)))).flat().length
    + (await repo.listShareLinks(child.id)).length; // 삭제된 아이의 잔존 링크도 카운트
  ok(end.children.length === baseline.children, `C${cycle} 삭제 후 아이 수 복귀`, `실제 ${end.children.length}`);
  ok(end.records.length === baseline.records, `C${cycle} 삭제 후 기록 수 복귀`, `실제 ${end.records.length}`);
  ok(end.vaccinations.length === baseline.vacc, `C${cycle} 삭제 후 접종 복귀`, `실제 ${end.vaccinations.length}`);
  ok(end.checkups.length === baseline.checkups, `C${cycle} 삭제 후 검진 복귀`, `실제 ${end.checkups.length}`);
  ok(endLinks === baseline.links, `C${cycle} 삭제 후 공유링크 잔존 없음`, `잔존 ${endLinks}`);
  ok(!(child.id in end.roles) || end.roles[child.id] === undefined, `C${cycle} 삭제 후 역할 정리`);
}

// ── 사용자별 설정 (saveSettings 병합 저장 / loadAll 반영) ──
const s1 = await repo.saveSettings({ dashboardOrder: ['sleep', 'temp'] });
ok(JSON.stringify(s1.dashboardOrder) === JSON.stringify(['sleep', 'temp']), '설정 저장(dashboardOrder)');
ok(JSON.stringify((await repo.loadAll()).settings.dashboardOrder) === JSON.stringify(['sleep', 'temp']),
  'loadAll에 설정 반영');
const s2 = await repo.saveSettings({});          // 빈 patch — 기존 값 유지(병합 저장)
ok(JSON.stringify(s2.dashboardOrder) === JSON.stringify(['sleep', 'temp']), '병합 저장(기존 키 유지)');

// ── 전연령 확대: 대상자 유형 + 동의 분기 ──
{
  const y = (yearsAgo: number) => {
    const d = new Date(); d.setFullYear(d.getFullYear() - yearsAgo);
    return d.toISOString().slice(0, 10);
  };
  // 동의 근거는 라벨이 아니라 만 나이로 갈린다
  ok(consentPlanFor({ birthDate: y(5), recipientType: 'child' }).basis === 'child_under14',
    '만 5세 → 법정대리인 동의');
  ok(consentPlanFor({ birthDate: y(16), recipientType: 'child' }).basis === 'minor',
    '만 16세 → 미성년 동의');
  ok(consentPlanFor({ birthDate: y(40), recipientType: 'adult', isSelf: true }).basis === 'adult_self',
    '성인 본인 → 본인 동의');
  ok(consentPlanFor({ birthDate: y(70), recipientType: 'adult' }).basis === 'adult_delegated',
    '성인 타인 → 위임 동의');
  // 성인 라벨이라도 만 나이가 미성년이면 미성년 기준이 우선
  ok(consentPlanFor({ birthDate: y(10), recipientType: 'adult', isSelf: true }).basis === 'child_under14',
    '나이가 라벨보다 우선(성인 라벨 + 만 10세)');
  // sensitive_health는 모든 경로에 포함 — RLS 기록 게이트이므로 불변
  ok(([y(5), y(16), y(40), y(70)] as const).every((b) =>
    consentPlanFor({ birthDate: b, recipientType: 'adult', isSelf: true }).types.includes('sensitive_health')),
    '모든 동의 경로에 sensitive_health 포함(RLS 게이트)');

  // 연령 전제 기록 유형(학교/기관)은 성인에게 노출되지 않는다
  ok(recordTypesFor(true).some((t) => t.type === 'school'), '아이: 학교/기관 유형 노출');
  ok(!recordTypesFor(false).some((t) => t.type === 'school'), '성인: 학교/기관 유형 숨김');
  ok(recordTypesFor(false).length === recordTypesFor(true).length - 1, '성인은 소아 전용 1종만 제외');

  // 성인 대상자 등록 → 유형이 보존된다
  const adult = await repo.createChild({
    name: '김아버지', birthDate: y(68), sex: 'male', recipientType: 'adult',
    isPreterm: false, allergies: [], chronicConditions: [], surgeries: [], hospitalizations: [],
  });
  ok(adult.recipientType === 'adult', '성인 대상자 등록 — 유형 보존');
  ok(!showsChildFeatures(adult), '성인 대상자 — 소아 기능 숨김 판정');
  const withAdult = await repo.loadAll();
  ok(withAdult.children.some((c) => c.id === adult.id && c.recipientType === 'adult'),
    '재조회 시에도 성인 유형 유지');
  await repo.deleteChildAndData(adult.id);
}

// ── 앱 이름 변경: 구 데모 이메일 하위호환 ──
// (저장 키 이관은 AsyncStorage가 필요해 Playwright persistence-test에서 검증한다)
{
  const legacy = await repo.signIn('demo@kidcare.app', 'anything');
  ok(!legacy.error, '구 데모 이메일(demo@kidcare.app)로 로그인 가능');
  const legacyAll = await repo.loadAll();
  ok(legacyAll.children.some((c) => c.id === 'child-1'), '구 데모 이메일 → 샘플 로드');
  ok(legacyAll.subscription.tier === 'standard', '구 데모 이메일 → standard 체험 티어');
  const current = await repo.signIn('demo@carenote.app', 'anything');
  ok(!current.error, '새 데모 이메일(demo@carenote.app)로 로그인 가능');
  ok((await repo.loadAll()).children.some((c) => c.id === 'child-1'), '새 데모 이메일 → 샘플 로드');
}

// ── 소셜 로그인 (mock 시뮬레이션) — 계정 전환이라 맨 끝에서 실행 ──
for (const provider of ['kakao', 'google'] as const) {
  const s1 = await repo.signInWithSocial(provider);
  ok(!!s1.profile && s1.isNewUser === true, `${provider} 첫 로그인 = 신규(동의 화면 경유)`);
  const sAll = await repo.loadAll();
  ok(sAll.children.length === 0 && sAll.subscription.tier === 'free',
    `${provider} 신규 계정 = 빈 상태 + free 티어`);
  const s2 = await repo.signInWithSocial(provider);
  ok(s2.isNewUser === false, `${provider} 재로그인 = 기존 계정(동의 생략)`);
}
// 공급자가 다르면 계정도 다르다 — 카카오로 들어갔다가 구글로 들어오면 신규여야 한다
// (같은 데모 계정을 공유하면 "남의 기록이 보이는" 상황을 데모가 못 잡아낸다)
ok((await repo.signInWithSocial('kakao')).isNewUser === true,
  '구글 → 카카오 전환 = 다른 계정(신규)');
ok((await repo.getAccountAuthMethods()).includes('kakao'), '소셜 전용 계정 재인증 방법 감지');
let wrongSocialBlocked = false;
try { await repo.deleteAccount({ socialProvider: 'google' }); } catch { wrongSocialBlocked = true; }
ok(wrongSocialBlocked, '다른 소셜 공급자로 계정 삭제 차단');
await repo.deleteAccount({ socialProvider: 'kakao' });
ok((await repo.restoreSession()) === null, '소셜 전용 계정 삭제 뒤 세션 정리');

// ── P0 공동 확인·담당 및 진료 후 지시 ──
// 기록은 공동 보호자가 확인했음을 남기고, 진료 후 지시는 담당/기한/완료를 추적한다.
// 이 흐름은 의료 판단이나 처방 제안이 아니라 보호자 간 전달 상태만 다룬다.
{
  await repo.signIn('demo@carenote.app', 'anything');
  const all = await repo.loadAll();
  const child = all.children[0];
  const record = all.records.find((r) => r.childId === child.id)!;
  await repo.acknowledgeRecord(record.id);
  const acknowledgements = await repo.listRecordAcknowledgements(child.id);
  ok(acknowledgements.some((a) => a.recordId === record.id && !!a.acknowledgedAt),
    '공동 보호자 기록 확인 상태 저장');

  const assignee = (await repo.listGuardians(child.id)).find((g) => !g.isMe)!;
  const task = await repo.createCareTask({
    childId: child.id,
    recordId: record.id,
    title: '진료 후 안내 확인',
    note: '진료실에서 들은 내용을 보호자끼리 확인해 주세요.',
    assigneeId: assignee.guardianId,
    dueDate: daysAgo(-2),
  });
  const pending = await repo.listCareTasks(child.id);
  ok(pending.some((t) => t.id === task.id && t.assigneeId === assignee.guardianId
    && t.recordId === record.id && !t.completedAt), '담당자·기한이 있는 진료 후 지시 저장');
  await repo.completeCareTask(task.id);
  const completed = await repo.listCareTasks(child.id);
  ok(!!completed.find((t) => t.id === task.id)?.completedAt, '진료 후 지시 완료 추적');
}

// ── 인증 계약 직접 테스트: 외부 SDK 대신 주입 가능한 최소 test double 사용 ──
{
  const profile = metadataProfile({ id: 'u1', user_metadata: {
    name: '메타이름', relationship: '할머니', phone: '01099998888',
  } }, 'fallback@example.com');
  ok(profile.name === '메타이름' && profile.relationship === '할머니'
    && profile.phone === '01099998888', 'metadata → profile 완성 직접 테스트');

  let signedOut = false;
  await completeRecoveryWithClient({
    updatePassword: async () => {}, signOut: async () => { signedOut = true; },
  }, 'Changed123!');
  ok(signedOut, '복구 완료 뒤 세션 signOut 직접 테스트');
  let signOutFailure = '';
  try {
    await completeRecoveryWithClient({
      updatePassword: async () => {}, signOut: async () => { throw new Error('signout-down'); },
    }, 'Changed123!');
  } catch (e) { signOutFailure = e instanceof Error ? e.message : String(e); }
  ok(signOutFailure.includes('signout-down'), '복구 signOut 실패 전파');

  let recoveryEvent = false;
  const recoveryClient = { setSession: async () => {}, notifyRecovery: () => { recoveryEvent = true; } };
  const nativeRecovery = await processRecoveryUrl(
    recoveryClient, 'carenote://#access_token=a&refresh_token=r&type=recovery');
  ok(nativeRecovery.status === 'ready' && recoveryEvent, 'PASSWORD_RECOVERY 네이티브 라우팅');
  const expired = await processRecoveryUrl(recoveryClient,
    'carenote://#error=access_denied&error_description=Email+link+is+invalid+or+has+expired&type=recovery');
  ok(expired.status === 'error' && expired.message.includes('만료'), '만료 recovery 링크 오류 안내');
  const invalid = await processRecoveryUrl(recoveryClient, 'carenote://#type=recovery&access_token=a');
  ok(invalid.status === 'error' && invalid.message.length > 0, '불완전 recovery 링크 오류 안내');

  ok(socialAuthFailureMessage('카카오', { type: 'cancel' }).includes('취소'), '소셜 로그인 취소 안내');
  ok(socialAuthFailureMessage('구글', { errorCode: 'provider_not_enabled' }).includes('설정'),
    '소셜 provider 미설정 안내');
  ok(socialAuthFailureMessage('구글', { errorCode: 'identity_already_exists' }).includes('이미'),
    '소셜 계정 충돌 안내');

  let restored = 0;
  const originalSession = { user: { id: 'original' } };
  for (const outcome of [
    { error: '취소' }, { error: 'provider-down' }, { userId: 'other-user' },
  ]) {
    let rejected = false;
    try {
      await reauthenticateSocialPreservingSession({
        getSession: async () => originalSession,
        beginSocial: async () => outcome,
        restoreSession: async (session) => { if (session === originalSession) restored++; },
      }, 'original');
    } catch { rejected = true; }
    ok(rejected, `소셜 재인증 ${outcome.error ?? '다른 계정'} 실패 시 원래 세션 유지/복원`);
  }
  ok(restored === 3, '소셜 재인증 충돌·취소·실패 모두 원래 세션 복원');

  const deleted = parseDeletionResponse({ contract_version: 1, status: 'completed', job_id: 'u1' });
  ok(deleted.status === 'completed', '계정 삭제 성공 응답 파싱');
  let deletionFailure = '';
  try { parseDeletionResponse({ status: 'wat' }); } catch (e) {
    deletionFailure = e instanceof Error ? e.message : String(e);
  }
  ok(!!deletionFailure, '계정 삭제 잘못된 서버 응답 실패');
  const partial = parseDeletionResponse({ contract_version: 1, status: 'partial', job_id: 'u1', phase: 'delete_auth', retryable: true });
  ok(partial.status === 'partial' && partial.failed[0].step === 'auth', '계정 삭제 부분 실패 보존');
  let invoked = false, cleared = false;
  await runAccountDeletion({
    reauthenticate: async () => {},
    // supabaseRepo의 invoke와 동일하게 Edge Function의 raw body를 넘긴다.
    invoke: async () => { invoked = true; return { contract_version: 1, status: 'completed', job_id: 'u1' }; },
    clearSession: async () => { cleared = true; },
  });
  ok(invoked && cleared, 'Supabase raw completed 응답은 한 번 파싱 후 세션/로컬 cleanup 호출');
  cleared = false;
  const partialRun = await runAccountDeletion({
    reauthenticate: async () => {},
    invoke: async () => ({ contract_version: 1, status: 'partial', job_id: 'u1', phase: 'delete_auth', retryable: true }),
    clearSession: async () => { cleared = true; },
  });
  ok(partialRun.status === 'partial' && !cleared, 'Supabase raw partial 응답은 세션 유지(안전 재시도)');
  const processingRun = await runAccountDeletion({
    reauthenticate: async () => {},
    invoke: async () => ({ contract_version: 1, status: 'processing', job_id: 'u1', phase: 'delete_database', retryable: true }),
    clearSession: async () => { cleared = true; },
  });
  ok(processingRun.status === 'processing' && !cleared, 'Supabase raw processing 응답은 세션 유지');
  ok(recoverySubmitDisabled({ busy: true, password: 'Password1', confirm: 'Password1', error: false, mismatch: false }),
    '복구 busy 상태 중복 제출 차단');
  ok(!recoverySubmitDisabled({ busy: false, password: 'Password1', confirm: 'Password1', error: false, mismatch: false }),
    '복구 유효 입력 제출 허용');
  let focusedError: number | undefined;
  focusAccessibilityError(42, { setAccessibilityFocus: (id) => { focusedError = id; } });
  ok(focusedError === 42, '탈퇴 재인증/부분실패/auth-method 오류의 접근성 오류 포커스 직접 테스트');
  ok(deletionSubmitDisabled({ busy: true, phrase: '탈퇴합니다', methodReady: true }),
    '탈퇴 busy 상태 중복 제출 차단');
  ok(deletionSubmitDisabled({ busy: false, phrase: '다름', methodReady: true }),
    '탈퇴 확인 문구 불일치 제출 차단');
}

// ── P0 인증 라이프사이클: 이메일 확인 뒤에도 가입 프로필이 보존되고,
// 복구 완료는 세션을 정리하며, 계정 삭제는 로컬 민감 데이터를 남기지 않는다 ──
{
  await repo.signOut();
  const signup = await repo.signUp({
    email: 'profile-preserved@example.com', password: 'Password123!',
    name: '프로필보호자', relationship: '아빠', phone: '01012345678',
  });
  ok(signup.profile?.name === '프로필보호자' && signup.profile?.relationship === '아빠'
    && signup.profile?.phone === '01012345678', '가입 프로필 보존');
  await repo.resetPassword('profile-preserved@example.com', '01012345678', 'Changed123!');
  const recovered = await repo.signIn('profile-preserved@example.com', 'Changed123!');
  ok(!recovered.error, '복구 후 새 비밀번호 로그인');
  await repo.deleteAccount({ password: 'Changed123!' });
  ok((await repo.restoreSession()) === null, '계정 삭제 뒤 세션 정리');
  ok((await repo.loadAll()).children.length === 0, '계정 삭제 뒤 로컬 대상자 데이터 정리');
}

console.log(`\n===== 결과: PASS ${pass} / FAIL ${fail} =====`);
if (issues.length) { console.log('특이사항:'); issues.forEach((i) => console.log(' -', i)); process.exit(1); }
