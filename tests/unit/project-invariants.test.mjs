import { createTerritorialFeature } from '../../assets/js/modules/territorial-units.js';
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertProjectReferenceIntegrity,
  validateProjectReferenceIntegrity,
} from '../../assets/js/modules/project-invariants.js';

const polygon = () => ({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 1], [0, 0]]] });
const country = id => createTerritorialFeature({id,unitType:'country',name:id,geometry:polygon()});
const unit=(id,parentId='',countryId='A')=>createTerritorialFeature({id,unitType:'region',parentId,associatedCountryId:countryId,geometry:polygon()});

test('valid project references pass', () => {
  const result = validateProjectReferenceIntegrity({
    territorialEntities: [...[country('A')],...[unit('R', 'A')]],
    distributionLayers: [{ id: 'L', parentId: '' }],
    distributionEntries: [{ id: 'E', layerId: 'L', mode: 'territorial', territorialUnitId: 'R', value: 100 }],
  });
  assert.equal(result.ok, true);
});

test('dangling references are reported instead of silently ignored', () => {
  const result = validateProjectReferenceIntegrity({
    territorialEntities: [...[country('A')],...[unit('R', 'MISSING', 'A')]],
    distributionLayers: [{ id: 'L', parentId: '' }],
    distributionEntries: [{ id: 'E', layerId: 'L', mode: 'territorial', territorialUnitId: 'NOPE', value: 100 }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(row => row.code === 'PL-INV-MISSING-PARENT'));
  assert.ok(result.issues.some(row => row.code === 'PL-INV-MISSING-DIST-TERRITORIAL'));
  assert.throws(() => assertProjectReferenceIntegrity({
    territorialEntities: [...[country('A')],...[unit('R', 'MISSING', 'A')]],
  }), /상위 단위/);
});

test('territorial and distribution parent cycles are rejected', () => {
  const result = validateProjectReferenceIntegrity({
    territorialEntities: [...[country('A')],...[unit('R1', 'R2'), unit('R2', 'R1')]],
    distributionLayers: [
      { id: 'L1', parentId: 'L2' },
      { id: 'L2', parentId: 'L1' },
    ],
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(row => row.code === 'PL-INV-PARENT-CYCLE'));
  assert.ok(result.issues.some(row => row.code === 'PL-INV-DIST-PARENT-CYCLE'));
});

test('invalid distribution value and free geometry are rejected', () => {
  const result = validateProjectReferenceIntegrity({
    territorialEntities: [country('A')],
    distributionLayers: [{ id: 'L', parentId: '' }],
    distributionEntries: [
      { id: 'E1', layerId: 'L', mode: 'geometry', geometry: null, value: Number.NaN },
    ],
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(row => row.code === 'PL-INV-DIST-VALUE'));
  assert.ok(result.issues.some(row => row.code === 'PL-INV-DIST-GEOMETRY'));
});
