import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TERRITORIAL_COVERAGE_MODES,  createTerritorialFeature,
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
  const unit = createTerritorialFeature({ id: 'r1', entityKind: 'general', parentId: 'PL', geometry: square() });
  assert.throws(() => normalizeTerritorialEntities([unit, unit], { getEntity: id => id==='PL'?createTerritorialFeature({id,entityKind: 'general',geometry:square()}):null }), /중복/);
});

test('hierarchy uses parent relations without administrative levels', () => {
  const units = normalizeTerritorialEntities([
    createTerritorialFeature({ id: 't1', entityKind: 'general', parentId: 'PL', geometry: square() }),
    createTerritorialFeature({ id: 'a1', entityKind: 'general', parentId: 't1', adminLevel: 8, geometry: square(0, 0, 5, 5) }),
    createTerritorialFeature({ id: 'a2', entityKind: 'general', parentId: 'a1', adminLevel: 8, geometry: square(0, 0, 2, 2) }),
  ], { getEntity: id => id==='PL'?createTerritorialFeature({id,entityKind: 'general',geometry:square()}):null });
  assert.equal(units.find(item => item.id === 'a1').properties.adminLevel, undefined);
  assert.equal(units.find(item => item.id === 'a2').properties.adminLevel, undefined);
  assert.equal(validateTerritorialRelations(units, { getEntity: id => id==='PL'?createTerritorialFeature({id,entityKind: 'general',geometry:square()}):null }).ok, true);
  assert.throws(() => normalizeTerritorialEntities([
    createTerritorialFeature({ id: 'a3', entityKind: 'general', parentId: 'missing', geometry: square() }),
  ], { getEntity: id => id==='PL'?createTerritorialFeature({id,entityKind: 'general',geometry:square()}):null }), /상위 단위|부모/);
});


test('explicit regions keep independent parent and country association relationships', () => {
  const [region] = normalizeTerritorialEntities([createTerritorialFeature({
    id: 'historical-region', entityKind: 'regional', parentId: '', coverageMode: 'explicit', geometry: square(),
  })]);
  assert.equal(region.properties.entityKind, 'regional');
  assert.equal(region.properties.coverageMode, TERRITORIAL_COVERAGE_MODES.EXPLICIT);
  assert.equal(region.properties.parentId, '');
  assert.equal(region.properties.associatedCountryId, undefined);
});

test('deprecated remainder flags are not stored', () => {
  const [remainder] = normalizeTerritorialEntities([createTerritorialFeature({
    id: 'remainder', entityKind: 'general', parentId: 'PL', isRemainder: true, geometry: square(),
  })], { getEntity: id => id==='PL'?createTerritorialFeature({id,entityKind: 'general',geometry:square()}):null });
  assert.equal(remainder.properties.isRemainder, undefined);
  assert.equal(remainder.properties.associatedCountryId, undefined);
  assert.equal(remainder.properties.parentId, 'PL');
  const independent = createTerritorialFeature({ id: 'independent', entityKind: 'regional', isRemainder: false, geometry: square() });
  assert.equal(independent.properties.associatedCountryId, undefined);
  assert.equal(independent.properties.isRemainder, undefined);
});

test('dangling references and circular parents fail without automatic clearing', () => {
  assert.throws(() => normalizeTerritorialEntities([
    createTerritorialFeature({ id: 'a1', entityKind: 'general', parentId: 'a2', geometry: square() }),
    createTerritorialFeature({ id: 'a2', entityKind: 'general', parentId: 'a1', geometry: square() }),
  ], { getEntity: () => null }), /소속 국가 gone|순환/);
});


test('dated relations resolve by reference date and overlapping ranges are rejected', () => {
  const unit = createTerritorialFeature({ id: 't1', entityKind: 'general', parentId: 'A', geometry: square() });
  const relations = normalizeTerritorialRelations([
    { id: 'r1', schemaVersion: 3, unitId: 't1', parentId: 'B', validFrom: '1900-01-01', validTo: '1910-12-31' },
  ]);
  const invalid = validateTerritorialRelations([unit], {
    getEntity: id=>['A','B'].includes(id)?createTerritorialFeature({id,entityKind: 'general',geometry:square()}):null,
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


test('dated parent cycles are rejected only when the relationship intervals overlap', () => {
  const units = ['A', 'B'].map(id => createTerritorialFeature({ id, entityKind: 'general', geometry: square() }));
  const relation = (unitId, parentId, validFrom, validTo) => ({ id: unitId, schemaVersion: 3, unitId, parentId, validFrom, validTo });
  const first = relation('A', 'B', '1900', '1910');
  assert.equal(validateTerritorialRelations(units, { relations: [first, relation('B', 'A', '1911', '1920')] }).ok, true);
  assert.match(validateTerritorialRelations(units, { relations: [first, relation('B', 'A', '1910', '1920')] }).issues.join(' '), /순환/);
});
