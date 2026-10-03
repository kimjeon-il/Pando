import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TERRITORIAL_COVERAGE_MODES,
  TERRITORIAL_UNIT_TYPES,
  changeUnitType,
  createTerritorialFeature,
  normalizeTerritorialRelations,
  normalizeTerritorialEntities,
  runTerritorialTransaction,
  validateTerritorialRelations,
} from '../../assets/js/modules/territorial-units.js';

const square = (x0 = 0, y0 = 0, x1 = 10, y1 = 10) => ({
  type: 'Polygon',
  coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
});

test('territorial normalization rejects legacy aliases and duplicate IDs', () => {
  assert.throws(() => normalizeTerritorialEntities([{
    type: 'Feature', id: 'r1', properties: { kind: 'region', countryId: 'PL' }, geometry: square(),
  }]), /영역 형식/);
  const unit = createTerritorialFeature({ id: 'r1', unitType: 'subunit', parentId: 'PL', geometry: square() });
  assert.throws(() => normalizeTerritorialEntities([unit, unit], { getEntity: id => id==='PL'?createTerritorialFeature({id,unitType:'country',geometry:square()}):null }), /중복/);
});

test('hierarchy uses parent relations without administrative levels', () => {
  const units = normalizeTerritorialEntities([
    createTerritorialFeature({ id: 't1', unitType: 'subunit', parentId: 'PL', geometry: square() }),
    createTerritorialFeature({ id: 'a1', unitType: 'subunit', parentId: 't1', adminLevel: 8, geometry: square(0, 0, 5, 5) }),
    createTerritorialFeature({ id: 'a2', unitType: 'subunit', parentId: 'a1', adminLevel: 8, geometry: square(0, 0, 2, 2) }),
  ], { getEntity: id => id==='PL'?createTerritorialFeature({id,unitType:'country',geometry:square()}):null });
  assert.equal(units.find(item => item.id === 'a1').properties.adminLevel, undefined);
  assert.equal(units.find(item => item.id === 'a2').properties.adminLevel, undefined);
  assert.equal(validateTerritorialRelations(units, { getEntity: id => id==='PL'?createTerritorialFeature({id,unitType:'country',geometry:square()}):null }).ok, true);
  assert.throws(() => normalizeTerritorialEntities([
    createTerritorialFeature({ id: 'a3', unitType: 'subunit', parentId: 'missing', geometry: square() }),
  ], { getEntity: id => id==='PL'?createTerritorialFeature({id,unitType:'country',geometry:square()}):null }), /상위 단위|부모/);
});

test('subunit and region type changes preserve identity and geometry', () => {
  const territory = createTerritorialFeature({
    id: 'ireland', unitType: 'subunit', name: '아일랜드', parentId: 'GBR', color: '#169b62', geometry: square(),
  });
  const administrative = changeUnitType(territory, TERRITORIAL_UNIT_TYPES.REGION);
  assert.equal(administrative.id, territory.id);
  assert.equal(administrative.properties.unitType, TERRITORIAL_UNIT_TYPES.REGION);
  assert.equal(administrative.properties.adminLevel, undefined);
  assert.equal(administrative.properties.style.color, '#169b62');
  assert.deepEqual(administrative.geometry, territory.geometry);
  const restored = changeUnitType(administrative, TERRITORIAL_UNIT_TYPES.SUBUNIT);
  assert.equal(restored.id, territory.id);
  assert.equal(restored.properties.unitType, TERRITORIAL_UNIT_TYPES.SUBUNIT);
  assert.equal(restored.properties.adminLevel, undefined);
  assert.deepEqual(restored.geometry, territory.geometry);
});

test('explicit regions keep independent parent and country association relationships', () => {
  const [region] = normalizeTerritorialEntities([createTerritorialFeature({
    id: 'historical-region', unitType: 'region', parentId: '', coverageMode: 'explicit', geometry: square(),
  })]);
  assert.equal(region.properties.unitType, TERRITORIAL_UNIT_TYPES.REGION);
  assert.equal(region.properties.coverageMode, TERRITORIAL_COVERAGE_MODES.EXPLICIT);
  assert.equal(region.properties.parentId, '');
  assert.equal(region.properties.associatedCountryId, '');
});

test('deprecated remainder flags are not stored', () => {
  const [remainder] = normalizeTerritorialEntities([createTerritorialFeature({
    id: 'remainder', unitType: 'subunit', parentId: 'PL', isRemainder: true, geometry: square(),
  })], { getEntity: id => id==='PL'?createTerritorialFeature({id,unitType:'country',geometry:square()}):null });
  assert.equal(remainder.properties.isRemainder, undefined);
  assert.equal(remainder.properties.associatedCountryId, '');
  assert.equal(remainder.properties.parentId, 'PL');
  const independent = createTerritorialFeature({ id: 'independent', unitType: 'region', isRemainder: false, geometry: square() });
  assert.equal(independent.properties.associatedCountryId, '');
  assert.equal(independent.properties.isRemainder, undefined);
});

test('dangling references and circular parents fail without automatic clearing', () => {
  assert.throws(() => normalizeTerritorialEntities([
    createTerritorialFeature({ id: 'a1', unitType: 'subunit', parentId: 'a2', geometry: square() }),
    createTerritorialFeature({ id: 'a2', unitType: 'subunit', parentId: 'a1', geometry: square() }),
  ], { getEntity: () => null }), /소속 국가 gone|순환/);
});


test('dated relations resolve by reference date and overlapping ranges are rejected', () => {
  const unit = createTerritorialFeature({ id: 't1', unitType: 'subunit', parentId: 'A', geometry: square() });
  const relations = normalizeTerritorialRelations([
    { id: 'r1', schemaVersion: 2, unitId: 't1', parentId: 'B', validFrom: '1900-01-01', validTo: '1910-12-31' },
  ]);
  const invalid = validateTerritorialRelations([unit], {
    getEntity: id=>['A','B'].includes(id)?createTerritorialFeature({id,unitType:'country',geometry:square()}):null,
    relations: [...relations, { id: 'r2', unitId: 't1', parentId: 'A', validFrom: '1905-01-01', validTo: '1920-01-01' }],
  });
  assert.equal(invalid.ok, false);
  assert.match(invalid.issues.join('\n'), /겹칩니다/);
});

test('territorial transaction records and autosaves once on success', async () => {
  const calls = [];
  const result = await runTerritorialTransaction({
    snapshot: () => ({ value: 1 }), calculate: async () => ({ value: 2 }), validate: () => ({ ok: true }),
    apply: value => calls.push(['apply', value.value]), restore: () => calls.push(['restore']),
    recordHistory: value => calls.push(['history', value.value]), autosave: () => calls.push(['autosave']),
  });
  assert.equal(result.value, 2);
  assert.deepEqual(calls, [['apply', 2], ['history', 1], ['autosave']]);
});

test('territorial transaction restores once and skips history/autosave on failure', async () => {
  const calls = [];
  await assert.rejects(runTerritorialTransaction({
    snapshot: () => ({ value: 1 }), calculate: async () => ({ value: 2 }), validate: () => ({ ok: false, message: 'invalid' }),
    apply: () => calls.push(['apply']), restore: value => calls.push(['restore', value.value]),
    recordHistory: () => calls.push(['history']), autosave: () => calls.push(['autosave']),
  }), /invalid/);
  assert.deepEqual(calls, [['restore', 1]]);
});
