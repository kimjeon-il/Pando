import assert from 'node:assert/strict';
import test from 'node:test';
import { createSpatialIndex } from '../../assets/js/modules/app-spatial-index.js';
import { createMapObjectSpatialIndex } from '../../assets/js/modules/map-object-spatial-index.js';
import { createTerritorialFeature } from '../../assets/js/modules/territorial-units.js';
import { createTerritorialEntityStore } from '../../assets/js/modules/territorial-entity-store.js';
import { createTerritorialEntityRepository } from '../../assets/js/modules/territorial-entity-repository.js';
import { createTerritorialScopeResolver } from '../../assets/js/modules/territorial-scope.js';

const square = x => ({ type: 'Polygon', coordinates: [[[x, 0], [x, 10], [x + 10, 10], [x + 10, 0], [x, 0]]] });

test('territorial spatial candidates follow canonical store hydration while preview remains displayed', () => {
  const preview = createTerritorialFeature({ id: 'A', entityKind: 'general', geometry: square(20) });
  const canonical = createTerritorialFeature({ id: 'A', entityKind: 'general', geometry: square(0) });
  const state = { territorialEntities: [preview], countryVisualPhase: 'preview',
    auditPreviewCountries: { features: [preview] }, auditPreviewTerritorialUnits: [],
    labels: [], genericFeatures: [], hydroEdits: [] };
  const entityStore = createTerritorialEntityStore({ getState: () => state });
  const entityRepository = createTerritorialEntityRepository({ entityStore });
  const territorialScope = createTerritorialScopeResolver({ entityRepository, getState: () => state, clipper: () => null });
  const spatial = createSpatialIndex();
  spatial.connect({ projectState: { state }, territorialModel: { entityRepository }, objectModelB: { territorialScope },
    domains: { renderingDomain: { getDistributionRenderRows: () => [] } },
    spatialFactories: { createMapObjectSpatialIndex }, cutGeometry: { coordinateBounds: coordinates => {
      const points = coordinates.flat(2);
      const xs = points.filter((_, index) => index % 2 === 0);
      const ys = points.filter((_, index) => index % 2 === 1);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    } } });
  spatial.initializeGeometryBoundsCache();
  spatial.initializeMapObjectSpatialIndex();
  const candidates = x => spatial.mapObjectSpatialIndex.query([x + 4, 4, x + 6, 6], { domains: ['territorial'] }).map(row => row.id);
  spatial.rebuildMapObjectSpatialIndex();
  assert.deepEqual(candidates(20), ['A']);
  assert.deepEqual(candidates(0), []);

  entityStore.replaceEntities([canonical]);
  spatial.rebuildMapObjectSpatialIndex();
  assert.deepEqual(territorialScope.displayFeature('A').geometry, preview.geometry);
  assert.deepEqual(candidates(0), ['A']);
  assert.deepEqual(candidates(20), []);
  state.countryVisualPhase = 'canonical';
  spatial.rebuildMapObjectSpatialIndex();
  assert.deepEqual(candidates(0), ['A']);
  state.countryVisualPhase = 'preview';
  spatial.rebuildMapObjectSpatialIndex();
  assert.deepEqual(candidates(0), ['A']);
  assert.deepEqual(candidates(20), []);
  assert.deepEqual(entityRepository.get('A').geometry, canonical.geometry);
});