import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { validateWorldBundle, worldAssetUrl } from '../../assets/js/modules/world-bundle-manifest.js';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const types = Object.freeze({
  previewCountries: ['countries-preview', '.geojson.gz', 'gzip'],
  previewMesh: ['world-mesh-preview', '.bin.gz', 'gzip'],
  canonicalCountryPacket: ['countries-canonical', '.pcg.gz', 'gzip'],
  canonicalMesh: ['world-mesh', '.bin.gz', 'gzip'],
  labelAnchors: ['country-label-anchors', '.json', 'identity'],
});

function fixture() {
  const assets = Object.fromEntries(Object.entries(types).map(([role, [name, extension, encoding]]) => {
    const decoded = role === 'labelAnchors' ? Buffer.from('hello') : Buffer.from('1234567890'.repeat(4));
    const stored = encoding === 'gzip' ? gzipSync(decoded) : decoded;
    const sha = sha256(stored);
    return [role, {
      url: `world/objects/${name}-sha256-${sha}${extension}`,
      encoding, sha256: sha, compressedBytes: stored.length, decodedBytes: decoded.length,
      ...(role === 'labelAnchors' ? {} : { header: [1, 2, 3, 4, 5, 6, 7, 8] }),
    }];
  }));
  return {
    schema: 'pandolab-world-bundle', schemaVersion: 1,
    source: { url: 'territorial-entities/generated/current-world.geojson', sha256: 'a'.repeat(64), countryCount: 258 },
    derivation: { preview: 'canonical-topology-simplified', coordinateCount: 105884, meshAlgorithmRevision: 4 },
    defaultClassification: { countries: { TEST: 'digest' } }, assets,
    compatibility: { sharedBoundaries: {
      preview: 'countries-preview-shared-v0.34.0.json.gz',
      canonical: 'countries-canonical-shared-v0.34.0.json.gz',
    } },
  };
}

test('bundled world manifest supplies immutable assets and the previous preview identity', () => {
  const value = fixture();
  const normalized = validateWorldBundle(value);
  assert.equal(normalized.sourceSha256, value.source.sha256);
  assert.strictEqual(normalized.defaultClassification, value.defaultClassification);
  assert.equal(normalized.sharedBoundaryCacheUrls.preview, 'countries-preview-shared-v0.34.0.json.gz');
  assert.equal(worldAssetUrl(normalized.assets.previewMesh, 'https://example.org/Pando/assets/data/').href,
    `https://example.org/Pando/assets/data/${normalized.assets.previewMesh.url}`);
  assert.equal(normalized.version, undefined);
  assert.equal(normalized.assets.previewMesh.url.includes('0.36.0'), false);
});

test('worker manifest validation rejects versioned, tampered and traversal paths', () => {
  for (const invalid of ['../../secret', '/secret', '//other-host/test', 'world/objects/../hack',
    'world/objects/%2e%2e/evil', 'world/objects/key?v=evil', 'countries-preview-v0.36.0.geojson.gz']) {
    const value = fixture();
    value.assets.previewCountries.url = invalid;
    assert.throws(() => validateWorldBundle(value), /내용 주소/);
  }
  for (const quality of ['preview', 'canonical']) {
    const value = fixture();
    value.compatibility.sharedBoundaries[quality] = '../../elsewhere';
    assert.throws(() => validateWorldBundle(value), /공유 국경선/);
  }
  const altered = fixture();
  altered.assets.previewMesh.sha256 = 'f'.repeat(64);
  assert.throws(() => validateWorldBundle(altered), /내용 주소/);
});

test('committed world/current.json is independently valid and app-version-free', () => {
  const path = new URL('../../assets/data/world/current.json', import.meta.url);
  const bundle = JSON.parse(readFileSync(path, 'utf8'));
  const data = validateWorldBundle(bundle);
  assert.equal(bundle.schemaVersion, 1);
  assert.equal(bundle.source.countryCount, 258);
  assert.equal(bundle.source.sha256.length, 64);
  assert.equal(bundle.version, undefined);
  for (const [role, asset] of Object.entries(data.assets)) {
    assert.equal(asset.url.includes('-sha256-'), true, role);
    assert.equal(asset.url.includes(asset.sha256), true, role);
  }
});

test('country asset producers and runtime no longer derive data names from package version', () => {
  const source = name => readFileSync(new URL('../../' + name, import.meta.url), 'utf8');
  const previewProducer = source('tools/build-world-preview.mjs');
  const meshProducer = source('tools/build-world-mesh.mjs');
  const boundaryProducer = source('tools/build-country-shared-boundaries.mjs');
  const metadata = source('scripts/generate-build-metadata.mjs');
  const runtime = source('assets/js/workers/data-loader-worker.js');
  const renderer = source('assets/js/modules/gpu-map-renderer.js');
  for (const text of [previewProducer, meshProducer]) {
    assert.doesNotMatch(text, /packageJson\.version|package\.json.*version/);
  }
  assert.match(previewProducer, /bundleSeed\.legacyPreviewManifest/);
  assert.match(boundaryProducer, /bundle\.compatibility\.sharedBoundaries/);
  assert.match(metadata, /assets\/data\/world\/current\.json/);
  assert.doesNotMatch(metadata, /world-preview-v\$\{appVersion\}/);
  assert.match(runtime, /world\/current\.json/);
  assert.doesNotMatch(runtime, /world-preview-v\$\{APP_VERSION\}/);
  assert.doesNotMatch(renderer, /shared-v0\.34\.0\.json\.gz/);
});
