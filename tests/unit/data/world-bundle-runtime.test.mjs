import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';

import { gzipSync } from 'node:zlib';
import { validateWorldBundle, worldAssetUrl } from "../../../src/data/world-bundle-manifest.js";

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const types = Object.freeze({
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
    derivation: { coordinateCount: 105884, meshAlgorithmRevision: 5 },
    defaultClassification: { countries: { TEST: 'digest' } }, assets,
    compatibility: { sharedBoundaries: {
      canonical: 'countries-canonical-shared-v0.34.0.json.gz',
    } },
  };
}

test('bundled world manifest admits canonical assets without any preview descriptor', () => {
  const value = fixture();
  const normalized = validateWorldBundle(value);
  assert.equal(normalized.sourceSha256, value.source.sha256);
  assert.strictEqual(normalized.defaultClassification, value.defaultClassification);
  assert.equal(normalized.sharedBoundaryCacheUrls.preview, undefined);
  assert.equal(worldAssetUrl(normalized.assets.canonicalMesh, 'https://example.org/Pando/assets/data/').href,
    `https://example.org/Pando/assets/data/${normalized.assets.canonicalMesh.url}`);
  assert.equal(normalized.version, undefined);
  assert.equal(normalized.assets.canonicalMesh.url.includes('0.36.0'), false);
});

test('worker manifest validation rejects versioned, tampered and traversal paths', () => {
  for (const invalid of ['../../secret', '/secret', '//other-host/test', 'world/objects/../hack',
    'world/objects/%2e%2e/evil', 'world/objects/key?v=evil', 'countries-preview-v0.36.0.geojson.gz']) {
    const value = fixture();
    value.assets.canonicalCountryPacket.url = invalid;
    assert.throws(() => validateWorldBundle(value), /내용 주소/);
  }
  for (const quality of ['canonical']) {
    const value = fixture();
    value.compatibility.sharedBoundaries[quality] = '../../elsewhere';
    assert.throws(() => validateWorldBundle(value), /공유 국경선/);
  }
  const altered = fixture();
  altered.assets.canonicalMesh.sha256 = 'f'.repeat(64);
  assert.throws(() => validateWorldBundle(altered), /내용 주소/);
});
