import type { Profile } from '../types';

export type NativeAppState = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';

export interface ResumeClient {
  restoreSession(): Promise<Profile | null>;
  loadAll(): Promise<void>;
  notificationDenied(): Promise<boolean>;
  processAuthUrl(url: string): Promise<void>;
}

export interface ResumeCallbacks {
  now(): number;
  onPending(): void;
  onConfirmed(input: { profile: Profile; notificationDenied: boolean }): void;
  onInvalidated(): void;
  onUrlRejected?(): void;
}

const DUPLICATE_URL_WINDOW_MS = 30_000;

const urlFingerprint = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${hash >>> 0}:${value.length}`;
};

const isAppUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'carenote:' && !url.hostname;
  } catch {
    return false;
  }
};

/**
 * AppState와 Linking 이벤트를 UI에서 분리해 resume 시 성공 상태를 늦게 확정한다.
 * 모든 외부 확인(세션·데이터·권한)이 끝나기 전에는 onConfirmed를 호출하지 않는다.
 */
export class AppResumeLifecycle {
  private appState: NativeAppState = 'active';
  private refreshing = false;
  private refreshQueued = false;
  private disposed = false;
  private readonly seenUrls = new Map<string, number>();

  constructor(private readonly client: ResumeClient, private readonly callbacks: ResumeCallbacks) {}

  onAppStateChange(next: NativeAppState): void {
    if (this.disposed) return;
    const resumed = (this.appState === 'background' || this.appState === 'inactive') && next === 'active';
    this.appState = next;
    if (!resumed) return;
    if (this.refreshing) {
      this.refreshQueued = true;
      return;
    }
    void this.refresh();
  }

  async onUrl(url: string): Promise<void> {
    if (this.disposed || !isAppUrl(url)) return;
    const now = this.callbacks.now();
    const fingerprint = urlFingerprint(url);
    for (const [known, seenAt] of this.seenUrls) {
      if (now - seenAt > DUPLICATE_URL_WINDOW_MS) this.seenUrls.delete(known);
    }
    if (this.seenUrls.has(fingerprint)) return;
    this.seenUrls.set(fingerprint, now);
    try {
      await this.client.processAuthUrl(url);
    } catch {
      // URL query와 토큰은 기록하지 않는다. auth 처리기는 자체적으로 안전한 UI 오류만 만든다.
      if (!this.disposed) this.callbacks.onUrlRejected?.();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.refreshQueued = false;
    this.seenUrls.clear();
  }

  private async refresh(): Promise<void> {
    this.refreshing = true;
    this.callbacks.onPending();
    try {
      const profile = await this.client.restoreSession();
      if (!profile) throw new Error('no session');
      await this.client.loadAll();
      const notificationDenied = await this.client.notificationDenied();
      if (!this.disposed) this.callbacks.onConfirmed({ profile, notificationDenied });
    } catch {
      if (!this.disposed) this.callbacks.onInvalidated();
    } finally {
      this.refreshing = false;
      if (!this.disposed && this.refreshQueued) {
        this.refreshQueued = false;
        void this.refresh();
      }
    }
  }
}
