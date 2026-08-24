import { readFile } from 'node:fs/promises';

const PLATFORM_VALUES = ['android', 'ios'] as const;
const AREA_VALUES = [
  'screen-reader',
  'picker-focus',
  'permissions',
  'pdf-share',
  'notification-deep-link',
  'app-resume',
] as const;
const RESULT_TO_STATE = {
  PASS: 'proven',
  FAIL: 'not-proven',
  ABORT: 'needs-device',
} as const;
const TOP_LEVEL_KEYS = ['schemaVersion', 'source', 'devices', 'checks'];
const SOURCE_KEYS = ['exactCommitSha', 'draftPullRequestUrl', 'currentHeadCiUrl', 'reviewVerdictUrl'] as const;
const EXPECTED_SOURCE = {
  exactCommitSha: '7cb43eed5b532c236f6ed7d91f9a35a82fbdcd16',
  draftPullRequestUrl: 'https://github.com/pioneerddoji/Health-Care-App-Development/pull/22',
  currentHeadCiUrl: 'https://github.com/pioneerddoji/Health-Care-App-Development/actions/runs/32676272592',
  reviewVerdictUrl: 'kanban://task/t_d5098b8a/run/162',
} as const;
const DEVICE_KEYS = ['platform', 'osVersion', 'appBuildIdentifier'];
const CHECK_KEYS = [
  'id',
  'platform',
  'area',
  'preconditions',
  'testDataClass',
  'steps',
  'expected',
  'actual',
  'captureReference',
  'result',
  'evidenceState',
  'abortReason',
  'rollback',
];

const forbiddenValue = /(?:\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|(?:^|[^\w/])\+?\d[\d\s()-]{7,}\d|bearer\s+|gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|eyJ[A-Za-z0-9_-]{8,}\.|file:\/\/|(?:^|[^A-Za-z0-9+./])\/(?!\/)(?:[^\s/]+\/)*[^\s/]+|[A-Za-z]:\\|\b(?:patient|diagnosis|medical record|symptom|medication|health data)\b|(?:환자|진단|의료기록|증상|복약|건강정보))/i;

export type ValidationResult = { valid: boolean; errors: string[] };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireExactKeys = (value: Record<string, unknown>, allowed: readonly string[], label: string, errors: string[]) => {
  for (const key of allowed) {
    if (!(key in value)) errors.push(`${label}.${key} is required`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${label}.${key} is not allowed`);
  }
};

const requireString = (value: Record<string, unknown>, key: string, label: string, errors: string[]) => {
  if (typeof value[key] !== 'string' || !value[key].trim()) errors.push(`${label}.${key} must be a non-empty string`);
};

const scanForbiddenValues = (value: unknown, location: string, errors: string[]): void => {
  if (typeof value === 'string' && forbiddenValue.test(value)) {
    errors.push(`${location} contains a prohibited sensitive value or local absolute path`);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => scanForbiddenValues(item, `${location}[${index}]`, errors));
  } else if (isObject(value)) {
    Object.entries(value).forEach(([key, item]) => scanForbiddenValues(item, `${location}.${key}`, errors));
  }
};

export const validateEvidencePackage = (value: unknown): ValidationResult => {
  const errors: string[] = [];
  if (!isObject(value)) return { valid: false, errors: ['evidence package must be an object'] };

  requireExactKeys(value, TOP_LEVEL_KEYS, 'package', errors);
  if (value.schemaVersion !== '1.0') errors.push('package.schemaVersion must equal 1.0');

  const source = value.source;
  if (!isObject(source)) {
    errors.push('package.source must be an object');
  } else {
    requireExactKeys(source, SOURCE_KEYS, 'source', errors);
    SOURCE_KEYS.forEach((key) => requireString(source, key, 'source', errors));
    SOURCE_KEYS.forEach((key) => {
      if (source[key] !== EXPECTED_SOURCE[key]) errors.push(`source.${key} must match the approved decision packet`);
    });
    if (typeof source.exactCommitSha === 'string' && !/^[a-f0-9]{40}$/.test(source.exactCommitSha)) {
      errors.push('source.exactCommitSha must be a full lowercase SHA-1');
    }
    ['draftPullRequestUrl', 'currentHeadCiUrl'].forEach((key) => {
      const url = source[key];
      if (typeof url === 'string' && !/^https:\/\/github\.com\//.test(url)) {
        errors.push(`source.${key} must be an https GitHub URL`);
      }
    });
    const verdictUrl = source.reviewVerdictUrl;
    if (typeof verdictUrl === 'string' && !/^(https:\/\/github\.com\/|kanban:\/\/task\/)/.test(verdictUrl)) {
      errors.push('source.reviewVerdictUrl must be an https GitHub or kanban task URL');
    }
  }

  if (!Array.isArray(value.devices) || value.devices.length === 0) {
    errors.push('package.devices must be a non-empty array');
  } else {
    const platforms = new Set<string>();
    value.devices.forEach((device, index) => {
      const label = `devices[${index}]`;
      if (!isObject(device)) {
        errors.push(`${label} must be an object`);
        return;
      }
      requireExactKeys(device, DEVICE_KEYS, label, errors);
      DEVICE_KEYS.forEach((key) => requireString(device, key, label, errors));
      if (typeof device.platform === 'string') platforms.add(device.platform);
    });
    PLATFORM_VALUES.forEach((platform) => {
      if (!platforms.has(platform)) errors.push(`package.devices must include ${platform}`);
    });
  }

  if (!Array.isArray(value.checks) || value.checks.length === 0) {
    errors.push('package.checks must be a non-empty array');
  } else {
    const coverage = new Set<string>();
    const checkIds = new Set<string>();
    value.checks.forEach((check, index) => {
      const label = `checks[${index}]`;
      if (!isObject(check)) {
        errors.push(`${label} must be an object`);
        return;
      }
      requireExactKeys(check, CHECK_KEYS, label, errors);
      ['id', 'platform', 'area', 'testDataClass', 'expected', 'actual', 'captureReference', 'result', 'evidenceState', 'abortReason', 'rollback']
        .forEach((key) => requireString(check, key, label, errors));
      ['preconditions', 'steps'].forEach((key) => {
        if (!Array.isArray(check[key]) || check[key].length === 0 || !check[key].every((item) => typeof item === 'string' && item.trim())) {
          errors.push(`${label}.${key} must be a non-empty string array`);
        }
      });
      if (!PLATFORM_VALUES.includes(check.platform as typeof PLATFORM_VALUES[number])) errors.push(`${label}.platform is invalid`);
      if (!AREA_VALUES.includes(check.area as typeof AREA_VALUES[number])) errors.push(`${label}.area is invalid`);
      if (!['synthetic', 'no-personal-data'].includes(check.testDataClass as string)) errors.push(`${label}.testDataClass must be synthetic or no-personal-data`);
      if (!/^qa:\/\/(?:pending|capture)\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(check.captureReference as string)) {
        errors.push(`${label}.captureReference must be a redacted qa:// reference`);
      }
      const result = check.result as keyof typeof RESULT_TO_STATE;
      if (!(result in RESULT_TO_STATE)) {
        errors.push(`${label}.result is invalid`);
      } else if (check.evidenceState !== RESULT_TO_STATE[result]) {
        errors.push(`${label} result and evidenceState must fail closed together`);
      }
      if (check.result === 'ABORT' && !(check.abortReason as string).trim()) errors.push(`${label}.abortReason is required for ABORT`);
      if (typeof check.id === 'string') {
        if (checkIds.has(check.id)) errors.push(`${label}.id must be unique`);
        checkIds.add(check.id);
      }
      if (typeof check.platform === 'string' && typeof check.area === 'string') {
        const coverageKey = `${check.platform}:${check.area}`;
        if (coverage.has(coverageKey)) errors.push(`${label}.platform and area combination must be unique`);
        coverage.add(coverageKey);
      }
    });
    PLATFORM_VALUES.forEach((platform) => AREA_VALUES.forEach((area) => {
      if (!coverage.has(`${platform}:${area}`)) errors.push(`package.checks must cover ${platform}:${area}`);
    }));
  }

  scanForbiddenValues(value, 'package', errors);
  return { valid: errors.length === 0, errors };
};

const runCli = async () => {
  const path = process.argv[2];
  if (!path) return;

  const contents = await readFile(path, 'utf8');
  const result = validateEvidencePackage(JSON.parse(contents));
  if (!result.valid) {
    console.error(`INVALID ${path}`);
    result.errors.forEach((error) => console.error(`- ${error}`));
    process.exitCode = 1;
    return;
  }
  console.log(`VALID ${path}`);
};

if (process.argv[1]?.endsWith('validate-device-qa-evidence.ts')) void runCli();
