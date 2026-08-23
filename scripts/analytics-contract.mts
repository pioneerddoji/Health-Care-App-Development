import {
  InMemoryAnalyticsSink,
  aggregateCareMetrics,
  createAnalyticsEvent,
  kstDay,
  type AnalyticsEventInput,
} from '../src/services/analytics';

let pass = 0;
let fail = 0;
const issues: string[] = [];
const ok = (condition: boolean, label: string) => {
  if (condition) pass++;
  else { fail++; issues.push(label); console.log('❌', label); }
};
const rejects = (input: () => unknown, label: string) => {
  try { input(); ok(false, label); } catch { ok(true, label); }
};

const base = (overrides: Partial<AnalyticsEventInput> = {}): AnalyticsEventInput => ({
  eventName: 'record_created',
  eventVersion: 1,
  eventId: 'evt_001',
  occurredAt: '2026-08-01T14:59:59.000Z',
  receivedAt: '2026-08-01T15:00:05.000Z',
  userId: 'usr_001',
  careCircleId: 'cc_001',
  subjectId: 'sub_001',
  episodeId: 'ep_001',
  actorRole: 'owner',
  platform: 'web',
  appVersion: '1.0.0',
  consentAnalytics: true,
  properties: { record_type: 'symptom', input_duration_band: '0_30s' },
  ...overrides,
});

// 계약 허용 경로와 KST 날짜 경계
const record = createAnalyticsEvent(base());
ok(record.event_name === 'record_created' && record.event_version === 1, 'versioned envelope 생성');
ok(kstDay(record.occurred_at) === '2026-08-01', 'KST 자정 직전은 전날로 보고');
ok(kstDay('2026-08-01T15:00:00.000Z') === '2026-08-02', 'KST 자정은 다음 날로 보고');

// 타입 우회·중첩 properties·금지 키/원문/PII 모두 fail-closed
rejects(() => createAnalyticsEvent({ ...base(), properties: { symptom_text: '열이 나요' } } as any), '증상 자유텍스트 거부');
rejects(() => createAnalyticsEvent({ ...base(), properties: { record_type: 'symptom', input_duration_band: '0_30s', diagnosis: '감기' } } as any), '진단명 키 거부');
rejects(() => createAnalyticsEvent({ ...base(), properties: { record_type: 'symptom', input_duration_band: '0_30s', nested: { token: 'secret' } } } as any), '중첩 properties 거부');
rejects(() => createAnalyticsEvent({ ...base(), userId: 'parent@example.com' }), '이메일 식별자 거부');
rejects(() => createAnalyticsEvent({ ...base(), eventName: 'record_created', properties: { medication_name: '해열제' } } as any), '약 이름 키 거부');
rejects(() => createAnalyticsEvent({ ...base(), consentAnalytics: false }), '분석 동의 없는 이벤트 거부');
rejects(() => createAnalyticsEvent({ ...base(), eventName: 'task_completed', properties: { task_type: 'followup', extra: 'x' } } as any), '이벤트별 allowlist 외 속성 거부');
rejects(() => createAnalyticsEvent({ ...base(), eventName: 'circle_created', properties: {} } as any), '필수 최소 속성 누락 거부');

// 동일 event_id는 재시도/새로고침에도 한 번만 저장한다.
const sink = new InMemoryAnalyticsSink();
ok(sink.append(record) === 'stored', '최초 이벤트 저장');
ok(sink.append(record) === 'duplicate', '동일 event_id 중복 제거');
ok(sink.events().length === 1, '중복 집계 0');

const event = (eventName: AnalyticsEventInput['eventName'], eventId: string, occurredAt: string,
  properties: Record<string, string | number | boolean> = {}, episodeId = 'ep_001') =>
  createAnalyticsEvent(base({ eventName, eventId, occurredAt, receivedAt: '2026-08-30T00:00:00.000Z', properties, episodeId }));

// received_at 순서와 무관하게 occurred_at 기준으로 결정론적 WCC/activation/21일 퍼널을 계산한다.
const fixture = new InMemoryAnalyticsSink();
const events = [
  event('circle_created', 'evt_100', '2026-08-01T00:00:00.000Z', { creation_source: 'app' }),
  event('subject_created', 'evt_101', '2026-08-01T00:01:00.000Z', { relationship_band: 'parent' }),
  event('record_created', 'evt_102', '2026-08-01T00:02:00.000Z', { record_type: 'symptom', input_duration_band: '0_30s' }),
  event('record_created', 'evt_102a', '2026-08-01T00:02:30.000Z', { record_type: 'meal', input_duration_band: '0_30s' }),
  event('record_created', 'evt_102b', '2026-08-01T00:02:45.000Z', { record_type: 'sleep', input_duration_band: '0_30s' }),
  event('invite_created', 'evt_103', '2026-08-01T00:03:00.000Z', { invite_role: 'viewer', channel_selected: 'app' }),
  event('invite_accepted', 'evt_104', '2026-08-01T00:04:00.000Z', { time_to_accept_band: '0_1h' }),
  createAnalyticsEvent(base({ eventName: 'record_acknowledged', eventId: 'evt_105', occurredAt: '2026-08-01T00:05:00.000Z', receivedAt: '2026-08-30T00:00:00.000Z', userId: 'usr_002', properties: { record_type: 'symptom' } })),
  event('episode_started', 'evt_106', '2026-08-01T00:06:00.000Z', { episode_type: 'visit', planned_visit_band: '0_7d' }),
  event('briefing_generated', 'evt_107', '2026-08-02T00:00:00.000Z', { source_record_count: 3, latency_band: '0_60s' }),
  event('followup_assigned', 'evt_108', '2026-08-03T00:00:00.000Z', { followup_type: 'task' }),
  event('task_completed', 'evt_109', '2026-08-10T00:00:00.000Z', { task_type: 'followup' }),
  event('episode_completed', 'evt_110', '2026-08-12T00:00:00.000Z', {}, 'ep_001'),
];
for (const item of [...events].reverse()) fixture.append(item);
const metrics = aggregateCareMetrics(fixture.events(), { weekStart: '2026-08-01T00:00:00.000Z' });
ok(metrics.collabActivatedCareCircles === 1, '7일 collab activation 재현');
ok(metrics.weeklyCompletedCareCircles === 1, 'WCC 재현');
ok(metrics.episodeFunnel.started === 1 && metrics.episodeFunnel.completed === 1, '21일 episode 완료 재현');
ok(metrics.episodeFunnel.briefingGenerated === 1 && metrics.episodeFunnel.followupAssigned === 1, 'episode 단계 재현');

console.log(`\n결과: PASS ${pass} / FAIL ${fail}`);
if (issues.length) {
  console.log('특이사항:');
  issues.forEach((issue) => console.log(` - ${issue}`));
  process.exit(1);
}
