import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { generatePlaceRelease, validateRuntimeApproval } from '../../tools/build-place-runtime.mjs';
import { decodePlaceTile } from '../../assets/js/modules/place-codec.js';
import { normalizePlace, resolvePlaceLabelRows, hasPlaceNameCoverage } from '../../assets/js/modules/place-contract.js';
import { createPlaceWorkerStore } from '../../assets/js/modules/place-worker-store.js';

const assets = new URL('../../assets/data/places/', import.meta.url);
const read = name => readFileSync(new URL(name, assets));
const catalog = JSON.parse(read('reviewed-records-v1.json').toString('utf8'));
const manifest = JSON.parse(read('manifest.json').toString('utf8'));
const approvals = JSON.parse(readFileSync(new URL('../../reports/places/runtime-release-approvals-v1.json', import.meta.url), 'utf8'));
const publishedBytes = read('places-v1.bin');
const triple = { ko: true, en: true, native: true };
const record = id => catalog.records.find(row => row.sourceId === String(id));

test('only approved source-verified cities in 22 batches are reproducibly published', () => {
  const generated = generatePlaceRelease();
  assert.equal(generated.recordCount, 163);
  assert.equal(catalog.reviewBatches.length, 22);
  assert.equal(catalog.stats.cityCount, 163);
  assert.equal(catalog.stats.stagedCount, 264);
  assert.equal(catalog.stats.withheldCount, 101);
  assert.equal(catalog.stats.unrankedCount, 163);
  assert.equal(catalog.stats.timelineEntries,
    catalog.records.reduce((sum, row) => sum + row.nameTimeline.length, 0));
  assert.equal(new Set(catalog.records.map(row => row.sourceId)).size, 163);
  assert.equal(catalog.approval.approvedIds, 163);
  assert.deepEqual(catalog.records.map(row => Number(row.sourceId)),
    approvals.approvedSourceIds);
  assert.equal(generated.catalogText, read('reviewed-records-v1.json').toString('utf8'));
  assert.ok(generated.bytes.equals(publishedBytes));
  assert.equal(generated.manifestText, read('manifest.json').toString('utf8'));
  assert.equal(manifest.shards['places-v1'].bytes, publishedBytes.byteLength);
  assert.equal(createHash('sha256').update(publishedBytes).digest('hex'), manifest.shards['places-v1'].sha256);
  assert.equal(manifest.tiles['0/0-0'].sha256, manifest.shards['places-v1'].sha256);
});

test('published PLAC v3 bytes decode every place with historical name transitions', () => {
  const decoded = decodePlaceTile(publishedBytes);
  assert.equal(decoded.length, 163);
  const byId = new Map(decoded.map(row => [row.sourceId, row]));
  for (const raw of catalog.records) assert.deepEqual(byId.get(raw.sourceId), normalizePlace(raw));
  const peter = byId.get('498817');
  assert.deepEqual(
    ['1913-08-31', '1914-08-31', '1924-01-26', '1991-09-06'].map(date =>
      resolvePlaceLabelRows(peter, triple, date)[0]?.text),
    ['상트페테르부르크', '페트로그라드', '레닌그라드', '상트페테르부르크']);
  const minsk = byId.get('625144');
  assert.deepEqual(resolvePlaceLabelRows(minsk, triple, '1995-12-31').map(x => x.text).filter(x => x === 'Минск'), []);
  assert.ok(resolvePlaceLabelRows(minsk, triple, '1997-01-01').map(x => x.text).includes('Минск'));
  assert.ok(!hasPlaceNameCoverage(byId.get('2172517'), '1900-01-01'));
  assert.ok(hasPlaceNameCoverage(byId.get('2172517'), '1913-03-12'));
});

test('all selected present and historic languages are searchable without custom project labels', async () => {
  const store = createPlaceWorkerStore({ manifest, fetchBytes: async () => new Uint8Array(publishedBytes) });
  for (const [term, id] of [['서울', '1835848'], ['Leningrad', '498817'],
    ['Saint Petersburg', '498817'], ['València', '2509954'], ['臺北', '1668341']]) {
    const found = await store.search(term);
    assert.ok(found.records.some(row => row.sourceId === id), term + ' missing ' + id);
  }
  assert.ok(store.stats().cacheBytes > 0);
});

test('unverified and ambiguous cities are absent from published viewport and search', () => {
  const withheld = ['8063361', '2110257', '2110394', '5881576', '7828758',
    '282239', '2925533', '2879139', '3046446', '4140963', '281184'];
  for (const id of withheld) assert.equal(record(id), undefined,
    'unapproved place must not enter release: ' + id);
  assert.equal(record('2172517')?.kind, 'city');
  assert.equal(record('2172517')?.population, 0);
  assert.equal(catalog.stats.urbanIdentityFlagged, 0);
});

test('approval rules fail closed on provisional evidence or unresolved identity', () => {
  const base = { geonameId: 100001, featureClass: 'P', researchDifficulty: 'B',
    reviewStatus: 'source-reviewed-selected-facts',
    displayTimeline: [{ fromYear: 1900, sourceUrl: 'https://example.org/document' }] };
  assert.doesNotThrow(() => validateRuntimeApproval(base, 17));
  assert.throws(() => validateRuntimeApproval({ ...base, researchDifficulty: 'A' }, 17),
    /Unverified historical city/);
  assert.throws(() => validateRuntimeApproval({ ...base, reviewStatus: 'historical-baseline-provisional' }, 17),
    /Unverified historical city/);
  assert.throws(() => validateRuntimeApproval({ ...base,
    displayTimeline: [{ fromYear: 1801, sourceUrl: 'https://www.geonames.org/100001/' }] }, 17),
    /Unverified historical city/);
  assert.throws(() => validateRuntimeApproval({ ...base,
    candidatePolicyException: { autoPromoted: false } }, 17), /Unresolved city identity/);
  assert.throws(() => validateRuntimeApproval({ ...base,
    urbanIdentityReview: { autoTierApproved: false } }, 17), /Unresolved city identity/);
  assert.throws(() => validateRuntimeApproval({ ...base, geonameId: 3046446 }, 7),
    /Former Pest city requires/);
});
