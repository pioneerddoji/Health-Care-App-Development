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
    questionsForDoctor: [`사이클${cycle} 질문`], guardianName: 'e2e',
  });
  ok(html.includes('발열') && html.includes(`사이클${cycle} 질문`) && (html.match(/<svg/g) ?? []).length === 6,
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

// ── 카카오 로그인 (mock 시뮬레이션) — 계정 전환이라 맨 끝에서 실행 ──
const k1 = await repo.signInWithKakao();
ok(!!k1.profile && k1.isNewUser === true, '카카오 첫 로그인 = 신규(동의 화면 경유)');
const kAll = await repo.loadAll();
ok(kAll.children.length === 0 && kAll.subscription.tier === 'free',
  '카카오 신규 계정 = 빈 상태 + free 티어');
const k2 = await repo.signInWithKakao();
ok(k2.isNewUser === false, '카카오 재로그인 = 기존 계정(동의 생략)');

console.log(`\n===== 결과: PASS ${pass} / FAIL ${fail} =====`);
if (issues.length) { console.log('특이사항:'); issues.forEach((i) => console.log(' -', i)); process.exit(1); }
