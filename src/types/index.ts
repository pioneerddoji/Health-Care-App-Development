// 도메인 타입 — supabase/schema.sql 과 1:1 대응

export type ISODate = string;      // 'YYYY-MM-DD'
export type HHMM = string;         // 'HH:MM'

export type GuardianRole = 'owner' | 'editor' | 'viewer';

// ── 구독 ───────────────────────────────────────────────────
export type SubscriptionTier = 'free' | 'standard' | 'family';
export type PaidTier = Exclude<SubscriptionTier, 'free'>;
export type BillingPeriod = 'monthly' | 'yearly';

export interface Subscription {
  tier: SubscriptionTier;
  /** 유료 티어의 만료 시각 (스토어 갱신 웹훅이 연장) */
  expiresAt?: string;
}

// ── 사용자별 설정 ────────────────────────────────────────────
/** 서버 user_settings.settings(JSONB)와 1:1 — 새 개인 설정은 여기에 필드만
 *  추가하면 된다(스키마 변경 불필요). 계정 단위로 저장되어 기기를 바꿔도 유지. */
export interface UserSettings {
  /** 대시보드 그래프 카드 순서 (DashboardScreen의 SectionKey 배열) */
  dashboardOrder?: string[];
}

/** 아이 한 명을 공동 관리하는 보호자 항목 (guardian_child + profiles 조인) */
export interface ChildGuardian {
  guardianId: string;
  childId: string;
  role: GuardianRole;
  name: string;
  relationship?: string;
  isMe: boolean;
}

export interface Profile {
  id: string;
  name: string;
  phone?: string;
  relationship: string; // 엄마/아빠/조부모/기타
}

export interface SurgeryHistory {
  name: string;
  date?: ISODate;
  hospital?: string;
}

// ── 관리 대상자 ──────────────────────────────────────────────
/** 대상자 유형 — 연령 전제 기능(출생 정보/학교 기록 등) 노출과 동의 흐름을 가른다.
 *  판정 기준은 유형이 아니라 birthDate(만 나이)이며, 유형은 "무엇을 보여줄지"를 정한다. */
export type RecipientType = 'child' | 'adult';

/** 등록 대상자. (테이블·타입명은 `children`/`Child` 유지 — 일괄 개명은 마이그레이션
 *  비용이 커서 백로그. docs/08 §확장 시 갈라지는 지점 1번 규칙) */
export interface Child {
  id: string;
  name: string;
  nickname?: string;
  birthDate: ISODate;
  sex: 'male' | 'female';
  /** 아이(기본) / 성인 — 미지정 저장본은 'child'로 간주 */
  recipientType?: RecipientType;
  /** 성인 대상자가 계정 소유자 본인인지 — 동의 경로(본인 동의 vs 위임)를 가른다 */
  isSelf?: boolean;
  birthWeightG?: number;
  birthHeightCm?: number;
  gestationalWeeks?: number;
  isPreterm: boolean;
  bloodType?: string;
  allergies: string[];
  chronicConditions: string[];
  surgeries: SurgeryHistory[];
  hospitalizations: SurgeryHistory[];
  primaryDoctor?: string;
  primaryHospital?: string;
  guardianPhone?: string;
  /** 건강 정보 기타 — 알레르기/만성질환 외 참고사항 자유 기재 */
  otherNotes?: string;
}

export type ChildInput = Omit<Child, 'id'>;

/** 동의 유형.
 *  - `sensitive_health`: 건강정보(민감정보) 별도 동의. **모든 대상자 유형 공통이며
 *    RLS의 기록 INSERT 게이트**(has_sensitive_consent) — 유형이 늘어도 이 역할은 불변.
 *  - `guardian_legal`: 법정대리인 확인·동의 (미성년 대상자)
 *  - `adult_delegated`: 성인 대상자를 대신 기록하기 위한 본인 위임 동의 확인
 *  - `share`: 공유 링크 제3자 제공 */
export type ConsentType =
  | 'guardian_legal' | 'sensitive_health' | 'adult_delegated' | 'share';

export interface Consent {
  id: string;
  childId: string;
  guardianId: string;
  type: ConsentType;
  grantedAt: string;
  revokedAt?: string;
}

// ── 일자별 기록 ──────────────────────────────────────────────
export type RecordType =
  | 'condition' | 'behavior' | 'meal' | 'sleep' | 'excretion' | 'activity'
  | 'symptom' | 'medication_dose' | 'incident' | 'media_use' | 'school' | 'note';

export type CategorySlug =
  | 'growth' | 'development' | 'nutrition' | 'sleep' | 'physical_activity'
  | 'infection_symptom' | 'respiratory_allergy' | 'digestion_excretion'
  | 'oral_sensory' | 'emotion_behavior' | 'safety_injury'
  | 'preventive_care' | 'adolescent_health' | 'treatment_management';

// 유형별 payload — docs/02_db_schema.md 규약
export interface RecordPayload {
  // condition
  level?: 1 | 2 | 3 | 4 | 5;
  mood?: string;
  // meal
  mealType?: '아침' | '점심' | '저녁' | '간식' | '수유';
  amount?: '전량' | '절반' | '거의 안 먹음';
  items?: string[];
  waterMl?: number;
  // sleep
  sleepStart?: HHMM;
  sleepEnd?: HHMM;
  nightWakings?: number;
  quality?: 1 | 2 | 3 | 4 | 5;
  // excretion
  kind?: '소변' | '대변';
  count?: number;
  stoolForm?: '보통' | '묽음' | '딱딱';
  color?: string;
  // activity
  activity?: string;
  durationMin?: number;
  intensity?: '가벼움' | '보통' | '높음';
  // symptom
  symptom?: string;
  temperatureC?: number;
  bodyPart?: string;
  severity?: 1 | 2 | 3 | 4 | 5;
  // medication_dose
  medicationName?: string;
  givenAt?: HHMM;
  doseText?: string; // 자유 텍스트 — 앱이 용량을 계산/추천하지 않음
  // incident
  what?: string;
  incidentSeverity?: '경미' | '보통' | '심각';
  action?: string;
  // media_use / school / behavior / note
  content?: string;
  attended?: boolean;
  note?: string;
}

export interface DailyRecord {
  id: string;
  childId: string;
  authorId: string;
  recordDate: ISODate;
  recordTime?: HHMM;
  type: RecordType;
  categories: CategorySlug[];
  payload: RecordPayload;
  memo?: string;
  photoUris: string[]; // MVP: 로컬 URI, 연동 후 storage path
}

/** 공동 보호자가 기록을 확인한 시각. 관찰 기록의 전달 상태만 나타내며 의료 판단이 아니다. */
export interface RecordAcknowledgement {
  recordId: string;
  guardianId: string;
  acknowledgedAt: string;
}

/** 진료 후 안내 또는 기록 후속 조치의 보호자 간 담당·기한·완료 상태. */
export interface CareTask {
  id: string;
  childId: string;
  /** 특정 기록에서 시작한 후속 조치라면 연결한다. */
  recordId?: string;
  title: string;
  note?: string;
  assigneeId?: string;
  dueDate?: ISODate;
  completedAt?: string;
  createdBy: string;
  createdAt: string;
}

export type RecordInput = Omit<DailyRecord, 'id' | 'childId' | 'authorId'>;

// ── 성장/약/접종/검진 ───────────────────────────────────────
export interface GrowthMeasurement {
  id: string;
  childId: string;
  measuredOn: ISODate;
  heightCm?: number;
  weightKg?: number;
  headCm?: number;
  bmi?: number;
}

export interface Medication {
  id: string;
  childId: string;
  name: string;
  doseText?: string;
  scheduleText?: string;
  startDate?: ISODate;
  endDate?: ISODate;
  prescriber?: string;
  isActive: boolean;
}

export interface Vaccination {
  id: string;
  childId: string;
  vaccineName: string;
  doseNo: number;
  dueDate?: ISODate;
  doneDate?: ISODate;
  hospital?: string;
  adverseReaction?: string;
}

export interface Checkup {
  id: string;
  childId: string;
  checkupName: string;
  dueDate?: ISODate;
  doneDate?: ISODate;
  hospital?: string;
  resultSummary?: string;
}

// ── 레포트 / 공유 링크 ─────────────────────────────────────
export interface Report {
  id: string;
  childId: string;
  periodStart: ISODate;
  periodEnd: ISODate;
  questionsForDoctor: string[];
  storagePath?: string;
  createdAt: string;
}

export interface ShareLinkInfo {
  id: string;
  reportId: string;
  childId: string;
  url: string;
  expiresAt: string;
  revokedAt?: string;
  periodStart: ISODate;
  periodEnd: ISODate;
}

export interface ReportInput {
  child: Child;
  records: DailyRecord[];
  growth: GrowthMeasurement[];
  medications: Medication[];
  vaccinations: Vaccination[];
  periodStart: ISODate;
  periodEnd: ISODate;
  questionsForDoctor: string[];
  /** 보호자가 수정하는 진료 전 전달 메모 — 의학적 요약/판단을 생성하지 않는다. */
  briefingNote?: string;
  guardianName: string;
}
