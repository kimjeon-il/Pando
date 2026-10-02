import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TERRITORIAL_COVERAGE_MODES,
  TERRITORIAL_UNIT_TYPES,
  changeUnitType,
  createCountryTerritorialEntity,
  createTerritorialFeature,
  createTerritorialEntityRepository,
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

test('territorial normalization rejects legacy aliases and duplicate IDs', () => {
  assert.throws(() => normalizeTerritorialUnits([{
    type: 'Feature', id: 'r1', properties: { kind: 'region', countryId: 'PL' }, geometry: square(),
  }]), /영역 형식/);
  const unit = createTerritorialFeature({ id: 'r1', unitType: 'subunit', sovereignId: 'PL', parentId: 'PL', geometry: square() });
  assert.throws(() => normalizeTerritorialUnits([unit, unit], { countryExists: id => id === 'PL' }), /중복/);
});

test('hierarchy uses parent relations without administrative levels', () => {
  const units = normalizeTerritorialUnits([
    createTerritorialFeature({ id: 't1', unitType: 'subunit', sovereignId: 'PL', parentId: 'PL', geometry: square() }),
    createTerritorialFeature({ id: 'a1', unitType: 'subunit', sovereignId: 'PL', parentId: 't1', adminLevel: 8, geometry: square(0, 0, 5, 5) }),
    createTerritorialFeature({ id: 'a2', unitType: 'subunit', sovereignId: 'PL', parentId: 'a1', adminLevel: 8, geometry: square(0, 0, 2, 2) }),
  ], { countryExists: id => id === 'PL' });
  assert.equal(units.find(item => item.id === 'a1').properties.adminLevel, undefined);
  assert.equal(units.find(item => item.id === 'a2').properties.adminLevel, undefined);
  assert.equal(validateTerritorialRelations(units, { countryExists: id => id === 'PL' }).ok, true);
  assert.throws(() => normalizeTerritorialUnits([
    createTerritorialFeature({ id: 'a3', unitType: 'subunit', sovereignId: 'PL', parentId: 'missing', geometry: square() }),
  ], { countryExists: id => id === 'PL' }), /상위 단위|같은 소속 국가/);
});

test('subunit and region type changes preserve identity and geometry', () => {
  const territory = createTerritorialFeature({
    id: 'ireland', unitType: 'subunit', name: '아일랜드', sovereignId: 'GBR', parentId: 'GBR', color: '#169b62', geometry: square(),
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

test('explicit regions keep independent parent and sovereignty relationships', () => {
  const [region] = normalizeTerritorialUnits([createTerritorialFeature({
    id: 'historical-region', unitType: 'region', parentId: '', sovereignId: '', coverageMode: 'explicit', geometry: square(),
  })]);
  assert.equal(region.properties.unitType, TERRITORIAL_UNIT_TYPES.REGION);
  assert.equal(region.properties.coverageMode, TERRITORIAL_COVERAGE_MODES.EXPLICIT);
  assert.equal(region.properties.parentId, '');
  assert.equal(region.properties.sovereignId, '');
});

test('deprecated remainder flags are not stored', () => {
  const [remainder] = normalizeTerritorialUnits([createTerritorialFeature({
    id: 'remainder', unitType: 'subunit', parentId: 'PL', sovereignId: 'PL', isRemainder: true, geometry: square(),
  })], { countryExists: id => id === 'PL' });
  assert.equal(remainder.properties.isRemainder, undefined);
  assert.equal(remainder.properties.sovereignId, 'PL');
  assert.equal(remainder.properties.parentId, 'PL');
  const independent = createTerritorialFeature({ id: 'independent', unitType: 'region', sovereignId: '', isRemainder: false, geometry: square() });
  assert.equal(independent.properties.sovereignId, '');
  assert.equal(independent.properties.isRemainder, undefined);
});

test('dangling sovereigns and circular parents fail without automatic clearing', () => {
  assert.throws(() => normalizeTerritorialUnits([
    createTerritorialFeature({ id: 'a1', unitType: 'subunit', sovereignId: 'gone', parentId: 'a2', geometry: square() }),
    createTerritorialFeature({ id: 'a2', unitType: 'subunit', sovereignId: 'gone', parentId: 'a1', geometry: square() }),
  ], { countryExists: () => false }), /소속 국가 gone|순환/);
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

test('territorial entity repository exposes countries and nested units through one hierarchy surface', () => {
  const country = { type: 'Feature', id: 'PL', properties: { name: '폴란드' }, geometry: square() };
  const adapted = createCountryTerritorialEntity(country, { name: '폴란드 공화국', notes: '국가 메모', locked: true, color: '#123456' });
  assert.equal(adapted.properties.sovereignId, 'PL');
  assert.equal(adapted.properties.parentId, '');
  assert.equal(adapted.properties.name, '폴란드 공화국');
  assert.equal(adapted.properties.notes, '국가 메모');
  assert.equal(adapted.properties.locked, true);
  assert.deepEqual(adapted.properties.style, { color: '#123456' });

  const territory = createTerritorialFeature({ id: 't1', unitType: 'subunit', parentId: 'PL', sovereignId: 'PL', geometry: square() });
  const child = createTerritorialFeature({ id: 't2', unitType: 'subunit', parentId: 't1', sovereignId: 'PL', geometry: square(0, 0, 5, 5) });
  const repository = createTerritorialEntityRepository({
    getCountries: () => ({ features: [country] }),
    getUnits: () => [territory, child],
    getCountryOverride: () => ({ name: '폴란드 공화국', notes: '국가 메모', locked: true }),
  });

  assert.equal(repository.get('PL').properties.unitType, 'country');
  assert.equal(repository.get('t1').properties.unitType, 'subunit');
  assert.equal(repository.has('missing'), false);
  assert.deepEqual(repository.children('PL').map(item => item.id), ['t1']);
  assert.equal(repository.parent('t1').id, 'PL');
  assert.deepEqual(repository.ancestors('t2').map(item => item.id), ['t1', 'PL']);
  assert.deepEqual(repository.descendants('PL').map(item => item.id), ['t1', 't2']);
  assert.equal(repository.root('t2').id, 'PL');
  assert.equal(repository.sovereign('t2').id, 'PL');
  assert.deepEqual(repository.list({ type: 'subunit', parentId: 't1' }).map(item => item.id), ['t2']);
});

test('territorial entity repository rejects duplicate identity across country and unit storage', () => {
  const country = { type: 'Feature', id: 'same-id', properties: { name: '국가' }, geometry: square() };
  const unit = createTerritorialFeature({ id: 'same-id', unitType: 'subunit', parentId: 'country-a', sovereignId: 'country-a', geometry: square() });
  const repository = createTerritorialEntityRepository({
    getCountries: () => ({ features: [country] }),
    getUnits: () => [unit],
  });
  assert.throws(() => repository.list(), /ID가 중복/);
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
