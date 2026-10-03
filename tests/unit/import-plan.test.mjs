import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeImportPlan, targetRequiresExistingProject } from '../../assets/js/modules/import-plan.js';
test('current entity import keeps the actual field mapping and an optional parent', () => {
  const plan = normalizeImportPlan({ sourceFormat: 'GPKG', targetType: 'general', parentId: 'A', openMode: 'replace', featureCount: 3,
    layerCandidates: [{ name: 'entities', geometryType: 'MultiPolygon', featureCount: 3 }], propertyMapping: { id: 'id', name: 'name', parent: 'parent_id' } });
  assert.equal(plan.sourceFormat, 'gpkg'); assert.equal(plan.openMode, 'merge'); assert.equal(plan.mergePolicy, 'preserve-features'); assert.equal(plan.parentId, 'A');
  assert.deepEqual(plan.propertyMapping, { id: 'id', name: 'name', parent: 'parent_id', level: '', color: '', value: '' });
});
test('independent region import has no parent or ownership settings', () => {
  const plan = normalizeImportPlan({ targetType: 'regional', parentId: 'A' });
  assert.equal(plan.parentId, ''); assert.equal(plan.targetType, 'regional'); assert.equal(plan.openMode, 'merge');
  assert.equal(Object.hasOwn(plan, 'targetCountryId'), false); assert.equal(Object.hasOwn(plan, 'landPolicy'), false);
  assert.equal(targetRequiresExistingProject('regional'), true);
});
test('only current project markers replace the project and retired target types fail', () => {
  assert.equal(normalizeImportPlan({ sourceKind: 'project', targetType: 'project', openMode: 'merge' }).openMode, 'replace');
  assert.equal(targetRequiresExistingProject('project'), false);
  for (const targetType of ['country', 'subunit', 'region', 'territory']) assert.throws(() => normalizeImportPlan({ targetType }), /종류/);
});
