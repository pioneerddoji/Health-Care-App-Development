// 앱 전역 상태 — 저장소 계층(repo)의 캐시.
// mock 모드: 샘플 데이터 / supabase 모드: 로그인 후 서버에서 로드.
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';
import { Linking } from 'react-native';
import type {
  CareTask, Child, ChildGuardian, ChildInput, Checkup, DailyRecord, GrowthMeasurement,
  GuardianRole, ISODate, Medication, Profile, RecordInput, Report,
  ShareLinkInfo, Subscription, SubscriptionTier, UserSettings, Vaccination,
} from '../types';
import { repo, SignUpInput } from '../services/repo';
import type { SocialProvider } from '../services/socialAuth';
import type { AccountDeletionResult } from '../services/accountDeletion';
import { cancelReminder, scheduleDueDateReminder } from '../services/reminders';
import { initBilling, endBillingSession } from '../services/billing';
import { ENTITLEMENTS, TierEntitlements } from '../constants/subscription';

interface AppState {
  mode: 'mock' | 'supabase';
  booting: boolean;                          // 세션 복원 중
  guardian: Profile | null;
  consented: boolean;                        // 법정대리인 + 민감정보 동의 완료 여부
  children: Child[];
  records: DailyRecord[];
  growth: GrowthMeasurement[];
  medications: Medication[];
  vaccinations: Vaccination[];
  checkups: Checkup[];
  careTasks: CareTask[];
  selectedChildId: string | null;
  selectedChild: Child | null;

  /** 아이별 내 역할 — 알 수 없으면 owner로 간주(mock) */
  roleOf: (childId: string) => GuardianRole;
  /** viewer가 아니면 true (기록/수정 가능) */
  canEdit: (childId: string) => boolean;
  /** 민감정보 동의 유효 여부 — false면 새 기록 입력 차단 */
  consentActive: (childId: string) => boolean;
  revokeSensitiveConsent: (childId: string) => Promise<void>;
  grantSensitiveConsent: (childId: string) => Promise<void>;

  /** 현재 구독과 티어별 한도 — 게이팅은 이 값만 참조 */
  subscription: Subscription;
  ent: TierEntitlements;
  /** 데모 모드 전용 티어 전환 (supabase 모드는 스토어 결제 안내 오류) */
  setSubscriptionTier: (tier: SubscriptionTier) => Promise<void>;
  /** 전체 데이터 재로드 — 결제 후 서버 티어 반영 등 (billing.ts 참조) */
  loadAll: () => Promise<void>;

  /** 사용자별 설정 (대시보드 순서 등) — 계정 단위 저장, 부분 병합 갱신 */
  settings: UserSettings;
  updateSettings: (patch: Partial<UserSettings>) => Promise<void>;

  /** 성공 시 null, 실패 시 오류 메시지 반환 */
  signIn: (email: string, password: string) => Promise<string | null>;
  /** 소셜 로그인(카카오/구글) — 첫 진입이면 동의 화면으로 이어진다. 성공 시 null */
  signInWithSocial: (provider: SocialProvider) => Promise<string | null>;
  /** 성공 시 null, 이메일 확인 필요 시 'confirm', 실패 시 오류 메시지 */
  signUp: (input: SignUpInput) => Promise<string | null>;
  signOut: () => Promise<void>;
  grantConsents: () => void;
  findEmailByPhone: (phone: string) => Promise<string | null>;
  resetPassword: (email: string, phone: string, newPassword: string) => Promise<void>;
  requestPasswordResetEmail: (email: string) => Promise<void>;
  completePasswordRecovery: (newPassword: string) => Promise<void>;
  recoveryRequest: { active: boolean; error?: string };
  dismissRecovery: () => void;
  getAccountAuthMethods: () => Promise<('email' | SocialProvider)[]>;
  deleteAccount: (input: { password?: string; socialProvider?: SocialProvider }) => Promise<AccountDeletionResult>;

  selectChild: (id: string) => void;
  createChild: (input: ChildInput) => Promise<Child>;
  updateChild: (id: string, patch: Partial<ChildInput>) => Promise<void>;
  deleteChildAndData: (id: string) => Promise<void>;

  createRecord: (childId: string, input: RecordInput) => Promise<DailyRecord>;
  deleteRecord: (id: string) => Promise<void>;
  acknowledgeRecord: (recordId: string) => Promise<void>;
  createCareTask: (input: Omit<CareTask, 'id' | 'createdBy' | 'createdAt' | 'completedAt'>) => Promise<void>;
  completeCareTask: (taskId: string) => Promise<void>;

  addVaccination: (v: Omit<Vaccination, 'id'>) => Promise<void>;
  updateVaccination: (id: string, patch: Partial<Vaccination>) => Promise<void>;
  addCheckup: (c: Omit<Checkup, 'id'>) => Promise<void>;

  listGuardians: (childId: string) => Promise<ChildGuardian[]>;
  inviteGuardian: (childId: string, email: string, role: 'editor' | 'viewer') => Promise<void>;
  updateGuardianRole: (childId: string, guardianId: string, role: 'editor' | 'viewer') => Promise<void>;
  transferGuardianOwnership: (childId: string, guardianId: string) => Promise<void>;
  removeGuardian: (childId: string, guardianId: string) => Promise<void>;

  publishReport: (input: {
    childId: string; localPdfUri: string; periodStart: ISODate; periodEnd: ISODate;
    questionsForDoctor: string[];
  }) => Promise<Report>;
  createShareLink: (reportId: string, expiresInHours: number) => Promise<ShareLinkInfo>;
  listShareLinks: (childId: string) => Promise<ShareLinkInfo[]>;
  revokeShareLink: (linkId: string) => Promise<void>;
}

const AppContext = createContext<AppState | null>(null);

export const AppProvider = ({ children: node }: { children: React.ReactNode }) => {
  const [booting, setBooting] = useState(true);
  const [guardian, setGuardian] = useState<Profile | null>(null);
  const [consented, setConsented] = useState(false);
  const [children, setChildren] = useState<Child[]>([]);
  const [records, setRecords] = useState<DailyRecord[]>([]);
  const [growth, setGrowth] = useState<GrowthMeasurement[]>([]);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [vaccinations, setVaccinations] = useState<Vaccination[]>([]);
  const [checkups, setCheckups] = useState<Checkup[]>([]);
  const [careTasks, setCareTasks] = useState<CareTask[]>([]);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
  const [roles, setRoles] = useState<Record<string, GuardianRole>>({});
  const [sensitiveConsent, setSensitiveConsent] = useState<Record<string, boolean>>({});
  const [subscription, setSubscription] = useState<Subscription>({ tier: 'free' });
  const [settings, setSettings] = useState<UserSettings>({});
  const [recoveryRequest, setRecoveryRequest] = useState<{ active: boolean; error?: string }>({ active: false });

  const loadAll = useCallback(async () => {
    const all = await repo.loadAll();
    setChildren(all.children);
    setRecords(all.records);
    setGrowth(all.growth);
    setMedications(all.medications);
    setVaccinations(all.vaccinations);
    setCheckups(all.checkups);
    setCareTasks(all.careTasks);
    setRoles(all.roles);
    setSensitiveConsent(all.sensitiveConsent);
    setSubscription(all.subscription);
    setSettings(all.settings);
    setSelectedChildId((cur) =>
      cur && all.children.some((c) => c.id === cur) ? cur : all.children[0]?.id ?? null);
  }, []);

  // 앱 시작: 저장된 세션 복원 (supabase 모드)
  useEffect(() => {
    (async () => {
      try {
        const profile = await repo.restoreSession();
        if (profile) {
          setGuardian(profile);
          setConsented(true); // 기존 계정은 가입 시 동의 완료
          initBilling(repo.mode, profile.id).catch(() => {});
          await loadAll();
        }
      } finally {
        setBooting(false);
      }
    })();
  }, [loadAll]);

  useEffect(() => {
    const unsubscribe = repo.subscribePasswordRecovery((error) =>
      setRecoveryRequest({ active: true, error }));
    const handleUrl = ({ url }: { url: string }) => {
      repo.processAuthLink(url).catch((error) => setRecoveryRequest({
        active: true, error: error instanceof Error ? error.message : String(error),
      }));
    };
    const subscription = Linking.addEventListener('url', handleUrl);
    Linking.getInitialURL().then((url) => { if (url) handleUrl({ url }); }).catch(() => {});
    return () => { unsubscribe(); subscription.remove(); };
  }, []);

  const value = useMemo<AppState>(() => ({
    mode: repo.mode,
    booting,
    guardian,
    consented,
    children,
    records,
    growth,
    medications,
    vaccinations,
    checkups,
    careTasks,
    selectedChildId,
    selectedChild: children.find((c) => c.id === selectedChildId) ?? null,

    roleOf: (childId) => roles[childId] ?? 'owner',
    canEdit: (childId) => (roles[childId] ?? 'owner') !== 'viewer',
    consentActive: (childId) => sensitiveConsent[childId] ?? true,

    revokeSensitiveConsent: async (childId) => {
      await repo.revokeSensitiveConsent(childId);
      setSensitiveConsent((prev) => ({ ...prev, [childId]: false }));
    },

    grantSensitiveConsent: async (childId) => {
      await repo.grantSensitiveConsent(childId);
      setSensitiveConsent((prev) => ({ ...prev, [childId]: true }));
    },

    subscription,
    ent: ENTITLEMENTS[subscription.tier],
    setSubscriptionTier: async (tier) => {
      setSubscription(await repo.setSubscriptionTier(tier));
    },
    loadAll,

    settings,
    updateSettings: async (patch) => {
      setSettings(await repo.saveSettings(patch));
    },

    signIn: async (email, password) => {
      const out = await repo.signIn(email, password);
      if (out.error) return out.error;
      setGuardian(out.profile ?? null);
      setConsented(true); // 기존 계정은 가입 시 동의 완료
      if (out.profile) initBilling(repo.mode, out.profile.id).catch(() => {});
      await loadAll();
      return null;
    },

    signInWithSocial: async (provider) => {
      const out = await repo.signInWithSocial(provider);
      if (out.error) return out.error;
      setGuardian(out.profile ?? null);
      setConsented(!out.isNewUser); // 첫 진입은 동의 화면을 거친다
      if (out.profile) initBilling(repo.mode, out.profile.id).catch(() => {});
      await loadAll();
      return null;
    },

    signUp: async (input) => {
      const out = await repo.signUp(input);
      if (out.error) return out.error;
      if (out.needsEmailConfirm) return 'confirm';
      setGuardian(out.profile ?? null);
      setConsented(false); // 신규 가입은 동의 화면을 거친다
      if (out.profile) initBilling(repo.mode, out.profile.id).catch(() => {});
      await loadAll();
      return null;
    },

    signOut: async () => {
      await endBillingSession().catch(() => {});
      await repo.signOut();
      setGuardian(null);
      setConsented(false);
      setChildren([]); setRecords([]); setGrowth([]);
      setMedications([]); setVaccinations([]); setCheckups([]);
      setSelectedChildId(null);
      setSettings({});
    },

    grantConsents: () => setConsented(true),
    findEmailByPhone: (phone) => repo.findEmailByPhone(phone),
    resetPassword: (email, phone, pw) => repo.resetPassword(email, phone, pw),
    requestPasswordResetEmail: (email) => repo.requestPasswordResetEmail(email),
    completePasswordRecovery: async (newPassword) => {
      await repo.completePasswordRecovery(newPassword);
      setGuardian(null); setConsented(false);
      setRecoveryRequest({ active: false });
    },
    recoveryRequest,
    dismissRecovery: () => setRecoveryRequest({ active: false }),
    getAccountAuthMethods: () => repo.getAccountAuthMethods(),
    deleteAccount: async (input) => {
      const result = await repo.deleteAccount(input);
      if (result.status === 'completed') {
        setGuardian(null); setConsented(false);
        setChildren([]); setRecords([]); setGrowth([]); setMedications([]);
        setVaccinations([]); setCheckups([]); setSelectedChildId(null); setSettings({});
      }
      return result;
    },

    selectChild: setSelectedChildId,

    createChild: async (input) => {
      const child = await repo.createChild(input);
      setChildren((prev) => [...prev, child]);
      setRoles((prev) => ({ ...prev, [child.id]: 'owner' }));
      setSensitiveConsent((prev) => ({ ...prev, [child.id]: true }));
      setSelectedChildId(child.id);
      return child;
    },

    updateChild: async (id, patch) => {
      await repo.updateChild(id, patch);
      setChildren((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    },

    deleteChildAndData: async (id) => {
      await repo.deleteChildAndData(id);
      setChildren((prev) => prev.filter((c) => c.id !== id));
      setRecords((prev) => prev.filter((r) => r.childId !== id));
      setGrowth((prev) => prev.filter((g) => g.childId !== id));
      setMedications((prev) => prev.filter((m) => m.childId !== id));
      setVaccinations((prev) => prev.filter((v) => v.childId !== id));
      setCheckups((prev) => prev.filter((c) => c.childId !== id));
      setRoles(({ [id]: _r, ...rest }) => rest);
      setSensitiveConsent(({ [id]: _c, ...rest }) => rest);
      setSelectedChildId((cur) => (cur === id ? null : cur));
    },

    createRecord: async (childId, input) => {
      const record = await repo.createRecord(childId, input);
      setRecords((prev) => [...prev, record]);
      return record;
    },

    deleteRecord: async (id) => {
      await repo.deleteRecord(id);
      setRecords((prev) => prev.filter((r) => r.id !== id));
    },
    acknowledgeRecord: (recordId) => repo.acknowledgeRecord(recordId),
    createCareTask: async (input) => {
      const task = await repo.createCareTask(input);
      setCareTasks((prev) => [task, ...prev]);
      if (task.dueDate) scheduleDueDateReminder({
        id: `care-${task.id}`, title: '보호자 확인 알림', body: task.title, dueDate: task.dueDate,
      }).catch(() => {});
    },
    completeCareTask: async (taskId) => {
      await repo.completeCareTask(taskId);
      setCareTasks((prev) => prev.map((t) => t.id === taskId
        ? { ...t, completedAt: new Date().toISOString() } : t));
      cancelReminder(`care-${taskId}`).catch(() => {});
    },

    addVaccination: async (v) => {
      const vacc = await repo.addVaccination(v);
      setVaccinations((prev) => [...prev, vacc]);
      if (vacc.dueDate) {
        const child = children.find((c) => c.id === vacc.childId);
        scheduleDueDateReminder({
          id: `vacc-${vacc.id}`,
          title: '예방접종 예정일 알림',
          body: `${child?.name ?? '아이'} — ${vacc.vaccineName} ${vacc.doseNo}차 예정일이 곧 다가와요`,
          dueDate: vacc.dueDate,
        }).catch(() => {});
      }
    },

    updateVaccination: async (id, patch) => {
      await repo.updateVaccination(id, patch);
      setVaccinations((prev) => prev.map((v) => (v.id === id ? { ...v, ...patch } : v)));
      if (patch.doneDate) {
        cancelReminder(`vacc-${id}`).catch(() => {});
      } else if (patch.dueDate) {
        const vacc = vaccinations.find((v) => v.id === id);
        const child = children.find((c) => c.id === vacc?.childId);
        scheduleDueDateReminder({
          id: `vacc-${id}`,
          title: '예방접종 예정일 알림',
          body: `${child?.name ?? '아이'} — ${vacc?.vaccineName ?? ''} 예정일이 곧 다가와요`,
          dueDate: patch.dueDate,
        }).catch(() => {});
      }
    },

    addCheckup: async (c) => {
      const checkup = await repo.addCheckup(c);
      setCheckups((prev) => [...prev, checkup]);
      if (checkup.dueDate) {
        const child = children.find((ch) => ch.id === checkup.childId);
        scheduleDueDateReminder({
          id: `checkup-${checkup.id}`,
          title: '건강검진 예정일 알림',
          body: `${child?.name ?? '아이'} — ${checkup.checkupName} 예정일이 곧 다가와요`,
          dueDate: checkup.dueDate,
        }).catch(() => {});
      }
    },

    listGuardians: (childId) => repo.listGuardians(childId),
    inviteGuardian: (childId, email, role) => repo.inviteGuardian(childId, email, role),
    updateGuardianRole: (childId, guardianId, role) =>
      repo.updateGuardianRole(childId, guardianId, role),
    transferGuardianOwnership: (childId, guardianId) =>
      repo.transferGuardianOwnership(childId, guardianId),
    removeGuardian: (childId, guardianId) => repo.removeGuardian(childId, guardianId),

    publishReport: (input) => repo.publishReport(input),
    createShareLink: (reportId, expiresInHours) => repo.createShareLink(reportId, expiresInHours),
    listShareLinks: (childId) => repo.listShareLinks(childId),
    revokeShareLink: (linkId) => repo.revokeShareLink(linkId),
  }), [booting, guardian, consented, children, records, growth, medications,
       vaccinations, checkups, careTasks, selectedChildId, roles, sensitiveConsent, subscription,
       settings, recoveryRequest, loadAll]);

  return <AppContext.Provider value={value}>{node}</AppContext.Provider>;
};

export const useApp = (): AppState => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
};
