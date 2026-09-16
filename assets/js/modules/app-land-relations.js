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

  function pointInPolygonSet(point, polygon) {
    if (!polygon?.length || !pointInRing(point, polygon[0])) return false;
    for (let i = 1; i < polygon.length; i += 1) if (pointInRing(point, polygon[i])) return false;
    return true;
  }

  function pointInCountryFeature(point, feature) {
    return (0, dependencies.geometryPreview.geometryPolygonSets)(feature?.geometry).some(polygon => pointInPolygonSet(point, polygon));
  }

  function pointInGenericFeature(point, feature) {
    return (0, dependencies.geometryPreview.geometryPolygonSets)(feature?.geometry).some(polygon => pointInPolygonSet(point, polygon));
  }

  function partitionGroupMatches(feature, { unitType, sovereignId, parentId = '' }) {
    return feature.properties?.unitType === unitType
      && String(feature.properties?.sovereignId || '') === String(sovereignId || '')
      && String(feature.properties?.parentId || '') === String(parentId || sovereignId || '');
  }

  function reconcileTerritorialUnitCompleteness(countryIds, { preserveIds = [] } = {}) {
    const clipper = window.polygonClipping;
    if (!clipper?.intersection || !clipper?.difference || !clipper?.union) return;
    const wanted = new Set([...countryIds].map(String));
    const preserved = new Set(preserveIds.map(String));
    dependencies.projectState.state.territorialUnits = dependencies.projectState.state.territorialUnits.flatMap(feature => {
      const countryId = String(feature.properties?.sovereignId || '');
      if (!wanted.has(countryId)) return [feature];
      if (preserved.has(String(feature.id)) || feature.properties?.coverageMode === dependencies.territorialModel.TERRITORIAL_COVERAGE_MODES.EXPLICIT) return [feature];
      const container = (0, dependencies.territoryGeometry.territorialUnitContainer)(feature);
      if (!container?.geometry) return [];
      const clipped = (0, dependencies.cutGeometry.normalizeClippedLandGeometry)(clipper.intersection(feature.geometry.coordinates, container.geometry.coordinates));
      if (!clipped) return [];
      feature.geometry = clipped;
      return [feature];
    });

    dependencies.projectState.state.territorialUnits = (0, dependencies.territorialModel.normalizeTerritorialUnits)(dependencies.projectState.state.territorialUnits, { countryExists: id => !!(0, dependencies.countries.countryFeatureById)(id) });
  }

  function syncHardLandDependents(ownerId, _ownerBeforeGeometry, _ownerAfterGeometry, _changedAnchor = null) {
    const beforeIds = new Set(dependencies.projectState.state.territorialUnits.map(feature => String(feature.id)));
    reconcileTerritorialUnitCompleteness([ownerId]);
    (0, dependencies.layers.markLayerTreeDirty)();
    return dependencies.projectState.state.territorialUnits.filter(feature => !beforeIds.has(String(feature.id))).map(feature => String(feature.id));
  }

  function transferLandDependents(transferredGeometry, sourceOwnerIds, targetOwnerId) {
    const clipper = window.polygonClipping;
    if (!transferredGeometry || !clipper?.difference) return [];
    const sources = new Set(sourceOwnerIds.map(String));
    const changedIds = [];
    dependencies.projectState.state.territorialUnits = dependencies.projectState.state.territorialUnits.flatMap(feature => {
      if (!sources.has(String(feature.properties?.sovereignId || ''))) return [feature];
      const remainder = (0, dependencies.cutGeometry.normalizeClippedLandGeometry)(clipper.difference(feature.geometry.coordinates, transferredGeometry.coordinates));
      changedIds.push(String(feature.id));
      if (!remainder) return [];
      feature.geometry = remainder;
      return [feature];
    });
    reconcileTerritorialUnitCompleteness([...sources, String(targetOwnerId)]);
    (0, dependencies.layers.markLayerTreeDirty)();
    return changedIds;
  }

  function reassignLandDependents(removedOwnerIds, targetOwnerId) {
    const removed = new Set(removedOwnerIds.map(String));
    for (const feature of dependencies.projectState.state.territorialUnits) {
      if (!removed.has(String(feature.properties?.sovereignId || ''))) continue;
      feature.properties.sovereignId = String(targetOwnerId);
      if (removed.has(String(feature.properties?.parentId || ''))) feature.properties.parentId = String(targetOwnerId);
    }
    for (const relation of dependencies.projectState.state.territorialRelations) {
      if (removed.has(String(relation.sovereignId || ''))) relation.sovereignId = String(targetOwnerId);
      if (removed.has(String(relation.parentId || ''))) relation.parentId = String(targetOwnerId);
    }
    for (const entry of dependencies.projectState.state.distributionEntries) {
      if (entry.mode === dependencies.territorialModel.DISTRIBUTION_MODES.TERRITORIAL && removed.has(String(entry.territorialUnitId))) entry.territorialUnitId = String(targetOwnerId);
    }
    dependencies.projectState.state.territorialUnits = (0, dependencies.territorialModel.normalizeTerritorialUnits)(dependencies.projectState.state.territorialUnits, { countryExists: id => !!(0, dependencies.countries.countryFeatureById)(id) });
    reconcileTerritorialUnitCompleteness([targetOwnerId]);
    (0, dependencies.layers.markLayerTreeDirty)();
  }

  function reassignGenericFeatureParents(removedGenericFeatureIds, replacementId = '') {
    const removed = new Set(removedGenericFeatureIds.map(String));
    for (const feature of dependencies.projectState.state.genericFeatures) {
      if (!removed.has(String(feature.properties?.parentId || ''))) continue;
      feature.properties.parentId = String(replacementId || '');
    }
  }

  function initializeRingHitTester() {
    (ringHitTester = (0, dependencies.territorialModel.createRingHitTester)(dependencies.geometryModel.ensureClosedRing));
  }

  return Object.freeze({
    connect,
    initializeRingHitTester,
    get partitionGroupMatches() { return partitionGroupMatches; },
    get pointInCountryFeature() { return pointInCountryFeature; },
    get pointInGenericFeature() { return pointInGenericFeature; },
    get pointInRing() { return pointInRing; },
    get pointOnSegment() { return pointOnSegment; },
    get reassignGenericFeatureParents() { return reassignGenericFeatureParents; },
    get reassignLandDependents() { return reassignLandDependents; },
    get reconcileTerritorialUnitCompleteness() { return reconcileTerritorialUnitCompleteness; },
    get ringHitTester() { return ringHitTester; },
    get syncHardLandDependents() { return syncHardLandDependents; },
    get transferLandDependents() { return transferLandDependents; },
  });
}
