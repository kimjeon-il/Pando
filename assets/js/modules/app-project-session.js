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
  function connect(ports) {
    if (dependencies) throw new Error('project-session already connected');
    dependencies = ports;
  }

  function normalizeLayerVisibility(value = {}, current = DEFAULT_LAYER_VISIBILITY) {
    const source = value && typeof value === 'object' ? value : {};
    const fallback = current && typeof current === 'object' ? current : DEFAULT_LAYER_VISIBILITY;
    const legacyHydroVisible = source.hydro !== false;
    return Object.fromEntries(Object.keys(DEFAULT_LAYER_VISIBILITY).map(key => {
      if (Object.hasOwn(source, key)) return [key, source[key] !== false];
      if ((key === 'rivers' || key === 'lakes') && Object.hasOwn(source, 'hydro')) return [key, legacyHydroVisible];
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
      languages: true,
      ethnicities: true,
      religions: true,
      rivers: true,
      lakes: true,
      genericFeatures: true,
      labels: true,
      basemapLabels: true,
      countryFlags: true,
    }));

    (state = {
      dataReadiness: dependencies.DATA_READINESS.PREVIEW,
      geometryProgress: 0,
      meshProgress: 0,
      countriesData: null,
      auditPreviewCountries: null,
      countryVisualPhase: 'preview',
      countryIndex: new Map(),
      countryOverrides: {},
      sourceInfo: null,
      labels: [],
      labelSettings: {},
      genericFeatures: [],
      hydroEdits: [],
      territorialUnits: [],
      territorialRelations: [],
      distributionLayers: [],
      distributionEntries: [],
      distributionSettings: { renderMode: dependencies.DISTRIBUTION_RENDER_MODES.DOMINANT, boundaryVisible: true },
      selectedDistributionLayerId: '',
      layerPresentation: (0, dependencies.normalizeLayerPresentation)(),
      selected: null,
      projection: 'globe',
      layerVisibility: normalizeLayerVisibility(),
      physicalSettings: {
        terrainVisible: true,
        terrainStyle: 'political',
        hydroLayers: {
          rivers_hydro: true,
          lakes_natural_earth: true,
        },
        hiddenHydroIds: {},
        dataset: dependencies.PHYSICAL_DATASET,
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
        languages: {},
        ethnicities: {},
        religions: {},
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
      boundaryEditCountryIds: [],
      boundaryEditPhase: null,
      boundaryEditInitialSelection: null,
      boundaryEditSeedCountryId: null,
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
      boundaryTopology: { edges: new Map(), nodes: new Map() },
      sharedBoundaryTopology: { segments: new Map(), nodes: new Map() },
      spatialIndex: [],
      mapMoving: false,
      historyDirtyCountryIds: new Set(),
      pendingCountryRenderIds: new Set(),
      sessionBaseCountriesJson: null,
      geometryPreview: (0, dependencies.createGeometryPreviewState)(),
      modeProcessing: false,
      modeTaskMinimized: false,
      audit: { status: 'idle', revision: 0, report: null, selectedIssueId: null },
      stateRevision: 0,
      transitionRevision: 0,
      spacePanActive: false,
      suppressNextMapClick: null,
      history: [],
      future: [],
      historyMeta: [],
      futureMeta: [],
      lastSavedAt: null,
      contentToken: 'content:0',
      view: {
        globeRotation: [-15, -25, 0],
        globeZoom: 1,
        flatCenter: [0, 20],
        flatZoom: 1,
      },
      size: { width: 1000, height: 700 },
      layerTreeRevision: 1,
    });

    (atomicMapStateController = (0, dependencies.createAtomicMapStateController)({
      applySnapshot: snapshot => {
        if (snapshot.projection) state.projection = snapshot.projection;
        if (snapshot.view) state.view = (0, dependencies.clampViewZooms)({ ...state.view, ...snapshot.view });
        state.transitionRevision = Number(snapshot.stateRevision || state.transitionRevision || 0);
      },
    }));

    (saveState = (0, dependencies.createSaveStateController)({ onChange: (...args) => dependencies.projectUi.syncSaveStatus(...args) }));

    (objectChooserCandidates = []);
  }

  return Object.freeze({
    connect,
    initializeMapWorkScheduler,
    get atomicMapStateController() { return atomicMapStateController; },
    get mapWorkScheduler() { return mapWorkScheduler; },
    get normalizeLayerVisibility() { return normalizeLayerVisibility; },
    get objectChooserCandidates() { return objectChooserCandidates; },
    set objectChooserCandidates(value) { objectChooserCandidates = value; },
    get saveState() { return saveState; },
    get state() { return state; },
  });
}
