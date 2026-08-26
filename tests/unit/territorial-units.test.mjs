import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TERRITORIAL_COVERAGE_MODES,
  TERRITORIAL_STATUS,
  TERRITORIAL_UNIT_TYPES,
  changeUnitType,
  createCountryTerritorialAdapter,
  createTerritorialFeature,
  createTerritorialRepository,
  migrateLegacyCountryRegions,
  normalizeTerritorialRelations,
  normalizeTerritorialUnits,
  resolveTerritorialRelation,
  runTerritorialTransaction,
  validateTerritorialRelations,
} from '../../assets/js/modules/territorial-units.js';

const square = (x0 = 0, y0 = 0, x1 = 10, y1 = 10) => ({
  type: 'Polygon',
  coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
});

test('legacy regions migrate to territory partitions without losing ids or geometry', () => {
  const [territory] = migrateLegacyCountryRegions([{
    type: 'Feature', id: 'r1', properties: { kind: 'region', countryId: 'PL', name: '지역' }, geometry: square(),
  }], { countryExists: id => id === 'PL' });
  assert.equal(territory.id, 'r1');
  assert.equal(territory.properties.unitType, TERRITORIAL_UNIT_TYPES.TERRITORY);
  assert.equal(territory.properties.parentId, 'PL');
  assert.equal(territory.properties.sovereignId, 'PL');
  assert.equal(territory.properties.coverageMode, TERRITORIAL_COVERAGE_MODES.PARTITION);
  assert.equal(territory.properties.status, TERRITORIAL_STATUS.ASSIGNED);
  assert.deepEqual(territory.geometry, square());
});

test('administrative levels follow parent depth and invalid parents recover to sovereign', () => {
  const units = normalizeTerritorialUnits([
    createTerritorialFeature({ id: 't1', unitType: 'territory', sovereignId: 'PL', parentId: 'PL', geometry: square() }),
    createTerritorialFeature({ id: 'a1', unitType: 'admin', sovereignId: 'PL', parentId: 't1', adminLevel: 8, geometry: square(0, 0, 5, 5) }),
    createTerritorialFeature({ id: 'a2', unitType: 'admin', sovereignId: 'PL', parentId: 'a1', adminLevel: 8, geometry: square(0, 0, 2, 2) }),
    createTerritorialFeature({ id: 'a3', unitType: 'admin', sovereignId: 'PL', parentId: 'missing', adminLevel: 8, geometry: square(2, 2, 3, 3) }),
  ], { countryExists: id => id === 'PL' });
  assert.equal(units.find(item => item.id === 'a1').properties.adminLevel, 1);
  assert.equal(units.find(item => item.id === 'a2').properties.adminLevel, 2);
  assert.equal(units.find(item => item.id === 'a3').properties.adminLevel, 1);
  assert.equal(units.find(item => item.id === 'a3').properties.parentId, 'PL');
  assert.equal(validateTerritorialRelations(units, { countryExists: id => id === 'PL' }).ok, true);
});

test('territory and administrative type changes preserve identity and geometry', () => {
  const territory = createTerritorialFeature({
    id: 'ireland', unitType: 'territory', name: '아일랜드', sovereignId: 'GBR', parentId: 'GBR', color: '#169b62', geometry: square(),
  });
  const administrative = changeUnitType(territory, TERRITORIAL_UNIT_TYPES.ADMIN);
  assert.equal(administrative.id, territory.id);
  assert.equal(administrative.properties.unitType, TERRITORIAL_UNIT_TYPES.ADMIN);
  assert.equal(administrative.properties.adminLevel, 1);
  assert.equal(administrative.properties.style.color, '#169b62');
  assert.deepEqual(administrative.geometry, territory.geometry);
  const restored = changeUnitType(administrative, TERRITORIAL_UNIT_TYPES.TERRITORY);
  assert.equal(restored.id, territory.id);
  assert.equal(restored.properties.unitType, TERRITORIAL_UNIT_TYPES.TERRITORY);
  assert.equal(restored.properties.adminLevel, null);
  assert.deepEqual(restored.geometry, territory.geometry);
});

test('explicit regions keep independent parent and sovereignty relationships', () => {
  const [region] = normalizeTerritorialUnits([createTerritorialFeature({
    id: 'historical-region', unitType: 'region', parentId: '', sovereignId: '', coverageMode: 'explicit', geometry: square(),
  })]);
  assert.equal(region.properties.unitType, TERRITORIAL_UNIT_TYPES.REGION);
  assert.equal(region.properties.coverageMode, TERRITORIAL_COVERAGE_MODES.EXPLICIT);
  assert.equal(region.properties.parentId, '');
  assert.equal(region.properties.sovereignId, '');
});

test('unassigned partition space keeps its sovereign and parent grouping', () => {
  const [remainder] = normalizeTerritorialUnits([createTerritorialFeature({
    id: 'remainder', unitType: 'territory', parentId: 'PL', sovereignId: 'PL', status: 'unassigned', geometry: square(),
  })], { countryExists: id => id === 'PL' });
  assert.equal(remainder.properties.status, TERRITORIAL_STATUS.UNASSIGNED);
  assert.equal(remainder.properties.sovereignId, 'PL');
  assert.equal(remainder.properties.parentId, 'PL');
});

test('deleted sovereigns become unassigned and circular parents are removed', () => {
  const units = normalizeTerritorialUnits([
    createTerritorialFeature({ id: 'a1', unitType: 'admin', sovereignId: 'gone', parentId: 'a2', geometry: square() }),
    createTerritorialFeature({ id: 'a2', unitType: 'admin', sovereignId: 'gone', parentId: 'a1', geometry: square() }),
  ], { countryExists: () => false });
  for (const unit of units) {
    assert.equal(unit.properties.sovereignId, '');
    assert.equal(unit.properties.status, TERRITORIAL_STATUS.UNASSIGNED);
    assert.equal(unit.properties.parentId, '');
  }
});

test('dated relations resolve by reference date and overlapping ranges are rejected', () => {
  const unit = createTerritorialFeature({ id: 't1', unitType: 'territory', sovereignId: 'A', parentId: 'A', geometry: square() });
  const relations = normalizeTerritorialRelations([
    { id: 'r1', unitId: 't1', parentId: 'B', sovereignId: 'B', validFrom: '1900-01-01', validTo: '1910-12-31' },
  ]);
  const resolved = resolveTerritorialRelation(unit, relations, '1905-01-01');
  assert.equal(resolved.properties.parentId, 'B');
  assert.equal(resolved.properties.sovereignId, 'B');
  const invalid = validateTerritorialRelations([unit], {
    countryExists: id => ['A', 'B'].includes(id),
    relations: [...relations, { id: 'r2', unitId: 't1', parentId: 'A', sovereignId: 'A', validFrom: '1905-01-01', validTo: '1920-01-01' }],
  });
  assert.equal(invalid.ok, false);
  assert.match(invalid.issues.join('\n'), /겹칩니다/);
});

test('country adapter and repository expose one territorial lookup surface', () => {
  const country = { type: 'Feature', id: 'PL', properties: { editor_id: 'PL', editor_name: '폴란드' }, geometry: square() };
  assert.equal(createCountryTerritorialAdapter(country).properties.sovereignId, 'PL');
  const territory = createTerritorialFeature({ id: 't1', unitType: 'territory', parentId: 'PL', sovereignId: 'PL', geometry: square() });
  const repository = createTerritorialRepository({ getCountries: () => ({ features: [country] }), getUnits: () => [territory] });
  assert.equal(repository.get('PL').properties.unitType, 'country');
  assert.equal(repository.get('t1').properties.unitType, 'territory');
  assert.deepEqual(repository.children('PL').map(item => item.id), ['t1']);
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
