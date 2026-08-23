// 데모 저장소 — Supabase env가 없을 때의 모드.
// 첫 실행은 샘플 데이터로 시작하고, 이후 모든 변경은 기기(AsyncStorage)에
// 저장되어 앱을 재시작해도 유지된다. (혼자 실사용 가능한 로컬 모드)
import { demoStorage } from '../lib/demoStorage';
import type { Repo, AllData, AuthOutcome, SignUpInput } from './repo';
import { SOCIAL_PROVIDERS, type SocialProvider } from './socialAuth';
import type {
  CareTask, Child, ChildGuardian, ChildInput, Checkup, DailyRecord, Profile,
  RecordAcknowledgement, RecordInput, Report, ShareLinkInfo, Subscription, SubscriptionTier,
  UserSettings, Vaccination,
} from '../types';
import { ENTITLEMENTS, TIER_META } from '../constants/subscription';
import {
  SAMPLE_CHECKUPS, SAMPLE_CHILDREN, SAMPLE_GROWTH, SAMPLE_GUARDIAN,
  SAMPLE_MEDICATIONS, SAMPLE_RECORDS, SAMPLE_VACCINATIONS,
} from '../data/sample';

let idSeq = 1000;
const newId = (prefix: string) => `${prefix}-${++idSeq}`;

/** 이 이메일로 로그인하면 샘플 데이터(아이 2명 + 14일 기록)가 로드된다 — 체험/테스트용 */
export const DEMO_EMAIL = 'demo@carenote.app';

// 아이케어(kidcare) 시절 데모 계정 — 기기에 저장된 구 계정도 계속 데모로 인식해야
// 마이그레이션 로직이 샘플을 오삭제하지 않는다. 로그인도 계속 받아 준다.
const LEGACY_DEMO_EMAILS = ['demo@kidcare.app'];
const isDemoEmail = (email: string | null): boolean =>
  email === DEMO_EMAIL || (email !== null && LEGACY_DEMO_EMAILS.includes(email));

// 공동 관리 데모 프리셋: 하은이는 아빠가 편집자로 함께 기록하는 상태
const DEMO_GUARDIANS: ChildGuardian[] = [
  { guardianId: 'guardian-1', childId: 'child-1', role: 'owner', name: '김보호', relationship: '엄마', isMe: true },
  { guardianId: 'guardian-2', childId: 'child-1', role: 'editor', name: '박아빠', relationship: '아빠', isMe: false },
  { guardianId: 'guardian-1', childId: 'child-2', role: 'owner', name: '김보호', relationship: '엄마', isMe: true },
];

let guardian: Profile | null = null;
let accountPassword: string | null = null;   // 데모 계정 비밀번호 (재설정 검증용)
let accountEmail: string | null = null;
const data: Omit<AllData, 'roles' | 'sensitiveConsent' | 'subscription' | 'settings'> = {
  children: [], records: [], growth: [],
  medications: [], vaccinations: [], checkups: [], recordAcknowledgements: [], careTasks: [],
};

let guardians: ChildGuardian[] = [];

// Supabase RPC의 auth.uid()/my_role(childId) 권한 경계를 mock에서도 동일하게 확인한다.
// 소유권 이전 뒤에도 로그인한 프로필은 이전 owner이므로, 매 변이 직전에 현재 역할을 재조회해야 한다.
const requireOwner = (childId: string): string => {
  const actorId = guardian?.id ?? 'guardian-1';
  const actor = guardians.find((g) => g.childId === childId && g.guardianId === actorId);
  if (actor?.role !== 'owner') throw new Error('대상자의 소유자만 이 작업을 수행할 수 있습니다');
  return actorId;
};

const myRoles = (): AllData['roles'] =>
  Object.fromEntries(guardians.filter((g) => g.isMe).map((g) => [g.childId, g.role]));

let reports: Report[] = [];
let shareLinks: ShareLinkInfo[] = [];

// 민감정보 동의 상태 — 기본 true(가입 시 동의), 철회 시 false
const sensitiveConsent: Record<string, boolean> = {};
const consentOf = (childId: string) => sensitiveConsent[childId] ?? true;

// 데모 구독 — 샘플이 아이 2명 + 공동 보호자 1명이라 standard로 시작
// (설정 → 플랜 관리에서 전환하며 게이팅을 체험할 수 있다)
let subscription: Subscription = { tier: 'standard' };

// 사용자별 설정 — mock은 단일 계정 저장소라 설정도 하나만 유지
// (실 모드는 user_settings 테이블에 계정별로 저장)
let settings: UserSettings = {};

// ── 기기 영속화 ──────────────────────────────────────────────
const STORAGE_KEY = 'carenote.demo.v1';
/** 아이케어 시절 저장 키 — 앱 이름 변경 시 기존 사용자의 기록이 사라지면 안 되므로
 *  새 키가 비어 있을 때 1회 이관한다(구 키는 롤백 여지를 위해 남겨 둔다). */
const LEGACY_STORAGE_KEY = 'kidcare.demo.v1';
let hydrated = false;

const hydrate = async (): Promise<void> => {
  if (hydrated) return;
  hydrated = true;
  let raw = await demoStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const legacy = await demoStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      // 이름 변경 이관: 구 저장본을 새 키로 복사한 뒤 그대로 읽어들인다
      await demoStorage.setItem(STORAGE_KEY, legacy);
      raw = legacy;
    }
  }
  if (!raw) return;
  try {
    const s = JSON.parse(raw);
    guardian = s.guardian ?? null;
    accountPassword = s.accountPassword ?? null;
    accountEmail = s.accountEmail ?? null;
    data.children = s.children ?? data.children;
    data.records = s.records ?? data.records;
    data.growth = s.growth ?? data.growth;
    data.medications = s.medications ?? data.medications;
    data.vaccinations = s.vaccinations ?? data.vaccinations;
    data.checkups = s.checkups ?? data.checkups;
    data.recordAcknowledgements = s.recordAcknowledgements ?? data.recordAcknowledgements;
    data.careTasks = s.careTasks ?? data.careTasks;
    guardians = s.guardians ?? guardians;
    reports = s.reports ?? reports;
    shareLinks = s.shareLinks ?? shareLinks;
    Object.assign(sensitiveConsent, s.sensitiveConsent ?? {});
    subscription = s.subscription ?? subscription;
    settings = s.settings ?? settings;
    idSeq = s.idSeq ?? idSeq;
    // 마이그레이션: 일반 계정(가입 사용자) 저장본에 구버전 샘플(하은/도윤)이
    // 남아 있으면 제거한다 — 데모 계정 데이터는 유지.
    // 구 데모 이메일(아이케어 시절)도 데모로 인정해야 샘플이 오삭제되지 않는다.
    if (accountEmail && !isDemoEmail(accountEmail) && stripSampleData()) persist();
  } catch { /* 손상된 저장본은 무시하고 샘플로 시작 */ }
};

// 샘플 아이(child-1/child-2)와 그에 딸린 모든 데이터를 제거. 제거했으면 true.
const SAMPLE_CHILD_IDS = new Set(['child-1', 'child-2']);
const stripSampleData = (): boolean => {
  if (!data.children.some((c) => SAMPLE_CHILD_IDS.has(c.id))) return false;
  data.children = data.children.filter((c) => !SAMPLE_CHILD_IDS.has(c.id));
  data.records = data.records.filter((r) => !SAMPLE_CHILD_IDS.has(r.childId));
  data.growth = data.growth.filter((g) => !SAMPLE_CHILD_IDS.has(g.childId));
  data.medications = data.medications.filter((m) => !SAMPLE_CHILD_IDS.has(m.childId));
  data.vaccinations = data.vaccinations.filter((v) => !SAMPLE_CHILD_IDS.has(v.childId));
  data.checkups = data.checkups.filter((c) => !SAMPLE_CHILD_IDS.has(c.childId));
  data.recordAcknowledgements = data.recordAcknowledgements.filter((a) =>
    data.records.some((r) => r.id === a.recordId));
  data.careTasks = data.careTasks.filter((t) => !SAMPLE_CHILD_IDS.has(t.childId));
  guardians = guardians.filter((g) => !SAMPLE_CHILD_IDS.has(g.childId));
  reports = reports.filter((r) => !SAMPLE_CHILD_IDS.has(r.childId));
  shareLinks = shareLinks.filter((l) => !SAMPLE_CHILD_IDS.has(l.childId));
  return true;
};

const persist = (): void => {
  demoStorage.setItem(STORAGE_KEY, JSON.stringify({
    guardian, accountPassword, accountEmail, ...data, guardians, reports, shareLinks,
    sensitiveConsent, subscription, settings, idSeq,
  })).catch(() => {});
};

const base: Repo = {
  mode: 'mock',

  async signUp(input: SignUpInput): Promise<AuthOutcome> {
    // 신규 가입은 샘플 없이 빈 상태로 시작 (사용자 요구사항)
    data.children = []; data.records = []; data.growth = [];
    data.medications = []; data.vaccinations = []; data.checkups = [];
    data.recordAcknowledgements = []; data.careTasks = [];
    guardians = []; reports = []; shareLinks = [];
    subscription = { tier: 'free' };   // 신규 가입은 무료 플랜부터
    settings = {};                     // 설정도 새 계정 기준으로 초기화
    accountPassword = input.password;
    accountEmail = input.email;
    guardian = {
      ...SAMPLE_GUARDIAN,
      name: input.name,
      relationship: input.relationship,
      phone: input.phone,
    };
    return { profile: guardian };
  },

  async signIn(email: string, password: string): Promise<AuthOutcome> {
    // 데모 계정: 샘플 데이터(아이 2명 + 14일 기록)를 새로 로드
    // 구 데모 이메일로도 계속 로그인할 수 있게 한다(앱 이름 변경 전 안내를 본 사용자)
    if (isDemoEmail(email)) {
      data.children = [...SAMPLE_CHILDREN];
      data.records = [...SAMPLE_RECORDS];
      data.growth = [...SAMPLE_GROWTH];
      data.medications = [...SAMPLE_MEDICATIONS];
      data.vaccinations = [...SAMPLE_VACCINATIONS];
      data.checkups = [...SAMPLE_CHECKUPS];
      data.recordAcknowledgements = []; data.careTasks = [];
      guardians = [...DEMO_GUARDIANS];
      guardian = { ...SAMPLE_GUARDIAN };
      accountEmail = DEMO_EMAIL;          // 저장본을 데모 상태로 표시 (재시작 시 샘플 유지)
      subscription = { tier: 'standard' }; // 데모는 항상 스탠다드 게이팅 체험
      return { profile: guardian };
    }
    if (accountPassword && password !== accountPassword) {
      return { error: '비밀번호가 일치하지 않습니다.' };
    }
    // 일반 계정 로그인: 직전 데모 세션의 샘플/데모용 티어가 남아 있으면 정리
    const wasDemo = isDemoEmail(accountEmail);
    accountEmail = email;
    stripSampleData();
    if (wasDemo) subscription = { tier: 'free' };
    guardian = guardian ?? { ...SAMPLE_GUARDIAN, name: email.split('@')[0] || SAMPLE_GUARDIAN.name };
    return { profile: guardian };
  },

  async signInWithSocial(provider: SocialProvider): Promise<AuthOutcome> {
    // 데모: 소셜 OAuth를 시뮬레이션 — 공급자별 고정 데모 계정으로 로그인.
    // 첫 진입이면 실서버(신규 프로필 생성)와 동일하게 빈 상태 + free + 동의 화면 경유.
    // 공급자마다 계정을 나눠야 "카카오로 들어갔다가 구글로 들어오면 남의 기록이
    // 보이는" 상황이 데모에서도 재현되지 않는다.
    const email = `${provider}@carenote.app`;
    const isNewUser = accountEmail !== email;
    if (isNewUser) {
      data.children = []; data.records = []; data.growth = [];
      data.medications = []; data.vaccinations = []; data.checkups = [];
      data.recordAcknowledgements = []; data.careTasks = [];
      guardians = []; reports = []; shareLinks = [];
      subscription = { tier: 'free' };
      settings = {};
      accountPassword = null;
      accountEmail = email;
      guardian = {
        ...SAMPLE_GUARDIAN,
        name: `${SOCIAL_PROVIDERS[provider].short} 보호자`,
        relationship: '보호자',
        phone: undefined,
      };
    }
    return { profile: guardian!, isNewUser };
  },

  async findEmailByPhone(phone: string): Promise<string | null> {
    // 데모: 저장된 보호자의 연락처와 대조 (실서버는 RPC로 조회)
    if (guardian?.phone && guardian.phone.replace(/\D/g, '') === phone.replace(/\D/g, '')) {
      return accountEmail ?? 'demo-user@carenote.app';
    }
    return null;
  },

  async resetPassword(email: string, phone: string, newPassword: string): Promise<void> {
    if (email !== accountEmail || !guardian?.phone || guardian.phone.replace(/\D/g, '') !== phone.replace(/\D/g, '')) {
      throw new Error('가입 시 등록한 연락처와 일치하지 않습니다.');
    }
    accountPassword = newPassword;
  },

  async requestPasswordResetEmail(): Promise<void> {
    // 데모: 실제 메일 발송 없음 — 성공으로 처리 (실서버는 supabase가 발송)
  },

  async completePasswordRecovery(newPassword: string): Promise<void> {
    accountPassword = newPassword;
    guardian = null;
  },

  subscribePasswordRecovery() { return () => {}; },
  async processAuthLink() {},
  async getAccountAuthMethods(): Promise<('email' | SocialProvider)[]> {
    if (accountPassword) return ['email'];
    if (accountEmail?.startsWith('kakao@')) return ['kakao'];
    if (accountEmail?.startsWith('google@')) return ['google'];
    return ['email'];
  },

  async deleteAccount({ password, socialProvider }): Promise<import('./accountDeletion').AccountDeletionResult> {
    const expectedSocial = accountEmail?.startsWith('kakao@') ? 'kakao'
      : accountEmail?.startsWith('google@') ? 'google' : undefined;
    if (expectedSocial ? socialProvider !== expectedSocial : (!accountPassword || password !== accountPassword)) {
      throw new Error('현재 비밀번호가 일치하지 않습니다.');
    }
    guardian = null;
    accountPassword = null;
    accountEmail = null;
    data.children = []; data.records = []; data.growth = [];
    data.medications = []; data.vaccinations = []; data.checkups = [];
    data.recordAcknowledgements = []; data.careTasks = [];
    guardians = []; reports = []; shareLinks = [];
    for (const id of Object.keys(sensitiveConsent)) delete sensitiveConsent[id];
    subscription = { tier: 'free' };
    settings = {};
    return { status: 'completed', jobId: 'mock-delete-job' };
  },

  async signOut() { guardian = null; },
  // 데모 로그인 상태도 기기에 유지 — 앱 재시작 시 자동 로그인
  async restoreSession() { return guardian; },

  async loadAll(): Promise<AllData> {
    return {
      children: [...data.children],
      records: [...data.records],
      growth: [...data.growth],
      medications: [...data.medications],
      vaccinations: [...data.vaccinations],
      checkups: [...data.checkups],
      recordAcknowledgements: [...data.recordAcknowledgements],
      careTasks: [...data.careTasks],
      roles: myRoles(),
      sensitiveConsent: Object.fromEntries(
        data.children.map((c) => [c.id, consentOf(c.id)])),
      subscription,
      settings: { ...settings },
    };
  },

  async createChild(input: ChildInput): Promise<Child> {
    // 서버(트리거)와 동일한 대상자 수 한도 — mock에서도 미러
    const owned = guardians.filter((g) => g.isMe && g.role === 'owner').length;
    const max = ENTITLEMENTS[subscription.tier].maxChildren;
    if (owned >= max) {
      throw new Error(`${TIER_META[subscription.tier].label} 플랜에서는 대상자를 ${max}명까지 등록할 수 있어요. 플랜을 업그레이드해 주세요.`);
    }
    const child: Child = { ...input, id: newId('child') };
    data.children.push(child);
    guardians.push({
      guardianId: guardian?.id ?? 'guardian-1', childId: child.id, role: 'owner',
      name: guardian?.name ?? '김보호', relationship: guardian?.relationship, isMe: true,
    });
    return child;
  },

  async updateChild(id: string, patch: Partial<ChildInput>) {
    data.children = data.children.map((c) => (c.id === id ? { ...c, ...patch } : c));
  },

  async deleteChildAndData(id: string) {
    // supabase 모드의 FK cascade와 동일하게 레포트/공유 링크/동의 상태까지 정리
    // 이전 owner가 editor로 강등된 뒤에도 기기 캐시만 보고 삭제하면 안 된다.
    requireOwner(id);
    if (!data.children.some((child) => child.id === id)) {
      throw new Error('삭제할 대상자를 찾을 수 없습니다');
    }
    const removedRecordIds = new Set(data.records.filter((r) => r.childId === id).map((r) => r.id));
    guardians = guardians.filter((g) => g.childId !== id);
    data.children = data.children.filter((c) => c.id !== id);
    data.records = data.records.filter((r) => r.childId !== id);
    data.growth = data.growth.filter((g) => g.childId !== id);
    data.medications = data.medications.filter((m) => m.childId !== id);
    data.vaccinations = data.vaccinations.filter((v) => v.childId !== id);
    data.checkups = data.checkups.filter((c) => c.childId !== id);
    data.recordAcknowledgements = data.recordAcknowledgements.filter((a) => !removedRecordIds.has(a.recordId));
    data.careTasks = data.careTasks.filter((t) => t.childId !== id);
    reports = reports.filter((r) => r.childId !== id);
    shareLinks = shareLinks.filter((l) => l.childId !== id);
    delete sensitiveConsent[id];
  },

  async createRecord(childId: string, input: RecordInput): Promise<DailyRecord> {
    // 실제 백엔드에서는 RLS(has_sensitive_consent)가 차단 — mock에서도 동일 동작
    if (!consentOf(childId)) {
      throw new Error('건강정보 수집 동의가 철회된 상태입니다. 설정에서 재동의 후 기록할 수 있어요.');
    }
    const record: DailyRecord = {
      ...input,
      id: newId('rec'),
      childId,
      authorId: guardian?.id ?? 'guardian-1',
    };
    data.records.push(record);
    return record;
  },

  async deleteRecord(id: string) {
    data.records = data.records.filter((r) => r.id !== id);
    data.recordAcknowledgements = data.recordAcknowledgements.filter((a) => a.recordId !== id);
  },

  async acknowledgeRecord(recordId: string) {
    const record = data.records.find((r) => r.id === recordId);
    if (!record) throw new Error('기록을 찾을 수 없습니다');
    const guardianId = guardian?.id ?? 'guardian-1';
    if (!guardians.some((g) => g.childId === record.childId && g.guardianId === guardianId)) throw new Error('이 기록을 확인할 권한이 없습니다');
    // Supabase RLS의 has_sensitive_consent(record.child_id)와 같은 gate다.
    // 동의를 철회한 뒤에는 기존 건강 기록의 전달 상태도 새로 남기지 않는다.
    if (!consentOf(record.childId)) throw new Error('건강정보 수집 동의가 철회된 상태입니다. 재동의 후 기록을 확인할 수 있어요.');
    if (!data.recordAcknowledgements.some((a) => a.recordId === recordId && a.guardianId === guardianId)) {
      data.recordAcknowledgements.push({ recordId, guardianId, acknowledgedAt: new Date().toISOString() });
    }
  },

  async listRecordAcknowledgements(childId: string): Promise<RecordAcknowledgement[]> {
    const recordIds = new Set(data.records.filter((r) => r.childId === childId).map((r) => r.id));
    return data.recordAcknowledgements.filter((a) => recordIds.has(a.recordId));
  },

  async createCareTask(input): Promise<CareTask> {
    if ((myRoles()[input.childId] ?? 'owner') === 'viewer') throw new Error('열람 전용 권한에서는 지시를 등록할 수 없습니다');
    if (!consentOf(input.childId)) throw new Error('건강정보 수집 동의가 철회된 상태입니다. 재동의 후 안내를 기록할 수 있어요.');
    if (!input.title.trim()) throw new Error('전달할 내용을 입력해 주세요');
    if (input.recordId && !data.records.some((r) => r.id === input.recordId && r.childId === input.childId)) throw new Error('연결할 기록을 찾을 수 없습니다');
    if (input.assigneeId && !guardians.some((g) => g.childId === input.childId && g.guardianId === input.assigneeId)) throw new Error('담당 보호자를 찾을 수 없습니다');
    const task: CareTask = { ...input, id: newId('care'), createdBy: guardian?.id ?? 'guardian-1', createdAt: new Date().toISOString() };
    data.careTasks.push(task);
    return task;
  },

  async listCareTasks(childId: string): Promise<CareTask[]> {
    return data.careTasks.filter((t) => t.childId === childId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async completeCareTask(taskId: string) {
    const task = data.careTasks.find((t) => t.id === taskId);
    if (!task) throw new Error('지시를 찾을 수 없습니다');
    const guardianId = guardian?.id ?? 'guardian-1';
    const role = myRoles()[task.childId] ?? 'owner';
    if (role === 'viewer' || (task.assigneeId && task.assigneeId !== guardianId && role !== 'owner')) throw new Error('이 지시를 완료할 권한이 없습니다');
    // RLS update policy의 has_sensitive_consent(child_id)를 mock에도 보존한다.
    if (!consentOf(task.childId)) throw new Error('건강정보 수집 동의가 철회된 상태입니다. 재동의 후 안내를 완료할 수 있어요.');
    task.completedAt = new Date().toISOString();
  },

  async addVaccination(v: Omit<Vaccination, 'id'>): Promise<Vaccination> {
    const vacc: Vaccination = { ...v, id: newId('vacc') };
    data.vaccinations.push(vacc);
    return vacc;
  },

  async updateVaccination(id: string, patch: Partial<Vaccination>) {
    data.vaccinations = data.vaccinations.map((v) => (v.id === id ? { ...v, ...patch } : v));
  },

  async addCheckup(c: Omit<Checkup, 'id'>): Promise<Checkup> {
    const checkup: Checkup = { ...c, id: newId('chk') };
    data.checkups.push(checkup);
    return checkup;
  },

  async setSubscriptionTier(tier: SubscriptionTier): Promise<Subscription> {
    subscription = { tier };
    return subscription;
  },

  async saveSettings(patch: Partial<UserSettings>): Promise<UserSettings> {
    settings = { ...settings, ...patch };
    return { ...settings };
  },

  async revokeSensitiveConsent(childId: string) {
    sensitiveConsent[childId] = false;
  },

  async grantSensitiveConsent(childId: string) {
    sensitiveConsent[childId] = true;
  },

  async publishReport(input): Promise<Report> {
    const report: Report = {
      id: newId('report'),
      childId: input.childId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      questionsForDoctor: input.questionsForDoctor,
      storagePath: `${input.childId}/mock.pdf`,
      createdAt: new Date().toISOString(),
    };
    reports.push(report);
    return report;
  },

  async createShareLink(reportId: string, expiresInHours: number): Promise<ShareLinkInfo> {
    const report = reports.find((r) => r.id === reportId);
    if (!report) throw new Error('레포트를 찾을 수 없습니다');
    const link: ShareLinkInfo = {
      id: newId('link'),
      reportId,
      childId: report.childId,
      url: `https://carenote.example/share/${Math.random().toString(36).slice(2, 14)}`,
      expiresAt: new Date(Date.now() + expiresInHours * 3600_000).toISOString(),
      periodStart: report.periodStart,
      periodEnd: report.periodEnd,
    };
    shareLinks.push(link);
    return link;
  },

  async listShareLinks(childId: string): Promise<ShareLinkInfo[]> {
    return shareLinks.filter((l) => l.childId === childId);
  },

  async revokeShareLink(linkId: string) {
    shareLinks = shareLinks.map((l) =>
      l.id === linkId ? { ...l, revokedAt: new Date().toISOString() } : l);
  },

  async listGuardians(childId: string): Promise<ChildGuardian[]> {
    return guardians.filter((g) => g.childId === childId);
  },

  async inviteGuardian(childId: string, email: string, role: 'editor' | 'viewer') {
    requireOwner(childId);
    const existing = guardians.find(
      (g) => g.childId === childId && g.name === email.split('@')[0]);
    if (existing) {
      if (existing.role === 'owner') throw new Error('owner 역할은 변경할 수 없습니다');
      existing.role = role;
      return;
    }
    // 서버(invite_guardian RPC)와 동일한 공동 보호자 한도 — mock에서도 미러
    const coCount = guardians.filter((g) => g.childId === childId && g.role !== 'owner').length;
    const maxCo = ENTITLEMENTS[subscription.tier].maxCoGuardians;
    if (coCount >= maxCo) {
      throw new Error(maxCo === 0
        ? '공동 보호자 초대는 스탠다드 플랜부터 가능해요.'
        : `현재 플랜에서는 대상자당 공동 보호자를 ${maxCo}명까지 초대할 수 있어요.`);
    }
    guardians.push({
      guardianId: newId('guardian'), childId, role,
      name: email.split('@')[0], relationship: '보호자', isMe: false,
    });
  },

  async updateGuardianRole(childId: string, guardianId: string, role: 'editor' | 'viewer') {
    const actorId = requireOwner(childId);
    const target = guardians.find((g) => g.childId === childId && g.guardianId === guardianId);
    if (!target || target.guardianId === actorId || target.role === 'owner') {
      throw new Error('변경할 공동 보호자를 찾을 수 없습니다');
    }
    guardians = guardians.map((g) =>
      g.childId === childId && g.guardianId === guardianId ? { ...g, role } : g);
  },

  async transferGuardianOwnership(childId: string, guardianId: string) {
    const actorId = guardian?.id ?? 'guardian-1';
    const actor = guardians.find((g) => g.childId === childId && g.guardianId === actorId);
    const target = guardians.find((g) => g.childId === childId && g.guardianId === guardianId);
    if (actor?.role !== 'owner') throw new Error('대상자의 소유자만 소유권을 이전할 수 있습니다');
    if (!target || target.role !== 'editor') throw new Error('소유권은 현재 편집자에게만 이전할 수 있습니다');
    guardians = guardians.map((g) => {
      if (g.childId !== childId) return g;
      if (g.guardianId === actorId) return { ...g, role: 'editor' };
      if (g.guardianId === guardianId) return { ...g, role: 'owner' };
      return g;
    });
  },

  async removeGuardian(childId: string, guardianId: string) {
    const actorId = requireOwner(childId);
    const target = guardians.find((g) => g.childId === childId && g.guardianId === guardianId);
    if (!target || target.guardianId === actorId || target.role === 'owner') {
      throw new Error('제거할 공동 보호자를 찾을 수 없습니다');
    }
    guardians = guardians.filter(
      (g) => !(g.childId === childId && g.guardianId === guardianId));
  },
};

// 모든 메서드를 감싸: 호출 전 기기 저장본 하이드레이션, 변이 성공 후 자동 저장.
// 읽기 메서드(loadAll 등)는 저장을 건너뛴다.
const READ_ONLY = new Set(['loadAll', 'restoreSession', 'listGuardians', 'listShareLinks', 'getAccountAuthMethods', 'listRecordAcknowledgements', 'listCareTasks']);

export const memoryRepo: Repo = {
  mode: 'mock',
  ...(Object.fromEntries(
    (Object.keys(base) as (keyof Repo)[])
      .filter((k) => k !== 'mode')
      .map((k) => [k, async (...args: unknown[]) => {
        await hydrate();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (base[k] as any)(...args);
        if (!READ_ONLY.has(k)) persist();
        return result;
      }]),
  ) as unknown as Omit<Repo, 'mode'>),
  // 구독은 동기 계약이어야 하므로 async 영속화 프록시를 통과시키지 않는다.
  subscribePasswordRecovery: base.subscribePasswordRecovery,
};
