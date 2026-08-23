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
const SAFE_ID = /^[a-z][a-z0-9_-]{2,63}$/;
const SAFE_SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const FORBIDDEN_PROPERTY = /(?:symptom|diagnos|medication|drug|photo|document|briefing_text|person_name|email|phone|address|birth|dob|token|secret|password|hospital|doctor|note|text)/i;

const fail = (message: string): never => { throw new Error(`Invalid analytics event: ${message}`); };
const timestamp = (value: string, field: string): string => {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || !value.endsWith('Z')) fail(`${field} must be UTC ISO-8601`);
  return parsed.toISOString();
};
const pseudonym = (value: string | undefined, field: keyof typeof ID_PREFIXES, required = true): string | undefined => {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || !value.startsWith(ID_PREFIXES[field]) || !SAFE_ID.test(value)) {
    fail(`${field} must be a prefixed pseudonymous identifier`);
  }
  return value;
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
    if (FORBIDDEN_PROPERTY.test(key)) fail(`property ${key} can contain protected health or PII data`);
    if (!['string', 'number', 'boolean'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) {
      fail(`property ${key} must be a finite scalar`);
    }
    if (typeof value === 'string' && (value.length > 64 || /@|https?:\/\//i.test(value))) {
      fail(`property ${key} must be a bounded categorical value`);
    }
    output[key] = value;
  }
  return Object.freeze(output);
};

export const createAnalyticsEvent = (input: AnalyticsEventInput): AnalyticsEvent => {
  if (!input || typeof input !== 'object') fail('input must be an object');
  if (!input.consentAnalytics) fail('analytics consent is required');
  if (!Object.prototype.hasOwnProperty.call(EVENT_PROPERTIES, input.eventName)) fail('event_name is not allowlisted');
  if (input.eventVersion !== ANALYTICS_EVENT_VERSION) fail('unsupported event_version');
  if (!Object.values(['owner', 'admin', 'recorder', 'viewer']).includes(input.actorRole)) fail('actor_role is invalid');
  if (!Object.values(['ios', 'android', 'web']).includes(input.platform)) fail('platform is invalid');
  if (!SAFE_SEMVER.test(input.appVersion)) fail('app_version must be semver');

  const occurredAt = timestamp(input.occurredAt, 'occurred_at');
  const receivedAt = timestamp(input.receivedAt, 'received_at');
  const assignments = (input.experimentAssignments ?? []).map(({ experimentId, variantId }) => {
    if (!SAFE_ID.test(experimentId) || !SAFE_ID.test(variantId)) fail('experiment assignment is invalid');
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

  append(event: AnalyticsEvent): 'stored' | 'duplicate' {
    if (this.byEventId.has(event.event_id)) return 'duplicate';
    this.byEventId.set(event.event_id, event);
    return 'stored';
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
  const events = [...input].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.event_id.localeCompare(b.event_id));
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
      const withinSevenDays = circleEvents.filter((event) => new Date(event.occurred_at).getTime() <= deadline);
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
    const withinEpisode = episodeEvents.filter((event) => new Date(event.occurred_at).getTime() <= end);
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
