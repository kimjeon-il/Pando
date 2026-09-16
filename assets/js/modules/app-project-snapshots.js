import { createGeometrySnapshotPool } from './geometry-versions.js';
/** ProjectSnapshots: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createProjectSnapshots() {
  const geometrySnapshots = createGeometrySnapshotPool();
  let dependencies;
  let historyStore;
  let historyService;
  function connect(ports) {
    if (dependencies) throw new Error('project-snapshots already connected');
    dependencies = ports;
  }

  function configureDatasetSession(project = null) {
    geometrySnapshots.clear();
    const deltaProject = project?.format === 'pandolab-autosave-delta';
    const pristineCompatible = !project?.countriesData || project.baseDataset === dependencies.platformConfigurationA.BASE_DATASET || deltaProject;
    dependencies.projectState.state.sessionBaseCountriesJson = pristineCompatible
      ? null
      : JSON.stringify(dependencies.projectState.state.countriesData || { type: 'FeatureCollection', features: [] });
    dependencies.projectState.state.historyDirtyCountryIds = new Set();
    // The pristine geometry store stays at 258 source features. Persist these
    // removals in delta/history snapshots so old sources cannot resurrect them.
    for (const unit of dependencies.projectState.state.territorialUnits) {
      const sourceId = (0, dependencies.objectCatalog.builtinSubunitSourceId)(unit);
      if (sourceId && !(0, dependencies.countries.countryFeatureById)(sourceId)) dependencies.projectState.state.historyDirtyCountryIds.add(sourceId);
    }
    if (!project) for (const policy of dependencies.applicationConstantsA.BUILTIN_TERRITORY_MERGES) {
      if (!(0, dependencies.countries.countryFeatureById)(policy.sourceId) && (0, dependencies.countries.countryFeatureById)(policy.controller)) {
        dependencies.projectState.state.historyDirtyCountryIds.add(policy.sourceId);
        dependencies.projectState.state.historyDirtyCountryIds.add(policy.controller);
      }
    }
    if (deltaProject) {
      const delta = project.countryDelta || { changed: [], removedIds: [] };
      dependencies.projectState.state.historyDirtyCountryIds = new Set([
        ...(delta.changed || []).map(feature => String(feature.id || '')),
        ...(delta.removedIds || []).map(String),
      ].filter(Boolean));
      return;
    }
    if (project?.countriesData && pristineCompatible) {
      const currentIds = new Set();
      for (const feature of dependencies.projectState.state.countriesData?.features || []) {
        const id = String(feature.id || '');
        currentIds.add(id);
        if (dependencies.builtinCountries.canonicalCountryStore) {
          if (!dependencies.builtinCountries.canonicalCountryStore.getFingerprint(id)
              || !dependencies.builtinCountries.canonicalCountryStore.geometryEquals(id, feature.geometry)) dependencies.projectState.state.historyDirtyCountryIds.add(id);
        } else {
          const pristine = (dependencies.builtinCountries.pristineCountriesFallback?.features || []).find(candidate => String(candidate.id || '') === id);
          if (!pristine || JSON.stringify(pristine.geometry) !== JSON.stringify(feature.geometry)) dependencies.projectState.state.historyDirtyCountryIds.add(id);
        }
      }
      const pristineIds = dependencies.builtinCountries.canonicalCountryStore?.ids?.()
        || (dependencies.builtinCountries.pristineCountriesFallback?.features || []).map(feature => String(feature.id || ''));
      for (const id of pristineIds) if (!currentIds.has(String(id))) dependencies.projectState.state.historyDirtyCountryIds.add(String(id));
    }
  }

  function buildCountryDelta() {
    const current = new Map((dependencies.projectState.state.countriesData?.features || []).map(feature => [String(feature.id || ''), feature]));
    const changed = [];
    const removedIds = [];
    for (const id of dependencies.projectState.state.historyDirtyCountryIds) {
      const feature = current.get(String(id));
      if (feature) changed.push(geometrySnapshots.clone(feature));
      else removedIds.push(String(id));
    }
    return { changed, removedIds };
  }

  function restoreCountriesFromSnapshot(snapshot) {
    if (snapshot.countriesData) {
      dependencies.projectState.state.countriesData = (0, dependencies.geometryMutation.reindexCountries)(geometrySnapshots.restore(snapshot.countriesData, dependencies.projectState.state.countriesData), true);
      dependencies.projectState.state.historyDirtyCountryIds = new Set();
      return;
    }
    const delta = snapshot.countryDelta || { changed: [], removedIds: [] };
    const changed = new Map((delta.changed || []).map(feature => [String(feature.id || ''), feature]));
    const removed = new Set((delta.removedIds || []).map(String));
    const seen = new Set();
    const currentById = new Map((dependencies.projectState.state.countriesData?.features || []).map(feature => [String(feature.id || ''), feature]));
    let base;
    if (dependencies.projectState.state.sessionBaseCountriesJson) {
      base = JSON.parse(dependencies.projectState.state.sessionBaseCountriesJson);
      base.features = (base.features || []).filter(feature => !removed.has(String(feature.id || ''))).map(feature => {
        const id = String(feature.id || '');
        if (!changed.has(id)) return feature;
        seen.add(id);
        return geometrySnapshots.restore(changed.get(id), currentById.get(id));
      });
    } else if (dependencies.builtinCountries.canonicalCountryStore) {
      base = { type: 'FeatureCollection', features: [] };
      for (const id of dependencies.builtinCountries.canonicalCountryStore.ids()) {
        if (removed.has(id)) continue;
        if (changed.has(id)) {
          seen.add(id);
          base.features.push(geometrySnapshots.restore(changed.get(id), currentById.get(id)));
          continue;
        }
        const current = currentById.get(id);
        base.features.push(current && dependencies.builtinCountries.canonicalCountryStore.geometryEquals(id, current.geometry)
          ? current
          : dependencies.builtinCountries.canonicalCountryStore.materializeFeature(id));
      }
    } else {
      base = (0, dependencies.builtinCountries.materializePristineCountriesSync)();
      base.features = (base.features || []).filter(feature => !removed.has(String(feature.id || ''))).map(feature => {
        const id = String(feature.id || '');
        if (!changed.has(id)) return feature;
        seen.add(id);
        return geometrySnapshots.restore(changed.get(id), currentById.get(id));
      });
    }
    for (const [id, feature] of changed) if (!seen.has(id)) base.features.push(geometrySnapshots.restore(feature, currentById.get(id)));
    dependencies.projectState.state.countriesData = (0, dependencies.geometryMutation.reindexCountries)(base, true);
    const unchangedIds = (dependencies.projectState.state.countriesData.features || []).map(feature => String(feature.id || '')).filter(id => !changed.has(id));
    if (!dependencies.projectState.state.sessionBaseCountriesJson) (0, dependencies.countryRecords.applyPristineLabelAnchors)(dependencies.projectState.state.countriesData, unchangedIds);
    dependencies.projectState.state.historyDirtyCountryIds = new Set(snapshot.historyDirtyCountryIds || [...changed.keys(), ...removed]);
  }

  function snapshotEditable() {
    return {
      countryDelta: buildCountryDelta(),
      historyDirtyCountryIds: [...dependencies.projectState.state.historyDirtyCountryIds],
      ...(0, dependencies.projectServices.pickProjectFields)(dependencies.projectState.state, { scope: 'history', clone: geometrySnapshots.clone }),
    };
  }

  function applySharedProjectFields(source, scope = 'project') {
    const fieldCopy = (key, value) => scope === 'history'
      ? geometrySnapshots.restore(value || [], dependencies.projectState.state[key]) : (0, dependencies.platform.deepClone)(value || []);
    return (0, dependencies.projectServices.applyProjectFields)(dependencies.projectState.state, source, {
      scope,
      clone: dependencies.platform.deepClone,
      normalizers: {
        labelSettings: value => (0, dependencies.platform.deepClone)(value || {}),
        genericFeatures: value => fieldCopy('genericFeatures', value),
        hydroEdits: value => fieldCopy('hydroEdits', value),
        territorialUnits: value => fieldCopy('territorialUnits', value),
        territorialRelations: value => (0, dependencies.platform.deepClone)(value || []),
        distributionLayers: value => (0, dependencies.platform.deepClone)(value || []),
        distributionEntries: value => fieldCopy('distributionEntries', value),
        distributionSettings: value => ({
          renderMode: value?.renderMode === dependencies.applicationConstantsA.DISTRIBUTION_RENDER_MODES.INTENSITY ? dependencies.applicationConstantsA.DISTRIBUTION_RENDER_MODES.INTENSITY : dependencies.applicationConstantsA.DISTRIBUTION_RENDER_MODES.DOMINANT,
          boundaryVisible: value?.boundaryVisible !== false,
        }),
        physicalSettings: (value, current) => (0, dependencies.hydroModel.normalizePhysicalSettings)(value || current),
        layerVisibility: (value, current) => (0, dependencies.projectSession.normalizeLayerVisibility)(value, current),
        itemVisibility: value => (0, dependencies.layerTree.normalizeLayerItemState)(value),
        layerPresentation: value => (0, dependencies.modelValidation.normalizeLayerPresentation)(value),
      },
    });
  }

  function normalizeProjectObjects({ history = false } = {}) {
    const countryIds = new Set((dependencies.projectState.state.countriesData?.features || []).map(feature => String(feature?.id || '')).filter(Boolean));
    dependencies.projectState.state.countryOverrides = (0, dependencies.countryServices.pruneCountryOverrides)(dependencies.projectState.state.countryOverrides, countryIds);
    dependencies.projectState.state.hydroEdits = (0, dependencies.hydroModel.normalizeHydroEditCollection)(dependencies.projectState.state.hydroEdits);
    dependencies.projectState.state.genericFeatures = (0, dependencies.modelValidation.normalizeGenericFeatureCollection)(dependencies.projectState.state.genericFeatures || [], history ? { cloneFeature: feature => ({ ...feature }) } : {});
    dependencies.projectState.state.distributionLayers = (0, dependencies.distributionServices.normalizeDistributionLayers)(dependencies.projectState.state.distributionLayers);
    const distributionLayerIds = new Set(dependencies.projectState.state.distributionLayers.map(layer => layer.id));
    dependencies.projectState.state.distributionEntries = (0, dependencies.distributionServices.normalizeDistributionEntries)(dependencies.projectState.state.distributionEntries, {
      layerExists: id => distributionLayerIds.has(id),
      ...(history ? { cloneGeometry: geometry => geometry } : {}),
    });
    dependencies.projectState.state.distributionSettings = {
      renderMode: dependencies.projectState.state.distributionSettings?.renderMode === dependencies.applicationConstantsA.DISTRIBUTION_RENDER_MODES.INTENSITY ? dependencies.applicationConstantsA.DISTRIBUTION_RENDER_MODES.INTENSITY : dependencies.applicationConstantsA.DISTRIBUTION_RENDER_MODES.DOMINANT,
      boundaryVisible: dependencies.projectState.state.distributionSettings?.boundaryVisible !== false,
    };
    dependencies.projectState.state.selectedDistributionLayerId = distributionLayerIds.has(String(dependencies.projectState.state.selectedDistributionLayerId || ''))
      ? String(dependencies.projectState.state.selectedDistributionLayerId)
      : '';
    dependencies.projectState.state.territorialUnits = (0, dependencies.territorialModel.normalizeTerritorialUnits)(dependencies.projectState.state.territorialUnits, {
      countryExists: id => !!(0, dependencies.countries.countryFeatureById)(id),
      validatedUnchanged: history ? new Set(dependencies.projectState.state.territorialUnits) : undefined,
    });
    dependencies.projectState.state.territorialRelations = (0, dependencies.territorialServicesA.normalizeTerritorialRelations)(dependencies.projectState.state.territorialRelations);
    const relationValidation = dependencies.objectModelB.territorialApplicationService.validateRelations(dependencies.projectState.state.territorialUnits, {
      countryExists: id => !!(0, dependencies.countries.countryFeatureById)(id),
      relations: dependencies.projectState.state.territorialRelations,
    });
    if (!relationValidation.ok) throw new Error(relationValidation.issues[0] || '영역 관계가 올바르지 않습니다.');
    const distributionValidation = (0, dependencies.distributionServices.validateDistributionModel)(dependencies.projectState.state.distributionLayers, dependencies.projectState.state.distributionEntries, {
      territorialExists: id => !!dependencies.presentation.territorialRepository.get(id),
    });
    if (!distributionValidation.ok) throw new Error(distributionValidation.issues[0] || '분포 참조가 올바르지 않습니다.');
    dependencies.projectState.state.layerFolders = (0, dependencies.layerTree.normalizeLayerFolderState)(dependencies.projectState.state.layerFolders);
  }

  function normalizeHistoryMetadata(meta = {}) {
    const primary = dependencies.domains.selectionDomain.primary();
    const info = primary ? (0, dependencies.objectOperationsA.objectDisplayInfo)(primary) : null;
    return {
      id: (0, dependencies.surfaces.uid)('history'),
      timestamp: new Date().toISOString(),
      type: String(meta.type || 'edit'),
      description: String(meta.description || (info ? `${info.name} 편집` : '지도 편집')),
      targetName: String(meta.targetName || info?.name || ''),
      affectedIds: [...new Set((meta.affectedIds || (primary ? [primary.id] : [])).map(String))],
    };
  }

  function restoreEditable(snapshot, { mode = 'history' } = {}) {
    const changedCountryIds = new Set(dependencies.projectState.state.historyDirtyCountryIds);
    applySharedProjectFields(snapshot, 'history');
    dependencies.rendering.gpuMapRenderer.invalidateHydroVisibility();
    (0, dependencies.hydroModel.syncPhysicalControls)();
    restoreCountriesFromSnapshot(snapshot);
    normalizeProjectObjects({ history: true });
    const restoredDirtyIds = new Set(dependencies.projectState.state.historyDirtyCountryIds);
    for (const id of dependencies.projectState.state.historyDirtyCountryIds) changedCountryIds.add(String(id));
    (0, dependencies.layerTree.pruneLayerItemVisibility)();
    (0, dependencies.countries.scheduleCountryLabelAnchors)(null, 10);
    (0, dependencies.layers.markLayerTreeDirty)();
    dependencies.domains.selectionDomain.clear({ reason: `${mode}-clear-selection` });
    dependencies.projectState.state.coastEditCountryId = null;
    dependencies.projectState.state.coastEditScopeGenericFeatureId = null;
    dependencies.projectState.state.coastEditReturnSelection = null;
    (0, dependencies.countryEditingB.resetBoundaryEditState)();
    (0, dependencies.countryEditingB.resetMergeState)();
    (0, dependencies.countryEditingB.resetGenericFeatureMergeState)();
    (0, dependencies.countryEditingB.resetTerritorialUnitEditState)();
    dependencies.projectState.state.genericFeatureSplitSourceId = null;
    (0, dependencies.countryEditingB.resetTerritoryEditingState)(true);
    dependencies.projectState.state.tool = 'select';
    dependencies.domainControllers.objectPropertyController.show(null);
    (0, dependencies.platform.$)('selectionStatus').textContent = '';
    dependencies.projectState.state.boundaryPreparation?.cancel();
    dependencies.projectState.state.boundaryPreparation = null;
    dependencies.spatialQuery.mapEditClient?.invalidateBoundaryCache?.();

    (0, dependencies.taskUi.updateModeButtons)();
    if (changedCountryIds.size) (0, dependencies.spatialQuery.markCountryGeometriesChanged)(changedCountryIds);
    dependencies.projectState.state.historyDirtyCountryIds = restoredDirtyIds;
  }

  function initializeHistoryStore() {
    (historyStore = {
      get history() { return dependencies.projectState.state.history; },
      set history(value) { dependencies.projectState.state.history = value; },
      get historyMeta() { return dependencies.projectState.state.historyMeta; },
      set historyMeta(value) { dependencies.projectState.state.historyMeta = value; },
      get future() { return dependencies.projectState.state.future; },
      set future(value) { dependencies.projectState.state.future = value; },
      get futureMeta() { return dependencies.projectState.state.futureMeta; },
      set futureMeta(value) { dependencies.projectState.state.futureMeta = value; },
    });

    (historyService = (0, dependencies.projectServices.createHistoryService)({
      store: historyStore,
      maxEntries: dependencies.platformConfigurationB.MAX_HISTORY,
      snapshot: snapshotEditable,
      restore: restoreEditable,
      normalizeMetadata: normalizeHistoryMetadata,
      onRecord: () => dependencies.projectSession.saveState.markContentChanged(),
      onChange: (...args) => dependencies.lifecycleUi.projectUi.syncHistory(...args),
    }));
  }

  return Object.freeze({
    connect,
    initializeHistoryStore,
    get applySharedProjectFields() { return applySharedProjectFields; },
    get buildCountryDelta() { return buildCountryDelta; },
    get configureDatasetSession() { return configureDatasetSession; },
    get historyService() { return historyService; },
    get historyStore() { return historyStore; },
    get normalizeProjectObjects() { return normalizeProjectObjects; },
    get restoreCountriesFromSnapshot() { return restoreCountriesFromSnapshot; },
    get restoreEditable() { return restoreEditable; },
    get snapshotEditable() { return snapshotEditable; },
  });
}
