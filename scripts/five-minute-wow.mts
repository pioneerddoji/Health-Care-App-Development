import {
  FiveMinuteWowJourney,
  type FiveMinuteWowDependencies,
  type ServerConfirmation,
} from '../src/services/fiveMinuteWow';

let pass = 0;
let fail = 0;
const issues: string[] = [];
const ok = (condition: boolean, label: string) => {
  if (condition) pass++;
  else { fail++; issues.push(label); console.log('❌', label); }
};
const rejects = async (operation: () => Promise<unknown>, label: string) => {
  try { await operation(); ok(false, label); } catch { ok(true, label); }
};

class FakeClock {
  constructor(private current = 0) {}
  now = () => this.current;
  advance = (milliseconds: number) => { this.current += milliseconds; };
}

const confirmed = (circleId: string, id: string): ServerConfirmation => ({ confirmed: true, circleId, id });
const unconfirmed = (circleId: string): ServerConfirmation => ({ confirmed: false, circleId });

const createFixture = (overrides: Partial<FiveMinuteWowDependencies> = {}) => {
  const clock = new FakeClock(1_000);
  let online = true;
  let role: 'owner' | 'editor' | 'viewer' = 'owner';
  let consent = true;
  let inviteResult: ServerConfirmation = confirmed('circle-a', 'invite-1');
  let acceptResult: ServerConfirmation = confirmed('circle-a', 'accept-1');
  let guardianResult: ServerConfirmation = confirmed('circle-a', 'guardian-1');
  let briefingResult: ServerConfirmation = confirmed('circle-a', 'briefing-1');
  let calls = { record: 0, invite: 0, accept: 0, guardian: 0, briefing: 0 };
  const deps: FiveMinuteWowDependencies = {
    clock,
    network: { isOnline: () => online },
    auth: { roleFor: () => role, hasSensitiveConsent: () => consent },
    record: { submit: async () => { calls.record++; return confirmed('circle-a', 'record-1'); } },
    invite: {
      create: async () => { calls.invite++; return inviteResult; },
      accept: async () => { calls.accept++; return acceptResult; },
    },
    guardian: { confirm: async () => { calls.guardian++; return guardianResult; } },
    briefing: { preview: async () => { calls.briefing++; return briefingResult; } },
    ...overrides,
  };
  return {
    clock, deps, calls,
    setOnline: (value: boolean) => { online = value; },
    setRole: (value: typeof role) => { role = value; },
    setConsent: (value: boolean) => { consent = value; },
    setInviteResult: (value: ServerConfirmation) => { inviteResult = value; },
    setAcceptResult: (value: ServerConfirmation) => { acceptResult = value; },
    setGuardianResult: (value: ServerConfirmation) => { guardianResult = value; },
    setBriefingResult: (value: ServerConfirmation) => { briefingResult = value; },
  };
};

// Happy path: first entry → first record → invite/accept → other guardian acknowledgement → briefing preview.
{
  const f = createFixture();
  const journey = new FiveMinuteWowJourney(f.deps, { circleId: 'circle-a', subjectId: 'subject-a' });
  ok(journey.view().tabCount === 4 && journey.view().tabs.join('>') === '홈>기록>설정>레포트', '최초 진입부터 브리핑 미리보기까지 4개 탭 경로 고정');
  await journey.recordFirstObservation(); f.clock.advance(45_000);
  await journey.createInvite(); f.clock.advance(30_000);
  await journey.acceptInvite(); f.clock.advance(20_000);
  await journey.confirmOtherGuardian(); f.clock.advance(15_000);
  await journey.previewBriefing();
  const view = journey.view();
  ok(view.stage === 'briefing_preview' && view.successVisible, '서버 확정 뒤에만 브리핑 성공 표시');
  ok(view.syntheticElapsedMs === 110_000 && view.withinFiveMinutes, 'fixture synthetic elapsed가 5분 이내');
  ok(!JSON.stringify(view).match(/symptom|diagnosis|medication|health/i), '퍼널 상태는 건강 원문·의료판단을 수집하지 않음');
  const resumed = FiveMinuteWowJourney.resume(f.deps, journey.snapshot());
  ok(resumed.view().stage === 'other_guardian_confirmed' && !resumed.view().successVisible && resumed.view().syntheticElapsedMs === 110_000, '재개는 서버 브리핑 재확정 전 성공을 표시하지 않음');
  await resumed.previewBriefing();
  ok(resumed.view().stage === 'briefing_preview' && resumed.view().successVisible, '재개 뒤 서버 브리핑 재확정에서만 성공 표시');
}

// Offline must not call a server mutation; retry remains available and only later confirmation advances.
{
  const f = createFixture();
  const journey = new FiveMinuteWowJourney(f.deps, { circleId: 'circle-a', subjectId: 'subject-a' });
  f.setOnline(false);
  await rejects(() => journey.recordFirstObservation(), 'offline 첫 기록은 fail-closed');
  ok(f.calls.record === 0 && journey.view().stage === 'entry' && journey.view().retryable, 'offline은 서버 호출·성공 표시 없이 재시도 상태');
  f.setOnline(true);
  await journey.recordFirstObservation();
  ok(journey.view().stage === 'first_recorded', '온라인 복구 후 명시 재시도에서만 진행');
}

// Cancellation, expiration, duplicate invite and partial server responses never become a success state.
for (const [label, result] of [
  ['취소', unconfirmed('circle-a')],
  ['만료', { confirmed: false, circleId: 'circle-a', reason: 'expired' }],
  ['중복 초대', { confirmed: false, circleId: 'circle-a', reason: 'duplicate' }],
  ['부분 실패', { confirmed: true, circleId: 'circle-a' }],
] as const) {
  const f = createFixture();
  const journey = new FiveMinuteWowJourney(f.deps, { circleId: 'circle-a', subjectId: 'subject-a' });
  await journey.recordFirstObservation();
  f.setInviteResult(result);
  await rejects(() => journey.createInvite(), `${label} 초대 응답은 성공으로 표시하지 않음`);
  ok(journey.view().stage === 'first_recorded' && !journey.view().successVisible, `${label} 뒤 이전 확정 단계 유지`);
}

// Consent withdrawal, stale role, and a different care circle are checked at each boundary.
{
  const f = createFixture();
  const journey = new FiveMinuteWowJourney(f.deps, { circleId: 'circle-a', subjectId: 'subject-a' });
  f.setConsent(false);
  await rejects(() => journey.recordFirstObservation(), '동의 철회 뒤 기록 차단');
  f.setConsent(true); await journey.recordFirstObservation();
  f.setRole('viewer');
  await rejects(() => journey.createInvite(), 'stale viewer 역할은 초대 차단');
  f.setRole('owner');
  f.setInviteResult(confirmed('circle-b', 'invite-other-circle'));
  await rejects(() => journey.createInvite(), '다른 circle 확정 응답은 차단');
  ok(journey.view().stage === 'first_recorded' && !journey.view().successVisible, '권한/circle 실패 뒤 성공 상태 없음');
}

// Invite acceptance and briefing also require a complete server confirmation; another guardian acknowledgement is explicit.
{
  const f = createFixture();
  const journey = new FiveMinuteWowJourney(f.deps, { circleId: 'circle-a', subjectId: 'subject-a' });
  await journey.recordFirstObservation(); await journey.createInvite();
  f.setAcceptResult(unconfirmed('circle-a'));
  await rejects(() => journey.acceptInvite(), '수락 취소는 공동 확인으로 진행하지 않음');
  f.setAcceptResult(confirmed('circle-a', 'accept-1')); await journey.acceptInvite();
  await rejects(() => journey.previewBriefing(), '다른 보호자 확인 전 브리핑 미리보기 차단');
  await journey.confirmOtherGuardian();
  f.setBriefingResult({ confirmed: true, circleId: 'circle-a' });
  await rejects(() => journey.previewBriefing(), '부분 브리핑 응답은 성공으로 표시하지 않음');
  ok(journey.view().stage === 'other_guardian_confirmed', '부분 브리핑 실패 뒤 직전 단계 보존');
}

// A caller-controlled snapshot must never manufacture the final success state.
{
  const f = createFixture();
  const forged = FiveMinuteWowJourney.resume(f.deps, {
    circleId: 'circle-a', subjectId: 'subject-a', stage: 'briefing_preview', startedAtMs: 1_000,
  });
  ok(forged.view().stage !== 'briefing_preview' && !forged.view().successVisible, '위조된 재개 snapshot은 브리핑 성공을 만들 수 없음');
}

// The other guardian boundary requires its own complete server confirmation and remains retryable on every rejection.
for (const [label, response] of [
  ['취소', unconfirmed('circle-a')],
  ['만료', { confirmed: false, circleId: 'circle-a', reason: 'expired' }],
  ['중복', { confirmed: false, circleId: 'circle-a', reason: 'duplicate' }],
  ['부분', { confirmed: true, circleId: 'circle-a' }],
  ['다른 circle', confirmed('circle-b', 'guardian-other-circle')],
] as const) {
  const f = createFixture();
  let calls = 0;
  const deps = {
    ...f.deps,
    guardian: { confirm: async () => { calls++; return response; } },
  } as FiveMinuteWowDependencies;
  const journey = new FiveMinuteWowJourney(deps, { circleId: 'circle-a', subjectId: 'subject-a' });
  await journey.recordFirstObservation(); await journey.createInvite(); await journey.acceptInvite();
  await rejects(() => journey.confirmOtherGuardian(), `${label} 다른 보호자 응답은 다음 단계로 진행하지 않음`);
  ok(calls === 1 && journey.view().stage === 'invite_accepted' && journey.view().retryable, `${label} 뒤 이전 단계 유지 및 재시도 가능`);
}

{
  const f = createFixture();
  let calls = 0;
  let reject = true;
  const deps = {
    ...f.deps,
    guardian: { confirm: async () => { calls++; if (reject) throw new Error('server unavailable'); return confirmed('circle-a', 'guardian-1'); } },
  } as FiveMinuteWowDependencies;
  const journey = new FiveMinuteWowJourney(deps, { circleId: 'circle-a', subjectId: 'subject-a' });
  await journey.recordFirstObservation(); await journey.createInvite(); await journey.acceptInvite();
  f.setOnline(false);
  await rejects(() => journey.confirmOtherGuardian(), 'offline 다른 보호자 확인은 서버를 호출하지 않음');
  ok(calls === 0 && journey.view().stage === 'invite_accepted' && journey.view().retryable, 'offline 뒤 이전 단계 유지 및 재시도 가능');
  f.setOnline(true);
  await rejects(() => journey.confirmOtherGuardian(), '거절된 다른 보호자 promise는 다음 단계로 진행하지 않음');
  ok(calls === 1 && journey.view().stage === 'invite_accepted' && journey.view().retryable, '거절된 promise 뒤 재시도 가능');
  reject = false;
  await journey.confirmOtherGuardian();
  ok(calls === 2 && journey.view().stage === 'other_guardian_confirmed', '명시 재시도의 완전 서버 확정에서만 다른 보호자 단계 진행');
}

console.log(`\n결과: PASS ${pass} / FAIL ${fail}`);
if (issues.length) {
  console.log('특이사항:');
  issues.forEach((issue) => console.log(` - ${issue}`));
  process.exit(1);
}
