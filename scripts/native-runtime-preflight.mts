import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const issues: string[] = [];
let pass = 0;
const ok = (condition: boolean, label: string) => {
  if (condition) pass++;
  else issues.push(label);
};

const app = JSON.parse(read('app.json')) as { expo?: Record<string, unknown> };
const expo = app.expo ?? {};
const android = (expo.android ?? {}) as { permissions?: unknown };
const permissions = Array.isArray(android.permissions) ? android.permissions : [];
const plugins = Array.isArray(expo.plugins) ? expo.plugins : [];
const requireConfig = (value: unknown, key: string) => {
  if (!value) throw new Error(key);
};
const isValidNativeScheme = (value: unknown) => typeof value === 'string'
  && /^[A-Za-z][A-Za-z0-9+.-]*$/.test(value);
const validateConfig = (candidate: typeof app) => {
  const candidateExpo = candidate.expo ?? {};
  const candidateAndroid = (candidateExpo.android ?? {}) as { permissions?: unknown };
  const candidatePermissions = Array.isArray(candidateAndroid.permissions) ? candidateAndroid.permissions : [];
  const candidatePlugins = Array.isArray(candidateExpo.plugins) ? candidateExpo.plugins : [];
  requireConfig(isValidNativeScheme(candidateExpo.scheme), 'expo.scheme');
  requireConfig(candidatePermissions.includes('READ_MEDIA_IMAGES'), 'android.permissions.READ_MEDIA_IMAGES');
  requireConfig(candidatePermissions.includes('POST_NOTIFICATIONS'), 'android.permissions.POST_NOTIFICATIONS');
  requireConfig(candidatePlugins.includes('expo-notifications'), 'plugins.expo-notifications');
};

try { validateConfig(app); ok(true, 'Expo native config: scheme/photo/notification declarations'); }
catch (error) { ok(false, `Expo native config: ${String(error)}`); }

const dateField = read('src/components/DateField.tsx');
ok(dateField.includes('@react-native-community/datetimepicker')
  && dateField.includes("Platform.OS === 'android'")
  && dateField.includes("Platform.OS === 'ios'"), 'native date/time picker platform branches');

const recordForm = read('src/screens/records/RecordFormScreen.tsx');
ok(recordForm.includes('requestMediaLibraryPermissionsAsync')
  && recordForm.includes('launchImageLibraryAsync'), 'photo permission request and picker invocation');

const reportPdf = read('src/services/reportPdf.ts');
ok(reportPdf.includes('Print.printToFileAsync')
  && reportPdf.includes('Sharing.isAvailableAsync')
  && reportPdf.includes('Sharing.shareAsync'), 'PDF generation and share availability guard');

const reminders = read('src/services/reminders.ts');
ok(reminders.includes('getPermissionsAsync')
  && reminders.includes('requestPermissionsAsync')
  && reminders.includes('scheduleNotificationAsync')
  && reminders.includes("Platform.OS === 'web'"), 'notification permission and native-only scheduling guard');

const appContext = read('src/context/AppContext.tsx');
ok(appContext.includes("Linking.addEventListener('url'")
  && appContext.includes('Linking.getInitialURL()'), 'deep-link cold-start and foreground URL handlers');

const vaccination = read('src/screens/vaccination/VaccinationScreen.tsx');
ok(vaccination.includes('notificationDenied')
  && !vaccination.includes('isNotificationDenied'), 'mounted vaccination screen consumes authoritative foreground notification state');

const ui = read('src/components/ui.tsx');
const settings = read('src/screens/settings/SettingsScreen.tsx');
ok(ui.includes('accessibilityRole="button"')
  && ui.includes('accessibilityLabel={inputProps.accessibilityLabel ?? label}')
  && settings.includes('accessibilityLiveRegion="assertive"'), 'baseline button/input/error accessibility semantics');

const matrix = read('docs/18_internal_beta_native_runtime_gap_matrix.md');
ok(matrix.includes('not-proven') && matrix.includes('needs-device')
  && matrix.includes('AppState') && matrix.includes('캡틴 승인 게이트'), 'matrix preserves native unknowns and approval gates');

const fixture = JSON.parse(read('scripts/fixtures/native-runtime-preflight-missing-notifications.json')) as {
  appJson: typeof app; expectedError: string;
};
try {
  validateConfig(fixture.appJson);
  ok(false, 'negative fixture rejects missing notification config');
} catch (error) {
  ok(String(error).includes(fixture.expectedError), 'negative fixture rejects missing notification config');
}

const invalidSchemeFixture = JSON.parse(read('scripts/fixtures/native-runtime-preflight-invalid-scheme.json')) as {
  appJson: typeof app; expectedError: string;
};
try {
  validateConfig(invalidSchemeFixture.appJson);
  ok(false, 'negative fixture rejects invalid native scheme');
} catch (error) {
  ok(String(error).includes(invalidSchemeFixture.expectedError), 'negative fixture rejects invalid native scheme');
}

const malformedSchemeFixture = JSON.parse(read('scripts/fixtures/native-runtime-preflight-malformed-scheme.json')) as {
  appJson: typeof app; expectedError: string;
};
try {
  validateConfig(malformedSchemeFixture.appJson);
  ok(false, 'negative fixture rejects malformed native scheme');
} catch (error) {
  ok(String(error).includes(malformedSchemeFixture.expectedError), 'negative fixture rejects malformed native scheme');
}

console.log(`NATIVE_RUNTIME_PREFLIGHT PASS=${pass} FAIL=${issues.length}`);
if (issues.length) {
  for (const issue of issues) console.error(`FAIL: ${issue}`);
  process.exit(1);
}
