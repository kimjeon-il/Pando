import { executeTerritorialTestCommand, testCoreProject, initializeTestTerritorialState } from '../helpers/timeline-project.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerritorialFeature } from "../../shared/frontend/js/modules/territorial-units.js";
import { createTerritorialEntityStore } from "../../shared/frontend/js/modules/territorial-entity-store.js";
import { createTerritorialEntityRepository } from "../../shared/frontend/js/modules/territorial-entity-repository.js";
import { createTerritorialScopeResolver } from "../../shared/frontend/js/modules/territorial-scope.js";

const square = size => ({ type: 'Polygon', coordinates: [[[0,0],[0,size],[size,size],[size,0],[0,0]]] });
test('all entity IDs use the same stable phase-specific display projection, never the editable geometry', async () => {
  const entities = [
    createTerritorialFeature({ id: 'A', entityKind: 'general', geometry: square(10) }),
    createTerritorialFeature({ id: 'B', entityKind: 'general', parentId: 'A', geometry: square(3) }),
    createTerritorialFeature({ id: 'R', entityKind: 'regional', geometry: square(8) }),
  ];
  const before = structuredClone(entities);
  const previews = entities.map(entity => ({ ...entity, geometry: square(1) }));
  const state = { territorialEntities: entities, countryVisualPhase: 'preview',
    auditPreviewCountries: { features: [previews[0]] }, auditPreviewTerritorialUnits: previews.slice(1) };
  await initializeTestTerritorialState(state);
  const store = createTerritorialEntityStore({ documentModel:testCoreProject(state).documentModel,commandOwner:testCoreProject(state).client });
  const entityRepository = createTerritorialEntityRepository({ entityStore: store });
  const display = createTerritorialScopeResolver({ entityRepository, getState: () => state, clipper: () => null });
  const first = display.displayEntities();
  assert.strictEqual(display.displayEntities(), first);
  for (const entity of entities) {
    assert.strictEqual(display.displayFeature(entity.id), first.find(item => item.id === entity.id));
    assert.deepEqual(display.displayFeature(entity).geometry, square(1));
    assert.notStrictEqual(display.displayFeature(entity).geometry, entity.geometry);
  }
  state.countryVisualPhase = 'canonical';
  assert.notStrictEqual(display.displayEntities(), first);
  for (const entity of entities) assert.strictEqual(display.displayFeature(entity.id), entityRepository.get(entity.id));
  await executeTerritorialTestCommand(state,'territorial.remove',{ ids:['B'] });
  assert.equal(display.displayFeature('B'), null);
  assert.deepEqual(entities, before);
});

test('a preview receives current hierarchy and style, not cached project properties', async () => {
  const A = createTerritorialFeature({ id: 'A', entityKind: 'general', geometry: square(10) });
  const B = createTerritorialFeature({ id: 'B', entityKind: 'general', parentId: 'A', geometry: square(3) });
  const state = { territorialEntities: [A, B], countryVisualPhase: 'preview',
    auditPreviewCountries: { features: [] }, auditPreviewTerritorialUnits: [{ ...B, geometry: square(1) }] };
  await initializeTestTerritorialState(state);
const store = createTerritorialEntityStore({ documentModel:testCoreProject(state).documentModel,commandOwner:testCoreProject(state).client });
  const display = createTerritorialScopeResolver({ entityRepository: createTerritorialEntityRepository({ entityStore: store }), getState: () => state, clipper: () => null });
  await executeTerritorialTestCommand(state,'territorial.metadata',{ id:'B',field:'color',value:'#123456' ,valuePresent:true});
  assert.equal(display.displayFeature('B').properties.style.color, '#123456');
  assert.strictEqual(display.displayFeature('B').geometry, state.auditPreviewTerritorialUnits[0].geometry);
});

test('zoom round trips retain the preview but a changed canonical shape cannot use stale preview coordinates', async () => {
  const A = createTerritorialFeature({ id: 'A', entityKind: 'general', geometry: square(10) });
  const previewGeometry = square(1);
  const state = { territorialEntities: [A], countryVisualPhase: 'preview',
    auditPreviewCountries: { features: [{ ...A, geometry: previewGeometry }] },
    auditPreviewGeometryReferences: new Map([['A', { geometry: A.geometry, revision: 0 }]]) };
  await initializeTestTerritorialState(state);
const store = createTerritorialEntityStore({ documentModel:testCoreProject(state).documentModel,commandOwner:testCoreProject(state).client });
  const repo = createTerritorialEntityRepository({ entityStore: store });
  state.auditPreviewGeometryReferences = new Map([['A', { geometry: repo.get('A').geometry, revision: 0 }]]);
  const display = createTerritorialScopeResolver({ entityRepository: repo, getState: () => state, clipper: () => null });
  assert.strictEqual(display.displayFeature('A').geometry, previewGeometry);
  state.countryVisualPhase = 'canonical';
  assert.strictEqual(display.displayFeature('A').geometry, repo.get('A').geometry);
  state.countryVisualPhase = 'preview';
  assert.strictEqual(display.displayFeature('A').geometry, previewGeometry);
  await executeTerritorialTestCommand(state,'territorial.patch',{ features: [{ ...repo.get('A'), geometry: square(7) }] });
  assert.strictEqual(display.displayFeature('A').geometry, repo.get('A').geometry);
  assert.strictEqual(state.auditPreviewCountries.features[0].geometry, previewGeometry);
  assert.deepEqual(repo.get('A').geometry, square(7));
});

test('immutable vertex edits invalidate a cached preview when the binding changes', async () => {
  const A = createTerritorialFeature({ id: 'A', entityKind: 'general', geometry: square(10) });
  const state = { territorialEntities: [A], countryVisualPhase: 'preview',
    auditPreviewCountries: { features: [{ ...A, geometry: square(1) }] },
    auditPreviewGeometryReferences: new Map([['A', { geometry: A.geometry, revision: 0 }]]) };
  await initializeTestTerritorialState(state);
  const store = createTerritorialEntityStore({ documentModel:testCoreProject(state).documentModel,commandOwner:testCoreProject(state).client });
  const repo = createTerritorialEntityRepository({ entityStore: store });
  state.auditPreviewGeometryReferences = new Map([['A', { geometry: repo.get('A').geometry, revision: 0 }]]);
  const display = createTerritorialScopeResolver({ entityRepository: repo, getState: () => state, clipper: () => null });
  assert.deepEqual(display.displayFeature('A').geometry, square(1));
  const changed = structuredClone(repo.get('A'));
  changed.geometry.coordinates[0][1][1] = 8;
  await executeTerritorialTestCommand(state,'territorial.patch',{ features: [changed] });
  assert.strictEqual(display.displayFeature('A').geometry, repo.get('A').geometry);
  assert.equal(A.geometry.coordinates[0][1][1], 10);
});
