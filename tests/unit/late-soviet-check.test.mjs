import assert from 'node:assert/strict';
import test from 'node:test';
import { selectLateSovietCheckPartition } from '../../scripts/lib/late-soviet-check.mjs';
import { selectGeometryVersion, territorialEntityExistsAt } from '../../tools/gis/territorial-library.js';
import { validateGeometry } from "../../src/geometry/geometry-validation.js";

function version(versionId, validFrom, validTo) {
  return { versionId, validFrom, validTo, geometry: {
    type: 'Polygon', coordinates: [[[0, 0], [2, 0], [0, 2], [0, 0]]],
  } };
}

// Metadata from the paired 5eb7be55 catalog. Shapes are synthetic: this fixture
// proves version selection and date coverage, not the real polygon partition.
const republicPeriods = [
  ['armenian-ssr', '1936-12-05', '1991-09-22'],
  ['azerbaijan-ssr', '1936-12-05', '1991-10-17'],
  ['byelorussian-ssr', '1922-12-30', '1991-08-24'],
  ['estonian-ssr', '1940-08-06', '1991-08-19'],
  ['georgian-ssr', '1936-12-05', '1991-04-08'],
  ['kazakh-ssr', '1936-12-05', '1991-12-15'],
  ['kirghiz-ssr', '1936-12-05', '1991-08-30'],
  ['lithuanian-ssr', '1940-08-03', '1990-03-10'],
  ['latvian-ssr', '1940-08-05', '1991-08-20'],
  ['moldavian-ssr', '1940-08-02', '1991-08-26'],
  ['russian-sfsr', '1922-12-30', '1991-12-24'],
  ['tajik-ssr', '1929-12-05', '1991-09-08'],
  ['turkmen-ssr', '1925-05-13', '1991-10-26'],
  ['ukrainian-ssr', '1922-12-30', '1991-08-23'],
  ['uzbek-ssr', '1925-05-13', '1991-08-30'],
];
const parentVersionId = 'state:soviet-union:1922-1991-baikonur-r1-after-reviewed-day';
function fixtures() {
  const parent = { entityId: 'state:soviet-union', lifetime: { validFrom: '1922-12-30', validTo: '1991' },
    geometryVersions: [version('parent:early', '1922-12-30', '1929-12-31'), version(parentVersionId, '1930-01-01', '1991')] };
  const republics = republicPeriods.map(([suffix, validFrom, validTo]) => {
    const entityId = 'state:soviet-union-' + suffix;
    return { entityId, parentEntityId: parent.entityId, lifetime: { validFrom, validTo },
      geometryVersions: [version(entityId + ':1991-r1', suffix === 'lithuanian-ssr' ? '1990' : '1991-01-01', validTo)] };
  });
  const child = republics.find(entity => entity.entityId === 'state:soviet-union-russian-sfsr');
  child.geometryVersions.unshift(version(child.entityId + ':1922-12-30-reviewed-v2', '1922-12-30', '1925-05-12'));
  const predecessor = { entityId: 'state:soviet-union-transcaucasian-sfsr', parentEntityId: parent.entityId,
    lifetime: { validFrom: '1922-12-30', validTo: '1936-12-04' },
    geometryVersions: [version('predecessor:early', '1922-12-30', '1925-05-12')] };
  return { parent, child, republics, entities: [parent, ...republics, predecessor] };
}

test('fixed Soviet partition selects all fifteen explicit geometry versions despite earlier periods and shuffled arrays', () => {
  for (const reverseParent of [false, true]) for (const reverseChild of [false, true]) for (const reverseEntities of [false, true]) {
    const { parent, child, republics, entities } = fixtures();
    if (reverseParent) parent.geometryVersions.reverse();
    if (reverseChild) child.geometryVersions.reverse();
    if (reverseEntities) entities.reverse();
    const partition = selectLateSovietCheckPartition(entities);
    assert.equal(partition.parent, parent);
    assert.equal(partition.parentVersion.versionId, parentVersionId);
    assert.deepEqual(partition.children.map(row => [row.entity.entityId, row.version.versionId]),
      republics.map(entity => [entity.entityId, entity.entityId + ':1991-r1']));
  }
});

test('missing fixed parent, republic or version cannot fall back to another historical geometry', () => {
  for (const remove of [
    fixture => { fixture.entities.splice(fixture.entities.indexOf(fixture.parent), 1); },
    fixture => { fixture.parent.geometryVersions.pop(); },
    fixture => { fixture.entities.splice(fixture.entities.indexOf(fixture.child), 1); },
    fixture => { fixture.child.geometryVersions.pop(); },
  ]) {
    const fixture = fixtures();
    remove(fixture);
    assert.throws(() => selectLateSovietCheckPartition(fixture.entities), /Missing fixed Soviet partition (entity|geometry version):/);
  }
});

test('paired source periods have no simultaneous fifteen-republic date snapshot', () => {
  const { parent, republics, entities } = fixtures();
  assert.ok(selectGeometryVersion(parent, '1989-12-31'));
  for (const [date, expectedActive, expectedGeometries] of [
    ['1989-12-31', 15, 0], ['1990-01-01', 15, 1], ['1991-01-01', 14, 14],
  ]) {
    assert.equal(republics.filter(entity => territorialEntityExistsAt(entity, date)).length, expectedActive, date);
    assert.equal(republics.filter(entity => selectGeometryVersion(entity, date)).length, expectedGeometries, date);
  }
  const before = structuredClone(entities);
  assert.equal(selectLateSovietCheckPartition(entities).children.length, 15);
  assert.deepEqual(entities, before, 'Selecting a fixed partition must not extend source validity periods');
});

test('selected geometry remains unchanged and canonical validation still rejects duplicate vertices', () => {
  const { parent, entities } = fixtures();
  const late = parent.geometryVersions[1];
  late.geometry.coordinates[0].splice(2, 0, [...late.geometry.coordinates[0][1]]);
  const before = structuredClone(late.geometry);
  const partition = selectLateSovietCheckPartition(entities);
  assert.equal(partition.parentVersion.geometry, late.geometry);
  assert.deepEqual(partition.parentVersion.geometry, before);
  const issues = validateGeometry({ type: 'Feature', id: parent.entityId, geometry: partition.parentVersion.geometry });
  assert.ok(issues.some(issue => issue.kind === 'duplicate-vertex'));
});
