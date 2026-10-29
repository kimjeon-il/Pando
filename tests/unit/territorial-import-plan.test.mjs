import assert from 'node:assert/strict';
import test from 'node:test';
import { sharedCalculationCore } from "../../shared/frontend/js/modules/temporal.js";

import "../../shared/frontend/js/vendor/polygon-clipping.min.js";
import {
  assignImportedCountries,
  buildTerritorialImportTransactionPlan,
} from "../../apps/editor/frontend/js/modules/territorial-import-plan.js";

const clipper = globalThis.polygonClipping;

test('shared GIS country resolver rejects ambiguity but preserves repeated IDs and Unicode', () => {
  const indexes=sharedCalculationCore.resolveGisCountryNames(
    ['A','B','A',''], ['a','b','a',''], ['한국','한국','한국','빈 ID'],
    ['a','한국','b','빈 ID','없는 이름',''],
  );
  assert.deepEqual(indexes,[0,-1,1,-1,-1,-1]);
  assert.deepEqual(sharedCalculationCore.resolveGisCountryNames(
    ['한글','한글'], ['한글','한글'], ['나라','나라'], ['나라']), [0]);
});

test('shared GIS assignments never replace a nonempty unresolved field with the fallback', () => {
  const plan=sharedCalculationCore.planGisCountryAssignments(
    ['A','B'], ['a','b'], ['한국','한국'], 'a', ['','한국','b'], [false,true,true],
  );
  assert.deepEqual(plan, {assignments:[
      {index:0,usedFallback:true,unresolvedField:false},
      {index:-1,usedFallback:false,unresolvedField:true},
      {index:1,usedFallback:false,unresolvedField:false},
    ], groups:[{index:0,features:[0]},{index:1,features:[2]}]});
  const repeated=sharedCalculationCore.planGisCountryAssignments(
    ['A','A'], ['a','a'], ['first','second'], '', ['second','first'], [true,true],
  );
  assert.deepEqual(repeated.groups,[{index:1,features:[0,1]}]);
});

test('shared GIS import area decisions retain overlap and remainder thresholds', () => {
  const decide=sharedCalculationCore.gisTerritorialAreaDecision;
  assert.equal(decide('input-overlap', 0.000001, 1, 2), false);
  assert.equal(decide('input-overlap', 0.000002, 1, 2), true);
  assert.equal(decide('country-overlap', 0.000001, 1, 0), false);
  assert.equal(decide('country-overlap', 0.000002, 1, 0), true);
  assert.equal(decide('country-overlap', NaN, 1, 0), true);
  assert.equal(decide('absorbed', 0.000001, 1, 0), true);
  assert.equal(decide('absorbed', 0.000002, 1, 0), false);
});

function rectangle(id, name, minX, minY, maxX, maxY, properties = {}) {
  return {
    type: 'Feature', id,
    properties: { name, ...properties },
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

test('country fields use Unicode names without falling back on an ambiguous nonempty value', () => {
  const countries = [rectangle('A', '대한민국', 0, 0, 1, 1), rectangle('B', '대한민국', 2, 0, 3, 1),
    rectangle('C', 'Türkiye', 4, 0, 5, 1), rectangle('C', 'Türkiye', 4, 0, 5, 1)];
  const features = [rectangle('one', 'One', 0, 0, 1, 1, { country: '대한민국' }),
    rectangle('two', 'Two', 0, 0, 1, 1, { country: 'türkiye' }),
    rectangle('three', 'Three', 0, 0, 1, 1, { country: '' })];
  const result = assignImportedCountries(features, { countries, targetCountryId: 'A', useFeatureCountryField: true, countryField: 'country' });
  assert.deepEqual(result.map(({countryId,usedFallback,unresolvedValue})=>({countryId,usedFallback,unresolvedValue})), [
    {countryId:'',usedFallback:false,unresolvedValue:'대한민국'},
    {countryId:'C',usedFallback:false,unresolvedValue:''},
    {countryId:'A',usedFallback:true,unresolvedValue:''},
  ]);
});

test('overlapping imported objects are rejected before any country geometry changes', () => {
  const countries = [rectangle('DEU', '독일', 0, 0, 5, 5)];
  const left = rectangle('A', 'A', 1, 1, 3, 3);
  const right = rectangle('B', 'B', 2, 2, 4, 4);

  assert.throws(() => buildTerritorialImportTransactionPlan({
    features: [left, right], countries, targetCountryId: 'DEU', clipper, areaKm2: planarArea,
  }), /가져올 객체끼리 겹칩니다/);
});
