/** ProjectSnapshots: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createProjectSnapshots() {
  let dependencies;
  let historyStore;
  let historyService;
  function connect(ports) {
    if (dependencies) throw new Error('project-snapshots already connected');
    dependencies = ports;
  }

  function configureDatasetSession(project = null) {
    const deltaProject = project?.format === 'pandolab-autosave-delta';
    const pristineCompatible = !project?.countriesData || project.baseDataset === dependencies.BASE_DATASET || deltaProject;
    dependencies.state.sessionBaseCountriesJson = pristineCompatible
      ? null
      : JSON.stringify(dependencies.state.countriesData || { type: 'FeatureCollection', features: [] });
    dependencies.state.historyDirtyCountryIds = new Set();
    // The pristine geometry store stays at 258 source features. Persist these
    // removals in delta/history snapshots so old sources cannot resurrect them.
    for (const unit of dependencies.state.territorialUnits) {
      const sourceId = (0, dependencies.builtinSubunitSourceId)(unit);
      if (sourceId && !(0, dependencies.countryFeatureById)(sourceId)) dependencies.state.historyDirtyCountryIds.add(sourceId);
    }
    if (!project) for (const policy of dependencies.BUILTIN_TERRITORY_MERGES) {
      if (!(0, dependencies.countryFeatureById)(policy.sourceId) && (0, dependencies.countryFeatureById)(policy.controller)) {
        dependencies.state.historyDirtyCountryIds.add(policy.sourceId);
        dependencies.state.historyDirtyCountryIds.add(policy.controller);
      }
    }
    if (deltaProject) {
      const delta = project.countryDelta || { changed: [], removedIds: [] };
      dependencies.state.historyDirtyCountryIds = new Set([
        ...(delta.changed || []).map(feature => String(feature.id || '')),
        ...(delta.removedIds || []).map(String),
      ].filter(Boolean));
      return;
    }
    if (project?.countriesData && pristineCompatible) {
      const currentIds = new Set();
      for (const feature of dependencies.state.countriesData?.features || []) {
        const id = String(feature.id || '');
        currentIds.add(id);
        if (dependencies.canonicalCountryStore) {
          if (!dependencies.canonicalCountryStore.getFingerprint(id)
              || !dependencies.canonicalCountryStore.geometryEquals(id, feature.geometry)) dependencies.state.historyDirtyCountryIds.add(id);
        } else {
          const pristine = (dependencies.pristineCountriesFallback?.features || []).find(candidate => String(candidate.id || '') === id);
          if (!pristine || JSON.stringify(pristine.geometry) !== JSON.stringify(feature.geometry)) dependencies.state.historyDirtyCountryIds.add(id);
        }
      }
      const pristineIds = dependencies.canonicalCountryStore?.ids?.()
        || (dependencies.pristineCountriesFallback?.features || []).map(feature => String(feature.id || ''));
      for (const id of pristineIds) if (!currentIds.has(String(id))) dependencies.state.historyDirtyCountryIds.add(String(id));
    }
  }

  function buildCountryDelta() {
    const current = new Map((dependencies.state.countriesData?.features || []).map(feature => [String(feature.id || ''), feature]));
    const changed = [];
    const removedIds = [];
    for (const id of dependencies.state.historyDirtyCountryIds) {
      const feature = current.get(String(id));
      if (feature) changed.push((0, dependencies.deepClone)(feature));
      else removedIds.push(String(id));
    }
    return { changed, removedIds };
  }

  function restoreCountriesFromSnapshot(snapshot) {
    if (snapshot.countriesData) {
      dependencies.state.countriesData = (0, dependencies.reindexCountries)((0, dependencies.deepClone)(snapshot.countriesData), true);
      dependencies.state.historyDirtyCountryIds = new Set();
      return;
    }
    const delta = snapshot.countryDelta || { changed: [], removedIds: [] };
    const changed = new Map((delta.changed || []).map(feature => [String(feature.id || ''), feature]));
    const removed = new Set((delta.removedIds || []).map(String));
    const seen = new Set();
    let base;
    if (dependencies.state.sessionBaseCountriesJson) {
      base = JSON.parse(dependencies.state.sessionBaseCountriesJson);
      base.features = (base.features || []).filter(feature => !removed.has(String(feature.id || ''))).map(feature => {
        const id = String(feature.id || '');
        if (!changed.has(id)) return feature;
        seen.add(id);
        return (0, dependencies.deepClone)(changed.get(id));
      });
    } else if (dependencies.canonicalCountryStore) {
      const currentById = new Map((dependencies.state.countriesData?.features || []).map(feature => [String(feature.id || ''), feature]));
      base = { type: 'FeatureCollection', features: [] };
      for (const id of dependencies.canonicalCountryStore.ids()) {
        if (removed.has(id)) continue;
        if (changed.has(id)) {
          seen.add(id);
          base.features.push((0, dependencies.deepClone)(changed.get(id)));
          continue;
        }
        const current = currentById.get(id);
        base.features.push(current && dependencies.canonicalCountryStore.geometryEquals(id, current.geometry)
          ? current
          : dependencies.canonicalCountryStore.materializeFeature(id));
      }
    } else {
      base = (0, dependencies.materializePristineCountriesSync)();
      base.features = (base.features || []).filter(feature => !removed.has(String(feature.id || ''))).map(feature => {
        const id = String(feature.id || '');
        if (!changed.has(id)) return feature;
        seen.add(id);
        return (0, dependencies.deepClone)(changed.get(id));
      });
    }
    for (const [id, feature] of changed) if (!seen.has(id)) base.features.push((0, dependencies.deepClone)(feature));
    dependencies.state.countriesData = (0, dependencies.reindexCountries)(base, true);
    const unchangedIds = (dependencies.state.countriesData.features || []).map(feature => String(feature.id || '')).filter(id => !changed.has(id));
    if (!dependencies.state.sessionBaseCountriesJson) (0, dependencies.applyPristineLabelAnchors)(dependencies.state.countriesData, unchangedIds);
    dependencies.state.historyDirtyCountryIds = new Set(snapshot.historyDirtyCountryIds || [...changed.keys(), ...removed]);
  }

  function snapshotEditable() {
    return {
      countryDelta: buildCountryDelta(),
      historyDirtyCountryIds: [...dependencies.state.historyDirtyCountryIds],
      ...(0, dependencies.pickProjectFields)(dependencies.state, { scope: 'history', clone: dependencies.deepClone }),
    };
  }

  function applySharedProjectFields(source, scope = 'project') {
    return (0, dependencies.applyProjectFields)(dependencies.state, source, {
      scope,
      clone: dependencies.deepClone,
      normalizers: {
        labelSettings: value => (0, dependencies.deepClone)(value || {}),
        genericFeatures: value => (0, dependencies.deepClone)(value || []),
        hydroEdits: value => (0, dependencies.deepClone)(value || []),
        territorialUnits: value => (0, dependencies.deepClone)(value || []),
        territorialRelations: value => (0, dependencies.deepClone)(value || []),
        distributionLayers: value => (0, dependencies.deepClone)(value || []),
        distributionEntries: value => (0, dependencies.deepClone)(value || []),
        distributionSettings: value => ({
          renderMode: value?.renderMode === dependencies.DISTRIBUTION_RENDER_MODES.INTENSITY ? dependencies.DISTRIBUTION_RENDER_MODES.INTENSITY : dependencies.DISTRIBUTION_RENDER_MODES.DOMINANT,
          boundaryVisible: value?.boundaryVisible !== false,
        }),
        physicalSettings: (value, current) => (0, dependencies.normalizePhysicalSettings)(value || current),
        layerVisibility: (value, current) => (0, dependencies.normalizeLayerVisibility)(value, current),
        itemVisibility: value => (0, dependencies.normalizeLayerItemState)(value),
        layerPresentation: value => (0, dependencies.normalizeLayerPresentation)(value),
      },
    });
  }

  function normalizeProjectObjects() {
    const countryIds = new Set((dependencies.state.countriesData?.features || []).map(feature => String(feature?.id || '')).filter(Boolean));
    dependencies.state.countryOverrides = (0, dependencies.pruneCountryOverrides)(dependencies.state.countryOverrides, countryIds);
    dependencies.state.hydroEdits = (0, dependencies.normalizeHydroEditCollection)(dependencies.state.hydroEdits);
    dependencies.state.genericFeatures = (0, dependencies.normalizeGenericFeatureCollection)(dependencies.state.genericFeatures || []);
    dependencies.state.distributionLayers = (0, dependencies.normalizeDistributionLayers)(dependencies.state.distributionLayers);
    const distributionLayerIds = new Set(dependencies.state.distributionLayers.map(layer => layer.id));
    dependencies.state.distributionEntries = (0, dependencies.normalizeDistributionEntries)(dependencies.state.distributionEntries, {
      layerExists: id => distributionLayerIds.has(id),
    });
    dependencies.state.distributionSettings = {
      renderMode: dependencies.state.distributionSettings?.renderMode === dependencies.DISTRIBUTION_RENDER_MODES.INTENSITY ? dependencies.DISTRIBUTION_RENDER_MODES.INTENSITY : dependencies.DISTRIBUTION_RENDER_MODES.DOMINANT,
      boundaryVisible: dependencies.state.distributionSettings?.boundaryVisible !== false,
    };
    dependencies.state.selectedDistributionLayerId = distributionLayerIds.has(String(dependencies.state.selectedDistributionLayerId || ''))
      ? String(dependencies.state.selectedDistributionLayerId)
      : '';
    dependencies.state.territorialUnits = (0, dependencies.normalizeTerritorialUnits)(dependencies.state.territorialUnits, {
      countryExists: id => !!(0, dependencies.countryFeatureById)(id),
    });
    dependencies.state.territorialRelations = (0, dependencies.normalizeTerritorialRelations)(dependencies.state.territorialRelations);
    const relationValidation = dependencies.territorialApplicationService.validateRelations(dependencies.state.territorialUnits, {
      countryExists: id => !!(0, dependencies.countryFeatureById)(id),
      relations: dependencies.state.territorialRelations,
    });
    if (!relationValidation.ok) throw new Error(relationValidation.issues[0] || '영역 관계가 올바르지 않습니다.');
    const distributionValidation = (0, dependencies.validateDistributionModel)(dependencies.state.distributionLayers, dependencies.state.distributionEntries, {
      territorialExists: id => !!dependencies.territorialRepository.get(id),
    });
    if (!distributionValidation.ok) throw new Error(distributionValidation.issues[0] || '분포 참조가 올바르지 않습니다.');
    dependencies.state.layerFolders = (0, dependencies.normalizeLayerFolderState)(dependencies.state.layerFolders);
  }

  function normalizeHistoryMetadata(meta = {}) {
    const primary = dependencies.selectionDomain.primary();
    const info = primary ? (0, dependencies.objectDisplayInfo)(primary) : null;
    return {
      id: (0, dependencies.uid)('history'),
      timestamp: new Date().toISOString(),
      type: String(meta.type || 'edit'),
      description: String(meta.description || (info ? `${info.name} 편집` : '지도 편집')),
      targetName: String(meta.targetName || info?.name || ''),
      affectedIds: [...new Set((meta.affectedIds || (primary ? [primary.id] : [])).map(String))],
    };
  }

  function restoreEditable(snapshot, { mode = 'history' } = {}) {
    const changedCountryIds = new Set(dependencies.state.historyDirtyCountryIds);
    applySharedProjectFields(snapshot, 'history');
    dependencies.gpuMapRenderer.invalidateHydroVisibility();
    (0, dependencies.syncPhysicalControls)();
    restoreCountriesFromSnapshot(snapshot);
    normalizeProjectObjects();
    const restoredDirtyIds = new Set(dependencies.state.historyDirtyCountryIds);
    for (const id of dependencies.state.historyDirtyCountryIds) changedCountryIds.add(String(id));
    (0, dependencies.pruneLayerItemVisibility)();
    (0, dependencies.scheduleCountryLabelAnchors)(null, 10);
    (0, dependencies.markLayerTreeDirty)();
    dependencies.selectionDomain.clear({ reason: `${mode}-clear-selection` });
    dependencies.state.coastEditCountryId = null;
    dependencies.state.coastEditScopeGenericFeatureId = null;
    dependencies.state.coastEditReturnSelection = null;
    (0, dependencies.resetBoundaryEditState)();
    (0, dependencies.resetMergeState)();
    (0, dependencies.resetGenericFeatureMergeState)();
    (0, dependencies.resetTerritorialUnitEditState)();
    dependencies.state.genericFeatureSplitSourceId = null;
    (0, dependencies.resetTerritoryEditingState)(true);
    dependencies.state.tool = 'select';
    dependencies.objectPropertyController.show(null);
    (0, dependencies.$)('selectionStatus').textContent = '';
    dependencies.state.boundaryTopology = { edges: new Map(), nodes: new Map() };
    dependencies.state.sharedBoundaryTopology = { segments: new Map(), nodes: new Map() };
    (0, dependencies.updateModeButtons)();
    if (changedCountryIds.size) (0, dependencies.markCountryGeometriesChanged)(changedCountryIds);
    dependencies.state.historyDirtyCountryIds = restoredDirtyIds;
  }

  function initializeHistoryStore() {
    (historyStore = {
      get history() { return dependencies.state.history; },
      set history(value) { dependencies.state.history = value; },
      get historyMeta() { return dependencies.state.historyMeta; },
      set historyMeta(value) { dependencies.state.historyMeta = value; },
      get future() { return dependencies.state.future; },
      set future(value) { dependencies.state.future = value; },
      get futureMeta() { return dependencies.state.futureMeta; },
      set futureMeta(value) { dependencies.state.futureMeta = value; },
    });

    (historyService = (0, dependencies.createHistoryService)({
      store: historyStore,
      maxEntries: dependencies.MAX_HISTORY,
      snapshot: snapshotEditable,
      restore: restoreEditable,
      normalizeMetadata: normalizeHistoryMetadata,
      onRecord: () => dependencies.saveState.markContentChanged(),
      onChange: (...args) => dependencies.projectUi.syncHistory(...args),
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
