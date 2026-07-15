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

export interface Child {
  id: string;
  name: string;
  nickname?: string;
  birthDate: ISODate;
  sex: 'male' | 'female';
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

export type ConsentType = 'guardian_legal' | 'sensitive_health' | 'share';

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
  guardianName: string;
}
