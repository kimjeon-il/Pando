import { createEmptyTerritorialState } from './territorial-entity-store.js';
import { pickProjectFields } from './project-state.js';
import { PROJECT_SCHEMA_VERSION,LAND_OBJECT_SCHEMA_VERSION,SOURCE_PROVENANCE_SCHEMA_VERSION,
  TERRITORIAL_MODEL_SCHEMA_VERSION,DISTRIBUTION_MODEL_SCHEMA_VERSION } from './version-contract.js';
import { TERRAIN_RASTER_VERSION } from './terrain-manifest.js';
const readonlyIds=ids => Object.freeze({ get size() { return ids.length; },has: id => ids.includes(id),
  [Symbol.iterator]: () => ids[Symbol.iterator]() });
/** ProjectSession: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createProjectSession() {
  let dependencies;
  let mapWorkScheduler;
  let DEFAULT_LAYER_VISIBILITY;
  let state;
  let atomicMapStateController;
  let saveState;
  let objectChooserCandidates;
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
    (mapWorkScheduler = (() => {
      let interactionActive = false;
      const jobs = new Map();
      function cancel(key) {
        const job = jobs.get(key);
        if (!job) return;
        clearTimeout(job.timer);
        if (job.idleId && typeof cancelIdleCallback === 'function') cancelIdleCallback(job.idleId);
        jobs.delete(key);
      }
      function scheduleIdle(key, task, delay = 0) {
        cancel(key);
        const job = { task, delay, timer: 0, idleId: 0 };
        const queue = () => {
          if (interactionActive) {
            job.timer = setTimeout(queue, 180);
            return;
          }
          const run = () => {
            if (jobs.get(key) !== job || interactionActive) return queue();
            jobs.delete(key);
            task();
          };
          if (typeof requestIdleCallback === 'function') job.idleId = requestIdleCallback(run, { timeout: 1800 });
          else job.timer = setTimeout(run, 0);
        };
        job.timer = setTimeout(queue, delay);
        jobs.set(key, job);
      }
      function setInteractionActive(active) {
        interactionActive = !!active;
      }
      return { scheduleIdle, cancel, setInteractionActive, isInteractionActive: () => interactionActive };
    })());

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
      layerSearch: '',
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
      geometryPreview: (0, dependencies.applicationFactories.createGeometryPreviewState)(),
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
      layerTreeRevision: 1,
    });

    (atomicMapStateController = (0, dependencies.uiFactoriesA.createAtomicMapStateController)({
      applySnapshot: snapshot => {
        if (snapshot.projection) state.projection = snapshot.projection;
        if (snapshot.view) state.view = (0, dependencies.workspaceUiA.clampViewZooms)({ ...state.view, ...snapshot.view });
        state.transitionRevision = Number(snapshot.stateRevision || state.transitionRevision || 0);
      },
    }));

    (saveState = (0, dependencies.uiFactoriesB.createSaveStateController)({
      getDocumentState: () => dependencies.domains.commandOwner?.state() ?? null,
      onChange: (...args) => dependencies.lifecycleUi.projectUi.syncSaveStatus(...args) }));

    (objectChooserCandidates = []);
  }

  // A detached, empty startup input. C++ validates and owns it before any
  // preview/canonical source or editable UI is admitted.
  function initialDocument() {
    return { format: 'pandolab-project-state',schemaVersion: PROJECT_SCHEMA_VERSION,
      version: dependencies.platformConfigurationA.APP_VERSION,savedAt: new Date().toISOString(),
      baseDataset: dependencies.platformConfigurationA.BASE_DATASET,
      landObjectModel: { schemaVersion: LAND_OBJECT_SCHEMA_VERSION,coastlineAuthority: 'territorialEntities',
        purpose: 'lossless-fallback',directCreation: false,sourceProvenanceSchemaVersion: SOURCE_PROVENANCE_SCHEMA_VERSION,
        canonicalProperties: ['name','notes','color','locked','source'] },
      territorialModel: { schemaVersion: TERRITORIAL_MODEL_SCHEMA_VERSION,coastlineAuthority: 'territorialEntities',
        storage: 'territorialEntities',kinds: ['general','regional'],coverageModes: ['partition','explicit'] },
      distributionModel: { schemaVersion: DISTRIBUTION_MODEL_SCHEMA_VERSION,sourceModes: ['territorial','geometry'],valueKind: 'finite-number' },
      territorialEntities: [],...pickProjectFields(state),
      physicalSourceInfo: {
        terrain: { dataset: dependencies.platformConfigurationB.TERRAIN_DATASET,version: TERRAIN_RASTER_VERSION },
        hydro: { dataset: dependencies.platformConfigurationA.HYDRO_DATASET,version: dependencies.platformConfigurationA.APP_VERSION,
          coordinatePolicy: 'selected source coordinates retained without simplification',selection: {} },
      } };
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
    const properties=Object.fromEntries(['sourceInfo','labels','labelSettings','genericFeatures','hydroEdits','distributionLayers',
      'distributionEntries','distributionSettings','physicalSettings','layerVisibility','itemVisibility','layerPresentation','timelineRecords']
      .map(name => [name,{ enumerable: true,get: () => documentModel.snapshot()[name] }]));
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
    get atomicMapStateController() { return atomicMapStateController; },
    get mapWorkScheduler() { return mapWorkScheduler; },
    get normalizeLayerVisibility() { return normalizeLayerVisibility; },
    get objectChooserCandidates() { return objectChooserCandidates; },
    set objectChooserCandidates(value) { objectChooserCandidates = value; },
    get saveState() { return saveState; },
    get state() { return state; },
  });
}
