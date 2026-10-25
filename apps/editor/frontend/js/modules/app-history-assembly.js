/** Device persistence and service installation; C++ owns commands and history. */
export function createHistoryAssembly({ storageNamespace = null, libraryGeometryContext = null } = {}) {
  let dependencies;
  let browserProjectStorage;
  let persistenceService = null;
  let servicesInstalled=false;
  function connect(ports) {
    if (dependencies) throw new Error('history-assembly already connected');
    dependencies=ports;
  }
  function applyAutosavedView(viewRecord) {
    if (!viewRecord || typeof viewRecord!=='object' || viewRecord.documentId!==dependencies.domains.projectDomain.snapshot().documentId) return false;
    dependencies.projectSession.restoreViewingPresentation(viewRecord);
    const view=Object.fromEntries(Object.entries(viewRecord.view || {}).filter(([key,value])=>['flatZoom','globeZoom'].includes(key)?Number.isFinite(value)&&value>0:['flatCenter','globeRotation'].includes(key)&&Array.isArray(value)&&value.length===(key==='flatCenter'?2:3)&&value.every(Number.isFinite)));
    const projection=['globe','flat'].includes(viewRecord.projection)?viewRecord.projection:dependencies.projectState.state.projection;
    const camera=dependencies.projectSession.atomicMapStateController;
    camera.commit(camera.begin({kind:'workspace-restore'}),{projection,view});
    return true;
  }
  async function applyAutosavedTimeline(viewRecord) {
    const month = viewRecord?.lastViewedMonth;
    if (!viewRecord || viewRecord.documentId!==dependencies.domains.projectDomain.snapshot().documentId || typeof month !== 'string' || !month) return false;
    if (dependencies.domains.commandOwner.state()?.timelineCursor === month) return false;
    try {
      return await dependencies.territorialModel.entityStore.setTimelineCursor(month);
    } catch (error) {
      // A stale or invalid view hint must never abort the C++ document load.
      console.warn('Saved map month was ignored', error);
      return false;
    }
  }
  async function queryStoredProject(project,query) {
    const domain=dependencies.domains.projectDomain,expectedGeneration=domain.getGeneration();
    if(domain.getGeneration()!==expectedGeneration)
      throw Object.assign(new Error('Stored project inspection crossed a project replacement.'),{code:'PL-CORE-STALE',name:'AbortError'});
    return query({expectedGeneration});
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
    if (libraryGeometryContext) {
      // The geometry WebView has its own C++ session. All durable writes are
      // explicit library commits; project autosave has no device backing here.
      const noop=()=>{};
      persistenceService=Object.freeze({
        queueProject:noop,queuePresentation:noop,queueView:noop,cancelPending:noop,
        persist:async()=>{},clear:async()=>{},
        restore:async()=>({project:null,source:null,view:null,error:null}),
        restorePreview:async()=>null,ensurePreview:async()=>null,
        getRecovery:()=>null,resolveRecovery:async()=>false,completeRecovery:async()=>{},
      });
      return;
    }
    browserProjectStorage=dependencies.projectServices.createBrowserProjectStorage({
      productMode:'editor',indexedDB: window.indexedDB,localStorage: window.localStorage,databaseName: storageNamespace || dependencies.platformConfigurationA.AUTOSAVE_DB_NAME,
      storeName: dependencies.platformConfigurationA.AUTOSAVE_STORE_NAME,projectKey: dependencies.platformConfigurationA.AUTOSAVE_RECORD_KEY,
      viewKey: dependencies.platformConfigurationA.AUTOSAVE_VIEW_KEY,fallbackKey: storageNamespace ? `${storageNamespace}-project` : dependencies.platformConfigurationB.STORAGE_KEY,
    });
    persistenceService=dependencies.projectServices.createPersistenceService({
      storage: browserProjectStorage,scheduler: dependencies.projectState.mapWorkScheduler,
      canPersist: () => dependencies.readiness.canMutateProject(dependencies.projectState.state.dataReadiness),
      buildAutosave: () => dependencies.domains.projectDomain.buildAutosave(),previewBaseline: () => window.PANDOLAB_PREVIEW_BASELINE,
      previewGeometry: async (savedProject, savedCheckpoint = null) => {
        const domain = dependencies.domains.projectDomain;
        if (savedCheckpoint) {
          const current = domain.state();
          // The persisted receipt must still identify the exact accepted Core
          // state. A later timeline edit can change visible geometry without
          // changing the content checkpoint.
          if (savedCheckpoint.projectGeneration !== domain.getGeneration()
            || savedCheckpoint.epoch !== current.epoch
            || savedCheckpoint.content !== current.checkpoint) return null;
          return { entities: dependencies.territorialModel.entityStore.snapshot(), project: savedProject };
        }
        // Startup callers have no saved receipt; retain the verified export
        // and geometry-key comparison rather than guessing identity.
        const receipt = await domain.buildAutosave();
        if (receipt.checkpoint.epoch !== domain.state().epoch) return null;
        return { entities: dependencies.territorialModel.entityStore.snapshot(), project: receipt.project };
      },
      previewProjection: project=>queryStoredProject(project,async options=>{
        const projection=await dependencies.domains.projectDomain.inspectImport(project,options);
        return {project,territorialViews:projection.territorialViews};
      }),
      readView: () => ({ documentId:dependencies.domains.projectDomain.snapshot().documentId,viewingPresentation:dependencies.projectSession.captureViewingPresentation(),projection: dependencies.projectState.state.projection,
        view: dependencies.platform.deepClone(dependencies.projectState.state.view),
        lastViewedMonth: dependencies.domains.commandOwner.state()?.timelineCursor || null }),
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
  async function restoreViewingForDocument(){
    if (libraryGeometryContext) return false;
    const domain=dependencies.domains.projectDomain,generation=domain.getGeneration(),documentId=domain.snapshot().documentId;
    try{
      const record=await browserProjectStorage.readView(documentId);
      if(generation!==domain.getGeneration()||documentId!==domain.snapshot().documentId)return false;
      return dependencies.projectSession.restoreViewingPresentation(record);
    }catch(error){dependencies.feedback.reportOperationError(error,'보기 설정을 복원하지 못했습니다.','PL-WORKSPACE-READ-001',4200);return false;}
  }
  return Object.freeze({ connect,initializeBrowserProjectStorage,initializeCoreServices,restoreViewingForDocument,
    get applyAutosavedView() { return applyAutosavedView; },
    get applyAutosavedTimeline() { return applyAutosavedTimeline; },
    get persistenceService() { return persistenceService; } });
}
