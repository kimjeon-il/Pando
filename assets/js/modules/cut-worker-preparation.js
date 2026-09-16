import { createCutGeometry } from './app-cut-geometry.js';
import { createCountryValidation } from './app-country-validation.js';
import { createLandRelations } from './app-land-relations.js';
import { createTerritoryComponents } from './app-territory-components.js';
import { createRingHitTester } from './ring-hit-test.js';
import { snapLineEndpointsToBoundary } from './territorial-geometry.js';

export function prepareCutInWorker({ source, coords, view, buildPreview }, geometryApi, d3, clipper) {
  const projection = (view.kind === 'globe' ? d3.geo.orthographic() : d3.geo.equirectangular())
    .scale(view.scale).translate(view.translate).rotate(view.rotate).center(view.center);
  const validation = createCountryValidation();
  validation.connect(geometryApi);
  const land = createLandRelations();
  land.connect({ createRingHitTester, ensureClosedRing: geometryApi.ensureClosedRing });
  land.initializeRingHitTester();
  const components = createTerritoryComponents();
  components.connect(geometryApi);
  const cut = createCutGeometry();
  cut.connect({
    ...geometryApi,
    polygonClipping: clipper,
    coarsePointer: view.coarsePointer,
    state: { size: view.size },
    CUT_ENDPOINT_SNAP_DISTANCE: view.snapDistance,
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    coordKey: (coordinate, precision = 7) => coordinate.map(value => Number(value).toFixed(precision)).join(','),
    coordNear: (a, b, tolerance = 0.00008) => !!a && !!b && Math.min(Math.abs(a[0] - b[0]), Math.abs(Math.abs(a[0] - b[0]) - 360)) <= tolerance && Math.abs(a[1] - b[1]) <= tolerance,
    geometryMultiCoordinates: components.geometryMultiCoordinates,
    geometryPolygonSets: components.geometryMultiCoordinates,
    multiPolygonPlanarArea: components.multiPolygonPlanarArea,
    interpolateCoordinate: validation.interpolateCoordinate,
    segmentsProperlyIntersect: validation.segmentsProperlyIntersect,
    ringHasSelfIntersection: validation.ringHasSelfIntersection,
    pointOnSegment: land.pointOnSegment,
    pointInRing: land.pointInRing,
    snapLineEndpointsToBoundary,
    activeProjection: () => projection,
    isCoordVisible: coordinate => {
      const p = projection(coordinate);
      if (!p?.every(Number.isFinite)) return false;
      if (view.kind === 'globe') return d3.geo.distance(coordinate, [-view.rotate[0], -view.rotate[1]]) <= Math.PI / 2 + 0.005;
      return p[0] >= -30 && p[0] <= view.size.width + 30 && p[1] >= -30 && p[1] <= view.size.height + 30;
    },
  });
  const result = cut.assessCutDraft(coords, source);
  if (result.valid && buildPreview) {
    try { result.split = cut.buildCutSplitCandidates(source, coords, result); }
    catch (error) { result.split = null; result.splitError = error.message; }
  }
  return result;
}
