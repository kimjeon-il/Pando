import assert from 'node:assert/strict';
import test from 'node:test';
import { createObjectPicking } from '../../assets/js/modules/app-object-picking.js';
import { normalizeObjectRef } from '../../assets/js/modules/object-selection-controller.js';
import { createTerritorialFeature } from '../../assets/js/modules/territorial-units.js';
import { createTerritorialEntityStore } from '../../assets/js/modules/territorial-entity-store.js';
import { createTerritorialEntityRepository } from '../../assets/js/modules/territorial-entity-repository.js';
import { createTerritorialScopeResolver } from '../../assets/js/modules/territorial-scope.js';

const square = (x, size) => ({ type: 'Polygon', coordinates: [[[x, 0], [x, size], [x + size, size], [x + size, 0], [x, 0]]] });
test('canonical geometry drives precise territorial hits independently of display phase', () => {
  const A = createTerritorialFeature({ id: 'A', entityKind: 'general', geometry: square(0, 10) });
  const B = createTerritorialFeature({ id: 'B', entityKind: 'general', parentId: 'A', coverageMode: 'explicit', geometry: square(0, 10) });
  const R = createTerritorialFeature({ id: 'R', entityKind: 'regional', geometry: square(0, 10) });
  const state = { territorialEntities: [A, B, R], layerVisibility: {}, countryVisualPhase: 'preview',
    auditPreviewCountries: { features: [{ ...A, geometry: square(20, 10) }] },
    auditPreviewTerritorialUnits: [B, R], layerPresentation: { overlayOrder: ['regions', 'subunits'] } };
  const store = createTerritorialEntityStore({ getState: () => state });
  const entityRepository = createTerritorialEntityRepository({ entityStore: store });
  const territorialScope = createTerritorialScopeResolver({ entityRepository, getState: () => state, clipper: () => null });
  const picking = createObjectPicking();
  picking.connect({
    projectState: { state }, territorialModel: { entityRepository }, objectModelB: { territorialScope },
    selectionServices: { normalizeObjectRef }, objectLookup: { objectRefExists: ref => !!entityRepository.get(ref.id) },
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
  assert.deepEqual(hits().map(item => item.ref.key), ['territorial:entity:R', 'territorial:entity:B', 'territorial:entity:A']);
  state.layerVisibility.regions = false;
  assert.deepEqual(hits().map(item => item.ref.id), ['B', 'A']);
  assert.deepEqual(picking.territorialObjectsAt([25, 5], [25, 5], records), []);
  assert.deepEqual(hits().find(item => item.ref.id === 'A').feature.geometry, A.geometry);
  state.countryVisualPhase = 'canonical';
  assert.deepEqual(hits().map(item => item.ref.id), ['B', 'A']);
  state.layerVisibility.subunits = false;
  assert.deepEqual(hits().map(item => item.ref.id), ['A']);
  store.setField('B', 'parentId', '');
  assert.deepEqual(hits().map(item => item.ref.id), ['A', 'B']);
  assert.deepEqual(A.geometry, square(0, 10));
});
