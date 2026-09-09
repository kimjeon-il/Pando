/** HistoryAssembly: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createHistoryAssembly() {
  let dependencies;
  let browserProjectStorage;
  let persistenceService;
  let projectCommandSaveStateCheckpoint;
  let projectCommandStateRevision;
  function connect(ports) {
    if (dependencies) throw new Error('history-assembly already connected');
    dependencies = ports;
  }

  function applyAutosavedView(viewRecord) {
    if (!viewRecord || typeof viewRecord !== 'object') return false;
    if (viewRecord.projection === 'globe' || viewRecord.projection === 'flat') dependencies.state.projection = viewRecord.projection;
    if (viewRecord.view && typeof viewRecord.view === 'object') {
      dependencies.state.view = (0, dependencies.clampViewZooms)({ ...dependencies.state.view, ...(0, dependencies.deepClone)(viewRecord.view) });
    }
    return true;
  }

  function validateCanonicalProjectState() {
    (0, dependencies.assertProjectReferenceIntegrity)({
      countries: dependencies.state.countriesData?.features || [],
      countryOverrides: dependencies.state.countryOverrides,
      territorialUnits: dependencies.state.territorialUnits,
      territorialRelations: dependencies.state.territorialRelations,
      distributionLayers: dependencies.state.distributionLayers,
      distributionEntries: dependencies.state.distributionEntries,
      labels: dependencies.state.labels,
      genericFeatures: dependencies.state.genericFeatures,
      itemVisibility: dependencies.state.itemVisibility,
      labelSettings: dependencies.state.labelSettings,
    });
    return true;
  }

  function invalidateProjectCommandRender(descriptor, commandId) {
    const domain = String(descriptor?.domain || '');
    const reason = `project-command:${String(commandId || 'mutation')}`;
    if (domain === 'country') return dependencies.renderingDomain?.invalidateCountryPatch?.(reason);
    if (domain === 'territorial') return dependencies.renderingDomain?.invalidateTerritorialPatch?.(reason);
    if (domain === 'distribution') return dependencies.renderingDomain?.invalidateOverlayGeometry?.('distribution', reason);
    if (domain === 'generic') return dependencies.renderingDomain?.invalidateGenericPatch?.(reason);
    throw new TypeError(`Unknown project command render domain: ${domain || '(empty)'}`);
  }

  function initializeBrowserProjectStorage() {
    (browserProjectStorage = (0, dependencies.createBrowserProjectStorage)({
      indexedDB: window.indexedDB,
      localStorage: window.localStorage,
      databaseName: dependencies.AUTOSAVE_DB_NAME,
      storeName: dependencies.AUTOSAVE_STORE_NAME,
      projectKey: dependencies.AUTOSAVE_RECORD_KEY,
      viewKey: dependencies.AUTOSAVE_VIEW_KEY,
      fallbackKey: dependencies.STORAGE_KEY,
    }));

    (persistenceService = (0, dependencies.createPersistenceService)({
      storage: browserProjectStorage,
      scheduler: dependencies.mapWorkScheduler,
      canPersist: () => (0, dependencies.canMutateProject)(dependencies.state.dataReadiness),
      buildAutosave: () => dependencies.projectDomain?.buildAutosave?.() || dependencies.projectSerializer.buildAutosave(),
      readView: () => ({ projection: dependencies.state.projection, view: (0, dependencies.deepClone)(dependencies.state.view) }),
      validateProject: dependencies.assertCurrentProjectSchema,
      onDirty: scope => {
        if (scope === 'presentation') dependencies.saveState.markPresentationChanged();
        else dependencies.saveState.markDocumentChanged();
      },
      onAutosaveState: (value, options) => dependencies.saveState.setAutosave(value, options),
      onSaved: savedAt => {
        dependencies.state.lastSavedAt = savedAt;
      },
      onFailure: () => (0, dependencies.setActionStatus)('자동저장 실패. 파일로 저장하세요.', 'error', 0),
      onWarning: (...args) => console.warn(...args),
    }));

    (projectCommandSaveStateCheckpoint = null);

    (projectCommandStateRevision = 0);

    dependencies.projectCommandPipeline = (0, dependencies.createProjectCommandPipeline)({
      captureSnapshot: () => {
        projectCommandSaveStateCheckpoint = dependencies.saveState.checkpoint();
        projectCommandStateRevision = dependencies.state.stateRevision;
        return (0, dependencies.snapshotEditable)();
      },
      recordHistory: (meta, snapshot) => dependencies.projectDomain.commitHistorySnapshot(snapshot, meta),
      discardHistory: () => dependencies.projectDomain.discardHistory(),
      restoreSnapshot: snapshot => {
        (0, dependencies.restoreEditable)(snapshot, { mode: 'rollback' });
        dependencies.state.stateRevision = projectCommandStateRevision;
        if (projectCommandSaveStateCheckpoint) dependencies.saveState.restore(projectCommandSaveStateCheckpoint);
      },
      validateProject: validateCanonicalProjectState,
      advanceRevision: () => {
        dependencies.state.stateRevision += 1;
        return dependencies.state.stateRevision;
      },
      invalidateRender: invalidateProjectCommandRender,
      queueAutosave: () => dependencies.projectDomain.queueAutosave(),
      onSuccess: () => {
        projectCommandSaveStateCheckpoint = null;
      },
      onError: () => {
        projectCommandSaveStateCheckpoint = null;
      },
    });

    dependencies.territorialRepository = (0, dependencies.createTerritorialRepository)({
      getCountries: () => dependencies.state.countriesData,
      getUnits: () => dependencies.state.territorialUnits,
      getCountryOverride: id => dependencies.state.countryOverrides[id] || {},
    });

    dependencies.territorialApplicationService = (0, dependencies.createTerritorialApplicationService)({
      repository: dependencies.territorialRepository,
      commandPipeline: dependencies.projectCommandPipeline,
      countryCommands: {
        isLocked: id => (0, dependencies.isCountryLocked)(id),
        setLocked: (id, locked) => (0, dependencies.setCountryLockedState)(id, locked),
        setField: (id, field, value) => {
          dependencies.state.countryOverrides[id] = { ...(dependencies.state.countryOverrides[id] || {}) };
          if (field === 'color') {
            (0, dependencies.writeDomainColor)(dependencies.COLOR_DOMAINS.COUNTRY, {
              feature: (0, dependencies.countryFeatureById)(id), override: dependencies.state.countryOverrides[id],
            }, value, { fallback: (0, dependencies.defaultCountryColor)() });
          } else dependencies.state.countryOverrides[id][field] = value;
        },
      },
      unitCommands: {
        setField: (id, field, value) => {
          const feature = (0, dependencies.territorialUnitById)(id);
          if (!feature) return;
          if (field === 'color') (0, dependencies.setTerritorialStyleColor)(feature, value);
          else feature.properties[field] = value;
        },
        replaceAll: units => {
          dependencies.state.territorialUnits = units;
          dependencies.mapObjectGeometryRevisions.territorial += 1;
        },
      },
    });

    dependencies.distributionService = (0, dependencies.createDistributionService)({
      documentStore: {
        readLayers: () => dependencies.state.distributionLayers,
        replaceLayers: layers => {
          dependencies.state.distributionLayers = layers;
          dependencies.distributionVisibilityRevision += 1;
        },
        readEntries: () => dependencies.state.distributionEntries,
        replaceEntries: entries => {
          dependencies.state.distributionEntries = entries;
          dependencies.distributionVisibilityRevision += 1;
        },
      },
      presentationStore: {
        setRenderMode: mode => {
          dependencies.state.distributionSettings.renderMode = mode;
          dependencies.distributionVisibilityRevision += 1;
        },
        setBoundaryVisible: visible => {
          dependencies.state.distributionSettings.boundaryVisible = visible !== false;
          dependencies.distributionVisibilityRevision += 1;
        },
      },
      commandPipeline: dependencies.projectCommandPipeline,
      writeLayerColor: (layer, color) => (0, dependencies.writeDomainColor)(
        dependencies.COLOR_DOMAINS.DISTRIBUTION,
        { layer },
        color,
        { fallback: dependencies.DEFAULT_GENERIC_FEATURE_COLOR },
      ),
      territorialExists: id => !!dependencies.territorialRepository.get(id),
    });

    dependencies.genericFeatureService = (0, dependencies.createGenericFeatureService)({
      documentStore: {
        readFeatures: () => dependencies.state.genericFeatures,
        replaceFeatures: genericFeatures => { dependencies.state.genericFeatures = genericFeatures; },
      },
      commandPipeline: dependencies.projectCommandPipeline,
      writeColor: (feature, color) => (0, dependencies.writeDomainColor)(
        dependencies.COLOR_DOMAINS.GENERIC,
        { feature },
        color,
        { fallback: (0, dependencies.defaultGenericFeatureColor)(feature) },
      ),
    });
  }

  return Object.freeze({
    connect,
    initializeBrowserProjectStorage,
    get applyAutosavedView() { return applyAutosavedView; },
    get persistenceService() { return persistenceService; },
  });
}
