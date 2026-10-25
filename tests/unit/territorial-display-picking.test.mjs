import { normalizeLayerPresentation } from '../../assets/js/modules/layer-presentation.js';
import { executeTerritorialTestCommand, testCoreProject, initializeTestTerritorialState } from '../helpers/timeline-project.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createObjectPicking } from '../../assets/js/modules/object-picking.js';
import { normalizeObjectRef } from '../../assets/js/modules/object-selection-controller.js';
import { createTerritorialFeature } from '../../assets/js/modules/territorial-units.js';
import { createTerritorialEntityStore } from '../../assets/js/modules/territorial-entity-store.js';
import { createTerritorialEntityRepository } from '../../assets/js/modules/territorial-entity-repository.js';
import { createTerritorialScopeResolver } from '../../assets/js/modules/territorial-scope.js';

const square = (x, size) => ({ type: 'Polygon', coordinates: [[[x, 0], [x, size], [x + size, size], [x + size, 0], [x, 0]]] });
test('territorial hits use the displayed geometry and withhold pending surfaces', async () => {
  const A = createTerritorialFeature({ id: 'A', entityKind: 'general', geometry: square(0, 10) });
  const B = createTerritorialFeature({ id: 'B', entityKind: 'general', parentId: 'A', coverageMode: 'explicit', geometry: square(0, 10) });
  const R = createTerritorialFeature({ id: 'R', entityKind: 'regional', geometry: square(0, 10) });
  const state = { territorialEntities: [A, B, R], layerVisibility: {}, countryVisualPhase: 'preview',
    auditPreviewCountries: { features: [{ ...A, geometry: square(20, 10) }] },
    auditPreviewTerritorialUnits: [B, R], layerPresentation: normalizeLayerPresentation({ overlayOrder: ['objects'] }) };
  await initializeTestTerritorialState(state);
const store = createTerritorialEntityStore({ documentModel:testCoreProject(state).documentModel,commandOwner:testCoreProject(state).client });
  const entityRepository = createTerritorialEntityRepository({ entityStore: store });
  const territorialScope = createTerritorialScopeResolver({ entityRepository, getState: () => state, clipper: () => null });
  const picking = createObjectPicking();
  picking.connect({
    projectState: { state }, territorialModel: { entityRepository }, objectModelB: { territorialScope },
    selectionServices: { normalizeObjectRef }, objectLookup: { isObjectAvailable:()=>true,objectRefExists: ref => !!entityRepository.get(ref.id) },
    objectOperationsA: { objectRefVisible: () => state.layerVisibility.objects !== false,
      objectDisplayInfo: ref => ({name:ref.id}) },
    layerPresentation: { isLayerItemVisible: () => true }, surfaces: { isMobile: () => false },
    renderScene: { OVERLAY_GROUPS: [] }, rendering: { selectionPerformanceMetrics: {} },
    spatialRecords: { geometryBoundsCache: new WeakMap() },
    cutGeometry: { coordinateBounds: coordinates => {
      const points = coordinates.flat(); return [Math.min(...points.map(p => p[0])), 0, Math.max(...points.map(p => p[0])), 10];
    } }, labelPresentation: { currentMapZoom: () => 100 }, mapView: { activeProjection: () => point => point },
    landRelations: { pointInCountryFeature: (point, feature) => {
      const xs = feature.geometry.coordinates[0].map(p => p[0]);
      return point[0] > Math.min(...xs) && point[0] < Math.max(...xs) && point[1] > 0 && point[1] < 10;
    } }, platform: { clamp: (value, min, max) => Math.max(min, Math.min(max, value)) },
  });
  const records = ['A', 'B', 'R'].map(id => ({ domain: 'territorial', id }));
  const hits = () => picking.territorialObjectsAt([5, 5], [5, 5], records);
  assert.deepEqual(hits().map(item => item.ref.key), ['territorial:entity:R', 'territorial:entity:B']);
  await testCoreProject(state).project.executeCommand({ commandId:'presentation.apply',targets:[],
    payload:{ action:'visibility',key:'objects',visible:false } });
  assert.deepEqual(hits().map(item => item.ref.id), []);
  await testCoreProject(state).project.executeCommand({commandId:'presentation.apply',targets:[],payload:{action:'visibility',key:'objects',visible:true}});
  assert.deepEqual(picking.territorialObjectsAt([25, 5], [25, 5], records).map(item=>item.ref.id), ['A']);
  state.countryVisualPhase = 'pending';
  assert.deepEqual(hits(), []);
  state.countryVisualPhase = 'canonical';
  assert.deepEqual(hits().map(item => item.ref.id), ['R', 'B', 'A']);
  await testCoreProject(state).project.executeCommand({ commandId:'presentation.apply',targets:[],
    payload:{ action:'visibility',key:'objects',visible:false } });
  assert.deepEqual(hits().map(item => item.ref.id), []);
  await executeTerritorialTestCommand(state,'territorial.parent',{ id:'B',parentId:'' });
  assert.deepEqual(hits().map(item => item.ref.id), []);
  await testCoreProject(state).project.executeCommand({commandId:'presentation.apply',targets:[],payload:{action:'visibility',key:'objects',visible:true}});
  assert.deepEqual(new Set(hits().map(item => item.ref.id)), new Set(['R','A','B']));
  assert.deepEqual(A.geometry, square(0, 10));
});
