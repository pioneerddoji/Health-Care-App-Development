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

console.log('device QA evidence validator: PASS 12 / FAIL 0');
