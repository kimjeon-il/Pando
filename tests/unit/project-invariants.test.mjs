import { createTerritorialFeature } from "../../shared/frontend/js/modules/territorial-units.js";
import assert from 'node:assert/strict';
import test from 'node:test';
import { sharedCalculationCore } from "../../shared/frontend/js/modules/temporal.js";

import {
  assertProjectReferenceIntegrity,
  validateProjectReferenceIntegrity,
} from "../../shared/frontend/js/modules/project-invariants.js";

const polygon = () => ({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 1], [0, 0]]] });
const country = id => createTerritorialFeature({id,entityKind:'general',name:id,geometry:polygon()});
const unit=(id,parentId='')=>createTerritorialFeature({id,entityKind:'general',parentId,geometry:polygon()});

test('shared reference graph reports duplicate IDs, missing parents and cycles in input order', () => {
  const core = sharedCalculationCore;
  assert.deepEqual(core.referenceGraphDiagnostics(['A', 'B', 'C'], ['B', 'A', 'missing']), [
    { idStatus: 'ok', cycle: true, missing: false },
    { idStatus: 'ok', cycle: true, missing: false },
    { idStatus: 'ok', cycle: false, missing: true },
  ]);
  assert.deepEqual(core.referenceGraphDiagnostics(['A', 'A', '', ''], ['', '', '', '']).map(row => row.idStatus),
    ['ok', 'duplicate', 'empty', 'empty']);
});

test('shared distribution reference diagnostics preserve invalid fields independently', () => {
  const rows = sharedCalculationCore.distributionReferenceDiagnostics(
    ['L'], ['A'],
    ['L', 'missing', 'L', 'L'], ['territorial', 'territorial', 'bad', 'geometry'],
    ['A', 'missing', '', ''], [1, 0, Infinity, '1'],
  );
  assert.deepEqual(rows, [
    { missingLayer: false, invalidMode: false, invalidValue: false, missingTerritory: false },
    { missingLayer: true, invalidMode: false, invalidValue: false, missingTerritory: true },
    { missingLayer: false, invalidMode: true, invalidValue: true, missingTerritory: false },
    { missingLayer: false, invalidMode: false, invalidValue: true, missingTerritory: false },
  ]);
});

test('shared territorial root distinguishes missing, cyclic and regional parents', () => {
  const rows=new Map([
    ['A', {id:'A',properties:{entityKind:'general',parentId:''}}],
    ['B', {id:'B',properties:{entityKind:'general',parentId:'A'}}],
  ]);
  const resolve = row => sharedCalculationCore.resolveTerritorialRoot(row, id => rows.get(id) || null);
  assert.deepEqual(resolve(rows.get('B')), { status:'valid', rootId:'A' });
  assert.deepEqual(resolve({id:'C',properties:{entityKind:'general',parentId:'missing'}}), { status:'invalid-parent', rootId:'' });
  assert.deepEqual(resolve({id:'C',properties:{entityKind:'general',parentId:'C'}}), { status:'cycle', rootId:'' });
  assert.deepEqual(resolve({id:'R',properties:{entityKind:'regional',parentId:'A'}}), { status:'regional-parent', rootId:'' });
  const unusual='지도\ud800';
  rows.set(unusual,{id:unusual,properties:{entityKind:'general',parentId:''}});
  assert.deepEqual(resolve({id:'child',properties:{entityKind:'general',parentId:unusual}}), { status:'valid',rootId:unusual });
  const longId='가'.repeat(9000);
  rows.set(longId,{id:longId,properties:{entityKind:'general',parentId:''}});
  assert.deepEqual(resolve({id:'long-child',properties:{entityKind:'general',parentId:longId}}), { status:'valid',rootId:longId });
});

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
    territorialEntities: [...[country('A')],...[unit('R', 'MISSING')]],
    distributionLayers: [{ id: 'L', parentId: '' }],
    distributionEntries: [{ id: 'E', layerId: 'L', mode: 'territorial', territorialUnitId: 'NOPE', value: 100 }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(row => row.code === 'PL-INV-MISSING-PARENT'));
  assert.ok(result.issues.some(row => row.code === 'PL-INV-MISSING-DIST-TERRITORIAL'));
  assert.throws(() => assertProjectReferenceIntegrity({
    territorialEntities: [...[country('A')],...[unit('R', 'MISSING', 'A')]],
  }), /부모/);
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
