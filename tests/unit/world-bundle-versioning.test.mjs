import assert from 'node:assert/strict';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  sha256, contentAddress, bundleDescriptor, publishWorldBundle, assertDataPath,
} from '../../tools/build-world-bundle.mjs';

const seed = Object.freeze({
  schema: 'pandolab-world-build-input', schemaVersion: 1,
  canonicalSource: 'territorial-entities/generated/current-world.geojson',
  legacyPreviewManifest: 'world-preview-v0.36.0.json',
  sharedBoundaries: {
    preview: 'countries-preview-shared-v0.34.0.json.gz',
    canonical: 'countries-canonical-shared-v0.34.0.json.gz',
  },
});

function scenario(version = '0.36.0') {
  const features = Array.from({ length: 258 }, (_, i) => ({
    type: 'Feature', id: `S${i}`, properties: { name: `S${i}` },
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 0], [0, 0]]] },
  }));
  const sourceBytes = Buffer.from(JSON.stringify({ type: 'FeatureCollection', features }));
  const decoded = {
    previewCountries: 'preview', previewMesh: 'mesh',
    canonicalCountryPacket: 'packet', canonicalMesh: 'mesh-canonical',
    labelAnchors: '{"anchors":{}}',
  };
  const assets = Object.fromEntries(Object.entries(decoded).map(([key, value]) =>
    [key, key === 'labelAnchors' ? Buffer.from(value) : gzipSync(Buffer.from(value))]));
  const specs = Object.fromEntries(Object.entries(assets).map(([key, bytes]) => [
    key, { url: key + '.dat', encoding: key === 'labelAnchors' ? 'identity' : 'gzip',
      sha256: sha256(bytes), compressedBytes: bytes.length, decodedBytes: Buffer.byteLength(decoded[key]) },
  ]));
  return {
    sourceBytes, assets,
    legacy: {
      version, source: seed.canonicalSource, countries: 258,
      sourceSha256: sha256(sourceBytes), canonicalSourceSha256: sha256(sourceBytes),
      previewSourceSha256: sha256(sourceBytes),
      previewDerivation: 'canonical-topology-simplified', previewSourceScale: 'derived',
      defaultClassification: { countries: { S0: 'hash' } },
      coordinateCount: 200, simplificationQuantile: 0.2, meshAlgorithmRevision: 3, assets: specs,
    },
  };
}

test('world bundle identity does not depend on program version', () => {
  const a = scenario('0.36.0'), b = scenario('0.37.0');
  const m = bundleDescriptor({ seed, legacy: a.legacy, assets: a.assets, sourceBytes: a.sourceBytes });
  assert.deepEqual(m, bundleDescriptor({ seed, legacy: b.legacy, assets: b.assets, sourceBytes: b.sourceBytes }));
  assert.equal(m.schemaVersion, 1);
  assert.equal(m.assets.previewMesh.sha256, sha256(a.assets.previewMesh));
  assert.ok(m.assets.previewMesh.url.includes(m.assets.previewMesh.sha256));
  assert.equal(JSON.stringify(m).includes('0.36.0'), false);
  assert.equal(m.version, undefined);
});

test('unsafe paths, modified asset bytes and stale canonical sources fail closed', () => {
  for (const value of ['../x', '/root', 'a\\x', 'x/../../y', 'x//y', '?x', '#x']) {
    assert.throws(() => assertDataPath(value), /Unsafe/);
  }
  const a = scenario();
  assert.throws(() => bundleDescriptor({
    seed, legacy: a.legacy, assets: { ...a.assets, previewMesh: Buffer.from('wrong') }, sourceBytes: a.sourceBytes,
  }), /digest\/size mismatch/);
  assert.throws(() => bundleDescriptor({
    seed, legacy: a.legacy, assets: a.assets, sourceBytes: Buffer.from('new source'),
  }), /Stale canonical/);
  assert.throws(() => contentAddress('previewMesh', 'bad'), /Invalid world asset/);
});

test('publisher validates source, is idempotent and rejects corrupted immutable copies', () => {
  const root = mkdtempSync(join(tmpdir(), 'pandolab-world-bundle-'));
  const data = join(root, 'assets/data');
  const write = (file, bytes) => {
    const target = join(data, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  };
  try {
    const fixture = scenario();
    write('world/build-input.json', JSON.stringify(seed));
    write(seed.canonicalSource, fixture.sourceBytes);
    write(seed.legacyPreviewManifest, JSON.stringify(fixture.legacy));
    for (const [key, bytes] of Object.entries(fixture.assets)) write(fixture.legacy.assets[key].url, bytes);
    assert.throws(() => publishWorldBundle({ root, check: true }), /Stale world/);
    const first = publishWorldBundle({ root });
    assert.equal(first.validatedAssets, 5);
    assert.equal(publishWorldBundle({ root, check: true }).validatedAssets, 5);
    const immutable = join(data, first.bundle.assets.previewMesh.url);
    writeFileSync(immutable, 'invalid');
    assert.throws(() => publishWorldBundle({ root, check: true }), /corrupted/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
