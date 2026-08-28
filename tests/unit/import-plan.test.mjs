import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeImportPlan, targetRequiresExistingProject } from '../../assets/js/modules/import-plan.js';

test('country import plans normalize formats, mappings, and merge policy', () => {
  const country = normalizeImportPlan({
    sourceFormat: 'GPKG',
    targetType: 'country',
    openMode: 'merge',
    featureCount: 3,
    layerCandidates: [{ name: 'countries', geometryType: 'MultiPolygon', featureCount: 3 }],
    propertyMapping: { id: 'iso_a3', name: 'name' },
  });

  assert.equal(country.sourceFormat, 'gpkg');
  assert.equal(country.sourceKind, 'vector');
  assert.equal(country.openMode, 'merge');
  assert.equal(country.mergePolicy, 'same-id-multipolygon');
  assert.deepEqual(country.propertyMapping, {
    id: 'iso_a3', name: 'name', country: '', parent: '', level: '', color: '',
  });
});

test('dependent object imports are constrained to the current project', () => {
  const region = normalizeImportPlan({
    targetType: 'region', openMode: 'replace', targetCountryId: 'DEU',
    useFeatureCountryField: true, propertyMapping: { country: 'sovereign_id' },
  });

  assert.equal(region.openMode, 'merge');
  assert.equal(region.targetCountryId, 'DEU');
  assert.equal(region.fallbackCountryId, 'DEU');
  assert.equal(region.useFeatureCountryField, true);
  assert.equal(region.landPolicy, 'transfer-to-owner');
  assert.equal(targetRequiresExistingProject(region.targetType), true);
  assert.equal(targetRequiresExistingProject('country'), false);
  assert.equal(targetRequiresExistingProject('project'), false);
});

test('real project markers classify the import plan without changing vector-only metadata behavior', () => {
  const project = normalizeImportPlan({ sourceKind: 'project', targetType: 'project', openMode: 'merge' });
  const attributedVector = normalizeImportPlan({ sourceKind: 'vector', targetType: 'country', sourceFormat: 'geojson' });

  assert.equal(project.sourceKind, 'project');
  assert.equal(project.openMode, 'replace');
  assert.equal(attributedVector.sourceKind, 'vector');
});
