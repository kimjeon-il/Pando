import { writeLibraryOutput } from './library-data.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// P4 publishes a new immutable dataset. Never overwrite v0.36.0 assets or v1 meshes.
const root = fileURLToPath(new URL('../', import.meta.url));
const data = resolve(root, 'assets/data');
const sourceVersion = '0.36.0', releaseVersion = '0.36.1';
const sourceFile = resolve(data, 'world-preview-v' + sourceVersion + '.json');
const destinationFile = resolve(data, 'world-preview-v' + releaseVersion + '.json');
const seedFile = resolve(data, 'world/build-input.json');
const readJson = file => JSON.parse(readFileSync(file, 'utf8'));
const writeJson = (file, value) => writeLibraryOutput(file, JSON.stringify(value, null, 2) + '\n');
const old = readJson(sourceFile);
assert.equal(old.version, sourceVersion);
assert.equal(old.assets.canonicalMesh.url, 'world-mesh-v0.12.6.bin.gz');
assert.equal(old.assets.previewMesh.url, 'world-mesh-preview-v' + sourceVersion + '.bin.gz');
assert.equal(old.assets.canonicalCountryPacket.url, 'countries-canonical-v' + sourceVersion + '.pcg.gz');
assert.equal(old.assets.previewCountries.url, 'countries-preview-v' + sourceVersion + '.geojson.gz');
if (existsSync(destinationFile)) throw new Error('v0.36.1 is already published; never overwrite an immutable dataset version.');
if (existsSync(resolve(data, 'prepared-polygons/generated/v2/manifest.json')))
  throw new Error('Prepared polygon v2 already exists; never overwrite its checksum manifest.');

const next = structuredClone(old);
next.version = releaseVersion;
next.assets.canonicalMesh.url = 'world-mesh-v' + releaseVersion + '.bin.gz';
next.assets.previewMesh.url = 'world-mesh-preview-v' + releaseVersion + '.bin.gz';
next.assets.previewCountries.url = 'countries-preview-v' + releaseVersion + '.geojson.gz';
next.assets.canonicalCountryPacket.url = 'countries-canonical-v' + releaseVersion + '.pcg.gz';
const seed = readJson(seedFile);
assert.equal(seed.legacyPreviewManifest, 'world-preview-v' + sourceVersion + '.json');
seed.legacyPreviewManifest = 'world-preview-v' + releaseVersion + '.json';
seed.sharedBoundaries = Object.fromEntries(['preview', 'canonical']
  .map(quality => [quality, 'countries-' + quality + '-shared-v' + releaseVersion + '.json.gz']));
writeJson(destinationFile, next);
writeJson(seedFile, seed);

// Use existing producers in dependency order. The current bundle publishes
// immutable content-addressed files, and the shared caches use new aliases.
const run = file => {
  console.log('P4 generator: ' + file);
  const result = spawnSync(process.execPath, [file], {
    cwd: root, env: process.env, stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('P4 generator failed: ' + file + ' (status ' + result.status + ')');
};
for (const file of [
  'tools/build-world-mesh.mjs',
  'tools/build-world-preview.mjs',
  'tools/build-world-bundle.mjs',
  'tools/build-country-shared-boundaries.mjs',
  'tools/build-prepared-polygon-mesh.mjs',
  'scripts/generate-build-metadata.mjs',
]) run(file);

const published = readJson(destinationFile);
const bundle = readJson(resolve(data, 'world/current.json'));
const prepared = readJson(resolve(data, 'prepared-polygons/generated/v2/manifest.json'));
assert.equal(published.meshAlgorithmRevision, 4);
assert.equal(bundle.derivation.meshAlgorithmRevision, 4);
assert.equal(prepared.algorithmVersion, 4);
assert.equal(prepared.schemaVersion, 2);
assert.equal(prepared.meshFormatVersion, 2);
assert.deepEqual(bundle.compatibility.sharedBoundaries, seed.sharedBoundaries);
console.log('P4 published ' + Object.keys(prepared.meshes).length + ' prepared polygon assets for ' + releaseVersion + '.');
