import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyEvidenceFixtureDirectory } from './check-device-qa-evidence-provenance';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const fixtureDirectory = join(repositoryRoot, 'fixtures', 'device-qa-evidence');
const cli = join(repositoryRoot, 'scripts', 'check-device-qa-evidence-provenance.ts');
const tsxCli = join(repositoryRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');

const runCli = (cwd: string) => spawnSync(process.execPath, [tsxCli, cli], {
  cwd,
  encoding: 'utf8',
});

const originalManifest = await readFile(join(fixtureDirectory, 'manifest.json'), 'utf8');
const originalPositive = await readFile(join(fixtureDirectory, 'positive-needs-device.json'), 'utf8');
const rootRun = runCli(repositoryRoot);
const isolatedCwd = await mkdtemp(join(tmpdir(), 'kidcare-provenance-cwd-'));
const isolatedRun = runCli(isolatedCwd);
assert.equal(rootRun.status, 0, rootRun.stderr);
assert.equal(isolatedRun.status, rootRun.status, isolatedRun.stderr);
assert.equal(isolatedRun.stdout, rootRun.stdout, 'CLI summary must be independent of the working directory');
assert.equal(isolatedRun.stderr, rootRun.stderr, 'CLI diagnostics must be independent of the working directory');
assert.match(rootRun.stdout, /^device QA evidence provenance: VALID fixtures=2\n$/);
assert.equal(await readFile(join(fixtureDirectory, 'manifest.json'), 'utf8'), originalManifest, 'CLI must not modify the manifest');
assert.equal(await readFile(join(fixtureDirectory, 'positive-needs-device.json'), 'utf8'), originalPositive, 'CLI must not modify fixtures');

const withSyntheticCorpus = async (mutate: (directory: string) => Promise<void>, detail: string) => {
  const directory = await mkdtemp(join(tmpdir(), 'kidcare-provenance-fixture-'));
  await cp(fixtureDirectory, directory, { recursive: true });
  try {
    await mutate(directory);
    const result = await verifyEvidenceFixtureDirectory(directory);
    assert.equal(result.valid, false, detail);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
};

await withSyntheticCorpus(async (directory) => {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  manifest.fixtures.reverse();
  await writeFile(join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}, 'manifest entries out of canonical path order must fail closed');

await withSyntheticCorpus(async (directory) => {
  await unlink(join(directory, 'positive-needs-device.json'));
}, 'missing fixture files must fail closed');

await withSyntheticCorpus(async (directory) => {
  await writeFile(join(directory, 'additional.json'), '{"synthetic":true}\n');
}, 'additional fixture files must fail closed');

await withSyntheticCorpus(async (directory) => {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  manifest.fixtures.push(manifest.fixtures[0]);
  await writeFile(join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}, 'duplicate manifest fixture paths must fail closed');

await withSyntheticCorpus(async (directory) => {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  manifest.fixtures[0].sha256 = manifest.fixtures[0].sha256.toUpperCase();
  await writeFile(join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}, 'uppercase digests must fail closed');

await withSyntheticCorpus(async (directory) => {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  manifest.fixtures[0].sha256 = 'not-a-digest';
  await writeFile(join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}, 'malformed digests must fail closed');

await withSyntheticCorpus(async (directory) => {
  await writeFile(join(directory, 'positive-needs-device.json'), `${await readFile(join(directory, 'positive-needs-device.json'), 'utf8')}\n`);
}, 'byte and newline changes must fail closed');

await withSyntheticCorpus(async (directory) => {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  manifest.fixtures[0].path = '../escape.json';
  await writeFile(join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}, 'path traversal must fail closed');

await withSyntheticCorpus(async (directory) => {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  manifest.fixtures[0].path = 'nested/fixture.json';
  await writeFile(join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}, 'nested fixture paths must fail closed');

await withSyntheticCorpus(async (directory) => {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  manifest.algorithm = 'sha512';
  await writeFile(join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}, 'unsupported algorithms must fail closed');

await withSyntheticCorpus(async (directory) => {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  manifest.schemaVersion = '2.0';
  await writeFile(join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}, 'unsupported manifest schema versions must fail closed');

const manifestSymlinkDirectory = await mkdtemp(join(tmpdir(), 'kidcare-provenance-manifest-symlink-'));
await cp(fixtureDirectory, manifestSymlinkDirectory, { recursive: true });
await rename(join(manifestSymlinkDirectory, 'manifest.json'), join(manifestSymlinkDirectory, 'manifest-source.json'));
await symlink('manifest-source.json', join(manifestSymlinkDirectory, 'manifest.json'));
const manifestSymlink = await verifyEvidenceFixtureDirectory(manifestSymlinkDirectory);
assert.equal(manifestSymlink.valid, false, 'manifest symlinks must fail closed');
assert.ok(manifestSymlink.errors.includes('fixture manifest must be a regular file'), 'manifest symlink rejection must be explicit');
await rm(manifestSymlinkDirectory, { force: true, recursive: true });

const absolutePathDirectory = await mkdtemp(join(tmpdir(), 'kidcare-provenance-absolute-path-'));
await cp(fixtureDirectory, absolutePathDirectory, { recursive: true });
const absoluteManifest = JSON.parse(await readFile(join(absolutePathDirectory, 'manifest.json'), 'utf8'));
absoluteManifest.fixtures[0].path = '/synthetic/private/fixture.json';
await writeFile(join(absolutePathDirectory, 'manifest.json'), `${JSON.stringify(absoluteManifest, null, 2)}\n`);
const absolutePath = await verifyEvidenceFixtureDirectory(absolutePathDirectory);
assert.equal(absolutePath.valid, false, 'absolute manifest paths must fail closed');
assert.equal(absolutePath.errors.some((error) => error.includes('/synthetic/private/fixture.json')), false, 'diagnostics must not disclose manifest absolute paths');
await rm(absolutePathDirectory, { force: true, recursive: true });

await rm(isolatedCwd, { force: true, recursive: true });
console.log('device QA evidence provenance CLI: PASS 15 / FAIL 0');
