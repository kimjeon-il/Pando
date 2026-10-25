import { wrapPolygonGeometry, multiCoordinates, normalizeClippedPolygonGeometry } from "../../../../../shared/frontend/js/modules/map-edit-geometry.js";
/** LandRelations: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createLandRelations() {
  let dependencies;
  let ringHitTester;
  function connect(ports) {
    if (dependencies) throw new Error('land-relations already connected');
    dependencies = ports;
  }

  function pointOnSegment(point, a, b, tolerance = 1e-7) {
    const cross = (point[1] - a[1]) * (b[0] - a[0]) - (point[0] - a[0]) * (b[1] - a[1]);
    if (Math.abs(cross) > tolerance) return false;
    const dot = (point[0] - a[0]) * (point[0] - b[0]) + (point[1] - a[1]) * (point[1] - b[1]);
    return dot <= tolerance;
  }

  function pointInRing(point, rawRing) {
    return ringHitTester.contains(point, rawRing);
  }

  function pointInCountryFeature(point, feature) {
    return ringHitTester.containsGeometry(point, feature?.geometry);
  }

  function pointInGenericFeature(point, feature) {
    return ringHitTester.containsGeometry(point, feature?.geometry);
  }

  function viewIndex(territorialViews) {
    if (!Array.isArray(territorialViews)) throw new TypeError('Accepted or prepared territorial views are required for land geometry calculations.');
    return new Map(territorialViews.map(feature => [String(feature.id), feature]));
  }

  function overlayViews(territorialViews, { features, removedIds }) {
    const removed = new Set(removedIds.map(String)), changed = new Map(features.map(feature => [String(feature.id), feature]));
    return territorialViews.filter(feature => !removed.has(String(feature.id)))
      .map(feature => changed.get(String(feature.id)) || feature);
  }

  function combinePlans(territorialViews, first, second) {
    const removedIds = [...first.removedIds, ...second.removedIds], removed = new Set(removedIds.map(String));
    const changed = new Map([...first.features, ...second.features].map(feature => [String(feature.id), feature]));
    return { features: territorialViews.filter(feature => !removed.has(String(feature.id)) && changed.has(String(feature.id)))
      .map(feature => changed.get(String(feature.id))), removedIds };
  }

  function planTerritorialCompleteness({ territorialViews, countryIds, preserveIds = [] }) {
    const byId = viewIndex(territorialViews);
    const clipper = window.polygonClipping;
    if (!clipper?.intersection || !clipper?.difference || !clipper?.union) return { features: [], removedIds: [] };
    const wanted = new Set([...countryIds].map(String));
    const preserved = new Set(preserveIds.map(String));
    const beforeUnits = territorialViews.filter(entity => entity.properties.entityKind === 'general' && !!entity.properties.parentId);
    const nextUnits = beforeUnits.flatMap(feature => {
      const countryId = String((0, dependencies.territorialModel.territorialRootId)(feature, id => byId.get(String(id))) || '');
      if (!wanted.has(countryId)) return [feature];
      if (preserved.has(String(feature.id)) || feature.properties?.coverageMode === dependencies.territorialModel.TERRITORIAL_COVERAGE_MODES.EXPLICIT) return [feature];
      const container = byId.get(String(feature.properties.parentId));
      if (!container?.geometry) return [];
      const clipped = normalizeClippedPolygonGeometry(clipper.intersection(multiCoordinates(wrapPolygonGeometry(feature.geometry, clipper)), multiCoordinates(wrapPolygonGeometry(container.geometry, clipper))));
      if (!clipped) return [];
      return [{ ...feature, geometry: clipped }];
    });

    const retainedIds = new Set(nextUnits.map(feature => String(feature.id)));
    return { features: nextUnits,
      removedIds: beforeUnits.filter(feature => !retainedIds.has(String(feature.id))).map(feature => feature.id) };
  }

  function planTransferLandDependents({ territorialViews, transferredGeometry, sourceOwnerIds, targetOwnerId }) {
    const byId = viewIndex(territorialViews);
    const clipper = window.polygonClipping;
    if (!transferredGeometry || !clipper?.difference) return { features: [], removedIds: [] };
    const sources = new Set(sourceOwnerIds.map(String));
    const removedIds = [];
    const features = territorialViews.filter(entity => entity.properties.entityKind === 'general' && !!entity.properties.parentId).flatMap(feature => {
        if (!sources.has(String((0, dependencies.territorialModel.territorialRootId)(feature, id => byId.get(String(id))) || ''))) return [];
        const remainder = normalizeClippedPolygonGeometry(clipper.difference(multiCoordinates(wrapPolygonGeometry(feature.geometry, clipper)), multiCoordinates(wrapPolygonGeometry(transferredGeometry, clipper))));
        if (!remainder) { removedIds.push(feature.id); return []; }
        return [{ ...feature, geometry: remainder }];
      });
    const completeness = planTerritorialCompleteness({ territorialViews: overlayViews(territorialViews, { features, removedIds }),
      countryIds: [...sources, String(targetOwnerId)] });
    return combinePlans(territorialViews, { features, removedIds }, completeness);
  }

  function planReassignLandDependents({ territorialViews, distributionEntries, removedOwnerIds, targetOwnerId }) {
    const byId = viewIndex(territorialViews);
    if (!Array.isArray(distributionEntries)) throw new TypeError('Accepted distribution entries are required for land reassignment.');
    const removed = new Set(removedOwnerIds.map(String));
    const reassignedUnits = territorialViews.filter(entity => entity.properties.entityKind === 'general' && !!entity.properties.parentId).map(feature => {
      if (!removed.has(String((0, dependencies.territorialModel.territorialRootId)(feature, id => byId.get(String(id))) || ''))) return feature;
      const properties = { ...feature.properties };
      if (removed.has(String(feature.properties?.parentId || ''))) properties.parentId = String(targetOwnerId);
      return { ...feature, properties };
    });
    const completeness = planTerritorialCompleteness({ territorialViews: overlayViews(territorialViews,
      { features: reassignedUnits, removedIds: [] }), countryIds: [targetOwnerId] });
    const changedEntries = distributionEntries
      .filter(entry => entry.mode === dependencies.territorialModel.DISTRIBUTION_MODES.TERRITORIAL && removed.has(String(entry.territorialUnitId)))
      .map(entry => ({ ...entry, territorialUnitId: String(targetOwnerId) }));
    return { ...combinePlans(territorialViews, { features: reassignedUnits, removedIds: [] }, completeness), distributionEntries: changedEntries };
  }

  function initializeRingHitTester() {
    (ringHitTester = (0, dependencies.territorialModel.createRingHitTester)(dependencies.geometryModel.ensureClosedRing));
  }

  return Object.freeze({
    connect,
    initializeRingHitTester,
    get pointInCountryFeature() { return pointInCountryFeature; },
    get pointInGenericFeature() { return pointInGenericFeature; },
    get pointInRing() { return pointInRing; },
    get pointOnSegment() { return pointOnSegment; },
    planReassignLandDependents,
    planTerritorialCompleteness,
    get ringHitTester() { return ringHitTester; },
    planTransferLandDependents,
  });
}
