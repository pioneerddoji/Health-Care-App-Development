import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { validateEvidenceFixtureCorpus, validateEvidencePackage } from './validate-device-qa-evidence';

const fixtureDirectory = join(process.cwd(), 'fixtures', 'device-qa-evidence');
const fixturePaths = [
  'negative-sensitive-and-false-green.json',
  'positive-needs-device.json',
] as const;

const readCorpus = async () => Promise.all(
  fixturePaths.map(async (path) => ({ path, contents: await readFile(join(fixtureDirectory, path), 'utf8') })),
);

const corpus = await readCorpus();
const manifest = JSON.parse(await readFile(join(fixtureDirectory, 'manifest.json'), 'utf8'));

const initial = validateEvidenceFixtureCorpus(manifest, corpus);
assert.equal(initial.valid, true, initial.errors.join('\n'));
assert.equal(validateEvidencePackage(JSON.parse(corpus[0].contents)).valid, false, 'negative fixture must remain invalid');
assert.equal(validateEvidencePackage(JSON.parse(corpus[1].contents)).valid, true, 'positive fixture must remain valid');

const missingFixture = validateEvidenceFixtureCorpus(manifest, corpus.slice(1));
assert.equal(missingFixture.valid, false, 'fixture deletion must fail closed');

const mutatedFixture = validateEvidenceFixtureCorpus(manifest, [
  { ...corpus[0], contents: `${corpus[0].contents}\nmutation` },
  corpus[1],
]);
assert.equal(mutatedFixture.valid, false, 'fixture content mutation must fail closed');

const duplicateManifest = validateEvidenceFixtureCorpus(
  { ...manifest, fixtures: [...manifest.fixtures, manifest.fixtures[0]] },
  corpus,
);
assert.equal(duplicateManifest.valid, false, 'duplicate fixture manifest entries must fail closed');

const undeclaredFixture = validateEvidenceFixtureCorpus(manifest, [
  ...corpus,
  { path: 'unexpected.txt', contents: 'synthetic undeclared content' },
]);
assert.equal(undeclaredFixture.valid, false, 'undeclared fixture files must fail closed');

const diskFiles = (await readdir(fixtureDirectory)).sort();
assert.deepEqual(
  diskFiles,
  ['manifest.json', ...fixturePaths].sort(),
  'fixture directory must contain only the manifest and approved positive/negative fixtures',
);

console.log('device QA evidence provenance: PASS');
