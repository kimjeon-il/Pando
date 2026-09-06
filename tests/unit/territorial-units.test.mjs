import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TERRITORIAL_COVERAGE_MODES,
  TERRITORIAL_UNIT_TYPES,
  changeUnitType,
  createCountryTerritorialAdapter,
  createTerritorialFeature,
  createTerritorialRepository,
  normalizeTerritorialRelations,
  normalizeTerritorialUnits,
  reconcilePartitionRemainder,
  resolveTerritorialRelation,
  runTerritorialTransaction,
  validateTerritorialRelations,
  validatePartitionRemainders,
} from '../../assets/js/modules/territorial-units.js';

const square = (x0 = 0, y0 = 0, x1 = 10, y1 = 10) => ({
  type: 'Polygon',
  coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
});

test('territorial normalization rejects legacy aliases and duplicate IDs', () => {
  assert.throws(() => normalizeTerritorialUnits([{
    type: 'Feature', id: 'r1', properties: { kind: 'region', countryId: 'PL' }, geometry: square(),
  }]), /영역 형식/);
  const unit = createTerritorialFeature({ id: 'r1', unitType: 'subunit', sovereignId: 'PL', parentId: 'PL', geometry: square() });
  assert.throws(() => normalizeTerritorialUnits([unit, unit], { countryExists: id => id === 'PL' }), /중복/);
});

test('administrative levels are preserved and dangling parents fail instead of being rewritten', () => {
  const units = normalizeTerritorialUnits([
    createTerritorialFeature({ id: 't1', unitType: 'subunit', sovereignId: 'PL', parentId: 'PL', geometry: square() }),
    createTerritorialFeature({ id: 'a1', unitType: 'subunit', sovereignId: 'PL', parentId: 't1', adminLevel: 8, geometry: square(0, 0, 5, 5) }),
    createTerritorialFeature({ id: 'a2', unitType: 'subunit', sovereignId: 'PL', parentId: 'a1', adminLevel: 8, geometry: square(0, 0, 2, 2) }),
  ], { countryExists: id => id === 'PL' });
  assert.equal(units.find(item => item.id === 'a1').properties.adminLevel, 8);
  assert.equal(units.find(item => item.id === 'a2').properties.adminLevel, 8);
  assert.equal(validateTerritorialRelations(units, { countryExists: id => id === 'PL' }).ok, true);
  assert.throws(() => normalizeTerritorialUnits([
    createTerritorialFeature({ id: 'a3', unitType: 'subunit', sovereignId: 'PL', parentId: 'missing', geometry: square() }),
  ], { countryExists: id => id === 'PL' }), /상위 영역 missing/);
});

test('subunit and region type changes preserve identity and geometry', () => {
  const territory = createTerritorialFeature({
    id: 'ireland', unitType: 'subunit', name: '아일랜드', sovereignId: 'GBR', parentId: 'GBR', color: '#169b62', geometry: square(),
  });
  const administrative = changeUnitType(territory, TERRITORIAL_UNIT_TYPES.REGION);
  assert.equal(administrative.id, territory.id);
  assert.equal(administrative.properties.unitType, TERRITORIAL_UNIT_TYPES.REGION);
  assert.equal(administrative.properties.adminLevel, null);
  assert.equal(administrative.properties.style.color, '#169b62');
  assert.deepEqual(administrative.geometry, territory.geometry);
  const restored = changeUnitType(administrative, TERRITORIAL_UNIT_TYPES.SUBUNIT);
  assert.equal(restored.id, territory.id);
  assert.equal(restored.properties.unitType, TERRITORIAL_UNIT_TYPES.SUBUNIT);
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

test('partition remainder keeps sovereignty independent from its remainder meaning', () => {
  const [remainder] = normalizeTerritorialUnits([createTerritorialFeature({
    id: 'remainder', unitType: 'subunit', parentId: 'PL', sovereignId: 'PL', isRemainder: true, geometry: square(),
  })], { countryExists: id => id === 'PL' });
  assert.equal(remainder.properties.isRemainder, true);
  assert.equal(remainder.properties.sovereignId, 'PL');
  assert.equal(remainder.properties.parentId, 'PL');
  const independent = createTerritorialFeature({ id: 'independent', unitType: 'region', sovereignId: '', isRemainder: false, geometry: square() });
  assert.equal(independent.properties.sovereignId, '');
  assert.equal(independent.properties.isRemainder, false);
});

test('dangling sovereigns and circular parents fail without automatic clearing', () => {
  assert.throws(() => normalizeTerritorialUnits([
    createTerritorialFeature({ id: 'a1', unitType: 'subunit', sovereignId: 'gone', parentId: 'a2', geometry: square() }),
    createTerritorialFeature({ id: 'a2', unitType: 'subunit', sovereignId: 'gone', parentId: 'a1', geometry: square() }),
  ], { countryExists: () => false }), /주권 국가 gone|순환/);
});

test('one remainder per partition is enforced and reconciliation is explicit', () => {
  const piece = createTerritorialFeature({ id: 'piece', unitType: 'subunit', parentId: 'PL', sovereignId: 'PL', geometry: square(0, 0, 5, 5) });
  const remainder = createTerritorialFeature({ id: 'remainder', unitType: 'subunit', parentId: 'PL', sovereignId: 'PL', isRemainder: true, geometry: square(5, 0, 10, 10) });
  const duplicate = createTerritorialFeature({ id: 'duplicate', unitType: 'subunit', parentId: 'PL', sovereignId: 'PL', isRemainder: true, geometry: square() });
  assert.equal(validatePartitionRemainders([piece, remainder]).ok, true);
  assert.equal(validatePartitionRemainders([piece, remainder, duplicate]).ok, false);
  assert.throws(() => normalizeTerritorialUnits([piece, remainder, duplicate], { countryExists: id => id === 'PL' }), /중복/);
  const updatedGeometry = square(6, 0, 10, 10);
  const reconciled = reconcilePartitionRemainder({ siblings: [piece, remainder], remainderGeometry: updatedGeometry });
  assert.deepEqual(reconciled.find(item => item.properties.isRemainder).geometry, updatedGeometry);
  assert.notDeepEqual(remainder.geometry, updatedGeometry);
});

test('dated relations resolve by reference date and overlapping ranges are rejected', () => {
  const unit = createTerritorialFeature({ id: 't1', unitType: 'subunit', sovereignId: 'A', parentId: 'A', geometry: square() });
  const relations = normalizeTerritorialRelations([
    { id: 'r1', schemaVersion: 1, unitId: 't1', parentId: 'B', sovereignId: 'B', validFrom: '1900-01-01', validTo: '1910-12-31' },
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
  const country = { type: 'Feature', id: 'PL', properties: { name: '폴란드' }, geometry: square() };
  assert.equal(createCountryTerritorialAdapter(country).properties.sovereignId, 'PL');
  const territory = createTerritorialFeature({ id: 't1', unitType: 'subunit', parentId: 'PL', sovereignId: 'PL', geometry: square() });
  const repository = createTerritorialRepository({ getCountries: () => ({ features: [country] }), getUnits: () => [territory] });
  assert.equal(repository.get('PL').properties.unitType, 'country');
  assert.equal(repository.get('t1').properties.unitType, 'subunit');
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
