import assert from 'node:assert/strict';
import { validateEvidencePackage } from './validate-device-qa-evidence';

type EvidenceState = 'proven' | 'not-proven' | 'needs-device';
type Result = 'PASS' | 'FAIL' | 'ABORT';

const requiredAreas = [
  'screen-reader',
  'picker-focus',
  'permissions',
  'pdf-share',
  'notification-deep-link',
  'app-resume',
] as const;

const makeCheck = (platform: 'android' | 'ios', area: typeof requiredAreas[number]) => ({
  id: `${platform}-${area}`,
  platform,
  area,
  preconditions: ['QA-only build is installed', 'network-dependent integrations remain disabled'],
  testDataClass: 'synthetic',
  steps: ['Perform the documented action using non-identifying test data'],
  expected: 'The protected workflow completes without data loss or sensitive disclosure.',
  actual: 'Not run: physical-device evidence is intentionally pending approval.',
  captureReference: `qa://pending/${platform}/${area}`,
  result: 'ABORT' as Result,
  evidenceState: 'needs-device' as EvidenceState,
  abortReason: 'Awaiting separately approved physical-device QA.',
  rollback: 'Keep the candidate Draft; do not build, upload, or connect external services.',
});

const makeValidPackage = () => ({
  schemaVersion: '1.0',
  source: {
    exactCommitSha: '7cb43eed5b532c236f6ed7d91f9a35a82fbdcd16',
    draftPullRequestUrl: 'https://github.com/pioneerddoji/Health-Care-App-Development/pull/22',
    currentHeadCiUrl: 'https://github.com/pioneerddoji/Health-Care-App-Development/actions/runs/32676272592',
    reviewVerdictUrl: 'kanban://task/t_d5098b8a/run/162',
  },
  devices: [
    { platform: 'android', osVersion: 'synthetic-android-os', appBuildIdentifier: 'qa-android-build' },
    { platform: 'ios', osVersion: 'synthetic-ios-os', appBuildIdentifier: 'qa-ios-build' },
  ],
  checks: (['android', 'ios'] as const).flatMap((platform) =>
    requiredAreas.map((area) => makeCheck(platform, area))),
});

const expectInvalid = (evidence: unknown, detail: string) => {
  const result = validateEvidencePackage(evidence);
  assert.equal(result.valid, false, detail);
  return result.errors;
};

const valid = validateEvidencePackage(makeValidPackage());
assert.equal(valid.valid, true, valid.errors.join('\n'));

const missingRequiredField = makeValidPackage();
delete (missingRequiredField.checks[0] as Partial<typeof missingRequiredField.checks[number]>).rollback;
expectInvalid(missingRequiredField, 'required rollback must fail closed');

const prohibitedSensitiveData = makeValidPackage();
prohibitedSensitiveData.checks[0].actual = 'Patient email: qa.person@example.com';
expectInvalid(prohibitedSensitiveData, 'email addresses must fail closed');

const absolutePath = makeValidPackage();
absolutePath.checks[0].captureReference = 'file:///opt/data/private/capture.png';
expectInvalid(absolutePath, 'absolute local paths must fail closed');

const tokenLikeNestedValue = makeValidPackage();
tokenLikeNestedValue.checks[0].steps = ['Keep only synthetic data', 'github_pat_placeholder_not_a_real_credential'];
assert.ok(
  expectInvalid(tokenLikeNestedValue, 'nested token-like values must fail closed').some((error) => error.includes('prohibited sensitive value')),
  'nested token-like values must report the sensitive-value constraint',
);

const tokenLikeValueAfterColon = makeValidPackage();
tokenLikeValueAfterColon.checks[0].actual = 'synthetic marker:github_pat_placeholder';
assert.ok(
  expectInvalid(tokenLikeValueAfterColon, 'token-like markers after punctuation must fail closed').some((error) => error.includes('prohibited sensitive value')),
  'token-like markers after punctuation must report the sensitive-value constraint',
);

const macosAbsolutePath = makeValidPackage();
macosAbsolutePath.checks[0].actual = '/Users/example/private/capture.png';
expectInvalid(macosAbsolutePath, 'macOS absolute paths must fail closed');

const unixAbsolutePath = makeValidPackage();
unixAbsolutePath.checks[0].actual = '/var/private/capture.png';
expectInvalid(unixAbsolutePath, 'POSIX absolute paths must fail closed');

const colonPrefixedMacosAbsolutePath = makeValidPackage();
colonPrefixedMacosAbsolutePath.checks[0].actual = 'value:/Users/example/private/capture.png';
expectInvalid(colonPrefixedMacosAbsolutePath, 'colon-prefixed macOS absolute paths must fail closed');

const colonPrefixedUnixAbsolutePath = makeValidPackage();
colonPrefixedUnixAbsolutePath.checks[0].actual = 'value:/var/private/capture.png';
expectInvalid(colonPrefixedUnixAbsolutePath, 'colon-prefixed POSIX absolute paths must fail closed');

const stateMismatch = makeValidPackage();
stateMismatch.checks[0].result = 'PASS';
expectInvalid(stateMismatch, 'PASS cannot claim needs-device');

const missingCoverage = makeValidPackage();
missingCoverage.checks = missingCoverage.checks.filter((check) => check.platform !== 'ios');
expectInvalid(missingCoverage, 'both platforms and every required QA area must be covered');

const duplicateCheckId = makeValidPackage();
duplicateCheckId.checks[1].id = duplicateCheckId.checks[0].id;
assert.ok(
  expectInvalid(duplicateCheckId, 'duplicate check ids must fail closed').some((error) => error.includes('id must be unique')),
  'duplicate check id must report its unique constraint',
);

const duplicatePlatformArea = makeValidPackage();
duplicatePlatformArea.checks[1].id = 'android-screen-reader-copy';
duplicatePlatformArea.checks[1].area = 'screen-reader';
assert.ok(
  expectInvalid(duplicatePlatformArea, 'duplicate platform-area coverage must fail closed').some((error) => error.includes('platform and area combination must be unique')),
  'duplicate platform-area must report its unique constraint',
);

(
  [
    ['exactCommitSha', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
    ['draftPullRequestUrl', 'https://github.com/example/example/pull/999'],
    ['currentHeadCiUrl', 'https://github.com/example/example/actions/runs/999'],
    ['reviewVerdictUrl', 'kanban://task/t_other/run/999'],
  ] as const
).forEach(([field, replacement]) => {
  const sourceMismatch = makeValidPackage();
  sourceMismatch.source[field] = replacement;
  assert.ok(
    expectInvalid(sourceMismatch, `${field} must match the approved parent source`).some((error) => error === `source.${field} must match the approved decision packet`),
    `${field} mismatch must report the approved decision packet constraint`,
  );
});

const negativeFixtureMatrix: Array<[string, () => unknown]> = [
  ['unknown top-level field', () => ({ ...makeValidPackage(), unexpected: 'reject' })],
  ['unknown nested check field', () => {
    const evidence = makeValidPackage();
    (evidence.checks[0] as typeof evidence.checks[number] & { unexpected?: string }).unexpected = 'reject';
    return evidence;
  }],
  ['malformed source SHA', () => {
    const evidence = makeValidPackage();
    evidence.source.exactCommitSha = 'not-a-sha';
    return evidence;
  }],
  ['malformed source URL', () => {
    const evidence = makeValidPackage();
    evidence.source.currentHeadCiUrl = 'http://invalid.example/ci';
    return evidence;
  }],
  ['PASS proven mismatch', () => {
    const evidence = makeValidPackage();
    evidence.checks[0].result = 'PASS';
    evidence.checks[0].evidenceState = 'not-proven';
    return evidence;
  }],
  ['ABORT without reason', () => {
    const evidence = makeValidPackage();
    evidence.checks[0].abortReason = '';
    return evidence;
  }],
  ['synthetic phone-like value', () => {
    const evidence = makeValidPackage();
    evidence.checks[0].actual = 'Synthetic contact +1 555 010 9999';
    return evidence;
  }],
  ['nested Korean health-data label', () => {
    const evidence = makeValidPackage();
    evidence.checks[0].steps = ['Use synthetic values only', 'Do not record 건강정보'];
    return evidence;
  }],
  ['token-like marker after colon', () => {
    const evidence = makeValidPackage();
    evidence.checks[0].actual = 'synthetic marker:github_pat_placeholder';
    return evidence;
  }],
  ['macOS absolute path', () => {
    const evidence = makeValidPackage();
    evidence.checks[0].actual = '/Users/example/private/capture.png';
    return evidence;
  }],
  ['POSIX absolute path', () => {
    const evidence = makeValidPackage();
    evidence.checks[0].actual = '/var/private/capture.png';
    return evidence;
  }],
  ['colon-prefixed macOS absolute path', () => {
    const evidence = makeValidPackage();
    evidence.checks[0].actual = 'value:/Users/example/private/capture.png';
    return evidence;
  }],
  ['colon-prefixed POSIX absolute path', () => {
    const evidence = makeValidPackage();
    evidence.checks[0].actual = 'value:/var/private/capture.png';
    return evidence;
  }],
  ['capture-reference query bypass', () => {
    const evidence = makeValidPackage();
    evidence.checks[0].captureReference = 'qa://capture/android/screen-reader?raw-log';
    return evidence;
  }],
];

negativeFixtureMatrix.forEach(([name, fixture]) => expectInvalid(fixture(), `negative fixture matrix: ${name}`));

console.log(`device QA evidence validator: PASS ${15 + negativeFixtureMatrix.length} / FAIL 0`);
