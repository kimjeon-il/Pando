import assert from 'node:assert/strict';
import test from 'node:test';

import '../../assets/js/vendor/polygon-clipping.min.js';
import {
  assignImportedCountries,
  buildTerritorialImportTransactionPlan,
} from '../../assets/js/modules/territorial-import-plan.js';

const clipper = globalThis.polygonClipping;

function rectangle(id, name, minX, minY, maxX, maxY, properties = {}) {
  return {
    type: 'Feature', id,
    properties: { editor_id: id, editor_name: name, ...properties },
    geometry: { type: 'MultiPolygon', coordinates: [[[[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY]]]] },
  };
}

function planarArea(geometry) {
  return (geometry?.coordinates || []).reduce((sum, polygon) => {
    const ring = polygon[0] || [];
    let twice = 0;
    for (let index = 0; index < ring.length - 1; index += 1) twice += ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1];
    return sum + Math.abs(twice) / 2;
  }, 0);
}

test('a multipart administrative import transfers every donor intersection to the explicit owner', () => {
  const countries = [
    rectangle('DEU', '독일', 0, 0, 4, 4),
    rectangle('POL', '폴란드', 4, 0, 8, 4),
    rectangle('RUS', '러시아', 8, 0, 10, 4),
    rectangle('LTU', '리투아니아', 10, 0, 12, 4),
  ];
  const eastPrussia = rectangle('OST', '동프로이센', 3, 1, 11, 3, { sovereign_id: 'HIST_DEU_OSTPREUSSEN_1900' });
  eastPrussia.geometry.coordinates.push([[[13, 1], [14, 1], [14, 2], [13, 2], [13, 1]]]);

  const plan = buildTerritorialImportTransactionPlan({
    features: [eastPrussia], countries, targetCountryId: 'DEU',
    clipper, areaKm2: planarArea,
  });

  assert.equal(plan.featureCount, 1);
  assert.equal(plan.groups.length, 1);
  assert.deepEqual(plan.groups[0].donorIds.sort(), ['LTU', 'POL', 'RUS']);
  assert.equal(plan.groups[0].importedGeometry.coordinates.length, 2);
  assert.equal(plan.groups[0].existingOwnerAreaKm2, 2);
  assert.equal(plan.groups[0].newAreaKm2, 1);
});

test('a non-empty unresolved per-feature country value never falls back to the common country', () => {
  const countries = [rectangle('DEU', '독일', 0, 0, 4, 4)];
  const feature = rectangle('OST', '동프로이센', 1, 1, 2, 2, { sovereign_id: 'missing-historical-id' });
  const assignments = assignImportedCountries([feature], {
    countries, targetCountryId: 'DEU', useFeatureCountryField: true, countryField: 'sovereign_id',
  });

  assert.equal(assignments[0].countryId, '');
  assert.equal(assignments[0].usedFallback, false);
  assert.equal(assignments[0].unresolvedValue, 'missing-historical-id');
  assert.throws(() => buildTerritorialImportTransactionPlan({
    features: [feature], countries, targetCountryId: 'DEU', useFeatureCountryField: true,
    countryField: 'sovereign_id', clipper, areaKm2: planarArea,
  }), /현재 지도에서 찾을 수 없습니다/);
});

test('an empty per-feature country value may use the explicit common country', () => {
  const countries = [rectangle('DEU', '독일', 0, 0, 4, 4)];
  const feature = rectangle('OST', '동프로이센', 1, 1, 2, 2, { sovereign_id: '' });
  const assignments = assignImportedCountries([feature], {
    countries, targetCountryId: 'DEU', useFeatureCountryField: true, countryField: 'sovereign_id',
  });
  assert.equal(assignments[0].countryId, 'DEU');
  assert.equal(assignments[0].usedFallback, true);
  assert.equal(assignments[0].unresolvedValue, '');
});

test('overlapping imported objects are rejected before any country geometry changes', () => {
  const countries = [rectangle('DEU', '독일', 0, 0, 5, 5)];
  const left = rectangle('A', 'A', 1, 1, 3, 3);
  const right = rectangle('B', 'B', 2, 2, 4, 4);

  assert.throws(() => buildTerritorialImportTransactionPlan({
    features: [left, right], countries, targetCountryId: 'DEU', clipper, areaKm2: planarArea,
  }), /가져올 객체끼리 겹칩니다/);
});
