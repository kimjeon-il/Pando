import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  loadIndependentHydronyms,
  validateIndependentHydronyms,
} from '../../tools/gis/hydro-independent-name-policy.mjs';

const path = fileURLToPath(new URL('../../tools/gis/hydro-independent-name-replacements.json', import.meta.url));
const cli = fileURLToPath(new URL('../../tools/gis/hydro-independent-name-policy.mjs', import.meta.url));
const original = readFileSync(path);
const payload = JSON.parse(original);
const originalHash = createHash('sha256').update(original).digest('hex');
const rows = () => loadIndependentHydronyms(path);
const changed = (id, mutate) => {
  const data = structuredClone(payload);
  mutate(data.replacements.find(row => row.systemId === id));
  return data;
};
test('42 independently reviewed original Hydro system IDs and source names are retained without mutation', () => {
  const review = rows(), keys = Object.keys(review);
  assert.equal(keys.length, 42);
  for (const id of ['10047863', '20282220', '20265844', '20597827', '50798885', '70816878', '70819626']) {
    assert.ok(Object.hasOwn(review, id), id);
  }
  assert.equal(review['20282220'].aliases.join(','), 'Elbe,Labe');
  assert.deepEqual(review['20265844'].tributaryNames, ['부크강', '나레프강']);
  assert.deepEqual(review['20597827'].tributaryNames, ['툰자강']);
  assert.equal(review['50798885'].officialGovernmentVectorEvidence.within1kmHydroToGovernment, 0.9876);
  assert.equal(review['70819626'].officialStationEvidence.stationIds.length, 3);
  const renamed = Object.fromEntries(Object.entries(review)
    .filter(([, value]) => value.previousNameKo !== value.nameKo)
    .map(([id, value]) => [id, value.nameKo]));
  assert.deepEqual(renamed, {
    '20680587': '과달키비르강', '40485117': '도네강', '41279826': '살윈강',
    '50261309': '바리토강', '70576631': '델라웨어강', '70816878': '브래저스강',
    '70819626': '콜로라도강', '20265844': '비스와강',
  });
  for (const item of Object.values(review)) {
    assert.ok(item.independentSources.every(src => !/openstreetmap|overpass/i.test(src.url)));
    assert.ok(!item.aliases.includes(item.previousNameKo));
    assert.ok(!item.tributaryNames.includes(item.previousNameKo));
  }
  assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), originalHash);
});
test('reject OSM/Overpass URL, missing Korean name and insufficient mainstem coverage', () => {
  for (const mutate of [
    row => { row.independentSources[0].url = 'https://www.openstreetmap.org/relation/1'; },
    row => { row.nameKo = ''; },
    row => { row.naturalEarth.sampleCoverage = 0.22; },
  ]) assert.throws(() => validateIndependentHydronyms(changed('10047863', mutate)));
});
test('USGS corroboration requires near stations and independent basin separation', () => {
  for (const mutate of [
    row => { row.officialStationEvidence.maximumMatchingStationDistanceKm = 15; },
    row => { row.officialStationEvidence.nearestDifferentBasinStationKm = 0.2; },
    row => { row.independentSources = row.independentSources.slice(0, 1); },
  ]) assert.throws(() => validateIndependentHydronyms(changed('70819626', mutate)));
});
test('conservative, partial, confluence and renamed basin reviews reject unsupported edits', () => {
  for (const [id, mutate] of [
    ['20336821', row => { row.conservativeMainstemReview.otherNamedNECoverage = 0.4; }],
    ['20336821', row => { row.nameKo = '오데르강'; }],
    ['20386022', row => { row.partialExistingNameReview.strongestOtherNENameCoverage = 0.4; }],
    ['20386022', row => { row.naturalEarth.sampleCoverage = 0.2; }],
    ['20498112', row => { row.basinConfluenceReview.tributarySampleCoverage = 0.01; }],
    ['20498112', row => { row.nameKo = '오데르강'; }],
    ['20265844', row => { row.independentBasinRename.tributarySampleCoverage = 0.1; }],
    ['20265844', row => { row.independentBasinRename.method = 'auto-bbox-rename'; }],
    ['20265844', row => { row.independentSources = row.independentSources.filter(s => s.kind !== 'government-ministry-geography'); }],
  ]) assert.throws(() => validateIndependentHydronyms(changed(id, mutate)), id);
});
test('state vector and cross-border review must retain licence, independent sources and verified geometry', () => {
  for (const [id, mutate] of [
    ['50798885', row => { row.officialGovernmentVectorEvidence.within1kmHydroToGovernment = 0.12; }],
    ['50798885', row => { row.officialGovernmentVectorEvidence.sourceGeoJSONSha256 = 'x'.repeat(64); }],
    ['50798885', row => { row.independentSources = row.independentSources.slice(0, 2); }],
    ['20597827', row => { row.nameKo = '오데르강'; }],
    ['20597827', row => { row.crossBorderNameReview.strongestOtherNENameCoverage = 0.5; }],
    ['20597827', row => { row.independentSources = row.independentSources.filter(s => s.kind !== 'government-crossborder-hydrology'); }],
  ]) assert.throws(() => validateIndependentHydronyms(changed(id, mutate)), id);
});
test('old OSM-only IDs remain unverified and rejected by the policy', () => {
  const result = rows();
  for (const id of ['41023100', '20773860', '41182380', '41386179'])
    assert.equal(Object.hasOwn(result, id), false);
});
test('Node CLI returns the same approved mapping without changing its input JSON', () => {
  const result = spawnSync(process.execPath, [cli, '--input', path], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), rows());
  assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), originalHash);
});
