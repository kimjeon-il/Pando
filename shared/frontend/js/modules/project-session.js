import {coreSelectionRefToWeb} from './core-object-ref.js';
import {loadUserPreferences} from './user-preferences.js';
import { createMapWorkScheduler } from './map-work-scheduler.js';
import { createEmptyTerritorialState } from './territorial-entity-store.js';
import { createInitialDocument } from './initial-document.js';
import { resourceCapabilities } from './resource-capabilities.js';
import { createProductModePolicy } from './product-mode-policy.js';
const readonlyIds=ids => Object.freeze({ get size() { return ids.length; },has: id => ids.includes(id),
  [Symbol.iterator]: () => ids[Symbol.iterator]() });
/** ProjectSession: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createProjectSession({productMode='editor',capabilities=resourceCapabilities(productMode),resolveVisibilityGroup,onViewingChange=null}={}) {
  if(!['viewer','editor'].includes(productMode))throw new TypeError('Project session requires immutable product mode.');
  const productPolicy=createProductModePolicy(productMode);
  const viewingFields=new Set(['layerVisibility','layerPresentation','itemVisibility','physicalSettings','distributionSettings']);
  let viewingPresentation=null,documentProjection=null,physicalSettings;
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
      objects: true,
      distributions: true,
      rivers: true,
      lakes: true,
      genericFeatures: true,
      labels: true,
      objectNames: true,
      objectFlags: true,
    }));

    const background=loadUserPreferences().backgrounds[productMode];
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
      projection: productPolicy.projection,
      resourceCapabilities:capabilities,
      backgroundSettings:{...background},
      layerVisibility: normalizeLayerVisibility(),
      physicalSettings: {
        terrainVisible: capabilities.terrain && background.terrainVisible,
        terrainStyle: productMode==='viewer'?background.terrainStyle:'physical',
        terrainStyleVersion: 1,
        hydroLayers: {
          rivers_hydro: true,
          lakes_natural_earth: true,
        },
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
        objects: {},
        distributions: {},
        hydro: {},
        genericFeatures: {},
        labels: {},
        objectLabels: {},
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
        const projection = snapshot.projection || state.projection;
        const view = { ...state.view, ...snapshot.view };
        state.view = projection !== productPolicy.projection
          ? dependencies.mapNavigation.reprojectView(view, projection, productPolicy.projection)
          : dependencies.mapNavigation.clampViewZooms(view);
        state.projection = productPolicy.projection;
        state.transitionRevision = Number(snapshot.stateRevision || state.transitionRevision || 0);
      },
    }));

    if(productMode==='editor')(saveState = (0, dependencies.uiFactoriesB.createSaveStateController)({
      getDocumentState: () => dependencies.domains.commandOwner?.state() ?? null,
      onChange: (...args) => dependencies.lifecycleUi.projectUi.syncSaveStatus(...args) }));

  }

  function setViewingPresentation(patch={}, {reset=false}={}){
    if(!documentProjection)throw new Error('The accepted document projection is required.');
    for(const field of Object.keys(patch))if(!viewingFields.has(field))throw new TypeError(`Unknown viewing state: ${field}`);
    if(patch.physicalSettings)physicalSettings=structuredClone(patch.physicalSettings);
    if(reset||!viewingPresentation)viewingPresentation={layerVisibility:{...DEFAULT_LAYER_VISIBILITY},
      itemVisibility:Object.fromEntries(['objects','distributions','hydro','genericFeatures','labels','objectLabels'].map(group=>[group,{}])),
      distributionSettings:structuredClone(documentProjection.snapshot().distributionSettings),
      physicalSettings:structuredClone(physicalSettings),layerPresentation:structuredClone(documentProjection.snapshot().layerPresentation)};
    for(const [field,value] of Object.entries(patch))viewingPresentation[field]=structuredClone(value);
    viewingPresentation.layerVisibility=normalizeLayerVisibility(viewingPresentation.layerVisibility);
    return viewingPresentation;
  }
  function restoreViewingPresentation(viewRecord){
    if(!viewRecord||viewRecord.documentId!==documentProjection.snapshot().documentId)return false;
    const stored=viewRecord.viewingPresentation;
    if(stored&&typeof stored==='object') {
      const patch={};
      if(stored.layerVisibility&&typeof stored.layerVisibility==='object')patch.layerVisibility={...state.layerVisibility,...Object.fromEntries(Object.entries(stored.layerVisibility).filter(([key,value])=>Object.hasOwn(state.layerVisibility,key)&&typeof value==='boolean'))};
      if(stored.itemVisibility&&typeof stored.itemVisibility==='object')patch.itemVisibility=Object.fromEntries(Object.keys(state.itemVisibility).map(group=>[group,Object.fromEntries(Object.entries(stored.itemVisibility[group]||{}).filter(([,value])=>typeof value==='boolean'))]));
      if(stored.distributionSettings&&typeof stored.distributionSettings==='object') {
        const value=stored.distributionSettings;patch.distributionSettings={...state.distributionSettings};
        if(['single','overlap'].includes(value.renderMode))patch.distributionSettings.renderMode=value.renderMode;
        if(typeof value.boundaryVisible==='boolean')patch.distributionSettings.boundaryVisible=value.boundaryVisible;
        if(value.activeLayerId===''||state.distributionLayers.some(layer=>layer.id===value.activeLayerId))patch.distributionSettings.activeLayerId=value.activeLayerId;
      }
      if(productMode==='viewer'&&stored.layerPresentation)patch.layerPresentation=dependencies.modelValidation.normalizeLayerPresentation(stored.layerPresentation);
      setViewingPresentation(patch);
    }
    return true;
  }
  function pruneViewingItems({countryLabelIds}){
    const project=documentProjection.snapshot(),ids=rows=>new Set(rows.map(row=>String(row.id)));
    const territorial=ids(project.territorialEntities),valid={objects:territorial,objectLabels:new Set([...territorial,...countryLabelIds]),
      distributions:ids(project.distributionLayers),genericFeatures:ids(project.genericFeatures)};
    // Places and hydro also contain lazy builtin identities. The document and
    // currently hydrated resource catalogs cannot prove those IDs obsolete.
    setViewingPresentation({itemVisibility:Object.fromEntries(Object.entries(viewingPresentation.itemVisibility)
      .map(([group,values])=>[group,Object.fromEntries(Object.entries(values).filter(([id])=>!valid[group]||valid[group].has(id)))]))});
  }
  function applyViewingPresentation(payload) {
    if (payload.action === 'visibility') setViewingPresentation({ layerVisibility: { ...state.layerVisibility, [payload.key]: payload.visible } });
    else if(payload.action==='objectVisibility'||payload.action==='distributionLayerVisibility') {
      const refs=payload.action==='distributionLayerVisibility'?[{group:'distributions',id:payload.id}]:payload.refs.map(ref=>{
        const web=coreSelectionRefToWeb(ref);return {group:resolveVisibilityGroup(web),id:web.id};});
      if(!refs.length||refs.some(ref=>!ref.group))throw new TypeError('Known visibility references are required.');
      const visible=typeof payload.visible==='boolean'?payload.visible:!refs.every(ref=>state.itemVisibility[ref.group]?.[ref.id]!==false);
      // Repeating the same explicit visibility is not a state mutation.
      if(!refs.some(ref=>(state.itemVisibility[ref.group]?.[ref.id]!==false)!==visible))
        return {ok:true,changed:false};
      const items=structuredClone(viewingPresentation.itemVisibility);
      for(const ref of refs){items[ref.group]||={};if(visible)delete items[ref.group][ref.id];else items[ref.group][ref.id]=false;}
      setViewingPresentation({itemVisibility:items});
    }
    else if (payload.action === 'groupStyle') setViewingPresentation({ layerPresentation: dependencies.modelValidation.normalizeLayerPresentation({
      ...state.layerPresentation, styles: { ...state.layerPresentation.styles, [payload.group]: { ...state.layerPresentation.styles[payload.group], ...payload.patch } } }) });
    else if (payload.action === 'terrainMode') {if(!capabilities.terrain)throw new Error('지형 배경은 앱에서 지원하지 않습니다.');setViewingPresentation({ physicalSettings: payload.physicalSettings });}
    else {
      const key = { distributionRenderMode: 'renderMode', distributionActiveLayer: 'activeLayerId', distributionBoundaryVisible: 'boundaryVisible' }[payload.action];
      if (!key) throw new TypeError(`Unknown viewing action: ${payload.action}`);
      setViewingPresentation({ distributionSettings: { ...state.distributionSettings, [key]: payload.value } });
    }
    if(onViewingChange)onViewingChange();
    return { ok: true, changed: true };
  }
  const captureViewingPresentation=()=>structuredClone(Object.fromEntries(Object.entries(viewingPresentation || {}).filter(([key])=>key!=='physicalSettings'&&(productMode==='viewer'||key!=='layerPresentation'))));

  // A detached, empty startup input. C++ validates and owns it before any
  // preview/canonical source or editable UI is admitted.
  function initialDocument() {
    return createInitialDocument({ appVersion: dependencies.platformConfigurationA.APP_VERSION,
      baseDataset: dependencies.platformConfigurationA.BASE_DATASET, state,
    });
  }

  function captureReplacement() {
    const capturedPresentation=structuredClone(viewingPresentation);
    const saved=Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(state)).filter(([,descriptor])=>descriptor.writable).map(([key,{value}])=>[key,value instanceof Map?new Map(value):value instanceof Set?new Set(value):Array.isArray(value)?value.slice():value&&Object.getPrototypeOf(value)===Object.prototype?{...value}:value]));
    return ()=>{viewingPresentation=capturedPresentation;for(const [key,value] of Object.entries(saved))state[key]=value;state.projectReplacing=true;
      // Prepared candidates have been released by Core replacement. Keep their inputs and recalculate.
      if(state.geometryPreview?.session)state.geometryPreview={...state.geometryPreview,session:null};
      if(state.territorySelectionSession?.stage==='review')state.territorySelectionSession={...state.territorySelectionSession,stage:'selection',previewPending:false,prepared:null};
    };
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
    documentProjection=documentModel;physicalSettings=structuredClone(state.physicalSettings);
    setViewingPresentation({}, {reset:true});
    // Source replacement follows authored hydro edits, independent of temporary visibility.
    const effectiveItemVisibility=()=>{
      const replaced=documentModel.list('hydro').map(feature=>feature.properties.sourceFeatureId).filter(Boolean);
      return replaced.length?{...viewingPresentation.itemVisibility,hydro:{...viewingPresentation.itemVisibility.hydro,...Object.fromEntries(replaced.map(id=>[id,false]))}}:viewingPresentation.itemVisibility;
    };
    const properties=Object.fromEntries(['documentId','projectSetup','sourceInfo','labels','labelSettings','genericFeatures','hydroEdits','distributionLayers',
      'distributionEntries','distributionSettings','physicalSettings','layerVisibility','itemVisibility','layerPresentation','timelineRecords']
      .map(name => [name,{ enumerable: true,get: () => name==='hydroEdits'?documentModel.list('hydro'):name==='itemVisibility'?effectiveItemVisibility():viewingFields.has(name)&&(productMode==='viewer'||name!=='layerPresentation')?viewingPresentation[name]:documentModel.snapshot()[name] }]));
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
    setViewingPresentation,captureViewingPresentation,applyViewingPresentation,restoreViewingPresentation,pruneViewingItems,
    captureReplacement,
    get atomicMapStateController() { return atomicMapStateController; },
    get mapWorkScheduler() { return mapWorkScheduler; },
    get normalizeLayerVisibility() { return normalizeLayerVisibility; },
    get saveState() { return saveState; },
    get state() { return state; },
  });
}
