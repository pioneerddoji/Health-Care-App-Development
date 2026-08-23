import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const issues: string[] = [];
const blockers: string[] = [];
let pass = 0;

const ok = (condition: boolean, label: string) => {
  if (condition) pass++;
  else issues.push(label);
};
const blocked = (condition: boolean, label: string) => {
  if (condition) blockers.push(label);
  else issues.push(`expected blocked gate missing: ${label}`);
};

const app = JSON.parse(read('app.json')) as {
  expo?: {
    scheme?: unknown;
    extra?: Record<string, unknown>;
    ios?: { supportsTablet?: unknown; bundleIdentifier?: unknown; buildNumber?: unknown; infoPlist?: Record<string, unknown> };
  };
};
const eas = JSON.parse(read('eas.json')) as {
  build?: Record<string, { distribution?: unknown; channel?: unknown; env?: Record<string, unknown> }>;
  submit?: { production?: { ios?: { ascAppId?: unknown } } };
};
const expo = app.expo ?? {};
const ios = expo.ios ?? {};
const preview = eas.build?.preview ?? {};
const isValidScheme = (value: unknown) => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9+.-]*$/.test(value);

ok(isValidScheme(expo.scheme), 'valid native deep-link scheme');
ok(ios.supportsTablet === false && typeof ios.buildNumber === 'string' && ios.buildNumber.length > 0,
  'iOS form factor and build-number declarations');
ok(typeof ios.infoPlist?.NSPhotoLibraryUsageDescription === 'string'
  && ios.infoPlist.NSPhotoLibraryUsageDescription.length > 0
  && ios.infoPlist.ITSAppUsesNonExemptEncryption === false,
'iOS photo permission and export-compliance declarations');
ok(preview.distribution === 'internal' && preview.channel === 'preview'
  && preview.env?.APP_ENV === 'preview', 'credentialless preview profile is internal/preview only');
ok(expo.extra?.supabaseUrl === '' && expo.extra?.supabaseAnonKey === '',
  'committed Expo config contains no Supabase values');

blocked(ios.bundleIdentifier === 'app.carenote.mvp', 'placeholder iOS bundle identifier requires Captain approval');
blocked(eas.submit?.production?.ios?.ascAppId === 'TODO_APP_STORE_CONNECT_APP_ID',
  'placeholder App Store Connect application id requires Captain approval');

const billing = read('src/services/billing.ts');
ok(billing.includes("return repoMode === 'mock' ? 'demo' : 'hidden';")
  && billing.includes("process.env.EXPO_PUBLIC_RC_API_KEY_IOS"),
'payment is hidden by default outside mock mode and iOS live key is external');
blocked(billing.includes('RevenueCat 대시보드 + env 키 주입'),
  'RevenueCat product, key, webhook, and billing approval remain external');

const social = read('src/services/socialAuth.ts');
ok(social.includes("return repoMode === 'mock';") && social.includes("iOS 출시 시 'apple' 추가 필요"),
  'social OAuth defaults off in Supabase mode and Apple-login gap is explicit');
blocked(social.includes('공급자 콘솔') && social.includes('Supabase → Authentication → Providers'),
  'OAuth provider and redirect allow-list approval remain external');

const supabase = read('src/lib/supabase.ts');
ok(supabase.includes('url && anonKey') && supabase.includes('export const isMockMode = supabase === null;'),
  'missing Supabase configuration fails closed to mock mode');
blocked(read('docs/06_deployment.md').includes('법률 검토 필수')
  && read('docs/privacy_policy.md').includes('초안'),
  'privacy policy, terms, deletion URL, and App Privacy metadata remain approval gates');
blocked(read('docs/18_internal_beta_native_runtime_gap_matrix.md').includes('needs-device'),
  'VoiceOver speech, OS picker focus trap, and device exploration remain needs-device');

console.log(`IOS_PREVIEW_READINESS PASS=${pass} BLOCKED_GATES=${blockers.length} FAIL=${issues.length}`);
for (const label of blockers) console.log(`BLOCKED: ${label}`);
if (issues.length) {
  for (const issue of issues) console.error(`FAIL: ${issue}`);
  process.exit(1);
}
