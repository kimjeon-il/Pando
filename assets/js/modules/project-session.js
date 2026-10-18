import { createMapWorkScheduler } from './map-work-scheduler.js';
import { createEmptyTerritorialState } from './territorial-entity-store.js';
import { createInitialDocument } from './initial-document.js';
const readonlyIds=ids => Object.freeze({ get size() { return ids.length; },has: id => ids.includes(id),
  [Symbol.iterator]: () => ids[Symbol.iterator]() });
/** ProjectSession: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createProjectSession({productMode='editor'}={}) {
  if(!['viewer','editor'].includes(productMode))throw new TypeError('Project session requires immutable product mode.');
  const viewingFields=new Set(['layerVisibility','layerPresentation','itemVisibility','physicalSettings','distributionSettings']);
  let viewingPresentation=null,documentProjection=null;
  let dependencies;
  let mapWorkScheduler;
  let DEFAULT_LAYER_VISIBILITY;
  let state;
  let atomicMapStateController;
  let saveState;
  let projectionInstalled=false;
  function connect(ports) {
    if (dependencies) throw new Error('project-session already connected');
    dependencies = ports;
  }

  function normalizeLayerVisibility(value = {}, current = DEFAULT_LAYER_VISIBILITY) {
    const source = value && typeof value === 'object' ? value : {};
    const fallback = current && typeof current === 'object' ? current : DEFAULT_LAYER_VISIBILITY;
    return Object.fromEntries(Object.keys(DEFAULT_LAYER_VISIBILITY).map(key => {
      if (Object.hasOwn(source, key)) return [key, source[key] !== false];
      return [key, fallback[key] !== false];
    }));
  }

  function initializeMapWorkScheduler() {
    mapWorkScheduler=createMapWorkScheduler();

    (DEFAULT_LAYER_VISIBILITY = Object.freeze({
      countries: true,
      subunits: true,
      regions: true,
      distributions: true,
      rivers: true,
      lakes: true,
      genericFeatures: true,
      labels: true,
      basemapLabels: true,
      countryFlags: true,
      subunitLabels: true,
      subunitFlags: true,
      regionLabels: true,
      regionFlags: true,
    }));

    (state = {
      dataReadiness: dependencies.readiness.DATA_READINESS.PREVIEW,
      geometryProgress: 0,
      meshProgress: 0,
      ...createEmptyTerritorialState(),
      auditPreviewCountries: null,
      countryVisualPhase: 'preview',
      auditPreviewTerritorialUnits: null,
      auditPreviewGeometryReferences: null,
      countryIndex: new Map(),
      sourceInfo: null,
      labels: [],
      labelSettings: {},
      genericFeatures: [],
      hydroEdits: [],
      distributionLayers: [],
      distributionEntries: [],
      distributionSettings: { renderMode: dependencies.applicationConstantsA.DISTRIBUTION_RENDER_MODES.OVERLAP, activeLayerId: '', boundaryVisible: true },
      layerPresentation: (0, dependencies.modelValidation.normalizeLayerPresentation)(),
      // SelectionDomain owns selection. Before domain initialization it is empty.
      get selected() { return dependencies.domains.selectionDomain?.primary() || null; },
      projection: 'globe',
      layerVisibility: normalizeLayerVisibility(),
      physicalSettings: {
        terrainVisible: true,
        terrainStyle: 'physical',
        terrainStyleVersion: 1,
        hydroLayers: {
          rivers_hydro: true,
          lakes_natural_earth: true,
        },
        hiddenHydroIds: {},
        dataset: dependencies.physicalConfig.PHYSICAL_DATASET,
      },
      hydroCollections: {},
      hydroFeatureCache: new Map(),
      hydroFeatureByFid: new Map(),
      hydroFragmentsByLogicalId: new Map(),
      hydroManifest: null,
      terrainManifest: null,
      physicalLoadState: { terrain: 'idle', hydro: 'idle', hydroCache: 'idle', hydroCachePercent: 0 },
      itemVisibility: {
        countries: {},
        subunits: {},
        regions: {},
        distributions: {},
        hydro: {},
        genericFeatures: {},
        labels: {},
        countryLabels: {},
      },
      layerFolders: {
        polities: false,
        landforms: false,
      },
      objectSearch: '',
      tool: 'select',
      labelPlacementMode: false,
      coastEditCountryId: null,
      coastEditScopeGenericFeatureId: null,
      coastEditReturnSelection: null,
      boundaryEditEntityIds: [],
      boundaryEditPhase: null,
      boundaryEditInitialSelection: null,
      boundaryEditSeedEntityId: null,
      mergeSourceCountryId: null,
      mergeTargetCountryIds: [],
      genericFeatureMergeSourceId: null,
      genericFeatureMergeTargetIds: [],
      genericFeatureSplitSourceId: null,
      distributionDraft: null,
      territorialUnitMergeSourceId: null,
      territorialUnitMergeTargetIds: [],
      territorialUnitSplitSourceId: null,
      territorialUnitSplitVirtualSource: null,
      territorialUnitRedrawSourceId: null,
      // One non-persistent selection workflow is shared by annexation and all
      // polity creation tools. Only the final operation result is persisted.
      territorySelectionSession: null,
      // Ephemeral composition state for a single user-created object.  It is
      // deliberately outside the project document: only the final geometry is
      // persisted, and cancelling a tool must leave no partial object behind.
      multiDraft: null,
      boundaryPreparation: null,
      spatialIndex: [],
      mapMoving: false,
      historyDirtyEntityIds: readonlyIds(Object.freeze([])),
      pendingCountryRenderIds: new Set(),
      autosaveMode: 'delta',
      geometryPreview: productMode==='editor'?(0, dependencies.applicationFactories.createGeometryPreviewState)():null,
      modeProcessing: false,
      modeTaskMinimized: false,
      audit: { status: 'idle', revision: 0, report: null, selectedIssueId: null },
      stateRevision: 0,
      transitionRevision: 0,
      spacePanActive: false,
      suppressNextMapClick: null,
      lastSavedAt: null,
      view: {
        globeRotation: [-15, -25, 0],
        globeZoom: 1,
        flatCenter: [0, 20],
        flatZoom: 1,
      },
      size: { width: 1000, height: 700 },
      objectPresentationRevision: 1,
    });

    (atomicMapStateController = (0, dependencies.uiFactoriesA.createAtomicMapStateController)({
      applySnapshot: snapshot => {
        if (snapshot.projection) state.projection = snapshot.projection;
        if (snapshot.view) state.view = (0, dependencies.workspaceUiA.clampViewZooms)({ ...state.view, ...snapshot.view });
        state.transitionRevision = Number(snapshot.stateRevision || state.transitionRevision || 0);
      },
    }));

    if(productMode==='editor')(saveState = (0, dependencies.uiFactoriesB.createSaveStateController)({
      getDocumentState: () => dependencies.domains.commandOwner?.state() ?? null,
      onChange: (...args) => dependencies.lifecycleUi.projectUi.syncSaveStatus(...args) }));

  }

  function setViewingPresentation(patch={}, {reset=false}={}){
    if(productMode!=='viewer')throw new Error('Viewing presentation overrides are not registered in the editor.');
    if(!documentProjection)throw new Error('The accepted document projection is required.');
    for(const field of Object.keys(patch))if(!viewingFields.has(field))throw new TypeError(`Unknown viewing state: ${field}`);
    if(reset||!viewingPresentation)viewingPresentation=Object.fromEntries([...viewingFields].map(field=>[field,structuredClone(documentProjection.snapshot()[field])]));
    for(const [field,value] of Object.entries(patch))viewingPresentation[field]=structuredClone(value);
    viewingPresentation.layerVisibility=normalizeLayerVisibility(viewingPresentation.layerVisibility);
    return viewingPresentation;
  }
  const captureViewingPresentation=()=>structuredClone(viewingPresentation);

  // A detached, empty startup input. C++ validates and owns it before any
  // preview/canonical source or editable UI is admitted.
  function initialDocument() {
    return createInitialDocument({ appVersion: dependencies.platformConfigurationA.APP_VERSION,
      baseDataset: dependencies.platformConfigurationA.BASE_DATASET, state,
    });
  }

  function installDocumentProjection({ documentModel,commandOwner,entityStore }) {
    if (projectionInstalled) throw new Error('The accepted C++ document projection is already installed.');
    if (typeof documentModel?.snapshot!=='function' || typeof documentModel.geometry!=='function'
      || typeof commandOwner?.state!=='function' || typeof entityStore?.snapshot!=='function')
      throw new TypeError('The canonical C++ document and its read-only territorial projection are required.');
    const coreState=() => {
      const value=commandOwner.state();
      if (!value) throw Object.assign(new Error('The C++ document owner is unavailable.'),{ code: 'PL-CORE-NOT-LOADED' });
      return value;
    };
    const geometries=Object.freeze({ get: documentModel.geometry,snapshot: () => documentModel.snapshot().geometries });
    let dirtyIdsSource,dirtyIdsProjection;
    const historyDirtyEntityIds=() => {
      const ids=coreState().dirtyTerritorialIds;
      if(!Array.isArray(ids))throw new TypeError('The ordered canonical C++ territorial dirty IDs are required.');
      if(ids!==dirtyIdsSource) { dirtyIdsSource=ids;dirtyIdsProjection=readonlyIds(ids); }
      return dirtyIdsProjection;
    };
    documentProjection=documentModel;
    if(productMode==='viewer')setViewingPresentation({}, {reset:true});
    const properties=Object.fromEntries(['sourceInfo','labels','labelSettings','genericFeatures','hydroEdits','distributionLayers',
      'distributionEntries','distributionSettings','physicalSettings','layerVisibility','itemVisibility','layerPresentation','timelineRecords']
      .map(name => [name,{ enumerable: true,get: () => productMode==='viewer'&&viewingFields.has(name)?viewingPresentation[name]:documentModel.snapshot()[name] }]));
    Object.assign(properties,{ territorialEntities: { enumerable: true,get: entityStore.snapshot },geometries: { enumerable: true,get: () => geometries },
      stateRevision: { enumerable: true,get: () => coreState().stateRevision },timelineCursor: { enumerable: true,get: () => coreState().timelineCursor },
      historyDirtyEntityIds: { enumerable: true,get: historyDirtyEntityIds } });
    Object.defineProperties(state,properties);
    projectionInstalled=true;
  }

  return Object.freeze({
    connect,
    initializeMapWorkScheduler,
    initialDocument,
    installDocumentProjection,
    ...(productMode==='viewer'?{setViewingPresentation,captureViewingPresentation}:{}),
    get atomicMapStateController() { return atomicMapStateController; },
    get mapWorkScheduler() { return mapWorkScheduler; },
    get normalizeLayerVisibility() { return normalizeLayerVisibility; },
    get saveState() { return saveState; },
    get state() { return state; },
  });
}
