import assert from 'node:assert/strict';
import test from 'node:test';
import { sharedCalculationCore } from "../../shared/frontend/js/modules/temporal.js";

import {
  assignImportedCountries,
  buildTerritorialImportTransactionPlan,
} from "../../apps/editor/frontend/js/modules/territorial-import-plan.js";


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

test('shared GIS geometry planner reports the donor and the unchanged owner area', () => {
  const shape=(x0,x1)=>[[[[x0,0],[x1,0],[x1,2],[x0,2],[x0,0]]]];
  const result=sharedCalculationCore.planGisTerritoryGeometry(
    ['A','B'], [true,true], [shape(0,2),shape(2,4)], [shape(1,3)], [{index:0,features:[0]}],
  );
  assert.equal(result.status,'valid');
  assert.equal(result.groups.length,1);
  assert.deepEqual(result.groups[0].donors.map(row=>row.index),[1]);
  assert.equal(result.groups[0].donors[0].absorbed,false);
  assert.equal(result.groups[0].existingArea,result.groups[0].donors[0].area);
  assert.equal(result.groups[0].newArea,0);
});

test('shared GIS geometry planner rejects non-finite coordinates', () => {
  for (const coordinate of [NaN, Infinity, -Infinity]) {
    const shape = [[[[0, 0], [coordinate, 0], [1, 1], [0, 0]]]];
    assert.throws(() => sharedCalculationCore.planGisTerritoryGeometry(
      ['A'], [true], [shape], [shape], [{ index: 0, features: [0] }],
    ), /Invalid polygon coordinate/);
  }
});

test('shared GIS geometry planner preserves absorbed donors and missing-owner errors', () => {
  const shape = (x0, x1) => [[[[x0, 0], [x1, 0], [x1, 2], [x0, 2], [x0, 0]]]];
  const result = sharedCalculationCore.planGisTerritoryGeometry(
    ['한국', '이웃'], [true, true], [shape(0, 2), shape(2, 3)], [shape(1, 3)], [{ index: 0, features: [0] }],
  );
  assert.deepEqual(result.absorbed, [1]);
  assert.equal(result.groups[0].donors[0].absorbed, true);
  const missing = sharedCalculationCore.planGisTerritoryGeometry(
    ['한국'], [false], [[]], [shape(1, 3)], [{ index: 0, features: [0] }],
  );
  assert.equal(missing.status, 'missing-owner');
  assert.equal(missing.missing, 0);
});

function rectangle(id, name, minX, minY, maxX, maxY, properties = {}) {
  return {
    type: 'Feature', id,
    properties: { name, ...properties },
    geometry: { type: 'MultiPolygon', coordinates: [[[[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY]]]] },
  };
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
  });

  assert.equal(plan.featureCount, 1);
  assert.equal(plan.groups.length, 1);
  assert.deepEqual(plan.groups[0].donorIds.sort(), ['LTU', 'POL', 'RUS']);
  assert.equal(plan.groups[0].importedGeometry.coordinates.length, 2);
  assert.equal(plan.groups[0].existingOwnerAreaKm2, 24712.37300428505);
  assert.equal(plan.groups[0].newAreaKm2, 12359.9520368632);
  assert.equal(plan.totalAreaKm2, 210058.93607114357);
  assert.equal(plan.transferAreaKm2, 172986.61102999537);
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
    countryField: 'sovereign_id',
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
    features: [left, right], countries, targetCountryId: 'DEU',
  }), /가져올 객체끼리 겹칩니다/);
});
