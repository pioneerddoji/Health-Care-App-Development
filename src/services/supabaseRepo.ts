// Supabase 저장소 — schema.sql(RLS 포함)과 1:1로 대응.
// 사진은 Storage 'record-files' 버킷에 childId/recordId/파일명 경로로 올리고,
// 화면에는 서명 URL(24시간)로 내려준다. payload JSONB는 앱과 같은 camelCase.
import * as FileSystem from 'expo-file-system/legacy';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import * as QueryParams from 'expo-auth-session/build/QueryParams';
import { supabase, supabaseUrl } from '../lib/supabase';
import { consentPlanFor } from '../lib/recipient';
import type { Repo, AllData, AuthOutcome, SignUpInput } from './repo';
import { SOCIAL_PROVIDERS, type SocialProvider } from './socialAuth';
import type {
  Child, ChildGuardian, ChildInput, Checkup, DailyRecord, GrowthMeasurement,
  GuardianRole, Medication, Profile, RecordInput, Report, ShareLinkInfo,
  Subscription, SubscriptionTier, UserSettings, Vaccination,
} from '../types';

const sb = () => {
  if (!supabase) throw new Error('Supabase가 설정되지 않았습니다 (.env 확인)');
  return supabase;
};

const RECORD_BUCKET = 'record-files';
const REPORTS_BUCKET = 'reports';
const SIGNED_URL_TTL = 60 * 60 * 24; // 24시간

// ── base64 → bytes (RN에는 atob/Buffer가 없음) ──────────────────
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const base64ToBytes = (b64: string): Uint8Array => {
  const clean = b64.replace(/[=\s]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i + 1 < clean.length; i += 4) {
    const n =
      (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1]) << 12) |
      ((B64.indexOf(clean[i + 2]) & 63) << 6) | (B64.indexOf(clean[i + 3]) & 63);
    out[o++] = (n >> 16) & 255;
    if (clean[i + 2] !== undefined) out[o++] = (n >> 8) & 255;
    if (clean[i + 3] !== undefined) out[o++] = n & 255;
  }
  return out.subarray(0, o);
};

// ── 행 매핑 (snake_case DB ↔ camelCase 도메인) ──────────────────
/* eslint-disable @typescript-eslint/no-explicit-any */
const childFromRow = (r: any): Child => ({
  id: r.id,
  name: r.name,
  nickname: r.nickname ?? undefined,
  birthDate: r.birth_date,
  sex: r.sex,
  birthWeightG: r.birth_weight_g ?? undefined,
  birthHeightCm: r.birth_height_cm != null ? Number(r.birth_height_cm) : undefined,
  gestationalWeeks: r.gestational_weeks ?? undefined,
  isPreterm: r.is_preterm,
  bloodType: r.blood_type ?? undefined,
  allergies: r.allergies ?? [],
  chronicConditions: r.chronic_conditions ?? [],
  surgeries: r.surgeries ?? [],
  hospitalizations: r.hospitalizations ?? [],
  primaryDoctor: r.primary_doctor ?? undefined,
  primaryHospital: r.primary_hospital ?? undefined,
  guardianPhone: r.guardian_phone ?? undefined,
  otherNotes: r.other_notes ?? undefined,
  // schema_recipients.sql 적용 전 저장본 호환 — 컬럼이 없으면 아이로 간주
  recipientType: r.recipient_type ?? 'child',
  isSelf: r.is_self ?? false,
});

const childToRow = (c: Partial<ChildInput>) => {
  const row: Record<string, unknown> = {};
  if (c.name !== undefined) row.name = c.name;
  if (c.nickname !== undefined) row.nickname = c.nickname ?? null;
  if (c.birthDate !== undefined) row.birth_date = c.birthDate;
  if (c.sex !== undefined) row.sex = c.sex;
  if (c.birthWeightG !== undefined) row.birth_weight_g = c.birthWeightG ?? null;
  if (c.birthHeightCm !== undefined) row.birth_height_cm = c.birthHeightCm ?? null;
  if (c.gestationalWeeks !== undefined) row.gestational_weeks = c.gestationalWeeks ?? null;
  if (c.isPreterm !== undefined) row.is_preterm = c.isPreterm;
  if (c.bloodType !== undefined) row.blood_type = c.bloodType ?? null;
  if (c.allergies !== undefined) row.allergies = c.allergies;
  if (c.chronicConditions !== undefined) row.chronic_conditions = c.chronicConditions;
  if (c.surgeries !== undefined) row.surgeries = c.surgeries;
  if (c.hospitalizations !== undefined) row.hospitalizations = c.hospitalizations;
  if (c.primaryDoctor !== undefined) row.primary_doctor = c.primaryDoctor ?? null;
  if (c.primaryHospital !== undefined) row.primary_hospital = c.primaryHospital ?? null;
  if (c.guardianPhone !== undefined) row.guardian_phone = c.guardianPhone ?? null;
  if (c.otherNotes !== undefined) row.other_notes = c.otherNotes ?? null;
  if (c.recipientType !== undefined) row.recipient_type = c.recipientType;
  if (c.isSelf !== undefined) row.is_self = c.isSelf;
  return row;
};

const hhmm = (t: string | null): string | undefined => (t ? t.slice(0, 5) : undefined);

const recordFromRow = (r: any, photoUris: string[] = []): DailyRecord => ({
  id: r.id,
  childId: r.child_id,
  authorId: r.author_id,
  recordDate: r.record_date,
  recordTime: hhmm(r.record_time),
  type: r.type,
  categories: r.categories ?? [],
  payload: r.payload ?? {},
  memo: r.memo ?? undefined,
  photoUris,
});

const growthFromRow = (r: any): GrowthMeasurement => ({
  id: r.id,
  childId: r.child_id,
  measuredOn: r.measured_on,
  heightCm: r.height_cm != null ? Number(r.height_cm) : undefined,
  weightKg: r.weight_kg != null ? Number(r.weight_kg) : undefined,
  headCm: r.head_cm != null ? Number(r.head_cm) : undefined,
  bmi: r.bmi != null ? Number(r.bmi) : undefined,
});

const medicationFromRow = (r: any): Medication => ({
  id: r.id,
  childId: r.child_id,
  name: r.name,
  doseText: r.dose_text ?? undefined,
  scheduleText: r.schedule_text ?? undefined,
  startDate: r.start_date ?? undefined,
  endDate: r.end_date ?? undefined,
  prescriber: r.prescriber ?? undefined,
  isActive: r.is_active,
});

const vaccinationFromRow = (r: any): Vaccination => ({
  id: r.id,
  childId: r.child_id,
  vaccineName: r.vaccine_name,
  doseNo: r.dose_no,
  dueDate: r.due_date ?? undefined,
  doneDate: r.done_date ?? undefined,
  hospital: r.hospital ?? undefined,
  adverseReaction: r.adverse_reaction ?? undefined,
});

const checkupFromRow = (r: any): Checkup => ({
  id: r.id,
  childId: r.child_id,
  checkupName: r.checkup_name,
  dueDate: r.due_date ?? undefined,
  doneDate: r.done_date ?? undefined,
  hospital: r.hospital ?? undefined,
  resultSummary: r.result_summary ?? undefined,
});
const reportFromRow = (r: any): Report => ({
  id: r.id,
  childId: r.child_id,
  periodStart: r.period_start,
  periodEnd: r.period_end,
  questionsForDoctor: r.questions_for_doctor ?? [],
  storagePath: r.storage_path ?? undefined,
  createdAt: r.created_at,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

const throwIf = (error: { message: string } | null): void => {
  if (error) throw new Error(error.message);
};


const currentUserId = async (): Promise<string> => {
  const { data } = await sb().auth.getUser();
  if (!data.user) throw new Error('로그인이 필요합니다');
  return data.user.id;
};

// 서버 my_tier()와 동일한 판정: 행 없음/비활성/만료 → free
const fetchSubscription = async (userId: string): Promise<Subscription> => {
  const { data } = await sb().from('subscriptions')
    .select('tier, status, expires_at').eq('user_id', userId).maybeSingle();
  if (!data || data.status !== 'active') return { tier: 'free' };
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return { tier: 'free' };
  return { tier: data.tier as SubscriptionTier, expiresAt: data.expires_at ?? undefined };
};

const fetchProfile = async (userId: string): Promise<Profile | null> => {
  const { data } = await sb().from('profiles').select('*').eq('id', userId).maybeSingle();
  if (!data) return null;
  return { id: data.id, name: data.name, phone: data.phone ?? undefined, relationship: data.relationship };
};

// ── 사진 업로드 / 서명 URL ──────────────────────────────────────
const guessMime = (uri: string): string => {
  const ext = uri.split('?')[0].split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'heic' || ext === 'heif') return 'image/heic';
  return 'image/jpeg';
};

const uploadLocalFile = async (
  bucket: string, path: string, localUri: string, contentType: string,
): Promise<void> => {
  const b64 = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
  const { error } = await sb().storage
    .from(bucket)
    .upload(path, base64ToBytes(b64).buffer as ArrayBuffer, { contentType, upsert: true });
  throwIf(error);
};

const uploadPhoto = async (childId: string, recordId: string, uri: string, idx: number): Promise<string> => {
  const ext = uri.split('?')[0].split('.').pop()?.toLowerCase() ?? 'jpg';
  const path = `${childId}/${recordId}/${Date.now()}-${idx}.${ext}`;
  await uploadLocalFile(RECORD_BUCKET, path, uri, guessMime(uri));
  return path;
};

/** prefix(childId/…) 아래의 모든 파일을 재귀적으로 찾아 삭제 — 완전 삭제용 */
const removeAllUnderPrefix = async (bucket: string, prefix: string): Promise<void> => {
  const client = sb();
  const collect = async (dir: string): Promise<string[]> => {
    const { data, error } = await client.storage.from(bucket).list(dir, { limit: 1000 });
    throwIf(error);
    const files: string[] = [];
    for (const item of data ?? []) {
      const path = `${dir}/${item.name}`;
      if (item.id === null) files.push(...(await collect(path))); // 폴더
      else files.push(path);
    }
    return files;
  };
  const files = await collect(prefix);
  if (files.length > 0) {
    const { error } = await client.storage.from(bucket).remove(files);
    throwIf(error);
  }
};

const signPaths = async (paths: string[]): Promise<Map<string, string>> => {
  const map = new Map<string, string>();
  if (paths.length === 0) return map;
  const { data, error } = await sb().storage.from(RECORD_BUCKET).createSignedUrls(paths, SIGNED_URL_TTL);
  throwIf(error);
  for (const item of data ?? []) {
    if (item.signedUrl && item.path) map.set(item.path, item.signedUrl);
  }
  return map;
};

// ── Repo 구현 ──────────────────────────────────────────────────
export const supabaseRepo: Repo = {
  mode: 'supabase',

  async signUp(input: SignUpInput): Promise<AuthOutcome> {
    // 이메일 확인이 켜져 세션이 즉시 없더라도 user_metadata는 Auth에 보존된다.
    // 첫 세션에서 아래 signIn이 이를 profiles 행으로 안전하게 완성한다.
    const { data, error } = await sb().auth.signUp({
      email: input.email,
      password: input.password,
      options: { data: { name: input.name, relationship: input.relationship, phone: input.phone ?? null } },
    });
    if (error) return { error: error.message };
    if (!data.session || !data.user) return { needsEmailConfirm: true };
    const profile: Profile = {
      id: data.user.id, name: input.name, relationship: input.relationship, phone: input.phone,
    };
    const { error: pErr } = await sb().from('profiles').upsert({
      id: profile.id, name: profile.name, relationship: profile.relationship, phone: profile.phone ?? null,
    });
    if (pErr) return { error: pErr.message };
    return { profile };
  },

  async signIn(email: string, password: string): Promise<AuthOutcome> {
    const { data, error } = await sb().auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    let profile = await fetchProfile(data.user.id);
    if (!profile) {
      // 이메일 확인 후 첫 로그인: 가입 당시 Auth metadata를 사용한다. 이메일 앞부분으로
      // 덮어쓰면 이름·관계·연락처가 유실되므로, 값이 없을 때만 보수적 기본값을 쓴다.
      const meta = data.user.user_metadata as Record<string, unknown> | null;
      profile = {
        id: data.user.id,
        name: typeof meta?.name === 'string' && meta.name.trim() ? meta.name : email.split('@')[0],
        relationship: typeof meta?.relationship === 'string' && meta.relationship.trim()
          ? meta.relationship : '보호자',
        phone: typeof meta?.phone === 'string' && meta.phone.trim() ? meta.phone : undefined,
      };
      const { error: pErr } = await sb().from('profiles').upsert({
        id: profile.id, name: profile.name, relationship: profile.relationship, phone: profile.phone ?? null,
      });
      if (pErr) return { error: pErr.message };
    }
    return { profile };
  },

  async signInWithSocial(provider: SocialProvider): Promise<AuthOutcome> {
    // Supabase OAuth: 브라우저(웹은 팝업)에서 공급자 인증 → redirect URL의
    // 토큰으로 세션 수립. 공급자가 바뀌어도 흐름은 같아서 provider 만 갈아 끼운다.
    // 선행 설정(공급자 콘솔 + Supabase Providers + Redirect URLs)은 docs/09 §2-2-1.
    //
    // ⚠️ 이 경로는 **implicit 흐름**(URL 에 access_token 이 실려 옴)을 전제한다.
    //    supabase-js 의 기본값이라 지금은 맞지만, 클라이언트를 `flowType: 'pkce'`
    //    로 바꾸면 code 만 오므로 exchangeCodeForSession() 으로 교체해야 한다.
    const label = SOCIAL_PROVIDERS[provider].short;
    const redirectTo = makeRedirectUri(); // 웹: 현재 origin / 앱: carenote:// (app.json scheme)
    const { data, error } = await sb().auth.signInWithOAuth({
      provider,
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error) return { error: error.message };

    // 웹에서는 팝업이 열린다. 팝업이 우리 주소로 돌아오면 그 안에서 앱 번들이
    // 다시 로드되고, App.tsx 의 WebBrowser.maybeCompleteAuthSession() 이
    // 부모 창에 결과를 넘겨 준다 — 그 호출이 없으면 여기서 영원히 기다린다.
    const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (res.type !== 'success') return { error: `${label} 로그인이 취소되었습니다.` };
    const { params, errorCode } = QueryParams.getQueryParams(res.url);
    if (errorCode) return { error: errorCode };
    if (!params.access_token || !params.refresh_token) {
      return { error: `${label} 인증 토큰을 받지 못했습니다. 잠시 후 다시 시도해 주세요.` };
    }
    const { data: sess, error: sErr } = await sb().auth.setSession({
      access_token: params.access_token, refresh_token: params.refresh_token,
    });
    if (sErr || !sess.user) return { error: sErr?.message ?? '세션 생성에 실패했습니다.' };

    let profile = await fetchProfile(sess.user.id);
    const isNewUser = !profile;
    if (!profile) {
      // 첫 소셜 로그인 — 공급자가 준 이름으로 프로필 생성, 이후 동의 화면을 거친다.
      // 카카오는 nickname, 구글은 full_name/name 으로 온다. 이름을 아예 안 주는
      // 경우(카카오 동의항목 미설정 등)도 있어 '보호자'로 떨어뜨린다.
      const meta = sess.user.user_metadata as Record<string, unknown> | null;
      const name =
        (meta?.name as string) ??
        (meta?.full_name as string) ??
        (meta?.nickname as string) ??
        '보호자';
      profile = { id: sess.user.id, name, relationship: '보호자' };
      const { error: pErr } = await sb().from('profiles').upsert({
        id: profile.id, name: profile.name, relationship: profile.relationship,
      });
      if (pErr) return { error: pErr.message };
    }
    return { profile, isNewUser };
  },

  async signOut() {
    await sb().auth.signOut();
  },

  async findEmailByPhone(): Promise<string | null> {
    // 클라이언트는 auth.users/타인 profiles를 조회할 수 없다.
    // 실서버 구현: definer RPC(find_email_by_phone) + SMS 공급자 연동 필요.
    throw new Error('아이디 찾기는 서버 RPC 연동 후 제공됩니다 (AGENTS.md §7 참조).');
  },

  async resetPassword(): Promise<void> {
    // 실서버 구현: Supabase 비밀번호 재설정(이메일 링크) 또는
    // SMS 인증 기반 Edge Function 필요.
    throw new Error('비밀번호 재설정은 서버 연동 후 제공됩니다 (AGENTS.md §7 참조).');
  },

  async requestPasswordResetEmail(email: string): Promise<void> {
    // 재설정 링크의 도착지(redirectTo)는 Supabase 대시보드의 Site URL 설정을 따른다
    // — 운영 프로젝트에서 재설정 웹 페이지 호스팅 후 URL 지정 필요 (docs/09 §2-3)
    const { error } = await sb().auth.resetPasswordForEmail(email);
    throwIf(error);
  },

  async completePasswordRecovery(newPassword: string): Promise<void> {
    const { error } = await sb().auth.updateUser({ password: newPassword });
    throwIf(error);
    // 복구 링크 세션은 최소 권한으로 짧게 유지하고, 비밀번호 변경 후 로그인 화면으로 돌린다.
    await sb().auth.signOut();
  },

  async deleteAccount({ password }: { password: string }): Promise<void> {
    // 실제 Auth 삭제/동의 이력 처리는 서비스 롤을 가진 별도 서버 계약의 책임이다.
    // 클라이언트는 Auth 관리 API나 관리자 키를 절대 사용하지 않는다. 운영 계약이 배포되기
    // 전에는 오삭제보다 명시적 중단이 안전하며, mock에서 상태 전이를 검증한다.
    const { data } = await sb().auth.getUser();
    if (!data.user?.email) throw new Error('계정 이메일을 확인할 수 없습니다. 다시 로그인해 주세요.');
    const { error } = await sb().auth.signInWithPassword({ email: data.user.email, password });
    if (error) throw new Error('현재 비밀번호가 일치하지 않습니다.');
    throw new Error('계정 삭제 서버 계약이 아직 배포되지 않았습니다. 고객센터에 문의해 주세요.');
  },

  async restoreSession(): Promise<Profile | null> {
    const { data } = await sb().auth.getSession();
    if (!data.session) return null;
    return fetchProfile(data.session.user.id);
  },

  async loadAll(): Promise<AllData> {
    const client = sb();
    const userId = await currentUserId();
    const [children, records, growth, medications, vaccinations, checkups, links, consents, settingsRow] = await Promise.all([
      client.from('children').select('*').is('deleted_at', null).order('birth_date'),
      client.from('daily_records').select('*, record_files(storage_path)')
        .order('record_date').order('record_time'),
      client.from('growth_measurements').select('*').order('measured_on'),
      client.from('medications').select('*').order('created_at'),
      client.from('vaccinations').select('*').order('due_date'),
      client.from('checkups').select('*').order('due_date'),
      client.from('guardian_child').select('child_id, role').eq('guardian_id', userId),
      client.from('consents').select('child_id')
        .eq('type', 'sensitive_health').is('revoked_at', null),
      client.from('user_settings').select('settings').eq('user_id', userId).maybeSingle(),
    ]);
    for (const res of [children, records, growth, medications, vaccinations, checkups, links, consents, settingsRow]) throwIf(res.error);

    const consentedChildIds = new Set(
      (consents.data ?? []).map((c: { child_id: string }) => c.child_id));

    // 사진 경로 일괄 서명
    const allPaths = (records.data ?? []).flatMap(
      (r: { record_files?: { storage_path: string }[] }) =>
        (r.record_files ?? []).map((f) => f.storage_path),
    );
    const signed = await signPaths(allPaths);

    return {
      children: (children.data ?? []).map(childFromRow),
      records: (records.data ?? []).map((r) =>
        recordFromRow(r, (r.record_files ?? [])
          .map((f: { storage_path: string }) => signed.get(f.storage_path))
          .filter((u: string | undefined): u is string => !!u)),
      ),
      growth: (growth.data ?? []).map(growthFromRow),
      medications: (medications.data ?? []).map(medicationFromRow),
      vaccinations: (vaccinations.data ?? []).map(vaccinationFromRow),
      checkups: (checkups.data ?? []).map(checkupFromRow),
      roles: Object.fromEntries(
        (links.data ?? []).map((l: { child_id: string; role: GuardianRole }) => [l.child_id, l.role]),
      ),
      sensitiveConsent: Object.fromEntries(
        (children.data ?? []).map((c: { id: string }) => [c.id, consentedChildIds.has(c.id)]),
      ),
      subscription: await fetchSubscription(userId),
      settings: (settingsRow.data?.settings as UserSettings | undefined) ?? {},
    };
  },

  async setSubscriptionTier(): Promise<Subscription> {
    throw new Error('플랜 변경은 앱스토어/플레이스토어 결제를 통해서만 가능합니다. (결제 연동은 docs/07_monetization.md 참조)');
  },

  async saveSettings(patch: Partial<UserSettings>): Promise<UserSettings> {
    const userId = await currentUserId();
    // 서버 병합: 현재 값을 읽어 patch만 덮어쓴 뒤 upsert
    const { data } = await sb().from('user_settings')
      .select('settings').eq('user_id', userId).maybeSingle();
    const merged: UserSettings = { ...((data?.settings as UserSettings | undefined) ?? {}), ...patch };
    const { error } = await sb().from('user_settings').upsert({
      user_id: userId, settings: merged, updated_at: new Date().toISOString(),
    });
    throwIf(error);
    return merged;
  },

  async createChild(input: ChildInput): Promise<Child> {
    const userId = await currentUserId();
    const { data, error } = await sb().from('children').insert(childToRow(input)).select().single();
    throwIf(error);
    const child = childFromRow(data);
    // owner 관계 + 동의(가입 시 동의 완료된 내용을 아이 단위로 기록 — RLS가 요구)
    const { error: gErr } = await sb().from('guardian_child')
      .insert({ guardian_id: userId, child_id: child.id, role: 'owner' });
    throwIf(gErr);
    // 동의는 대상자의 만 나이·본인 여부에 따라 갈린다 (lib/recipient.ts가 단일 원천)
    const { error: cErr } = await sb().from('consents').insert(
      consentPlanFor(input).types.map((type) => ({
        child_id: child.id, guardian_id: userId, type,
      })),
    );
    throwIf(cErr);
    return child;
  },

  async updateChild(id: string, patch: Partial<ChildInput>) {
    const { error } = await sb().from('children').update(childToRow(patch)).eq('id', id);
    throwIf(error);
  },

  async deleteChildAndData(id: string) {
    // 완전 삭제: Storage의 사진·PDF를 먼저 지우고(행이 지워지면 경로를 알 수 없음)
    // children 행 삭제 → FK cascade로 하위 데이터 전부 삭제
    await removeAllUnderPrefix(RECORD_BUCKET, id);
    await removeAllUnderPrefix(REPORTS_BUCKET, id);
    const { error } = await sb().from('children').delete().eq('id', id);
    throwIf(error);
  },

  async revokeSensitiveConsent(childId: string) {
    // 내 동의 행만 철회 가능(RLS) — createChild가 만든 동의는 나(owner)의 행이다
    const { error } = await sb().from('consents')
      .update({ revoked_at: new Date().toISOString() })
      .eq('child_id', childId).eq('type', 'sensitive_health').is('revoked_at', null);
    throwIf(error);
  },

  async grantSensitiveConsent(childId: string) {
    const userId = await currentUserId();
    const { error } = await sb().from('consents')
      .insert({ child_id: childId, guardian_id: userId, type: 'sensitive_health' });
    throwIf(error);
  },

  async createRecord(childId: string, input: RecordInput): Promise<DailyRecord> {
    const userId = await currentUserId();
    const { data, error } = await sb().from('daily_records').insert({
      child_id: childId,
      author_id: userId,
      record_date: input.recordDate,
      record_time: input.recordTime ?? null,
      type: input.type,
      categories: input.categories,
      payload: input.payload,
      memo: input.memo ?? null,
    }).select().single();
    throwIf(error);

    // 사진 업로드 → record_files 등록 → 표시용 서명 URL
    const paths: string[] = [];
    for (let i = 0; i < input.photoUris.length; i++) {
      paths.push(await uploadPhoto(childId, data.id, input.photoUris[i], i));
    }
    if (paths.length > 0) {
      const { error: fErr } = await sb().from('record_files').insert(
        paths.map((p) => ({ record_id: data.id, storage_path: p, mime_type: guessMime(p) })),
      );
      throwIf(fErr);
    }
    const signed = await signPaths(paths);
    return recordFromRow(data, paths.map((p) => signed.get(p)).filter((u): u is string => !!u));
  },

  async deleteRecord(id: string) {
    const { error } = await sb().from('daily_records').delete().eq('id', id);
    throwIf(error);
  },

  async addVaccination(v: Omit<Vaccination, 'id'>): Promise<Vaccination> {
    const { data, error } = await sb().from('vaccinations').insert({
      child_id: v.childId, vaccine_name: v.vaccineName, dose_no: v.doseNo,
      due_date: v.dueDate ?? null, done_date: v.doneDate ?? null,
      hospital: v.hospital ?? null, adverse_reaction: v.adverseReaction ?? null,
    }).select().single();
    throwIf(error);
    return vaccinationFromRow(data);
  },

  async updateVaccination(id: string, patch: Partial<Vaccination>) {
    const row: Record<string, unknown> = {};
    if (patch.dueDate !== undefined) row.due_date = patch.dueDate ?? null;
    if (patch.doneDate !== undefined) row.done_date = patch.doneDate ?? null;
    if (patch.hospital !== undefined) row.hospital = patch.hospital ?? null;
    if (patch.adverseReaction !== undefined) row.adverse_reaction = patch.adverseReaction ?? null;
    const { error } = await sb().from('vaccinations').update(row).eq('id', id);
    throwIf(error);
  },

  async addCheckup(c: Omit<Checkup, 'id'>): Promise<Checkup> {
    const { data, error } = await sb().from('checkups').insert({
      child_id: c.childId, checkup_name: c.checkupName,
      due_date: c.dueDate ?? null, done_date: c.doneDate ?? null,
      hospital: c.hospital ?? null, result_summary: c.resultSummary ?? null,
    }).select().single();
    throwIf(error);
    return checkupFromRow(data);
  },

  async publishReport(input): Promise<Report> {
    const userId = await currentUserId();
    const { data, error } = await sb().from('reports').insert({
      child_id: input.childId,
      created_by: userId,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      questions_for_doctor: input.questionsForDoctor,
    }).select().single();
    throwIf(error);

    const path = `${input.childId}/${data.id}.pdf`;
    await uploadLocalFile(REPORTS_BUCKET, path, input.localPdfUri, 'application/pdf');

    const { data: updated, error: updErr } = await sb().from('reports')
      .update({ storage_path: path }).eq('id', data.id).select().single();
    throwIf(updErr);
    if (!updated) throw new Error('레포트 갱신 결과를 확인할 수 없습니다');
    return reportFromRow(updated);
  },

  async createShareLink(reportId: string, expiresInHours: number): Promise<ShareLinkInfo> {
    if (!supabaseUrl) throw new Error('Supabase URL이 설정되지 않았습니다');
    const expiresAt = new Date(Date.now() + expiresInHours * 3600_000).toISOString();
    const { data, error } = await sb().from('share_links')
      .insert({ report_id: reportId, expires_at: expiresAt })
      .select('id, token, expires_at, report:reports(child_id, period_start, period_end)')
      .single();
    throwIf(error);
    if (!data) throw new Error('공유 링크 생성 결과를 확인할 수 없습니다');
    const report = data.report as unknown as { child_id: string; period_start: string; period_end: string };
    return {
      id: data.id,
      reportId,
      childId: report.child_id,
      url: `${supabaseUrl}/functions/v1/share-report?token=${data.token}`,
      expiresAt: data.expires_at,
      periodStart: report.period_start,
      periodEnd: report.period_end,
    };
  },

  async listShareLinks(childId: string): Promise<ShareLinkInfo[]> {
    if (!supabaseUrl) throw new Error('Supabase URL이 설정되지 않았습니다');
    const { data, error } = await sb().from('share_links')
      .select('id, report_id, token, expires_at, revoked_at, reports!inner(child_id, period_start, period_end)')
      .eq('reports.child_id', childId)
      .order('created_at', { ascending: false });
    throwIf(error);
    /* eslint-disable @typescript-eslint/no-explicit-any */
    return (data ?? []).map((row: any) => ({
      id: row.id,
      reportId: row.report_id,
      childId: row.reports.child_id,
      url: `${supabaseUrl}/functions/v1/share-report?token=${row.token}`,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at ?? undefined,
      periodStart: row.reports.period_start,
      periodEnd: row.reports.period_end,
    }));
    /* eslint-enable @typescript-eslint/no-explicit-any */
  },

  async revokeShareLink(linkId: string) {
    const { error } = await sb().from('share_links')
      .update({ revoked_at: new Date().toISOString() }).eq('id', linkId);
    throwIf(error);
  },

  async listGuardians(childId: string): Promise<ChildGuardian[]> {
    const userId = await currentUserId();
    const { data, error } = await sb().from('guardian_child')
      .select('guardian_id, child_id, role, profiles(name, relationship)')
      .eq('child_id', childId);
    throwIf(error);
    /* eslint-disable @typescript-eslint/no-explicit-any */
    return (data ?? []).map((row: any) => ({
      guardianId: row.guardian_id,
      childId: row.child_id,
      role: row.role,
      name: row.profiles?.name ?? '보호자',
      relationship: row.profiles?.relationship ?? undefined,
      isMe: row.guardian_id === userId,
    }));
    /* eslint-enable @typescript-eslint/no-explicit-any */
  },

  async inviteGuardian(childId: string, email: string, role: 'editor' | 'viewer') {
    const { error } = await sb().rpc('invite_guardian', {
      cid: childId, invitee_email: email, invite_role: role,
    });
    throwIf(error);
  },

  async updateGuardianRole(childId: string, guardianId: string, role: 'editor' | 'viewer') {
    const { error } = await sb().from('guardian_child')
      .update({ role }).eq('child_id', childId).eq('guardian_id', guardianId);
    throwIf(error);
  },

  async removeGuardian(childId: string, guardianId: string) {
    const { error } = await sb().from('guardian_child')
      .delete().eq('child_id', childId).eq('guardian_id', guardianId);
    throwIf(error);
  },
};
