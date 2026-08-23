/*
 * 개인정보 최소수집 분석 계약.
 * 이 모듈은 네트워크 SDK를 호출하지 않는다. 허용된 행동 범주·pseudonymous 식별자만
 * 검증한 뒤 내부 sink에 적재하며, 보고 시에는 UTC 원본을 KST로 투영한다.
 */

export const ANALYTICS_EVENT_VERSION = 1 as const;

const EVENT_PROPERTIES = {
  landing_viewed: ['creative_id', 'message_cell', 'utm_source'],
  waitlist_started: ['message_cell'],
  waitlist_verified: ['qualification_band'],
  signup_started: ['auth_method'],
  signup_completed: ['auth_method'],
  consent_presented: ['consent_version', 'purpose_count'],
  consent_changed: ['consent_type', 'new_state'],
  circle_created: ['creation_source'],
  subject_created: ['relationship_band', 'age_band_optional'],
  episode_started: ['episode_type', 'planned_visit_band'],
  record_created: ['record_type', 'input_duration_band'],
  invite_created: ['invite_role', 'channel_selected'],
  invite_accepted: ['time_to_accept_band'],
  record_acknowledged: ['record_type'],
  task_assigned: ['task_type', 'due_band'],
  task_completed: ['task_type'],
  briefing_generated: ['source_record_count', 'latency_band'],
  briefing_edited: ['section_changed', 'edit_distance_band'],
  briefing_exported: ['format'],
  briefing_used_reported: ['report_window', 'answer'],
  followup_assigned: ['followup_type'],
  episode_completed: [],
  episode_cancelled: ['episode_cancelled_reason'],
  permission_viewed: ['entry_point'],
  invite_revoked: ['time_to_effect_ms_band'],
  export_requested: ['scope', 'format'],
  export_completed: ['duration_band', 'record_count_band'],
  deletion_requested: ['scope'],
  deletion_completed: ['duration_band'],
  offer_viewed: ['offer_id', 'price_cell'],
  paid_intent_clicked: ['offer_id', 'price_cell'],
  subscription_started: ['plan', 'offer_id'],
  subscription_cancelled: ['reason_code', 'discount_state'],
  trust_issue_reported: ['severity', 'issue_type'],
} as const;

export type AnalyticsEventName = keyof typeof EVENT_PROPERTIES;
type AnalyticsPropertyValue = string | number | boolean;
export type AnalyticsProperties = Record<string, AnalyticsPropertyValue>;
export type AnalyticsActorRole = 'owner' | 'admin' | 'recorder' | 'viewer';
export type AnalyticsPlatform = 'ios' | 'android' | 'web';

export interface AnalyticsEventInput {
  eventName: AnalyticsEventName;
  eventVersion: typeof ANALYTICS_EVENT_VERSION;
  eventId: string;
  occurredAt: string;
  receivedAt: string;
  userId: string;
  careCircleId: string;
  subjectId?: string;
  episodeId?: string;
  actorRole: AnalyticsActorRole;
  platform: AnalyticsPlatform;
  appVersion: string;
  experimentAssignments?: ReadonlyArray<{ experimentId: string; variantId: string }>;
  consentAnalytics: boolean;
  properties: AnalyticsProperties;
}

export interface AnalyticsEvent {
  event_name: AnalyticsEventName;
  event_version: typeof ANALYTICS_EVENT_VERSION;
  event_id: string;
  occurred_at: string;
  received_at: string;
  user_id: string;
  care_circle_id: string;
  subject_id?: string;
  episode_id?: string;
  actor_role: AnalyticsActorRole;
  platform: AnalyticsPlatform;
  app_version: string;
  experiment_assignments: ReadonlyArray<{ experiment_id: string; variant_id: string }>;
  consent_analytics: true;
  properties: AnalyticsProperties;
}

const ID_PREFIXES = {
  eventId: 'evt_',
  userId: 'usr_',
  careCircleId: 'cc_',
  subjectId: 'sub_',
  episodeId: 'ep_',
} as const;
/** UUIDv4-shaped opaque values are issued before event construction; raw IDs never cross this boundary. */
const SAFE_PSEUDONYM = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SAFE_SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

const fail = (message: string): never => { throw new Error(`Invalid analytics event: ${message}`); };
const timestamp = (value: string, field: string): string => {
  if (typeof value !== 'string') fail(`${field} must be UTC ISO-8601`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || !value.endsWith('Z')) fail(`${field} must be UTC ISO-8601`);
  return parsed.toISOString();
};
const pseudonym = (value: string | undefined, field: keyof typeof ID_PREFIXES, required = true): string | undefined => {
  if (value === undefined && !required) return undefined;
  const prefix = ID_PREFIXES[field];
  if (typeof value !== 'string' || !value.startsWith(prefix) || !SAFE_PSEUDONYM.test(value.slice(prefix.length))) {
    fail(`${field} must be a prefixed pseudonymous identifier`);
  }
  return value;
};

type PropertyValidator = (value: unknown) => boolean;
const oneOf = <T extends readonly (string | number | boolean)[]>(values: T): PropertyValidator =>
  (value) => values.includes(value as T[number]);
const integerIn = (min: number, max: number): PropertyValidator =>
  (value) => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
const PROPERTY_SCHEMAS: Record<string, PropertyValidator> = {
  creative_id: oneOf(['creative_a', 'creative_b']), message_cell: oneOf(['control', 'treatment_a', 'treatment_b']), utm_source: oneOf(['direct', 'organic', 'paid', 'referral']),
  qualification_band: oneOf(['qualified', 'not_qualified', 'unknown']), auth_method: oneOf(['email', 'kakao']), consent_version: oneOf(['v1']), purpose_count: integerIn(1, 5),
  consent_type: oneOf(['analytics', 'sensitive_health', 'terms', 'privacy']), new_state: oneOf(['enabled', 'disabled']), creation_source: oneOf(['app', 'onboarding', 'invite']),
  relationship_band: oneOf(['parent', 'guardian', 'self', 'spouse', 'sibling', 'other']), age_band_optional: oneOf(['child', 'teen', 'adult']),
  episode_type: oneOf(['visit', 'illness', 'checkup', 'vaccination', 'other']), planned_visit_band: oneOf(['0_7d', '8_30d', '31d_plus', 'unknown']),
  record_type: oneOf(['condition', 'behavior', 'meal', 'sleep', 'excretion', 'activity', 'symptom', 'medication_dose', 'incident', 'media_use', 'school', 'note']),
  input_duration_band: oneOf(['0_30s', '30_60s', '1_5m', '5m_plus']), invite_role: oneOf(['viewer', 'recorder', 'admin']), channel_selected: oneOf(['app', 'email', 'sms', 'link']),
  time_to_accept_band: oneOf(['0_1h', '1_24h', '1_7d', '7d_plus']), task_type: oneOf(['followup', 'reminder', 'review']), due_band: oneOf(['today', '1_7d', '8_30d', '31d_plus']),
  source_record_count: integerIn(0, 100), latency_band: oneOf(['0_60s', '1_5m', '5m_plus']), section_changed: oneOf(['summary', 'timeline', 'tasks']),
  edit_distance_band: oneOf(['none', 'small', 'medium', 'large']), format: oneOf(['pdf']), report_window: oneOf(['7d', '14d', '30d']), answer: oneOf(['yes', 'no', 'unknown']),
  followup_type: oneOf(['task', 'reminder']), episode_cancelled_reason: oneOf(['user_cancelled', 'resolved_elsewhere', 'duplicate', 'other']), entry_point: oneOf(['settings', 'onboarding', 'report']),
  time_to_effect_ms_band: oneOf(['0_1s', '1_10s', '10s_plus']), scope: oneOf(['account', 'subject', 'records']), duration_band: oneOf(['0_60s', '1_5m', '5m_plus']),
  record_count_band: oneOf(['0', '1_10', '11_100', '101_plus']), offer_id: oneOf(['free', 'standard', 'family']), price_cell: oneOf(['free', 'standard_monthly', 'standard_yearly', 'family_monthly']),
  plan: oneOf(['free', 'standard', 'family']), reason_code: oneOf(['cost', 'no_longer_needed', 'technical', 'other']), discount_state: oneOf(['none', 'offered', 'accepted']),
  severity: oneOf(['low', 'medium', 'high', 'critical']), issue_type: oneOf(['bug', 'privacy', 'safety', 'billing', 'other']),
};

const validateProperties = (eventName: AnalyticsEventName, properties: AnalyticsProperties): AnalyticsProperties => {
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) fail('properties must be a flat object');
  const allowed = new Set<string>(EVENT_PROPERTIES[eventName]);
  const required = EVENT_PROPERTIES[eventName].filter((key) => key !== 'age_band_optional');
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(properties, key)) fail(`required property ${key} is missing for ${eventName}`);
  }
  const output: AnalyticsProperties = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!allowed.has(key)) fail(`property ${key} is not allowed for ${eventName}`);
    const validator = PROPERTY_SCHEMAS[key];
    if (!validator || !validator(value)) fail(`property ${key} must match its bounded schema`);
    output[key] = value;
  }
  return Object.freeze(output);
};

export const createAnalyticsEvent = (input: AnalyticsEventInput): AnalyticsEvent => {
  if (!input || typeof input !== 'object') fail('input must be an object');
  if (input.consentAnalytics !== true) fail('analytics consent is required');
  if (!Object.prototype.hasOwnProperty.call(EVENT_PROPERTIES, input.eventName)) fail('event_name is not allowlisted');
  if (input.eventVersion !== ANALYTICS_EVENT_VERSION) fail('unsupported event_version');
  if (!Object.values(['owner', 'admin', 'recorder', 'viewer']).includes(input.actorRole)) fail('actor_role is invalid');
  if (!Object.values(['ios', 'android', 'web']).includes(input.platform)) fail('platform is invalid');
  if (typeof input.appVersion !== 'string' || !SAFE_SEMVER.test(input.appVersion)) fail('app_version must be semver');

  const occurredAt = timestamp(input.occurredAt, 'occurred_at');
  const receivedAt = timestamp(input.receivedAt, 'received_at');
  if (!Array.isArray(input.experimentAssignments ?? [])) fail('experiment assignments must be an array');
  const assignments = (input.experimentAssignments ?? []).map(({ experimentId, variantId }) => {
    if (typeof experimentId !== 'string' || typeof variantId !== 'string' || !SAFE_PSEUDONYM.test(experimentId) || !SAFE_PSEUDONYM.test(variantId)) fail('experiment assignment is invalid');
    return Object.freeze({ experiment_id: experimentId, variant_id: variantId });
  });

  return Object.freeze({
    event_name: input.eventName,
    event_version: ANALYTICS_EVENT_VERSION,
    event_id: pseudonym(input.eventId, 'eventId')!,
    occurred_at: occurredAt,
    received_at: receivedAt,
    user_id: pseudonym(input.userId, 'userId')!,
    care_circle_id: pseudonym(input.careCircleId, 'careCircleId')!,
    subject_id: pseudonym(input.subjectId, 'subjectId', false),
    episode_id: pseudonym(input.episodeId, 'episodeId', false),
    actor_role: input.actorRole,
    platform: input.platform,
    app_version: input.appVersion,
    experiment_assignments: Object.freeze(assignments),
    consent_analytics: true,
    properties: validateProperties(input.eventName, input.properties),
  });
};

/** 내부 테스트 double: 외부 전송 없이 event_id 기준 exactly-once 적재를 검증한다. */
export class InMemoryAnalyticsSink {
  private readonly byEventId = new Map<string, AnalyticsEvent>();
  private readonly revokedUsers = new Set<string>();

  append(event: AnalyticsEvent): 'stored' | 'duplicate' {
    const canonical = createAnalyticsEvent({
      eventName: event?.event_name,
      eventVersion: event?.event_version,
      eventId: event?.event_id,
      occurredAt: event?.occurred_at,
      receivedAt: event?.received_at,
      userId: event?.user_id,
      careCircleId: event?.care_circle_id,
      subjectId: event?.subject_id,
      episodeId: event?.episode_id,
      actorRole: event?.actor_role,
      platform: event?.platform,
      appVersion: event?.app_version,
      experimentAssignments: event?.experiment_assignments?.map(({ experiment_id, variant_id }) => ({ experimentId: experiment_id, variantId: variant_id })),
      consentAnalytics: event?.consent_analytics,
      properties: event?.properties,
    });
    if (this.revokedUsers.has(canonical.user_id)) fail('analytics consent has been revoked');
    if (this.byEventId.has(canonical.event_id)) return 'duplicate';
    this.byEventId.set(canonical.event_id, canonical);
    return 'stored';
  }

  /** Consent withdrawal erases this user's pseudonymous events and permanently rejects later writes. */
  revokeConsent(userId: string): number {
    const user = pseudonym(userId, 'userId')!;
    this.revokedUsers.add(user);
    let removed = 0;
    for (const [eventId, event] of this.byEventId) {
      if (event.user_id === user) { this.byEventId.delete(eventId); removed++; }
    }
    return removed;
  }

  events(): AnalyticsEvent[] {
    return [...this.byEventId.values()].sort((a, b) =>
      a.occurred_at.localeCompare(b.occurred_at) || a.event_id.localeCompare(b.event_id));
  }
}

/** UTC 원본 타임스탬프를 한국 표준시(UTC+9)의 보고일로만 투영한다. */
export const kstDay = (utcTimestamp: string): string => {
  const utc = timestamp(utcTimestamp, 'utcTimestamp');
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(utc));
};

export interface CareMetrics {
  collabActivatedCareCircles: number;
  weeklyCompletedCareCircles: number;
  episodeFunnel: { started: number; firstFact: number; collab: number; briefingGenerated: number; followupAssigned: number; completed: number };
}

/**
 * occurred_at만으로 계산하는 결정론적 집계. received_at 정렬/지연은 결과에 영향을 주지 않는다.
 * 21일 episode는 시작일부터 21일, collab activation은 circle 생성 뒤 7일 안의 조건을 쓴다.
 */
export const aggregateCareMetrics = (input: readonly AnalyticsEvent[], options: { weekStart: string }): CareMetrics => {
  const events = [...new Map(input.map((event) => [event.event_id, event])).values()]
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.event_id.localeCompare(b.event_id));
  const weekStart = new Date(timestamp(options.weekStart, 'weekStart')).getTime();
  const weekEnd = weekStart + 7 * 86_400_000;
  const byCircle = new Map<string, AnalyticsEvent[]>();
  for (const event of events) byCircle.set(event.care_circle_id, [...(byCircle.get(event.care_circle_id) ?? []), event]);

  let collabActivatedCareCircles = 0;
  let weeklyCompletedCareCircles = 0;
  for (const circleEvents of byCircle.values()) {
    const created = circleEvents.find((event) => event.event_name === 'circle_created');
    if (created) {
      const deadline = new Date(created.occurred_at).getTime() + 7 * 86_400_000;
      const createdAt = new Date(created.occurred_at).getTime();
      const withinSevenDays = circleEvents.filter((event) => {
        const time = new Date(event.occurred_at).getTime();
        return time >= createdAt && time <= deadline;
      });
      const hasSubject = withinSevenDays.some((event) => event.event_name === 'subject_created');
      const hasRecord = withinSevenDays.some((event) => event.event_name === 'record_created');
      const invited = withinSevenDays.some((event) => event.event_name === 'invite_created');
      const accepted = withinSevenDays.some((event) => event.event_name === 'invite_accepted');
      const acknowledgedByAnotherUser = withinSevenDays.some((event) =>
        event.event_name === 'record_acknowledged' && event.user_id !== created.user_id);
      if (hasSubject && hasRecord && invited && accepted && acknowledgedByAnotherUser) collabActivatedCareCircles++;
    }

    const weekly = circleEvents.filter((event) => {
      const time = new Date(event.occurred_at).getTime();
      return time >= weekStart && time < weekEnd;
    });
    const users = new Set(weekly.map((event) => event.user_id));
    const records = weekly.filter((event) => event.event_name === 'record_created').length;
    const collaboration = weekly.some((event) => event.event_name === 'record_acknowledged' || event.event_name === 'task_completed');
    if (users.size >= 2 && records >= 3 && collaboration) weeklyCompletedCareCircles++;
  }

  const episodes = new Map<string, AnalyticsEvent[]>();
  for (const event of events) if (event.episode_id) episodes.set(event.episode_id, [...(episodes.get(event.episode_id) ?? []), event]);
  const funnel = { started: 0, firstFact: 0, collab: 0, briefingGenerated: 0, followupAssigned: 0, completed: 0 };
  for (const episodeEvents of episodes.values()) {
    const start = episodeEvents.find((event) => event.event_name === 'episode_started');
    if (!start) continue;
    funnel.started++;
    const end = new Date(start.occurred_at).getTime() + 21 * 86_400_000;
    const startedAt = new Date(start.occurred_at).getTime();
    const withinEpisode = episodeEvents.filter((event) => {
      const time = new Date(event.occurred_at).getTime();
      return time >= startedAt && time <= end;
    });
    if (withinEpisode.some((event) => event.event_name === 'record_created')) funnel.firstFact++;
    if (withinEpisode.some((event) => event.event_name === 'invite_accepted' || event.event_name === 'record_acknowledged')) funnel.collab++;
    if (withinEpisode.some((event) => event.event_name === 'briefing_generated')) funnel.briefingGenerated++;
    if (withinEpisode.some((event) => event.event_name === 'followup_assigned')) funnel.followupAssigned++;
    if (withinEpisode.some((event) => event.event_name === 'episode_completed')) funnel.completed++;
  }

  return Object.freeze({
    collabActivatedCareCircles,
    weeklyCompletedCareCircles,
    episodeFunnel: Object.freeze(funnel),
  });
};
