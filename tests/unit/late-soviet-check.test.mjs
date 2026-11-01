import assert from 'node:assert/strict';
import test from 'node:test';
import { LATE_SOVIET_CHECK_DATE, selectLateSovietCheckSnapshot } from '../../scripts/lib/late-soviet-check.mjs';
import { validateGeometry } from '../../shared/frontend/js/modules/geometry-validation.js';

function version(versionId, validFrom, validTo) {
  return { versionId, validFrom, validTo, geometry: {
    type: 'Polygon', coordinates: [[[0, 0], [2, 0], [0, 2], [0, 0]]],
  } };
}

function fixtures() {
  const parent = { entityId: 'state:soviet-union', lifetime: { validFrom: '1922-12-30', validTo: '1991' },
    geometryVersions: [version('parent:early', '1922-12-30', '1929-12-31'), version('parent:late', '1930', '1991')] };
  const child = { entityId: 'state:republic', parentEntityId: parent.entityId, lifetime: { validFrom: '1922-12-30', validTo: '1991' },
    geometryVersions: [version('child:early', '1922-12-30', '1929-12-31'), version('child:late', '1930', '1991')] };
  const predecessor = { entityId: 'state:predecessor', parentEntityId: parent.entityId,
    lifetime: { validFrom: '1922-12-30', validTo: '1936-12-04' },
    geometryVersions: [version('predecessor:early', '1922-12-30', '1936-12-04')] };
  const successor = { entityId: 'state:successor', parentEntityId: parent.entityId,
    lifetime: { validFrom: '1991', validTo: null }, geometryVersions: [version('successor:late', '1991', null)] };
  return { parent, child, entities: [parent, child, predecessor, successor] };
}

test('late Soviet checks select one shared date despite early versions and shuffled entity/version order', () => {
  assert.equal(LATE_SOVIET_CHECK_DATE, '1989-12-31');
  for (const reverseParent of [false, true]) for (const reverseChild of [false, true]) for (const reverseEntities of [false, true]) {
    const { parent, child, entities } = fixtures();
    if (reverseParent) parent.geometryVersions.reverse();
    if (reverseChild) child.geometryVersions.reverse();
    if (reverseEntities) entities.reverse();
    const snapshot = selectLateSovietCheckSnapshot(entities);
    assert.equal(snapshot.parent, parent);
    assert.equal(snapshot.parentVersion.versionId, 'parent:late');
    assert.deepEqual(snapshot.children.map(row => [row.entity.entityId, row.version.versionId]), [['state:republic', 'child:late']]);
  }
});

test('missing geometry at the contract date cannot fall back to an earlier parent or child version', () => {
  const { parent, child, entities } = fixtures();
  parent.geometryVersions.pop();
  child.geometryVersions.pop();
  const snapshot = selectLateSovietCheckSnapshot(entities);
  assert.equal(snapshot.parentVersion, null);
  assert.equal(snapshot.children.length, 1);
  assert.equal(snapshot.children[0].version, null);
});

test('selected geometry remains unchanged and canonical validation still rejects duplicate vertices', () => {
  const { parent, entities } = fixtures();
  const late = parent.geometryVersions[1];
  late.geometry.coordinates[0].splice(2, 0, [...late.geometry.coordinates[0][1]]);
  const before = structuredClone(late.geometry);
  const snapshot = selectLateSovietCheckSnapshot(entities);
  assert.equal(snapshot.parentVersion.geometry, late.geometry);
  assert.deepEqual(snapshot.parentVersion.geometry, before);
  const issues = validateGeometry({ type: 'Feature', id: parent.entityId, geometry: snapshot.parentVersion.geometry });
  assert.ok(issues.some(issue => issue.kind === 'duplicate-vertex'));
});
