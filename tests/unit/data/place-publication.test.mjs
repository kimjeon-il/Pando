import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { reportPath } from "../../../tools/data/report-paths.mjs";
import { canonicalPlaceTextBytes, generatePlaceRelease, validateRuntimeApproval } from "../../../tools/build/build-place-runtime.mjs";
import { decodePlaceTile } from "../../../src/data/place-codec.js";
import { normalizePlace, PLACE_DISPLAY_TIERS, resolvePlaceDisplayRank } from "../../../src/document/place-contract.js";
import { layoutLabels } from "../../../src/rendering/label-layout.js";
import { placeView } from "../../helpers/place-view.mjs";
import { resolvePlaceLabelRows } from "../../../src/ui/place-name-display.js";
import { createPlaceWorkerStore } from "../../../src/data/place-worker-store.js";

const assets = new URL("../../../assets/data/places/", import.meta.url);
const read = name => readFileSync(new URL(name, assets));
const catalog = JSON.parse(read('reviewed-records-v1.json').toString('utf8'));
const manifest = JSON.parse(read('manifest.json').toString('utf8'));
const approvals = JSON.parse(readFileSync(reportPath('reports/places/runtime-release-approvals-v1.json', { access: 'read' }), 'utf8'));
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
  const reviewFiles = readdirSync(reportPath('reports/places', { access: 'read' }))
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

test('five display bands prioritize Seoul over Daejeon using pinned PLAC v3 bytes', async () => {
  const places = decodePlaceTile(publishedBytes);
  const seoul = places.find(row => row.sourceId === '1835848');
  const daejeon = places.find(row => row.sourceId === '1835235');
  assert.equal(seoul.featureCode, 'PPLC');
  assert.equal(daejeon.featureCode, 'PPLA');
  assert.equal(seoul.priority, 70, 'pinned publisher data stays unranked');
  assert.equal(daejeon.priority, 70, 'candidate/release data is unchanged');
  assert.equal(resolvePlaceDisplayRank(seoul).tier, 1);
  assert.equal(resolvePlaceDisplayRank(daejeon).tier, 3);
  assert.ok(resolvePlaceDisplayRank(seoul).priority > resolvePlaceDisplayRank(daejeon).priority);
  assert.ok(resolvePlaceDisplayRank(seoul).minZoom < resolvePlaceDisplayRank(daejeon).minZoom);
  const ordered = ['PPLC', 'PPLG', 'PPLA', 'PPLA2', 'PPL']
    .map((featureCode, i) => resolvePlaceDisplayRank(normalizePlace({
      source: 'geonames', sourceId: String(90000000 + i), kind: 'city', name: 'Test',
      coordinates: [0, 0], featureCode, priority: 70, minZoom: 1.25,
    })));
  assert.deepEqual(ordered.map(row => row.tier), [1, 2, 3, 4, 5]);
  assert.ok(ordered.every((row, i) => row === PLACE_DISPLAY_TIERS[i + 1]));
  for (const [source, kind] of [['synthetic', 'city'], ['geonames', 'town']]) {
    const unranked = normalizePlace({ source, sourceId: '9999', name: 'Not auto-promoted',
      kind, coordinates: [0, 0], featureCode: 'PPLC', priority: 70, minZoom: 1.25 });
    assert.equal(resolvePlaceDisplayRank(unranked).tier, null,
      'unapproved or noncity references must not be promoted into the five-band display');
  }
  assert.ok(ordered.every((row, i) => i === 0 || (
    ordered[i - 1].priority > row.priority && ordered[i - 1].minZoom < row.minZoom
  )));
  const candidates = [daejeon, seoul].map(row => {
    const display = resolvePlaceDisplayRank(row);
    return { key: row.id, point: [200, 200], width: 80, height: 22,
      priority: display.priority, minZoom: display.minZoom, collisionGroup: 'place' };
  });
  assert.deepEqual(layoutLabels(candidates, { zoom: 3 }).map(row => row.key), [seoul.id],
    'when labels overlap, the capital-like display tier must win over GeoNames ID order');

  const store = createPlaceWorkerStore({ manifest, fetchBytes: async () => new Uint8Array(publishedBytes) });
  const view = { flatCenter: [127.2, 37], width: 800, height: 600, scale: 900 };
  const coarse = await store.queryViewport(placeView({ ...view, threshold: 1 }));
  assert.ok(coarse.records.some(row => row.sourceId === seoul.sourceId), 'Seoul should be eligible at 1x');
  assert.ok(!coarse.records.some(row => row.sourceId === daejeon.sourceId), 'Daejeon should wait for its tier');
  const detailed = await store.queryViewport(placeView({ ...view, threshold: 2 }));
  assert.ok(detailed.records.some(row => row.sourceId === daejeon.sourceId), 'Daejeon enters at 2x');
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
