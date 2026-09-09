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
    return (0, dependencies.geometryPolygonSets)(feature?.geometry).some(polygon => pointInPolygonSet(point, polygon));
  }

  function pointInGenericFeature(point, feature) {
    return (0, dependencies.geometryPolygonSets)(feature?.geometry).some(polygon => pointInPolygonSet(point, polygon));
  }

  function partitionGroupMatches(feature, { unitType, sovereignId, parentId = '', adminLevel = null, metadata = {} }) {
    const expectedParentId = String(parentId || sovereignId || '');
    return feature.properties?.unitType === unitType
      && String(feature.properties?.sovereignId || '') === String(sovereignId || '')
      && feature.properties?.coverageMode === dependencies.TERRITORIAL_COVERAGE_MODES.PARTITION
      && String(feature.properties?.parentId || feature.properties?.sovereignId || '') === expectedParentId
      && (feature.properties?.metadata?.legacyTerritorialPartition || '') === (metadata.legacyTerritorialPartition || '')
      && (unitType !== dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT || Number(feature.properties?.adminLevel || 0) === Number(adminLevel || 0));
  }

  function addUnassignedTerritorialUnitGeometry(context, geometry) {
    const clipper = window.polygonClipping;
    const normalized = (0, dependencies.normalizeClippedLandGeometry)(geometry?.coordinates || geometry);
    if (!normalized) return null;
    let target = dependencies.state.territorialUnits.find(feature => partitionGroupMatches(feature, context)
      && feature.properties?.isRemainder === true);
    if (target) {
      target.geometry = (0, dependencies.normalizeClippedLandGeometry)(clipper.union(target.geometry.coordinates, normalized.coordinates)) || target.geometry;
      return target;
    }
    target = (0, dependencies.createPartitionTerritorialFeature)({
      id: (0, dependencies.uid)('subunit'),
      ...context,
      isRemainder: true,
      geometry: normalized,
    });
    dependencies.state.territorialUnits.push(target);
    return target;
  }

  function reconcileTerritorialUnitCompleteness(countryIds, { preserveIds = [] } = {}) {
    const clipper = window.polygonClipping;
    if (!clipper?.intersection || !clipper?.difference || !clipper?.union) return;
    const wanted = new Set([...countryIds].map(String));
    const preserved = new Set(preserveIds.map(String));
    dependencies.state.territorialUnits = dependencies.state.territorialUnits.flatMap(feature => {
      const countryId = String(feature.properties?.sovereignId || '');
      if (!wanted.has(countryId)) return [feature];
      if (preserved.has(String(feature.id)) || feature.properties?.coverageMode === dependencies.TERRITORIAL_COVERAGE_MODES.EXPLICIT) return [feature];
      const container = (0, dependencies.territorialUnitContainer)(feature);
      if (!container?.geometry) return [];
      const clipped = (0, dependencies.normalizeClippedLandGeometry)(clipper.intersection(feature.geometry.coordinates, container.geometry.coordinates));
      if (!clipped) return [];
      feature.geometry = clipped;
      return [feature];
    });

    const groupContexts = new Map();
    for (const feature of dependencies.state.territorialUnits) {
      if (feature.properties?.unitType !== dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT || !wanted.has(String(feature.properties?.sovereignId || ''))) continue;
      const context = {
        unitType: dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT,
        sovereignId: String(feature.properties.sovereignId || ''),
        parentId: String(feature.properties.parentId || ''),
        adminLevel: Number(feature.properties.adminLevel) || null,
        metadata: { legacyTerritorialPartition: feature.properties?.metadata?.legacyTerritorialPartition || '' },
      };
      groupContexts.set(`${context.sovereignId}|${context.parentId}|${context.adminLevel}|${context.metadata.legacyTerritorialPartition}`, context);
    }
    for (const context of [...groupContexts.values()].sort((left, right) => left.adminLevel - right.adminLevel)) {
      const parent = context.parentId ? dependencies.territorialRepository.get(context.parentId) : (0, dependencies.countryFeatureById)(context.sovereignId);
      if (!parent?.geometry) continue;
      const siblings = dependencies.state.territorialUnits.filter(feature => partitionGroupMatches(feature, context));
      const covered = clipper.union(...siblings.map(feature => feature.geometry.coordinates));
      const remainder = (0, dependencies.normalizeClippedLandGeometry)(clipper.difference(parent.geometry.coordinates, covered));
      if (remainder) addUnassignedTerritorialUnitGeometry(context, remainder);
    }
    dependencies.state.territorialUnits = (0, dependencies.normalizeTerritorialUnits)(dependencies.state.territorialUnits, { countryExists: id => !!(0, dependencies.countryFeatureById)(id) });
  }

  function syncHardLandDependents(ownerId, _ownerBeforeGeometry, _ownerAfterGeometry, _changedAnchor = null) {
    const beforeIds = new Set(dependencies.state.territorialUnits.map(feature => String(feature.id)));
    reconcileTerritorialUnitCompleteness([ownerId]);
    (0, dependencies.markLayerTreeDirty)();
    return dependencies.state.territorialUnits.filter(feature => !beforeIds.has(String(feature.id))).map(feature => String(feature.id));
  }

  function transferLandDependents(transferredGeometry, sourceOwnerIds, targetOwnerId) {
    const clipper = window.polygonClipping;
    if (!transferredGeometry || !clipper?.difference) return [];
    const sources = new Set(sourceOwnerIds.map(String));
    const changedIds = [];
    dependencies.state.territorialUnits = dependencies.state.territorialUnits.flatMap(feature => {
      if (!sources.has(String(feature.properties?.sovereignId || ''))) return [feature];
      const remainder = (0, dependencies.normalizeClippedLandGeometry)(clipper.difference(feature.geometry.coordinates, transferredGeometry.coordinates));
      changedIds.push(String(feature.id));
      if (!remainder) return [];
      feature.geometry = remainder;
      return [feature];
    });
    const targetHasTerritories = dependencies.state.territorialUnits.some(feature => partitionGroupMatches(feature, {
      unitType: dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT, sovereignId: targetOwnerId,
    }));
    if (targetHasTerritories) addUnassignedTerritorialUnitGeometry({
      unitType: dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT, sovereignId: String(targetOwnerId), parentId: '', adminLevel: null,
    }, transferredGeometry);
    reconcileTerritorialUnitCompleteness([...sources, String(targetOwnerId)]);
    (0, dependencies.markLayerTreeDirty)();
    return changedIds;
  }

  function reassignLandDependents(removedOwnerIds, targetOwnerId) {
    const removed = new Set(removedOwnerIds.map(String));
    for (const feature of dependencies.state.territorialUnits) {
      if (!removed.has(String(feature.properties?.sovereignId || ''))) continue;
      feature.properties.sovereignId = String(targetOwnerId);
      if (removed.has(String(feature.properties?.parentId || ''))) feature.properties.parentId = String(targetOwnerId);
    }
    for (const relation of dependencies.state.territorialRelations) {
      if (removed.has(String(relation.sovereignId || ''))) relation.sovereignId = String(targetOwnerId);
      if (removed.has(String(relation.parentId || ''))) relation.parentId = String(targetOwnerId);
    }
    for (const entry of dependencies.state.distributionEntries) {
      if (entry.mode === dependencies.DISTRIBUTION_MODES.TERRITORIAL && removed.has(String(entry.territorialUnitId))) entry.territorialUnitId = String(targetOwnerId);
    }
    dependencies.state.territorialUnits = (0, dependencies.normalizeTerritorialUnits)(dependencies.state.territorialUnits, { countryExists: id => !!(0, dependencies.countryFeatureById)(id) });
    reconcileTerritorialUnitCompleteness([targetOwnerId]);
    (0, dependencies.markLayerTreeDirty)();
  }

  function reassignGenericFeatureParents(removedGenericFeatureIds, replacementId = '') {
    const removed = new Set(removedGenericFeatureIds.map(String));
    for (const feature of dependencies.state.genericFeatures) {
      if (!removed.has(String(feature.properties?.parentId || ''))) continue;
      feature.properties.parentId = String(replacementId || '');
    }
  }

  function initializeRingHitTester() {
    (ringHitTester = (0, dependencies.createRingHitTester)(dependencies.ensureClosedRing));
  }

  return Object.freeze({
    connect,
    initializeRingHitTester,
    get addUnassignedTerritorialUnitGeometry() { return addUnassignedTerritorialUnitGeometry; },
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
