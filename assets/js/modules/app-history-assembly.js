import { prepareProjectForActivation } from './project-state.js';
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
    if (viewRecord.projection === 'globe' || viewRecord.projection === 'flat') dependencies.projectState.state.projection = viewRecord.projection;
    if (viewRecord.view && typeof viewRecord.view === 'object') {
      dependencies.projectState.state.view = (0, dependencies.workspaceUiA.clampViewZooms)({ ...dependencies.projectState.state.view, ...(0, dependencies.platform.deepClone)(viewRecord.view) });
    }
    return true;
  }

  function validateCanonicalProjectState() {
    (0, dependencies.territorialModel.assertProjectReferenceIntegrity)({
      territorialEntities: dependencies.territorialModel.entityStore.snapshot(),
      distributionLayers: dependencies.projectState.state.distributionLayers,
      distributionEntries: dependencies.projectState.state.distributionEntries,
      labels: dependencies.projectState.state.labels,
      genericFeatures: dependencies.projectState.state.genericFeatures,
      itemVisibility: dependencies.projectState.state.itemVisibility,
      labelSettings: dependencies.projectState.state.labelSettings,
    });
    return true;
  }

  function invalidateProjectCommandRender(descriptor, commandId) {
    const domain = String(descriptor?.domain || '');
    const reason = `project-command:${String(commandId || 'mutation')}`;
    if (domain === 'country') return dependencies.domains.renderingDomain?.invalidateCountryPatch?.(reason);
    if (domain === 'territorial') return dependencies.domains.renderingDomain?.invalidateTerritorialPatch?.(reason);
    if (domain === 'distribution') return dependencies.domains.renderingDomain?.invalidateOverlayGeometry?.('distribution', reason);
    if (domain === 'generic') return dependencies.domains.renderingDomain?.invalidateGenericPatch?.(reason);
    throw new TypeError(`Unknown project command render domain: ${domain || '(empty)'}`);
  }

  function initializeBrowserProjectStorage() {
    (browserProjectStorage = (0, dependencies.projectServices.createBrowserProjectStorage)({
      indexedDB: window.indexedDB,
      localStorage: window.localStorage,
      databaseName: dependencies.platformConfigurationA.AUTOSAVE_DB_NAME,
      storeName: dependencies.platformConfigurationA.AUTOSAVE_STORE_NAME,
      projectKey: dependencies.platformConfigurationA.AUTOSAVE_RECORD_KEY,
      viewKey: dependencies.platformConfigurationA.AUTOSAVE_VIEW_KEY,
      fallbackKey: dependencies.platformConfigurationB.STORAGE_KEY,
    }));

    (persistenceService = (0, dependencies.projectServices.createPersistenceService)({
      storage: browserProjectStorage,
      scheduler: dependencies.projectState.mapWorkScheduler,
      canPersist: () => (0, dependencies.readiness.canMutateProject)(dependencies.projectState.state.dataReadiness),
      buildAutosave: () => dependencies.domains.projectDomain?.buildAutosave?.() || dependencies.mapSettingsUi.projectSerializer.buildAutosave(),
      previewBaseline: () => window.PANDOLAB_PREVIEW_BASELINE,
      previewGeometry: () => ({
        entities: dependencies.territorialModel.entityStore.snapshot(),
        project: dependencies.domains.projectDomain?.buildAutosave?.() || dependencies.mapSettingsUi.projectSerializer.buildAutosave(),
      }),
      readView: () => ({ projection: dependencies.projectState.state.projection, view: (0, dependencies.platform.deepClone)(dependencies.projectState.state.view) }),
      validateProject: async project => prepareProjectForActivation(project,
        project.format === 'pandolab-autosave-delta' ? await dependencies.builtinBaseline.prepareProjectBaseline() : {}),
      onDirty: scope => {
        if (scope === 'presentation') dependencies.projectSession.saveState.markPresentationChanged();
        else dependencies.projectSession.saveState.markDocumentChanged();
      },
      onAutosaveState: (value, options) => dependencies.projectSession.saveState.setAutosave(value, options),
      onRecoveryState: value => dependencies.projectSession.saveState.setAutosaveRecovery(value !== null),
      onSaved: savedAt => {
        dependencies.projectState.state.lastSavedAt = savedAt;
      },
      onFailure: () => (0, dependencies.feedback.setActionStatus)('자동저장 실패. 파일로 저장하세요.', 'error', 0),
      onWarning: (...args) => console.warn(...args),
    }));

    (projectCommandSaveStateCheckpoint = null);

    (projectCommandStateRevision = 0);

    dependencies.projectServiceCommands.installCommandPipeline((0, dependencies.projectServices.createProjectCommandPipeline)({
      captureSnapshot: () => {
        projectCommandSaveStateCheckpoint = dependencies.projectSession.saveState.checkpoint();
        projectCommandStateRevision = dependencies.projectState.state.stateRevision;
        return (0, dependencies.snapshots.snapshotEditable)();
      },
      recordHistory: (meta, snapshot) => dependencies.domains.projectDomain.commitHistorySnapshot(snapshot, meta),
      discardHistory: () => dependencies.domains.projectDomain.discardHistory(),
      restoreSnapshot: snapshot => {
        (0, dependencies.projectSnapshots.restoreEditable)(snapshot, { mode: 'rollback' });
        dependencies.projectState.state.stateRevision = projectCommandStateRevision;
        if (projectCommandSaveStateCheckpoint) dependencies.projectSession.saveState.restore(projectCommandSaveStateCheckpoint);
      },
      validateProject: validateCanonicalProjectState,
      advanceRevision: () => {
        dependencies.projectState.state.stateRevision += 1;
        return dependencies.projectState.state.stateRevision;
      },
      invalidateRender: invalidateProjectCommandRender,
      queueAutosave: () => dependencies.domains.projectDomain.queueAutosave(),
      onSuccess: () => {
        projectCommandSaveStateCheckpoint = null;
      },
      onError: () => {
        projectCommandSaveStateCheckpoint = null;
      },
    }));

    dependencies.projectServiceCommands.installTerritorialApplicationService((0, dependencies.territorialServicesA.createTerritorialApplicationService)({
      createId: dependencies.projectServices.createProjectObjectId,
      entityRepository: dependencies.territorialModel.entityRepository,
      entityStore: dependencies.territorialModel.entityStore,
      commandPipeline: dependencies.objectModelB.projectCommandPipeline,
    }));

    dependencies.projectServiceCommands.installDistributionService((0, dependencies.distributionServices.createDistributionService)({
      documentStore: {
        readLayers: () => dependencies.projectState.state.distributionLayers,
        replaceLayers: layers => {
          dependencies.projectState.state.distributionLayers = layers;
          dependencies.distributionPresentation.bumpVisibilityRevision();
        },
        readEntries: () => dependencies.projectState.state.distributionEntries,
        replaceEntries: entries => {
          dependencies.projectState.state.distributionEntries = entries;
          dependencies.distributionPresentation.bumpVisibilityRevision();
        },
      },
      presentationStore: {
        setRenderMode: mode => {
          dependencies.projectState.state.distributionSettings.renderMode = mode;
          dependencies.distributionPresentation.bumpVisibilityRevision();
        },
        setBoundaryVisible: visible => {
          dependencies.projectState.state.distributionSettings.boundaryVisible = visible !== false;
          dependencies.distributionPresentation.bumpVisibilityRevision();
        },
      },
      commandPipeline: dependencies.objectModelB.projectCommandPipeline,
      writeLayerColor: (layer, color) => (0, dependencies.colorModel.writeDomainColor)(
        dependencies.colorModel.COLOR_DOMAINS.DISTRIBUTION,
        { layer },
        color,
        { fallback: dependencies.colorModel.DEFAULT_GENERIC_FEATURE_COLOR },
      ),
      territorialExists: id => !!dependencies.territorialModel.entityRepository.get(id),
    }));

    dependencies.projectServiceCommands.installGenericFeatureService((0, dependencies.applicationFactories.createGenericFeatureService)({
      documentStore: {
        readFeatures: () => dependencies.projectState.state.genericFeatures,
        replaceFeatures: genericFeatures => { dependencies.projectState.state.genericFeatures = genericFeatures; },
      },
      commandPipeline: dependencies.objectModelB.projectCommandPipeline,
      writeColor: (feature, color) => (0, dependencies.colorModel.writeDomainColor)(
        dependencies.colorModel.COLOR_DOMAINS.GENERIC,
        { feature },
        color,
        { fallback: (0, dependencies.objectModelA.defaultGenericFeatureColor)(feature) },
      ),
    }));
  }

  return Object.freeze({
    connect,
    initializeBrowserProjectStorage,
    get applyAutosavedView() { return applyAutosavedView; },
    get persistenceService() { return persistenceService; },
  });
}
