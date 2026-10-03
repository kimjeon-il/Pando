import assert from 'node:assert/strict';
import test from 'node:test';

import {
  approvedSystemsFromReview,
  promoteCoreMetadata,
  promoteManifest,
} from '../../tools/lib/promote-hydro-names.mjs';

test('only accepted review entries become stable system overrides', () => {
  const systems = approvedSystemsFromReview({ entries: [
    { systemId: '2001', status: 'accepted-candidate', recommendedNameKo: '예시강', localName: 'Example', language: 'eng', aliases: ['Old'], sources: [{ url: 'https://example.test' }] },
    { systemId: '2002', status: 'ambiguous', recommendedNameKo: '보류강' },
  ] });
  assert.deepEqual(Object.keys(systems), ['2001']);
  assert.equal(systems['2001'].nameKo, '예시강');
  assert.deepEqual(systems['2001'].sources, ['https://example.test']);
});

test('promotion renames every fragment in an approved logical river system', () => {
  const source = { version: 5, features: [
    { fid: 1, systemId: '2001', name: '미명명 수계 2001', mainstemNameKo: '미명명 수계 2001' },
    { fid: 2, systemId: '2001', name: '미명명 수계 2001', mainstemNameKo: '미명명 수계 2001' },
    { fid: 3, systemId: '2002', name: '미명명 수계 2002' },
  ] };
  const promoted = promoteCoreMetadata(source, { '2001': { nameKo: '예시강' } });
  assert.deepEqual(promoted.features.map(feature => feature.name), ['예시강', '예시강', '미명명 수계 2002']);
  assert.deepEqual(promoted.features.slice(0, 2).map(feature => feature.mainstemNameKo), ['예시강', '예시강']);
});

test('promoted manifest reuses unchanged v0.13.0 assets by relative URL', () => {
  const manifest = {
    version: '0.13.0',
    index: { url: 'index.bin.gz', sha256: 'index' },
    metadata: { core: { url: 'metadata-core.json.gz' }, detail: { url: 'metadata-detail.json.gz' } },
    shards: [{ id: 0, url: 'shards/s0.bin', sha256: 'shard' }],
    cache: { name: 'pandolab-water-v0.13.0-index' },
  };
  const promoted = promoteManifest(manifest, { bytes: 123, sha256: 'core' });
  assert.equal(promoted.version, '0.13.1');
  assert.equal(promoted.index.url, '../v0.13.0/index.bin.gz');
  assert.equal(promoted.metadata.detail.url, '../v0.13.0/metadata-detail.json.gz');
  assert.equal(promoted.shards[0].url, '../v0.13.0/shards/s0.bin');
  assert.deepEqual(promoted.metadata.core, { url: 'metadata-core.json.gz', bytes: 123, sha256: 'core' });
  assert.match(promoted.cache.name, /^pandolab-water-v0\.13\.1-/);
});

test('promotion compacts Korean compound names, including lakes and non-overridden systems', () => {
  const source = { version: 5, features: [
    { fid: 1, systemId: '1', name: '세인트 폴강', mainstemNameKo: '세인트 폴강', width: 12 },
    { fid: 2, name: '조지아 만', category: 'lake' },
    { fid: 3, name: 'Lake Example', category: 'lake' },
    { fid: 4, systemId: '4', name: '미명명 수계 4', mainstemNameKo: '미명명 수계 4' },
    { fid: 5, systemId: '5', name: '미명명 수계 5', mainstemNameKo: '미명명 수계 5' },
    { fid: 6, name: '브라마푸트라강 / 얄룽창포강' },
  ] };
  const promoted = promoteCoreMetadata(source, { '5': { nameKo: '산타 마리아강' } });
  assert.deepEqual(promoted.features.map(feature => feature.name), [
    '세인트폴강', '조지아만', 'Lake Example', '미명명 수계 4', '산타마리아강', '브라마푸트라강/얄룽창포강',
  ]);
  assert.equal(promoted.features[0].mainstemNameKo, '세인트폴강');
  assert.equal(promoted.features[4].mainstemNameKo, '산타마리아강');
  assert.equal(promoted.features[0].width, 12);
  assert.equal(source.features[0].name, '세인트 폴강');
});
