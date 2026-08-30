import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertProjectReferenceIntegrity,
  validateProjectReferenceIntegrity,
} from '../../assets/js/modules/project-invariants.js';

const polygon = () => ({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 1], [0, 0]]] });
const country = id => ({ type: 'Feature', properties: { editor_id: id }, geometry: polygon() });
const unit = (id, parentId = '', sovereignId = 'A') => ({
  type: 'Feature', id,
  properties: { parentId, sovereignId },
  geometry: polygon(),
});

test('valid project references pass', () => {
  const result = validateProjectReferenceIntegrity({
    countries: [country('A')],
    territorialUnits: [unit('R', 'A')],
    distributionLayers: [{ id: 'L', type: 'language', parentId: '' }],
    distributionEntries: [{ id: 'E', layerId: 'L', mode: 'territorial', territorialUnitId: 'R', share: 100 }],
  });
  assert.equal(result.ok, true);
});

test('dangling references are reported instead of silently ignored', () => {
  const result = validateProjectReferenceIntegrity({
    countries: [country('A')],
    territorialUnits: [unit('R', 'MISSING', 'A')],
    distributionLayers: [{ id: 'L', type: 'language', parentId: '' }],
    distributionEntries: [{ id: 'E', layerId: 'L', mode: 'territorial', territorialUnitId: 'NOPE', share: 100 }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(row => row.code === 'PL-INV-MISSING-PARENT'));
  assert.ok(result.issues.some(row => row.code === 'PL-INV-MISSING-DIST-TERRITORIAL'));
  assert.throws(() => assertProjectReferenceIntegrity({
    countries: [country('A')],
    territorialUnits: [unit('R', 'MISSING', 'A')],
  }), /상위 영역/);
});

test('territorial and distribution parent cycles are rejected', () => {
  const result = validateProjectReferenceIntegrity({
    countries: [country('A')],
    territorialUnits: [unit('R1', 'R2'), unit('R2', 'R1')],
    distributionLayers: [
      { id: 'L1', type: 'language', parentId: 'L2' },
      { id: 'L2', type: 'language', parentId: 'L1' },
    ],
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(row => row.code === 'PL-INV-PARENT-CYCLE'));
  assert.ok(result.issues.some(row => row.code === 'PL-INV-DIST-PARENT-CYCLE'));
});

test('invalid distribution share and free geometry are rejected', () => {
  const result = validateProjectReferenceIntegrity({
    countries: [country('A')],
    distributionLayers: [{ id: 'L', type: 'language', parentId: '' }],
    distributionEntries: [
      { id: 'E1', layerId: 'L', mode: 'geometry', geometry: null, share: 145 },
    ],
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(row => row.code === 'PL-INV-DIST-SHARE'));
  assert.ok(result.issues.some(row => row.code === 'PL-INV-DIST-GEOMETRY'));
});
