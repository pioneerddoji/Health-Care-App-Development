// 저장소 계층 — 화면/컨텍스트는 이 인터페이스만 사용한다.
// env(EXPO_PUBLIC_SUPABASE_*)가 있으면 Supabase, 없으면 인메모리(mock)로 동작.
import type {
  Child, ChildGuardian, ChildInput, Checkup, DailyRecord, GrowthMeasurement,
  GuardianRole, ISODate, Medication, Profile, RecordInput, Report,
  ShareLinkInfo, Subscription, SubscriptionTier, Vaccination,
} from '../types';
import { isMockMode } from '../lib/supabase';
import { memoryRepo } from './memoryRepo';
import { supabaseRepo } from './supabaseRepo';

export interface SignUpInput {
  email: string;
  password: string;
  name: string;
  relationship: string;
  phone?: string;
}

export interface AuthOutcome {
  profile?: Profile;
  /** 이메일 확인이 켜진 프로젝트에서 가입 직후 세션이 없는 경우 */
  needsEmailConfirm?: boolean;
  error?: string;
}

export interface AllData {
  children: Child[];
  records: DailyRecord[];
  growth: GrowthMeasurement[];
  medications: Medication[];
  vaccinations: Vaccination[];
  checkups: Checkup[];
  /** 아이별 내 역할 — viewer면 읽기 전용 UI */
  roles: Record<string, GuardianRole>;
  /** 아이별 민감정보(건강정보) 동의 유효 여부 — false면 새 기록 입력 차단 */
  sensitiveConsent: Record<string, boolean>;
  /** 현재 구독 (없으면 free) — 진실 원천은 서버 subscriptions 테이블 */
  subscription: Subscription;
}

export interface Repo {
  mode: 'mock' | 'supabase';

  signUp(input: SignUpInput): Promise<AuthOutcome>;
  signIn(email: string, password: string): Promise<AuthOutcome>;
  signOut(): Promise<void>;
  /** 앱 시작 시 저장된 세션 복원 */
  restoreSession(): Promise<Profile | null>;

  // ── 계정 찾기 (휴대폰 인증 후 호출 — OTP 검증은 smsAuth.ts) ──
  /** 아이디 찾기: 가입 연락처로 이메일 조회. 없으면 null */
  findEmailByPhone(phone: string): Promise<string | null>;
  /** 비밀번호 재설정: 이메일+연락처 일치 확인 후 새 비밀번호 저장 */
  resetPassword(email: string, phone: string, newPassword: string): Promise<void>;

  /** 로그인한 보호자가 접근 가능한 전체 데이터 로드 */
  loadAll(): Promise<AllData>;

  /** 아이 생성 + owner 관계 + 법정대리인/민감정보 동의 기록 */
  createChild(input: ChildInput): Promise<Child>;
  updateChild(id: string, patch: Partial<ChildInput>): Promise<void>;
  /** 완전 삭제: Storage 사진/PDF까지 지운 뒤 DB 행 삭제(cascade) */
  deleteChildAndData(id: string): Promise<void>;

  /** 민감정보 동의 철회 — 이후 새 기록 입력이 RLS에서 차단된다 */
  revokeSensitiveConsent(childId: string): Promise<void>;
  /** 민감정보 재동의 — 새 동의 행을 기록 */
  grantSensitiveConsent(childId: string): Promise<void>;

  /** input.photoUris는 로컬 URI — supabase 모드에서는 Storage 업로드 후
   *  표시용(서명) URL로 치환된 레코드를 반환한다 */
  createRecord(childId: string, input: RecordInput): Promise<DailyRecord>;
  deleteRecord(id: string): Promise<void>;

  addVaccination(v: Omit<Vaccination, 'id'>): Promise<Vaccination>;
  updateVaccination(id: string, patch: Partial<Vaccination>): Promise<void>;
  addCheckup(c: Omit<Checkup, 'id'>): Promise<Checkup>;

  // ── 레포트 발행 + 만료형 공유 링크 ──
  /** 생성한 PDF를 Storage 'reports'에 업로드하고 reports 행을 기록 */
  publishReport(input: {
    childId: string;
    localPdfUri: string;
    periodStart: ISODate;
    periodEnd: ISODate;
    questionsForDoctor: string[];
  }): Promise<Report>;
  /** 만료형 공유 링크 생성 — 반환 url을 의사/가족에게 전달 */
  createShareLink(reportId: string, expiresInHours: number): Promise<ShareLinkInfo>;
  listShareLinks(childId: string): Promise<ShareLinkInfo[]>;
  revokeShareLink(linkId: string): Promise<void>;

  // ── 구독 ──
  /** 데모(mock) 전용 티어 전환 — supabase 모드에서는 스토어 결제로만 변경 가능(오류) */
  setSubscriptionTier(tier: SubscriptionTier): Promise<Subscription>;

  // ── 보호자 공동 관리 (owner 전용 조작) ──
  listGuardians(childId: string): Promise<ChildGuardian[]>;
  /** 가입된 이메일로 초대 — supabase 모드는 invite_guardian RPC */
  inviteGuardian(childId: string, email: string, role: 'editor' | 'viewer'): Promise<void>;
  updateGuardianRole(childId: string, guardianId: string, role: 'editor' | 'viewer'): Promise<void>;
  removeGuardian(childId: string, guardianId: string): Promise<void>;
}

export const repo: Repo = isMockMode ? memoryRepo : supabaseRepo;
