/** Device persistence and service installation; C++ owns commands and history. */
export function createHistoryAssembly() {
  let dependencies;
  let browserProjectStorage;
  let persistenceService;
  let servicesInstalled=false;
  function connect(ports) {
    if (dependencies) throw new Error('history-assembly already connected');
    dependencies=ports;
  }
  function applyAutosavedView(viewRecord) {
    if (!viewRecord || typeof viewRecord!=='object') return false;
    if (viewRecord.projection==='globe' || viewRecord.projection==='flat') dependencies.projectState.state.projection=viewRecord.projection;
    if (viewRecord.view && typeof viewRecord.view==='object') dependencies.projectState.state.view=dependencies.workspaceUiA.clampViewZooms({
      ...dependencies.projectState.state.view,...dependencies.platform.deepClone(viewRecord.view) });
    return true;
  }
  async function queryStoredProject(project,query) {
    const domain=dependencies.domains.projectDomain,expectedGeneration=domain.getGeneration();
    let baselineId=null;
    if(project.format==='pandolab-autosave-delta') {
      const receipt=await dependencies.builtinBaseline.prepareProjectBaseline();
      baselineId=receipt.baselineId;
      if(!Number.isSafeInteger(baselineId)||baselineId<=0||domain.state().storageBaselineId!==baselineId)
        throw Object.assign(new Error('The stored delta requires its verified C++ source receipt.'),{code:'PL-SCHEMA-BASE'});
    }
    if(domain.getGeneration()!==expectedGeneration)
      throw Object.assign(new Error('Stored project inspection crossed a project replacement.'),{code:'PL-CORE-STALE',name:'AbortError'});
    return query({baselineId,expectedGeneration});
  }
  function initializeCoreServices({ commandOwner,documentModel }) {
    if(servicesInstalled)throw new Error('Core application services are already installed.');
    if(typeof commandOwner?.executeCommand!=='function' || typeof documentModel?.get!=='function')
      throw new TypeError('The accepted read-only document and application C++ command owner are required.');
    dependencies.projectServiceCommands.installTerritorialApplicationService(dependencies.territorialServicesA.createTerritorialApplicationService({
      createId: dependencies.projectServices.createProjectObjectId,entityRepository: dependencies.territorialModel.entityRepository,commandOwner }));
    dependencies.projectServiceCommands.installDistributionService(dependencies.distributionServices.createDistributionService({ documentModel,commandOwner }));
    dependencies.projectServiceCommands.installGenericFeatureService(dependencies.applicationFactories.createGenericFeatureService({ documentModel,commandOwner }));
    servicesInstalled=true;
  }
  function initializeBrowserProjectStorage() {
    browserProjectStorage=dependencies.projectServices.createBrowserProjectStorage({
      indexedDB: window.indexedDB,localStorage: window.localStorage,databaseName: dependencies.platformConfigurationA.AUTOSAVE_DB_NAME,
      storeName: dependencies.platformConfigurationA.AUTOSAVE_STORE_NAME,projectKey: dependencies.platformConfigurationA.AUTOSAVE_RECORD_KEY,
      viewKey: dependencies.platformConfigurationA.AUTOSAVE_VIEW_KEY,fallbackKey: dependencies.platformConfigurationB.STORAGE_KEY,
    });
    persistenceService=dependencies.projectServices.createPersistenceService({
      storage: browserProjectStorage,scheduler: dependencies.projectState.mapWorkScheduler,
      canPersist: () => dependencies.readiness.canMutateProject(dependencies.projectState.state.dataReadiness),
      buildAutosave: () => dependencies.domains.projectDomain.buildAutosave(),previewBaseline: () => window.PANDOLAB_PREVIEW_BASELINE,
      previewGeometry: async () => {
        const receipt=await dependencies.domains.projectDomain.buildAutosave();
        if(receipt.checkpoint.epoch!==dependencies.domains.projectDomain.state().epoch)return null;
        return {entities:dependencies.territorialModel.entityStore.snapshot(),project:receipt.project};
      },
      previewProjection: project=>queryStoredProject(project,async options=>{
        const projection=await dependencies.domains.projectDomain.inspectImport(project,options);
        return {project,territorialViews:projection.territorialViews};
      }),
      readView: () => ({ projection: dependencies.projectState.state.projection,view: dependencies.platform.deepClone(dependencies.projectState.state.view) }),
      validateProject: project => queryStoredProject(project,options=>dependencies.domains.projectDomain.prepareImport(project,options)),
      onDirty: () => dependencies.projectSession.saveState.sync(),
      onAutosaveState: (value,options) => dependencies.projectSession.saveState.setAutosave(value,options),
      onRecoveryState: value => dependencies.projectSession.saveState.setAutosaveRecovery(value!==null),
      onSaved: (savedAt,{ checkpoint }) => {
        const current=dependencies.domains.projectDomain.state();
        if(!checkpoint || dependencies.projectState.state.projectReplacing
          || checkpoint.projectGeneration!==dependencies.domains.projectDomain.getGeneration()
          || checkpoint.content!==current.checkpoint || checkpoint.presentation!==current.presentationCheckpoint)return false;
        dependencies.projectState.state.lastSavedAt=savedAt;return true;
      },
      onFailure: () => dependencies.feedback.setActionStatus('자동저장 실패. 파일로 저장하세요.','error',0),
      onWarning: (...args) => console.warn(...args),
    });
  }
  return Object.freeze({ connect,initializeBrowserProjectStorage,initializeCoreServices,
    get applyAutosavedView() { return applyAutosavedView; },get persistenceService() { return persistenceService; } });
}
