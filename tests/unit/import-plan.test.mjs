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
  assert.equal(country.openMode, 'merge');
  assert.equal(country.mergePolicy, 'same-id-multipolygon');
  assert.deepEqual(country.propertyMapping, {
    id: 'iso_a3', name: 'name', country: '', parent: '', level: '', color: '',
  });
});

test('dependent object imports are constrained to the current project', () => {
  const region = normalizeImportPlan({ targetType: 'region', openMode: 'replace' });

  assert.equal(region.openMode, 'merge');
  assert.equal(targetRequiresExistingProject(region.targetType), true);
  assert.equal(targetRequiresExistingProject('country'), false);
  assert.equal(targetRequiresExistingProject('project'), false);
});
