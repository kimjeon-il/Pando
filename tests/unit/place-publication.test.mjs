import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { canonicalPlaceTextBytes, generatePlaceRelease, validateRuntimeApproval } from '../../tools/build-place-runtime.mjs';
import { decodePlaceTile } from "../../shared/frontend/js/modules/place-codec.js";
import { normalizePlace } from "../../shared/frontend/js/modules/place-contract.js";
import { resolvePlaceLabelRows } from "../../shared/frontend/js/modules/place-name-display.js";
import { createPlaceWorkerStore } from "../../shared/frontend/js/modules/place-worker-store.js";

const assets = new URL('../../assets/data/places/', import.meta.url);
const read = name => readFileSync(new URL(name, assets));
const catalog = JSON.parse(read('reviewed-records-v1.json').toString('utf8'));
const manifest = JSON.parse(read('manifest.json').toString('utf8'));
const approvals = JSON.parse(readFileSync(new URL('../../reports/places/runtime-release-approvals-v1.json', import.meta.url), 'utf8'));
const publishedBytes = read('places-v1.bin');
const triple = { ko: true, en: true, native: true };
const record = id => catalog.records.find(row => row.sourceId === String(id));

test('release provenance uses Git LF bytes for either checkout line ending', () => {
  const lf = Buffer.from('{"name":"니코시아"}\n');
  const crlf = Buffer.from('{"name":"니코시아"}\r\n');
  assert.deepEqual(canonicalPlaceTextBytes(lf), lf);
  assert.deepEqual(canonicalPlaceTextBytes(crlf), lf);
});

test('only approved source-verified cities in current review batches are reproducibly published', () => {
  const generated = generatePlaceRelease();
  const reviewFiles = readdirSync(new URL('../../reports/places/', import.meta.url))
    .filter(name => /^tier1-major-cities-batch\d{2}[-a-z0-9]*\.json$/u.test(name))
    .sort()
    .map(name => 'reports/places/' + name);
  assert.deepEqual(catalog.reviewBatches.map(batch => batch.file), reviewFiles);
  assert.equal(catalog.stats.sourceBatchCount, reviewFiles.length);
  const approvedCount = approvals.approvedSourceIds.length;
  assert.equal(generated.recordCount, approvedCount);
  assert.equal(catalog.stats.cityCount, approvedCount);
  assert.equal(catalog.stats.stagedCount, catalog.reviewBatches.reduce((sum, batch) => sum + batch.cityCount, 0));
  assert.equal(catalog.stats.withheldCount, catalog.stats.stagedCount - approvedCount);
  assert.equal(catalog.stats.unrankedCount, approvedCount);
  assert.equal(catalog.stats.timelineEntries,
    catalog.records.reduce((sum, row) => sum + row.nameTimeline.length, 0));
  assert.equal(new Set(catalog.records.map(row => row.sourceId)).size, approvedCount);
  assert.equal(catalog.approval.approvedIds, approvedCount);
  assert.deepEqual(catalog.records.map(row => Number(row.sourceId)),
    approvals.approvedSourceIds);
  assert.equal(generated.catalogText, canonicalPlaceTextBytes(read('reviewed-records-v1.json')).toString('utf8'));
  assert.ok(generated.bytes.equals(publishedBytes));
  assert.equal(generated.manifestText, canonicalPlaceTextBytes(read('manifest.json')).toString('utf8'));
  assert.equal(manifest.shards['places-v1'].bytes, publishedBytes.byteLength);
  assert.equal(createHash('sha256').update(publishedBytes).digest('hex'), manifest.shards['places-v1'].sha256);
  assert.equal(manifest.tiles['0/0-0'].sha256, manifest.shards['places-v1'].sha256);
});

test('published PLAC v3 bytes decode every place with historical name transitions', () => {
  const decoded = decodePlaceTile(publishedBytes);
  assert.equal(decoded.length, approvals.approvedSourceIds.length);
  const byId = new Map(decoded.map(row => [row.sourceId, row]));
  for (const raw of catalog.records) assert.deepEqual(byId.get(raw.sourceId), normalizePlace(raw));
  const peter = byId.get('498817');
  assert.deepEqual(
    ['1913-08-31', '1914-08-31', '1924-01-26', '1991-09-06'].map(date =>
      resolvePlaceLabelRows(peter, triple, date)[0]?.text),
    ['상트페테르부르크', '페트로그라드', '레닌그라드', '상트페테르부르크']);
  const volgograd = byId.get('472757');
  assert.deepEqual(
    ['1924-01-01', '1930-01-01', '1970-01-01'].map(date =>
      resolvePlaceLabelRows(volgograd, triple, date)[0]?.text),
    ['차리친', '스탈린그라드', '볼고그라드']);
  assert.ok(resolvePlaceLabelRows(byId.get('524305'),triple,'1915-01-01')[0].modernName);
  assert.ok(resolvePlaceLabelRows(byId.get('524305'),triple,'1916-12-31').length>0);
  const minsk = byId.get('625144');
  assert.deepEqual(resolvePlaceLabelRows(minsk, triple, '1995-12-31').map(x => x.text).filter(x => x === 'Минск'), []);
  assert.ok(resolvePlaceLabelRows(minsk, triple, '1997-01-01').map(x => x.text).includes('Минск'));
  assert.ok(resolvePlaceLabelRows(byId.get('2172517'),triple,'1900-01-01')[0].modernName);
  // Name periods are not settlement-existence records. A date before their
  // first selected name keeps an explicitly current-name label.
  for (const [id, lastBefore, firstAt] of [
    ['1835235', '1904-12-31', '1905-01-01'],
    ['1526273', '1829-12-31', '1830-12-31'],
    ['1528675', '1867-12-31', '1868-12-31'],
    ['162183', '1880-12-31', '1881-12-31'],
  ]) {
    assert.ok(resolvePlaceLabelRows(byId.get(id),triple,lastBefore).length>0);
    assert.ok(resolvePlaceLabelRows(byId.get(id),triple,lastBefore)[0].modernName,id);
    assert.ok(resolvePlaceLabelRows(byId.get(id),triple,firstAt).length>0,id+' missing after first naming record');
  }
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
  assert.throws(() => validateRuntimeApproval({ ...base,
    temporalEligibility: { activeIntervals: [{ untilYear: 1873 }] } }, 17),
    /Multi-episode urban eligibility/);
  assert.throws(() => validateRuntimeApproval({ ...base, geonameId: 3046446 }, 7),
    /Former Pest city requires/);
});
