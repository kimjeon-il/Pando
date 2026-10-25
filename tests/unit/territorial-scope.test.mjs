import { executeTerritorialTestCommand, testCoreProject, initializeTestTerritorialState } from '../helpers/timeline-project.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import "../../shared/frontend/js/vendor/polygon-clipping.min.js";
import { createTerritorialEntityStore } from "../../shared/frontend/js/modules/territorial-entity-store.js";
import { createTerritorialEntityRepository } from "../../shared/frontend/js/modules/territorial-entity-repository.js";
import { createTerritorialScopeResolver } from "../../shared/frontend/js/modules/territorial-scope.js";
import { createTerritorialFeature } from "../../shared/frontend/js/modules/territorial-units.js";
import { hasCanonicalPolygonWinding, area } from "../../shared/frontend/js/modules/map-edit-geometry.js";
import { touchGeometry } from "../../shared/frontend/js/modules/geometry-versions.js";
import '../../tools/load-spherical-core.mjs';
const square = (x0, x1) => ({ type: 'Polygon', coordinates: [[[x0,0],[x0,2],[x1,2],[x1,0],[x0,0]]] });

test('every general hierarchy level has an immutable canonical display extent; independent regions retain their own shape', async () => {
  const make = (id, parentId, x0, x1, entityKind = 'general') => createTerritorialFeature({ id, entityKind, parentId, geometry: square(x0,x1) });
  const state = { territorialEntities: [make('A','',0,2),make('B','A',1,3),make('C','B',2,4),make('D','',5,7),make('R','',0,10,'regional')] };
  await initializeTestTerritorialState(state);
const store = createTerritorialEntityStore({ documentModel:testCoreProject(state).documentModel,commandOwner:testCoreProject(state).client });
  const repo = createTerritorialEntityRepository({ entityStore: store });
  const scope = createTerritorialScopeResolver({ entityRepository: repo, getState: () => state, clipper: () => globalThis.polygonClipping });
  const before = structuredClone(state.territorialEntities);
  const first = scope.scope('A');
  assert.strictEqual(scope.scope('A'), first);
  assert.deepEqual(first.members.map(entity=>entity.id), ['B','C']);
  assert.equal(first.extent.id, 'A');
  assert.equal(area(first.extent.geometry), 8);
  assert.equal(area(scope.scope('B').extent.geometry), 6);
  assert.equal(area(scope.scope('B').extra.geometry), 2);
  assert.equal(hasCanonicalPolygonWinding(first.extent.geometry), true);
  const region = scope.scope('R');
  assert.strictEqual(region.extent, repo.get('R'));
  assert.deepEqual(region.members, []);
  assert.deepEqual(state.territorialEntities, before);
  await executeTerritorialTestCommand(state,'territorial.patch',{ features: [{ ...repo.get('B'), properties: { ...repo.get('B').properties, parentId: 'D' } }] });
  assert.equal(area(scope.scope('A').extent.geometry), 4);
  assert.notStrictEqual(scope.scope('A'), first);
  assert.equal(repo.root('C').id, 'D');
  assert.equal(area(scope.scope('D').extent.geometry), 10);
  assert.deepEqual(scope.scope('R').extent.geometry, region.extent.geometry);
});

test('month and style metadata reuse prepared extent; geometry edits invalidate it', () => {
  let rows = [createTerritorialFeature({ id: 'A', entityKind: 'general', geometry: square(0, 2) }),
    createTerritorialFeature({ id: 'B', entityKind: 'general', parentId: 'A', geometry: square(1, 3) })];
  const repository = { list: () => rows, get: id => rows.find(row => row.id === id), descendants: id => rows.filter(row => row.properties.parentId === id) };
  let unions = 0;
  const scope = createTerritorialScopeResolver({ entityRepository: repository, clipper: () => ({
    union: (...args) => { unions++; return globalThis.polygonClipping.union(...args); },
    difference: globalThis.polygonClipping.difference,
  }) });
  const first = scope.scope('A');
  rows = rows.map(row => ({ ...row, properties: { ...row.properties, color: '#ff0000', name: 'new month' } }));
  const next = scope.scope('A');
  assert.strictEqual(next.extent.geometry, first.extent.geometry);
  assert.strictEqual(next.extra.geometry, first.extra.geometry);
  assert.strictEqual(next.entity, rows[0]);
  assert.equal(unions, 1);
  rows[1].geometry.coordinates[0][2][0] = 4;
  touchGeometry(rows[1].geometry);
  assert.notStrictEqual(scope.scope('A').extent.geometry, first.extent.geometry);
  assert.equal(unions, 2);
});
