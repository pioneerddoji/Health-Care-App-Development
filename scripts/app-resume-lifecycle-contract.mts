import {
  AppResumeLifecycle,
  type ResumeClient,
} from '../src/services/appResumeLifecycle';

let pass = 0;
const failures: string[] = [];
const ok = (condition: boolean, label: string) => {
  if (condition) pass++;
  else failures.push(label);
};
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const profile = { id: 'guardian-1', name: '보호자', relationship: '보호자' };
const activeClient = (overrides: Partial<ResumeClient> = {}): ResumeClient => ({
  restoreSession: async () => profile,
  loadAll: async () => {},
  notificationDenied: async () => false,
  processAuthUrl: async () => {},
  ...overrides,
});

{
  const states: string[] = [];
  const lifecycle = new AppResumeLifecycle(activeClient(), {
    now: () => 100,
    onPending: () => states.push('pending'),
    onConfirmed: ({ notificationDenied }) => states.push(`confirmed:${notificationDenied}`),
    onInvalidated: () => states.push('invalidated'),
  });
  lifecycle.onAppStateChange('background');
  lifecycle.onAppStateChange('active');
  await flush();
  ok(states.join(',') === 'pending,confirmed:false', 'background→active confirms session and notification state before success');
  lifecycle.dispose();
}

{
  let restores = 0;
  const lifecycle = new AppResumeLifecycle(activeClient({
    restoreSession: async () => { restores++; return profile; },
  }), { now: () => 100, onPending: () => {}, onConfirmed: () => {}, onInvalidated: () => {} });
  lifecycle.onAppStateChange('background');
  lifecycle.onAppStateChange('active');
  lifecycle.onAppStateChange('active');
  await flush();
  ok(restores === 1, 'duplicate active event does not create a second refresh');
  lifecycle.dispose();
}

{
  let urls = 0;
  let now = 100;
  const lifecycle = new AppResumeLifecycle(activeClient({
    processAuthUrl: async () => { urls++; },
  }), { now: () => now, onPending: () => {}, onConfirmed: () => {}, onInvalidated: () => {} });
  await lifecycle.onUrl('not a url');
  await lifecycle.onUrl('https://example.test/#type=recovery');
  await lifecycle.onUrl('carenote://#type=recovery&access_token=secret');
  await lifecycle.onUrl('carenote://#type=recovery&access_token=secret');
  now += 31_000;
  await lifecycle.onUrl('carenote://#type=recovery&access_token=secret');
  ok(urls === 2, 'malformed/non-app and duplicate URLs are ignored without leaking query values');
  lifecycle.dispose();
}

{
  let rejected = 0;
  const lifecycle = new AppResumeLifecycle(activeClient({
    processAuthUrl: async () => { throw new Error('rejected'); },
  }), {
    now: () => 100,
    onPending: () => {},
    onConfirmed: () => {},
    onInvalidated: () => {},
    onUrlRejected: () => { rejected++; },
  });
  await lifecycle.onUrl('carenote://#type=recovery&access_token=secret');
  ok(rejected === 1, 'rejected app URL exposes only a generic fail-closed callback');
  lifecycle.dispose();
}

{
  const states: string[] = [];
  const lifecycle = new AppResumeLifecycle(activeClient({
    loadAll: async () => { throw new Error('offline'); },
  }), { now: () => 100, onPending: () => states.push('pending'), onConfirmed: () => states.push('confirmed'), onInvalidated: () => states.push('invalidated') });
  lifecycle.onAppStateChange('inactive');
  lifecycle.onAppStateChange('active');
  await flush();
  ok(states.join(',') === 'pending,invalidated', 'offline or partial refresh fails closed without confirmed state');
  lifecycle.dispose();
}

{
  let release!: () => void;
  let restores = 0;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const lifecycle = new AppResumeLifecycle(activeClient({
    restoreSession: async () => { restores++; await pending; return profile; },
  }), { now: () => 100, onPending: () => {}, onConfirmed: () => {}, onInvalidated: () => {} });
  lifecycle.onAppStateChange('background');
  lifecycle.onAppStateChange('active');
  lifecycle.onAppStateChange('inactive');
  lifecycle.onAppStateChange('active');
  release();
  await flush(); await flush();
  ok(restores === 2, 'back-to-back background transitions serialize one follow-up refresh');
  lifecycle.dispose();
}

{
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let callbacks = 0;
  const lifecycle = new AppResumeLifecycle(activeClient({
    restoreSession: async () => { await pending; return profile; },
  }), { now: () => 100, onPending: () => callbacks++, onConfirmed: () => callbacks++, onInvalidated: () => callbacks++ });
  lifecycle.onAppStateChange('background');
  lifecycle.onAppStateChange('active');
  lifecycle.dispose();
  release();
  await flush();
  ok(callbacks === 1, 'dispose prevents post-unmount confirmation callbacks');
}

console.log(`APP_RESUME_LIFECYCLE PASS=${pass} FAIL=${failures.length}`);
if (failures.length) {
  failures.forEach((failure) => console.error(`FAIL: ${failure}`));
  process.exit(1);
}
