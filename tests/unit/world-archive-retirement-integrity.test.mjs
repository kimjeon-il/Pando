import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { bundleDescriptor } from '../../tools/build-world-bundle.mjs';
import { HYDRO_DATA_VERSION } from '../../shared/frontend/js/modules/physical-layer-service.js';
import { TERRAIN_RASTER_VERSION } from '../../shared/frontend/js/modules/terrain-manifest.js';

const repository = fileURLToPath(new URL('../..', import.meta.url));
const workflow = readFileSync(new URL('../../.github/workflows/world-archive-retirement-integrity.yml', import.meta.url), 'utf8');
// Execute the exact CI gate with real pinned Git objects; no duplicated verifier.
const script = workflow.match(/node --input-type=module <<'NODE'\n([\s\S]*?)\n {10}NODE/)?.[1].replace(/^ {10}/gm, '');
assert.ok(script, 'World archive workflow must expose its executable integrity gate');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (root, ...args) => execFileSync('git', ['-c', 'core.autocrlf=false',
  '-c', 'user.name=Archive fixture', '-c', 'user.email=fixture@example.invalid', ...args],
{ cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
const put = (root, path, bytes) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), bytes);
};

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'pando-world-archive-gate-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const checkout = join(root, '.library-data/repository');
  mkdirSync(checkout, { recursive: true });
  for (const path of [root, checkout]) git(path, 'init', '-q');
  symlinkSync(join(repository, 'tools'), join(root, 'tools'), process.platform === 'win32' ? 'junction' : 'dir');
  symlinkSync(join(repository, 'shared'), join(root, 'shared'), process.platform === 'win32' ? 'junction' : 'dir');
  const sourceBytes = Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [
    { type: 'Feature', id: 'ONE', properties: {}, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 1], [0, 0]]] } },
  ] }));
  const seed = {
    schema: 'pandolab-world-build-input', schemaVersion: 1,
    canonicalSource: 'territorial-entities/generated/current-world.geojson',
    legacyPreviewManifest: 'world-preview-v0.38.7.json',
    sharedBoundaries: { preview: 'countries-preview-shared-v0.38.7.json.gz', canonical: 'countries-canonical-shared-v0.38.7.json.gz' },
  };
  const assets = {}, specs = {};
  for (const role of ['previewCountries', 'previewMesh', 'canonicalCountryPacket', 'canonicalMesh', 'labelAnchors']) {
    const decoded = Buffer.from(role === 'labelAnchors' ? '{"anchors":{}}' : role);
    const bytes = role === 'labelAnchors' ? decoded : gzipSync(decoded);
    assets[role] = bytes;
    specs[role] = { url: `${role}-v0.38.7.dat`, encoding: role === 'labelAnchors' ? 'identity' : 'gzip',
      compressedBytes: bytes.length, decodedBytes: decoded.length, sha256: hash(bytes) };
  }
  const legacy = { version: '0.38.7', source: seed.canonicalSource, countries: 1,
    sourceSha256: hash(sourceBytes), canonicalSourceSha256: hash(sourceBytes), previewSourceSha256: hash(sourceBytes),
    defaultClassification: { countries: { ONE: 'geometry' } }, previewDerivation: 'canonical-topology-simplified',
    previewSourceScale: 'derived', simplificationQuantile: 0.2, coordinateCount: 4, meshAlgorithmRevision: 5, assets: specs };
  const bundle = bundleDescriptor({ seed, legacy, assets, sourceBytes });
  const hydroPath = `assets/data/hydro/v${HYDRO_DATA_VERSION}/hydro.bin`;
  const terrainPath = `assets/data/terrain-preview/v${TERRAIN_RASTER_VERSION}/manifest.json`;
  const hydro = Buffer.from('current hydro container');
  const files = new Map([
    ['assets/data/world/build-input.json', Buffer.from(JSON.stringify(seed))],
    ['assets/data/world/current.json', Buffer.from(JSON.stringify(bundle, null, 2) + '\n')],
    ['assets/data/' + seed.legacyPreviewManifest, Buffer.from(JSON.stringify(legacy))],
    ['assets/data/' + seed.canonicalSource, sourceBytes],
    ['assets/data/' + seed.sharedBoundaries.preview, gzipSync('{"quality":"preview"}')],
    ['assets/data/' + seed.sharedBoundaries.canonical, gzipSync('{"quality":"canonical"}')],
    ['assets/data/world-preview-v0.35.0.json', Buffer.from('{"version":"0.35.0","archived":true}')],
    [hydroPath, hydro],
    [`assets/data/hydro/v${HYDRO_DATA_VERSION}/manifest.json`, Buffer.from(JSON.stringify({
      container: { url: 'hydro.bin', bytes: hydro.length, sha256: hash(hydro) },
    }))],
    [terrainPath, Buffer.from(JSON.stringify({ version: TERRAIN_RASTER_VERSION }))],
  ]);
  for (const [role, bytes] of Object.entries(assets)) {
    files.set('assets/data/' + specs[role].url, bytes);
    files.set('assets/data/' + bundle.assets[role].url, bytes);
  }
  const index = { schemaVersion: 1, files: {} };
  for (const [path, bytes] of files) {
    const stored = `archive/blobs/${hash(bytes)}.gz`;
    put(checkout, stored, gzipSync(bytes));
    index.files[path] = { stored, encoding: 'gzip', bytes: bytes.length, sha256: hash(bytes) };
    put(root, path, bytes);
  }
  put(root, '.gitignore', '.library-data/\nassets/data/\ntools\nshared\n');
  const repin = () => {
    put(checkout, 'archive/index.json', JSON.stringify(index));
    git(checkout, 'add', '.'); git(checkout, 'commit', '-qm', 'pinned archive');
    const revision = git(checkout, 'rev-parse', 'HEAD');
    put(root, 'config/library-data.json', JSON.stringify({ repository: 'fixture/data', revision, mounts: ['assets/data'] }));
    return revision;
  };
  const revision = repin();
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'application ownership');
  const run = () => {
    const result = spawnSync(process.execPath, ['--input-type=module'], { cwd: root, input: script,
      encoding: 'utf8', timeout: 10000, env: { ...process.env, PANDOLAB_LIBRARY_DATA_ROOT: checkout, GIT_NO_LAZY_FETCH: '1' } });
    if (result.error) throw result.error;
    return result;
  };
  return { root, checkout, index, bundle, revision, hydroPath, terrainPath, repin, run };
}

test('archive gate follows the application pin and selected version after storage HEAD advances', t => {
  const f = fixture(t);
  put(f.checkout, f.index.files['assets/data/world/current.json'].stored, 'later storage edition');
  put(f.checkout, 'archive/index.json', '{"schemaVersion":1,"files":{}}');
  git(f.checkout, 'add', '.'); git(f.checkout, 'commit', '-qm', 'independent later storage');
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(f.revision));
  assert.match(result.stdout, /0\.38\.7/);
});

test('archive gate rejects a missing pinned logical dependency despite a mounted copy', t => {
  const f = fixture(t);
  delete f.index.files['assets/data/' + f.bundle.assets.previewMesh.url];
  f.repin();
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing active\/pinned archive path/);
});

test('archive gate rejects a missing stored Git blob despite a mounted copy', t => {
  const f = fixture(t);
  f.index.files['assets/data/' + f.bundle.assets.previewMesh.url].stored = 'archive/blobs/missing.gz';
  f.repin();
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing pinned archive blob/);
});

test('archive gate rejects mounted bytes that differ from their pinned archive identity', t => {
  const f = fixture(t);
  put(f.root, 'assets/data/' + f.bundle.assets.previewMesh.url, 'modified mounted bytes');
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Mounted library bytes differ from pin/);
});

test('archive gate rejects corrupt archived bytes instead of trusting metadata', t => {
  const f = fixture(t);
  f.index.files['assets/data/' + f.bundle.assets.previewMesh.url].sha256 = '0'.repeat(64);
  f.repin();
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Library transfer is corrupt/);
});

test('archive gate rejects a corrupt pinned Git blob masked by a repaired working copy', t => {
  const f = fixture(t);
  const stored = f.index.files['assets/data/' + f.bundle.assets.previewMesh.url].stored;
  const original = readFileSync(join(f.checkout, stored));
  put(f.checkout, stored, gzipSync('corrupt pinned archive bytes'));
  f.repin();
  put(f.checkout, stored, original);
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Library transfer is corrupt/);
});

test('archive gate keeps retired version groups out of the paired archive', t => {
  const f = fixture(t);
  f.index.files['assets/data/world-preview-v0.30.0.json'] = f.index.files['assets/data/world-preview-v0.35.0.json'];
  f.repin();
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Retired world bundles/);
});

test('archive gate rejects data reintroduced into application Git ownership', t => {
  const f = fixture(t);
  git(f.root, 'add', '-f', 'assets/data/world/current.json');
  git(f.root, 'commit', '-qm', 'accidental data ownership');
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /External library data must not be tracked/);
});

for (const dependency of ['hydroPath', 'terrainPath']) {
  test(`archive gate retains the current ${dependency} archive requirement`, t => {
    const f = fixture(t);
    delete f.index.files[f[dependency]];
    f.repin();
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Missing active\/pinned archive path/);
  });
}
