/*
 * P0 내부 QA용 5분 WOW 퍼널. 앱 데이터나 telemetry를 전송하지 않는 순수 상태기계이며,
 * 모든 외부 mutation은 서버가 circle/id를 포함해 확정하기 전에는 다음 단계로 진행하지 않는다.
 */
export type WowRole = 'owner' | 'editor' | 'viewer';
export type WowStage = 'entry' | 'first_recorded' | 'invite_created' | 'invite_accepted' | 'other_guardian_confirmed' | 'briefing_preview';

export interface ServerConfirmation {
  confirmed: boolean;
  circleId: string;
  id?: string;
  reason?: 'cancelled' | 'expired' | 'duplicate' | 'partial' | 'rejected';
}

export interface FiveMinuteWowDependencies {
  clock: { now: () => number };
  network: { isOnline: () => boolean };
  auth: { roleFor: (circleId: string) => WowRole; hasSensitiveConsent: (subjectId: string) => boolean };
  record: { submit: (input: { circleId: string; subjectId: string }) => Promise<ServerConfirmation> };
  invite: {
    create: (input: { circleId: string }) => Promise<ServerConfirmation>;
    accept: (input: { circleId: string }) => Promise<ServerConfirmation>;
  };
  guardian: { confirm: (input: { circleId: string }) => Promise<ServerConfirmation> };
  briefing: { preview: (input: { circleId: string; subjectId: string }) => Promise<ServerConfirmation> };
}

export interface FiveMinuteWowSnapshot {
  circleId: string;
  subjectId: string;
  stage: WowStage;
  startedAtMs: number;
}

export interface FiveMinuteWowView {
  stage: WowStage;
  tabs: readonly ['홈', '기록', '설정', '레포트'];
  tabCount: 4;
  syntheticElapsedMs: number;
  withinFiveMinutes: boolean;
  retryable: boolean;
  successVisible: boolean;
  error?: string;
}

const TABS = ['홈', '기록', '설정', '레포트'] as const;
const FIVE_MINUTES_MS = 5 * 60_000;

const stageIndex = (stage: WowStage): number => [
  'entry', 'first_recorded', 'invite_created', 'invite_accepted', 'other_guardian_confirmed', 'briefing_preview',
].indexOf(stage);

export class FiveMinuteWowJourney {
  private stage: WowStage;
  private readonly startedAtMs: number;
  private lastError: string | undefined;

  constructor(
    private readonly deps: FiveMinuteWowDependencies,
    private readonly ids: Pick<FiveMinuteWowSnapshot, 'circleId' | 'subjectId'>,
    snapshot?: Pick<FiveMinuteWowSnapshot, 'stage' | 'startedAtMs'>,
  ) {
    if (!ids.circleId || !ids.subjectId) throw new Error('circle과 대상자 식별자가 필요합니다');
    if (snapshot && stageIndex(snapshot.stage) < 0) throw new Error('알 수 없는 퍼널 단계입니다');
    // Persisted snapshots are caller-controlled. The final UI state is never resumable
    // without asking the briefing boundary to confirm it again on the server.
    this.stage = snapshot?.stage === 'briefing_preview' ? 'other_guardian_confirmed' : (snapshot?.stage ?? 'entry');
    this.startedAtMs = snapshot?.startedAtMs ?? deps.clock.now();
  }

  static resume(deps: FiveMinuteWowDependencies, snapshot: FiveMinuteWowSnapshot): FiveMinuteWowJourney {
    return new FiveMinuteWowJourney(deps, snapshot, snapshot);
  }

  snapshot(): FiveMinuteWowSnapshot {
    return Object.freeze({ ...this.ids, stage: this.stage, startedAtMs: this.startedAtMs });
  }

  view(): FiveMinuteWowView {
    const syntheticElapsedMs = Math.max(0, this.deps.clock.now() - this.startedAtMs);
    return Object.freeze({
      stage: this.stage,
      tabs: TABS,
      tabCount: 4,
      syntheticElapsedMs,
      withinFiveMinutes: syntheticElapsedMs <= FIVE_MINUTES_MS,
      retryable: !!this.lastError,
      successVisible: this.stage === 'briefing_preview',
      ...(this.lastError ? { error: this.lastError } : {}),
    });
  }

  async recordFirstObservation(): Promise<void> {
    this.requireStage('entry');
    this.requireOnline();
    this.requireConsent();
    this.requireEditor();
    const result = await this.deps.record.submit(this.ids);
    this.confirm(result, '첫 기록');
    this.advance('first_recorded');
  }

  async createInvite(): Promise<void> {
    this.requireStage('first_recorded');
    this.requireOnline();
    this.requireConsent();
    this.requireOwner();
    const result = await this.deps.invite.create({ circleId: this.ids.circleId });
    this.confirm(result, '초대');
    this.advance('invite_created');
  }

  async acceptInvite(): Promise<void> {
    this.requireStage('invite_created');
    this.requireOnline();
    const result = await this.deps.invite.accept({ circleId: this.ids.circleId });
    this.confirm(result, '초대 수락');
    this.advance('invite_accepted');
  }

  async confirmOtherGuardian(): Promise<void> {
    this.requireStage('invite_accepted');
    this.requireOnline();
    let result: ServerConfirmation;
    try {
      result = await this.deps.guardian.confirm({ circleId: this.ids.circleId });
    } catch {
      this.fail('다른 보호자 확인이 서버에서 확정되지 않았습니다');
    }
    this.confirm(result!, '다른 보호자 확인');
    this.advance('other_guardian_confirmed');
  }

  async previewBriefing(): Promise<void> {
    this.requireStage('other_guardian_confirmed');
    this.requireOnline();
    this.requireConsent();
    this.requireEditor();
    const result = await this.deps.briefing.preview(this.ids);
    this.confirm(result, '병원 브리핑 미리보기');
    this.advance('briefing_preview');
  }

  private advance(stage: WowStage): void {
    this.stage = stage;
    this.lastError = undefined;
  }

  private fail(message: string): never {
    this.lastError = message;
    throw new Error(message);
  }

  private requireStage(expected: WowStage): void {
    if (this.stage !== expected) this.fail(`${expected} 단계에서만 실행할 수 있습니다`);
  }

  private requireOnline(): void {
    if (!this.deps.network.isOnline()) this.fail('네트워크 연결을 확인한 뒤 다시 시도해 주세요');
  }

  private requireConsent(): void {
    if (!this.deps.auth.hasSensitiveConsent(this.ids.subjectId)) this.fail('건강정보 동의가 필요합니다');
  }

  private requireEditor(): void {
    if (this.deps.auth.roleFor(this.ids.circleId) === 'viewer') this.fail('현재 역할에서는 기록 또는 브리핑을 수정할 수 없습니다');
  }

  private requireOwner(): void {
    if (this.deps.auth.roleFor(this.ids.circleId) !== 'owner') this.fail('현재 역할에서는 보호자를 초대할 수 없습니다');
  }

  private confirm(result: ServerConfirmation, action: string): void {
    if (result?.confirmed !== true || typeof result.id !== 'string' || !result.id || result.circleId !== this.ids.circleId) {
      this.fail(`${action}이 서버에서 확정되지 않았습니다${result?.reason ? ` (${result.reason})` : ''}`);
    }
  }
}
