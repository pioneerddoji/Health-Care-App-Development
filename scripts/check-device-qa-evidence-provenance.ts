import { lstat, readFile, readdir } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEvidenceFixtureCorpus, type ValidationResult } from './validate-device-qa-evidence';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultFixtureDirectory = join(repositoryRoot, 'fixtures', 'device-qa-evidence');

export const verifyEvidenceFixtureDirectory = async (fixtureDirectory: string): Promise<ValidationResult> => {
  const errors: string[] = [];
  let entries: Dirent<string>[];
  let manifest: unknown;

  try {
    if (!(await lstat(fixtureDirectory)).isDirectory()) {
      return { valid: false, errors: ['fixture corpus directory must be a real directory'] };
    }
    entries = await readdir(fixtureDirectory, { withFileTypes: true });
  } catch {
    return { valid: false, errors: ['fixture corpus directory is unavailable'] };
  }

  const manifestEntry = entries.find((entry) => entry.name === 'manifest.json');
  if (!manifestEntry || !manifestEntry.isFile()) {
    return { valid: false, errors: ['fixture manifest must be a regular file'] };
  }

  const fixtureEntries = entries.filter((entry) => entry.name !== 'manifest.json');
  fixtureEntries.filter((entry) => !entry.isFile()).forEach((entry) => {
    errors.push(`fixture corpus entry ${entry.name} must be a regular file`);
  });

  try {
    manifest = JSON.parse(await readFile(join(fixtureDirectory, 'manifest.json'), 'utf8'));
  } catch {
    return { valid: false, errors: [...errors, 'fixture manifest must be valid JSON'] };
  }

  const corpus = await Promise.all(fixtureEntries
    .filter((entry) => entry.isFile())
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    .map(async (entry) => {
      try {
        return { path: entry.name, contents: await readFile(join(fixtureDirectory, entry.name), 'utf8') };
      } catch {
        errors.push(`fixture corpus entry ${entry.name} cannot be read`);
        return undefined;
      }
    }));

  const validation = validateEvidenceFixtureCorpus(manifest, corpus.filter((entry): entry is NonNullable<typeof entry> => entry !== undefined));
  return { valid: errors.length === 0 && validation.valid, errors: [...errors, ...validation.errors] };
};

const runCli = async () => {
  const result = await verifyEvidenceFixtureDirectory(defaultFixtureDirectory);
  if (!result.valid) {
    console.error('device QA evidence provenance: INVALID');
    result.errors.forEach((error) => console.error(`- ${error}`));
    process.exitCode = 1;
    return;
  }
  console.log('device QA evidence provenance: VALID fixtures=2');
};

if (process.argv[1] === fileURLToPath(import.meta.url)) void runCli();
