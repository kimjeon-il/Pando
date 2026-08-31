/* PandoLab v0.30.0
 * GitHub Pages-ready static map editor.
 * Rendering: bundled D3 v3 + Natural Earth 5.1.1 Admin 0 Countries 1:10m.
 * The full 1:10m geometry remains canonical; rendering and editing use lossless source data.
 * Source: naturalearthdata.com (public domain), default de facto boundary viewpoint.
 */

const moduleRevision = new URL(import.meta.url).searchParams.get('v') || '0.30.0-r35';
const versionedModuleUrl = relativePath => {
  const url = new URL(relativePath, import.meta.url);
  url.searchParams.set('v', moduleRevision);
  return url.href;
};
const [projectStateModule, countryEditTransactionModule, territorialUnitsModule, distributionModelModule, historicalLibraryModule, surfaceControllerModule, toolControllerModule, mapInputControllerModule, gpuMapRendererModule, territorialGeometryModule, selectControllerModule, startupReadinessModule, draftEditorModule, draftStrokeModule, , boundaryTopologyModule, geometryMetricsModule, geometryPreviewModule, geometrySnapModule, geometryValidationModule, labelLayoutModule, mapStateTransitionModule, objectSelectionModule, layerPresentationModule, saveStateModule, colorAdapterModule, projectSerializerModule, persistenceServiceModule, physicalLayerServiceModule, territorialServiceModule, distributionServiceModule, drawingServiceModule, mapRenderCoordinatorModule, tooltipControllerModule, confirmModalControllerModule, layerPanelControllerModule, historyServiceModule, historicalLibraryServiceModule, importServiceModule, historicalLibraryControllerModule, mapEditWorkerClientModule, mapObjectSpatialIndexModule] = await Promise.all([
  import(versionedModuleUrl('./modules/project-state.js')),
  import(versionedModuleUrl('./modules/country-edit-transaction.js')),
  import(versionedModuleUrl('./modules/territorial-units.js')),
  import(versionedModuleUrl('./modules/distribution-model.js')),
  import(versionedModuleUrl('./modules/historical-library.js')),
  import(versionedModuleUrl('./modules/surface-controller.js')),
  import(versionedModuleUrl('./modules/tool-controller.js')),
  import(versionedModuleUrl('./modules/map-input-controller.js')),
  import(versionedModuleUrl('./modules/gpu-map-renderer.js')),
  import(versionedModuleUrl('./modules/territorial-geometry.js')),
  import(versionedModuleUrl('./modules/select-controller.js')),
  import(versionedModuleUrl('./modules/startup-readiness.js')),
  import(versionedModuleUrl('./modules/draft-editor.js')),
  import(versionedModuleUrl('./modules/draft-stroke.js')),
  import(versionedModuleUrl('./modules/country-geometry.js')),
  import(versionedModuleUrl('./modules/boundary-topology.js')),
  import(versionedModuleUrl('./modules/geometry-metrics.js')),
  import(versionedModuleUrl('./modules/geometry-preview.js')),
  import(versionedModuleUrl('./modules/geometry-snap.js')),
  import(versionedModuleUrl('./modules/geometry-validation.js')),
  import(versionedModuleUrl('./modules/label-layout.js')),
  import(versionedModuleUrl('./modules/map-state-transition.js')),
  import(versionedModuleUrl('./modules/object-selection-controller.js')),
  import(versionedModuleUrl('./modules/layer-presentation.js')),
  import(versionedModuleUrl('./modules/save-state-controller.js')),
  import(versionedModuleUrl('./modules/color-adapter.js')),
  import(versionedModuleUrl('./modules/project-serializer.js')),
  import(versionedModuleUrl('./modules/persistence-service.js')),
  import(versionedModuleUrl('./modules/physical-layer-service.js')),
  import(versionedModuleUrl('./modules/territorial-service.js')),
  import(versionedModuleUrl('./modules/distribution-service.js')),
  import(versionedModuleUrl('./modules/drawing-service.js')),
  import(versionedModuleUrl('./modules/map-render-coordinator.js')),
  import(versionedModuleUrl('./modules/tooltip-controller.js')),
  import(versionedModuleUrl('./modules/confirm-modal-controller.js')),
  import(versionedModuleUrl('./modules/layer-panel-controller.js')),
  import(versionedModuleUrl('./modules/history-service.js')),
  import(versionedModuleUrl('./modules/historical-library-service.js')),
  import(versionedModuleUrl('./modules/import-service.js')),
  import(versionedModuleUrl('./modules/historical-library-controller.js')),
  import(versionedModuleUrl('./modules/map-edit-worker-client.js')),
  import(versionedModuleUrl('./modules/map-object-spatial-index.js')),
]);
const { createSvgIcon } = await import(versionedModuleUrl('./modules/icon-utils.js'));
const {
  PROJECT_SCHEMA_VERSION,
  applyProjectFields,
  assertCurrentProjectSchema,
  createProjectObjectId,
  pickProjectFields,
} = projectStateModule;
const { COLOR_DOMAINS, normalizeColorValue, readDomainColor, writeDomainColor } = colorAdapterModule;
const { createProjectSerializer, restoreCountriesFromDelta } = projectSerializerModule;
const { createBrowserProjectStorage, createPersistenceService } = persistenceServiceModule;
const { createHydroService, createTerrainService } = physicalLayerServiceModule;
const { createTerritorialApplicationService } = territorialServiceModule;
const { createDistributionService } = distributionServiceModule;
const {
  DRAWING_CATEGORY_RULES,
  DRAWING_ROLE_LABELS,
  DRAWING_SCHEMA_VERSION,
  createDrawingService,
  drawingGeometryKind,
  drawingLandBinding,
  drawingRole,
  normalizeDrawingCollection,
  normalizeDrawingSemantics,
} = drawingServiceModule;
const { createMapRenderCoordinator, MAP_RENDER_DIRTY } = mapRenderCoordinatorModule;
const { createTooltipController } = tooltipControllerModule;
const { createConfirmModalController } = confirmModalControllerModule;
const { createLayerPanelController } = layerPanelControllerModule;
const { createHistoryService } = historyServiceModule;
const { createHistoricalLibraryService } = historicalLibraryServiceModule;
const {
  appendImportedSourceInfo,
  applyImportedPackageAssets,
  createCountryImportMergePlanner,
  createGisGeometryValidator,
  createImportService,
  importedCountryOverrides,
} = importServiceModule;
const { createHistoricalLibraryController } = historicalLibraryControllerModule;
const { createMapEditWorkerClient } = mapEditWorkerClientModule;
const { createMapObjectSpatialIndex } = mapObjectSpatialIndexModule;
const reliabilityCoreModule = await import(versionedModuleUrl('./modules/reliability-core.js'));
const projectInvariantsModule = await import(versionedModuleUrl('./modules/project-invariants.js'));
const territorialImportPlanModule = await import(versionedModuleUrl('./modules/territorial-import-plan.js'));
const countryImportIdentityModule = await import(versionedModuleUrl('./modules/country-import-identity.js'));
const coastReconciliationModule = await import(versionedModuleUrl('./modules/coast-reconciliation.js'));
const coastReconciliationControllerModule = await import(versionedModuleUrl('./modules/coast-reconciliation-controller.js'));
const annexGeometryModule = await import(versionedModuleUrl('./modules/annex-geometry.js'));
const riverTerritoryPartitionModule = await import(versionedModuleUrl('./modules/river-territory-partition.js'));
const selectionEmphasisModule = await import(versionedModuleUrl('./modules/selection-emphasis.js'));
const mapInteractionStyleModule = await import(versionedModuleUrl('./modules/map-interaction-style.js'));
const userPreferencesModule = await import(versionedModuleUrl('./modules/user-preferences.js'));
const notificationCopyModule = await import(versionedModuleUrl('./modules/notification-copy.js'));
const {
  RELIABILITY_ERROR_CATEGORIES,
  createCancellationError,
  createDiagnosticLog,
  createOperationalError,
  fetchWithRetry,
  isAbortError,
} = reliabilityCoreModule;
const { assertProjectReferenceIntegrity } = projectInvariantsModule;
const { buildTerritorialImportTransactionPlan, resolveImportedCountryId } = territorialImportPlanModule;
const {
  identityResolutionSummary,
  materializeResolvedCountries,
  resolveCountryIdentities,
} = countryImportIdentityModule;
const {
  analyzeAdminCountryCoast,
  normalizeCoastDecision,
  planCoastReconciliations,
  validateCoastReplacement,
} = coastReconciliationModule;
const { createCoastReconciliationController } = coastReconciliationControllerModule;
const { planDrawnTerritoryAnnex } = annexGeometryModule;
const {
  buildRiverTerritoryPartitions,
  RIVER_TERRITORY_PARTITION_ALGORITHM_REVISION,
  RIVER_TERRITORY_PARTITION_CONFIG,
  riverTerritoryPartitionConfigFingerprint,
} = riverTerritoryPartitionModule;
const { SELECTION_STYLE, setSelectionColor, setInteractionStyle: setSelectionInteractionStyle, buildSelectionBoundarySegments, createSelectionEmphasisRenderer } = selectionEmphasisModule;
const { resolveMapInteractionStyle } = mapInteractionStyleModule;
const { loadUserPreferences, saveUserPreferences, effectiveTheme, defaultUserPreferences } = userPreferencesModule;
const { compactNotificationMessage } = notificationCopyModule;
const { createSelectController } = selectControllerModule;
const { DATA_READINESS, READINESS_EVENTS, canMutateProject, transitionDataReadiness } = startupReadinessModule;
const { runCountryEditTransaction } = countryEditTransactionModule;
const {
  TERRITORIAL_COVERAGE_MODES,
  TERRITORIAL_UNIT_TYPES,
  changeParent,
  changeSovereign,
  changeUnitType,
  createTerritorialFeature,
  createTerritorialRepository,
  normalizeTerritorialRelations,
  normalizeTerritorialUnits,
  territorialChildren,
  territorialSiblings,
} = territorialUnitsModule;
const {
  DISTRIBUTION_SCHEMA_VERSION,
  DISTRIBUTION_MODES,
  DISTRIBUTION_RENDER_MODES,
  DISTRIBUTION_TYPES,
  createDistributionEntry,
  createDistributionLayer,
  distributionEntriesForLayer,
  dominantDistributionEntries,
  normalizeDistributionEntries,
  normalizeDistributionLayers,
  validateDistributionModel,
} = distributionModelModule;
const {
  LIBRARY_ENTITY_TYPES,
  selectGeometryVersion,
} = historicalLibraryModule;
const TERRITORIAL_TYPE_LABELS = Object.freeze({
  [TERRITORIAL_UNIT_TYPES.COUNTRY]: '국가',
  [TERRITORIAL_UNIT_TYPES.TERRITORY]: '권역',
  [TERRITORIAL_UNIT_TYPES.ADMIN]: '행정구역',
  [TERRITORIAL_UNIT_TYPES.REGION]: '지방',
});
const territorialTypeLabel = unitType => TERRITORIAL_TYPE_LABELS[unitType] || '영역';
const createPartitionTerritorialFeature = options => createTerritorialFeature({
  id: options.id,
  unitType: options.unitType,
  parentId: options.parentId || options.sovereignId || '',
  sovereignId: options.sovereignId || '',
  isRemainder: options.isRemainder === true,
  coverageMode: TERRITORIAL_COVERAGE_MODES.PARTITION,
  adminLevel: options.adminLevel,
  name: options.name,
  color: options.color,
  notes: options.notes,
  metadata: options.metadata,
  sourceFolderId: options.sourceFolderId,
  geometry: options.geometry,
});
const { createSurfaceController } = surfaceControllerModule;
const { describeTool, dispatchTool, isSpecialTool, toolCursorMode, toolDraftDefinition, toolLabel } = toolControllerModule;
const { createMapInputController } = mapInputControllerModule;
const { createGpuMapRenderer } = gpuMapRendererModule;
const { createTerritorialGeometryKernel, snapLineEndpointsToBoundary } = territorialGeometryModule;
const {
  createDraftEditState,
  deleteDraftVertex,
  insertDraftVertex,
  moveDraftVertex,
  recordDraftSnapshot,
  redoDraftSnapshot,
  removeLastDraftVertex,
  resetDraftEditState,
  undoDraftSnapshot,
} = draftEditorModule;
const {
  appendDraftStrokeSamples,
  beginDraftStroke,
  cancelDraftStroke: cancelRawDraftStroke,
  createDraftStrokeState,
  finalizeDraftStroke,
  resetDraftStrokeState,
} = draftStrokeModule;
const {
  buildBoundaryTopology: buildSharedBoundaryTopology,
  buildTerritorialInternalBoundarySegments,
  moveTopologyNode,
  planCoastEdit,
  planSharedBoundaryEdit,
  topologyNodeKey,
} = boundaryTopologyModule;
const {
  formatArea,
  geometryAreaKm2: sphericalGeometryAreaKm2,
} = geometryMetricsModule;
const {
  beginGeometryPreview,
  buildRenderableStrokeFeature,
  buildGeometryPreview,
  clearGeometryPreview,
  createGeometryPreviewState,
  hasAreaGeometry,
  previewIsCurrent,
} = geometryPreviewModule;
const {
  resolveSnap,
  snapIndicator,
} = geometrySnapModule;
const { validateGeometry: validateStructuredGeometry, validateTerritorialGeometry } = geometryValidationModule;
const { LABEL_PRIORITIES, automaticLabelSettings, labelKey, layoutLabels, normalizeLabelSettings } = labelLayoutModule;
const { createAtomicMapStateController } = mapStateTransitionModule;
const { createObjectSelectionController, normalizeObjectRef } = objectSelectionModule;
const { OVERLAY_GROUPS, layerStyle, normalizeLayerPresentation } = layerPresentationModule;
const { AUTOSAVE_STATES, createSaveStateController } = saveStateModule;
const countryGeometry = globalThis.PandoLabCountryGeometry;
if (!countryGeometry) throw new Error('국가 지오메트리 정규화 모듈을 불러오지 못했습니다.');
const {
  ensureClosedRing,
  hasCanonicalCountryWinding,
  normalizeCountryGeometry,
  orientRing,
  ringSignedArea,
} = countryGeometry;

(() => {
  'use strict';

  const d3 = window.d3;
  const territorialGeometry = createTerritorialGeometryKernel(window.polygonClipping);

  const APP_VERSION = '0.30.0';
  const HYDRO_DATA_VERSION = '0.13.0';
  const ASSET_REVISION = window.PANDOLAB_ASSET_REVISION || APP_VERSION;
  const PANDOLAB_ASSET_BASE_URL = window.PANDOLAB_ASSET_BASE_URL || new URL('./assets/js/', location.href).href;
  const PHYSICAL_DATA_BASE_URL = new URL('../data/', PANDOLAB_ASSET_BASE_URL);
  const HISTORICAL_LIBRARY_DATA_URL = new URL('historical-library-pilot.json', PHYSICAL_DATA_BASE_URL);
  HISTORICAL_LIBRARY_DATA_URL.searchParams.set('v', ASSET_REVISION);
  const PHYSICAL_DATASET = 'HydroRIVERS 1.0 · Natural Earth 5.0.0 호수 · raster 3.2.0';
  const TERRAIN_DATASET = 'Natural Earth raster 3.2.0 1:10m';
  const HYDRO_DATASET = 'HydroRIVERS 1.0 · Natural Earth 5.0.0 1:10m lakes';

  const STORAGE_KEY = 'pandolab-editor-project';
  const AUTOSAVE_DB_NAME = 'pandolab-editor';
  const AUTOSAVE_STORE_NAME = 'projects';
  const AUTOSAVE_RECORD_KEY = 'active-project';
  const AUTOSAVE_VIEW_KEY = 'active-view';
  const BASE_DATASET = 'Natural Earth 5.1.1 · Admin 0 Countries · 1:10m · de facto';
  const DARK_DEFAULT_COLOR = '#63758a';
  const LIGHT_DEFAULT_COLOR = '#cccccc';
  const DEFAULT_DRAWING_COLOR = '#8c68d8';
  const COLOR_PRESETS = Object.freeze([
    '#000000', '#4b5563', '#9ca3af', '#ffffff', '#7f1d1d', '#dc2626',
    '#f97316', '#f59e0b', '#facc15', '#166534', '#22c55e', '#14b8a6',
    '#0ea5e9', '#2563eb', '#4338ca', '#7c3aed', '#a855f7', '#db2777',
    '#f43f5e', '#8b5e3c', '#cda95d', '#63758a', '#cccccc', '#8c68d8',
  ]);
  const COLOR_PALETTE_TONES = Object.freeze(['아주 밝음', '밝음', '기본', '어두움', '아주 어두움']);
  const COLOR_PALETTE_NEUTRALS = Object.freeze([
    Object.freeze({ color: '#ffffff', label: '흰색' }),
    Object.freeze({ color: '#e5e7eb', label: '연회색' }),
    Object.freeze({ color: '#9ca3af', label: '회색' }),
    Object.freeze({ color: '#4b5563', label: '진회색' }),
    Object.freeze({ color: '#1f2937', label: '먹색' }),
    Object.freeze({ color: '#000000', label: '검정' }),
  ]);
  const COLOR_PALETTE_HUES = Object.freeze([
    Object.freeze({ name: '빨강', colors: Object.freeze(['#fee2e2', '#fca5a5', '#ef4444', '#b91c1c', '#7f1d1d']) }),
    Object.freeze({ name: '주황', colors: Object.freeze(['#ffedd5', '#fdba74', '#f97316', '#c2410c', '#7c2d12']) }),
    Object.freeze({ name: '황금', colors: Object.freeze(['#fef3c7', '#fcd34d', '#f59e0b', '#b45309', '#78350f']) }),
    Object.freeze({ name: '노랑', colors: Object.freeze(['#fef9c3', '#fde047', '#eab308', '#a16207', '#713f12']) }),
    Object.freeze({ name: '연두', colors: Object.freeze(['#ecfccb', '#bef264', '#84cc16', '#4d7c0f', '#365314']) }),
    Object.freeze({ name: '초록', colors: Object.freeze(['#dcfce7', '#86efac', '#22c55e', '#15803d', '#14532d']) }),
    Object.freeze({ name: '청록', colors: Object.freeze(['#ccfbf1', '#5eead4', '#14b8a6', '#0f766e', '#134e4a']) }),
    Object.freeze({ name: '시안', colors: Object.freeze(['#cffafe', '#67e8f9', '#06b6d4', '#0e7490', '#164e63']) }),
    Object.freeze({ name: '파랑', colors: Object.freeze(['#dbeafe', '#93c5fd', '#3b82f6', '#1d4ed8', '#1e3a8a']) }),
    Object.freeze({ name: '인디고', colors: Object.freeze(['#e0e7ff', '#a5b4fc', '#6366f1', '#4338ca', '#312e81']) }),
    Object.freeze({ name: '보라', colors: Object.freeze(['#ede9fe', '#c4b5fd', '#8b5cf6', '#6d28d9', '#4c1d95']) }),
    Object.freeze({ name: '분홍', colors: Object.freeze(['#fce7f3', '#f9a8d4', '#ec4899', '#be185d', '#831843']) }),
  ]);
  const COLOR_PALETTE_COLORS = Object.freeze(COLOR_PALETTE_TONES.flatMap((tone, toneIndex) => (
    COLOR_PALETTE_HUES.map(hue => Object.freeze({
      color: hue.colors[toneIndex],
      label: `${hue.name} ${tone}`,
      family: hue.name,
      tone,
    }))
  )));
  const ZOOM_LIMITS = Object.freeze({
    globe: Object.freeze({ min: 0.72, max: 32 }),
    flat: Object.freeze({ min: 0.75, max: 64 }),
  });
  const HYDRO_TOOL_CONFIG = Object.freeze({
    river: Object.freeze({ geometry: 'LineString', category: 'river', label: '강', color: '#3b82c4', prefix: 'river' }),
    lake: Object.freeze({ geometry: 'Polygon', category: 'lake', label: '호수', color: '#5aa9d6', prefix: 'lake' }),
  });
  const HYDRO_LAYER_META = Object.freeze({
    rivers_hydro: Object.freeze({ label: '강', shortLabel: '강', sourceLabel: 'HydroRIVERS', category: 'river', color: '#3b82c4' }),
    lakes_natural_earth: Object.freeze({ label: '호수', shortLabel: '호수', sourceLabel: 'Natural Earth', category: 'lake', color: '#5aa9d6' }),
  });
  const TERRAIN_OCEAN_REPRESENTATIVE = '#6aa8d2';
  const MAX_HISTORY = 30;
  const CUT_ENDPOINT_SNAP_DISTANCE = Object.freeze({ mouse: 10, touch: 18 });
  const LAYOUT_QUERIES = {
    mobile: window.matchMedia('(max-width: 799px)'),
    compact: window.matchMedia('(min-width: 800px) and (max-width: 1359px)'),
  };

  const systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  let systemTheme = systemThemeQuery.matches ? 'dark' : 'light';
  let userPreferences = loadUserPreferences();
  let runtimeReady = false;
  document.documentElement.dataset.systemTheme = systemTheme;
  document.documentElement.dataset.theme = effectiveTheme(userPreferences, systemTheme === 'dark');
  const MAP_LABEL_FONT_STACKS = Object.freeze({
    default: 'var(--ui-font-family)',
    gothic: '"Pretendard Variable", Pretendard, "Noto Sans KR", "Apple SD Gothic Neo", sans-serif',
    serif: '"Noto Serif KR", "Nanum Myeongjo", "AppleMyungjo", serif',
  });
  function applyMapLabelPreferences() {
    const root = document.documentElement.style;
    const labels = userPreferences.labels;
    root.setProperty('--country-label-font-family', MAP_LABEL_FONT_STACKS[labels.country.font] || MAP_LABEL_FONT_STACKS.default);
    root.setProperty('--place-label-font-family', MAP_LABEL_FONT_STACKS[labels.place.font] || MAP_LABEL_FONT_STACKS.default);
    if (labels.country.color) root.setProperty('--country-label-color', labels.country.color);
    else root.removeProperty('--country-label-color');
    if (labels.place.color) root.setProperty('--place-label-color', labels.place.color);
    else root.removeProperty('--place-label-color');
    if (labels.place.pointColor) root.setProperty('--place-label-point-color', labels.place.pointColor);
    else root.removeProperty('--place-label-point-color');
  }
  applyMapLabelPreferences();
  function resolveCurrentInteractionStyle() {
    const theme = effectiveTheme(userPreferences, systemTheme === 'dark');
    const computed = getComputedStyle(document.documentElement);
    return resolveMapInteractionStyle({
      theme,
      selectionColor: userPreferences.selection.color,
      outlineVisible: userPreferences.selection.outlineVisible,
      fillStrength: userPreferences.selection.fillStrength,
      tokens: {
        accent: computed.getPropertyValue('--accent').trim(),
        textStrong: computed.getPropertyValue('--text-strong').trim(),
      },
    });
  }
  let resolvedInteractionStyle = resolveCurrentInteractionStyle();
  document.documentElement.style.setProperty('--map-selection-halo', resolvedInteractionStyle.selection.color);
  setSelectionColor(resolvedInteractionStyle.selection.color);
  setSelectionInteractionStyle(resolvedInteractionStyle);
  window.__PANDOLAB_THEME__ = effectiveTheme(userPreferences, systemTheme === 'dark');

  function enableKeyboardNavigation(event) {
    if (event.key === 'Tab') document.documentElement.classList.add('keyboard-navigation');
  }

  function disableKeyboardNavigation() {
    document.documentElement.classList.remove('keyboard-navigation');
  }

  document.addEventListener('keydown', enableKeyboardNavigation, true);
  if ('PointerEvent' in window) document.addEventListener('pointerdown', disableKeyboardNavigation, true);
  else {
    document.addEventListener('mousedown', disableKeyboardNavigation, true);
    document.addEventListener('touchstart', disableKeyboardNavigation, { capture: true, passive: true });
  }

  function mapTheme() {
    const terrainVisible = state?.physicalSettings?.terrainVisible !== false;
    const terrainStyle = state?.physicalSettings?.terrainStyle || 'political';
    const terrainStrength = clamp(Number(state?.physicalSettings?.terrainStrength ?? 0.32), 0, 1);
    const terrainFillAlpha = terrainVisible
      ? (terrainStyle === 'physical' ? 0.22 : 1 - terrainStrength)
      : null;
    const countryStyle = state?.layerPresentation ? layerStyle(state.layerPresentation, 'countries') : { opacity: 1, boundaryVisible: true, boundaryWidth: 1 };
    const riverStyle = state?.layerPresentation ? layerStyle(state.layerPresentation, 'rivers') : { opacity: 1, boundaryVisible: true, boundaryWidth: 1 };
    const lakeStyle = state?.layerPresentation ? layerStyle(state.layerPresentation, 'lakes') : { opacity: 1, boundaryVisible: true, boundaryWidth: 1 };
    const base = (document.documentElement.dataset.theme || window.__PANDOLAB_THEME__ || systemTheme) === 'light'
      ? { defaultLand: LIGHT_DEFAULT_COLOR, fillAlpha: terrainFillAlpha ?? 1, border: '#ffffff', borderGpu: [1, 1, 1], borderAlpha: 1, ocean: '#ffffff', oceanGpu: [1, 1, 1] }
      : { defaultLand: DARK_DEFAULT_COLOR, fillAlpha: terrainFillAlpha ?? 0.74, border: '#323c46', borderGpu: [0.196, 0.235, 0.275], borderAlpha: 0.92, ocean: '#0d2837', oceanGpu: [0.051, 0.157, 0.216] };
    base.fillAlpha *= countryStyle.opacity;
    base.fillAlphaByte = Math.round(base.fillAlpha * 255);
    base.borderAlpha = countryStyle.boundaryVisible ? base.borderAlpha * countryStyle.opacity : 0;
    base.borderWidth = countryStyle.boundaryWidth;
    base.riverOpacity = riverStyle.opacity;
    base.riverWidth = riverStyle.boundaryWidth;
    base.lakeOpacity = lakeStyle.opacity;
    base.lakeBoundaryVisible = lakeStyle.boundaryVisible;
    base.lakeBoundaryWidth = lakeStyle.boundaryWidth;
    return base;
  }

  function defaultCountryColor() {
    return mapTheme().defaultLand;
  }

  function applySystemTheme(matchesDark) {
    const nextTheme = matchesDark ? 'dark' : 'light';
    if (nextTheme === systemTheme && userPreferences.appearance.theme !== 'system') return;
    systemTheme = nextTheme;
    document.documentElement.dataset.systemTheme = systemTheme;
    document.documentElement.dataset.theme = effectiveTheme(userPreferences, systemTheme === 'dark');
    window.__PANDOLAB_THEME__ = effectiveTheme(userPreferences, systemTheme === 'dark');
    syncResolvedInteractionStyle();
    gpuMapRenderer.invalidateCountryPalette({ base: true, emphasis: true }, 'system-theme');
    gpuMapRenderer.invalidatePhysicalStyle('system-theme');
    if (state?.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY) {
      const id = String(state.selected.id);
      const feature = countryFeatureById(id);
      const color = readDomainColor(COLOR_DOMAINS.COUNTRY, { feature, override: state.countryOverrides[id] }, { fallback: defaultCountryColor() });
      if (color.isDefault && $('countryColorInput')) $('countryColorInput').value = color.value;
      syncColorPicker('country', {
        value: color.value,
        defaultColor: defaultCountryColor(),
        isDefault: color.isDefault,
      });
    }
    if (svg) {
      markLayerTreeDirty();
      renderLayerTree();
      renderAll();
    }
  }

  const $ = (id) => document.getElementById(id);

  function createEmptyState(title, description, { tag = 'div', compact = false } = {}) {
    const empty = document.createElement(tag);
    empty.className = `ui-empty-state${compact ? ' ui-empty-state--compact' : ''}`;
    const heading = document.createElement('strong');
    const text = document.createElement('p');
    heading.textContent = title;
    text.textContent = description;
    empty.append(heading, text);
    return empty;
  }
  const selectController = createSelectController({ document, window });
  selectController.enhanceAll();
  const tooltipController = createTooltipController({
    document,
    window,
    tooltip: $('uiTooltip'),
    clamp: (value, minimum, maximum) => clamp(value, minimum, maximum),
  });
  const bindUiTooltips = () => tooltipController.bind();

  function syncSearchClearButton(input, button) {
    button?.classList.toggle('hidden', !String(input?.value || '').length);
  }

  function runtimeAssetUrl(relativePath) {
    const url = new URL(relativePath, PANDOLAB_ASSET_BASE_URL);
    url.searchParams.set('v', ASSET_REVISION);
    return url;
  }
  const REQUIRED_UI_IDS = Object.freeze([
    'app', 'map', 'engineStatus', 'statusView', 'statusPrimary', 'statusSelection', 'uiTooltip',
    'mapPanelTabs', 'mapLayersTabBtn', 'mapViewTabBtn', 'layerSection', 'mapViewSection', 'mapViewProjectionSlot', 'projectionControl',
    'globeBtn', 'flatBtn', 'countriesVisible', 'territoriesVisible', 'administrativeVisible', 'regionsVisible', 'languagesVisible', 'ethnicitiesVisible', 'religionsVisible', 'riversVisible', 'lakesVisible', 'drawingsVisible', 'labelsVisible', 'basemapLabelsVisible', 'distributionLayerModeInput', 'distributionBoundaryVisibleInput',
    'resetViewBtn', 'terrainVisible', 'terrainPoliticalRadio', 'terrainPhysicalRadio', 'terrainStrengthControl', 'terrainStrengthInput', 'terrainStrengthValue', 'countryNameInput', 'countryColorInput', 'capitalInput', 'notesInput',
    'debugMapPanel', 'countryAreaValue',
    'flagUploadBtn', 'flagFileInput', 'flagRemoveBtn',
    'drawingNameInput', 'drawingColorInput', 'drawingNotesInput',
    'drawingLandRelationSection', 'drawingOwnerField', 'drawingOwnerInput', 'drawingParentField', 'drawingParentInput', 'drawingLandBindingField', 'drawingLandBindingInput', 'drawingRoleHelp',
    'drawingLandActionsSection', 'splitDrawingBtn', 'mergeDrawingBtn', 'syncDrawingCoastBtn', 'editDrawingCoastBtn', 'applyDrawingToCountryBtn', 'promoteDrawingToCountryBtn', 'drawingRoleValue', 'drawingTopologyValue',
    'labelNameInput', 'labelKindInput', 'labelNotesInput', 'labelPositionValue', 'deleteLabelBtn',
    'editorScrollBody', 'editorObjectHeader', 'emptyProperties', 'propertyTitle', 'propertyTypeLabel', 'actionsTabBtn', 'objectLockBtn', 'objectDeleteBtn', 'objectActionsMenu', 'objectCoastReconcileMenuBtn',
    'countryProperties', 'territoryProperties', 'administrativeProperties', 'regionProperties', 'distributionProperties', 'territoryNameConflict', 'administrativeNameConflict', 'regionNameConflict', 'regionNameInput', 'regionCountryInput', 'regionParentInput', 'regionColorInput', 'regionValidFromInput', 'regionValidToInput', 'regionNotesInput', 'distributionNameInput', 'distributionTypeValue', 'distributionColorInput', 'distributionParentInput', 'distributionLockedInput', 'distributionRenderModeInput', 'distributionEntryList', 'distributionTerritorialUnitInput', 'distributionShareInput', 'addTerritorialDistributionBtn', 'addGeometryDistributionBtn', 'deleteDistributionBtn', 'drawingProperties', 'labelProperties', 'hydroProperties',
    'editBorderBtn', 'editCoastBtn', 'changeCountryTypeBtn', 'changeTerritoryTypeBtn', 'changeAdministrativeTypeBtn', 'reconcileAdministrativeCoastBtn', 'territorialTypeModal', 'territorialTypeTitle', 'territorialTypeContext', 'territorialTypeInput', 'territorialTypeSovereignRow', 'territorialTypeSovereignInput', 'territorialTypeParentRow', 'territorialTypeParentInput', 'territorialTypeImpact', 'territorialTypeImpactSummary', 'territorialTypeImpactList', 'territorialTypeCancelBtn', 'territorialTypeConfirmBtn',
    'countryCodeInput', 'drawingIdInput', 'hydroCategoryValue', 'hydroIdLabel', 'hydroIdValue', 'hydroSystemRow', 'hydroSystemValue', 'hydroTributaryValue', 'hydroSourceValue', 'hydroBuiltinHelp', 'hydroEditFields', 'hydroNameInput', 'hydroColorInput', 'hydroNotesInput', 'copyHydroBtn', 'deleteHydroEditBtn',
    'undoBtn', 'redoBtn', 'togglePanelBtn', 'rightPanel',
    'mapTopContextSlot', 'modeEditingContext', 'modeEditingHud', 'modeTaskWindowContent', 'modeTaskMinimizeBtn', 'modeTaskCloseBtn', 'modeActionBar', 'modeTaskName', 'modeTaskStage', 'modeTaskInstruction',
    'modeMethodSwitch', 'modeLineMethodBtn', 'modePolygonMethodBtn', 'modeRiverMethodBtn', 'modeComponentsMethodBtn', 'modeDraftActions', 'modeDraftRedrawBtn', 'modeDraftRemoveLastBtn', 'modeDraftDeleteBtn', 'geometryPreviewSummary', 'modePrimaryBtn', 'modeCancelBtn',
    'multiSelectionBar', 'multiSelectionCount', 'multiSelectionModeBtn', 'multiPropertiesVisibilityInput', 'multiPropertiesLockInput', 'multiCountryActions', 'multiBorderEditBtn', 'multiBorderEditHelp',
    'saveProjectBtn', 'openGisBtn', 'gisFileInput', 'newProjectBtn', 'dataExportBtn', 'preferencesBtn', 'preferencesModal', 'preferencesThemeInput', 'preferencesCountryLabelFontInput', 'preferencesCountryLabelColorInput', 'preferencesCountryLabelColorTrigger', 'preferencesCountryLabelColorValue', 'preferencesCountryLabelColorPopover', 'preferencesPlaceLabelFontInput', 'preferencesPlaceLabelColorInput', 'preferencesPlaceLabelColorTrigger', 'preferencesPlaceLabelColorValue', 'preferencesPlaceLabelColorPopover', 'preferencesPlacePointColorInput', 'preferencesPlacePointColorTrigger', 'preferencesPlacePointColorValue', 'preferencesPlacePointColorPopover', 'preferencesSelectionColorInput', 'preferencesSelectionColorTrigger', 'preferencesSelectionColorValue', 'preferencesSelectionColorPopover', 'preferencesSelectionOutlineInput', 'preferencesSelectionFillStrengthInput', 'preferencesSelectionFillStrengthValue', 'preferencesApplyBtn', 'preferencesResetBtn', 'preferencesCancelBtn', 'preferencesCloseBtn',
    'addCountryBtn', 'addTerritoryBtn', 'addAdministrativeBtn', 'addRegionBtn', 'territorialCreateModal', 'territorialCreateTitle', 'territorialCreateContext', 'territorialCreateMethod', 'territorialCreateCancelBtn', 'territorialCreateConfirmBtn',
    'gisTargetCountry', 'gisParentUnit', 'gisExportModal', 'gisExportConfirmBtn', 'confirmModalChoiceRow', 'confirmModalChoice',
    'coastReconciliationModal', 'coastReconciliationTitle', 'coastReconciliationMessage', 'coastReconciliationImpact', 'coastReconciliationImpactList', 'coastReconciliationCountryBtn', 'coastReconciliationAdminBtn', 'coastReconciliationIndependentBtn', 'coastReconciliationCancelBtn',
    'layerSearchInput', 'layerSearchClearBtn', 'addFromLibraryBtn', 'historicalLibraryModal', 'historicalLibraryCloseBtn', 'historicalLibrarySearchInput', 'historicalLibrarySearchClearBtn', 'historicalLibraryTypeInput', 'historicalLibraryStatusInput', 'historicalLibraryYearInput', 'historicalLibraryGeographicRegionInput', 'historicalLibraryResults', 'historicalLibraryPreview', 'historicalLibrarySnapshotInput', 'historicalLibrarySnapshotBtn', 'historicalLibraryChildDepthInput', 'historicalLibraryAddBtn',
  ]);
  const CACHE_MISMATCH_MESSAGE = '화면 파일과 스크립트 버전이 다릅니다. 페이지를 강력 새로고침하세요. PC에서는 Ctrl+F5를 사용할 수 있습니다.';

  function assertRuntimeCompatibility() {
    const htmlVersion = $('app')?.dataset.appVersion;
    const bootstrapVersion = window.PANDOLAB_BUILD_ID;
    if (htmlVersion !== APP_VERSION || bootstrapVersion !== APP_VERSION) throw new Error(CACHE_MISMATCH_MESSAGE);
    const missingIds = REQUIRED_UI_IDS.filter(id => !$(id));
    const missingSelectors = ['.workspace'].filter(selector => !document.querySelector(selector));
    if (missingIds.length || missingSelectors.length) throw new Error(CACHE_MISMATCH_MESSAGE);
  }

  const deepClone = (obj) => JSON.parse(JSON.stringify(obj));
  const reliabilityDiagnostic = createDiagnosticLog({ limit: 250 });
  window.__PANDOLAB_RELIABILITY_LOG__ = reliabilityDiagnostic;
  // 내장 원본은 읽기 전용 기준 지도다. 렌더링 메시와 편집 사본을 분리해 원본 좌표를 보존한다.
  let pristineCountriesFallback = window.PANDOLAB_COUNTRIES || { type: 'FeatureCollection', features: [] };
  let pristineCountriesSourceBuffer = null;
  const PRISTINE_LABEL_ANCHORS = window.PANDOLAB_LABEL_ANCHORS || {};

  function parsePristineCountries() {
    if (pristineCountriesSourceBuffer instanceof ArrayBuffer) {
      return JSON.parse(new TextDecoder().decode(pristineCountriesSourceBuffer));
    }
    return deepClone(pristineCountriesFallback);
  }

  function installPristineCountrySource(sourceBuffer) {
    if (!(sourceBuffer instanceof ArrayBuffer)) throw new Error('무손실 국가 데이터 버퍼가 올바르지 않습니다.');
    pristineCountriesSourceBuffer = sourceBuffer;
    pristineCountriesFallback = null;
  }

  function freshPristineCountries(applyOverrides = true) {
    const countries = reindexCountries(parsePristineCountries(), applyOverrides);
    applyPristineLabelAnchors(countries);
    return countries;
  }
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const hydroToolConfig = tool => HYDRO_TOOL_CONFIG[tool] || null;
  const draftToolConfig = tool => toolDraftDefinition(tool, state);
  const isPolygonDraftTool = tool => draftToolConfig(tool)?.shape === 'polygon';
  const isLineDraftTool = tool => draftToolConfig(tool)?.shape === 'line';
  const isDrawingDraftTool = tool => !!draftToolConfig(tool);
  const clampViewZooms = view => {
    if (!view) return view;
    view.globeZoom = clamp(Number(view.globeZoom) || 1, ZOOM_LIMITS.globe.min, ZOOM_LIMITS.globe.max);
    view.flatZoom = clamp(Number(view.flatZoom) || 1, ZOOM_LIMITS.flat.min, ZOOM_LIMITS.flat.max);
    return view;
  };
  const uid = () => createProjectObjectId();
  const detectLayoutMode = () => LAYOUT_QUERIES.mobile.matches ? 'mobile' : LAYOUT_QUERIES.compact.matches ? 'compact' : 'wide';
  let layoutMode = detectLayoutMode();
  let mapPanelView = 'layers';
  const isMobile = () => layoutMode === 'mobile';
  let lastOverlayTrigger = null;
  let fileMenuTrigger = null;
  let createMenuTrigger = null;
  let shortcutHelpReturnFocus = null;
  const surfaceController = createSurfaceController({ getElement: $, getLayout: () => layoutMode, document });
  const surfaceState = surfaceController.state;
  const SHEET_SNAP_RATIOS = Object.freeze([0.6, 1]);
  const SHEET_SNAP_LABELS = Object.freeze(['기본 높이', '전체 높이']);
  const MOBILE_SHEET_DEFAULT_SNAP = 0;
  const MOBILE_SHEET_IDS = Object.freeze({ map: 'leftPanel', create: 'createMenu', edit: 'rightPanel' });
  const sheetSnapIndex = new Map(Object.values(MOBILE_SHEET_IDS).map(id => [id, MOBILE_SHEET_DEFAULT_SNAP]));
  const sheetSnapTouched = new Set();
  let activeSheetDrag = null;
  const MOBILE_SHEET_HISTORY_KEY = '__atlaswrightMobileSheet';
  let ignoreNextMobileSheetPopstate = false;

  const mobileViewportHeight = () => window.visualViewport?.height || window.innerHeight;

  function mobileSheetNavHeight() {
    const nav = document.querySelector('.adaptive-nav');
    const height = nav?.getBoundingClientRect().height || 0;
    return height > 0 ? height : 64;
  }

  function mobileSheetAvailableHeight() {
    const topbarHeight = document.querySelector('.topbar')?.getBoundingClientRect().height || 60;
    return Math.max(180, mobileViewportHeight() - topbarHeight - mobileSheetNavHeight());
  }

  function mobileSheetSnapHeight(index) {
    const safeIndex = clamp(Number(index) || 0, 0, SHEET_SNAP_RATIOS.length - 1);
    return Math.min(mobileSheetAvailableHeight(), mobileViewportHeight() * SHEET_SNAP_RATIOS[safeIndex]);
  }

  function mobileSheetPanel(kind) {
    return $(MOBILE_SHEET_IDS[kind]);
  }

  function mobileSheetHistoryKind() {
    return window.history.state?.[MOBILE_SHEET_HISTORY_KEY] || null;
  }

  function trackMobileSheetHistory(kind) {
    if (!isMobile() || !kind) return;
    const currentState = window.history.state && typeof window.history.state === 'object' ? window.history.state : {};
    const nextState = { ...currentState, [MOBILE_SHEET_HISTORY_KEY]: kind };
    if (mobileSheetHistoryKind()) window.history.replaceState(nextState, '', window.location.href);
    else window.history.pushState(nextState, '', window.location.href);
  }

  function releaseMobileSheetHistory() {
    if (!mobileSheetHistoryKind()) return;
    ignoreNextMobileSheetPopstate = true;
    window.history.back();
  }

  function setMobileSheetHeight(panel, index, temporaryHeight = null) {
    if (!panel) return 0;
    const safeIndex = clamp(Number(index) || 0, 0, SHEET_SNAP_RATIOS.length - 1);
    const maxHeight = mobileSheetSnapHeight(SHEET_SNAP_RATIOS.length - 1);
    const minHeight = mobileSheetSnapHeight(0);
    const height = temporaryHeight == null
      ? mobileSheetSnapHeight(safeIndex)
      : clamp(temporaryHeight, Math.max(128, minHeight * 0.62), maxHeight);
    panel.style.setProperty('--sheet-height', `${Math.round(height)}px`);
    if (temporaryHeight == null) {
      sheetSnapIndex.set(panel.id, safeIndex);
      panel.dataset.sheetSnap = String(safeIndex);
      const handle = panel.querySelector('[data-sheet-handle]');
      handle?.setAttribute('aria-valuenow', String(safeIndex));
      handle?.setAttribute('aria-valuetext', SHEET_SNAP_LABELS[safeIndex]);
    }
    return height;
  }

  function resetMobileSheetSession(panel, { applyHeight = true } = {}) {
    if (!panel) return;
    sheetSnapTouched.delete(panel.id);
    sheetSnapIndex.set(panel.id, MOBILE_SHEET_DEFAULT_SNAP);
    if (applyHeight) setMobileSheetHeight(panel, MOBILE_SHEET_DEFAULT_SNAP);
  }


  function refreshMapSheetMetrics() {
    const panels = Object.values(MOBILE_SHEET_IDS).map(id => $(id)).filter(Boolean);
    if (!isMobile()) {
      panels.forEach(panel => panel.style.removeProperty('--sheet-height'));
      document.body.classList.remove('map-sheet-dragging');
      return;
    }
    panels.forEach(panel => {
      if (activeSheetDrag?.panel !== panel) setMobileSheetHeight(panel, sheetSnapIndex.get(panel.id) ?? MOBILE_SHEET_DEFAULT_SNAP);
    });
  }

  function syncEditorPanelControls() {
    const edge = $('togglePanelBtn');
    edge?.classList.toggle('active', surfaceState.editorOpen);
    edge?.setAttribute('aria-expanded', String(surfaceState.editorOpen));
    const edgeLabel = surfaceState.editorOpen ? '편집창 닫기' : '편집창 열기';
    edge?.setAttribute('aria-label', edgeLabel);
    if (edge) edge.dataset.tooltip = edgeLabel;
    const headerToggle = $('mobileCloseRightBtn');
    if (!headerToggle) return;
    const label = layoutMode === 'wide' ? '편집창 접기' : '편집창 닫기';
    headerToggle.setAttribute('aria-label', label);
    headerToggle.dataset.tooltip = label;
  }

  function applyLayoutMode({ initial = false } = {}) {
    const previous = layoutMode;
    layoutMode = detectLayoutMode();
    const app = $('app');
    if (app) app.dataset.layout = layoutMode;
    document.body.dataset.layout = layoutMode;
    surfaceController.syncLayout(previous);
    if (previous === 'mobile' && layoutMode !== 'mobile') releaseMobileSheetHistory();
    else if (layoutMode === 'mobile' && previous !== 'mobile' && surfaceController.activeMobileSheet) {
      trackMobileSheetHistory(surfaceController.activeMobileSheet);
    }
    const fileOpen = !!document.querySelector('.top-actions')?.classList.contains('mobile-open');
    surfaceController.render({ fileOpen });
    if (fileOpen) requestAnimationFrame(syncFileMenuNotificationOffset);
    refreshMapSheetMetrics();
    syncEditorPanelControls();
    syncMobileNavigation();
    requestAnimationFrame(syncMapHudBounds);
    if (!initial && previous !== layoutMode) queueMapResize();
    return previous !== layoutMode;
  }

  function syncOverlayState() {
    const fileOpen = !!document.querySelector('.top-actions')?.classList.contains('mobile-open');
    const view = surfaceController.render({ fileOpen });
    syncEditorPanelControls();
    refreshMapSheetMetrics();
    syncMobileNavigation();
    requestAnimationFrame(syncMapHudBounds);
    if (fileOpen) requestAnimationFrame(syncFileMenuNotificationOffset);
    else $('app')?.style.removeProperty('--file-menu-notification-top');
    return view;
  }

  function syncFileMenuNotificationOffset() {
    const app = $('app');
    const menu = document.querySelector('.top-actions.mobile-open');
    if (!app || layoutMode !== 'mobile' || !menu) {
      app?.style.removeProperty('--file-menu-notification-top');
      return;
    }
    app.style.setProperty('--file-menu-notification-top', `${Math.ceil(menu.getBoundingClientRect().bottom)}px`);
  }

  function closeFileMenu({ restoreFocus = false } = {}) {
    const menu = document.querySelector('.top-actions');
    if (!menu?.classList.contains('mobile-open')) return;
    const trigger = fileMenuTrigger;
    fileMenuTrigger = null;
    menu.classList.remove('mobile-open');
    syncOverlayState();
    if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
  }

  function isCreateMenuOpen() {
    return surfaceController.isOpen('create');
  }

  function closeCreateMenu({ restoreFocus = false } = {}) {
    if (!isCreateMenuOpen()) return;
    closeSurface('create', { restoreFocus });
  }

  function toggleCreateMenu(trigger) {
    toggleSurface('create', trigger);
  }

  function closeActiveMobileSheet({ restoreFocus = false, syncHistory = true } = {}) {
    if (!isMobile() || !surfaceController.activeMobileSheet) return;
    const kind = surfaceController.activeMobileSheet;
    const surface = { map: 'layers', create: 'create', edit: 'editor' }[kind];
    const panel = mobileSheetPanel(kind);
    surfaceController.close(surface);
    resetMobileSheetSession(panel);
    syncOverlayState();
    if (syncHistory) releaseMobileSheetHistory();
    if (restoreFocus && lastOverlayTrigger?.isConnected) lastOverlayTrigger.focus({ preventScroll: true });
    if (restoreFocus) lastOverlayTrigger = null;
  }

  function closeMobileSheets(except = null, { restoreFocus = false } = {}) {
    if (isMobile()) {
      const exceptKind = except === 'left' ? 'map' : except === 'right' ? 'edit' : except === 'create' ? 'create' : null;
      if (surfaceController.activeMobileSheet && surfaceController.activeMobileSheet !== exceptKind) closeActiveMobileSheet({ restoreFocus });
      return;
    }
    if (except !== 'left') surfaceController.close('layers');
    if (except !== 'right') surfaceController.close('editor');
    if (except !== 'create') surfaceController.close('create');
    syncOverlayState();
    if (restoreFocus && lastOverlayTrigger?.isConnected) lastOverlayTrigger.focus({ preventScroll: true });
    if (restoreFocus) lastOverlayTrigger = null;
  }

  function toggleFileMenu() {
    closeCreateMenu();
    const menu = document.querySelector('.top-actions');
    if (!menu) return;
    const willOpen = !menu.classList.contains('mobile-open');
    if (willOpen) fileMenuTrigger = $('mobileFileBtn');
    menu.classList.toggle('mobile-open', willOpen);
    syncOverlayState();
    if (willOpen) requestAnimationFrame(() => menu.querySelector('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true }));
  }

  function nearestSheetSnapIndex(height) {
    let nearest = 0;
    let distance = Infinity;
    SHEET_SNAP_RATIOS.forEach((_, index) => {
      const nextDistance = Math.abs(height - mobileSheetSnapHeight(index));
      if (nextDistance < distance) {
        distance = nextDistance;
        nearest = index;
      }
    });
    return nearest;
  }

  function beginMobileSheetDrag(panel, source, pointerId, clientY) {
    if (!isMobile() || !panel || activeSheetDrag) return false;
    const currentHeight = Number.parseFloat(getComputedStyle(panel).height)
      || setMobileSheetHeight(panel, sheetSnapIndex.get(panel.id) ?? MOBILE_SHEET_DEFAULT_SNAP);
    activeSheetDrag = {
      panel,
      source,
      pointerId,
      startY: clientY,
      startHeight: currentHeight,
      startIndex: sheetSnapIndex.get(panel.id) ?? MOBILE_SHEET_DEFAULT_SNAP,
      startTime: performance.now(),
      moved: false,
    };
    document.body.classList.add('map-sheet-dragging');
    return true;
  }

  function moveMobileSheetDrag(panel, source, pointerId, clientY) {
    const drag = activeSheetDrag;
    if (!drag || drag.panel !== panel || drag.source !== source || drag.pointerId !== pointerId) return false;
    const deltaY = clientY - drag.startY;
    if (Math.abs(deltaY) > 6) drag.moved = true;
    setMobileSheetHeight(panel, drag.startIndex, drag.startHeight - deltaY);
    refreshMapSheetMetrics();
    return true;
  }

  function finishMobileSheetDrag(panel, source, pointerId, clientY, { cancelled = false } = {}) {
    const drag = activeSheetDrag;
    if (!drag || drag.panel !== panel || drag.source !== source || drag.pointerId !== pointerId) return null;
    const deltaY = clientY - drag.startY;
    const currentHeight = Number.parseFloat(getComputedStyle(panel).height) || drag.startHeight;
    const elapsed = Math.max(1, performance.now() - drag.startTime);
    const velocity = deltaY / elapsed;
    activeSheetDrag = null;
    document.body.classList.remove('map-sheet-dragging');
    const dismissDistance = Math.min(180, drag.startHeight * 0.3);
    if (!cancelled && deltaY > 64 && (deltaY >= dismissDistance || velocity > 0.65)) {
      closeActiveMobileSheet({ restoreFocus: true });
    } else {
      let targetIndex = cancelled ? drag.startIndex : nearestSheetSnapIndex(currentHeight);
      if (!cancelled && drag.moved && Math.abs(deltaY) > 24 && Math.abs(velocity) > 0.45) {
        targetIndex = clamp(drag.startIndex + (deltaY < 0 ? 1 : -1), 0, SHEET_SNAP_RATIOS.length - 1);
      }
      if (!cancelled) sheetSnapTouched.add(panel.id);
      setMobileSheetHeight(panel, targetIndex);
      syncOverlayState();
    }
    return drag;
  }

  function bindSheetDragHandle(handle) {
    const panel = $(handle?.dataset?.sheetHandle);
    if (!handle || !panel) return;
    handle.addEventListener('click', event => {
      if (!isMobile()) return;
      if (handle.dataset.dragged === 'true') {
        handle.dataset.dragged = 'false';
        event.preventDefault();
        return;
      }
      const current = sheetSnapIndex.get(panel.id) ?? MOBILE_SHEET_DEFAULT_SNAP;
      const target = current === SHEET_SNAP_RATIOS.length - 1 ? 0 : SHEET_SNAP_RATIOS.length - 1;
      sheetSnapTouched.add(panel.id);
      setMobileSheetHeight(panel, target);
      syncOverlayState();
    });
    handle.addEventListener('keydown', event => {
      if (!isMobile()) return;
      const current = sheetSnapIndex.get(panel.id) ?? MOBILE_SHEET_DEFAULT_SNAP;
      let target;
      if (event.key === 'ArrowUp' || event.key === 'PageUp') target = Math.min(SHEET_SNAP_RATIOS.length - 1, current + 1);
      else if (event.key === 'ArrowDown' || event.key === 'PageDown') target = Math.max(0, current - 1);
      else if (event.key === 'Home') target = 0;
      else if (event.key === 'End') target = SHEET_SNAP_RATIOS.length - 1;
      else if (event.key === 'Escape') {
        closeActiveMobileSheet({ restoreFocus: true });
        event.preventDefault();
        return;
      } else return;
      sheetSnapTouched.add(panel.id);
      setMobileSheetHeight(panel, target);
      refreshMapSheetMetrics();
      event.preventDefault();
    });
    handle.addEventListener('pointerdown', event => {
      if (!isMobile() || event.button > 0) return;
      if (!beginMobileSheetDrag(panel, handle, event.pointerId, event.clientY)) return;
      try { handle.setPointerCapture?.(event.pointerId); } catch (_) {}
      event.preventDefault();
    });
    handle.addEventListener('pointermove', event => {
      if (moveMobileSheetDrag(panel, handle, event.pointerId, event.clientY)) event.preventDefault();
    });
    const finish = (event, cancelled = false) => {
      const drag = finishMobileSheetDrag(panel, handle, event.pointerId, event.clientY, { cancelled });
      if (!drag) return;
      handle.dataset.dragged = String(drag.moved);
      try { handle.releasePointerCapture?.(event.pointerId); } catch (_) {}
    };
    handle.addEventListener('pointerup', event => finish(event));
    handle.addEventListener('pointercancel', event => finish(event, true));
  }

  function bindMobileSheetSurface(panel) {
    if (!panel) return;
    const header = panel.querySelector('.map-sheet-header');
    const handle = panel.querySelector('[data-sheet-handle]');
    if (handle) bindSheetDragHandle(handle);

    if (header) {
      header.addEventListener('pointerdown', event => {
        if (!isMobile() || event.button > 0 || event.target.closest('[data-sheet-handle], button, input, textarea, select')) return;
        if (!beginMobileSheetDrag(panel, header, event.pointerId, event.clientY)) return;
        try { header.setPointerCapture?.(event.pointerId); } catch (_) {}
        event.preventDefault();
      });
      header.addEventListener('pointermove', event => {
        if (moveMobileSheetDrag(panel, header, event.pointerId, event.clientY)) event.preventDefault();
      });
      const finishHeader = (event, cancelled = false) => {
        const drag = finishMobileSheetDrag(panel, header, event.pointerId, event.clientY, { cancelled });
        if (!drag) return;
        try { header.releasePointerCapture?.(event.pointerId); } catch (_) {}
      };
      header.addEventListener('pointerup', event => finishHeader(event));
      header.addEventListener('pointercancel', event => finishHeader(event, true));
    }
  }

  function openSelectionEditor() {
    const panel = $('rightPanel');
    if (!panel) return;
    if (layoutMode === 'wide' && !surfaceState.editorManuallyCollapsed) openSurface('editor', { automatic: true });
    if (panel.classList.contains('mobile-open')) $('editorScrollBody')?.scrollTo?.({ top: 0, behavior: 'instant' });
    syncMobileNavigation();
    if (layoutMode === 'wide') queueMapResize();
  }


  function openSurface(surface, { trigger = null, automatic = false } = {}) {
    if (!['layers', 'create', 'editor'].includes(surface)) return;
    closeFileMenu();
    const activeTrigger = trigger instanceof HTMLElement ? trigger : document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (surface === 'create' && !isMobile()) createMenuTrigger = activeTrigger;
    if (isMobile()) lastOverlayTrigger = activeTrigger;
    surfaceController.open(surface, { automatic });
    if (isMobile()) {
      const kind = { layers: 'map', create: 'create', editor: 'edit' }[surface];
      const panel = mobileSheetPanel(kind);
      resetMobileSheetSession(panel);
      trackMobileSheetHistory(kind);
    }
    syncOverlayState();
    if (surface === 'create' && layoutMode === 'wide') {
      requestAnimationFrame(() => $('createMenu')?.querySelector('[role="menuitem"]')?.focus({ preventScroll: true }));
    }
  }

  function closeSurface(surface, { manual = false, restoreFocus = false, syncHistory = true } = {}) {
    const mobileKind = isMobile() ? { layers: 'map', create: 'create', editor: 'edit' }[surface] : null;
    const mobilePanel = mobileKind ? mobileSheetPanel(mobileKind) : null;
    if (!surfaceController.close(surface, { manual, selected: !!state?.selected })) return;
    if (mobilePanel) resetMobileSheetSession(mobilePanel);
    if (surface === 'editor') closeAllColorPickers();
    syncOverlayState();
    if (mobilePanel && syncHistory) releaseMobileSheetHistory();
    const trigger = surface === 'create' && !isMobile() ? createMenuTrigger : lastOverlayTrigger;
    if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
    if (restoreFocus) lastOverlayTrigger = null;
    if (surface === 'create') createMenuTrigger = null;
  }

  function returnToMapAfterMobileAction(started, { fromCreate = false } = {}) {
    if (!started) return false;
    if (fromCreate && isCreateMenuOpen()) closeCreateMenu();
    if (isMobile()) {
      closeActiveMobileSheet();
      requestAnimationFrame(() => $('map')?.focus({ preventScroll: true }));
    }
    return true;
  }

  function toggleSurface(surface, trigger = null) {
    if (surfaceController.isOpen(surface) && !(surface === 'layers' && layoutMode === 'wide')) {
      closeSurface(surface, { manual: surface === 'editor', restoreFocus: true });
    } else {
      openSurface(surface, { trigger });
    }
  }

  function toggleEditorPanel() {
    toggleSurface('editor', document.activeElement);
  }

  function syncMobileNavigation() {
    const adding = state?.tool === 'new-country' || !!hydroToolConfig(state?.tool) || state?.labelPlacementMode || state?.tool === 'label';
    $('mobileCreateBtn')?.classList.toggle('active', !!adding || isCreateMenuOpen());
    $('createMenuBtn')?.classList.toggle('active', !!adding);
    $('addCountryBtn')?.classList.toggle('active', state?.tool === 'new-country');
    $('addLabelBtn')?.classList.toggle('active', !!state?.labelPlacementMode || state?.tool === 'label');
    $('addRiverBtn')?.classList.toggle('active', state?.tool === 'river');
    $('addLakeBtn')?.classList.toggle('active', state?.tool === 'lake');
    $('mobileEditBtn')?.classList.toggle('needs-attention', !!state?.selected && !surfaceState.editorOpen);
  }

  let mapRenderCoordinator = null;
  function scheduleRender(reason = 'state-change') {
    return mapRenderCoordinator?.scheduleFull(reason) || false;
  }

  function scheduleViewRender(reason = 'view-change') {
    return mapRenderCoordinator?.scheduleView(reason) || false;
  }

  const mapWorkScheduler = (() => {
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
  })();

  const DEFAULT_LAYER_VISIBILITY = Object.freeze({
    countries: true,
    territories: true,
    administrative: true,
    regions: true,
    languages: true,
    ethnicities: true,
    religions: true,
    rivers: true,
    lakes: true,
    drawings: true,
    labels: true,
    basemapLabels: true,
  });

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

  const state = {
    dataReadiness: DATA_READINESS.PREVIEW,
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
    drawings: [],
    hydroEdits: [],
    territorialUnits: [],
    territorialRelations: [],
    distributionLayers: [],
    distributionEntries: [],
    distributionSettings: { renderMode: DISTRIBUTION_RENDER_MODES.DOMINANT, boundaryVisible: true },
    selectedDistributionLayerId: '',
    layerPresentation: normalizeLayerPresentation(),
    selected: null,
    addSelectionMode: false,
    projection: 'globe',
    layerVisibility: normalizeLayerVisibility(),
    physicalSettings: {
      terrainVisible: true,
      terrainStyle: 'political',
      terrainStrength: 0.32,
      hydroLayers: {
        rivers_hydro: true,
        lakes_natural_earth: true,
      },
      hiddenHydroIds: {},
      dataset: PHYSICAL_DATASET,
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
      territories: {},
      administrative: {},
      regions: {},
      languages: {},
      ethnicities: {},
      religions: {},
      hydro: {},
      drawings: {},
      labels: {},
      countryLabels: {},
    },
    layerFolders: {
      countries: false,
      territories: false,
      administrative: false,
      regions: false,
      languages: false,
      ethnicities: false,
      religions: false,
      terrain: false,
      hydro: false,
      drawings: false,
      labels: false,
      countryLabels: false,
    },
    layerSearch: '',
    tool: 'select',
    labelPlacementMode: false,
    coastEditCountryId: null,
    coastEditScopeDrawingId: null,
    coastEditReturnSelection: null,
    boundaryEditCountryIds: [],
    boundaryEditPhase: null,
    boundaryEditInitialSelection: null,
    boundaryEditSeedCountryId: null,
    mergeSourceCountryId: null,
    mergeTargetCountryIds: [],
    drawingMergeSourceId: null,
    drawingMergeTargetIds: [],
    drawingSplitSourceId: null,
    distributionDraft: null,
    territorialUnitMergeSourceId: null,
    territorialUnitMergeTargetIds: [],
    territorialUnitSplitSourceId: null,
    territorialUnitSplitVirtualSource: null,
    territorialUnitRedrawSourceId: null,
    territorialCreateContext: null,
    annexTargetCountryId: null,
    annexDonorCountryIds: [],
    annexPhase: null,
    annexComponentIndex: null,
    annexCandidates: [],
    annexSelectedCandidateIndex: null,
    annexSelectedComponentKeys: [],
    annexSelectionMethod: 'line',
    annexSourceGeometry: null,
    annexRiverPartitionStatus: 'idle',
    annexRiverPartitionCandidates: [],
    annexSelectedRiverPartitionKeys: [],
    annexHoveredRiverPartitionKey: null,
    annexRiverPartitionPreviewGeometry: null,
    newCountryPhase: null,
    newCountrySourceIds: [],
    newCountryCandidates: [],
    newCountrySelectedCandidateIndex: null,
    newCountrySelectedComponentKeys: [],
    newCountrySelectionMethod: 'line',
    newCountrySourceGeometry: null,
    boundaryTopology: { edges: new Map(), nodes: new Map() },
    sharedBoundaryTopology: { segments: new Map(), nodes: new Map() },
    spatialIndex: [],
    mapMoving: false,
    historyDirtyCountryIds: new Set(),
    pendingCountryRenderIds: new Set(),
    sessionBaseCountriesJson: null,
    draftCoords: [],
    draftHover: null,
    draftCutAssessment: null,
    draftEdit: createDraftEditState(),
    draftStroke: createDraftStrokeState(),
    geometryPreview: createGeometryPreviewState(),
    modeProcessing: false,
    modeTaskMinimized: false,
    activeSnap: null,
    audit: { status: 'idle', revision: 0, report: null, selectedIssueId: null },
    hovered: null,
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
  };

  const atomicMapStateController = createAtomicMapStateController({
    applySnapshot: snapshot => {
      if (snapshot.projection) state.projection = snapshot.projection;
      if (snapshot.view) state.view = clampViewZooms({ ...state.view, ...snapshot.view });
      state.transitionRevision = Number(snapshot.stateRevision || state.transitionRevision || 0);
    },
  });

  let objectSelectionSyncing = false;
  const objectSelection = createObjectSelectionController({
    onChange: selection => {
      const primary = selection.items.find(item => item.key === selection.primaryKey) || null;
      state.selected = primary ? normalizeObjectRef(primary) : null;
      if (!selection.items.length) state.addSelectionMode = false;
      syncSelectionSummary(selection);
      syncGpuCountryEmphasis();
      mapRenderCoordinator?.invalidate(
        MAP_RENDER_DIRTY.DYNAMIC_OVERLAYS | MAP_RENDER_DIRTY.SELECTION_DATA | MAP_RENDER_DIRTY.LABEL_LAYOUT | MAP_RENDER_DIRTY.HUD,
        'object-selection',
      );
    },
  });
  const saveState = createSaveStateController({ onChange: syncProjectSaveStatus });

  let objectChooserCandidates = [];

  function countryObjectRef(id) {
    return normalizeObjectRef({ domain: 'territorial', type: TERRITORIAL_UNIT_TYPES.COUNTRY, id: String(id) });
  }

  function setCountryObjectSelection(countryIds, primaryId = countryIds.at(-1), { refreshEditor = true } = {}) {
    const refs = [...new Set(countryIds.map(String).filter(id => countryFeatureById(id)))].map(countryObjectRef).filter(Boolean);
    const primary = countryObjectRef(primaryId) || refs.at(-1) || null;
    objectSelection.setMany(refs, { primary, scope: 'map' });
    if (refreshEditor && primary) selectObjectRef(primary, true);
    if (refs.length > 1) renderMultiSelectionEditor(objectSelection.snapshot());
    return refs;
  }

  function restoreObjectSelectionSnapshot(snapshot) {
    const refs = (snapshot?.items || []).map(normalizeObjectRef).filter(objectRefExists);
    const primary = refs.find(ref => ref.key === snapshot?.primaryKey) || refs.at(-1) || null;
    objectSelection.setMany(refs, { primary, scope: 'map' });
    if (primary) selectObjectRef(primary, true);
    else clearSelection(false);
    if (refs.length > 1) renderMultiSelectionEditor(objectSelection.snapshot());
  }

  function layerItemObjectRef(group, id) {
    const key = String(id);
    if (group === 'countries' || group === 'countryLabels') return normalizeObjectRef({ domain: 'territorial', type: TERRITORIAL_UNIT_TYPES.COUNTRY, id: key });
    if (group === 'territories' || group === 'administrative' || group === 'regions') {
      const fallback = group === 'administrative' ? TERRITORIAL_UNIT_TYPES.ADMIN : group === 'regions' ? TERRITORIAL_UNIT_TYPES.REGION : TERRITORIAL_UNIT_TYPES.TERRITORY;
      return normalizeObjectRef({ domain: 'territorial', type: territorialUnitById(key)?.properties?.unitType || fallback, id: key });
    }
    if (DISTRIBUTION_GROUP_TYPES[group]) return normalizeObjectRef({ domain: 'distribution', type: distributionLayerById(key)?.type || DISTRIBUTION_GROUP_TYPES[group], id: key });
    if (group === 'hydro' && hydroEditById(key)) return normalizeObjectRef({ domain: 'hydro', type: hydroEditById(key)?.properties?.category || 'river', id: key });
    if (group === 'drawings') return normalizeObjectRef({ domain: 'drawing', type: state.drawings.find(item => String(item.id) === key)?.properties?.category || 'custom', id: key });
    if (group === 'labels') return normalizeObjectRef({ domain: 'label', type: state.labels.find(item => String(item.id) === key)?.kind || 'label', id: key });
    return null;
  }

  function objectRefExists(value) {
    const ref = normalizeObjectRef(value);
    if (!ref) return false;
    if (ref.domain === 'territorial') return ref.type === TERRITORIAL_UNIT_TYPES.COUNTRY ? !!countryFeatureById(ref.id) : !!territorialUnitById(ref.id);
    if (ref.domain === 'distribution') return !!distributionLayerById(ref.id);
    if (ref.domain === 'drawing') return state.drawings.some(item => String(item.id) === ref.id);
    if (ref.domain === 'hydro') return !!hydroFeatureById(ref.id);
    if (ref.domain === 'label') return state.labels.some(item => String(item.id) === ref.id);
    return false;
  }

  function objectDisplayInfo(value) {
    const ref = normalizeObjectRef(value);
    if (!ref) return { name: '알 수 없는 객체', type: '' };
    if (ref.domain === 'territorial' && ref.type === TERRITORIAL_UNIT_TYPES.COUNTRY) {
      const feature = countryFeatureById(ref.id);
      return { name: feature ? countryName(feature) : ref.id, type: '국가', detail: feature?.properties?.editor_original_name || '' };
    }
    if (ref.domain === 'territorial') {
      const feature = territorialUnitById(ref.id);
      const type = territorialTypeLabel(ref.type);
      const context = ref.type === TERRITORIAL_UNIT_TYPES.REGION ? '' : territorialUnitCountryName(feature);
      return { name: feature ? territorialUnitName(feature) : ref.id, type, detail: [context, ref.type === TERRITORIAL_UNIT_TYPES.ADMIN ? `${Number(feature?.properties?.adminLevel) || 1}급` : ''].filter(Boolean).join(' · ') };
    }
    if (ref.domain === 'distribution') {
      const layer = distributionLayerById(ref.id);
      return { name: layer?.name || ref.id, type: DISTRIBUTION_TYPE_LABELS[layer?.type || ref.type] || '분포', detail: `${distributionEntriesForLayer(state.distributionEntries, ref.id).length}개 분포` };
    }
    if (ref.domain === 'drawing') {
      const feature = state.drawings.find(item => String(item.id) === ref.id);
      return { name: feature ? drawingName(feature) : ref.id, type: feature ? drawingCategoryLabel(feature) : '지형지물', detail: '' };
    }
    if (ref.domain === 'hydro') {
      const feature = hydroFeatureById(ref.id);
      const category = hydroCategoryKey(feature?.properties?.category || ref.type);
      return { name: hydroEditorName(feature?.properties?.name, hydroFallbackName(category)), type: hydroCategoryLabel(category), detail: hydroSourceLabel(category, { builtin: !hydroEditById(ref.id) }) };
    }
    const label = state.labels.find(item => String(item.id) === ref.id);
    const labelKind = { capital: '수도', city: '도시', town: '마을', region: '지역명', mountain: '산', water: '수역', custom: '기타' };
    return { name: label?.name || ref.id, type: '지명', detail: labelKind[label?.kind] || '지명' };
  }

  function syncObjectSelection(selection) {
    if (objectSelectionSyncing) return;
    const ref = normalizeObjectRef(selection);
    if (ref) objectSelection.replace(ref);
  }

  function renderMultiSelectionEditor(selection = objectSelection.snapshot()) {
    const multiple = selection.items.length > 1;
    if (!multiple) return;
    const types = [...new Set(selection.items.map(item => objectDisplayInfo(item).type))];
    showPropertyForm('multi', `${selection.items.length}개 선택됨`, {
      resetScroll: false,
      typeLabel: types.length === 1 ? types[0] : '여러 유형',
    });
  }

  function syncSelectionSummary(selection = objectSelection.snapshot()) {
    const count = selection.items.length;
    const multiple = count > 1;
    if ($('multiSelectionCount')) $('multiSelectionCount').textContent = `${count}개 선택됨`;
    const modeButton = $('multiSelectionModeBtn');
    if (modeButton) {
      modeButton.textContent = state.addSelectionMode ? '선택 완료' : '추가 선택';
      modeButton.setAttribute('aria-pressed', String(state.addSelectionMode));
      modeButton.disabled = count === 0;
    }
    document.body.classList.toggle('multi-selection-active', multiple);
    if (multiple) {
      const types = [...new Set(selection.items.map(item => objectDisplayInfo(item).type))];
      if ($('selectionStatus')) $('selectionStatus').textContent = `${count}개 선택됨 ${types.join(', ')}`;
      renderMultiSelectionEditor(selection);
    }
    syncBatchActionAvailability();
    syncMapContextSurfaces();
    syncLayerSelectionRows();
  }

  function syncProjectSaveStatus(snapshot = saveState?.snapshot?.() || {}) {
    const status = $('projectSaveStatus');
    if (!status) return;
    status.hidden = !snapshot.hasUnsavedChanges;
    $('projectSaveStatusText').textContent = '미저장';
    status.dataset.tooltip = '저장되지 않은 변경 사항이 있습니다.';
    status.setAttribute('aria-label', '저장되지 않은 변경 사항이 있습니다');
  }

  function selectObjectRef(value, refreshOnly = false) {
    const ref = normalizeObjectRef(value);
    if (!ref || !objectRefExists(ref)) return false;
    objectSelectionSyncing = true;
    try {
      if (ref.domain === 'territorial' && ref.type === TERRITORIAL_UNIT_TYPES.COUNTRY) selectCountry(ref.id, refreshOnly);
      else if (ref.domain === 'territorial') selectTerritorialUnit(ref.id, refreshOnly);
      else if (ref.domain === 'distribution') selectDistributionLayer(ref.id, refreshOnly);
      else if (ref.domain === 'drawing') selectDrawing(ref.id, refreshOnly);
      else if (ref.domain === 'hydro') selectHydro(ref.id, refreshOnly);
      else if (ref.domain === 'label') selectLabel(ref.id, refreshOnly);
    } finally {
      objectSelectionSyncing = false;
    }
    return true;
  }

  function applyObjectSelection(value, { mode = 'replace', orderedRefs = [], scope = 'map' } = {}) {
    const ref = normalizeObjectRef(value);
    if (!ref || !objectRefExists(ref)) return false;
    if (mode === 'toggle') objectSelection.toggle(ref, { scope });
    else if (mode === 'range') objectSelection.selectRange(ref, orderedRefs, { scope });
    else objectSelection.replace(ref, { scope });
    const primary = objectSelection.primary();
    if (primary) selectObjectRef(primary);
    else clearSelection(false);
    const selection = objectSelection.snapshot();
    if (selection.items.length > 1) renderMultiSelectionEditor(selection);
    closeObjectChooser();
    return true;
  }

  function focusObjectRef(value, { announce = true } = {}) {
    const ref = normalizeObjectRef(value);
    if (!ref) return false;
    let feature = null;
    if (ref.domain === 'territorial') feature = ref.type === TERRITORIAL_UNIT_TYPES.COUNTRY ? countryFeatureById(ref.id) : territorialUnitById(ref.id);
    else if (ref.domain === 'drawing') feature = state.drawings.find(item => String(item.id) === ref.id);
    else if (ref.domain === 'hydro') feature = hydroFeatureById(ref.id);
    else if (ref.domain === 'distribution') {
      const features = distributionEntriesForLayer(state.distributionEntries, ref.id).map(entry => {
        const geometry = entry.mode === DISTRIBUTION_MODES.TERRITORIAL ? territorialRepository.get(entry.territorialUnitId)?.geometry : entry.geometry;
        return geometry ? { type: 'Feature', properties: {}, geometry } : null;
      }).filter(Boolean);
      if (features.length) feature = { type: 'FeatureCollection', features };
    } else if (ref.domain === 'label') {
      const label = state.labels.find(item => String(item.id) === ref.id);
      if (label) {
        focusCoordinate(label.coordinates);
        if (announce) setActionStatus(`${label.name} 위치로 이동했습니다.`, 'success', 2200);
        return true;
      }
    }
    if (!feature?.geometry && feature?.type !== 'FeatureCollection') return false;
    const preferredAnchor = ref.domain === 'territorial' && ref.type === TERRITORIAL_UNIT_TYPES.COUNTRY
      && validLabelAnchor(feature.properties?.editor_label_anchor)
      ? feature.properties.editor_label_anchor
      : null;
    focusCountry(feature, { maxZoom: isMobile() ? 12 : 10, preferredAnchor });
    if (announce) setActionStatus(`${objectDisplayInfo(ref).name} 위치로 이동했습니다.`, 'success', 2200);
    return true;
  }

  function layerGroupForObjectRef(value) {
    const ref = normalizeObjectRef(value);
    if (!ref) return '';
    if (ref.domain === 'territorial') return ref.type === TERRITORIAL_UNIT_TYPES.COUNTRY ? 'countries' : ref.type === TERRITORIAL_UNIT_TYPES.ADMIN ? 'administrative' : ref.type === TERRITORIAL_UNIT_TYPES.REGION ? 'regions' : 'territories';
    if (ref.domain === 'distribution') return DISTRIBUTION_TYPE_GROUPS[ref.type] || '';
    if (ref.domain === 'hydro' && hydroEditById(ref.id)) return 'hydro';
    if (ref.domain === 'drawing') return 'drawings';
    if (ref.domain === 'label') return 'labels';
    return '';
  }

  function objectBatchCapabilities(value) {
    const ref = normalizeObjectRef(value);
    if (!ref) return new Set();
    if (ref.domain === 'hydro' && !hydroEditById(ref.id)) return new Set();
    const values = new Set(['visible']);
    if (ref.domain === 'territorial') {
      values.add('color');
      values.add('lock');
      if (ref.type !== TERRITORIAL_UNIT_TYPES.COUNTRY && !territorialChildren(state.territorialUnits, ref.id).length) values.add('delete');
    } else if (ref.domain === 'distribution') {
      values.add('color'); values.add('lock'); values.add('delete');
    } else if (ref.domain === 'drawing' || ref.domain === 'hydro') {
      values.add('color'); values.add('lock'); values.add('delete');
    } else if (ref.domain === 'label') values.add('delete');
    return values;
  }

  function commonBatchCapabilities(refs = objectSelection.items()) {
    if (!refs.length) return new Set();
    const common = objectBatchCapabilities(refs[0]);
    for (const ref of refs.slice(1)) for (const capability of [...common]) if (!objectBatchCapabilities(ref).has(capability)) common.delete(capability);
    if (refs.some(ref => ref.domain === 'territorial' && ref.type === TERRITORIAL_UNIT_TYPES.COUNTRY)
      && !refs.every(ref => ref.domain === 'territorial' && ref.type === TERRITORIAL_UNIT_TYPES.COUNTRY)) {
      common.delete('lock');
    }
    return common;
  }

  function isCountryLocked(id) {
    return state.countryOverrides?.[String(id)]?.locked === true;
  }

  function setCountryLockedState(id, locked) {
    const key = String(id || '');
    if (!key || !countryFeatureById(key)) return false;
    const override = { ...(state.countryOverrides[key] || {}) };
    if (locked) override.locked = true;
    else delete override.locked;
    if (Object.keys(override).length) state.countryOverrides[key] = override;
    else delete state.countryOverrides[key];
    return true;
  }

  function lockedCountryIds(ids = []) {
    return [...new Set(ids.map(String).filter(Boolean))].filter(isCountryLocked);
  }

  function requireCountriesUnlocked(ids, action = '편집') {
    const lockedIds = lockedCountryIds(ids);
    if (!lockedIds.length) return true;
    const names = lockedIds.slice(0, 3).map(id => countryFeatureById(id)).filter(Boolean).map(countryName);
    const suffix = lockedIds.length > names.length ? ` 외 ${lockedIds.length - names.length}개국` : '';
    setActionStatus(`${names.join(', ')}${suffix} 잠금을 해제한 뒤 ${action}할 수 있습니다.`, 'error', 3800);
    return false;
  }

  function objectRefLocked(value) {
    const ref = normalizeObjectRef(value);
    if (!ref) return false;
    if (ref.domain === 'territorial') return ref.type === TERRITORIAL_UNIT_TYPES.COUNTRY ? isCountryLocked(ref.id) : territorialUnitById(ref.id)?.properties?.locked === true;
    if (ref.domain === 'distribution') return distributionLayerById(ref.id)?.locked === true;
    if (ref.domain === 'drawing') return state.drawings.find(item => String(item.id) === ref.id)?.properties?.locked === true;
    if (ref.domain === 'hydro') return hydroEditById(ref.id)?.properties?.locked === true;
    return false;
  }

  function objectRefVisible(value) {
    const ref = normalizeObjectRef(value);
    const group = layerGroupForObjectRef(ref);
    return !!(ref && group && isLayerItemVisible(group, ref.id));
  }

  function syncBatchBooleanInput(input, values, enabled) {
    if (!input) return;
    const activeCount = values.filter(Boolean).length;
    input.disabled = !enabled;
    input.checked = enabled && values.length > 0 && activeCount === values.length;
    input.indeterminate = enabled && activeCount > 0 && activeCount < values.length;
    input.setAttribute('aria-checked', input.indeterminate ? 'mixed' : String(input.checked));
    const option = input.closest('.multi-property-option');
    if (option) {
      if (enabled) delete option.dataset.tooltip;
      else option.dataset.tooltip = '선택한 모든 객체에 공통으로 적용할 수 없습니다.';
    }
  }

  function syncBatchActionAvailability() {
    const refs = objectSelection.items();
    const capabilities = commonBatchCapabilities(refs);
    syncBatchBooleanInput($('multiPropertiesVisibilityInput'), refs.map(objectRefVisible), capabilities.has('visible'));
    syncBatchBooleanInput($('multiPropertiesLockInput'), refs.map(objectRefLocked), capabilities.has('lock'));
    if ($('multiPropertiesColorInput')) $('multiPropertiesColorInput').disabled = !capabilities.has('color');
    if ($('multiPropertiesColorTrigger')) $('multiPropertiesColorTrigger').disabled = !capabilities.has('color');
    const countryOnly = refs.length >= 2 && refs.every(ref => ref.domain === 'territorial' && ref.type === TERRITORIAL_UNIT_TYPES.COUNTRY);
    $('multiCountryActions')?.classList.toggle('hidden', !countryOnly);
    const borderButton = $('multiBorderEditBtn');
    const borderHelp = $('multiBorderEditHelp');
    if (countryOnly) {
      const analysis = boundaryEditSelectionAnalysis(refs.map(ref => ref.id), { rebuild: true });
      const lockedIds = refs.map(ref => ref.id).filter(isCountryLocked);
      if (borderButton) {
        borderButton.disabled = lockedIds.length > 0 || !analysis.valid;
        borderButton.dataset.tooltip = lockedIds.length ? '잠긴 국가를 해제한 뒤 국경을 조정하세요.' : analysis.message;
      }
      if (borderHelp) {
        const message = lockedIds.length ? `잠긴 국가 ${lockedIds.length}개를 해제해야 국경을 조정할 수 있습니다.` : analysis.message;
        borderHelp.textContent = message;
        borderHelp.classList.toggle('hidden', !message);
      }
    } else {
      if (borderButton) {
        borderButton.disabled = true;
        delete borderButton.dataset.tooltip;
      }
      if (borderHelp) {
        borderHelp.textContent = '';
        borderHelp.classList.add('hidden');
      }
    }
    syncObjectActionsMenu();
  }

  function batchSetVisibility(nextVisible = null) {
    const refs = objectSelection.items();
    if (!refs.length || !commonBatchCapabilities(refs).has('visible')) return;
    const allVisible = refs.every(ref => isLayerItemVisible(layerGroupForObjectRef(ref), ref.id));
    const visible = typeof nextVisible === 'boolean' ? nextVisible : !allVisible;
    if (refs.every(ref => objectRefVisible(ref) === visible)) return;
    for (const ref of refs) {
      const group = layerGroupForObjectRef(ref);
      if (!group) continue;
      state.itemVisibility[group] ||= {};
      if (visible) delete state.itemVisibility[group][ref.id];
      else state.itemVisibility[group][ref.id] = false;
    }
    if (refs.some(ref => ref.domain === 'territorial' && ref.type === TERRITORIAL_UNIT_TYPES.COUNTRY)) {
      gpuMapRenderer.invalidateCountryPalette({ base: true, emphasis: true }, 'batch-country-visibility');
    }
    markLayerTreeDirty();
    renderAll();
    queuePresentationAutosave();
    syncBatchActionAvailability();
  }

  function batchSetLocked(nextLocked = null) {
    const refs = objectSelection.items();
    if (!refs.length || !commonBatchCapabilities(refs).has('lock')) return;
    const locked = typeof nextLocked === 'boolean' ? nextLocked : !refs.every(objectRefLocked);
    if (refs.every(ref => objectRefLocked(ref) === locked)) return;
    recordHistory({ type: 'batch-lock', description: `${refs.length}개 객체 ${locked ? '잠금' : '잠금 해제'}`, affectedIds: refs.map(ref => ref.id) });
    for (const ref of refs) {
      if (ref.domain === 'territorial' && ref.type === TERRITORIAL_UNIT_TYPES.COUNTRY) setCountryLockedState(ref.id, locked);
      else if (ref.domain === 'territorial') territorialUnitById(ref.id).properties.locked = locked;
      else if (ref.domain === 'distribution') distributionLayerById(ref.id).locked = locked;
      else if (ref.domain === 'drawing') {
        const feature = state.drawings.find(item => String(item.id) === ref.id);
        if (feature) feature.properties.locked = locked;
      } else if (ref.domain === 'hydro') {
        const feature = hydroEditById(ref.id);
        if (feature) feature.properties.locked = locked;
      }
    }
    syncObjectLockStateChange(refs);
    renderAll();
    queueAutosave();
    const primary = objectSelection.primary();
    if (primary) selectObjectRef(primary, true);
    syncBatchActionAvailability();
  }

  function batchToggleLocked() {
    return batchSetLocked();
  }

  let objectActionsMenuTrigger = null;

  function closeObjectActionsMenu({ restoreFocus = false } = {}) {
    const menu = $('objectActionsMenu');
    if (!menu) return;
    const wasOpen = !menu.classList.contains('hidden');
    const trigger = objectActionsMenuTrigger;
    menu.classList.add('hidden');
    menu.style.removeProperty('left');
    menu.style.removeProperty('top');
    trigger?.setAttribute('aria-expanded', 'false');
    objectActionsMenuTrigger = null;
    if (restoreFocus && wasOpen && trigger?.isConnected) trigger.focus({ preventScroll: true });
  }

  function syncObjectActionsMenu() {
    const refs = objectSelection.items();
    const primary = objectSelection.primary();
    const capabilities = commonBatchCapabilities(refs);
    const locked = refs.length > 0 && refs.every(objectRefLocked);
    const canLock = refs.length > 0 && capabilities.has('lock');
    const canDelete = refs.length > 1
      ? capabilities.has('delete')
      : !!primary && (primary.domain !== 'hydro' || !!hydroEditById(primary.id));
    const deleteDisabled = !canDelete || !!(primary && objectRefLocked(primary));
    const lockLabel = locked ? '잠금 해제' : '잠금';
    const canReconcileCoast = refs.length === 1
      && !!primary
      && primary.domain === 'territorial'
      && primary.type === TERRITORIAL_UNIT_TYPES.ADMIN
      && !!territorialUnitById(primary.id)?.properties?.sovereignId;
    const separatorVisible = canDelete && (canLock || canReconcileCoast);

    const lockMenuButton = $('objectLockMenuBtn');
    if (lockMenuButton) {
      $('objectLockMenuLabel').textContent = lockLabel;
      $('objectLockMenuIcon')?.setAttribute('href', locked ? '#icon-lock-open' : '#icon-lock-closed');
      lockMenuButton.classList.toggle('hidden', !canLock);
      lockMenuButton.disabled = !canLock;
      lockMenuButton.setAttribute('aria-label', lockLabel);
    }

    const deleteMenuButton = $('objectDeleteMenuBtn');
    if (deleteMenuButton) {
      deleteMenuButton.classList.toggle('hidden', !canDelete);
      deleteMenuButton.disabled = deleteDisabled;
      deleteMenuButton.dataset.tooltip = deleteDisabled && canDelete ? '잠금 해제 후 삭제' : '삭제';
      deleteMenuButton.setAttribute('aria-label', deleteMenuButton.dataset.tooltip);
    }

    const coastMenuButton = $('objectCoastReconcileMenuBtn');
    if (coastMenuButton) {
      coastMenuButton.classList.toggle('hidden', !canReconcileCoast);
      coastMenuButton.disabled = !canReconcileCoast || !!(primary && objectRefLocked(primary));
      coastMenuButton.dataset.tooltip = coastMenuButton.disabled ? '잠금 해제 후 해안선 정합' : '해안선 정합';
      coastMenuButton.setAttribute('aria-label', coastMenuButton.dataset.tooltip);
    }

    $('objectActionsMenu')?.querySelector('.object-actions-separator')?.toggleAttribute('hidden', !separatorVisible);

    const lockButton = $('objectLockBtn');
    if (lockButton) {
      lockButton.classList.toggle('hidden', !canLock);
      lockButton.disabled = !canLock;
      lockButton.setAttribute('aria-pressed', String(locked));
      lockButton.setAttribute('aria-label', lockLabel);
      lockButton.dataset.tooltip = lockLabel;
      $('objectLockIcon')?.setAttribute('href', locked ? '#icon-lock-closed' : '#icon-lock-open');
    }

    const deleteButton = $('objectDeleteBtn');
    if (deleteButton) {
      deleteButton.classList.toggle('hidden', !canDelete);
      deleteButton.disabled = deleteDisabled;
      deleteButton.dataset.tooltip = deleteDisabled && canDelete ? '잠금 해제 후 삭제' : '삭제';
      deleteButton.setAttribute('aria-label', deleteButton.dataset.tooltip);
    }
  }

  function positionObjectActionsMenu(trigger) {
    const menu = $('objectActionsMenu');
    if (!menu || !trigger?.isConnected || menu.classList.contains('hidden')) return;
    const rootStyle = getComputedStyle(document.documentElement);
    const edge = Number.parseFloat(rootStyle.getPropertyValue('--ui-popover-screen-edge')) || 8;
    const gap = Number.parseFloat(rootStyle.getPropertyValue('--ui-space-1')) || 4;
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft || 0;
    const viewportTop = viewport?.offsetTop || 0;
    const viewportRight = viewportLeft + (viewport?.width || window.innerWidth);
    const viewportBottom = viewportTop + (viewport?.height || window.innerHeight);
    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const minLeft = viewportLeft + edge;
    const maxLeft = Math.max(minLeft, viewportRight - menuRect.width - edge);
    const left = clamp(triggerRect.right - menuRect.width, minLeft, maxLeft);
    const belowTop = triggerRect.bottom + gap;
    const aboveTop = triggerRect.top - gap - menuRect.height;
    const preferredTop = belowTop + menuRect.height <= viewportBottom - edge || aboveTop < viewportTop + edge
      ? belowTop
      : aboveTop;
    const minTop = viewportTop + edge;
    const maxTop = Math.max(minTop, viewportBottom - menuRect.height - edge);
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(clamp(preferredTop, minTop, maxTop))}px`;
  }

  function openObjectActionsMenu(trigger) {
    const menu = $('objectActionsMenu');
    if (!menu || !trigger || !objectSelection.primary()) return;
    const toggleClosed = objectActionsMenuTrigger === trigger && !menu.classList.contains('hidden');
    closeObjectActionsMenu();
    if (toggleClosed) return;
    syncObjectActionsMenu();
    objectActionsMenuTrigger = trigger;
    trigger.setAttribute('aria-expanded', 'true');
    menu.classList.remove('hidden');
    positionObjectActionsMenu(trigger);
    requestAnimationFrame(() => menu.querySelector('[role="menuitem"]:not(.hidden):not(:disabled)')?.focus());
  }

  function deleteSelectedFromObjectMenu() {
    closeObjectActionsMenu();
    if (objectSelection.items().length > 1) requestBatchDelete();
    else if ((state.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY)) deleteSelectedCountry();
    else if ((state.selected?.domain === 'territorial' && state.selected.type !== TERRITORIAL_UNIT_TYPES.COUNTRY)) requestTerritorialUnitDivisionRemoval(state.selected.id);
    else {
      const primary = objectSelection.primary();
      if (!primary) return;
      const info = objectDisplayInfo(primary);
      openConfirmModal({
        title: `${info.type} 삭제`,
        message: `${info.name} 객체를 지도에서 삭제합니다. 실행취소로 복구할 수 있습니다.`,
        impacts: [`${info.type} 1개 삭제`, '연결된 표시·설정 정리'],
        confirmText: '삭제',
        danger: true,
        onConfirm: deleteSelected,
      });
    }
  }

  function batchSetColor(color) {
    const refs = objectSelection.items();
    if (!refs.length || !commonBatchCapabilities(refs).has('color')) return;
    const normalizedColor = normalizeEditorColor(color, DEFAULT_DRAWING_COLOR);
    recordHistory({ type: 'batch-color', description: `${refs.length}개 객체 색상 변경`, affectedIds: refs.map(ref => ref.id) });
    for (const ref of refs) {
      if (ref.domain === 'territorial' && ref.type === TERRITORIAL_UNIT_TYPES.COUNTRY) {
        state.countryOverrides[ref.id] ||= {};
        writeDomainColor(COLOR_DOMAINS.COUNTRY, {
          feature: countryFeatureById(ref.id), override: state.countryOverrides[ref.id],
        }, normalizedColor, { fallback: defaultCountryColor() });
      } else if (ref.domain === 'territorial') {
        const feature = territorialUnitById(ref.id);
        if (feature) writeDomainColor(COLOR_DOMAINS.TERRITORIAL, { feature }, normalizedColor, { fallback: DEFAULT_DRAWING_COLOR });
      } else if (ref.domain === 'distribution') {
        const layer = distributionLayerById(ref.id);
        if (layer) writeDomainColor(COLOR_DOMAINS.DISTRIBUTION, { layer }, normalizedColor, { fallback: DEFAULT_DRAWING_COLOR });
      } else if (ref.domain === 'drawing') {
        const feature = state.drawings.find(item => String(item.id) === ref.id);
        if (feature) writeDomainColor(COLOR_DOMAINS.DRAWING, { feature }, normalizedColor, { fallback: defaultDrawingColor(feature) });
      } else if (ref.domain === 'hydro') {
        const feature = hydroEditById(ref.id);
        if (feature) feature.properties.editorColor = normalizedColor;
      }
    }
    if (refs.some(ref => ref.domain === 'territorial' && ref.type === TERRITORIAL_UNIT_TYPES.COUNTRY)) {
      gpuMapRenderer.invalidateCountryPalette({ base: true, emphasis: true }, 'batch-country-color');
    }
    markLayerTreeDirty();
    renderAll();
    queueAutosave();
    syncBatchActionAvailability();
  }

  function requestBatchDelete() {
    const refs = objectSelection.items();
    if (!refs.length || !commonBatchCapabilities(refs).has('delete')) return;
    const typeCounts = new Map();
    for (const ref of refs) {
      const type = objectDisplayInfo(ref).type;
      typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
    }
    openConfirmModal({
      title: `${refs.length}개 객체 삭제`,
      message: '선택한 객체와 직접 연결된 데이터가 함께 삭제됩니다. 한 번의 실행취소로 복구할 수 있습니다.',
      impacts: [...typeCounts].map(([type, count]) => `${type} ${count}개 삭제`),
      confirmText: '선택 객체 삭제',
      danger: true,
      onConfirm: () => {
        recordHistory({ type: 'batch-delete', description: `${refs.length}개 객체 삭제`, affectedIds: refs.map(ref => ref.id) });
        const removedDistributionIds = new Set(refs.filter(ref => ref.domain === 'distribution').map(ref => ref.id));
        const removedHydroEditIds = new Set(refs.filter(ref => ref.domain === 'hydro').map(ref => ref.id));
        const removedDrawingIds = new Set(refs.filter(ref => ref.domain === 'drawing').map(ref => ref.id));
        const removedLabelIds = new Set(refs.filter(ref => ref.domain === 'label').map(ref => ref.id));
        const removedUnitIds = new Set(refs.filter(ref => ref.domain === 'territorial' && ref.type !== TERRITORIAL_UNIT_TYPES.COUNTRY).map(ref => ref.id));
        let expanded = true;
        while (expanded) {
          expanded = false;
          for (const feature of state.territorialUnits) {
            if (!removedUnitIds.has(String(feature.properties?.parentId)) || removedUnitIds.has(String(feature.id))) continue;
            removedUnitIds.add(String(feature.id));
            expanded = true;
          }
        }
        state.distributionLayers = state.distributionLayers.filter(layer => !removedDistributionIds.has(String(layer.id)));
        state.distributionEntries = state.distributionEntries.filter(entry => !removedDistributionIds.has(String(entry.layerId))
          && (entry.mode !== DISTRIBUTION_MODES.TERRITORIAL || !removedUnitIds.has(String(entry.territorialUnitId))));
        const restoredHydroSourceIds = state.hydroEdits.filter(feature => removedHydroEditIds.has(String(feature.id))).map(feature => String(feature.properties?.sourceFeatureId || '')).filter(Boolean);
        state.hydroEdits = state.hydroEdits.filter(feature => !removedHydroEditIds.has(String(feature.id)));
        for (const sourceId of restoredHydroSourceIds) {
          if (!state.hydroEdits.some(feature => String(feature.properties?.sourceFeatureId || '') === sourceId)) delete state.physicalSettings.hiddenHydroIds[sourceId];
        }
        if (restoredHydroSourceIds.length) gpuMapRenderer.invalidateHydroVisibility();
        for (const layer of state.distributionLayers) if (removedDistributionIds.has(String(layer.parentId))) layer.parentId = '';
        reassignDrawingParents([...removedDrawingIds]);
        state.drawings = state.drawings.filter(feature => !removedDrawingIds.has(String(feature.id)));
        state.labels = state.labels.filter(label => !removedLabelIds.has(String(label.id)));
        for (const id of removedLabelIds) delete state.labelSettings[labelKey('label', id)];
        state.territorialUnits = state.territorialUnits.filter(feature => !removedUnitIds.has(String(feature.id)));
        state.territorialRelations = state.territorialRelations.filter(relation => !removedUnitIds.has(String(relation.unitId)) && !removedUnitIds.has(String(relation.parentId)));
        objectSelectionSyncing = true;
        objectSelection.clear();
        objectSelectionSyncing = false;
        state.selected = null;
        state.addSelectionMode = false;
        showPropertyForm(null);
        markLayerTreeDirty();
        renderAll();
        queueAutosave();
        setActionStatus(`${refs.length}개 객체를 삭제했습니다.`, 'success', 2800);
      },
    });
  }

  let baseSvg;
  let svg;
  let root;
  let shadowLayer;
  let oceanLayer;
  let graticuleLayer;
  let countryLayer;
  let previewLayer;
  let hoverLayer;
  let selectionLayer;
  let selectionEmphasisRenderer = null;
  const selectionBoundaryGeometryCache = new Map();
  const selectionProjectedPathCache = new Map();
  const selectionOverlayDiagnostics = {
    failureCount: 0,
    lastFailureStage: '',
    retainedPreviousFrame: false,
    fallbackCount: 0,
    fallbackPathMs: 0,
    geometryCacheHits: 0,
    geometryCacheMisses: 0,
    projectedPathCacheHits: 0,
    projectedPathCacheMisses: 0,
  };
  let selectionOverlayStage = '';
  let validationLayer;
  let snapLayer;
  let boundaryEditLayer;
  let overlayStackLayer;
  let territorialBoundaryLayer;
  let territorialOperationLayer;
  let territorialUnitLayer;
  let distributionLayer;
  let drawingLayer;
  let hydroLakeLayer;
  let hydroRiverLayer;
  let hydroEditLayer;
  let countryLabelLayer;
  let labelLayer;
  let vertexLayer;
  let draftLayer;
  let mapInteractionLayer;
  let territorialBoundaryCache = { countries: null, units: null, unitGeometryRevision: -1, segments: [], rebuildCount: 0 };
  let territorialBoundaryBatchCache = { signature: '', revision: '', groups: [] };
  let mapResizeObserver = null;
  let mapResizeFrame = 0;
  let mapResizeSignature = '';
  let resolutionQuery = null;
  let viewRevision = 0;
  let renderedViewSignature = '';
  let editInteractionRevision = 0;
  let mapInputController = null;
  let draftStrokeRenderFrame = 0;
  let geometryBoundsCache = new WeakMap();
  let countryOutlineCache = new WeakMap();
  let geometryAreaDisplayCache = new WeakMap();
  let pendingCountryAreaDisplay = new WeakSet();
  let countryProjectedBoundsCache = new WeakMap();
  let drawingLandClipCache = new WeakMap();
  const mapObjectSpatialIndex = createMapObjectSpatialIndex();
  const mapObjectDistributionRowCache = new Map();
  const mapObjectSpatialIndexSources = new Map();
  const mapObjectGeometryRevisions = { label: 0, drawing: 0, territorial: 0, hydro: 0 };
  let distributionVisibilityRevision = 0;
  let distributionRenderRowCache = {
    layers: null,
    entries: null,
    countries: null,
    countryGeometryRevision: -1,
    territorialUnits: null,
    renderMode: '',
    selectedLayerId: '',
    visibilityRevision: -1,
    rows: [],
    rebuildCount: 0,
    buildMs: 0,
  };
  let labelLayoutMetrics = {};
  const viewportCullingMetrics = {
    queryCount: 0,
    candidateCount: 0,
    finalVisibleCount: 0,
    projectedVerificationCount: 0,
    projectedVerificationMs: 0,
    lastByDomain: {},
  };
  const selectionPerformanceMetrics = {
    inputToPresentMs: 0,
    handlerMs: 0,
    indexQueryMs: 0,
    indexedCandidateCount: 0,
    exactHitTestCount: 0,
    fullScanCount: 0,
    gpuPickMs: 0,
    pickCacheHit: false,
    direct: false,
  };
  let countryLandRevision = 0;
  const pendingCountryLabelAnchors = new Set();
  const countryLabelAnchorVersions = new Map();
  const countryLabelScreenAreas = new Map();
  let countryDisplaySource = null;
  let countryDisplayIndex = new Map();
  let hoverPickFrame = 0;
  let pendingHoverPick = null;
  let lastHoverPickPoint = null;
  let lastHoverPickViewRevision = -1;
  let countryLabelAnchorWorker = null;
  let countryLabelAnchorTimer = 0;
  let countryLabelAnchorRequestId = 0;
  let geometryValidationWorker = null;
  let geometryValidationRequestId = 0;
  let riverPartitionWorker = null;
  let riverPartitionGeneration = 0;
  let riverPartitionWorkerRequestId = 0;
  const riverPartitionRequests = new Map();
  const riverPartitionCache = new Map();
  let activeGeometryPreviewApply = null;
  let activeGeometryPreviewDiscard = null;
  let snapCandidateCache = { key: '', candidates: [] };

  const globeProjection = d3.geo.orthographic().clipAngle(90).precision(isMobile() ? 0.9 : 0.35);
  const flatProjection = d3.geo.equirectangular().precision(isMobile() ? 0.7 : 0.25);
  const path = d3.geo.path().pointRadius(5);
  const graticule = d3.geo.graticule();



  const gpuMapRenderer = createGpuMapRenderer({
    APP_VERSION,
    ASSET_REVISION,
    PHYSICAL_DATA_BASE_URL,
    activeProjection,
    countryColor,
    countryFeatureById,
    countryOutlineFeature,
    d3,
    deepClone,
    defaultCountryColor,
    flatProjection,
    getSystemTheme: () => document.documentElement.dataset.theme || window.__PANDOLAB_THEME__ || systemTheme,
    globeProjection,
    hydroDisplayColor,
    hydroFeatureById,
    hydroVisibilityThreshold,
    isCountryVisibleById,
    isHydroFeatureVisible,
    isLayerItemVisible,
    isMobile,
    isSafeKoreanErrorMessage,
    mapTheme,
    mapWorkScheduler,
    prepareHydroFeature,
    queueMapResize,
    renderPendingCountryOverlays,
    renderViewFrame,
    reportOperationError,
    rendererUi: {
      createCanvas: () => document.createElement('canvas'),
      getMapElement: () => $('map'),
      setEngineStatus: text => {
        const status = $('engineStatus');
        if (!status) return;
        status.textContent = text;
        status.dataset.tooltip = text;
      },
    },
    runtimeAssetUrl,
    scheduleGpuFrame: reason => mapRenderCoordinator?.invalidate(MAP_RENDER_DIRTY.GPU_FRAME, reason) || false,
    scheduleGpuMeshRebuild,
    setActionStatus,
    state,
  });

  function syncResolvedInteractionStyle({ redraw = false } = {}) {
    resolvedInteractionStyle = resolveCurrentInteractionStyle();
    setSelectionInteractionStyle(resolvedInteractionStyle);
    selectionEmphasisRenderer?.setInteractionStyle?.(resolvedInteractionStyle);
    gpuMapRenderer.setInteractionStyle?.(resolvedInteractionStyle);
    document.documentElement.style.setProperty('--map-selection-halo', resolvedInteractionStyle.selection.color);
    window.__PANDOLAB_INTERACTION_STYLE__ = resolvedInteractionStyle;
    if (redraw) {
      mapRenderCoordinator?.invalidate(MAP_RENDER_DIRTY.SELECTION_STYLE | MAP_RENDER_DIRTY.GPU_FRAME, 'selection-style');
    }
    return resolvedInteractionStyle;
  }

  let gpuRebuildTimer = null;
  function scheduleGpuMeshRebuild(delay = 80) {
    clearTimeout(gpuRebuildTimer);
    gpuRebuildTimer = setTimeout(() => {
      mapEditClient.rebase(state.countriesData?.features || []);
      gpuMapRenderer.rebuildFromCountries(state.countriesData?.features || []);
    }, delay);
  }

  function cpuCountryAtCoordinate(coord) {
    if (!coord) return null;
    const candidates = state.spatialIndex || [];
    for (let i = candidates.length - 1; i >= 0; i -= 1) {
      const item = candidates[i];
      const b = item.bounds;
      if (coord[0] < b[0] || coord[0] > b[2] || coord[1] < b[1] || coord[1] > b[3]) continue;
      const feature = item.feature;
      if (!isLayerItemVisible('countries', feature.properties?.editor_id || '')) continue;
      if (pointInCountryFeature(coord, feature)) return feature;
    }
    return null;
  }

  function countryAtScreenPoint(screenPoint, coord, { verify = true } = {}) {
    const gpuId = gpuMapRenderer.pick(screenPoint);
    const gpuFeature = gpuId ? countryFeatureById(gpuId) : null;
    if (gpuFeature && isLayerItemVisible('countries', gpuId) && (!verify || pointInCountryFeature(coord, gpuFeature))) return gpuFeature;
    return cpuCountryAtCoordinate(coord);
  }

  function cancelCountryHoverPick({ clear = false } = {}) {
    if (hoverPickFrame) clearTimeout(hoverPickFrame);
    hoverPickFrame = 0;
    pendingHoverPick = null;
    lastHoverPickPoint = null;
    lastHoverPickViewRevision = -1;
    if (clear && state.hovered?.type === 'country') {
      state.hovered = null;
      renderHoverOverlay();
    }
  }

  function queueCountryHoverPick(screenPoint, coord) {
    if (!screenPoint || !coord || state.mapMoving || state.draftEdit.dragging || state.tool !== 'select') return;
    if (lastHoverPickPoint && Math.hypot(screenPoint[0] - lastHoverPickPoint[0], screenPoint[1] - lastHoverPickPoint[1]) < 3) return;
    pendingHoverPick = { screenPoint: [...screenPoint], coord: [...coord] };
    if (hoverPickFrame) return;
    hoverPickFrame = setTimeout(() => {
      hoverPickFrame = 0;
      const pending = pendingHoverPick;
      pendingHoverPick = null;
      if (!pending || state.mapMoving || state.draftEdit.dragging || state.tool !== 'select') return;
      lastHoverPickPoint = pending.screenPoint;
      lastHoverPickViewRevision = viewRevision;
      const hoveredCountry = state.layerVisibility.countries
        ? countryAtScreenPoint(pending.screenPoint, pending.coord, { verify: false })
        : null;
      const nextId = hoveredCountry ? String(hoveredCountry.properties?.editor_id || '') : '';
      if (String(state.hovered?.id || '') === nextId && (!nextId || state.hovered?.type === 'country')) return;
      state.hovered = hoveredCountry ? { type: 'country', id: nextId, feature: hoveredCountry, ref: countryObjectRef(nextId) } : null;
      renderHoverOverlay();
    }, 50);
  }

  function hydroLineParts(geometry) {
    if (geometry?.type === 'LineString') return [geometry.coordinates || []];
    if (geometry?.type === 'MultiLineString') return geometry.coordinates || [];
    return [];
  }

  async function hydroAtScreenPoint(screenPoint, coord) {
    const hydroCategoryVisible = state.layerVisibility.rivers || state.layerVisibility.lakes;
    if (!hydroCategoryVisible || state.tool !== 'select') return null;
    for (const feature of [...state.hydroEdits].reverse()) {
      if (!isHydroFeatureVisible(feature) || !geometryHitsScreenPoint(feature.geometry, coord, screenPoint, isMobile() ? 14 : 8)) continue;
      return feature;
    }
    const picked = gpuMapRenderer.pickHydro(screenPoint) || await gpuMapRenderer.pickHydroAsync(screenPoint);
    if (picked && isHydroFeatureVisible(picked) && hydroFeatureInView(picked)) return picked;
    const projection = activeProjection();
    const toleranceDegrees = 9 / Math.max(1, projection.scale()) * 180 / Math.PI;
    let nearest = null;
    for (const feature of allBuiltInHydroFeatures()) {
      if (!feature.geometry) continue;
      if (!hydroFeatureInView(feature)) continue;
      const bounds = feature.__awBounds || [-180, -90, 180, 90];
      const category = feature.properties?.category;
      if (category === 'lake') {
        if (coord[0] >= bounds[0] && coord[0] <= bounds[2] && coord[1] >= bounds[1] && coord[1] <= bounds[3] && pointInCountryFeature(coord, feature)) return feature;
        continue;
      }
      if (coord[1] < bounds[1] - toleranceDegrees || coord[1] > bounds[3] + toleranceDegrees) continue;
      for (const line of hydroLineParts(feature.geometry)) {
        for (let index = 0; index < line.length - 1; index += 1) {
          if (!isCoordVisible(line[index]) && !isCoordVisible(line[index + 1])) continue;
          const a = projection(line[index]);
          const b = projection(line[index + 1]);
          if (!a || !b || Math.hypot(b[0] - a[0], b[1] - a[1]) > state.size.width * 0.7) continue;
          const vx = b[0] - a[0], vy = b[1] - a[1];
          const length2 = vx * vx + vy * vy;
          const t = length2 ? clamp(((screenPoint[0] - a[0]) * vx + (screenPoint[1] - a[1]) * vy) / length2, 0, 1) : 0;
          const distance = Math.hypot(screenPoint[0] - (a[0] + vx * t), screenPoint[1] - (a[1] + vy * t));
          if (distance <= 7 && (!nearest || distance < nearest.distance)) nearest = { feature, distance };
        }
      }
    }
    return nearest?.feature || null;
  }


  function mapNavigationEnabled() {
    return !state.labelPlacementMode
      && (draftInputActive() || ['select', 'country-border', 'country-coast', 'merge-country', 'merge-drawing', 'new-country', 'annex-territory'].includes(state.tool));
  }

  function featureNearCoordinate(feature, coordinate, margin) {
    if (!feature?.geometry) return false;
    const bounds = geometryBounds(feature.geometry);
    return coordinate[0] >= bounds[0] - margin && coordinate[0] <= bounds[2] + margin
      && coordinate[1] >= bounds[1] - margin && coordinate[1] <= bounds[3] + margin;
  }

  function activeSnapOwnerIds() {
    if (state.tool === 'country-border') return state.boundaryEditCountryIds.map(String);
    if (state.coastEditCountryId) return [String(state.coastEditCountryId)];
    if ((state.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY)) return [String(state.selected.id)];
    if ((state.selected?.domain === 'territorial' && state.selected.type !== TERRITORIAL_UNIT_TYPES.COUNTRY)) return [String(state.selected.id)];
    if (state.selected?.domain === 'drawing') return [String(state.selected.id)];
    if (state.selected?.domain === 'hydro' && hydroEditById(state.selected.id)) return [String(state.selected.id)];
    return [];
  }

  function appendLocalGeometryCandidates(output, geometry, coordinate, margin, {
    ownerId = '', segmentKind = 'edge', maxCandidates = 1800,
  } = {}) {
    const ownerIds = ownerId ? [String(ownerId)] : [];
    const nodeKeys = new Set(output.filter(candidate => candidate.nodeKey).map(candidate => candidate.nodeKey));
    geometryPolygonSets(geometry).forEach((polygon, polygonIndex) => {
      (polygon || []).forEach((ring, ringIndex) => {
        const count = Math.max(0, (ring?.length || 0) - 1);
        for (let segmentIndex = 0; segmentIndex < count && output.length < maxCandidates; segmentIndex += 1) {
          const a = ring[segmentIndex];
          const b = ring[segmentIndex + 1];
          if (Math.max(a[0], b[0]) < coordinate[0] - margin || Math.min(a[0], b[0]) > coordinate[0] + margin
            || Math.max(a[1], b[1]) < coordinate[1] - margin || Math.min(a[1], b[1]) > coordinate[1] + margin) continue;
          for (const vertex of [a, b]) {
            const nodeKey = coordKey(vertex);
            if (nodeKeys.has(nodeKey)) continue;
            nodeKeys.add(nodeKey);
            output.push({ kind: 'vertex', coordinate: vertex, ownerIds, nodeKey });
          }
          output.push({
            kind: segmentKind,
            a, b, ownerIds,
            segmentKey: `${ownerId || 'geometry'}:${polygonIndex}:${ringIndex}:${segmentIndex}`,
          });
        }
      });
    });
    return output;
  }

  function localSnapCandidates(coordinate) {
    if (!coordinate) return [];
    const projectionScale = Math.max(1, activeProjection().scale());
    const margin = clamp(26 * 180 / (Math.PI * projectionScale), 0.03, 4);
    const tileSize = margin;
    const cacheKey = [
      state.stateRevision, countryLandRevision, state.tool, state.selected?.type || '', state.selected?.id || '', state.boundaryEditCountryIds.join('|'),
      state.territorialUnits.length, state.drawings.length, state.hydroEdits.length, margin.toFixed(4),
      Math.floor(coordinate[0] / tileSize), Math.floor(coordinate[1] / tileSize),
    ].join(':');
    if (snapCandidateCache.key === cacheKey) return snapCandidateCache.candidates;
    const bounds = [coordinate[0] - margin, coordinate[1] - margin, coordinate[0] + margin, coordinate[1] + margin];
    const countryFeatures = spatialFeatures(bounds);
    const nearbyUnits = state.territorialUnits.filter(feature => featureNearCoordinate(feature, coordinate, margin)).slice(0, 32);
    const nearbyDrawings = state.drawings.filter(feature => ['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)
      && featureNearCoordinate(feature, coordinate, margin)).slice(0, 24);
    const activeOwners = new Set(activeSnapOwnerIds());
    const candidates = [];
    for (const feature of [...countryFeatures, ...nearbyUnits, ...nearbyDrawings]) {
      const ownerId = String(feature.properties?.editor_id || feature.id || '');
      const segmentKind = activeOwners.size && !activeOwners.has(ownerId) ? 'neighbor' : 'edge';
      appendLocalGeometryCandidates(candidates, feature.geometry, coordinate, margin * 2, { ownerId, segmentKind });
      if (candidates.length >= 1800) break;
    }
    const sourceGeometry = activeCutDraftSourceGeometry();
    if (sourceGeometry) appendLocalGeometryCandidates(candidates, sourceGeometry, coordinate, margin * 2, {
      ownerId: activeSnapOwnerIds()[0] || 'source', segmentKind: 'boundary', maxCandidates: 2200,
    });
    const segments = candidates.filter(candidate => candidate.a && candidate.b).slice(0, 80);
    for (let left = 0; left < segments.length; left += 1) {
      for (let right = left + 1; right < segments.length; right += 1) {
        if (segments[left].segmentKey === segments[right].segmentKey) continue;
        const intersection = segmentIntersectionDetail(segments[left].a, segments[left].b, segments[right].a, segments[right].b);
        if (!intersection || intersection.overlap || intersection.lineT <= 1e-7 || intersection.lineT >= 1 - 1e-7
          || intersection.boundaryT <= 1e-7 || intersection.boundaryT >= 1 - 1e-7) continue;
        candidates.push({ kind: 'intersection', coordinate: intersection.coord, ownerIds: [...new Set([...(segments[left].ownerIds || []), ...(segments[right].ownerIds || [])])] });
        if (candidates.length >= 240) {
          snapCandidateCache = { key: cacheKey, candidates };
          return candidates;
        }
      }
    }
    snapCandidateCache = { key: cacheKey, candidates };
    return candidates;
  }

  function snapCoordinateForInput(coordinate, screenPoint, pointerType = 'mouse', { excludeNodeKey = null, excludeCoordinate = null } = {}) {
    if (!coordinate || !screenPoint) return coordinate;
    const result = resolveSnap({
      coordinate,
      screenPoint,
      candidates: localSnapCandidates(coordinate).filter(candidate => (!excludeNodeKey || candidate.nodeKey !== excludeNodeKey)
        && (!excludeCoordinate || !candidate.coordinate || !coordNear(candidate.coordinate, excludeCoordinate, 1e-9))),
      project: activeProjection(),
      pointerType,
    });
    state.activeSnap = snapIndicator(result);
    renderSnapIndicator();
    return result?.coordinate?.slice() || coordinate;
  }

  function clearActiveSnap() {
    if (!state.activeSnap) return;
    state.activeSnap = null;
    renderSnapIndicator();
  }

  function mapClickBlocked(event = d3.event) {
    if (event?.defaultPrevented) {
      event.stopPropagation?.();
      return true;
    }
    const suppression = state.suppressNextMapClick;
    if (!suppression) return false;
    const eventPoint = Number.isFinite(event?.clientX) && Number.isFinite(event?.clientY)
      ? [event.clientX, event.clientY]
      : null;
    if (suppression.point && eventPoint && Math.hypot(eventPoint[0] - suppression.point[0], eventPoint[1] - suppression.point[1]) > 18) {
      return false;
    }
    state.suppressNextMapClick = null;
    clearTimeout(suppressNextMapClick._timer);
    event?.preventDefault?.();
    event?.stopPropagation?.();
    return true;
  }

  function suppressNextMapClick(point = null, timeout = 450) {
    state.suppressNextMapClick = {
      point: Array.isArray(point) ? [Number(point[0]), Number(point[1])] : null,
    };
    clearTimeout(suppressNextMapClick._timer);
    suppressNextMapClick._timer = setTimeout(() => {
      state.suppressNextMapClick = null;
    }, timeout);
  }

  function invalidateEditInteraction() {
    editInteractionRevision += 1;
    mapInputController?.cancel();
    state.mapMoving = false;
    $('map')?.classList.remove('dragging');
  }

  function panMapBy(dx, dy) {
    if (state.projection === 'globe') {
      const sensitivity = 0.22 / Math.max(0.75, Math.sqrt(state.view.globeZoom));
      state.view.globeRotation[0] += dx * sensitivity;
      state.view.globeRotation[1] -= dy * sensitivity;
      state.view.globeRotation[1] = clamp(state.view.globeRotation[1], -89, 89);
      return;
    }
    const scale = flatProjection.scale();
    state.view.flatCenter[0] -= dx * 180 / (Math.PI * scale);
    state.view.flatCenter[1] += dy * 180 / (Math.PI * scale);
    state.view.flatCenter[1] = clamp(state.view.flatCenter[1], -85, 85);
    state.view.flatCenter[0] = ((state.view.flatCenter[0] + 540) % 360) - 180;
  }

  function wrappedLongitudeDelta(value) {
    return ((Number(value || 0) + 540) % 360) - 180;
  }

  function setMapZoomValue(value) {
    if (state.projection === 'globe') {
      const next = clamp(Number(value || state.view.globeZoom), ZOOM_LIMITS.globe.min, ZOOM_LIMITS.globe.max);
      const changed = Math.abs(next - state.view.globeZoom) > 1e-9;
      state.view.globeZoom = next;
      return changed;
    }
    const next = clamp(Number(value || state.view.flatZoom), ZOOM_LIMITS.flat.min, ZOOM_LIMITS.flat.max);
    const changed = Math.abs(next - state.view.flatZoom) > 1e-9;
    state.view.flatZoom = next;
    return changed;
  }

  function alignGeographicAnchor(coordinate, screenPoint) {
    if (!coordinate || !screenPoint) return false;
    let changed = false;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      updateProjection();
      const targetCoordinate = screenToGeo(screenPoint);
      if (!targetCoordinate) return changed;
      const longitudeDelta = wrappedLongitudeDelta(coordinate[0] - targetCoordinate[0]);
      const latitudeDelta = Number(coordinate[1]) - Number(targetCoordinate[1]);
      if (Math.abs(longitudeDelta) < 1e-7 && Math.abs(latitudeDelta) < 1e-7) break;
      if (state.projection === 'globe') {
        state.view.globeRotation[0] -= longitudeDelta;
        state.view.globeRotation[1] = clamp(state.view.globeRotation[1] - latitudeDelta, -89, 89);
      } else {
        state.view.flatCenter[0] = wrappedLongitudeDelta(state.view.flatCenter[0] + longitudeDelta);
        state.view.flatCenter[1] = clamp(state.view.flatCenter[1] + latitudeDelta, -85, 85);
      }
      changed = true;
    }
    updateProjection();
    return changed;
  }

  function transformMapView({ zoom, fromPoint, toPoint }) {
    const source = Array.isArray(fromPoint) ? fromPoint : null;
    const target = Array.isArray(toPoint) ? toPoint : source;
    updateProjection();
    const anchor = source ? screenToGeo(source) : null;
    let changed = setMapZoomValue(zoom);
    if (anchor && target) {
      changed = alignGeographicAnchor(anchor, target) || changed;
    } else if (source && target && (source[0] !== target[0] || source[1] !== target[1])) {
      panMapBy(target[0] - source[0], target[1] - source[1]);
      updateProjection();
      changed = true;
    } else {
      updateProjection();
    }
    return changed;
  }

  function setCurrentTool(name) {
    const currentName = name || '선택·편집';
    if ($('currentToolStatus')) $('currentToolStatus').textContent = currentName;
    syncStatusBar();
  }

  function shouldShowCoordinates() {
    if (state.labelPlacementMode || state.tool === 'label' || state.tool === 'point') return true;
    if (['country-border', 'country-coast'].includes(state.tool) || isDrawingDraftTool(state.tool)) return true;
    if (state.tool === 'new-country') return state.newCountryPhase === 'line';
    if (state.tool === 'annex-territory') return ['line', 'polygon'].includes(state.annexPhase);
    return false;
  }

  function syncStatusBar() {
    const showCoordinates = shouldShowCoordinates();
    const showTask = state.tool !== 'select' || state.labelPlacementMode;
    const selectedText = $('selectionStatus')?.textContent?.trim() || '';
    const showSelection = !!state.selected && !!selectedText;
    $('coordStatus')?.classList.toggle('hidden', !showCoordinates);
    $('statusView')?.classList.toggle('coordinates-active', showCoordinates);
    $('statusPrimary')?.classList.toggle('hidden', !showTask);
    $('statusSelection')?.classList.toggle('hidden', !showSelection);
  }

  function clearNotification() {
    clearTimeout(setActionStatus._timer);
    const notice = $('actionStatus');
    if (!notice) return;
    notice.classList.add('hidden');
    notice.classList.remove('working', 'success', 'error');
    notice.classList.add('ready');
    notice.setAttribute('role', 'status');
    document.body.classList.remove('notification-visible');
  }

  function clearErrorNotification() {
    if ($('actionStatus')?.classList.contains('error')) clearNotification();
  }

  function setActionStatus(message, tone = 'success', timeout = 1800) {
    const notice = $('actionStatus');
    if (!notice) return;
    const fullMessage = String(message ?? '').replace(/\s+/g, ' ').trim();
    const visibleMessage = isMobile()
      ? compactNotificationMessage(fullMessage, { tone, maxLength: 22 })
      : fullMessage;
    clearTimeout(setActionStatus._timer);
    notice.classList.remove('hidden');
    notice.classList.remove('ready', 'working', 'success', 'error');
    notice.classList.add(tone);
    notice.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    notice.setAttribute('aria-label', fullMessage);
    if (visibleMessage !== fullMessage) notice.dataset.tooltip = fullMessage;
    else delete notice.dataset.tooltip;
    const strong = notice.querySelector('strong');
    if (strong) strong.textContent = visibleMessage;
    document.body.classList.add('notification-visible');
    if (tone === 'error' || timeout <= 0) return;
    setActionStatus._timer = setTimeout(clearNotification, timeout);
  }

  const CANONICAL_CONTROL_SELECTOR = [
    '#createMenu .create-menu-item',
    '#rightPanel input', '#rightPanel select', '#rightPanel textarea',
    '#rightPanel button:not(.sheet-close-btn):not(#focusSelectedObjectBtn)',
    '.top-actions button', '.top-actions input',
    '#undoBtn', '#redoBtn',
    '.layer-child-menu', '.layer-folder-lock', '.layer-style-toggle',
    '[data-layer-style-opacity]', '[data-layer-style-boundary]', '[data-layer-style-blend-mode]',
    '.layer-folder input[type="checkbox"]', '#labelsVisible', '#basemapLabelsVisible',
  ].join(',');

  function syncLayerVisibilityToggle(input) {
    if (!input?.classList?.contains('layer-visibility-toggle')) return;
    const label = input.dataset.visibilityLabel || '레이어';
    input.dataset.tooltip = input.checked ? `${label} 숨기기` : `${label} 표시`;
  }

  function syncLayerVisibilityToggles(scope = document) {
    scope?.querySelectorAll?.('input.layer-visibility-toggle').forEach(syncLayerVisibilityToggle);
  }

  function syncCanonicalControls() {
    const unavailable = !canMutateProject(state.dataReadiness);
    $('app')?.setAttribute('data-readiness', state.dataReadiness);
    document.body.dataset.mapReadiness = state.dataReadiness;
    for (const element of document.querySelectorAll(CANONICAL_CONTROL_SELECTOR)) {
      if (unavailable) {
        if (!Object.hasOwn(element.dataset, 'readinessDisabled')) {
          element.dataset.readinessDisabled = String('disabled' in element && element.disabled);
          element.dataset.readinessAriaDisabled = element.hasAttribute('aria-disabled')
            ? String(element.getAttribute('aria-disabled'))
            : '';
        }
        if ('disabled' in element) element.disabled = true;
        element.setAttribute('aria-disabled', 'true');
        continue;
      }
      if (Object.hasOwn(element.dataset, 'readinessDisabled')) {
        if ('disabled' in element) element.disabled = element.dataset.readinessDisabled === 'true';
        const previousAria = element.dataset.readinessAriaDisabled;
        if (previousAria) element.setAttribute('aria-disabled', previousAria);
        else element.removeAttribute('aria-disabled');
        delete element.dataset.readinessDisabled;
        delete element.dataset.readinessAriaDisabled;
      }
    }
    syncLayerVisibilityToggles($('layerSection'));
  }

  function setDataReadiness(value) {
    state.dataReadiness = Object.values(DATA_READINESS).includes(value) ? value : DATA_READINESS.PREVIEW;
    syncCanonicalControls();
  }

  function applyDataReadinessEvent(event) {
    setDataReadiness(transitionDataReadiness(state.dataReadiness, event));
  }

  function requireCanonicalData() {
    if (canMutateProject(state.dataReadiness)) return true;
    const message = state.dataReadiness === DATA_READINESS.ERROR
      ? '편집 데이터를 불러오지 못했습니다. 새로고침하세요.'
      : `편집 데이터 준비 중 · ${Math.round(state.geometryProgress || 0)}%`;
    setActionStatus(message, state.dataReadiness === DATA_READINESS.ERROR ? 'error' : 'working', 0);
    return false;
  }

  function blockUnavailableCanonicalAction(event) {
    if (canMutateProject(state.dataReadiness)) return;
    const target = event.target instanceof window.Element ? event.target.closest(CANONICAL_CONTROL_SELECTOR) : null;
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    requireCanonicalData();
  }

  document.addEventListener('click', blockUnavailableCanonicalAction, true);
  document.addEventListener('change', blockUnavailableCanonicalAction, true);

  function isSafeKoreanErrorMessage(error) {
    const message = String(error?.message || '');
    if (!/[가-힣]/.test(message)) return false;
    return !/(Cannot read|undefined|null is not|is not a function|TypeError|ReferenceError|SyntaxError|RangeError|failed\b|\bat\s+\S+\s*\()/i.test(message);
  }

  function reportOperationError(error, fallbackMessage, code, timeout = 4400) {
    console.error(`[${code}]`, error);
    const detail = isSafeKoreanErrorMessage(error) ? String(error.message).trim() : '';
    const hasRecoveryAction = /(선택|확인|입력|이동|조정|해제|새로고침|다시 시도|다시 그리)하세요\.$/.test(detail);
    const fallbackSummary = String(fallbackMessage || '').split(/(?<=[.!?])\s+/u)[0];
    const message = detail
      ? (hasRecoveryAction ? detail : `${detail} · ${code}`)
      : `${fallbackSummary} · ${code}`;
    setActionStatus(message, 'error', timeout);
  }

  function createGisImportError(userMessage, {
    category = RELIABILITY_ERROR_CATEGORIES.TRANSACTION,
    objectIds = [],
    technicalMessage = '',
    cause = null,
    code = 'PL-GIS-001',
  } = {}) {
    return createOperationalError({
      code,
      category,
      userMessage,
      technicalMessage: technicalMessage || cause?.message || userMessage,
      objectIds,
      operationType: 'gis-import',
      cause,
    });
  }

  function reportGisImportError(error, { rollback = '' } = {}) {
    const code = String(error?.code || 'PL-GIS-001');
    const objectIds = [...new Set((error?.objectIds || []).map(String).filter(Boolean))];
    const technicalMessage = String(error?.message || error || 'GIS import failed');
    console.error(`[${code}]`, {
      operation: error?.operationType || 'gis-import',
      objectIds,
      rollback,
    }, error);
    reliabilityDiagnostic.push({
      category: error?.category || 'gis',
      operation: error?.operationType || 'gis-import',
      objectIds,
      result: 'failed',
      errorCode: code,
      technicalMessage,
      stack: error?.stack || '',
      rollback,
    });
    const hasSpecificUserMessage = !!String(error?.userMessage || '').trim() || isSafeKoreanErrorMessage(error);
    const userMessage = String(error?.userMessage || '').trim()
      || (isSafeKoreanErrorMessage(error) ? technicalMessage.trim() : '파일을 불러오지 못했습니다. 파일 형식과 구성을 확인하세요.');
    setActionStatus(hasSpecificUserMessage ? userMessage : `${userMessage} · ${code}`, 'error', 5600);
  }

  function showFatalError(error) {
    if (isAbortError(error)) return;
    console.error('[PL-RUNTIME-001]', error);
    const message = isSafeKoreanErrorMessage(error)
      ? String(error.message).trim()
      : '내부 오류로 판도연구소를 시작할 수 없습니다. 오류 코드 PL-RUNTIME-001을 확인하세요.';
    let box = document.getElementById('fatalErrorBox');
    if (!box) {
      box = document.createElement('div');
      box.id = 'fatalErrorBox';
      box.className = 'fatal-runtime-message';
      document.body.appendChild(box);
    }
    box.textContent = `판도연구소를 시작할 수 없습니다.\n${message}\n\n페이지를 새로고침하세요. 문제가 계속되면 오류 코드를 확인하세요.`;
    try { $('engineStatus').textContent = '실행 오류'; } catch (_) {}
  }

  function handleUnexpectedRuntimeError(error) {
    if (isAbortError(error)) return;
    if (!runtimeReady) {
      showFatalError(error);
      return;
    }
    console.error('[PL-RUNTIME-001]', error);
    setActionStatus('작업 실패 · PL-RUNTIME-001', 'error', 0);
  }

  window.addEventListener('error', event => {
    const error = event.error || event.message;
    if (isAbortError(error)) {
      event.preventDefault();
      return;
    }
    handleUnexpectedRuntimeError(error);
  });
  window.addEventListener('unhandledrejection', event => {
    if (isAbortError(event.reason)) {
      event.preventDefault();
      return;
    }
    handleUnexpectedRuntimeError(event.reason);
  });

  function slugify(value) {
    return String(value || 'country')
      .normalize('NFKD')
      .replace(/[^A-Za-z0-9가-힣]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'country';
  }

  function featureCountryId(feature, index) {
    const p = feature.properties || {};
    if (p.editor_id) return String(p.editor_id);
    const iso = p.iso_a3 || p.ISO_A3 || p.ADM0_A3;
    if (iso && iso !== '-99') return String(iso);
    return `${slugify(p.name || p.ADMIN || p.NAME)}_${index}`;
  }

  function featureCountryName(feature) {
    const p = feature.properties || {};
    return p.name || p.ADMIN || p.NAME || p.NAME_LONG || '이름 없는 국가';
  }

  function reindexCountries(fc, applyOverrides = true) {
    const out = fc?.type === 'FeatureCollection' ? fc : { type: 'FeatureCollection', features: [] };
    state.countryIndex.clear();
    out.features.forEach((feature, index) => {
      if (!hasCanonicalCountryWinding(feature.geometry)) {
        const normalizedGeometry = normalizeCountryGeometry(feature.geometry);
        if (normalizedGeometry) feature.geometry = normalizedGeometry;
      }
      feature.properties = feature.properties || {};
      const id = featureCountryId(feature, index);
      const originalName = feature.properties.editor_original_name || featureCountryName(feature);
      const override = applyOverrides ? (state.countryOverrides[id] || {}) : {};
      feature.properties.editor_id = id;
      feature.properties.editor_original_name = originalName;
      feature.properties.editor_name = override.name || feature.properties.editor_name || originalName;
      const explicitColor = override.color || feature.properties.editor_color;
      if (explicitColor) feature.properties.editor_color = explicitColor;
      else delete feature.properties.editor_color;
      try {
        feature.properties.editor_centroid = d3.geo.centroid(feature);
      } catch (_) {
        feature.properties.editor_centroid = [0, 0];
      }
      state.countryIndex.set(id, index);
    });
    rebuildSpatialIndex(out.features);
    markLayerTreeDirty();
    return out;
  }

  function validLabelAnchor(value) {
    return Array.isArray(value) && value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]));
  }

  function applyPristineLabelAnchors(collection, onlyIds = null) {
    const filter = onlyIds ? new Set([...onlyIds].map(String)) : null;
    for (const feature of collection?.features || []) {
      const id = String(feature.properties?.editor_id || feature.properties?.iso_a3 || '');
      if (filter && !filter.has(id)) continue;
      const anchor = PRISTINE_LABEL_ANCHORS[id];
      if (!validLabelAnchor(anchor)) continue;
      feature.properties ||= {};
      feature.properties.editor_label_anchor = [Number(anchor[0]), Number(anchor[1])];
      pendingCountryLabelAnchors.delete(id);
    }
  }

  function largestCountryComponentFeature(feature) {
    const geometry = feature?.geometry;
    if (!geometry) return null;
    if (geometry.type === 'Polygon') return { type: 'Feature', properties: feature.properties || {}, geometry: deepClone(geometry) };
    if (geometry.type !== 'MultiPolygon') return null;
    let bestCoordinates = null;
    let bestArea = -Infinity;
    for (const coordinates of geometry.coordinates || []) {
      let area = 0;
      try { area = d3.geo.area({ type: 'Polygon', coordinates }); } catch (_) {}
      if (area > bestArea) { bestArea = area; bestCoordinates = coordinates; }
    }
    return bestCoordinates
      ? { type: 'Feature', properties: feature.properties || {}, geometry: { type: 'Polygon', coordinates: deepClone(bestCoordinates) } }
      : null;
  }

  function fallbackCountryLabelAnchor(feature) {
    const primary = largestCountryComponentFeature(feature) || feature;
    try {
      const centroid = d3.geo.centroid(primary);
      if (validLabelAnchor(centroid)) return centroid;
    } catch (_) {}
    const ring = primary?.geometry?.coordinates?.[0] || [];
    return ringRepresentativePoint(ring);
  }

  function ensureCountryLabelAnchorWorker() {
    if (countryLabelAnchorWorker) return countryLabelAnchorWorker;
    const worker = new Worker(runtimeAssetUrl('workers/label-anchor-worker.js'), {
      name: 'pandolab-label-anchors',
    });
    worker.onmessage = event => {
      const message = event.data || {};
      if (message.type === 'error') {
        console.warn('Country label anchor worker failed', message.message);
        for (const id of [...pendingCountryLabelAnchors]) {
          const feature = countryFeatureById(id);
          if (feature) feature.properties.editor_label_anchor = fallbackCountryLabelAnchor(feature);
          pendingCountryLabelAnchors.delete(id);
        }
        markLayerTreeDirty();
        scheduleRender();
        return;
      }
      if (message.type !== 'anchors') return;
      for (const result of message.results || []) {
        const id = String(result.id || '');
        if (countryLabelAnchorVersions.get(id) !== Number(result.version || 0)) continue;
        const feature = countryFeatureById(id);
        if (feature && validLabelAnchor(result.anchor)) feature.properties.editor_label_anchor = [Number(result.anchor[0]), Number(result.anchor[1])];
        else if (feature) feature.properties.editor_label_anchor = fallbackCountryLabelAnchor(feature);
        pendingCountryLabelAnchors.delete(id);
      }
      markLayerTreeDirty();
      scheduleRender();
    };
    worker.onerror = event => {
      console.warn('Country label anchor worker error', event.message || event);
      countryLabelAnchorWorker?.terminate();
      countryLabelAnchorWorker = null;
      for (const id of [...pendingCountryLabelAnchors]) {
        const feature = countryFeatureById(id);
        if (feature) feature.properties.editor_label_anchor = fallbackCountryLabelAnchor(feature);
        pendingCountryLabelAnchors.delete(id);
      }
      markLayerTreeDirty();
      scheduleRender();
    };
    countryLabelAnchorWorker = worker;
    return worker;
  }

  function resetCountryLabelAnchorRuntime() {
    clearTimeout(countryLabelAnchorTimer);
    countryLabelAnchorTimer = 0;
    countryLabelAnchorWorker?.terminate();
    countryLabelAnchorWorker = null;
    pendingCountryLabelAnchors.clear();
    countryLabelAnchorVersions.clear();
    countryLabelAnchorRequestId += 1;
  }

  function flushCountryLabelAnchorQueue() {
    countryLabelAnchorTimer = 0;
    const items = [];
    for (const id of pendingCountryLabelAnchors) {
      const feature = countryFeatureById(id);
      if (!feature?.geometry) continue;
      items.push({
        id,
        version: countryLabelAnchorVersions.get(id) || 0,
        geometry: deepClone(feature.geometry),
      });
    }
    if (!items.length) return;
    try {
      ensureCountryLabelAnchorWorker().postMessage({ requestId: ++countryLabelAnchorRequestId, items });
    } catch (error) {
      console.warn('Country label anchor request failed', error);
      countryLabelAnchorWorker = null;
      for (const item of items) {
        const feature = countryFeatureById(item.id);
        if (feature) feature.properties.editor_label_anchor = fallbackCountryLabelAnchor(feature);
        pendingCountryLabelAnchors.delete(item.id);
      }
    }
  }

  function scheduleCountryLabelAnchors(ids = null, delay = 30) {
    const requested = ids ? new Set([...ids].map(String)) : null;
    for (const feature of state.countriesData?.features || []) {
      const id = String(feature.properties?.editor_id || '');
      if (requested && !requested.has(id)) continue;
      if (!requested && validLabelAnchor(feature.properties?.editor_label_anchor)) continue;
      delete feature.properties.editor_label_anchor;
      countryLabelAnchorVersions.set(id, (countryLabelAnchorVersions.get(id) || 0) + 1);
      pendingCountryLabelAnchors.add(id);
    }
    if (!pendingCountryLabelAnchors.size) return;
    markLayerTreeDirty();
    clearTimeout(countryLabelAnchorTimer);
    countryLabelAnchorTimer = setTimeout(flushCountryLabelAnchorQueue, delay);
  }


  function countryFeatureById(id) {
    const idx = state.countryIndex.get(String(id));
    return idx === undefined ? null : state.countriesData?.features?.[idx] || null;
  }

  function geometryBounds(geometry) {
    if (!geometry || typeof geometry !== 'object') return [Infinity, Infinity, -Infinity, -Infinity];
    const cached = geometryBoundsCache.get(geometry);
    if (cached) return cached;
    const bounds = coordinateBounds(geometry.coordinates);
    geometryBoundsCache.set(geometry, bounds);
    return bounds;
  }

  function geometryMayIntersectViewport(geometry, overscan = 48) {
    const bounds = geometryBounds(geometry);
    if (!bounds.every(Number.isFinite)) return true;
    const longitudeSpan = bounds[2] - bounds[0];
    const latitudeSpan = bounds[3] - bounds[1];
    // The spatial tier query already removes large objects that cannot meet the
    // current view. Keep the exact projected test conservative for the remaining
    // large/date-line candidates so culling never creates a visible false negative.
    if (longitudeSpan > 40 || latitudeSpan > 40 || longitudeSpan < 0) return true;
    const samples = [
      [bounds[0], bounds[1]], [bounds[0], bounds[3]],
      [bounds[2], bounds[1]], [bounds[2], bounds[3]],
      [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2],
    ];
    const projected = samples
      .filter(coordinate => state.projection !== 'globe' || isCoordVisible(coordinate))
      .map(coordinate => activeProjection()(coordinate))
      .filter(Boolean);
    if (!projected.length) return false;
    const xs = projected.map(point => point[0]);
    const ys = projected.map(point => point[1]);
    return Math.max(...xs) >= -overscan && Math.min(...xs) <= state.size.width + overscan
      && Math.max(...ys) >= -overscan && Math.min(...ys) <= state.size.height + overscan;
  }

  function sameSourceParts(left = [], right = []) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }

  function replaceSpatialDomain(domain, sourceParts, buildRecords) {
    const previous = mapObjectSpatialIndexSources.get(domain);
    if (previous && sameSourceParts(previous, sourceParts)) return false;
    mapObjectSpatialIndex.clearDomain(domain);
    for (const record of buildRecords()) mapObjectSpatialIndex.upsert(record);
    mapObjectSpatialIndexSources.set(domain, sourceParts.slice());
    return true;
  }

  function visibleFlatGeographicBounds(overscan = 64) {
    const width = Math.max(1, Number(state.size.width || 1));
    const height = Math.max(1, Number(state.size.height || 1));
    const center = screenToGeo([width / 2, height / 2]) || state.view.flatCenter || [0, 0];
    const samples = [
      [-overscan, -overscan], [width / 2, -overscan], [width + overscan, -overscan],
      [-overscan, height / 2], [width / 2, height / 2], [width + overscan, height / 2],
      [-overscan, height + overscan], [width / 2, height + overscan], [width + overscan, height + overscan],
    ].map(screenToGeo).filter(Boolean);
    if (!samples.length) return [-180, -90, 180, 90];
    const longitudes = samples.map(coordinate => {
      let longitude = Number(coordinate[0]);
      while (longitude - center[0] > 180) longitude -= 360;
      while (longitude - center[0] < -180) longitude += 360;
      return longitude;
    });
    const latitudes = samples.map(coordinate => Number(coordinate[1]));
    return [Math.min(...longitudes), Math.max(-90, Math.min(...latitudes)), Math.max(...longitudes), Math.min(90, Math.max(...latitudes))];
  }

  function visibleMapObjectCandidates(domains) {
    rebuildMapObjectSpatialIndex();
    const started = performance.now();
    const records = state.projection === 'globe'
      ? mapObjectSpatialIndex.querySphericalCap({
          center: [-Number(state.view.globeRotation?.[0] || 0), -Number(state.view.globeRotation?.[1] || 0)],
          radius: 91,
          domains,
        })
      : mapObjectSpatialIndex.query(visibleFlatGeographicBounds(), { domains });
    viewportCullingMetrics.queryCount += 1;
    viewportCullingMetrics.candidateCount = records.length;
    viewportCullingMetrics.queryMs = performance.now() - started;
    viewportCullingMetrics.lastByDomain[domains.join(',')] = {
      candidateCount: records.length,
      queryMs: viewportCullingMetrics.queryMs,
    };
    return records;
  }

  function pointBounds(coordinate) {
    const longitude = Number(coordinate?.[0]);
    const latitude = Number(coordinate?.[1]);
    return Number.isFinite(longitude) && Number.isFinite(latitude)
      ? [longitude, latitude, longitude, latitude]
      : null;
  }

  function rebuildMapObjectSpatialIndex(force = false) {
    if (force) mapObjectSpatialIndexSources.clear();
    let changed = false;
    changed = replaceSpatialDomain('label', [state.labels, state.labels?.length || 0, mapObjectGeometryRevisions.label], () => (state.labels || []).flatMap(label => {
      const bounds = pointBounds(label.coordinates);
      return bounds ? [{
        key: `label:${label.id}`, domain: 'label', type: label.kind || 'label', id: label.id, bounds,
      }] : [];
    })) || changed;
    changed = replaceSpatialDomain('drawing', [state.drawings, state.drawings?.length || 0, mapObjectGeometryRevisions.drawing], () => (state.drawings || []).flatMap(feature => feature?.geometry ? [{
        key: `drawing:${feature.id}`, domain: 'drawing', type: feature.properties?.category || 'custom', id: feature.id,
        bounds: geometryBounds(feature.geometry),
      }] : [])) || changed;
    changed = replaceSpatialDomain('territorial', [state.territorialUnits, state.territorialUnits?.length || 0, mapObjectGeometryRevisions.territorial], () => (state.territorialUnits || []).flatMap(feature => feature?.geometry ? [{
        key: `territorial:${feature.id}`, domain: 'territorial', type: feature.properties?.unitType || TERRITORIAL_UNIT_TYPES.TERRITORY, id: feature.id,
        bounds: geometryBounds(feature.geometry),
      }] : [])) || changed;
    const distributionRows = buildDistributionRenderRows();
    if (force || mapObjectSpatialIndexSources.get('distribution')?.[0] !== distributionRows) mapObjectDistributionRowCache.clear();
    changed = replaceSpatialDomain('distribution', [distributionRows], () => distributionRows.map(row => {
      mapObjectDistributionRowCache.set(String(row.id), row);
      return {
        key: `distribution:${row.id}`, domain: 'distribution', type: row.layer.type, id: row.id,
        bounds: row.bounds,
      };
    })) || changed;
    changed = replaceSpatialDomain('hydro', [state.hydroEdits, state.hydroEdits?.length || 0, mapObjectGeometryRevisions.hydro], () => (state.hydroEdits || []).flatMap(feature => feature?.geometry ? [{
        key: `hydro:${feature.id}`, domain: 'hydro', type: feature.properties?.category || 'river', id: feature.id,
        bounds: geometryBounds(feature.geometry),
      }] : [])) || changed;
    return changed;
  }

  function selectionQueryBounds(screenPoint, tolerance = 8) {
    const center = screenToGeo(screenPoint);
    if (!center) return null;
    const samples = [[0, 0], [-tolerance, 0], [tolerance, 0], [0, -tolerance], [0, tolerance],
      [-tolerance, -tolerance], [tolerance, -tolerance], [-tolerance, tolerance], [tolerance, tolerance]]
      .map(([dx, dy]) => screenToGeo([screenPoint[0] + dx, screenPoint[1] + dy]))
      .filter(Boolean);
    if (!samples.length) return [center[0], center[1], center[0], center[1]];
    const longitudes = samples.map(coordinate => {
      let value = Number(coordinate[0]);
      while (value - center[0] > 180) value -= 360;
      while (value - center[0] < -180) value += 360;
      return value;
    });
    const latitudes = samples.map(coordinate => Number(coordinate[1]));
    return [Math.min(...longitudes), Math.min(...latitudes), Math.max(...longitudes), Math.max(...latitudes)];
  }

  function indexedMapObjectCandidates(screenPoint) {
    rebuildMapObjectSpatialIndex();
    const bounds = selectionQueryBounds(screenPoint, isMobile() ? 18 : 11);
    if (!bounds) return [];
    const startedAt = performance.now();
    const candidates = mapObjectSpatialIndex.query(bounds);
    selectionPerformanceMetrics.indexQueryMs = performance.now() - startedAt;
    selectionPerformanceMetrics.indexedCandidateCount = candidates.length;
    return candidates;
  }

  function indexedDistributionRow(id) {
    return mapObjectDistributionRowCache.get(String(id)) || null;
  }

  function rebuildSpatialIndex(features = state.countriesData?.features || []) {
    state.spatialIndex = (features || []).map(feature => ({
      id: String(feature.properties?.editor_id || ''),
      feature,
      bounds: geometryBounds(feature.geometry),
    }));
  }

  function spatialFeatures(bounds, excludeIds = null) {
    const excluded = excludeIds ? new Set([...excludeIds].map(String)) : null;
    return (state.spatialIndex || [])
      .filter(item => (!excluded || !excluded.has(item.id)) && boundsOverlap(bounds, item.bounds))
      .map(item => item.feature);
  }

  function invalidateGeometryCaches(ids = []) {
    const wanted = new Set([...ids].map(String));
    for (const feature of state.countriesData?.features || []) {
      if (!wanted.size || wanted.has(String(feature.properties?.editor_id || ''))) {
        geometryBoundsCache.delete(feature.geometry);
        countryOutlineCache.delete(feature.geometry);
        geometryAreaDisplayCache.delete(feature.geometry);
        countryProjectedBoundsCache.delete(feature.geometry);
      }
    }
    rebuildSpatialIndex();
  }

  function markCountryGeometriesChanged(ids = []) {
    const changed = new Set();
    for (const rawId of ids) {
      const id = String(rawId || '');
      if (!id) continue;
      changed.add(id);
      state.historyDirtyCountryIds.add(id);
      state.pendingCountryRenderIds.add(id);
    }
    const currentFeatures = new Map((state.countriesData?.features || []).map(feature => [
      String(feature.properties?.editor_id || ''),
      feature,
    ]));
    const features = [];
    const removedIds = [];
    for (const id of changed) {
      const feature = currentFeatures.get(id);
      if (feature) features.push(feature);
      else removedIds.push(id);
    }
    invalidateGeometryCaches(changed);
    if (changed.size) {
      state.stateRevision += 1;
      territorialBoundaryCache.countries = null;
    }
    countryLandRevision += 1;
    drawingLandClipCache = new WeakMap();
    state.boundaryTopology = { edges: new Map(), nodes: new Map() };
    gpuMapRenderer.applyCountryPatch({ ids: [...changed], features, removedIds });
    if (!applyingMapEditWorkerResult) mapEditClient.syncPatch(changed);
  }

  let applyingMapEditWorkerResult = false;

  const mapEditClient = createMapEditWorkerClient({
    createWorker: () => new Worker(runtimeAssetUrl('workers/map-edit-worker.js'), { name: 'pandolab-map-edit' }),
    getFeatures: () => state.countriesData?.features || [],
    getFeatureById: countryFeatureById,
    clone: deepClone,
  });

  function assertCurrentProjectReferences() {
    return assertProjectReferenceIntegrity({
      countries: state.countriesData?.features || [],
      countryOverrides: state.countryOverrides || {},
      territorialUnits: state.territorialUnits || [],
      territorialRelations: state.territorialRelations || [],
      distributionLayers: state.distributionLayers || [],
      distributionEntries: state.distributionEntries || [],
      labels: state.labels || [],
      drawings: state.drawings || [],
      itemVisibility: state.itemVisibility || {},
      labelSettings: state.labelSettings || {},
    });
  }

  function transactCountryEdit({ operation, payload, snapshot, applyResult, onSuccess, onError }) {
    return runCountryEditTransaction({
      client: mapEditClient,
      operation,
      payload,
      snapshot,
      applyResult,
      validateCanonical: assertCurrentProjectReferences,
      commitHistory: commitHistorySnapshot,
      restore: (editableSnapshot, { rebaseWorker }) => {
        restoreCountryEditSnapshot(editableSnapshot);
        if (rebaseWorker) mapEditClient.rebase(state.countriesData?.features || []);
      },
      queueAutosave,
      diagnostic: reliabilityDiagnostic,
      onSuccess,
      onError,
    });
  }

  function geometryPolygonSets(geometry) {
    if (!geometry) return [];
    if (geometry.type === 'Polygon') return [geometry.coordinates || []];
    if (geometry.type === 'MultiPolygon') return geometry.coordinates || [];
    return [];
  }

  function countryRingForVertex(feature, vertex) {
    if (!feature?.geometry || !vertex) return null;
    if (feature.geometry.type === 'Polygon') return feature.geometry.coordinates?.[vertex.ringIndex] || null;
    if (feature.geometry.type === 'MultiPolygon') return feature.geometry.coordinates?.[vertex.polygonIndex]?.[vertex.ringIndex] || null;
    return null;
  }

  function setCountryVertexCoord(feature, vertex, coord) {
    const ring = countryRingForVertex(feature, vertex);
    if (!ring || vertex.index < 0 || vertex.index >= ring.length - 1) return false;
    // 배열 객체를 교체하지 않고 값만 바꿔 토폴로지 세그먼트 참조가 드래그 중에도 유지되게 한다.
    ring[vertex.index][0] = coord[0];
    ring[vertex.index][1] = coord[1];
    if (vertex.index === 0) {
      ring[ring.length - 1][0] = coord[0];
      ring[ring.length - 1][1] = coord[1];
    }
    return true;
  }

  function coordKey(coord, precision = 7) {
    return `${Number(coord?.[0] || 0).toFixed(precision)},${Number(coord?.[1] || 0).toFixed(precision)}`;
  }

  function edgeKey(a, b, precision = 7) {
    const ka = coordKey(a, precision), kb = coordKey(b, precision);
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  }

  function coordNear(a, b, tolerance = 0.00008) {
    if (!a || !b) return false;
    let dx = Math.abs(a[0] - b[0]);
    dx = Math.min(dx, Math.abs(dx - 360));
    return dx <= tolerance && Math.abs(a[1] - b[1]) <= tolerance;
  }

  /*
   * 국가 폴리곤을 '육상 공유국경 / 해안선 / 다국가 접경점'으로 분류하는 경량 토폴로지 인덱스.
   * 같은 선분을 2개 이상의 국가가 소유하면 육상국경, 1개 국가만 소유하면 해안선이다.
   * 이 데이터는 렌더링/편집용 캐시이며 프로젝트 파일에는 저장하지 않고 geometry에서 매번 재구성한다.
   */
  function rebuildBoundaryTopology(targetCountryIds = state.coastEditCountryId) {
    const edges = new Map();
    const nodes = new Map();
    const targetIds = [...new Set((Array.isArray(targetCountryIds) ? targetCountryIds : [targetCountryIds]).map(String).filter(Boolean))];
    const targets = targetIds.map(countryFeatureById).filter(Boolean);
    if (!targets.length) {
      state.boundaryTopology = { edges, nodes };
      state.sharedBoundaryTopology = { segments: new Map(), nodes: new Map() };
      return;
    }
    const margin = 0.0002;
    const nearby = new Map();
    for (const target of targets) {
      const targetBounds = geometryBounds(target.geometry);
      const queryBounds = [targetBounds[0] - margin, targetBounds[1] - margin, targetBounds[2] + margin, targetBounds[3] + margin];
      for (const feature of spatialFeatures(queryBounds)) nearby.set(String(feature.properties?.editor_id || ''), feature);
    }
    const features = [...nearby.values()];

    for (const feature of features) {
      const countryId = String(feature.properties?.editor_id || '');
      const polygons = geometryPolygonSets(feature.geometry);
      polygons.forEach((polygon, polygonIndex) => {
        polygon.forEach((ring, ringIndex) => {
          const count = Math.max(0, (ring?.length || 0) - 1);
          if (count < 2) return;
          for (let index = 0; index < count; index += 1) {
            const a = ring[index];
            const b = ring[(index + 1) % count];
            const eKey = edgeKey(a, b);
            if (!edges.has(eKey)) edges.set(eKey, { key: eKey, refs: [], countryIds: new Set(), kind: 'coast' });
            const edge = edges.get(eKey);
            edge.refs.push({ countryId, feature, polygonIndex, ringIndex, index, a, b });
            edge.countryIds.add(countryId);

            const nKey = coordKey(a);
            if (!nodes.has(nKey)) nodes.set(nKey, { key: nKey, coord: a, refs: [], countryIds: new Set() });
            const node = nodes.get(nKey);
            node.refs.push({
              countryId, feature,
              vertex: { key: `${polygonIndex}:${ringIndex}:${index}`, polygonIndex, ringIndex, index, coord: a },
              prevEdgeKey: edgeKey(ring[(index - 1 + count) % count], a),
              nextEdgeKey: eKey,
            });
            node.countryIds.add(countryId);
          }
        });
      });
    }

    for (const edge of edges.values()) edge.kind = edge.countryIds.size >= 2 ? 'land' : 'coast';
    for (const node of nodes.values()) {
      for (const ref of node.refs) {
        ref.prevKind = edges.get(ref.prevEdgeKey)?.kind || 'coast';
        ref.nextKind = edges.get(ref.nextEdgeKey)?.kind || 'coast';
      }
    }

    state.boundaryTopology = { edges, nodes };
    state.sharedBoundaryTopology = buildSharedBoundaryTopology(features);
  }

  function boundaryEditSelectionAnalysis(countryIds = state.boundaryEditCountryIds, { rebuild = false } = {}) {
    const ids = [...new Set(countryIds.map(String).filter(id => countryFeatureById(id)))];
    if (rebuild) rebuildBoundaryTopology(ids);
    const plan = planSharedBoundaryEdit(state.sharedBoundaryTopology, ids);
    const names = plan.isolatedIds.map(id => countryName(countryFeatureById(id)) || id);
    let message = '';
    if (ids.length < 2) message = '접경국을 하나 이상 더 선택하세요.';
    else if (!plan.segmentKeys.size) message = '선택 국가 사이에 편집할 공유국경이 없습니다.';
    else if (names.length) message = `${names.join(', ')}은(는) 다른 선택 국가와 접하지 않습니다.`;
    return { ...plan, message };
  }

  async function beginWorkerGeometryPreview({
    operation,
    payload,
    snapshot,
    transferredGeometry = null,
    applyResult,
    onSuccess = () => {},
    onError = () => {},
  }) {
    discardActiveGeometryPreview({ announce: false });
    const baseDataRevision = state.stateRevision;
    setActionStatus('변경 미리보기 계산 중…', 'working', 0);
    let requestId = 0;
    try {
      const response = await mapEditClient.execute(operation, payload);
      requestId = response.requestId;
      if (state.stateRevision !== baseDataRevision) {
        mapEditClient.discard(requestId);
        throw Object.assign(new Error('계산 중 지도 상태가 바뀌어 미리보기를 폐기했습니다.'), { cancelled: true });
      }
      const result = response.result;
      const affectedIds = new Set((result.affectedIds || []).map(String));
      const removedIds = new Set((result.removedIds || []).map(String));
      const beforeFeatures = [...affectedIds].map(countryFeatureById).filter(Boolean).map(deepClone);
      const patchById = new Map((result.features || []).map(feature => [String(feature.properties?.editor_id || feature.id || ''), deepClone(feature)]));
      const afterFeatures = [...affectedIds].filter(id => !removedIds.has(id))
        .map(id => patchById.get(id) || countryFeatureById(id))
        .filter(Boolean).map(deepClone);
      const proposedFeatures = (state.countriesData?.features || [])
        .filter(feature => !affectedIds.has(String(feature.properties?.editor_id || '')))
        .map(feature => feature)
        .concat(afterFeatures);
      const baselineIssues = validateTerritorialGeometry(state.countriesData?.features || [], {
        clipper: window.polygonClipping,
        affectedIds,
      });
      const baselineIssueKeys = new Set(baselineIssues.map(issue => `${issue.kind}:${[...(issue.entityRefs || [])].sort().join('|')}`));
      const validationIssues = validateTerritorialGeometry(proposedFeatures, {
        clipper: window.polygonClipping,
        affectedIds,
      }).filter(issue => !baselineIssueKeys.has(`${issue.kind}:${[...(issue.entityRefs || [])].sort().join('|')}`));
      const preview = buildGeometryPreview({
        operation,
        beforeFeatures,
        afterFeatures,
        removedIds: [...removedIds],
        clipper: window.polygonClipping,
        transferredGeometry,
      });
      const session = beginGeometryPreview(state.geometryPreview, {
        operation,
        baseDataRevision,
        workerRequestId: requestId,
        affectedIds: [...affectedIds],
        beforeFeatures,
        afterFeatures,
        removedIds: [...removedIds],
        ...preview,
        validation: {
          issues: validationIssues,
          blocking: validationIssues.some(issue => issue.severity !== 'warning'),
        },
      });
      activeGeometryPreviewDiscard = () => mapEditClient.discard(requestId);
      activeGeometryPreviewApply = async () => {
        if (!previewIsCurrent(state.geometryPreview, session.sessionId, baseDataRevision) || state.stateRevision !== baseDataRevision) {
          mapEditClient.discard(requestId);
          clearGeometryPreview(state.geometryPreview);
          activeGeometryPreviewApply = null;
          activeGeometryPreviewDiscard = null;
          renderAll();
          updateModeButtons();
          setActionStatus('지도가 바뀌어 미리보기를 취소했습니다.', 'error', 3800);
          return false;
        }
        if (session.validation?.blocking) {
          setActionStatus('미리보기 형상을 수정하세요.', 'error', 3400);
          return false;
        }
        clearGeometryPreview(state.geometryPreview);
        activeGeometryPreviewApply = null;
        activeGeometryPreviewDiscard = null;
        try {
          await applyResult(result);
          assertCurrentProjectReferences();
          mapEditClient.commit(requestId);
          commitHistorySnapshot(snapshot);
          queueAutosave();
          onSuccess(result);
          renderAll();
          updateModeButtons();
          return true;
        } catch (error) {
          mapEditClient.discard(requestId);
          restoreCountryEditSnapshot(snapshot);
          onError(error);
          return false;
        }
      };
      renderAll();
      updateModeButtons();
      const blockingIssue = validationIssues.find(issue => issue.severity !== 'warning');
      setModeBanner(blockingIssue?.message || '변경 결과를 확인한 뒤 적용하세요.');
      if (blockingIssue) $('modeTaskInstruction')?.classList.add('cut-invalid');
      setActionStatus(validationIssues.length
        ? `미리보기에서 geometry 문제 ${validationIssues.length}건을 찾았습니다.`
        : '변경 결과 미리보기를 준비했습니다.', validationIssues.length ? 'error' : 'success', 3600);
      return true;
    } catch (error) {
      if (requestId) mapEditClient.discard(requestId);
      if (!error?.cancelled) onError(error);
      else setActionStatus('지도 작업을 취소했습니다.', 'success', 2200);
      return false;
    }
  }

  function beginLocalGeometryPreview({
    operation,
    beforeFeatures = [],
    afterFeatures = [],
    removedIds = [],
    transferredGeometry = null,
    snapshot = snapshotEditable(),
    applyResult,
    successMessage = '변경을 적용했습니다.',
    errorMessage = '변경을 적용하지 못했습니다.',
  }) {
    discardActiveGeometryPreview({ announce: false });
    const baseDataRevision = state.stateRevision;
    const issues = afterFeatures.flatMap(feature => validateStructuredGeometry(feature));
    const preview = buildGeometryPreview({ operation, beforeFeatures, afterFeatures, removedIds, clipper: window.polygonClipping, transferredGeometry });
    const session = beginGeometryPreview(state.geometryPreview, {
      operation,
      baseDataRevision,
      affectedIds: [...new Set([...beforeFeatures, ...afterFeatures].map(feature => String(feature.properties?.editor_id || feature.id || '')).filter(Boolean))],
      beforeFeatures,
      afterFeatures,
      removedIds,
      ...preview,
      validation: { issues, blocking: issues.some(issue => issue.severity !== 'warning') },
    });
    activeGeometryPreviewDiscard = null;
    activeGeometryPreviewApply = async () => {
      if (!previewIsCurrent(state.geometryPreview, session.sessionId, baseDataRevision) || state.stateRevision !== baseDataRevision) {
        clearGeometryPreview(state.geometryPreview);
        activeGeometryPreviewApply = null;
        renderAll();
        updateModeButtons();
        setActionStatus('지도가 바뀌어 미리보기를 취소했습니다.', 'error', 3600);
        return false;
      }
      if (session.validation?.blocking) {
        setActionStatus('미리보기 형상을 수정하세요.', 'error', 3400);
        return false;
      }
      clearGeometryPreview(state.geometryPreview);
      activeGeometryPreviewApply = null;
      activeGeometryPreviewDiscard = null;
      try {
        await applyResult();
        assertCurrentProjectReferences();
        state.stateRevision += 1;
        queueAutosave();
        renderAll();
        updateModeButtons();
        setActionStatus(successMessage, 'success', 3600);
        return true;
      } catch (error) {
        restoreCountryEditSnapshot(snapshot);
        reportOperationError(error, errorMessage, 'PL-PREVIEW-001', 4400);
        return false;
      }
    };
    renderAll();
    updateModeButtons();
    const blockingIssue = issues.find(issue => issue.severity !== 'warning');
    setModeBanner(blockingIssue?.message || '변경 결과를 확인한 뒤 적용하세요.');
    if (blockingIssue) $('modeTaskInstruction')?.classList.add('cut-invalid');
    return true;
  }

  async function applyActiveGeometryPreview() {
    if (!activeGeometryPreviewApply) return false;
    return activeGeometryPreviewApply();
  }

  function discardActiveGeometryPreview({ announce = true } = {}) {
    if (!state.geometryPreview.session) return false;
    activeGeometryPreviewDiscard?.();
    activeGeometryPreviewApply = null;
    activeGeometryPreviewDiscard = null;
    clearGeometryPreview(state.geometryPreview);
    renderAll();
    updateModeButtons();
    if (announce) setActionStatus('미리보기를 닫았습니다.', 'success', 2600);
    return true;
  }

  function activeCountryBoundaryPlan() {
    if (state.tool === 'country-border' && state.boundaryEditPhase === 'editing') {
      return { mode: 'border', ...planSharedBoundaryEdit(state.sharedBoundaryTopology, state.boundaryEditCountryIds) };
    }
    if (state.tool === 'country-coast' && state.coastEditCountryId) {
      return { mode: 'coast', ...planCoastEdit(state.sharedBoundaryTopology, state.coastEditCountryId) };
    }
    return null;
  }

  function getCountryBoundaryHandles() {
    const plan = activeCountryBoundaryPlan();
    if (!plan) return [];
    const allowedIds = new Set(plan.mode === 'border' ? state.boundaryEditCountryIds.map(String) : [String(state.coastEditCountryId)]);
    const scope = state.coastEditScopeDrawingId
      ? state.drawings.find(item => String(item.id) === String(state.coastEditScopeDrawingId))
      : null;
    const handles = [];
    const nodeKeys = new Set([...plan.editableNodeKeys, ...plan.fixedNodeKeys]);
    for (const nodeKey of nodeKeys) {
      const node = state.sharedBoundaryTopology?.nodes?.get?.(nodeKey);
      if (!node) continue;
      const ref = node.refs.find(item => allowedIds.has(String(item.featureId)))
        || node.virtualRefs?.find(item => allowedIds.has(String(item.featureId)));
      if (!ref) continue;
      if (scope && !pointInDrawingFeature(node.coordinate, drawingDisplayFeature(scope))) continue;
      handles.push({
        key: `${ref.polygonIndex}:${ref.ringIndex}:${ref.vertexIndex ?? ref.segmentIndex}`,
        polygonIndex: ref.polygonIndex,
        ringIndex: ref.ringIndex,
        index: ref.vertexIndex ?? ref.segmentIndex,
        nodeKey: node.key,
        coord: node.coordinate,
        boundaryKind: node.kind === 'coast' ? 'coast' : 'shared',
        ownerIds: [...node.ownerIds],
        fixed: plan.fixedNodeKeys.has(node.key),
      });
    }
    return handles;
  }

  function getCountryBoundarySegments() {
    const plan = activeCountryBoundaryPlan();
    if (!plan) return [];
    const result = [];
    for (const segmentKey of plan.segmentKeys) {
      const edge = state.sharedBoundaryTopology?.segments?.get?.(segmentKey);
      if (!edge) continue;
      result.push({
        key: edge.key,
        kind: plan.mode === 'border' ? 'shared' : 'coast',
        geometry: { type: 'LineString', coordinates: [edge.a, edge.b] },
      });
    }
    return result;
  }

  function geometryMultiCoordinates(geometry) {
    if (!geometry) return [];
    if (geometry.type === 'Polygon') return [geometry.coordinates || []];
    if (geometry.type === 'MultiPolygon') return geometry.coordinates || [];
    return [];
  }

  function multiPolygonPlanarArea(multiPolygon) {
    return (multiPolygon || []).reduce((total, polygon) => {
      if (!polygon?.length) return total;
      const exterior = Math.abs(ringSignedArea(ensureClosedRing(polygon[0])));
      const holes = polygon.slice(1).reduce((sum, ring) => sum + Math.abs(ringSignedArea(ensureClosedRing(ring))), 0);
      return total + Math.max(0, exterior - holes);
    }, 0);
  }

  function territoryComponentKey(countryId, polygonIndex) {
    return `component:${String(countryId)}:${Number(polygonIndex)}`;
  }

  function territoryComponentContext() {
    if (state.tool === 'annex-territory') {
      const donorIds = new Set(state.annexDonorCountryIds.map(String));
      return {
        selectedKeys: state.annexSelectedComponentKeys,
        features: (state.countriesData?.features || []).filter(feature => donorIds.has(String(feature.properties?.editor_id || ''))),
      };
    }
    if (state.tool === 'new-country') {
      const sourceIds = new Set(state.newCountrySourceIds.map(String));
      return {
        selectedKeys: state.newCountrySelectedComponentKeys,
        features: (state.countriesData?.features || []).filter(feature => sourceIds.has(String(feature.properties?.editor_id || ''))),
      };
    }
    return { selectedKeys: [], features: [] };
  }

  function territoryComponentItems() {
    const context = territoryComponentContext();
    const selected = new Set(context.selectedKeys);
    const items = [];
    for (const feature of context.features) {
      const countryId = String(feature.properties?.editor_id || '');
      geometryPolygonSets(feature.geometry).forEach((polygon, polygonIndex) => {
        const geometry = normalizeClippedLandGeometry([deepClone(polygon)]);
        if (!geometry) return;
        const key = territoryComponentKey(countryId, polygonIndex);
        const areaKm2 = Math.max(0, d3.geo.area(geometry) * 6371.0088 * 6371.0088);
        items.push({
          key, countryId, polygonIndex, geometry, areaKm2,
          countryName: countryName(feature),
          selected: selected.has(key),
        });
      });
    }
    return items;
  }

  function selectedTerritoryComponentItems() {
    return territoryComponentItems().filter(item => item.selected);
  }

  function selectedTerritoryComponentGeometry() {
    const clipper = window.polygonClipping;
    if (!clipper?.union) throw new Error('영토 조각 결합 엔진을 불러오지 못했습니다.');
    const selected = selectedTerritoryComponentItems();
    if (!selected.length) throw new Error('영토 조각을 하나 이상 선택하세요.');
    const union = clipper.union(...selected.map(item => item.geometry.coordinates));
    const geometry = normalizeClippedLandGeometry(union);
    if (!geometry) throw new Error('선택한 영토 조각을 결합할 수 없습니다.');
    return geometry;
  }

  function formatTerritoryArea(areaKm2) {
    const area = Math.max(0, Number(areaKm2) || 0);
    const maximumFractionDigits = area < 10 ? 2 : area < 100 ? 1 : 0;
    return `${area.toLocaleString('ko-KR', { maximumFractionDigits })} km²`;
  }

  function countryUnionFromFeatures(features, ids) {
    const clipper = window.polygonClipping;
    const wanted = new Set([...ids].map(String));
    const pieces = (features || [])
      .filter(feature => wanted.has(String(feature.properties?.editor_id || '')))
      .map(feature => feature.geometry?.coordinates)
      .filter(Boolean);
    if (!pieces.length) return [];
    return clipper.union(...pieces);
  }

  function unwrapRingLongitudes(rawRing) {
    const ring = ensureClosedRing(rawRing);
    if (!ring.length) return [];
    const out = [[ring[0][0], ring[0][1]]];
    for (let i = 1; i < ring.length; i += 1) {
      let lon = ring[i][0];
      const previous = out[i - 1][0];
      while (lon - previous > 180) lon -= 360;
      while (lon - previous < -180) lon += 360;
      out.push([lon, ring[i][1]]);
    }
    return out;
  }

  function orientation2d(a, b, c) {
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  }

  function segmentsProperlyIntersect(a, b, c, d, epsilon = 1e-10) {
    const abC = orientation2d(a, b, c);
    const abD = orientation2d(a, b, d);
    const cdA = orientation2d(c, d, a);
    const cdB = orientation2d(c, d, b);
    return ((abC > epsilon && abD < -epsilon) || (abC < -epsilon && abD > epsilon)) &&
      ((cdA > epsilon && cdB < -epsilon) || (cdA < -epsilon && cdB > epsilon));
  }

  function ringHasSelfIntersection(rawRing) {
    const ring = unwrapRingLongitudes(rawRing);
    const segmentCount = Math.max(0, ring.length - 1);
    if (segmentCount < 4) return false;
    const segments = [];
    for (let index = 0; index < segmentCount; index += 1) {
      const a = ring[index], b = ring[index + 1];
      segments.push({
        index, a, b,
        minX: Math.min(a[0], b[0]), maxX: Math.max(a[0], b[0]),
        minY: Math.min(a[1], b[1]), maxY: Math.max(a[1], b[1]),
      });
    }
    segments.sort((a, b) => a.minX - b.minX || a.minY - b.minY || a.index - b.index);
    let active = [];
    for (const segment of segments) {
      active = active.filter(other => other.maxX >= segment.minX);
      for (const other of active) {
        if (Math.abs(segment.index - other.index) <= 1 ||
            (Math.min(segment.index, other.index) === 0 && Math.max(segment.index, other.index) === segmentCount - 1)) continue;
        if (other.maxY < segment.minY || other.minY > segment.maxY) continue;
        if (segmentsProperlyIntersect(segment.a, segment.b, other.a, other.b)) return true;
      }
      active.push(segment);
    }
    return false;
  }

  function countryGeometryIsValid(geometry) {
    const polygons = geometryMultiCoordinates(geometry);
    if (!polygons.length) return false;
    return polygons.every(polygon => polygon?.length && polygon.every(ring => {
      const closed = ensureClosedRing(ring);
      const unique = new Set(closed.slice(0, -1).map(coord => coordKey(coord, 8)));
      return closed.length >= 4 && unique.size >= 3 &&
        coordNear(closed[0], closed[closed.length - 1], 1e-9) &&
        Math.abs(ringSignedArea(closed)) > 1e-14 &&
        !ringHasSelfIntersection(closed);
    }));
  }

  function snapGeometryToGrid(geometry, precision = 7) {
    if (!geometry?.coordinates) return geometry;
    const factor = 10 ** precision;
    const snap = value => {
      if (Array.isArray(value) && value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
        return [Math.round(Number(value[0]) * factor) / factor, Math.round(Number(value[1]) * factor) / factor];
      }
      return Array.isArray(value) ? value.map(snap) : value;
    };
    return { ...geometry, coordinates: snap(geometry.coordinates) };
  }

  function validateCountryGeometryEdit(affectedIds, baselineOrUnion = null) {
    const clipper = window.polygonClipping;
    const affected = new Set([...affectedIds].map(String));
    const baseline = baselineOrUnion?.union
      ? baselineOrUnion
      : { union: baselineOrUnion, overlaps: new Map(), boundaryLength: 0 };
    const areaTolerance = Math.max(1e-8, Number(baseline.boundaryLength || 0) * 2e-7);
    const features = state.countriesData?.features || [];
    const ids = features.map(feature => String(feature.properties?.editor_id || ''));
    if (ids.some(id => !id) || new Set(ids).size !== ids.length) {
      return { ok: false, message: '국가 ID가 비어 있거나 중복되었습니다.' };
    }
    for (const feature of features) {
      const id = String(feature.properties?.editor_id || '');
      if (affected.has(id) && !countryGeometryIsValid(feature.geometry)) {
        return { ok: false, message: `${countryName(feature)}의 경계가 유효하지 않습니다.` };
      }
    }

    const tested = new Set();
    for (const feature of features) {
      const id = String(feature.properties?.editor_id || '');
      if (!affected.has(id)) continue;
      const bounds = geometryBounds(feature.geometry);
      for (const other of spatialFeatures(bounds)) {
        const otherId = String(other.properties?.editor_id || '');
        if (id === otherId) continue;
        const pairKey = id < otherId ? `${id}|${otherId}` : `${otherId}|${id}`;
        if (tested.has(pairKey)) continue;
        tested.add(pairKey);
        const overlapArea = multiPolygonPlanarArea(clipper.intersection(feature.geometry.coordinates, other.geometry.coordinates));
        const previousArea = Number(baseline.overlaps?.get(pairKey) || 0);
        if (overlapArea > previousArea + areaTolerance) {
          return { ok: false, message: `${countryName(feature)}과(와) ${countryName(other)} 사이에 ${(overlapArea - previousArea).toExponential(3)}deg²의 새 중첩이 생겼습니다. 편입 영역을 줄이거나 국경선을 다시 지정하세요.` };
        }
      }
    }

    if (baseline.union) {
      const unionAfter = countryUnionFromFeatures(features, affected);
      const changedArea = multiPolygonPlanarArea(clipper.xor(baseline.union, unionAfter));
      if (changedArea > areaTolerance) return { ok: false, message: `편집 영역에 ${changedArea.toExponential(3)}deg²의 새 빈틈 또는 면적 변화가 생겼습니다. 편입선을 다시 지정하세요.` };
    }
    return { ok: true };
  }

  function captureCountryGeometryValidationBaseline(affectedIds) {
    const ids = new Set([...affectedIds].map(String));
    const features = state.countriesData?.features || [];
    const clipper = window.polygonClipping;
    const overlaps = new Map();
    let boundaryLength = 0;
    for (const feature of features) {
      const id = String(feature.properties?.editor_id || '');
      if (!ids.has(id)) continue;
      for (const polygon of geometryPolygonSets(feature.geometry)) for (const ring of polygon || []) {
        for (let index = 0; index < ring.length - 1; index += 1) boundaryLength += Math.hypot(ring[index + 1][0] - ring[index][0], ring[index + 1][1] - ring[index][1]);
      }
      for (const other of spatialFeatures(geometryBounds(feature.geometry))) {
        const otherId = String(other.properties?.editor_id || '');
        if (!otherId || otherId === id) continue;
        const pairKey = id < otherId ? `${id}|${otherId}` : `${otherId}|${id}`;
        if (overlaps.has(pairKey)) continue;
        overlaps.set(pairKey, multiPolygonPlanarArea(clipper.intersection(feature.geometry.coordinates, other.geometry.coordinates)));
      }
    }
    return { union: countryUnionFromFeatures(features, ids), overlaps, boundaryLength };
  }

  function structuredGeometryIssueKey(issue = {}) {
    const entityRefs = [...(issue.entityRefs || [])].map(String).sort().join('|');
    return [
      issue.kind || 'geometry',
      entityRefs,
      issue.polygonIndex ?? '',
      issue.ringIndex ?? '',
      issue.vertexIndex ?? '',
      issue.segmentIndex ?? '',
    ].join(':');
  }

  function restoreCountryEditSnapshot(snapshot) {
    const changedIds = new Set(state.historyDirtyCountryIds);
    applySharedProjectFields(snapshot, 'history');
    restoreCountriesFromSnapshot(snapshot);
    normalizeProjectObjects();
    const restoredDirtyIds = new Set(state.historyDirtyCountryIds);
    for (const id of state.historyDirtyCountryIds) changedIds.add(String(id));
    markCountryGeometriesChanged(changedIds);
    state.historyDirtyCountryIds = restoredDirtyIds;
    rebuildBoundaryTopology(state.tool === 'country-border' ? state.boundaryEditCountryIds : state.coastEditCountryId);
    renderAll();
  }

  function interpolateCoordinate(a, b, t) {
    let targetLon = b[0];
    while (targetLon - a[0] > 180) targetLon -= 360;
    while (targetLon - a[0] < -180) targetLon += 360;
    let lon = a[0] + (targetLon - a[0]) * t;
    while (lon > 180) lon -= 360;
    while (lon < -180) lon += 360;
    return [lon, a[1] + (b[1] - a[1]) * t];
  }

  function refreshCountryCentroids(ids = null) {
    const filter = ids ? new Set([...ids].map(String)) : null;
    for (const feature of state.countriesData?.features || []) {
      const id = String(feature.properties?.editor_id || '');
      if (filter && !filter.has(id)) continue;
      try { feature.properties.editor_centroid = d3.geo.centroid(feature); }
      catch (_) { feature.properties.editor_centroid = [0, 0]; }
    }
    scheduleCountryLabelAnchors(filter, 20);
  }

  function pointOnSegment(point, a, b, tolerance = 1e-7) {
    const cross = (point[1] - a[1]) * (b[0] - a[0]) - (point[0] - a[0]) * (b[1] - a[1]);
    if (Math.abs(cross) > tolerance) return false;
    const dot = (point[0] - a[0]) * (point[0] - b[0]) + (point[1] - a[1]) * (point[1] - b[1]);
    return dot <= tolerance;
  }

  function pointInRing(point, rawRing) {
    const ring = ensureClosedRing(rawRing);
    let inside = false;
    for (let i = 0, j = ring.length - 2; i < ring.length - 1; j = i++) {
      const a = ring[j], b = ring[i];
      if (pointOnSegment(point, a, b, 1e-6)) return true;
      const intersects = ((b[1] > point[1]) !== (a[1] > point[1])) &&
        (point[0] < (a[0] - b[0]) * (point[1] - b[1]) / ((a[1] - b[1]) || 1e-12) + b[0]);
      if (intersects) inside = !inside;
    }
    return inside;
  }

  function pointInPolygonSet(point, polygon) {
    if (!polygon?.length || !pointInRing(point, polygon[0])) return false;
    for (let i = 1; i < polygon.length; i += 1) if (pointInRing(point, polygon[i])) return false;
    return true;
  }

  function pointInCountryFeature(point, feature) {
    return geometryPolygonSets(feature?.geometry).some(polygon => pointInPolygonSet(point, polygon));
  }

  function pointInDrawingFeature(point, feature) {
    return geometryPolygonSets(feature?.geometry).some(polygon => pointInPolygonSet(point, polygon));
  }

  function pointOnGeometryBoundary(point, geometry, tolerance = 0.00008) {
    for (const polygon of geometryPolygonSets(geometry)) {
      for (const rawRing of polygon) {
        const ring = ensureClosedRing(rawRing);
        for (let index = 0; index < ring.length - 1; index += 1) {
          if (pointOnSegment(point, ring[index], ring[index + 1], tolerance)) return true;
        }
      }
    }
    return false;
  }

  function partitionGroupMatches(feature, { unitType, sovereignId, parentId = '', adminLevel = null }) {
    const expectedParentId = String(parentId || sovereignId || '');
    return feature.properties?.unitType === unitType
      && String(feature.properties?.sovereignId || '') === String(sovereignId || '')
      && String(feature.properties?.parentId || '') === expectedParentId
      && (unitType !== TERRITORIAL_UNIT_TYPES.ADMIN || Number(feature.properties?.adminLevel || 1) === Number(adminLevel || 1));
  }

  function addUnassignedTerritorialUnitGeometry(context, geometry) {
    const clipper = window.polygonClipping;
    const normalized = normalizeClippedLandGeometry(geometry?.coordinates || geometry);
    if (!normalized) return null;
    let target = state.territorialUnits.find(feature => partitionGroupMatches(feature, context)
      && feature.properties?.isRemainder === true);
    if (target) {
      target.geometry = normalizeClippedLandGeometry(clipper.union(target.geometry.coordinates, normalized.coordinates)) || target.geometry;
      return target;
    }
    target = createPartitionTerritorialFeature({
      id: uid(context.unitType === TERRITORIAL_UNIT_TYPES.ADMIN ? 'administrative' : 'territory'),
      ...context,
      isRemainder: true,
      geometry: normalized,
    });
    state.territorialUnits.push(target);
    return target;
  }

  function reconcileTerritorialUnitCompleteness(countryIds, { preserveIds = [] } = {}) {
    const clipper = window.polygonClipping;
    if (!clipper?.intersection || !clipper?.difference || !clipper?.union) return;
    const wanted = new Set([...countryIds].map(String));
    const preserved = new Set(preserveIds.map(String));
    state.territorialUnits = state.territorialUnits.flatMap(feature => {
      const countryId = String(feature.properties?.sovereignId || '');
      if (!wanted.has(countryId)) return [feature];
      if (preserved.has(String(feature.id))) return [feature];
      const container = territorialUnitContainer(feature);
      if (!container?.geometry) return [];
      const clipped = normalizeClippedLandGeometry(clipper.intersection(feature.geometry.coordinates, container.geometry.coordinates));
      if (!clipped) return [];
      feature.geometry = clipped;
      return [feature];
    });

    for (const countryId of wanted) {
      const country = countryFeatureById(countryId);
      if (!country) continue;
      const territoryGroup = state.territorialUnits.filter(feature => partitionGroupMatches(feature, {
        unitType: TERRITORIAL_UNIT_TYPES.TERRITORY, sovereignId: countryId,
      }));
      if (territoryGroup.length) {
        const covered = clipper.union(...territoryGroup.map(feature => feature.geometry.coordinates));
        const remainder = normalizeClippedLandGeometry(clipper.difference(country.geometry.coordinates, covered));
        if (remainder) addUnassignedTerritorialUnitGeometry({ unitType: TERRITORIAL_UNIT_TYPES.TERRITORY, sovereignId: countryId, parentId: '', adminLevel: null }, remainder);
      }
    }

    const groupContexts = new Map();
    for (const feature of state.territorialUnits) {
      if (feature.properties?.unitType !== TERRITORIAL_UNIT_TYPES.ADMIN || !wanted.has(String(feature.properties?.sovereignId || ''))) continue;
      const context = {
        unitType: TERRITORIAL_UNIT_TYPES.ADMIN,
        sovereignId: String(feature.properties.sovereignId || ''),
        parentId: String(feature.properties.parentId || ''),
        adminLevel: Number(feature.properties.adminLevel) || 1,
      };
      groupContexts.set(`${context.sovereignId}|${context.parentId}|${context.adminLevel}`, context);
    }
    for (const context of [...groupContexts.values()].sort((left, right) => left.adminLevel - right.adminLevel)) {
      const parent = context.parentId ? territorialUnitById(context.parentId) : countryFeatureById(context.sovereignId);
      if (!parent?.geometry) continue;
      const siblings = state.territorialUnits.filter(feature => partitionGroupMatches(feature, context));
      const covered = clipper.union(...siblings.map(feature => feature.geometry.coordinates));
      const remainder = normalizeClippedLandGeometry(clipper.difference(parent.geometry.coordinates, covered));
      if (remainder) addUnassignedTerritorialUnitGeometry(context, remainder);
    }
    state.territorialUnits = normalizeTerritorialUnits(state.territorialUnits, { countryExists: id => !!countryFeatureById(id) });
  }

  function syncHardLandDependents(ownerId, _ownerBeforeGeometry, _ownerAfterGeometry, _changedAnchor = null) {
    const beforeIds = new Set(state.territorialUnits.map(feature => String(feature.id)));
    reconcileTerritorialUnitCompleteness([ownerId]);
    markLayerTreeDirty();
    return state.territorialUnits.filter(feature => !beforeIds.has(String(feature.id))).map(feature => String(feature.id));
  }

  function transferLandDependents(transferredGeometry, sourceOwnerIds, targetOwnerId) {
    const clipper = window.polygonClipping;
    if (!transferredGeometry || !clipper?.difference) return [];
    const sources = new Set(sourceOwnerIds.map(String));
    const changedIds = [];
    state.territorialUnits = state.territorialUnits.flatMap(feature => {
      if (!sources.has(String(feature.properties?.sovereignId || ''))) return [feature];
      const remainder = normalizeClippedLandGeometry(clipper.difference(feature.geometry.coordinates, transferredGeometry.coordinates));
      changedIds.push(String(feature.id));
      if (!remainder) return [];
      feature.geometry = remainder;
      return [feature];
    });
    const targetHasTerritories = state.territorialUnits.some(feature => partitionGroupMatches(feature, {
      unitType: TERRITORIAL_UNIT_TYPES.TERRITORY, sovereignId: targetOwnerId,
    }));
    if (targetHasTerritories) addUnassignedTerritorialUnitGeometry({
      unitType: TERRITORIAL_UNIT_TYPES.TERRITORY, sovereignId: String(targetOwnerId), parentId: '', adminLevel: null,
    }, transferredGeometry);
    reconcileTerritorialUnitCompleteness([...sources, String(targetOwnerId)]);
    markLayerTreeDirty();
    return changedIds;
  }

  function reassignLandDependents(removedOwnerIds, targetOwnerId) {
    const removed = new Set(removedOwnerIds.map(String));
    for (const feature of state.territorialUnits) {
      if (!removed.has(String(feature.properties?.sovereignId || ''))) continue;
      feature.properties.sovereignId = String(targetOwnerId);
      if (removed.has(String(feature.properties?.parentId || ''))) feature.properties.parentId = String(targetOwnerId);
    }
    for (const relation of state.territorialRelations) {
      if (removed.has(String(relation.sovereignId || ''))) relation.sovereignId = String(targetOwnerId);
      if (removed.has(String(relation.parentId || ''))) relation.parentId = String(targetOwnerId);
    }
    for (const entry of state.distributionEntries) {
      if (entry.mode === DISTRIBUTION_MODES.TERRITORIAL && removed.has(String(entry.territorialUnitId))) entry.territorialUnitId = String(targetOwnerId);
    }
    state.territorialUnits = normalizeTerritorialUnits(state.territorialUnits, { countryExists: id => !!countryFeatureById(id) });
    reconcileTerritorialUnitCompleteness([targetOwnerId]);
    markLayerTreeDirty();
  }

  function reassignDrawingParents(removedDrawingIds, replacementId = '') {
    const removed = new Set(removedDrawingIds.map(String));
    for (const feature of state.drawings) {
      if (!removed.has(String(feature.properties?.pandolab_parent_id || ''))) continue;
      feature.properties.pandolab_parent_id = String(replacementId || '');
    }
  }

  function coordinateBounds(value, bounds = [Infinity, Infinity, -Infinity, -Infinity]) {
    if (!Array.isArray(value)) return bounds;
    if (value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
      const x = Number(value[0]);
      const y = Number(value[1]);
      bounds[0] = Math.min(bounds[0], x);
      bounds[1] = Math.min(bounds[1], y);
      bounds[2] = Math.max(bounds[2], x);
      bounds[3] = Math.max(bounds[3], y);
      return bounds;
    }
    value.forEach(item => coordinateBounds(item, bounds));
    return bounds;
  }

  function boundsOverlap(a, b) {
    return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
  }

  function normalizeClippedLandGeometry(multiPolygon) {
    return normalizeCountryGeometry(multiPolygon);
  }



  function pointOnRingBoundary(point, rawRing, tolerance = 1e-7) {
    const ring = ensureClosedRing(rawRing);
    for (let i = 0; i < ring.length - 1; i += 1) {
      if (pointOnSegment(point, ring[i], ring[i + 1], tolerance)) return true;
    }
    return false;
  }

  function pointInPolygonSetInterior(point, polygon) {
    if (!polygon?.length || pointOnRingBoundary(point, polygon[0])) return false;
    if (!pointInRing(point, polygon[0])) return false;
    for (let i = 1; i < polygon.length; i += 1) {
      if (pointOnRingBoundary(point, polygon[i]) || pointInRing(point, polygon[i])) return false;
    }
    return true;
  }

  function segmentsIntersectOrTouch(a, b, c, d, tolerance = 1e-9) {
    return segmentsProperlyIntersect(a, b, c, d, tolerance) ||
      pointOnSegment(a, c, d, tolerance) || pointOnSegment(b, c, d, tolerance) ||
      pointOnSegment(c, a, b, tolerance) || pointOnSegment(d, a, b, tolerance);
  }

  function lineHasSelfIntersection(coords) {
    const segmentCount = Math.max(0, (coords?.length || 0) - 1);
    for (let i = 0; i < segmentCount; i += 1) {
      for (let j = i + 1; j < segmentCount; j += 1) {
        if (Math.abs(i - j) <= 1) continue;
        if (segmentsIntersectOrTouch(coords[i], coords[i + 1], coords[j], coords[j + 1])) return true;
      }
    }
    return false;
  }


  function unwrapLongitudeNear(longitude, reference) {
    let value = Number(longitude);
    while (value - reference > 180) value -= 360;
    while (value - reference < -180) value += 360;
    return value;
  }

  function segmentIntersectionDetail(a, b, c, d, epsilon = 1e-10) {
    const p = [Number(a[0]), Number(a[1])];
    const q = [unwrapLongitudeNear(c[0], p[0]), Number(c[1])];
    const bLon = unwrapLongitudeNear(b[0], p[0]);
    let dLon = unwrapLongitudeNear(d[0], q[0]);
    const lineMid = (p[0] + bLon) / 2;
    while ((q[0] + dLon) / 2 - lineMid > 180) { q[0] -= 360; dLon -= 360; }
    while ((q[0] + dLon) / 2 - lineMid < -180) { q[0] += 360; dLon += 360; }
    const r = [bLon - p[0], Number(b[1]) - p[1]];
    const s = [dLon - q[0], Number(d[1]) - q[1]];
    const cross = (u, v) => u[0] * v[1] - u[1] * v[0];
    const qp = [q[0] - p[0], q[1] - p[1]];
    const denominator = cross(r, s);
    if (Math.abs(denominator) <= epsilon) {
      if (Math.abs(cross(qp, r)) > epsilon) return null;
      const length2 = r[0] * r[0] + r[1] * r[1];
      if (length2 <= epsilon) return null;
      const t0 = (qp[0] * r[0] + qp[1] * r[1]) / length2;
      const qd = [q[0] + s[0] - p[0], q[1] + s[1] - p[1]];
      const t1 = (qd[0] * r[0] + qd[1] * r[1]) / length2;
      const overlapStart = Math.max(0, Math.min(t0, t1));
      const overlapEnd = Math.min(1, Math.max(t0, t1));
      return overlapEnd - overlapStart > epsilon ? { overlap: true } : null;
    }
    const lineT = cross(qp, s) / denominator;
    const boundaryT = cross(qp, r) / denominator;
    if (lineT < -epsilon || lineT > 1 + epsilon || boundaryT < -epsilon || boundaryT > 1 + epsilon) return null;
    const t = clamp(lineT, 0, 1);
    return {
      overlap: false,
      lineT: t,
      boundaryT: clamp(boundaryT, 0, 1),
      coord: interpolateCoordinate(a, b, t),
    };
  }

  function coordinateAtPathPosition(rawLine, position) {
    const maxPosition = Math.max(0, rawLine.length - 1);
    const bounded = clamp(position, 0, maxPosition);
    if (bounded >= maxPosition) return rawLine[rawLine.length - 1].slice();
    const segmentIndex = Math.floor(bounded);
    return interpolateCoordinate(rawLine[segmentIndex], rawLine[segmentIndex + 1], bounded - segmentIndex);
  }

  function interiorComponentIndex(point, polygons) {
    for (let index = 0; index < polygons.length; index += 1) {
      if (pointInPolygonSetInterior(point, polygons[index])) return index;
    }
    return null;
  }

  function activeCutDraftSourceGeometry() {
    if (state.tool === 'split-drawing') {
      return state.drawings.find(item => String(item.id) === String(state.drawingSplitSourceId))?.geometry || null;
    }
    if (state.tool === 'split-territorial-unit') {
      return (territorialUnitById(state.territorialUnitSplitSourceId) || state.territorialUnitSplitVirtualSource)?.geometry || null;
    }
    if (state.tool === 'annex-territory' && state.annexPhase === 'line') return state.annexSourceGeometry;
    if (state.tool === 'new-country' && state.newCountryPhase === 'line') return state.newCountrySourceGeometry;
    return null;
  }

  function cutEndpointSnapDistance() {
    const coarsePointer = window.matchMedia?.('(pointer: coarse)')?.matches;
    return coarsePointer ? CUT_ENDPOINT_SNAP_DISTANCE.touch : CUT_ENDPOINT_SNAP_DISTANCE.mouse;
  }

  function snapCutDraftLine(rawLine, sourceGeometry) {
    return snapLineEndpointsToBoundary(rawLine, sourceGeometry, {
      project: coordinate => activeProjection()(coordinate),
      maxDistance: cutEndpointSnapDistance(),
      isVisible: isCoordVisible,
      maxSegmentLength: Math.max(1, state.size.width * 0.7),
    });
  }

  function cutDraftErrorMessage(line, sourceGeometry, originalError) {
    const fallback = String(originalError?.message || '경계선을 사용할 수 없습니다.');
    if (!Array.isArray(line) || line.length < 2) return '경계선을 만들려면 점을 두 개 이상 입력하세요.';
    const polygons = geometryPolygonSets(sourceGeometry);
    if (!polygons.length) return fallback;
    let events;
    try { events = collectCutBoundaryEvents(line, polygons); }
    catch (_) { return fallback; }
    if (events.length > 2) return '경계를 여러 번 가로지릅니다. 한 번만 관통하세요.';
    const startInside = interiorComponentIndex(line[0], polygons) !== null;
    const endInside = interiorComponentIndex(line[line.length - 1], polygons) !== null;
    if (startInside && endInside) return '시작점과 끝점을 영역 밖에 놓으세요.';
    if (startInside) return '시작점을 영역 밖에 놓으세요.';
    if (endInside) return '끝점을 영역 밖에 놓으세요.';
    if (events.length === 0) return '영역을 통과하지 않습니다. 양쪽 경계를 가로지르세요.';
    if (events.length === 1) return '한쪽 경계만 연결됐습니다. 반대쪽 경계까지 그리세요.';
    return fallback;
  }

  function cutDraftIssues(line, sourceGeometry, originalError) {
    if (!Array.isArray(line) || line.length < 2) return [];
    const message = cutDraftErrorMessage(line, sourceGeometry, originalError);
    const issues = [];
    for (let index = 1; index < line.length; index += 1) {
      if (!coordNear(line[index - 1], line[index], 1e-9)) continue;
      issues.push({ kind: 'duplicate-vertex', coordinate: line[index].slice(), vertexIndex: index, segmentIndex: index - 1, message });
      return issues;
    }
    const selfIntersection = draftSelfIntersectionIssue(line, false);
    if (selfIntersection) {
      issues.push({ ...selfIntersection, message });
      return issues;
    }
    const polygons = geometryPolygonSets(sourceGeometry);
    if (!polygons.length) return [{ kind: 'invalid-cut', coordinate: line[Math.floor((line.length - 1) / 2)].slice(), message }];
    const startInside = interiorComponentIndex(line[0], polygons) !== null;
    const endInside = interiorComponentIndex(line[line.length - 1], polygons) !== null;
    if (startInside) issues.push({ kind: 'endpoint-inside', coordinate: line[0].slice(), vertexIndex: 0, message });
    if (endInside) issues.push({ kind: 'endpoint-inside', coordinate: line[line.length - 1].slice(), vertexIndex: line.length - 1, message });
    if (issues.length) return issues;
    let events;
    try { events = collectCutBoundaryEvents(line, polygons); }
    catch (_) {
      return [{
        kind: 'boundary-overlap',
        coordinate: interpolateCoordinate(line[0], line[1], 0.5),
        segmentIndex: 0,
        message,
      }];
    }
    if (events.length > 2) {
      return events.slice(2).map(event => ({
        kind: 'extra-boundary-crossing',
        coordinate: event.coord.slice(),
        segmentIndex: Math.min(line.length - 2, Math.max(0, Math.floor(event.position))),
        message,
      }));
    }
    if (events.length === 1) {
      const event = events[0];
      const distanceToStart = Math.abs(event.position);
      const distanceToEnd = Math.abs((line.length - 1) - event.position);
      const vertexIndex = distanceToStart > distanceToEnd ? 0 : line.length - 1;
      return [{ kind: 'missing-boundary-connection', coordinate: line[vertexIndex].slice(), vertexIndex, message }];
    }
    if (events.length === 2) {
      const middlePosition = (events[0].position + events[1].position) / 2;
      const middle = coordinateAtPathPosition(line, middlePosition);
      const componentIndex = interiorComponentIndex(middle, polygons);
      if (componentIndex !== null) {
        const component = polygons[componentIndex];
        for (let index = 1; index < line.length - 1; index += 1) {
          if (pointInPolygonSetInterior(line[index], component)) continue;
          return [{ kind: 'intermediate-outside', coordinate: line[index].slice(), vertexIndex: index, message }];
        }
        for (let index = 0; index < line.length - 1; index += 1) {
          const a = line[index], b = line[index + 1];
          const projectedA = activeProjection()(a);
          const projectedB = activeProjection()(b);
          const screenLength = projectedA && projectedB ? Math.hypot(projectedB[0] - projectedA[0], projectedB[1] - projectedA[1]) : 120;
          const samples = clamp(Math.ceil(screenLength / 8), 12, 80);
          for (let sample = 1; sample < samples; sample += 1) {
            const coordinate = interpolateCoordinate(a, b, sample / samples);
            if (pointInPolygonSetInterior(coordinate, component)) continue;
            return [{ kind: 'segment-outside', coordinate, segmentIndex: index, message }];
          }
        }
      }
    }
    const middleSegmentIndex = Math.max(0, Math.min(line.length - 2, Math.floor((line.length - 2) / 2)));
    return [{
      kind: events.length ? 'invalid-cut' : 'no-boundary-crossing',
      coordinate: interpolateCoordinate(line[middleSegmentIndex], line[middleSegmentIndex + 1], 0.5),
      segmentIndex: middleSegmentIndex,
      message,
    }];
  }

  function prepareCutDraft(rawLine, sourceGeometry) {
    const snapped = snapCutDraftLine(rawLine, sourceGeometry);
    try {
      const extracted = extractSingleInteriorCut(snapped.line, sourceGeometry);
      validateAnnexCutLine(extracted.cutLine, extracted.component);
      return { ...snapped, extracted };
    } catch (error) {
      throw new Error(cutDraftErrorMessage(snapped.line, sourceGeometry, error), { cause: error });
    }
  }

  function assessCutDraft(rawLine, sourceGeometry) {
    const snapped = snapCutDraftLine(rawLine, sourceGeometry);
    if (snapped.line.length < 2) {
      return { ...snapped, status: 'pending', valid: false, message: '', issues: [] };
    }
    try {
      const extracted = extractSingleInteriorCut(snapped.line, sourceGeometry);
      validateAnnexCutLine(extracted.cutLine, extracted.component);
      return { ...snapped, extracted, status: 'valid', valid: true, message: '', issues: [] };
    } catch (error) {
      const message = cutDraftErrorMessage(snapped.line, sourceGeometry, error);
      return {
        ...snapped,
        status: 'invalid',
        valid: false,
        message,
        issues: cutDraftIssues(snapped.line, sourceGeometry, error),
      };
    }
  }

  function collectCutBoundaryEvents(rawLine, polygons) {
    const events = [];
    for (let lineIndex = 0; lineIndex < rawLine.length - 1; lineIndex += 1) {
      const a = rawLine[lineIndex], b = rawLine[lineIndex + 1];
      if (coordNear(a, b, 1e-10)) continue;
      polygons.forEach((polygon, polygonIndex) => {
        polygon.forEach((rawRing, ringIndex) => {
          const ring = ensureClosedRing(rawRing);
          for (let boundarySegmentIndex = 0; boundarySegmentIndex < ring.length - 1; boundarySegmentIndex += 1) {
            const detail = segmentIntersectionDetail(a, b, ring[boundarySegmentIndex], ring[boundarySegmentIndex + 1]);
            if (!detail) continue;
            if (detail.overlap) throw new Error('국경선을 기존 경계와 겹쳐 그릴 수 없습니다.');
            events.push({
              position: lineIndex + detail.lineT,
              coord: detail.coord,
              ref: { polygonIndex, ringIndex, boundarySegmentIndex, boundaryT: detail.boundaryT },
            });
          }
        });
      });
    }
    events.sort((a, b) => a.position - b.position);
    const unique = [];
    for (const event of events) {
      const previous = unique[unique.length - 1];
      if (previous && Math.abs(previous.position - event.position) <= 1e-7 && coordNear(previous.coord, event.coord, 1e-7)) {
        previous.refs.push(event.ref);
      } else {
        unique.push({ position: event.position, coord: event.coord.slice(), refs: [event.ref] });
      }
    }
    return unique;
  }

  function extractSingleInteriorCut(rawLine, sourceGeometry) {
    const line = (rawLine || []).map(coord => [Number(coord[0]), Number(coord[1])]);
    if (line.length < 2) throw new Error('새 국경선에는 두 점 이상이 필요합니다.');
    const polygons = geometryPolygonSets(sourceGeometry);
    if (!polygons.length) throw new Error('분할할 영토를 찾을 수 없습니다.');
    const events = collectCutBoundaryEvents(line, polygons);
    if (events.length !== 2) {
      throw new Error('국경선은 선택 영토의 한 연결 조각을 정확히 한 번만 관통해야 합니다.');
    }
    const [entry, exit] = events;
    if (exit.position - entry.position <= 1e-7) throw new Error('국경선의 내부 구간이 너무 짧습니다.');
    const middle = coordinateAtPathPosition(line, (entry.position + exit.position) / 2);
    const componentIndex = interiorComponentIndex(middle, polygons);
    if (componentIndex === null) throw new Error('두 국경 교차점 사이에 유효한 내부 구간이 없습니다.');
    if (entry.position > 1e-7) {
      const before = coordinateAtPathPosition(line, entry.position / 2);
      if (interiorComponentIndex(before, polygons) !== null) throw new Error('국경선은 선택 영토 밖이나 경계에서 시작하세요.');
    }
    const maxPosition = line.length - 1;
    if (exit.position < maxPosition - 1e-7) {
      const after = coordinateAtPathPosition(line, (exit.position + maxPosition) / 2);
      if (interiorComponentIndex(after, polygons) !== null) throw new Error('국경선은 선택 영토 밖이나 경계에서 끝내세요.');
    }
    const entryRef = entry.refs.find(ref => ref.polygonIndex === componentIndex && ref.ringIndex === 0);
    const exitRef = exit.refs.find(ref => ref.polygonIndex === componentIndex && ref.ringIndex === 0);
    if (!entryRef || !exitRef) throw new Error('국경선은 같은 영토 조각의 외곽 경계를 관통해야 합니다.');

    const cutLine = [entry.coord.slice()];
    for (let vertexIndex = 1; vertexIndex < line.length - 1; vertexIndex += 1) {
      if (vertexIndex > entry.position + 1e-7 && vertexIndex < exit.position - 1e-7) cutLine.push(line[vertexIndex].slice());
    }
    if (!coordNear(cutLine[cutLine.length - 1], exit.coord, 1e-9)) cutLine.push(exit.coord.slice());
    return {
      polygons,
      componentIndex,
      component: polygons[componentIndex],
      cutLine,
      firstEndpoint: {
        coord: entry.coord.slice(), segmentIndex: entryRef.boundarySegmentIndex, t: entryRef.boundaryT,
      },
      lastEndpoint: {
        coord: exit.coord.slice(), segmentIndex: exitRef.boundarySegmentIndex, t: exitRef.boundaryT,
      },
    };
  }

  function augmentedRingWithCutEndpoints(rawRing, firstEndpoint, lastEndpoint) {
    const open = ensureClosedRing(rawRing).slice(0, -1).map(coord => coord.slice());
    const insertions = new Map();
    for (const endpoint of [firstEndpoint, lastEndpoint]) {
      if (endpoint.t <= 0.002 || endpoint.t >= 0.998) continue;
      if (!insertions.has(endpoint.segmentIndex)) insertions.set(endpoint.segmentIndex, []);
      insertions.get(endpoint.segmentIndex).push({ t: endpoint.t, coord: endpoint.coord.slice() });
    }
    const augmented = [];
    for (let i = 0; i < open.length; i += 1) {
      augmented.push(open[i].slice());
      const additions = (insertions.get(i) || []).sort((a, b) => a.t - b.t);
      for (const addition of additions) {
        if (!coordNear(augmented[augmented.length - 1], addition.coord, 1e-9)) augmented.push(addition.coord.slice());
      }
    }
    const firstIndex = augmented.findIndex(coord => coordNear(coord, firstEndpoint.coord, 1e-7));
    const lastIndex = augmented.findIndex(coord => coordNear(coord, lastEndpoint.coord, 1e-7));
    if (firstIndex < 0 || lastIndex < 0 || firstIndex === lastIndex) {
      throw new Error('편입선의 양 끝점을 영토를 가져올 국가의 경계에서 구분할 수 없습니다.');
    }
    return { ring: augmented, firstIndex, lastIndex };
  }

  function walkRingArc(ring, startIndex, endIndex, step) {
    const result = [ring[startIndex].slice()];
    let index = startIndex;
    let guard = 0;
    while (index !== endIndex && guard++ <= ring.length + 1) {
      index = (index + step + ring.length) % ring.length;
      result.push(ring[index].slice());
    }
    if (index !== endIndex) throw new Error('영토를 가져올 국가의 경계 경로를 만들 수 없습니다.');
    return result;
  }

  function validateAnnexCutLine(cutLine, component) {
    if (!Array.isArray(cutLine) || cutLine.length < 2) throw new Error('새 국경선에는 두 점 이상이 필요합니다.');
    const unique = new Set(cutLine.map(coord => coordKey(coord, 8)));
    if (unique.size < 2 || cutLine.some((coord, index) => index > 0 && coordNear(coord, cutLine[index - 1], 1e-9))) {
      throw new Error('서로 다른 위치를 연결하세요.');
    }
    if (lineHasSelfIntersection(cutLine)) throw new Error('새 국경선이 자기 자신과 교차합니다.');
    for (let i = 1; i < cutLine.length - 1; i += 1) {
      if (!pointInPolygonSetInterior(cutLine[i], component)) {
        throw new Error('중간 국경점은 영토를 가져올 국가의 내부에 놓아야 합니다.');
      }
    }
    for (let i = 0; i < cutLine.length - 1; i += 1) {
      const a = cutLine[i], b = cutLine[i + 1];
      const projectedA = activeProjection()(a);
      const projectedB = activeProjection()(b);
      const screenLength = projectedA && projectedB ? Math.hypot(projectedB[0] - projectedA[0], projectedB[1] - projectedA[1]) : 120;
      const samples = clamp(Math.ceil(screenLength / 5), 24, 160);
      for (let sample = 1; sample < samples; sample += 1) {
        const point = interpolateCoordinate(a, b, sample / samples);
        if (!pointInPolygonSetInterior(point, component)) {
          throw new Error('새 국경선은 영토를 가져올 국가의 밖이나 호수·구멍을 통과할 수 없습니다.');
        }
      }
      for (const ring of component) {
        const closed = ensureClosedRing(ring);
        for (let j = 0; j < closed.length - 1; j += 1) {
          if (segmentsProperlyIntersect(a, b, closed[j], closed[j + 1])) {
            throw new Error('새 국경선이 영토를 가져올 국가의 경계를 중간에서 가로지릅니다.');
          }
        }
      }
    }
  }

  function buildCutSplitCandidates(sourceGeometry, rawLine) {
    const clipper = window.polygonClipping;
    if (!clipper?.intersection || !clipper?.union || !clipper?.xor) throw new Error('영토 편입 엔진을 불러오지 못했습니다.');
    if (!sourceGeometry || !['Polygon', 'MultiPolygon'].includes(sourceGeometry.type)) throw new Error('분할할 영토를 찾을 수 없습니다.');
    const { extracted } = prepareCutDraft(rawLine, sourceGeometry);
    const { component, componentIndex, cutLine, firstEndpoint, lastEndpoint } = extracted;
    if (coordNear(firstEndpoint.coord, lastEndpoint.coord, 1e-7)) throw new Error('국경선의 양 끝점이 너무 가깝습니다.');
    validateAnnexCutLine(cutLine, component);

    const augmented = augmentedRingWithCutEndpoints(component[0], firstEndpoint, lastEndpoint);
    const forwardArc = walkRingArc(augmented.ring, augmented.firstIndex, augmented.lastIndex, 1);
    const backwardArc = walkRingArc(augmented.ring, augmented.firstIndex, augmented.lastIndex, -1);
    const candidateRings = [forwardArc, backwardArc].map(arc =>
      ensureClosedRing([...cutLine.map(coord => coord.slice()), ...arc.slice(1, -1).reverse().map(coord => coord.slice())])
    );
    if (candidateRings.some(ring => Math.abs(ringSignedArea(ring)) <= 1e-14 || ringHasSelfIntersection(ring))) {
      throw new Error('새 국경선으로 유효한 두 영토를 만들 수 없습니다.');
    }

    const candidates = candidateRings.map(ring => normalizeClippedLandGeometry(clipper.intersection([ring], component)));
    if (candidates.some(candidate => !candidate)) throw new Error('새 국경선 한쪽에 유효한 영토가 없습니다.');
    const componentArea = multiPolygonPlanarArea([component]);
    const areas = candidates.map(candidate => multiPolygonPlanarArea(geometryMultiCoordinates(candidate)));
    const tolerance = Math.max(1e-10, componentArea * 1e-10);
    if (areas.some(area => area <= tolerance)) throw new Error('새 국경선 한쪽 영토가 너무 작거나 비어 있습니다.');
    const overlapArea = multiPolygonPlanarArea(clipper.intersection(candidates[0].coordinates, candidates[1].coordinates));
    const combined = clipper.union(candidates[0].coordinates, candidates[1].coordinates);
    const missingArea = multiPolygonPlanarArea(clipper.xor(component, combined));
    if (overlapArea > tolerance || missingArea > tolerance) throw new Error('새 국경선이 영토를 가져올 국가를 정확히 두 영역으로 나누지 못했습니다.');

    return {
      componentIndex,
      cutLine,
      candidates: candidates.map((geometry, index) => ({ geometry, area: areas[index] })),
    };
  }

  function selectedCountryUnionGeometry(sourceIds) {
    const ids = new Set((sourceIds || []).map(String));
    if (!ids.size) throw new Error('영토를 가져올 국가를 하나 이상 선택하세요.');
    const union = countryUnionFromFeatures(state.countriesData?.features || [], ids);
    const geometry = normalizeClippedLandGeometry(union);
    if (!geometry) throw new Error('선택 국가의 영토 합집합을 만들 수 없습니다.');
    return geometry;
  }



  function applyWorkerCountryPatches(result) {
    const updates = new Map((result.features || []).map(feature => {
      const next = deepClone(feature);
      const normalizedGeometry = normalizeCountryGeometry(next.geometry);
      if (!normalizedGeometry) throw new Error(`${next.properties?.editor_name || '국가'}의 편집 결과가 유효하지 않습니다.`);
      next.geometry = normalizedGeometry;
      return [String(next.properties?.editor_id || ''), next];
    }));
    const removed = new Set((result.removedIds || []).map(String));
    state.countriesData.features = state.countriesData.features.flatMap(feature => {
      const id = String(feature.properties?.editor_id || '');
      if (removed.has(id)) {
        delete state.countryOverrides[id];
        return [];
      }
      if (updates.has(id)) {
        const next = updates.get(id);
        updates.delete(id);
        return [next];
      }
      return [feature];
    });
    for (const feature of updates.values()) state.countriesData.features.push(feature);
    reindexCountries(state.countriesData, true);
    applyingMapEditWorkerResult = true;
    try {
      markCountryGeometriesChanged(new Set(result.affectedIds || [...updates.keys(), ...removed]));
    } finally {
      applyingMapEditWorkerResult = false;
    }
  }

  function ringRepresentativePoint(ring) {
    if (!ring?.length) return [0, 0];
    let x = 0, y = 0, n = Math.max(1, ring.length - 1);
    for (let i = 0; i < n; i += 1) { x += ring[i][0]; y += ring[i][1]; }
    return [x / n, y / n];
  }


  function activeProjection() {
    return state.projection === 'globe' ? globeProjection : flatProjection;
  }

  function currentMapSafeInsets() {
    const workspace = document.querySelector('.workspace');
    if (!workspace) return { left: 0, right: 0, top: 0, bottom: 26 };
    const styles = getComputedStyle(workspace);
    const read = name => Math.max(0, Number.parseFloat(styles.getPropertyValue(name)) || 0);
    return {
      left: read('--projection-safe-left'),
      right: read('--projection-safe-right'),
      top: read('--projection-safe-top'),
      bottom: Math.max(26, read('--projection-safe-bottom')),
    };
  }

  function projectionLayoutMetrics() {
    const { width, height } = state.size;
    const safe = currentMapSafeInsets();
    const contentWidth = Math.max(1, width - safe.left - safe.right);
    const contentHeight = Math.max(1, height - safe.top - safe.bottom);
    const scaleContentHeight = isMobile()
      ? Math.max(1, height - safe.top - 96)
      : contentHeight;
    const centerX = safe.left + contentWidth / 2;
    const centerY = safe.top + contentHeight / 2;
    return {
      width,
      height,
      safe,
      contentWidth,
      contentHeight,
      centerX,
      centerY,
      globeBaseScale: Math.max(60, Math.min(contentWidth, scaleContentHeight) * 0.455),
      flatBaseScale: Math.max(30, contentWidth / (2 * Math.PI)),
    };
  }

  function updateProjection() {
    const {
      width,
      height,
      safe,
      centerX,
      centerY,
      globeBaseScale,
      flatBaseScale,
    } = projectionLayoutMetrics();
    if (state.projection === 'globe') {
      globeProjection
        .translate([centerX, centerY])
        .scale(globeBaseScale * state.view.globeZoom)
        .rotate(state.view.globeRotation)
        .clipAngle(90);
      path.projection(globeProjection);
    } else {
      flatProjection
        .translate([centerX, centerY])
        .scale(flatBaseScale * state.view.flatZoom)
        .center(state.view.flatCenter)
        .rotate([0, 0, 0])
        .clipExtent([[safe.left, safe.top], [width - safe.right, height - safe.bottom]]);
      path.projection(flatProjection);
    }
  }

  function isCoordVisible(coord) {
    if (!coord) return false;
    const p = activeProjection()(coord);
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return false;
    if (state.projection === 'globe') {
      const r = state.view.globeRotation;
      const center = [-r[0], -r[1]];
      return d3.geo.distance(coord, center) <= Math.PI / 2 + 0.005;
    }
    return p[0] >= -30 && p[0] <= state.size.width + 30 && p[1] >= -30 && p[1] <= state.size.height + 30;
  }

  function screenToGeo(screenPoint) {
    const projection = activeProjection();
    if (state.projection === 'globe') {
      const c = projection.translate();
      const s = projection.scale();
      const dx = screenPoint[0] - c[0];
      const dy = screenPoint[1] - c[1];
      if ((dx * dx + dy * dy) > s * s) return null;
    }
    const coord = projection.invert(screenPoint);
    if (!coord || !Number.isFinite(coord[0]) || !Number.isFinite(coord[1])) return null;
    let lon = ((coord[0] + 540) % 360) - 180;
    let lat = clamp(coord[1], -89.999, 89.999);
    return [lon, lat];
  }

  function defaultDrawingColor(feature) {
    return DEFAULT_DRAWING_COLOR;
  }

  function drawingColor(feature) {
    return readDomainColor(COLOR_DOMAINS.DRAWING, { feature }, { fallback: defaultDrawingColor(feature) }).value;
  }

  function drawingCategoryLabel(feature) {
    return DRAWING_CATEGORY_RULES[feature?.properties?.category]?.label || '지형지물';
  }

  function drawingRoleHelp(feature) {
    return '사용자 정의 객체는 육지 결합 방식을 직접 선택할 수 있습니다.';
  }

  function drawingDisplayFeature(feature) {
    if (drawingGeometryKind(feature) !== 'polygon' || drawingLandBinding(feature) === 'none') return feature;
    const cached = drawingLandClipCache.get(feature);
    const ownerId = String(feature.properties?.pandolab_owner_id || '');
    if (cached && cached.revision === countryLandRevision && cached.geometry === feature.geometry && cached.ownerId === ownerId) return cached.feature;
    const clipper = window.polygonClipping;
    if (!clipper?.intersection) return feature;
    const bounds = geometryBounds(feature.geometry);
    const countries = ownerId && countryFeatureById(ownerId)
      ? [countryFeatureById(ownerId)]
      : spatialFeatures(bounds);
    const pieces = [];
    for (const country of countries) {
      if (!country?.geometry || !boundsOverlap(bounds, geometryBounds(country.geometry))) continue;
      const clipped = clipper.intersection(feature.geometry.coordinates, country.geometry.coordinates);
      if (clipped?.length) pieces.push(...clipped);
    }
    const geometry = normalizeClippedLandGeometry(pieces);
    const display = geometry ? { ...feature, geometry } : { ...feature, geometry: null };
    drawingLandClipCache.set(feature, { revision: countryLandRevision, geometry: feature.geometry, ownerId, feature: display });
    return display;
  }

  function drawingName(feature) {
    return feature.properties?.name || `이름 없는 ${drawingCategoryLabel(feature)} ${String(feature.id || '').slice(0, 8)}`;
  }

  const territorialRepository = createTerritorialRepository({
    getCountries: () => state.countriesData,
    getUnits: () => state.territorialUnits,
    getCountryOverride: id => state.countryOverrides[id] || {},
  });

  const territorialApplicationService = createTerritorialApplicationService({
    repository: territorialRepository,
    runDocumentMutation: (meta, mutate) => {
      recordHistory(meta);
      return mutate();
    },
    countryCommands: {
      isLocked: id => isCountryLocked(id),
      setLocked: (id, locked) => setCountryLockedState(id, locked),
      setField: (id, field, value) => {
        state.countryOverrides[id] = { ...(state.countryOverrides[id] || {}) };
        if (field === 'color') {
          writeDomainColor(COLOR_DOMAINS.COUNTRY, {
            feature: countryFeatureById(id), override: state.countryOverrides[id],
          }, value, { fallback: defaultCountryColor() });
        } else state.countryOverrides[id][field] = value;
        const index = state.countryIndex.get(id);
        if (index !== undefined && field === 'name') {
          const feature = state.countriesData.features[index];
          feature.properties.editor_name = state.countryOverrides[id].name || feature.properties.editor_original_name;
        }
      },
    },
    unitCommands: {
      setField: (id, field, value) => {
        const feature = territorialUnitById(id);
        if (!feature) return;
        if (field === 'color') setTerritorialStyleColor(feature, value);
        else feature.properties[field] = value;
      },
      replaceAll: units => {
        state.territorialUnits = units;
        mapObjectGeometryRevisions.territorial += 1;
      },
    },
  });
  const runTerritorialUnitTransaction = options => territorialApplicationService.runGeometryTransaction(options);
  const validateTerritorialUnitRelations = (units, options) => territorialApplicationService.validateRelations(units, options);
  const distributionService = createDistributionService({
    documentStore: {
      readLayers: () => state.distributionLayers,
      replaceLayers: layers => {
        state.distributionLayers = layers;
        distributionVisibilityRevision += 1;
      },
      readEntries: () => state.distributionEntries,
      replaceEntries: entries => {
        state.distributionEntries = entries;
        distributionVisibilityRevision += 1;
      },
    },
    presentationStore: {
      setRenderMode: mode => {
        state.distributionSettings.renderMode = mode;
        distributionVisibilityRevision += 1;
      },
      setBoundaryVisible: visible => {
        state.distributionSettings.boundaryVisible = visible !== false;
        distributionVisibilityRevision += 1;
      },
    },
    runDocumentMutation: (meta, mutate) => {
      recordHistory(meta);
      return mutate();
    },
    writeLayerColor: (layer, color) => writeDomainColor(
      COLOR_DOMAINS.DISTRIBUTION,
      { layer },
      color,
      { fallback: DEFAULT_DRAWING_COLOR },
    ),
    territorialExists: id => !!territorialRepository.get(id),
  });
  const drawingApplicationService = createDrawingService({
    documentStore: {
      readDrawings: () => state.drawings,
      replaceDrawings: drawings => { state.drawings = drawings; },
    },
    runDocumentMutation: (meta, mutate) => {
      recordHistory(meta);
      return mutate();
    },
    writeColor: (feature, color) => writeDomainColor(
      COLOR_DOMAINS.DRAWING,
      { feature },
      color,
      { fallback: defaultDrawingColor(feature) },
    ),
  });

  function territorialUnitById(id) {
    return territorialApplicationService.get(id);
  }

  function territorialStyleColor(feature) {
    return readDomainColor(COLOR_DOMAINS.TERRITORIAL, { feature }).explicit;
  }

  function setTerritorialStyleColor(feature, color) {
    if (!feature?.properties) return '';
    return writeDomainColor(COLOR_DOMAINS.TERRITORIAL, { feature }, color, { clear: !color, fallback: DEFAULT_DRAWING_COLOR });
  }

  function territorialUnitName(feature) {
    const properties = feature?.properties || {};
    if (properties.name) return properties.name;
    if (properties.unitType === TERRITORIAL_UNIT_TYPES.REGION) return '이름 없는 지방';
    return properties.isRemainder === true
      ? (properties.unitType === TERRITORIAL_UNIT_TYPES.ADMIN ? '미지정 행정구역' : '미지정 권역')
      : (properties.unitType === TERRITORIAL_UNIT_TYPES.ADMIN ? '이름 없는 행정구역' : '이름 없는 권역');
  }

  function territorialUnitColor(feature) {
    const country = countryFeatureById(feature?.properties?.sovereignId);
    return readDomainColor(COLOR_DOMAINS.TERRITORIAL, { feature }, {
      inherited: country ? countryColor(country) : '',
      fallback: DEFAULT_DRAWING_COLOR,
    }).value;
  }

  function territorialUnitCountryName(feature) {
    const country = countryFeatureById(feature?.properties?.sovereignId);
    return country ? countryName(country) : '소속 국가 미지정';
  }

  function countryColor(feature) {
    const id = String(feature?.properties?.editor_id || '');
    return readDomainColor(COLOR_DOMAINS.COUNTRY, { feature, override: state.countryOverrides[id] }, { fallback: defaultCountryColor() }).value;
  }

  function distributionColor(layer) {
    return readDomainColor(COLOR_DOMAINS.DISTRIBUTION, { layer }, { fallback: DEFAULT_DRAWING_COLOR }).value;
  }

  function countryName(feature) {
    return feature.properties?.editor_name || feature.properties?.editor_original_name || feature.properties?.name || '국가';
  }

  function hydroCategoryKey(value) {
    return value === 'lake' ? 'lake' : 'river';
  }

  function hydroCategoryLabel(value) {
    return hydroCategoryKey(value) === 'lake' ? '호수' : '강';
  }

  function hydroFallbackName(value) {
    return `이름 없는 ${hydroCategoryLabel(value)}`;
  }

  function hydroSourceLabel(value, { builtin = false } = {}) {
    return `${builtin ? '내장 ' : '사용자 '}${hydroCategoryLabel(value)}`;
  }

  function hydroAccusativeLabel(value) {
    return hydroCategoryKey(value) === 'lake' ? '호수를' : '강을';
  }

  const TERRITORIAL_UNIT_FOLDER_STATE_PREFIX = 'territorial-unit-folder:';
  const DISTRIBUTION_GROUP_TYPES = Object.freeze({
    languages: DISTRIBUTION_TYPES.LANGUAGE,
    ethnicities: DISTRIBUTION_TYPES.ETHNICITY,
    religions: DISTRIBUTION_TYPES.RELIGION,
  });
  const DISTRIBUTION_TYPE_GROUPS = Object.freeze(Object.fromEntries(Object.entries(DISTRIBUTION_GROUP_TYPES).map(([group, type]) => [type, group])));
  const DISTRIBUTION_TYPE_LABELS = Object.freeze({ language: '언어', ethnicity: '민족', religion: '종교' });
  const TERRITORIAL_LAYER_GROUPS = Object.freeze({
    COUNTRIES: 'countries',
    TERRITORIES: 'territories',
    ADMINISTRATIVE: 'administrative',
    REGIONS: 'regions',
  });
  const LAYER_GROUP_KEYS = [...Object.values(TERRITORIAL_LAYER_GROUPS), 'languages', 'ethnicities', 'religions', 'hydro', 'drawings', 'labels', 'countryLabels'];
  const LAYER_TREE_GROUP_KEYS = [...Object.values(TERRITORIAL_LAYER_GROUPS), 'languages', 'ethnicities', 'religions', 'rivers', 'lakes', 'drawings'];
  const LAYER_SEARCH_GROUP_KEYS = LAYER_GROUP_KEYS.filter(group => !['labels', 'countryLabels'].includes(group));
  const layerGroupNames = { countries: '국가', territories: '권역', administrative: '행정구역', regions: '지방', languages: '언어', ethnicities: '민족', religions: '종교', rivers: '강', lakes: '호수', hydro: '강·호수', drawings: '사용자 지형지물', labels: '지명', countryLabels: '국가명' };
  const layerGroupTargetIds = {
    countries: 'countriesLayerChildren',
    territories: 'territoriesLayerChildren',
    administrative: 'administrativeLayerChildren',
    regions: 'regionsLayerChildren',
    languages: 'languagesLayerChildren',
    ethnicities: 'ethnicitiesLayerChildren',
    religions: 'religionsLayerChildren',
    rivers: 'riversLayerChildren',
    lakes: 'lakesLayerChildren',
    drawings: 'drawingsLayerChildren',
  };
  const layerNameCollator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
  let renderedLayerTreeRevision = -1;
  let renderedLayerSearch = '';
  let layerSearchScrollTop = 0;
  let layerTreeHydrated = false;
  const layerGroupScrollTop = new Map();
  const expandedLayerStyleGroups = new Set();

  function territorialUnitFolderStateKey(group, countryId) {
    return `${TERRITORIAL_UNIT_FOLDER_STATE_PREFIX}${group}:${String(countryId || 'unassigned')}`;
  }

  function currentMapDevicePixelRatio() {
    return Math.min(isMobile() ? 2 : 3, Math.max(1, Number(window.devicePixelRatio || 1)));
  }
  function activeLayerFolderKeys() {
    const territorialUnitKeys = [];
    for (const group of ['territories', 'administrative']) {
      const kind = group === 'territories' ? TERRITORIAL_UNIT_TYPES.TERRITORY : TERRITORIAL_UNIT_TYPES.ADMIN;
      for (const countryId of new Set(state.territorialUnits.filter(feature => feature.properties?.unitType === kind)
        .map(feature => String(feature.properties?.sovereignId || '')))) {
        territorialUnitKeys.push(territorialUnitFolderStateKey(group, countryId));
      }
    }
    return [
      'countries',
      'territories',
      'administrative',
      'regions',
      'languages',
      'ethnicities',
      'religions',
      'rivers',
      'lakes',
      ...territorialUnitKeys,
      'drawings',
    ];
  }

  function normalizePhysicalSettings(value) {
    const previousLayers = value?.hydroLayers || {};
    const mergeVisibility = ids => {
      const defined = ids.filter(id => typeof previousLayers[id] === 'boolean');
      return defined.length ? defined.some(id => previousLayers[id] !== false) : true;
    };
    const hydroLayers = {
      rivers_hydro: mergeVisibility(['rivers_hydro', 'rivers_base', 'rivers_europe', 'rivers_north_america', 'rivers_australia']),
      lakes_natural_earth: mergeVisibility(['lakes_natural_earth', 'lakes_hydro', 'lakes_base', 'lakes_europe', 'lakes_north_america', 'lakes_australia']),
    };
    const hiddenHydroIds = Object.fromEntries(Object.entries(value?.hiddenHydroIds || {}).filter(([id, hidden]) => (
      hidden === true && !String(id).startsWith('rivers_base:') && !String(id).startsWith('hydro-lake:')
    )));
    return {
      terrainVisible: value?.terrainVisible !== false,
      terrainStyle: value?.terrainStyle === 'physical' ? 'physical' : 'political',
      terrainStrength: clamp(Number(value?.terrainStrength ?? 0.32), 0, 1),
      hydroLayers,
      userFeaturesVisible: value?.userFeaturesVisible !== false,
      hiddenHydroIds,
      dataset: PHYSICAL_DATASET,
    };
  }

  function syncRangeProgress(input) {
    if (!input) return;
    const min = Number(input.min || 0);
    const max = Number(input.max || 100);
    const value = Number(input.value || min);
    const progress = max > min ? clamp(((value - min) / (max - min)) * 100, 0, 100) : 0;
    input.style.setProperty('--ui-range-progress', `${progress}%`);
  }

  function syncPhysicalControls() {
    const terrainVisible = state.physicalSettings.terrainVisible !== false;
    if ($('terrainVisible')) {
      $('terrainVisible').checked = terrainVisible;
      $('terrainVisible').setAttribute('aria-expanded', String(terrainVisible));
    }
    if ($('terrainDisplayOptions')) $('terrainDisplayOptions').hidden = !terrainVisible;
    if ($('terrainPoliticalRadio')) $('terrainPoliticalRadio').checked = state.physicalSettings.terrainStyle === 'political';
    if ($('terrainPhysicalRadio')) $('terrainPhysicalRadio').checked = state.physicalSettings.terrainStyle === 'physical';
    if ($('terrainStrengthInput')) $('terrainStrengthInput').value = String(Math.round(state.physicalSettings.terrainStrength * 100));
    if ($('terrainStrengthValue')) $('terrainStrengthValue').textContent = `${Math.round(state.physicalSettings.terrainStrength * 100)}%`;
    if ($('terrainStrengthControl')) $('terrainStrengthControl').hidden = !terrainVisible || state.physicalSettings.terrainStyle !== 'political';
    syncRangeProgress($('terrainStrengthInput'));
  }

  function parseHexRgb(value, fallback = TERRAIN_OCEAN_REPRESENTATIVE) {
    const match = /^#([0-9a-f]{6})$/i.exec(String(value || '')) || /^#([0-9a-f]{6})$/i.exec(fallback);
    const packed = Number.parseInt(match[1], 16);
    return [(packed >> 16) & 255, (packed >> 8) & 255, packed & 255];
  }

  function formatHexRgb(rgb) {
    return `#${rgb.map(value => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0')).join('')}`;
  }

  function automaticWaterColor(gpu = false) {
    if (state.physicalSettings.terrainVisible && state.physicalSettings.terrainStyle === 'physical') {
      const representative = state.terrainManifest?.displayColors?.oceanRepresentative || TERRAIN_OCEAN_REPRESENTATIVE;
      let rgb = parseHexRgb(representative);
      if ((document.documentElement.dataset.theme || systemTheme) === 'dark') rgb = rgb.map((value, index) => value * [0.808, 0.8464, 0.8848][index]);
      return gpu ? rgb.map(value => value / 255) : formatHexRgb(rgb);
    }
    const theme = mapTheme();
    return gpu ? theme.oceanGpu : theme.ocean;
  }

  function hydroDisplayColor(_category, gpu = false) {
    return automaticWaterColor(gpu);
  }

  function normalizeHydroEdit(feature) {
    if (!feature?.geometry || !Array.isArray(feature.geometry.coordinates) || !feature.geometry.coordinates.length) return null;
    feature.properties ||= {};
    const geometryKind = drawingGeometryKind(feature);
    const category = feature.properties.category === 'lake' && geometryKind === 'polygon' ? 'lake'
      : feature.properties.category === 'river' && geometryKind === 'line' ? 'river'
        : geometryKind === 'polygon' ? 'lake'
          : geometryKind === 'line' ? 'river' : '';
    if (!category) return null;
    feature.id = String(feature.id || '').trim();
    if (!feature.id) throw new Error('편집 강/호수 ID가 비어 있습니다.');
    feature.properties = {
      ...feature.properties,
      category,
      pandolab_domain: 'hydro',
      pandolab_schema_version: DRAWING_SCHEMA_VERSION,
      pandolab_id: feature.id,
      name: String(feature.properties.name || ''),
      notes: String(feature.properties.notes || ''),
      editorColor: normalizeEditorColor(feature.properties.editorColor, HYDRO_TOOL_CONFIG[category].color),
    };
    delete feature.properties.visible;
    return feature;
  }

  function normalizeHydroEditCollection(value) {
    const output = [];
    const seen = new Set();
    for (const feature of Array.isArray(value) ? value : []) {
      const normalized = normalizeHydroEdit(feature);
      if (!normalized) throw new Error('편집 강/호수 형식이 올바르지 않습니다.');
      if (seen.has(normalized.id)) throw new Error(`편집 강/호수 ID가 중복되었습니다: ${normalized.id}`);
      seen.add(normalized.id);
      output.push(normalized);
    }
    return output;
  }

  function hydroEditById(id) {
    const key = String(id);
    return state.hydroEdits.find(feature => String(feature.id) === key) || null;
  }

  function isHydroEditFeature(feature) {
    return !!feature && (feature.properties?.pandolab_domain === 'hydro' || state.hydroEdits.includes(feature));
  }

  function hydroLayerVisible(layerId) {
    const category = hydroCategoryKey(HYDRO_LAYER_META[layerId]?.category);
    return state.layerVisibility[category === 'lake' ? 'lakes' : 'rivers'] !== false
      && state.physicalSettings.hydroLayers?.[layerId] !== false;
  }

  function isHydroFeatureVisible(feature) {
    const id = String(feature?.properties?.pandolab_id || feature?.id || '');
    if (isHydroEditFeature(feature)) {
      const category = hydroCategoryKey(feature.properties?.category);
      return state.layerVisibility[category === 'lake' ? 'lakes' : 'rivers'] !== false && isLayerItemVisible('hydro', id);
    }
    return hydroLayerVisible(feature?.properties?.layer_id) && state.physicalSettings.hiddenHydroIds?.[id] !== true;
  }

  function allBuiltInHydroFeatures() {
    const tiled = state.hydroFeatureCache instanceof Map ? [...state.hydroFeatureCache.values()] : [];
    const legacy = Object.values(state.hydroCollections || {}).flatMap(collection => collection?.features || []);
    return [...tiled, ...legacy];
  }

  function builtInHydroFeatureById(id) {
    const key = String(id);
    if (state.hydroFeatureCache instanceof Map && state.hydroFeatureCache.has(key)) return state.hydroFeatureCache.get(key);
    for (const feature of allBuiltInHydroFeatures()) {
      if (String(feature.properties?.pandolab_id || feature.id || '') === key) return feature;
    }
    return null;
  }

  function hydroFeatureById(id) {
    return hydroEditById(id) || builtInHydroFeatureById(id);
  }

  function normalizeLayerItemState(value) {
    const output = {};
    for (const group of LAYER_GROUP_KEYS) {
      const source = value?.[group];
      output[group] = source && typeof source === 'object' && !Array.isArray(source) ? { ...source } : {};
    }
    return output;
  }

  function normalizeLayerFolderState(value) {
    let expandedFound = false;
    return Object.fromEntries(activeLayerFolderKeys().map(key => {
      if (key.startsWith(TERRITORIAL_UNIT_FOLDER_STATE_PREFIX)) return [key, value?.[key] !== false];
      const expanded = !expandedFound && !!value?.[key];
      if (expanded) expandedFound = true;
      return [key, expanded];
    }));
  }

  function markLayerTreeDirty() {
    state.layerTreeRevision += 1;
  }

  function isLayerItemVisible(group, id) {
    if (group === 'hydro' && HYDRO_LAYER_META[String(id)]) {
      return state.physicalSettings.hydroLayers?.[String(id)] !== false;
    }
    return state.itemVisibility?.[group]?.[String(id)] !== false;
  }

  function isCountryVisibleById(id) {
    return !!state.layerVisibility.countries && isLayerItemVisible('countries', id);
  }

  function setLayerItemVisibility(group, id, visible) {
    if (!LAYER_GROUP_KEYS.includes(group)) return;
    const key = String(id);
    if (group === 'hydro' && HYDRO_LAYER_META[key]) {
      state.physicalSettings.hydroLayers[key] = !!visible;
      gpuMapRenderer.invalidateHydroVisibility();
      markLayerTreeDirty();
      renderAll();
      queuePresentationAutosave();
      return;
    }
    state.itemVisibility[group] ||= {};
    if (visible) delete state.itemVisibility[group][key];
    else state.itemVisibility[group][key] = false;
    if (group === 'countries') gpuMapRenderer.invalidateCountryPalette({ base: true, emphasis: true }, 'country-item-visibility');
    markLayerTreeDirty();
    renderAll();
    queuePresentationAutosave();
  }

  function layerTreeItems(group) {
    if (group === 'countries' || group === 'countryLabels') {
      return (state.countriesData?.features || []).map(feature => {
        const id = String(feature.properties?.editor_id || '');
        return {
          id,
          name: countryName(feature),
          color: countryColor(feature),
          searchText: id,
          meta: group === 'countryLabels' && pendingCountryLabelAnchors.has(id) ? '계산 중' : '',
          selected: (state.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY) && state.selected.id === id,
        };
      });
    }
    if (group === 'territories' || group === 'administrative' || group === 'regions') {
      const kind = group === 'territories'
        ? TERRITORIAL_UNIT_TYPES.TERRITORY
        : group === 'administrative'
          ? TERRITORIAL_UNIT_TYPES.ADMIN
          : TERRITORIAL_UNIT_TYPES.REGION;
      return state.territorialUnits.filter(feature => feature.properties?.unitType === kind).map(feature => {
        const countryLabel = territorialUnitCountryName(feature);
        const levelLabel = kind === TERRITORIAL_UNIT_TYPES.ADMIN ? `${Number(feature.properties?.adminLevel) || 1}급` : '';
        return {
          id: String(feature.id),
          name: territorialUnitName(feature),
          color: territorialUnitColor(feature),
          meta: levelLabel,
          searchText: `${countryLabel} ${levelLabel}`,
          folderName: kind === TERRITORIAL_UNIT_TYPES.ADMIN
            ? `행정구역 · ${countryLabel} · ${levelLabel}`
            : kind === TERRITORIAL_UNIT_TYPES.REGION
            ? `지방${feature.properties?.sovereignId ? ` · ${countryLabel}` : ''}`
            : `권역 · ${countryLabel}`,
          countryId: String(feature.properties?.sovereignId || ''),
          level: Number(feature.properties?.adminLevel) || null,
          selected: (state.selected?.domain === 'territorial' && state.selected.type !== TERRITORIAL_UNIT_TYPES.COUNTRY) && state.selected.id === String(feature.id),
        };
      });
    }
    if (DISTRIBUTION_GROUP_TYPES[group]) {
      const type = DISTRIBUTION_GROUP_TYPES[group];
      return state.distributionLayers.filter(layer => layer.type === type).map(layer => ({
        id: layer.id,
        name: layer.name,
        color: distributionColor(layer),
        meta: `${distributionEntriesForLayer(state.distributionEntries, layer.id).length}개 분포`,
        folderName: layerGroupNames[group],
        selected: state.selected?.domain === 'distribution' && state.selected.id === layer.id,
      }));
    }
    if (group === 'hydro') {
      const builtIns = Object.entries(HYDRO_LAYER_META).map(([id, meta]) => ({
          id,
          name: meta.sourceLabel,
          searchText: `${meta.label} ${meta.sourceLabel}`,
          title: `${meta.sourceLabel} 상태 보기`,
          color: hydroDisplayColor(meta.category),
          count: state.hydroManifest?.stats?.layerCounts?.[id] ?? null,
          folderName: meta.label,
          hydroCategory: hydroCategoryKey(meta.category),
          layerGroup: 'hydro',
          isBuiltin: true,
          selected: false,
        }));
      const userItems = state.hydroEdits.map(feature => ({
        id: String(feature.id),
        name: hydroEditorName(feature.properties?.name, hydroFallbackName(feature.properties?.category)),
        color: feature.properties?.editorColor || HYDRO_TOOL_CONFIG[feature.properties?.category || 'river'].color,
        meta: `${hydroCategoryLabel(feature.properties?.category)} · 사용자`,
        folderName: hydroCategoryLabel(feature.properties?.category),
        hydroCategory: hydroCategoryKey(feature.properties?.category),
        layerGroup: 'hydro',
        isBuiltin: false,
        selected: state.selected?.domain === 'hydro' && state.selected.id === String(feature.id),
      }));
      return [...builtIns, ...userItems];
    }
    if (group === 'drawings') {
      return state.drawings.map(feature => ({
        id: String(feature.id),
        name: drawingName(feature),
        color: drawingColor(feature),
        meta: `${drawingCategoryLabel(feature)} · 사용자`,
        layerGroup: 'drawings',
        selected: state.selected?.domain === 'drawing' && state.selected.id === String(feature.id),
      }));
    }
    return state.labels.map(label => ({
      id: String(label.id),
      name: label.name || '이름 없는 지명',
      color: '#d6b969',
      meta: label.kind || '지명',
      selected: state.selected?.domain === 'label' && state.selected.id === String(label.id),
    }));
  }

  function pruneLayerItemVisibility() {
    const valid = {
      countries: new Set((state.countriesData?.features || []).map(feature => String(feature.properties?.editor_id || ''))),
      countryLabels: new Set((state.countriesData?.features || []).map(feature => String(feature.properties?.editor_id || ''))),
      territories: new Set(state.territorialUnits.filter(feature => feature.properties?.unitType === TERRITORIAL_UNIT_TYPES.TERRITORY).map(feature => String(feature.id))),
      administrative: new Set(state.territorialUnits.filter(feature => feature.properties?.unitType === TERRITORIAL_UNIT_TYPES.ADMIN).map(feature => String(feature.id))),
      regions: new Set(state.territorialUnits.filter(feature => feature.properties?.unitType === TERRITORIAL_UNIT_TYPES.REGION).map(feature => String(feature.id))),
      languages: new Set(state.distributionLayers.filter(layer => layer.type === DISTRIBUTION_TYPES.LANGUAGE).map(layer => layer.id)),
      ethnicities: new Set(state.distributionLayers.filter(layer => layer.type === DISTRIBUTION_TYPES.ETHNICITY).map(layer => layer.id)),
      religions: new Set(state.distributionLayers.filter(layer => layer.type === DISTRIBUTION_TYPES.RELIGION).map(layer => layer.id)),
      hydro: new Set([...Object.keys(HYDRO_LAYER_META), ...state.hydroEdits.map(feature => String(feature.id))]),
      drawings: new Set(state.drawings.map(feature => String(feature.id))),
      labels: new Set(state.labels.map(label => String(label.id))),
    };
    for (const group of LAYER_GROUP_KEYS) {
      state.itemVisibility[group] ||= {};
      for (const id of Object.keys(state.itemVisibility[group])) if (!valid[group].has(id)) delete state.itemVisibility[group][id];
    }
    const activeFolderKeys = new Set(activeLayerFolderKeys());
    for (const key of Object.keys(state.layerFolders || {})) {
      if (key.startsWith(TERRITORIAL_UNIT_FOLDER_STATE_PREFIX) && !activeFolderKeys.has(key)) {
        delete state.layerFolders[key];
      }
    }
    objectSelection?.prune?.(objectRefExists);
  }

  const LAYER_VIRTUAL_ROW_HEIGHT_FALLBACK = 48;
  const LAYER_VIRTUAL_OVERSCAN = 5;
  const layerVirtualItems = new Map();
  let layerSearchVirtualMatches = [];

  function resolveLayerVirtualRowHeight() {
    const value = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-tree-row-height'));
    return Number.isFinite(value) && value > 0 ? value : LAYER_VIRTUAL_ROW_HEIGHT_FALLBACK;
  }

  function isLayerTreeItemSelected(group, id) {
    const ref = layerItemObjectRef(group, id);
    return !!ref && objectSelection.has(ref);
  }

  function createLayerVisibilityControl({ group, itemId, label, checked, ariaLabel }) {
    const control = document.createElement('label');
    control.className = 'layer-visibility-control';
    const visibility = document.createElement('input');
    visibility.type = 'checkbox';
    visibility.className = 'layer-visibility-toggle';
    visibility.checked = checked;
    visibility.dataset.layerItemVisibility = group;
    visibility.dataset.itemId = itemId;
    visibility.dataset.visibilityLabel = label;
    visibility.setAttribute('aria-label', ariaLabel || `${label} 표시`);
    control.append(
      visibility,
      createSvgIcon(document, 'icon-eye', 'ui-icon layer-visibility-icon layer-visibility-eye'),
      createSvgIcon(document, 'icon-eye-off', 'ui-icon layer-visibility-icon layer-visibility-eye-off'),
    );
    return control;
  }

  function syncLayerSelectionRows() {
    document.querySelectorAll('[data-layer-group][data-item-id]').forEach(row => {
      const selected = isLayerTreeItemSelected(row.dataset.layerGroup, row.dataset.itemId);
      const ref = layerItemObjectRef(row.dataset.layerGroup, row.dataset.itemId);
      const primary = !!ref && objectSelection.snapshot().primaryKey === ref.key;
      row.classList.toggle('is-selected', selected);
      row.classList.toggle('is-multi-selected', selected && objectSelection.size() > 1);
      row.classList.toggle('is-primary-selected', primary && objectSelection.size() > 1);
      if (row.matches('.layer-search-result')) row.setAttribute('aria-selected', String(selected));
    });
  }

  function createLayerLockIndicator() {
    const indicator = document.createElement('span');
    indicator.className = 'layer-lock-indicator';
    indicator.title = '잠김';
    indicator.append(createSvgIcon(document, 'icon-lock-closed', 'ui-icon layer-lock-icon'));
    return indicator;
  }

  function syncLayerItemLockIndicator(value) {
    const ref = normalizeObjectRef(value);
    if (!ref) return;
    const locked = objectRefLocked(ref);
    document.querySelectorAll('.layer-child[data-layer-group][data-item-id]').forEach(row => {
      if (row.classList.contains('has-no-menu')) return;
      const rowRef = layerItemObjectRef(row.dataset.layerGroup, row.dataset.itemId);
      if (!rowRef || rowRef.key !== ref.key) return;
      const name = row.querySelector('.layer-child-name');
      const label = name?.querySelector('.layer-child-name-label');
      if (!name || !label) return;
      const indicator = name.querySelector('.layer-lock-indicator');
      if (locked) {
        name.classList.add('has-lock-indicator');
        name.setAttribute('aria-label', `${label.textContent}, 잠김, 선택`);
        if (!indicator) name.append(createLayerLockIndicator());
      } else {
        indicator?.remove();
        name.classList.remove('has-lock-indicator');
        name.removeAttribute('aria-label');
      }
    });
  }

  function syncObjectLockStateChange(refs = []) {
    const uniqueRefs = new Map();
    for (const value of refs) {
      const ref = normalizeObjectRef(value);
      if (ref) uniqueRefs.set(ref.key, ref);
    }
    uniqueRefs.forEach(syncLayerItemLockIndicator);
  }

  function createLayerItemRow(group, item, { searchResult = false } = {}) {
    const itemGroup = item.layerGroup || group;
    if (item.groupHeader && !searchResult) {
      const header = document.createElement('button');
      header.type = 'button';
      header.className = 'ui-button ui-selectable-row layer-subfolder-row';
      header.dataset.territorialUnitFolderToggle = item.folderKey;
      header.setAttribute('aria-expanded', String(item.expanded));
      header.setAttribute('aria-label', `${item.name} 하위 폴더 ${item.expanded ? '접기' : '펼치기'}`);
      header.append(createSvgIcon(document, 'icon-chevron-down', 'ui-icon disclosure-icon'), document.createElement('strong'));
      header.querySelector('strong').textContent = item.name;
      return header;
    }
    const row = document.createElement(searchResult ? 'button' : 'div');
    const selected = isLayerTreeItemSelected(itemGroup, item.id);
    const ref = layerItemObjectRef(itemGroup, item.id);
    const primary = !!ref && objectSelection.snapshot().primaryKey === ref.key;
    const hasMenu = itemGroup !== 'countryLabels' && !!ref;
    row.className = `ui-row ui-selectable-row ${searchResult ? 'layer-search-result' : 'layer-child'}${!searchResult && !hasMenu ? ' has-no-menu' : ''}${selected ? ' is-selected' : ''}${selected && objectSelection.size() > 1 ? ' is-multi-selected' : ''}${primary && objectSelection.size() > 1 ? ' is-primary-selected' : ''}`;
    row.dataset.layerGroup = itemGroup;
    row.dataset.itemId = item.id;
    if (searchResult) {
      row.type = 'button';
      row.dataset.layerItemSelect = itemGroup;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(selected));
      row.innerHTML = `<span></span><strong></strong>`;
      row.querySelector('span').textContent = item.folderName || layerGroupNames[itemGroup] || '지형 음영';
      row.querySelector('strong').textContent = item.name;
      return row;
    }
    const visibility = createLayerVisibilityControl({
      group: itemGroup,
      itemId: item.id,
      label: item.name,
      checked: isLayerItemVisible(itemGroup, item.id),
      ariaLabel: `${item.name} 표시`,
    });
    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'ui-button layer-child-name';
    name.dataset.layerItemSelect = itemGroup;
    name.dataset.itemId = item.id;
    const nameLabel = document.createElement('span');
    nameLabel.className = 'layer-child-name-label';
    nameLabel.textContent = item.name;
    name.append(nameLabel);
    name.dataset.tooltip = item.title || `${item.name} 선택`;
    if (hasMenu && ref && objectRefLocked(ref)) {
      name.classList.add('has-lock-indicator');
      name.setAttribute('aria-label', `${item.name}, 잠김, 선택`);
      name.append(createLayerLockIndicator());
    }
    const menuButton = document.createElement('button');
    menuButton.type = 'button';
    menuButton.className = 'ui-button layer-child-menu';
    menuButton.dataset.layerItemMenu = itemGroup;
    menuButton.dataset.itemId = item.id;
    menuButton.setAttribute('aria-label', `${item.name} 메뉴`);
    menuButton.setAttribute('aria-haspopup', 'menu');
    menuButton.setAttribute('aria-controls', 'objectActionsMenu');
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.dataset.tooltip = `${item.name} 메뉴`;
    menuButton.append(createSvgIcon(document, 'icon-more'));
    row.append(visibility, name);
    if (item.meta) {
      const detail = document.createElement('span');
      detail.className = 'layer-child-meta';
      detail.textContent = item.meta;
      row.append(detail);
    }
    if (hasMenu) row.append(menuButton);
    return row;
  }

  function renderVirtualizedLayerGroup(group, container, items, { scrollTop = container.scrollTop, folderKey = group } = {}) {
    layerVirtualItems.set(folderKey, items);
    const rowHeight = resolveLayerVirtualRowHeight();
    const desiredScrollTop = Math.max(0, Number(scrollTop) || 0);
    const viewportHeight = Math.max(144, container.clientHeight || 235);
    const start = Math.max(0, Math.floor(desiredScrollTop / rowHeight) - LAYER_VIRTUAL_OVERSCAN);
    const count = Math.ceil(viewportHeight / rowHeight) + LAYER_VIRTUAL_OVERSCAN * 2;
    const end = Math.min(items.length, start + count);
    const fragment = document.createDocumentFragment();
    const top = document.createElement('div');
    top.className = 'layer-virtual-spacer';
    top.style.height = `${start * rowHeight}px`;
    fragment.appendChild(top);
    for (let index = start; index < end; index += 1) fragment.appendChild(createLayerItemRow(group, items[index]));
    const bottom = document.createElement('div');
    bottom.className = 'layer-virtual-spacer';
    bottom.style.height = `${Math.max(0, items.length - end) * rowHeight}px`;
    fragment.appendChild(bottom);
    container.replaceChildren(fragment);
    container.dataset.virtualized = 'true';
    const restoredScrollTop = Math.min(desiredScrollTop, Math.max(0, container.scrollHeight - container.clientHeight));
    container.scrollTop = restoredScrollTop;
    layerGroupScrollTop.set(folderKey, restoredScrollTop);
  }

  function renderVirtualizedLayerSearch(container, matches, scrollTop = container.scrollTop) {
    layerSearchVirtualMatches = matches;
    const rowHeight = resolveLayerVirtualRowHeight();
    const desiredScrollTop = Math.max(0, Number(scrollTop) || 0);
    const viewportHeight = Math.max(144, container.clientHeight || 420);
    const start = Math.max(0, Math.floor(desiredScrollTop / rowHeight) - LAYER_VIRTUAL_OVERSCAN);
    const end = Math.min(matches.length, start + Math.ceil(viewportHeight / rowHeight) + LAYER_VIRTUAL_OVERSCAN * 2);
    const fragment = document.createDocumentFragment();
    const top = document.createElement('div');
    top.className = 'layer-virtual-spacer';
    top.style.height = `${start * rowHeight}px`;
    fragment.appendChild(top);
    for (let index = start; index < end; index += 1) {
      const { group, item } = matches[index];
      fragment.appendChild(createLayerItemRow(group, item, { searchResult: true }));
    }
    const bottom = document.createElement('div');
    bottom.className = 'layer-virtual-spacer';
    bottom.style.height = `${Math.max(0, matches.length - end) * rowHeight}px`;
    fragment.appendChild(bottom);
    container.replaceChildren(fragment);
    container.dataset.virtualized = 'true';
    container.scrollTop = Math.min(desiredScrollTop, Math.max(0, container.scrollHeight - container.clientHeight));
  }

  function renderLayerFolderContents({ group, folderKey, name, folder, container, items, search }) {
    const expanded = !search && !!state.layerFolders[folderKey];
    if (!container.hidden) layerGroupScrollTop.set(folderKey, container.scrollTop);
    const savedScrollTop = layerGroupScrollTop.get(folderKey) ?? 0;
    folder.classList.toggle('is-expanded', expanded);
    folder.querySelectorAll('[data-layer-folder-toggle]').forEach(button => {
      button.setAttribute('aria-expanded', String(expanded));
      button.setAttribute('aria-label', `${name} 폴더 ${expanded ? '접기' : '펼치기'}`);
    });
    container.hidden = !expanded;
    if (!expanded) {
      container.removeAttribute('aria-busy');
      container.replaceChildren();
      return;
    }
    const hydroLoading = (group === 'rivers' || group === 'lakes')
      && ['idle', 'loading'].includes(state.physicalLoadState.hydro);
    if (hydroLoading) {
      container.setAttribute('aria-busy', 'true');
      const fragment = document.createDocumentFragment();
      for (let index = 0; index < 4; index += 1) {
        const row = document.createElement('div');
        row.className = 'layer-child-skeleton';
        row.setAttribute('aria-hidden', 'true');
        row.append(document.createElement('span'), document.createElement('span'), document.createElement('span'));
        fragment.appendChild(row);
      }
      container.replaceChildren(fragment);
      return;
    }
    container.removeAttribute('aria-busy');
    if (!items.length) {
      container.replaceChildren();
      const empty = document.createElement('div');
      empty.className = 'layer-empty';
      empty.textContent = (group === 'rivers' || group === 'lakes') && state.physicalLoadState.hydro === 'error'
        ? `${name} 목록을 불러오지 못했습니다.`
        : '항목 없음';
      container.appendChild(empty);
      return;
    }
    let displayItems = items;
    if (group === 'territories' || group === 'administrative') {
      displayItems = [];
      let previousCountry = null;
      for (const item of items.sort((left, right) => {
        const orphanOrder = Number(!left.countryId) - Number(!right.countryId);
        if (orphanOrder) return orphanOrder;
        const countryOrder = layerNameCollator.compare(
          territorialUnitCountryName(territorialUnitById(left.id)),
          territorialUnitCountryName(territorialUnitById(right.id)),
        );
        return countryOrder || Number(left.level || 0) - Number(right.level || 0) || layerNameCollator.compare(left.name, right.name);
      })) {
        const countryKey = String(item.countryId || 'unassigned');
        const countryLabel = territorialUnitCountryName(territorialUnitById(item.id));
        if (countryKey !== previousCountry) {
          const folderKey = territorialUnitFolderStateKey(group, item.countryId);
          const expanded = state.layerFolders[folderKey] !== false;
          displayItems.push({ groupHeader: true, id: `header:${group}:${countryKey}`, name: countryLabel, folderKey, expanded });
          previousCountry = countryKey;
        }
        if (state.layerFolders[territorialUnitFolderStateKey(group, item.countryId)] === false) continue;
        displayItems.push(item);
      }
    }
    if (displayItems.length > 80) renderVirtualizedLayerGroup(group, container, displayItems, { scrollTop: savedScrollTop, folderKey });
    else {
      layerVirtualItems.delete(folderKey);
      container.removeAttribute('data-virtualized');
      const fragment = document.createDocumentFragment();
      for (const item of displayItems) fragment.appendChild(createLayerItemRow(group, item));
      container.replaceChildren(fragment);
      const restoredScrollTop = Math.min(savedScrollTop, Math.max(0, container.scrollHeight - container.clientHeight));
      container.scrollTop = restoredScrollTop;
      layerGroupScrollTop.set(folderKey, restoredScrollTop);
    }
  }

  function renderLayerTree(force = false) {
    if (!force && renderedLayerTreeRevision === state.layerTreeRevision) return;
    pruneLayerItemVisibility();
    const search = String(state.layerSearch || '').trim().toLocaleLowerCase('ko');
    const searchChanged = search !== renderedLayerSearch;
    const searchResults = $('layerSearchResults');
    const layerList = document.querySelector('.layer-list');
    searchResults?.classList.toggle('hidden', !search);
    layerList?.classList.toggle('hidden', !!search);
    if (search) {
      if (!searchChanged && searchResults) layerSearchScrollTop = searchResults.scrollTop;
      const matches = [];
      for (const group of LAYER_SEARCH_GROUP_KEYS) {
        for (const item of layerTreeItems(group)) {
          if (group === 'hydro' && item.isBuiltin && state.physicalLoadState.hydro !== 'ready') continue;
          const haystack = `${item.name} ${item.searchText || ''} ${item.id} ${item.meta || ''}`.toLocaleLowerCase('ko');
          if (haystack.includes(search)) matches.push({ group, item });
        }
      }
      matches.sort((a, b) => layerNameCollator.compare(a.item.name, b.item.name));
      const fragment = document.createDocumentFragment();
      if (matches.length > 80 && searchResults) renderVirtualizedLayerSearch(searchResults, matches, searchChanged ? 0 : layerSearchScrollTop);
      else {
        layerSearchVirtualMatches = [];
        searchResults?.removeAttribute('data-virtualized');
        for (const { group, item } of matches) fragment.appendChild(createLayerItemRow(group, item, { searchResult: true }));
      }
      if (!matches.length) {
        const empty = createEmptyState('검색 결과가 없습니다.', '이름, 유형 또는 상위 국가를 다른 검색어로 입력해 보세요.');
        empty.classList.add('layer-empty');
        fragment.appendChild(empty);
      }
      if (matches.length <= 80) searchResults?.replaceChildren(fragment);
      if (searchResults) {
        const nextSearchScrollTop = searchChanged ? 0 : Math.min(layerSearchScrollTop, Math.max(0, searchResults.scrollHeight - searchResults.clientHeight));
        searchResults.scrollTop = nextSearchScrollTop;
        layerSearchScrollTop = nextSearchScrollTop;
      }
    } else {
      searchResults?.replaceChildren();
      searchResults?.removeAttribute('data-virtualized');
      layerSearchVirtualMatches = [];
      layerSearchScrollTop = 0;
    }
    for (const group of LAYER_TREE_GROUP_KEYS) {
      const folder = document.querySelector(`.layer-folder[data-layer-group="${group}"]`);
      const container = $(layerGroupTargetIds[group]);
      if (!folder || !container) continue;
      const sourceGroup = group === 'rivers' || group === 'lakes' ? 'hydro' : group;
      const category = group === 'rivers' ? 'river' : group === 'lakes' ? 'lake' : '';
      const allItems = layerTreeItems(sourceGroup)
        .filter(item => !category || hydroCategoryKey(item.hydroCategory) === category)
        .filter(item => sourceGroup !== 'hydro' || !item.isBuiltin || state.physicalLoadState.hydro !== 'error')
        .sort((a, b) => layerNameCollator.compare(a.name, b.name) || layerNameCollator.compare(a.id, b.id));
      renderLayerFolderContents({ group, folderKey: group, name: layerGroupNames[group], folder, container, items: allItems, search });
    }
    renderedLayerTreeRevision = state.layerTreeRevision;
    renderedLayerSearch = search;
    syncLayerStylePanels();
    syncCanonicalControls();
  }

  function beginLayerTreeHydration() {
    const metrics = window.__PANDOLAB_STARTUP_METRICS__;
    if (metrics && metrics.layerHydrationStartedMs == null) {
      metrics.layerHydrationStartedMs = performance.now() - metrics.startedAt;
    }
  }

  async function completeLayerTreeHydration() {
    if (layerTreeHydrated) return;
    const section = $('layerSection');
    const search = $('layerSearchInput');
    const metrics = window.__PANDOLAB_STARTUP_METRICS__;
    if (metrics) metrics.layerTreeRenderedMs = performance.now() - metrics.startedAt;
    await new Promise(resolve => requestAnimationFrame(resolve));
    section?.classList.remove('is-hydrating');
    section?.setAttribute('aria-busy', 'false');
    if (search) search.disabled = false;
    syncSearchClearButton(search, $('layerSearchClearBtn'));
    layerTreeHydrated = true;
    if (metrics) metrics.layerReadyMs = performance.now() - metrics.startedAt;
    window.dispatchEvent(new CustomEvent('pandolab:layer-ready'));
  }

  function currentMapZoom() {
    return state.projection === 'globe' ? state.view.globeZoom : state.view.flatZoom;
  }

  function countryOutlineFeature(feature) {
    const geometry = feature?.geometry;
    if (geometry && countryOutlineCache.has(geometry)) return countryOutlineCache.get(geometry);
    const outline = buildRenderableStrokeFeature(feature);
    if (geometry) countryOutlineCache.set(geometry, outline);
    return outline;
  }

  function refreshCountryDisplayIndex() {
    const source = state.auditPreviewCountries;
    if (source === countryDisplaySource) return;
    countryDisplaySource = source;
    countryDisplayIndex = new Map((source?.features || []).map(feature => [
      String(feature.properties?.editor_id || feature.id || ''),
      feature,
    ]));
  }

  function countryDisplayFeature(feature) {
    if (state.countryVisualPhase === 'canonical') return feature;
    const id = String(feature?.properties?.editor_id || feature?.id || '');
    if (!id) return feature;
    refreshCountryDisplayIndex();
    return countryDisplayIndex.get(id) || feature;
  }

  function applyUserPreferences(nextPreferences, { persist = true, rerender = true } = {}) {
    userPreferences = persist ? saveUserPreferences(nextPreferences) : nextPreferences;
    const resolvedTheme = effectiveTheme(userPreferences, systemTheme === 'dark');
    document.documentElement.dataset.theme = resolvedTheme;
    applyMapLabelPreferences();
    syncResolvedInteractionStyle();
    syncGpuCountryEmphasis();
    gpuMapRenderer.invalidateCountryPalette({ base: true, emphasis: true }, 'user-preferences');
    gpuMapRenderer.invalidatePhysicalStyle('user-preferences');
    window.__PANDOLAB_THEME__ = resolvedTheme;
    if (rerender && svg) {
      markLayerTreeDirty();
      renderLayerTree();
      renderAll();
    }
    return userPreferences;
  }

  function countryLabelScreenMetrics(feature, fontSize = isMobile() ? 8 : 9, projectedExtent = null, labelFeature = feature) {
    let width = Number(projectedExtent?.width);
    let height = Number(projectedExtent?.height);
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      const geometry = feature?.geometry;
      const cached = geometry ? countryProjectedBoundsCache.get(geometry) : null;
      if (cached?.viewRevision === viewRevision) {
        width = cached.width;
        height = cached.height;
      } else {
        let bounds;
        try { bounds = path.bounds(feature); } catch (_) { bounds = null; }
        width = bounds ? Math.max(0, Number(bounds[1]?.[0]) - Number(bounds[0]?.[0])) : 0;
        height = bounds ? Math.max(0, Number(bounds[1]?.[1]) - Number(bounds[0]?.[1])) : 0;
        if (geometry) countryProjectedBoundsCache.set(geometry, { viewRevision, width, height });
      }
    }
    const textWidth = Math.max(20, [...countryName(labelFeature)].length * fontSize * 1.02 + 8);
    return {
      width: Number.isFinite(width) ? width : 0,
      height: Number.isFinite(height) ? height : 0,
      area: Number.isFinite(width * height) ? width * height : 0,
      textWidth,
      textHeight: fontSize * 1.65 + 4,
    };
  }

  function shouldShowCountryLabel(feature, metrics = countryLabelScreenMetrics(feature)) {
    if (!state.layerVisibility.basemapLabels) return false;
    const id = String(feature.properties?.editor_id || '');
    if (!isLayerItemVisible('countryLabels', id) || pendingCountryLabelAnchors.has(id)) return false;
    if ((state.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY) && state.selected.id === id) return true;
    const widthFit = metrics.width >= Math.min(34, metrics.textWidth * (isMobile() ? 0.48 : 0.42));
    const heightFit = metrics.height >= metrics.textHeight * 0.52;
    const areaFit = metrics.area >= Math.max(isMobile() ? 72 : 58, metrics.textWidth * metrics.textHeight * 0.32);
    return widthFit && heightFit && areaFit;
  }

  function renderPendingCountryOverlays() {
    if (!countryLayer) return;
    const pending = state.layerVisibility.countries && state.pendingCountryRenderIds?.size
      ? [...state.pendingCountryRenderIds]
        .map(countryFeatureById)
        .filter(feature => feature && isCountryVisibleById(String(feature.properties?.editor_id || '')))
      : [];
    const patchFill = countryLayer.selectAll('path.country-patch-preview-fill')
      .data(pending, feature => feature.properties.editor_id);
    patchFill.enter().append('path').attr('class', 'country-patch-preview country-patch-preview-fill');
    countryLayer.selectAll('path.country-patch-preview-fill')
      .attr('d', feature => path(feature))
      .style('fill', countryColor)
      .style('fill-opacity', mapTheme().fillAlpha)
      .style('stroke', 'none');
    patchFill.exit().remove();
    const patchOutline = countryLayer.selectAll('path.country-patch-preview-outline')
      .data(pending, feature => feature.properties.editor_id);
    patchOutline.enter().append('path').attr('class', 'country-patch-preview country-patch-preview-outline');
    countryLayer.selectAll('path.country-patch-preview-outline')
      .attr('d', feature => path(countryOutlineFeature(feature)))
      .style('fill', 'none')
      .style('stroke', mapTheme().border)
      .style('stroke-opacity', mapTheme().borderAlpha);
    patchOutline.exit().remove();
  }

  function renderCountries(viewStateOrRevision = viewRevision) {
    let revision = viewRevision;
    let renderViewState = null;
    if (typeof viewStateOrRevision === 'number' && Number.isFinite(viewStateOrRevision)) {
      revision = Number(viewStateOrRevision);
    } else if (viewStateOrRevision && typeof viewStateOrRevision === 'object') {
      renderViewState = viewStateOrRevision;
      revision = Number(viewStateOrRevision?.revision || revision);
    }
    gpuMapRenderer.render(revision, renderViewState);
    renderPendingCountryOverlays();
    const highlighted = state.layerVisibility.countries && state.countriesData
      ? state.countriesData.features.filter(feature => {
          const id = String(feature.properties?.editor_id || '');
          if (!isLayerItemVisible('countries', id)) return false;
          return (state.tool === 'country-coast' && state.coastEditCountryId === id) ||
            (state.tool === 'country-border' && state.boundaryEditCountryIds.includes(id)) ||
            (state.tool === 'annex-territory' && (state.annexTargetCountryId === id || state.annexDonorCountryIds.includes(id))) ||
            (state.tool === 'merge-country' && (state.mergeSourceCountryId === id || state.mergeTargetCountryIds.includes(id))) ||
            (state.tool === 'new-country' && state.newCountrySourceIds.includes(id));
        })
      : [];
    const fillSelection = countryLayer.selectAll('path.country-highlight-fill')
      .data(highlighted, feature => feature.properties.editor_id);
    fillSelection.enter().append('path').attr('class', 'country-highlight-fill');
    const allCountryFills = countryLayer.selectAll('path.country-highlight-fill');
    allCountryFills
      .attr('d', feature => path(feature))
      .classed('border-editing', feature => state.tool === 'country-border' && state.boundaryEditCountryIds.includes(String(feature.properties.editor_id)))
      .classed('annex-editing', feature => state.tool === 'annex-territory' && state.annexTargetCountryId === feature.properties.editor_id)
      .classed('annex-donor', feature => state.tool === 'annex-territory' && state.annexDonorCountryIds.includes(String(feature.properties.editor_id)))
      .classed('merge-target', feature => state.tool === 'merge-country' && state.mergeTargetCountryIds.includes(String(feature.properties.editor_id)))
      .classed('new-country-source', feature => state.tool === 'new-country' && state.newCountrySourceIds.includes(String(feature.properties.editor_id)));
    fillSelection.exit().remove();
    const selection = countryLayer.selectAll('path.country-shape')
      .data(highlighted, feature => feature.properties.editor_id);
    selection.enter().append('path').attr('class', 'country-shape gpu-country-highlight');
    const allCountries = countryLayer.selectAll('path.country-shape');
    allCountries
      .attr('d', feature => path(countryOutlineFeature(feature)))
      .classed('border-editing', feature => state.tool === 'country-border' && state.boundaryEditCountryIds.includes(String(feature.properties.editor_id)))
      .classed('coast-editing', feature => state.tool === 'country-coast' && state.coastEditCountryId === feature.properties.editor_id)
      .classed('annex-editing', feature => state.tool === 'annex-territory' && state.annexTargetCountryId === feature.properties.editor_id)
      .classed('annex-donor', feature => state.tool === 'annex-territory' && state.annexDonorCountryIds.includes(String(feature.properties.editor_id)))
      .classed('merge-target', feature => state.tool === 'merge-country' && state.mergeTargetCountryIds.includes(String(feature.properties.editor_id)))
      .classed('new-country-source', feature => state.tool === 'new-country' && state.newCountrySourceIds.includes(String(feature.properties.editor_id)));
    selection.exit().remove();
  }

  function visibleLabelLayout() {
    const candidates = [];
    const indexedLabelIds = state.layerVisibility.labels
      ? new Set(visibleMapObjectCandidates(['label']).map(record => String(record.id)))
      : new Set();
    countryLabelScreenAreas.clear();
    const zoom = currentMapZoom();
    if (state.layerVisibility.basemapLabels) for (const feature of state.countriesData?.features || []) {
      const id = String(feature.properties?.editor_id || '');
      if (!isLayerItemVisible('countryLabels', id) || pendingCountryLabelAnchors.has(id)) continue;
      const settings = automaticLabelSettings('country', state.labelSettings[labelKey('country', id)] || {});
      if (zoom < Number(settings.minZoom ?? -Infinity) || zoom > Number(settings.maxZoom ?? Infinity)) continue;
      const anchor = feature.properties?.editor_label_anchor;
      const coordinate = settings.pinned && settings.manualPosition ? settings.manualPosition : anchor;
      if (!Array.isArray(coordinate) || !isCoordVisible(coordinate)) continue;
      const point = activeProjection()(coordinate);
      if (!point) continue;
      const selected = (state.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY) && state.selected.id === id;
      const displayFeature = countryDisplayFeature(feature);
      const baseMetrics = countryLabelScreenMetrics(displayFeature, isMobile() ? 8 : 9, null, feature);
      const fontSize = baseMetrics.area >= (isMobile() ? 3200 : 2200) ? (isMobile() ? 10 : 12) : isMobile() ? 8 : 9;
      const metrics = countryLabelScreenMetrics(displayFeature, fontSize, baseMetrics, feature);
      countryLabelScreenAreas.set(id, metrics.area);
      if (!selected && !shouldShowCountryLabel(feature, metrics)) continue;
      candidates.push({
        key: labelKey('country', id), sourceType: 'country', source: feature, point,
        width: metrics.textWidth, height: metrics.textHeight,
        priority: settings.priority ?? LABEL_PRIORITIES.country, minZoom: settings.minZoom, maxZoom: settings.maxZoom,
        pinned: settings.pinned, collisionGroup: settings.collisionGroup,
        selected,
      });
    }
    if (state.layerVisibility.labels) for (const label of state.labels) {
      const selected = state.selected?.domain === 'label' && String(state.selected.id) === String(label.id);
      if (!selected && !indexedLabelIds.has(String(label.id))) continue;
      const settings = automaticLabelSettings(label.kind, state.labelSettings[labelKey('label', label.id)] || {});
      if (zoom < Number(settings.minZoom ?? -Infinity) || zoom > Number(settings.maxZoom ?? Infinity)) continue;
      const coordinate = settings.pinned && settings.manualPosition ? settings.manualPosition : label.coordinates;
      if (!isCoordVisible(coordinate)) continue;
      const point = activeProjection()(coordinate);
      if (!point) continue;
      const priority = settings.priority ?? (label.kind === 'capital' ? LABEL_PRIORITIES.capital : label.kind === 'city' ? LABEL_PRIORITIES.majorCity : label.kind === 'region' ? LABEL_PRIORITIES.administrative : LABEL_PRIORITIES.place);
      candidates.push({
        key: labelKey('label', label.id), sourceType: 'label', source: label, point,
        width: Math.max(22, [...String(label.name || '')].length * 9 + 16), height: 19,
        priority, minZoom: settings.minZoom, maxZoom: settings.maxZoom,
        pinned: settings.pinned, collisionGroup: settings.collisionGroup,
        selected,
      });
    }
    const nextLabelLayoutMetrics = {};
    const placed = layoutLabels(candidates, { zoom, padding: isMobile() ? 5 : 3, metrics: nextLabelLayoutMetrics });
    labelLayoutMetrics = nextLabelLayoutMetrics;
    if (viewportCullingMetrics.lastByDomain.label) viewportCullingMetrics.lastByDomain.label.finalVisibleCount = placed.filter(item => item.sourceType === 'label').length;
    return {
      countryLabels: placed.filter(item => item.sourceType === 'country').map(item => item.source),
      userLabels: placed.filter(item => item.sourceType === 'label').map(item => item.source),
      countryScreenAreas: new Map(countryLabelScreenAreas),
      candidateCount: candidates.length,
    };
  }

  function renderCountryLabels(layout = null) {
    const resolvedLayout = layout || visibleLabelLayout();
    const data = resolvedLayout.countryLabels || [];

    const selection = countryLabelLayer.selectAll('text.country-label')
      .data(data, d => d.properties.editor_id);

    // 사라진 국가와 기준점 계산 중인 라벨을 먼저 제거해야 이전 DOM이
    // undefined 기준점으로 한 프레임 더 투영되지 않는다.
    selection.exit().remove();

    selection.enter().append('text')
      .attr('class', 'country-label')
      .attr('dy', '.35em')
      .on('click', function(d) {
        if (mapClickBlocked()) return;
        if (state.tool === 'new-country' && state.newCountryPhase === 'sources') {
          d3.event.stopPropagation();
          toggleNewCountrySource(d.properties.editor_id);
          return;
        }
        if (state.tool === 'annex-territory' && state.annexPhase === 'donor') {
          d3.event.stopPropagation();
          toggleAnnexDonor(d.properties.editor_id);
          return;
        }
        if (state.tool === 'merge-country' && state.mergeSourceCountryId) {
          d3.event.stopPropagation();
          toggleMergeTarget(d.properties.editor_id);
          return;
        }
        if (state.tool === 'country-border' && state.boundaryEditPhase === 'selecting') {
          d3.event.stopPropagation();
          toggleBoundaryEditCountry(d.properties.editor_id);
          return;
        }
        if (state.tool !== 'select' || state.labelPlacementMode) return;
        d3.event.stopPropagation();
        handleObjectSelectionAt(d3.mouse(svg.node()), { sourceEvent: d3.event, forcedRef: { domain: 'territorial', type: TERRITORIAL_UNIT_TYPES.COUNTRY, id: d.properties.editor_id } });
      });

    const allCountryLabels = countryLabelLayer.selectAll('text.country-label');
    allCountryLabels
      .text(countryName)
      .style('opacity', layerStyle(state.layerPresentation, 'countryLabels').opacity)
      .classed('major', d => (countryLabelScreenAreas.get(String(d.properties?.editor_id || '')) || 0) >= (isMobile() ? 3200 : 2200))
      .attr('transform', d => {
        const settings = automaticLabelSettings('country', state.labelSettings[labelKey('country', d.properties?.editor_id)] || {});
        const anchor = settings.pinned && settings.manualPosition ? settings.manualPosition : d.properties?.editor_label_anchor;
        const p = Array.isArray(anchor) && anchor.length >= 2 ? activeProjection()(anchor) : null;
        return p ? `translate(${p[0]},${p[1]})` : 'translate(-9999,-9999)';
      });
  }

  function prepareHydroFeature(feature) {
    const bounds = coordinateBounds(feature?.geometry?.coordinates);
    feature.__awBounds = bounds.every(Number.isFinite) ? bounds : [-180, -90, 180, 90];
    try { feature.__awCentroid = d3.geo.centroid(feature); }
    catch (_) { feature.__awCentroid = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2]; }
    feature.__awRadius = Math.min(180, Math.hypot(bounds[2] - bounds[0], bounds[3] - bounds[1]) / 2);
    return feature;
  }

  const terrainService = createTerrainService({
    fetchWithRetry,
    manifestUrl: () => {
      const url = new URL('terrain/v0.12.6/manifest.json', PHYSICAL_DATA_BASE_URL);
      url.searchParams.set('v', ASSET_REVISION);
      return url;
    },
    getLoadState: () => state.physicalLoadState.terrain,
    onLoading: () => {
      state.physicalLoadState.terrain = 'loading';
      state.physicalLoadState.terrainManifest = 'loading';
      markLayerTreeDirty();
      renderLayerTree();
    },
    onRetry: (_operation, attempt) => reliabilityDiagnostic.push({
      category: 'asset', operation: 'terrain-manifest', result: `retry-${attempt}`,
    }),
    acceptManifest: manifest => {
      state.terrainManifest = manifest;
      state.physicalLoadState.terrainManifest = 'ready';
      state.physicalLoadState.terrain = 'ready';
      gpuMapRenderer.setTerrainManifest(manifest);
      markLayerTreeDirty();
      renderLayerTree();
      renderAll();
    },
    onFailure: error => {
      state.physicalLoadState.terrainManifest = 'error';
      state.physicalLoadState.terrain = 'error';
      reliabilityDiagnostic.push({ category: 'asset', operation: 'terrain-manifest', result: 'failed', errorCode: 'PL-TERRAIN-001' });
      markLayerTreeDirty();
      renderLayerTree();
      console.warn('Terrain load failed', error);
      reportOperationError(error, '지형 음영을 불러오지 못했습니다. 국가 지도는 계속 사용할 수 있습니다. 잠시 후 다시 시도하세요.', 'PL-TERRAIN-001', 0);
    },
  });

  async function loadTerrainManifest(force = false) {
    return terrainService.load(force);
  }

  const hydroService = createHydroService({
    fetchWithRetry,
    dataVersion: HYDRO_DATA_VERSION,
    manifestUrl: () => {
      const manifestUrl = new URL(`hydro/v${HYDRO_DATA_VERSION}/manifest.json`, PHYSICAL_DATA_BASE_URL);
      manifestUrl.searchParams.set('v', ASSET_REVISION);
      return manifestUrl;
    },
    getLoadState: () => state.physicalLoadState.hydro,
    onLoading: () => {
      state.physicalLoadState.hydro = 'loading';
      state.physicalLoadState.hydroManifest = 'loading';
      state.physicalLoadState.hydroWorker = 'starting';
      state.physicalLoadState.hydroView = 'idle';
      markLayerTreeDirty();
      renderLayerTree();
    },
    onRetry: (_operation, attempt) => reliabilityDiagnostic.push({
      category: 'asset', operation: 'hydro-manifest', result: `retry-${attempt}`,
    }),
    acceptManifest: async (manifest, manifestUrl) => {
      state.hydroManifest = manifest;
      state.hydroCollections = {};
      state.hydroFeatureCache = new Map();
      state.hydroFeatureByFid = new Map();
      state.hydroFragmentsByLogicalId = new Map();
      state.physicalLoadState.hydroManifest = 'ready';
      state.physicalLoadState.hydroCache = 'idle';
      state.physicalLoadState.hydroCachePercent = 0;
      const workerReady = await gpuMapRenderer.setHydroManifest(manifest, manifestUrl);
      if (!workerReady) return false;
      state.physicalLoadState.hydroWorker = 'ready';
      state.physicalLoadState.hydro = 'ready';
      markLayerTreeDirty();
      renderLayerTree();
      renderHydro();
      return true;
    },
    onFailure: error => {
      if (state.physicalLoadState.hydroManifest !== 'ready') state.physicalLoadState.hydroManifest = 'error';
      state.physicalLoadState.hydroWorker = 'error';
      state.physicalLoadState.hydro = 'error';
      reliabilityDiagnostic.push({ category: 'asset', operation: 'hydro-init', result: 'failed', errorCode: 'PL-WATER-001' });
      markLayerTreeDirty();
      renderLayerTree();
      console.warn('Hydro load failed', error);
      reportOperationError(error, '강·호수 목록을 불러오지 못했습니다. 국가 지도는 계속 사용할 수 있습니다. 페이지를 새로고침하거나 잠시 후 다시 시도하세요.', 'PL-WATER-001', 0);
    },
  });

  async function loadHydroData(force = false) {
    return hydroService.load(force);
  }

  function loadPhysicalData() {
    loadTerrainManifest();
    loadHydroData();
  }

  function hydroVisibilityThreshold() {
    return 2.4 + Math.log2(Math.max(1, currentMapZoom())) * 2.05;
  }

  function hydroFeatureInView(feature) {
    if (!isHydroFeatureVisible(feature)) return false;
    const minZoom = Number(feature.properties?.min_zoom ?? feature.properties?.scale_rank ?? 10);
    if (minZoom > hydroVisibilityThreshold()) return false;
    const bounds = feature.__awBounds || [-180, -90, 180, 90];
    if (state.projection === 'flat') {
      const scale = flatProjection.scale();
      const halfLon = state.size.width / Math.max(1, scale) * 90 / Math.PI;
      const halfLat = state.size.height / Math.max(1, scale) * 90 / Math.PI;
      const centerLon = (bounds[0] + bounds[2]) / 2;
      const centerLat = (bounds[1] + bounds[3]) / 2;
      const deltaLon = Math.abs((((centerLon - state.view.flatCenter[0]) + 540) % 360) - 180);
      return deltaLon <= halfLon + Math.abs(bounds[2] - bounds[0]) / 2 + 2
        && Math.abs(centerLat - state.view.flatCenter[1]) <= halfLat + Math.abs(bounds[3] - bounds[1]) / 2 + 2;
    }
    const center = [-Number(state.view.globeRotation?.[0] || 0), -Number(state.view.globeRotation?.[1] || 0)];
    const radius = Math.asin(Math.min(1, Math.hypot(state.size.width, state.size.height) * 0.5 / Math.max(1, globeProjection.scale())));
    return d3.geo.distance(center, feature.__awCentroid || [0, 0]) <= radius + Number(feature.__awRadius || 0) * Math.PI / 180 + 0.04;
  }

  function hydroRenderGroups(category) {
    const groups = new Map();
    const addFeature = (layerId, width, feature) => {
      const widthBucket = category === 'river' ? Math.round(width * 10) / 10 : 1;
      const key = `${layerId}:${widthBucket}`;
      if (!groups.has(key)) groups.set(key, { key, layerId, width: widthBucket, features: [] });
      groups.get(key).features.push(feature);
    };
    for (const feature of allBuiltInHydroFeatures()) {
      if (!feature.geometry) continue;
      const layerId = feature.properties?.layer_id;
      if (HYDRO_LAYER_META[layerId]?.category !== category || !hydroLayerVisible(layerId) || !hydroFeatureInView(feature)) continue;
      if (category !== 'river') {
        addFeature(layerId, 1, feature);
        continue;
      }
      const parts = hydroLineParts(feature.geometry);
      const widthProfiles = feature.properties?.stroke_widths || [];
      const fallbackWidth = Math.max(0.55, Math.min(2.6, Number(feature.properties?.stroke_width || 0.8)));
      for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
        const part = parts[partIndex];
        const widths = widthProfiles[partIndex] || [];
        for (let index = 0; index < part.length - 1; index += 1) {
          const startWidth = Number(widths[index] ?? fallbackWidth);
          const endWidth = Number(widths[index + 1] ?? startWidth);
          addFeature(layerId, (startWidth + endWidth) / 2, {
            type: 'Feature',
            properties: feature.properties,
            geometry: { type: 'LineString', coordinates: [part[index], part[index + 1]] },
          });
        }
      }
    }
    return [...groups.values()].map(group => ({ ...group, collection: { type: 'FeatureCollection', features: group.features } }));
  }

  function renderHydro() {
    if (!hydroLakeLayer || !hydroRiverLayer) return;
    const riverStyle = layerStyle(state.layerPresentation, 'rivers');
    const lakeStyle = layerStyle(state.layerPresentation, 'lakes');
    const renderer = gpuMapRenderer.getStats({ detailed: false }).renderer;
    const nativeHydro = renderer === 'webgl2' || renderer === 'webgl1' || renderer === 'canvas-worker' || renderer === 'canvas2d';
    if (nativeHydro) {
      hydroLakeLayer.selectAll('*').remove();
      hydroRiverLayer.selectAll('*').remove();
    } else {
      const lakes = state.layerVisibility.lakes ? hydroRenderGroups('lake') : [];
      const lakeSelection = hydroLakeLayer.selectAll('path.hydro-lake-group').data(lakes, item => item.key);
      lakeSelection.enter().append('path').attr('class', 'hydro-lake-group');
      lakeSelection.attr('d', item => path(item.collection)).style('fill', hydroDisplayColor('lake')).style('stroke', hydroDisplayColor('lake')).style('opacity', null).style('fill-opacity', lakeStyle.opacity).style('stroke-opacity', lakeStyle.boundaryVisible ? lakeStyle.opacity : 0).style('stroke-width', lakeStyle.boundaryWidth);
      lakeSelection.exit().remove();

      const rivers = state.layerVisibility.rivers ? hydroRenderGroups('river') : [];
      const riverSelection = hydroRiverLayer.selectAll('path.hydro-river-group').data(rivers, item => item.key);
      riverSelection.enter().append('path').attr('class', 'hydro-river-group');
      riverSelection.attr('d', item => path(item.collection)).style('stroke-width', item => `${item.width * riverStyle.boundaryWidth}px`).style('stroke', hydroDisplayColor('river')).style('opacity', null).style('stroke-opacity', riverStyle.opacity);
      riverSelection.exit().remove();
    }

  }

  function hydroEditColor(feature) {
    const category = feature?.properties?.category === 'lake' ? 'lake' : 'river';
    return feature?.properties?.editorColor || HYDRO_TOOL_CONFIG[category].color;
  }

  function renderHydroEdits() {
    if (!hydroEditLayer) return;
    const renderer = gpuMapRenderer.getStats({ detailed: false }).renderer;
    const nativeHydro = renderer === 'webgl2' || renderer === 'webgl1' || renderer === 'canvas-worker' || renderer === 'canvas2d';
    gpuMapRenderer.setHydroEdits?.(state.hydroEdits, state.stateRevision);
    const riverStyle = layerStyle(state.layerPresentation, 'rivers');
    const lakeStyle = layerStyle(state.layerPresentation, 'lakes');
    const visibleHydroIds = new Set(visibleMapObjectCandidates(['hydro']).map(record => String(record.id)));
    const data = state.hydroEdits.filter(feature => isHydroFeatureVisible(feature) && feature.geometry
        && ((visibleHydroIds.has(String(feature.id)) && geometryMayIntersectViewport(feature.geometry))
          || objectSelection.has(normalizeObjectRef({ domain: 'hydro', type: feature.properties?.category || 'river', id: feature.id }))));
    if (viewportCullingMetrics.lastByDomain.hydro) viewportCullingMetrics.lastByDomain.hydro.finalVisibleCount = data.length;
    const selection = hydroEditLayer.selectAll('path.hydro-edit-shape').data(data, feature => String(feature.id));
    selection.enter().append('path')
      .attr('class', 'hydro-edit-shape')
      .on('mouseenter.hover', feature => setMapHover('hydro', feature.id, feature, { domain: 'hydro', type: feature.properties?.category || 'river', id: feature.id }))
      .on('mouseleave.hover', () => setMapHover('', '', null))
      .on('click', function(feature) {
        if (mapClickBlocked() || state.tool !== 'select' || state.labelPlacementMode) return;
        d3.event.stopPropagation();
        handleObjectSelectionAt(d3.mouse(svg.node()), { sourceEvent: d3.event, forcedRef: { domain: 'hydro', type: feature.properties?.category || 'river', id: feature.id } });
      });
    selection
      .attr('d', path)
      .classed('hydro-edit-native-hit', nativeHydro)
      .style('fill', feature => feature.properties?.category === 'lake' ? (nativeHydro ? 'transparent' : hydroEditColor(feature)) : 'none')
      .style('fill-opacity', feature => feature.properties?.category === 'lake' ? (nativeHydro ? 0 : 0.34 * lakeStyle.opacity) : 0)
      .style('stroke', feature => ['Polygon', 'MultiPolygon'].includes(feature.geometry?.type) ? 'none' : (nativeHydro ? 'transparent' : hydroEditColor(feature)))
      .style('stroke-opacity', feature => ['Polygon', 'MultiPolygon'].includes(feature.geometry?.type) ? 0 : (nativeHydro ? 0 : riverStyle.opacity))
      .style('stroke-width', feature => ['Polygon', 'MultiPolygon'].includes(feature.geometry?.type) ? 0 : (nativeHydro ? Math.max(8, riverStyle.boundaryWidth) : riverStyle.boundaryWidth));
    selection.exit().remove();
    const polygonSelection = hydroEditLayer.selectAll('path.hydro-edit-boundary').data(
      nativeHydro ? [] : data.filter(feature => ['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)),
      feature => String(feature.id),
    );
    polygonSelection.enter().append('path').attr('class', 'hydro-edit-boundary').style('fill', 'none').style('pointer-events', 'none');
    polygonSelection.attr('d', feature => path(buildRenderableStrokeFeature(feature)))
      .style('stroke', hydroEditColor)
      .style('stroke-opacity', lakeStyle.boundaryVisible ? lakeStyle.opacity : 0)
      .style('stroke-width', lakeStyle.boundaryWidth);
    polygonSelection.exit().remove();
  }

  function renderDrawings() {
    const style = layerStyle(state.layerPresentation, 'userDrawings');
    const visibleDrawingIds = state.layerVisibility.drawings
      ? new Set(visibleMapObjectCandidates(['drawing']).map(record => String(record.id)))
      : new Set();
    const data = state.layerVisibility.drawings
      ? state.drawings.filter(feature => isLayerItemVisible('drawings', feature.id)).map(drawingDisplayFeature).filter(feature => feature.geometry
        && ((visibleDrawingIds.has(String(feature.id)) && geometryMayIntersectViewport(feature.geometry))
          || objectSelection.has(normalizeObjectRef({ domain: 'drawing', type: feature.properties?.category || 'custom', id: feature.id }))))
      : [];
    if (viewportCullingMetrics.lastByDomain.drawing) viewportCullingMetrics.lastByDomain.drawing.finalVisibleCount = data.length;
    const selection = drawingLayer.selectAll('path.drawing-shape')
      .data(data, d => String(d.id));

    selection.enter().append('path')
      .attr('class', 'drawing-shape')
      .on('mouseenter.hover', d => setMapHover('drawing', d.id, d, { domain: 'drawing', type: d.properties?.category || 'custom', id: d.id }))
      .on('mouseleave.hover', () => setMapHover('', '', null))
      .on('click', function(d) {
        if (mapClickBlocked()) return;
        if (state.tool === 'merge-drawing') {
          d3.event.stopPropagation();
          toggleDrawingMergeTarget(String(d.id));
          return;
        }
        if (state.tool !== 'select' || state.labelPlacementMode) return;
        d3.event.stopPropagation();
        handleObjectSelectionAt(d3.mouse(svg.node()), { sourceEvent: d3.event, forcedRef: { domain: 'drawing', type: d.properties?.category || 'custom', id: d.id } });
      });

    selection
      .attr('d', path)
      .classed('selected', d => objectSelection.has(normalizeObjectRef({ domain: 'drawing', type: d.properties?.category || 'custom', id: d.id })))
      .classed('selected-point', d => d.geometry?.type === 'Point' && objectSelection.has(normalizeObjectRef({ domain: 'drawing', type: d.properties?.category || 'custom', id: d.id })))
      .classed('is-primary-selection', d => objectSelection.snapshot().primaryKey === normalizeObjectRef({ domain: 'drawing', type: d.properties?.category || 'custom', id: d.id })?.key)
      .classed('is-secondary-selection', d => {
        const ref = normalizeObjectRef({ domain: 'drawing', type: d.properties?.category || 'custom', id: d.id });
        return objectSelection.has(ref) && objectSelection.snapshot().primaryKey !== ref?.key;
      })
      .style('fill', d => d.geometry?.type?.includes('Polygon') ? drawingColor(d) : 'none')
      .style('fill-opacity', d => d.geometry?.type?.includes('Polygon') ? 0.34 * style.opacity : 0)
      .style('stroke', d => d.geometry?.type?.includes('Polygon') ? 'none' : drawingColor(d))
      .style('stroke-opacity', d => d.geometry?.type?.includes('Polygon') ? 0 : style.boundaryVisible ? style.opacity : 0)
      .style('stroke-width', d => d.geometry?.type?.includes('Polygon') ? 0 : style.boundaryWidth)
      .style('mix-blend-mode', style.blendMode)
      .attr('data-presentation-group', 'userDrawings')
      .classed('drawing-merge-source', d => state.tool === 'merge-drawing' && state.drawingMergeSourceId === String(d.id))
      .classed('drawing-merge-target', d => state.tool === 'merge-drawing' && state.drawingMergeTargetIds.includes(String(d.id)));

    selection.exit().remove();
    const polygonSelection = drawingLayer.selectAll('path.drawing-boundary').data(
      data.filter(feature => ['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)),
      feature => String(feature.id),
    );
    polygonSelection.enter().append('path').attr('class', 'drawing-boundary').style('fill', 'none').style('pointer-events', 'none');
    polygonSelection.attr('d', feature => path(buildRenderableStrokeFeature(feature)))
      .style('stroke', drawingColor)
      .style('stroke-opacity', style.boundaryVisible ? style.opacity : 0)
      .style('stroke-width', style.boundaryWidth)
      .style('mix-blend-mode', style.blendMode)
      .classed('drawing-merge-source', feature => state.tool === 'merge-drawing' && state.drawingMergeSourceId === String(feature.id))
      .classed('drawing-merge-target', feature => state.tool === 'merge-drawing' && state.drawingMergeTargetIds.includes(String(feature.id)));
    polygonSelection.exit().remove();
  }

  function buildDistributionRenderRows() {
    const renderMode = state.distributionSettings.renderMode;
    const selectedLayerId = renderMode === DISTRIBUTION_RENDER_MODES.INTENSITY
      ? String(state.selectedDistributionLayerId || state.selected?.domain === 'distribution' && state.selected.id || '')
      : '';
    const cacheCurrent = distributionRenderRowCache.layers === state.distributionLayers
      && distributionRenderRowCache.entries === state.distributionEntries
      && distributionRenderRowCache.countries === state.countriesData?.features
      && distributionRenderRowCache.countryGeometryRevision === countryLandRevision
      && distributionRenderRowCache.territorialUnits === state.territorialUnits
      && distributionRenderRowCache.renderMode === renderMode
      && distributionRenderRowCache.selectedLayerId === selectedLayerId
      && distributionRenderRowCache.visibilityRevision === distributionVisibilityRevision;
    if (cacheCurrent) return distributionRenderRowCache.rows;
    const started = performance.now();
    const visibleLayers = state.distributionLayers.filter(layer => {
      const group = DISTRIBUTION_TYPE_GROUPS[layer.type];
      return state.layerVisibility[group] !== false && isLayerItemVisible(group, layer.id);
    });
    const visibleIds = new Set(visibleLayers.map(layer => layer.id));
    let entries;
    if (renderMode === DISTRIBUTION_RENDER_MODES.INTENSITY) {
      entries = visibleIds.has(selectedLayerId) ? distributionEntriesForLayer(state.distributionEntries, selectedLayerId) : [];
    } else {
      entries = Object.values(DISTRIBUTION_TYPES).flatMap(type => {
        const typeLayers = visibleLayers.filter(layer => layer.type === type);
        const typeIds = new Set(typeLayers.map(layer => layer.id));
        return dominantDistributionEntries(typeLayers, state.distributionEntries.filter(entry => typeIds.has(entry.layerId)));
      });
    }
    const byLayer = new Map(visibleLayers.map(layer => [layer.id, layer]));
    const rows = entries.map(entry => {
      const layer = byLayer.get(entry.layerId);
      const geometry = entry.mode === DISTRIBUTION_MODES.TERRITORIAL
        ? territorialRepository.get(entry.territorialUnitId)?.geometry
        : entry.geometry;
      if (!layer || !geometry) return null;
      return Object.freeze({
        id: entry.id,
        layer,
        entry,
        geometry,
        bounds: geometryBounds(geometry),
        type: 'Feature',
      });
    }).filter(Boolean);
    distributionRenderRowCache = {
      layers: state.distributionLayers,
      entries: state.distributionEntries,
      countries: state.countriesData?.features,
      countryGeometryRevision: countryLandRevision,
      territorialUnits: state.territorialUnits,
      renderMode,
      selectedLayerId,
      visibilityRevision: distributionVisibilityRevision,
      rows: Object.freeze(rows),
      rebuildCount: distributionRenderRowCache.rebuildCount + 1,
      buildMs: performance.now() - started,
    };
    return distributionRenderRowCache.rows;
  }

  function visibleDistributionRenderRows() {
    const rows = buildDistributionRenderRows();
    const candidates = new Set(visibleMapObjectCandidates(['distribution']).map(record => String(record.id)));
    const started = performance.now();
    let verificationCount = 0;
    const visible = rows.filter(row => {
      const selected = objectSelection.has(normalizeObjectRef({ domain: 'distribution', type: row.layer.type, id: row.layer.id }));
      if (selected) return true;
      if (!candidates.has(String(row.id))) return false;
      verificationCount += 1;
      return geometryMayIntersectViewport(row.geometry);
    });
    viewportCullingMetrics.finalVisibleCount = visible.length;
    if (viewportCullingMetrics.lastByDomain.distribution) viewportCullingMetrics.lastByDomain.distribution.finalVisibleCount = visible.length;
    viewportCullingMetrics.projectedVerificationCount += verificationCount;
    viewportCullingMetrics.projectedVerificationMs += performance.now() - started;
    return visible;
  }

  function distributionRenderRows({ cull = true } = {}) {
    return cull ? visibleDistributionRenderRows() : buildDistributionRenderRows();
  }

  function renderDistributions() {
    if (!distributionLayer) return;
    const data = distributionRenderRows();
    const boundaryVisible = state.distributionSettings?.boundaryVisible !== false;
    const selection = distributionLayer.selectAll('path.distribution-shape').data(data, row => row.id);
    selection.enter().append('path').attr('class', 'distribution-shape')
      .on('mouseenter.hover', row => setMapHover('distribution', row.id, featureFromGeometry(row.geometry), { domain: 'distribution', type: row.layer.type, id: row.layer.id }))
      .on('mouseleave.hover', () => setMapHover('', '', null))
      .on('click', function(row) {
        if (mapClickBlocked() || state.tool !== 'select' || state.labelPlacementMode) return;
        d3.event.stopPropagation();
        handleObjectSelectionAt(d3.mouse(svg.node()), { sourceEvent: d3.event, forcedRef: { domain: 'distribution', type: row.layer.type, id: row.layer.id } });
      });
    selection
      .attr('d', row => path({ type: 'Feature', properties: {}, geometry: row.geometry }))
      .style('fill', row => distributionColor(row.layer))
      .style('stroke', row => ['Polygon', 'MultiPolygon'].includes(row.geometry?.type) ? 'none' : distributionColor(row.layer))
      .style('fill-opacity', row => (0.12 + Math.max(0, Math.min(100, row.entry.share)) / 100 * 0.58) * layerStyle(state.layerPresentation, DISTRIBUTION_TYPE_GROUPS[row.layer.type]).opacity)
      .style('stroke-opacity', row => {
        if (['Polygon', 'MultiPolygon'].includes(row.geometry?.type)) return 0;
        const style = layerStyle(state.layerPresentation, DISTRIBUTION_TYPE_GROUPS[row.layer.type]);
        return boundaryVisible ? style.opacity : 0;
      })
      .style('stroke-width', row => ['Polygon', 'MultiPolygon'].includes(row.geometry?.type) ? 0 : layerStyle(state.layerPresentation, DISTRIBUTION_TYPE_GROUPS[row.layer.type]).boundaryWidth)
      .style('mix-blend-mode', row => layerStyle(state.layerPresentation, DISTRIBUTION_TYPE_GROUPS[row.layer.type]).blendMode)
      .attr('data-presentation-group', row => DISTRIBUTION_TYPE_GROUPS[row.layer.type]);
    selection.exit().remove();
    const polygonSelection = distributionLayer.selectAll('path.distribution-boundary').data(
      data.filter(row => ['Polygon', 'MultiPolygon'].includes(row.geometry?.type)),
      row => row.id,
    );
    polygonSelection.enter().append('path').attr('class', 'distribution-boundary').style('fill', 'none').style('pointer-events', 'none');
    polygonSelection.attr('d', row => path(buildRenderableStrokeFeature({ type: 'Feature', properties: {}, geometry: row.geometry })))
      .style('stroke', row => distributionColor(row.layer))
      .style('stroke-opacity', row => {
        const style = layerStyle(state.layerPresentation, DISTRIBUTION_TYPE_GROUPS[row.layer.type]);
        return boundaryVisible ? style.opacity : 0;
      })
      .style('stroke-width', row => layerStyle(state.layerPresentation, DISTRIBUTION_TYPE_GROUPS[row.layer.type]).boundaryWidth)
      .style('mix-blend-mode', row => layerStyle(state.layerPresentation, DISTRIBUTION_TYPE_GROUPS[row.layer.type]).blendMode);
    polygonSelection.exit().remove();
  }

  function territorialInternalBoundarySegments() {
    const countries = state.countriesData?.features || [];
    const units = state.territorialUnits || [];
    if (territorialBoundaryCache.countries !== countries
      || territorialBoundaryCache.units !== units
      || territorialBoundaryCache.unitGeometryRevision !== mapObjectGeometryRevisions.territorial) {
      territorialBoundaryCache = {
        countries,
        units,
        unitGeometryRevision: mapObjectGeometryRevisions.territorial,
        segments: buildTerritorialInternalBoundarySegments(countries, units),
        rebuildCount: territorialBoundaryCache.rebuildCount + 1,
      };
    }
    return territorialBoundaryCache.segments;
  }

  function renderTerritorialInternalBoundaries(visibleFeatures) {
    if (!territorialBoundaryLayer) return;
    const visibleIds = new Set((visibleFeatures || []).map(feature => String(feature.id)));
    const featuresById = new Map((state.territorialUnits || []).map(feature => [String(feature.id), feature]));
    const styleByType = new Map([
      ['territory', { presentationGroup: 'territories', width: 2, dash: [0, 0] }],
      ['administrative', { presentationGroup: 'administrative', width: 1.1, dash: [3, 2] }],
      ['region', { presentationGroup: 'regions', width: 1.5, dash: [7, 3] }],
    ]);
    const boundarySegments = territorialInternalBoundarySegments();
    const visibleSignature = [...visibleIds].sort().map(id => `${id}:${territorialUnitColor(featuresById.get(id))}`).join('|');
    const styleSignature = [...styleByType].map(([type, definition]) => {
      const style = layerStyle(state.layerPresentation, definition.presentationGroup);
      return `${type}:${style.opacity}:${style.boundaryVisible}`;
    }).join('|');
    const signature = `${territorialBoundaryCache.rebuildCount};${visibleSignature};${styleSignature}`;
    if (territorialBoundaryBatchCache.signature !== signature) {
      const groups = new Map([...styleByType].map(([styleType, definition]) => [styleType, {
        key: styleType,
        styleType,
        width: definition.width,
        dash: definition.dash,
        coordinates: [],
        segments: [],
      }]));
      for (const segment of boundarySegments) {
        const visibleOwner = segment.unitIds.find(id => visibleIds.has(String(id)));
        if (!visibleOwner) continue;
        const definition = styleByType.get(segment.styleType) || styleByType.get('territory');
        const style = layerStyle(state.layerPresentation, definition.presentationGroup);
        if (!style.boundaryVisible || !(style.opacity > 0)) continue;
        const owner = featuresById.get(String(visibleOwner));
        const color = owner ? territorialUnitColor(owner) : mapTheme().border;
        const group = groups.get(segment.styleType) || groups.get('territory');
        group.coordinates.push([segment.a, segment.b]);
        group.segments.push({ a: segment.a, b: segment.b, color, opacity: style.opacity });
      }
      territorialBoundaryBatchCache = {
        signature,
        revision: `${territorialBoundaryCache.rebuildCount}:${signature}`,
        groups: [...groups.values()].filter(group => group.segments.length),
      };
    }
    const gpuBoundaryAvailable = !!selectionEmphasisRenderer?.isAvailable?.();
    selectionEmphasisRenderer?.setTerritorialBoundaries?.({
      revision: territorialBoundaryBatchCache.revision,
      batches: territorialBoundaryBatchCache.groups,
    });
    if (gpuBoundaryAvailable) {
      territorialBoundaryLayer.selectAll('path.territorial-internal-boundary').remove();
      return;
    }
    const fallbackGroups = new Map();
    for (const group of territorialBoundaryBatchCache.groups) for (const segment of group.segments) {
      const key = `${group.styleType}:${segment.color}:${segment.opacity}`;
      if (!fallbackGroups.has(key)) fallbackGroups.set(key, {
        key, styleType: group.styleType, color: segment.color, opacity: segment.opacity, coordinates: [],
      });
      fallbackGroups.get(key).coordinates.push([segment.a, segment.b]);
    }
    const data = [...fallbackGroups.values()].map(group => ({
      ...group, geometry: { type: 'MultiLineString', coordinates: group.coordinates },
    }));
    const selection = territorialBoundaryLayer.selectAll('path.territorial-internal-boundary')
      .data(data, group => group.key);
    selection.enter().append('path').attr('class', 'territorial-internal-boundary');
    selection
      .attr('class', group => `territorial-internal-boundary territorial-internal-boundary--${group.styleType}`)
      .attr('d', group => path({ type: 'Feature', properties: {}, geometry: group.geometry }))
      .style('color', group => group.color)
      .style('stroke', group => group.color)
      .style('stroke-opacity', group => group.opacity);
    selection.exit().remove();
  }

  function renderTerritorialUnits() {
    const visibleTerritorialIds = new Set(visibleMapObjectCandidates(['territorial']).map(record => String(record.id)));
    const data = state.territorialUnits.filter(feature => {
      const group = feature.properties?.unitType === TERRITORIAL_UNIT_TYPES.ADMIN
        ? 'administrative'
        : feature.properties?.unitType === TERRITORIAL_UNIT_TYPES.REGION
          ? 'regions'
          : 'territories';
      const selected = objectSelection.has(normalizeObjectRef({
        domain: 'territorial',
        type: feature.properties?.unitType || TERRITORIAL_UNIT_TYPES.TERRITORY,
        id: feature.id,
      }));
      const editing = state.territorialUnitMergeSourceId === String(feature.id)
        || state.territorialUnitMergeTargetIds.includes(String(feature.id))
        || state.territorialUnitSplitSourceId === String(feature.id)
        || state.territorialUnitRedrawSourceId === String(feature.id);
      return state.layerVisibility[group] !== false && isLayerItemVisible(group, feature.id)
        && (selected || editing || (visibleTerritorialIds.has(String(feature.id)) && geometryMayIntersectViewport(feature.geometry)));
    });
    if (viewportCullingMetrics.lastByDomain.territorial) viewportCullingMetrics.lastByDomain.territorial.finalVisibleCount = data.length;
    const selection = territorialUnitLayer.selectAll('path.territorial-unit-shape')
      .data(data, feature => String(feature.id));

    selection.enter().append('path')
      .attr('class', 'territorial-unit-shape')
      .on('mouseenter.hover', feature => setMapHover('territorialUnit', feature.id, feature, { domain: 'territorial', type: feature.properties?.unitType || TERRITORIAL_UNIT_TYPES.TERRITORY, id: feature.id }))
      .on('mouseleave.hover', () => setMapHover('', '', null))
      .on('click', function(feature) {
        if (mapClickBlocked()) return;
        if (state.tool === 'merge-territorial-unit') {
          d3.event.stopPropagation();
          toggleTerritorialUnitMergeTarget(String(feature.id));
          return;
        }
        if (state.tool !== 'select' || state.labelPlacementMode) return;
        d3.event.stopPropagation();
        handleObjectSelectionAt(d3.mouse(svg.node()), { sourceEvent: d3.event, forcedRef: { domain: 'territorial', type: feature.properties?.unitType || TERRITORIAL_UNIT_TYPES.TERRITORY, id: feature.id } });
      });

    selection
      .attr('d', path)
      .classed('is-territory', feature => feature.properties?.unitType === TERRITORIAL_UNIT_TYPES.TERRITORY)
      .classed('is-administrative', feature => feature.properties?.unitType === TERRITORIAL_UNIT_TYPES.ADMIN)
      .classed('is-region', feature => feature.properties?.unitType === TERRITORIAL_UNIT_TYPES.REGION)
      .classed('has-explicit-color', feature => !!territorialStyleColor(feature))
      .classed('territorial-unit-merge-source', feature => state.tool === 'merge-territorial-unit' && state.territorialUnitMergeSourceId === String(feature.id))
      .classed('territorial-unit-merge-target', feature => state.tool === 'merge-territorial-unit' && state.territorialUnitMergeTargetIds.includes(String(feature.id)))
      .style('color', territorialUnitColor)
      .style('fill', territorialUnitColor)
      .style('fill-opacity', feature => layerStyle(state.layerPresentation, presentationGroupForTerritorialFeature(feature)).opacity)
      .style('stroke', 'none')
      .style('stroke-opacity', 0)
      .style('stroke-width', 0)
      .style('stroke-dasharray', 'none')
      .style('mix-blend-mode', feature => layerStyle(state.layerPresentation, presentationGroupForTerritorialFeature(feature)).blendMode)
      .attr('data-presentation-group', presentationGroupForTerritorialFeature);

    selection.exit().remove();
    const operationOutlines = data.filter(feature => state.territorialUnitMergeSourceId === String(feature.id)
      || state.territorialUnitMergeTargetIds.includes(String(feature.id)));
    const outlineSelection = territorialOperationLayer.selectAll('path.territorial-unit-operation-outline')
      .data(operationOutlines, feature => String(feature.id));
    outlineSelection.enter().append('path')
      .attr('class', 'territorial-unit-operation-outline')
      .style('fill', 'none')
      .style('pointer-events', 'none');
    outlineSelection
      .attr('d', feature => path(buildRenderableStrokeFeature(feature)))
      .style('stroke', feature => state.territorialUnitMergeSourceId === String(feature.id) ? 'var(--accent-2)' : 'var(--accent)')
      .style('stroke-opacity', 1)
      .style('stroke-width', 3)
      .style('stroke-dasharray', 'none');
    outlineSelection.exit().remove();
    const boundaryFeatures = state.territorialUnits.filter(feature => {
      const group = presentationGroupForTerritorialFeature(feature);
      return state.layerVisibility[group] !== false && isLayerItemVisible(group, feature.id);
    });
    renderTerritorialInternalBoundaries(boundaryFeatures);
  }

  function presentationGroupForTerritorialFeature(feature) {
    return feature?.properties?.unitType === TERRITORIAL_UNIT_TYPES.ADMIN
      ? 'administrative'
      : feature?.properties?.unitType === TERRITORIAL_UNIT_TYPES.REGION
        ? 'regions'
        : 'territories';
  }

  function applyOverlayStackOrder() {
    if (!overlayStackLayer) return;
    const order = state.layerPresentation?.overlayOrder || OVERLAY_GROUPS;
    const groupForDatum = datum => datum?.layer
      ? DISTRIBUTION_TYPE_GROUPS[datum.layer.type]
      : datum?.properties?.unitType
        ? presentationGroupForTerritorialFeature(datum)
        : 'userDrawings';
    overlayStackLayer.selectAll('[data-presentation-group]').sort((left, right) => {
      const leftGroup = groupForDatum(left);
      const rightGroup = groupForDatum(right);
      const leftIndex = order.indexOf(leftGroup);
      const rightIndex = order.indexOf(rightGroup);
      return (rightIndex < 0 ? order.length : rightIndex) - (leftIndex < 0 ? order.length : leftIndex);
    });
  }

  function renderUserLabels(layout = null) {
    const labelStyle = layerStyle(state.layerPresentation, 'labels');
    const selectionState = objectSelection.snapshot();
    const labelRef = label => normalizeObjectRef({ domain: 'label', type: label.kind || 'label', id: label.id });
    const data = state.layerVisibility.labels
      ? (layout || visibleLabelLayout()).userLabels || []
      : [];

    const selection = labelLayer.selectAll('g.user-label')
      .data(data, d => d.id);

    const enter = selection.enter().append('g')
      .attr('class', 'user-label')
      .on('click', function(d) {
        if (mapClickBlocked()) return;
        if (state.tool !== 'select' || state.labelPlacementMode) return;
        d3.event.stopPropagation();
        handleObjectSelectionAt(d3.mouse(svg.node()), { sourceEvent: d3.event, forcedRef: { domain: 'label', type: d.kind || 'label', id: d.id } });
      });

    enter.append('circle').attr('class', 'user-label-dot').attr('r', 4);
    enter.append('text').attr('class', 'user-label-text').attr('x', 7).attr('dy', '.35em');

    selection
      .style('opacity', labelStyle.opacity)
      .classed('selected', d => objectSelection.has(labelRef(d)))
      .classed('is-primary-selection', d => labelRef(d)?.key === selectionState.primaryKey)
      .classed('is-secondary-selection', d => objectSelection.has(labelRef(d)) && labelRef(d)?.key !== selectionState.primaryKey)
      .attr('transform', d => {
        const settings = automaticLabelSettings(d.kind, state.labelSettings[labelKey('label', d.id)] || {});
        const coordinate = settings.pinned && settings.manualPosition ? settings.manualPosition : d.coordinates;
        const p = activeProjection()(coordinate);
        return p ? `translate(${p[0]},${p[1]})` : 'translate(-9999,-9999)';
      });

    selection.select('text').text(d => d.name);
    // Drag capture would otherwise eat clicks intended for drawing tools.
    selection.on('.drag', null);
    if (state.tool === 'select' && !state.labelPlacementMode) selection.call(labelDragBehavior());
    selection.exit().remove();
  }

  function renderCountryLabelPositions() {
    countryLabelLayer.selectAll('text.country-label').attr('transform', feature => {
      const settings = automaticLabelSettings('country', state.labelSettings[labelKey('country', feature.properties?.editor_id)] || {});
      const anchor = settings.pinned && settings.manualPosition ? settings.manualPosition : feature.properties?.editor_label_anchor;
      const point = Array.isArray(anchor) && anchor.length >= 2 && isCoordVisible(anchor) ? activeProjection()(anchor) : null;
      return point ? `translate(${point[0]},${point[1]})` : 'translate(-9999,-9999)';
    });
  }

  function renderUserLabelPositions() {
    labelLayer.selectAll('g.user-label').attr('transform', label => {
      const settings = automaticLabelSettings(label.kind, state.labelSettings[labelKey('label', label.id)] || {});
      const coordinate = settings.pinned && settings.manualPosition ? settings.manualPosition : label.coordinates;
      const point = isCoordVisible(coordinate) ? activeProjection()(coordinate) : null;
      return point ? `translate(${point[0]},${point[1]})` : 'translate(-9999,-9999)';
    });
  }

  function getEditableVertices(feature) {
    if (!feature?.geometry) return [];
    const type = feature.geometry.type;
    if (type === 'LineString') {
      return feature.geometry.coordinates.map((coord, index) => ({ key: `0:${index}`, partIndex: 0, index, coord }));
    }
    if (type === 'MultiLineString') {
      return (feature.geometry.coordinates || []).flatMap((part, partIndex) => part.map((coord, index) => ({ key: `${partIndex}:${index}`, partIndex, index, coord })));
    }
    if (type === 'Polygon') {
      return (feature.geometry.coordinates || []).flatMap((ring, ringIndex) => ring.slice(0, Math.max(0, ring.length - 1)).map((coord, index) => ({ key: `0:${ringIndex}:${index}`, polygonIndex: 0, ringIndex, index, coord })));
    }
    if (type === 'MultiPolygon') {
      return (feature.geometry.coordinates || []).flatMap((polygon, polygonIndex) => (polygon || []).flatMap((ring, ringIndex) => ring.slice(0, Math.max(0, ring.length - 1)).map((coord, index) => ({ key: `${polygonIndex}:${ringIndex}:${index}`, polygonIndex, ringIndex, index, coord }))));
    }
    return [];
  }

  function setEditableVertexCoord(feature, vertex, coord) {
    const type = feature?.geometry?.type;
    if (type === 'LineString') feature.geometry.coordinates[vertex.index] = coord.slice();
    else if (type === 'MultiLineString') feature.geometry.coordinates[vertex.partIndex][vertex.index] = coord.slice();
    else {
      const ring = type === 'Polygon'
        ? feature.geometry.coordinates?.[vertex.ringIndex]
        : feature.geometry.coordinates?.[vertex.polygonIndex]?.[vertex.ringIndex];
      if (!ring || vertex.index < 0 || vertex.index >= ring.length - 1) return false;
      ring[vertex.index] = coord.slice();
      if (vertex.index === 0) ring[ring.length - 1] = coord.slice();
    }
    drawingLandClipCache.delete(feature);
    return true;
  }

  function renderBoundaryEditOverlay() {
    const editActive = (state.tool === 'country-coast' && state.coastEditCountryId)
      || (state.tool === 'country-border' && state.boundaryEditPhase === 'editing');
    const visibleSegments = editActive
      ? getCountryBoundarySegments().filter(seg => seg.geometry.coordinates.some(isCoordVisible))
      : [];
    const data = ['coast', 'shared'].map(kind => {
      const segments = visibleSegments.filter(segment => (segment.kind === 'coast' ? 'coast' : 'shared') === kind);
      return segments.length ? {
        key: `${kind}:${state.coastEditCountryId || state.boundaryEditCountryIds.join('|')}`,
        kind,
        geometry: { type: 'MultiLineString', coordinates: segments.map(segment => segment.geometry.coordinates) },
      } : null;
    }).filter(Boolean);
    const selection = boundaryEditLayer.selectAll('path.boundary-edit-segment').data(data, d => d.key);
    selection.enter().append('path').attr('class', 'boundary-edit-segment');
    selection.exit().remove();
    const allSegments = boundaryEditLayer.selectAll('path.boundary-edit-segment');
    allSegments
      .attr('d', d => path({ type: 'Feature', geometry: d.geometry, properties: {} }))
      .classed('coast', d => d.kind === 'coast')
      .classed('shared', d => d.kind === 'shared')
      .on('click.vertex-add', null);
  }

  function thinVisibleCoastHandles(handles) {
    const projection = activeProjection();
    const zoom = currentMapZoom();
    const minDistance = Math.max(isMobile() ? 7 : 4, (isMobile() ? 18 : 11) / Math.sqrt(Math.max(1, zoom)));
    const cellSize = minDistance;
    const occupied = new Map();
    const accepted = [];
    const orderedHandles = [...handles].sort((left, right) => Number(!!right.fixed) - Number(!!left.fixed));
    for (const handle of orderedHandles) {
      if (!isCoordVisible(handle.coord)) continue;
      const point = projection(handle.coord);
      if (!point) continue;
      const gx = Math.floor(point[0] / cellSize), gy = Math.floor(point[1] / cellSize);
      let crowded = false;
      for (let x = gx - 1; x <= gx + 1 && !crowded; x += 1) {
        for (let y = gy - 1; y <= gy + 1; y += 1) {
          const other = occupied.get(`${x}:${y}`);
          if (other && Math.hypot(point[0] - other[0], point[1] - other[1]) < minDistance) { crowded = true; break; }
        }
      }
      if (crowded) continue;
      occupied.set(`${gx}:${gy}`, point);
      accepted.push(handle);
    }
    return accepted;
  }

  function renderVertices() {
    let data = [];
    let feature = null;
    if (state.tool === 'select' && state.selected?.domain === 'drawing') {
      feature = state.drawings.find(f => String(f.id) === state.selected.id);
      if (feature) data = getEditableVertices(feature).filter(v => isCoordVisible(v.coord));
    } else if (state.tool === 'select' && state.selected?.domain === 'hydro') {
      feature = hydroEditById(state.selected.id);
      if (feature) data = getEditableVertices(feature).filter(vertex => isCoordVisible(vertex.coord));
    } else if ((state.tool === 'country-coast' && state.coastEditCountryId)
      || (state.tool === 'country-border' && state.boundaryEditPhase === 'editing')) {
      const primaryId = state.tool === 'country-border' ? state.boundaryEditCountryIds[0] : state.coastEditCountryId;
      feature = countryFeatureById(primaryId);
      if (feature) data = thinVisibleCoastHandles(getCountryBoundaryHandles());
    }
    const boundaryMode = (state.tool === 'country-coast' && !!state.coastEditCountryId)
      || (state.tool === 'country-border' && state.boundaryEditPhase === 'editing');
    const selection = vertexLayer.selectAll('circle.vertex-handle').data(data, d => d.nodeKey || d.key || d.index);
    selection.enter().append('circle').attr('class', 'vertex-handle');
    selection.exit().remove();
    const allVertices = vertexLayer.selectAll('circle.vertex-handle');
    allVertices
      .attr('r', boundaryMode ? (isMobile() ? 7.2 : 5.2) : 4.5)
      .classed('country-vertex', boundaryMode)
      .classed('coast-vertex', d => boundaryMode && d.boundaryKind === 'coast')
      .classed('shared-boundary-vertex', d => boundaryMode && d.boundaryKind === 'shared')
      .classed('fixed-boundary-vertex', d => boundaryMode && d.fixed)
      .attr('transform', d => {
        const p = activeProjection()(d.coord);
        return p ? `translate(${p[0]},${p[1]})` : 'translate(-9999,-9999)';
      });
    allVertices.on('.drag', null);
    if (feature && boundaryMode) allVertices.filter(d => !d.fixed).call(countryBoundaryVertexDragBehavior(feature));
    else if (feature) allVertices.call(vertexDragBehavior(feature));
    allVertices.on('click.vertex-select', null);
    allVertices.each(function(d) {
      let title = d3.select(this).select('title');
      if (title.empty()) title = d3.select(this).append('title');
      if (boundaryMode) title.text(d.fixed
        ? '선택 밖 국가와 연결되어 고정된 접경점'
        : d.boundaryKind === 'shared' ? `${d.ownerIds?.length || 2}개 국가가 공유하는 국경 꼭짓점` : '해안선 꼭짓점');
      else title.text('꼭짓점');
    });
  }

  function draftFeature(coordinates = null) {
    const coords = coordinates ? coordinates.map(coordinate => coordinate.slice()) : state.draftCoords.slice();
    if (!coordinates && state.draftHover) coords.push(state.draftHover);
    if (isPolygonDraftTool(state.tool)) {
      if (!coords.length) return null;
      // A GeoJSON polygon is only valid once it has at least three vertices.
      // Until then, draw the draft as a line so D3 never receives an invalid polygon ring.
      if (coords.length < 3) {
        return { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} };
      }
      const ring = coords.slice();
      ring.push(ring[0]);
      return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} };
    }
    if (state.tool === 'new-country' && ['line', 'side'].includes(state.newCountryPhase)) {
      if (!coords.length) return null;
      return { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} };
    }
    if (isLineDraftTool(state.tool) || state.tool === 'annex-territory') {
      if (!coords.length) return null;
      return { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} };
    }
    return null;
  }

  function draftVertexDragBehavior() {
    let moved = false;
    return d3.behavior.drag()
      .on('dragstart', function(vertex) {
        if (!draftInputActive() || state.spacePanActive) return;
        moved = false;
        state.draftEdit.selectedVertexIndex = vertex.index;
        state.draftEdit.inputPhase = 'refine';
        state.draftEdit.insertTarget = null;
        state.draftEdit.dragging = true;
        state.draftEdit.splitPreview = null;
        state.draftHover = null;
        d3.event.sourceEvent?.preventDefault?.();
        d3.event.sourceEvent?.stopPropagation?.();
        renderDraft();
        updateModeButtons();
      })
      .on('drag', function(vertex) {
        if (!draftInputActive() || state.spacePanActive || !state.draftCoords[vertex.index]) return;
        const screenPoint = d3.mouse(svg.node());
        const rawCoordinate = screenToGeo(screenPoint);
        if (!rawCoordinate) return;
        const pointerType = d3.event.sourceEvent?.pointerType === 'touch' || d3.event.sourceEvent?.touches ? 'touch' : 'mouse';
        const coordinate = snapCoordinateForInput(rawCoordinate, screenPoint, pointerType);
        if (!moved) {
          recordDraftSnapshot(state.draftEdit, state.draftCoords, state.draftEdit.selectedVertexIndex, MAX_HISTORY);
          state.draftEdit.inputPhase = 'refine';
          moved = true;
        }
        state.draftCoords = moveDraftVertex(state.draftCoords, vertex.index, coordinate);
        state.draftEdit.revision += 1;
        refreshDraftDerivedState({ buildPreview: false });
        renderDraft();
        updateModeButtons();
        updateHistoryButtons();
      })
      .on('dragend', function() {
        if (!state.draftEdit.dragging) return;
        state.draftEdit.dragging = false;
        const sourceEvent = d3.event.sourceEvent;
        if (moved) {
          refreshDraftDerivedState({ buildPreview: true });
          if (Number.isFinite(sourceEvent?.clientX) && Number.isFinite(sourceEvent?.clientY)) {
            suppressNextMapClick([sourceEvent.clientX, sourceEvent.clientY], 700);
          } else {
            suppressNextMapClick(null, 700);
          }
        }
        renderDraft();
        clearActiveSnap();
        updateModeButtons();
        updateHistoryButtons();
        sourceEvent?.preventDefault?.();
        sourceEvent?.stopPropagation?.();
      });
  }

  function draftSegmentRows(displayCoords) {
    const rows = [];
    for (let index = 0; index < displayCoords.length - 1; index += 1) {
      rows.push({ segmentIndex: index, start: displayCoords[index], end: displayCoords[index + 1] });
    }
    if (isPolygonDraftTool(state.tool) && displayCoords.length >= 3) {
      rows.push({ segmentIndex: displayCoords.length - 1, start: displayCoords[displayCoords.length - 1], end: displayCoords[0] });
    }
    return rows.filter(row => {
      const start = activeProjection()(row.start);
      const end = activeProjection()(row.end);
      return start && end && Math.hypot(end[0] - start[0], end[1] - start[1]) <= Math.max(1, state.size.width * 0.7);
    });
  }

  function draftInsertCoordinate(row, screenPoint = d3.mouse(svg.node())) {
    const start = activeProjection()(row.start);
    const end = activeProjection()(row.end);
    if (!start || !end) return null;
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const length2 = dx * dx + dy * dy;
    if (length2 <= 1e-6) return null;
    const t = clamp(((screenPoint[0] - start[0]) * dx + (screenPoint[1] - start[1]) * dy) / length2, 0.08, 0.92);
    return screenToGeo([start[0] + dx * t, start[1] + dy * t]);
  }

  function showDraftInsertTarget(row, screenPoint) {
    const coordinate = draftInsertCoordinate(row, screenPoint);
    if (!coordinate) return;
    state.draftEdit.insertTarget = { segmentIndex: row.segmentIndex, coordinate };
    renderDraftInsertionHandle();
  }

  function renderDraftInsertionHandle() {
    if (!draftLayer) return;
    const target = state.draftEdit.insertTarget;
    const data = target?.coordinate && isCoordVisible(target.coordinate) && draftInputActive() && !state.spacePanActive ? [target] : [];
    const selection = draftLayer.selectAll('g.draft-insert-handle').data(data, item => item.segmentIndex);
    const enter = selection.enter().append('g').attr('class', 'draft-insert-handle draft-interactive');
    enter.append('circle').attr('class', 'draft-insert-hit').attr('r', isMobile() ? 18 : 13);
    enter.append('circle').attr('class', 'draft-insert-dot').attr('r', isMobile() ? 9 : 7);
    enter.append('path').attr('class', 'draft-insert-plus').attr('d', 'M-3.5 0h7M0-3.5v7');
    selection.exit().remove();
    draftLayer.selectAll('g.draft-insert-handle')
      .attr('transform', item => {
        const point = activeProjection()(item.coordinate);
        return point ? `translate(${point[0]},${point[1]})` : 'translate(-9999,-9999)';
      })
      .on('click', function() {
        d3.event.preventDefault();
        d3.event.stopPropagation();
        insertDraftPoint();
      });
  }

  function defaultDraftInstruction() {
    if (state.draftEdit.inputPhase === 'refine' && state.draftCoords.length) {
      return '꼭짓점을 드래그해 미세조정한 뒤 완료하세요.';
    }
    const inputHint = isMobile() ? '한 손가락으로 그리세요.' : '드래그하거나 클릭해 그리세요.';
    const hydro = hydroToolConfig(state.tool);
    if (hydro) return `${hydro.label}의 ${isPolygonDraftTool(state.tool) ? '경계를' : '흐름을'} 따라 ${inputHint}`;
    if (state.tool === 'split-drawing') {
      return '영역을 가로질러 경계를 그리세요.';
    }
    if (state.tool === 'split-territorial-unit') {
      return '영역을 가로질러 경계를 그리세요.';
    }
    if (state.tool === 'redraw-territorial-unit') return '부모 영역 안에 새 영역을 그리세요.';
    if (state.tool === 'draw-territorial-unit') return '추가할 영역을 그리세요.';
    if (state.tool === 'annex-territory' && state.annexPhase === 'polygon') return '편입할 영역을 지도에서 지정하세요.';
    if ((state.tool === 'new-country' && state.newCountryPhase === 'line') || (state.tool === 'annex-territory' && state.annexPhase === 'line')) {
      return '선택한 영토를 가로질러 새 경계를 완성하세요.';
    }
    if (state.distributionDraft && isPolygonDraftTool(state.tool)) return '분포 영역을 지도에서 지정하세요.';
    return inputHint;
  }

  function syncGenericDraftFeedback() {
    if (!draftInputActive() || activeCutDraftSourceGeometry()) return;
    const issue = state.draftEdit.issues[0];
    setModeBanner(issue?.message || defaultDraftInstruction());
    if (issue) $('modeTaskInstruction')?.classList.add('cut-invalid');
  }

  function renderRiverPartitionEmphasis() {
    if (!draftLayer || state.tool !== 'annex-territory' || state.annexPhase !== 'river-partitions') return;
    const selected = new Set(state.annexSelectedRiverPartitionKeys);
    for (const candidate of state.annexRiverPartitionCandidates || []) for (const section of candidate.riverBoundarySegments || []) {
      if (!Array.isArray(section) || section.length < 2) continue;
      draftLayer.append('path')
        .datum(featureFromGeometry({ type: 'LineString', coordinates: section }))
        .attr('class', `river-partition-emphasis${selected.has(candidate.key) ? ' selected' : ''}`)
        .attr('d', path)
        .attr('stroke', SELECTION_STYLE.color)
        .attr('stroke-width', SELECTION_STYLE.primaryWidth)
        .attr('stroke-opacity', selected.has(candidate.key) ? SELECTION_STYLE.primaryAlpha : SELECTION_STYLE.secondaryAlpha);
    }
  }

  function renderDraft() {
    draftLayer.selectAll('*').remove();
    const annexSide = state.tool === 'annex-territory' && ['side', 'polygon-preview'].includes(state.annexPhase);
    const annexRiverPartitions = state.tool === 'annex-territory' && state.annexPhase === 'river-partitions';
    const newCountrySide = state.tool === 'new-country' && state.newCountryPhase === 'side';
    const annexComponents = state.tool === 'annex-territory' && state.annexPhase === 'components';
    const newCountryComponents = state.tool === 'new-country' && state.newCountryPhase === 'components';
    if (annexComponents || newCountryComponents) {
      const components = territoryComponentItems().map(item => ({
        type: 'Feature', geometry: item.geometry,
        properties: { key: item.key, selected: item.selected, countryName: item.countryName, areaKm2: item.areaKm2 },
      }));
      const componentPaths = draftLayer.selectAll('path.territory-component').data(components, d => d.properties.key).enter().append('path')
        .attr('class', d => `territory-component ${d.properties.selected ? 'selected-component' : 'available'}`)
        .attr('d', path)
        .on('click', function(d) {
          if (mapClickBlocked()) return;
          d3.event.preventDefault();
          d3.event.stopPropagation();
          toggleTerritoryComponentSelection(d.properties.key);
        });
      componentPaths.append('title').text(d => `${d.properties.countryName} · ${formatTerritoryArea(d.properties.areaKm2)} · 선택하여 ${d.properties.selected ? '해제' : '추가'}`);
    }
    if (annexSide || newCountrySide) {
      const sourceCandidates = annexSide ? state.annexCandidates : state.newCountryCandidates;
      const selectedIndex = annexSide ? state.annexSelectedCandidateIndex : state.newCountrySelectedCandidateIndex;
      const candidates = sourceCandidates.map((candidate, index) => ({
        type: 'Feature', geometry: candidate.geometry, properties: { index, selected: index === selectedIndex },
      }));
      draftLayer.selectAll('path.annex-candidate').data(candidates).enter().append('path')
        .attr('class', d => `annex-candidate ${d.properties.index === 0 ? 'side-a' : 'side-b'} ${d.properties.selected ? 'selected-candidate' : 'alternate-candidate'}`)
        .attr('d', path)
        .on('click', function(d) {
          if (mapClickBlocked()) return;
          d3.event.preventDefault();
          d3.event.stopPropagation();
          selectTerritoryCandidate(d.properties.index);
        });
    }
    if (annexRiverPartitions) {
      const selected = new Set(state.annexSelectedRiverPartitionKeys);
      const candidates = state.annexRiverPartitionCandidates.map(candidate => ({
        type: 'Feature', geometry: candidate.geometry,
        properties: {
          key: candidate.key,
          selected: selected.has(candidate.key),
          hovered: state.annexHoveredRiverPartitionKey === candidate.key,
          riverBoundarySegments: candidate.riverBoundarySegments || [],
        },
      }));
      const candidatePaths = draftLayer.selectAll('path.annex-candidate.river-partition').data(candidates, item => item.properties.key).enter().append('path')
        .attr('class', item => `annex-candidate river-partition ${item.properties.selected ? 'selected-candidate' : 'alternate-candidate'}${item.properties.hovered && !item.properties.selected ? ' hovered-candidate' : ''}`)
        .attr('d', path)
        .on('mouseenter', function(item) {
          if (state.annexHoveredRiverPartitionKey === item.properties.key) return;
          state.annexHoveredRiverPartitionKey = item.properties.key;
          renderDraft();
        })
        .on('mouseleave', function(item) {
          if (state.annexHoveredRiverPartitionKey !== item.properties.key) return;
          state.annexHoveredRiverPartitionKey = null;
          renderDraft();
        })
        .on('click', function(item) {
          if (mapClickBlocked()) return;
          d3.event.preventDefault();
          d3.event.stopPropagation();
          const dividerDistance = projectedLineDistance({
            type: 'MultiLineString',
            coordinates: item.properties.riverBoundarySegments,
          }, d3.mouse(svg.node()));
          if (dividerDistance <= (isMobile() ? 14 : 8)) {
            setActionStatus('영역 안쪽을 클릭하세요.', 'ready', 2200);
            return;
          }
          toggleRiverPartitionCandidate(item.properties.key);
        });
      candidatePaths.append('title').text(item => `편입 후보 · ${item.properties.selected ? '선택 해제' : '선택 추가'}`);
      if (state.annexRiverPartitionPreviewGeometry) {
        draftLayer.append('path')
          .datum(featureFromGeometry(state.annexRiverPartitionPreviewGeometry))
          .attr('class', 'annex-transfer-preview')
          .attr('d', path);
      }
    }
    if (state.draftStroke.active) {
      const rawCoords = state.draftCoords.map(coordinate => coordinate.slice());
      for (const sample of state.draftStroke.samples) {
        if (rawCoords.length && coordNear(rawCoords[rawCoords.length - 1], sample.coordinate, 1e-9)) continue;
        rawCoords.push(sample.coordinate.slice());
      }
      if (rawCoords.length) {
        const geometry = rawCoords.length === 1
          ? { type: 'Point', coordinates: rawCoords[0] }
          : { type: 'LineString', coordinates: rawCoords };
        draftLayer.append('path')
          .datum({ type: 'Feature', properties: {}, geometry })
          .attr('class', 'draft-shape draft-raw-stroke')
          .attr('d', path);
        if (isPolygonDraftTool(state.tool) && rawCoords.length >= 3) {
          draftLayer.append('path')
            .datum({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [rawCoords[rawCoords.length - 1], rawCoords[0]] } })
            .attr('class', 'draft-auto-close-preview')
            .attr('d', path);
        }
      }
      renderRiverPartitionEmphasis();
      return;
    }
    const cutSourceGeometry = activeCutDraftSourceGeometry();
    const rawCutLine = cutSourceGeometry
      ? [...state.draftCoords, ...(state.draftHover ? [state.draftHover] : [])]
      : null;
    const cutAssessment = cutSourceGeometry ? assessCutDraft(rawCutLine, cutSourceGeometry) : null;
    if (cutAssessment && !state.draftHover) {
      state.draftCutAssessment = cutAssessment;
      state.draftEdit.issues = cutAssessment.issues || [];
      const primary = $('modePrimaryBtn');
      if (primary) primary.disabled = !cutAssessment.valid;
    } else if (!cutSourceGeometry) {
      state.draftCutAssessment = null;
    }
    syncCutDraftFeedback(cutAssessment, !!state.draftHover);
    if (!cutSourceGeometry && !state.draftHover) syncGenericDraftFeedback();
    const splitPreview = draftInputActive() && !state.draftHover && !state.draftEdit.dragging && state.draftEdit.splitPreview?.revision === state.draftEdit.revision
      ? state.draftEdit.splitPreview.candidates
      : [];
    draftLayer.selectAll('path.draft-split-preview').data(splitPreview, (_, index) => index).enter().append('path')
      .attr('class', (_, index) => `draft-split-preview side-${index === 0 ? 'a' : 'b'}`)
      .attr('d', candidate => path({ type: 'Feature', properties: {}, geometry: candidate.geometry }));
    const feature = draftFeature(cutAssessment?.line || null);
    if (feature && (feature.geometry.coordinates?.length || feature.geometry.coordinates?.[0]?.length)) {
      draftLayer.append('path').datum(feature)
        .attr('class', [
          'draft-shape',
          state.tool === 'annex-territory' ? 'annex-draft' : '',
          cutAssessment ? `cut-${cutAssessment.status}` : '',
          !cutAssessment && state.draftEdit.issues.length ? 'draft-invalid' : '',
        ].filter(Boolean).join(' '))
        .attr('d', path);
    }
    if (isPolygonDraftTool(state.tool) && state.draftCoords.length >= 3) {
      draftLayer.append('path')
        .datum({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: [state.draftCoords[state.draftCoords.length - 1], state.draftCoords[0]] },
        })
        .attr('class', 'draft-auto-close-preview')
        .attr('d', path);
    }
    const fixedDisplayCoords = cutSourceGeometry && cutAssessment?.line?.length === state.draftCoords.length
      ? cutAssessment.line
      : state.draftCoords;
    const segmentRows = draftSegmentRows(fixedDisplayCoords);
    const segmentHits = draftLayer.selectAll('path.draft-segment-hit').data(segmentRows, row => row.segmentIndex).enter().append('path')
      .attr('class', 'draft-segment-hit draft-interactive')
      .attr('d', row => path({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [row.start, row.end] } }))
      .on('mousemove', function(row) {
        if (isMobile() || state.spacePanActive || state.draftEdit.dragging) return;
        showDraftInsertTarget(row, d3.mouse(svg.node()));
      })
      .on('click', function(row) {
        if (state.spacePanActive || state.draftEdit.dragging) return;
        d3.event.preventDefault();
        d3.event.stopPropagation();
        showDraftInsertTarget(row, d3.mouse(svg.node()));
      });
    segmentHits.append('title').text('선분에 꼭짓점 삽입');
    const visible = fixedDisplayCoords.map((coord, index) => ({ coord, index })).filter(item => isCoordVisible(item.coord));
    const vertices = draftLayer.selectAll('g.draft-vertex').data(visible, item => item.index).enter().append('g')
      .attr('class', item => `draft-vertex draft-interactive${item.index === state.draftEdit.selectedVertexIndex ? ' selected' : ''}`)
      .attr('transform', item => {
        const point = activeProjection()(item.coord);
        return point ? `translate(${point[0]},${point[1]})` : 'translate(-9999,-9999)';
      })
      .on('click', function(item) {
        if (mapClickBlocked() || state.spacePanActive) return;
        d3.event.preventDefault();
        d3.event.stopPropagation();
        state.draftEdit.selectedVertexIndex = item.index;
        state.draftEdit.inputPhase = 'refine';
        state.draftEdit.insertTarget = null;
        renderDraft();
        updateModeButtons();
      });
    vertices.append('circle').attr('class', 'draft-vertex-hit').attr('r', isMobile() ? 16 : 10);
    vertices.append('circle').attr('class', 'draft-vertex-dot').attr('r', isMobile() ? 6.5 : 4.5);
    vertices.append('title').text(item => `꼭짓점 ${item.index + 1} · 드래그하여 이동`);
    vertices.call(draftVertexDragBehavior());
    renderDraftInsertionHandle();
    const issueData = (!state.draftHover ? state.draftEdit.issues : cutAssessment?.issues || []).filter(issue => issue.coordinate && isCoordVisible(issue.coordinate));
    const issueMarkers = draftLayer.selectAll('g.draft-issue-marker').data(issueData, (issue, index) => `${issue.kind}-${issue.vertexIndex ?? issue.segmentIndex ?? index}`).enter().append('g')
      .attr('class', 'draft-issue-marker')
      .attr('transform', issue => {
        const point = activeProjection()(issue.coordinate);
        return point ? `translate(${point[0]},${point[1]})` : 'translate(-9999,-9999)';
      });
    issueMarkers.append('circle').attr('r', 7);
    issueMarkers.append('path').attr('d', 'M-3.2-3.2 3.2 3.2M3.2-3.2-3.2 3.2');
    issueMarkers.append('title').text(issue => issue.message || '수정이 필요한 위치');
    const snapPoints = cutAssessment
      ? Object.entries(cutAssessment.snaps).filter(([, snap]) => snap?.coordinate).map(([endpoint, snap]) => ({ endpoint, ...snap }))
      : [];
    draftLayer.selectAll('circle.draft-snap-point').data(snapPoints, snap => snap.endpoint).enter().append('circle')
      .attr('class', snap => `draft-snap-point ${snap.endpoint}`)
      .attr('r', 6)
      .attr('transform', snap => {
        const point = activeProjection()(snap.coordinate);
        return point ? `translate(${point[0]},${point[1]})` : 'translate(-9999,-9999)';
      });
    renderRiverPartitionEmphasis();
  }

  function selectTerritoryCandidate(candidateIndex) {
    const index = Number(candidateIndex);
    if (state.tool === 'annex-territory' && state.annexPhase === 'side' && state.annexCandidates[index]?.geometry) {
      state.annexSelectedCandidateIndex = index;
      setModeBanner('편입할 영역을 선택하세요.', 'annex-mode');
    } else if (state.tool === 'new-country' && state.newCountryPhase === 'side' && state.newCountryCandidates[index]?.geometry) {
      state.newCountrySelectedCandidateIndex = index;
      setModeBanner('신생국으로 만들 영역을 선택하세요.', 'add-country-mode');
    } else {
      return;
    }
    renderDraft();
    updateModeButtons();
  }

  function updateTerritoryComponentSelectionFeedback() {
    if (state.tool === 'annex-territory' && state.annexPhase === 'components') {
      setModeBanner('편입할 영토 조각을 클릭해 선택하세요.');
    } else if (state.tool === 'new-country' && state.newCountryPhase === 'components') {
      setModeBanner('새 국가로 만들 영토 조각을 클릭해 선택하세요.');
    }
  }

  function toggleTerritoryComponentSelection(componentKey) {
    const available = new Set(territoryComponentItems().map(item => item.key));
    if (!available.has(componentKey)) return;
    let selected;
    if (state.tool === 'annex-territory' && state.annexPhase === 'components') {
      selected = new Set(state.annexSelectedComponentKeys);
      if (selected.has(componentKey)) selected.delete(componentKey); else selected.add(componentKey);
      state.annexSelectedComponentKeys = [...selected];
    } else if (state.tool === 'new-country' && state.newCountryPhase === 'components') {
      selected = new Set(state.newCountrySelectedComponentKeys);
      if (selected.has(componentKey)) selected.delete(componentKey); else selected.add(componentKey);
      state.newCountrySelectedComponentKeys = [...selected];
    } else {
      return;
    }
    updateTerritoryComponentSelectionFeedback();
    renderDraft();
    updateModeButtons();
  }

  function renderBase() {
    baseSvg.classed('flat-projection', state.projection !== 'globe');
    shadowLayer.datum({ type: 'Sphere' }).attr('d', path);
    oceanLayer.datum({ type: 'Sphere' }).attr('d', path);
    graticuleLayer.datum(graticule()).attr('d', path);
  }

  function featureFromGeometry(geometry, properties = {}) {
    return geometry ? { type: 'Feature', properties, geometry } : null;
  }

  function mapFeatureForObjectRef(value) {
    const ref = normalizeObjectRef(value);
    if (!ref) return null;
    if (ref.domain === 'territorial') return ref.type === TERRITORIAL_UNIT_TYPES.COUNTRY ? countryFeatureById(ref.id) : territorialUnitById(ref.id);
    if (ref.domain === 'drawing') {
      const drawing = state.drawings.find(feature => String(feature.id) === ref.id) || null;
      return drawing ? drawingDisplayFeature(drawing) : null;
    }
    if (ref.domain === 'hydro') return hydroFeatureById(ref.id);
    if (ref.domain === 'distribution') {
      const features = distributionEntriesForLayer(state.distributionEntries, ref.id).map(entry => {
        const geometry = entry.mode === DISTRIBUTION_MODES.TERRITORIAL ? territorialRepository.get(entry.territorialUnitId)?.geometry : entry.geometry;
        return geometry ? featureFromGeometry(geometry) : null;
      }).filter(Boolean);
      return features.length ? { type: 'FeatureCollection', features } : null;
    }
    return null;
  }

  function geometryPreviewIssueClass(kind = '') {
    if (kind === 'overlap') return 'issue-overlap';
    if (kind === 'gap' || kind === 'shared-boundary-gap') return 'issue-gap';
    if (['invalid-sovereign', 'orphan-administrative', 'outside-parent', 'missing-territorial-reference', 'duplicate-id'].includes(kind)) return 'issue-relation';
    return 'issue-invalid';
  }

  function renderGeometryPreview() {
    if (!previewLayer) return;
    previewLayer.selectAll('*').remove();
    const session = state.geometryPreview.session;
    if (!session || session.status === 'discarded' || session.status === 'committed') return;
    const delta = session.delta || {};
    const shapes = [
      ['geometry-preview-remove', delta.removedGeometry],
      ['geometry-preview-add', delta.addedGeometry],
    ];
    for (const [className, geometry] of shapes) {
      if (!geometry) continue;
      const feature = featureFromGeometry(geometry);
      if (hasAreaGeometry(feature)) {
        previewLayer.append('path').datum(feature).attr('class', `${className} geometry-preview-fill`).attr('d', path);
      }
      const outline = buildRenderableStrokeFeature(feature);
      if (outline.geometry.coordinates.length) {
        previewLayer.append('path').datum(outline).attr('class', `${className} geometry-preview-outline`).attr('d', path);
      }
    }
    for (const geometry of delta.oldBoundaries || []) {
      previewLayer.append('path').datum(buildRenderableStrokeFeature(featureFromGeometry(geometry))).attr('class', 'geometry-preview-old-boundary').attr('d', path);
    }
    for (const geometry of delta.newBoundaries || []) {
      previewLayer.append('path').datum(buildRenderableStrokeFeature(featureFromGeometry(geometry))).attr('class', 'geometry-preview-new-boundary').attr('d', path);
    }
  }

  function setLimitedSelectionCache(cache, key, value, limit = 160) {
    if (cache.has(key)) cache.delete(key);
    cache.set(key, value);
    while (cache.size > limit) cache.delete(cache.keys().next().value);
    return value;
  }

  function selectionGeometryRevision(key, role = 'outline') {
    return `${key}:${role}:${state.stateRevision}:${countryLandRevision}`;
  }

  function cachedSelectionBoundaryFeature(key, feature, role = 'outline') {
    const revision = selectionGeometryRevision(key, role);
    const cached = selectionBoundaryGeometryCache.get(revision);
    if (cached) {
      selectionOverlayDiagnostics.geometryCacheHits += 1;
      selectionBoundaryGeometryCache.delete(revision);
      selectionBoundaryGeometryCache.set(revision, cached);
      return { feature: cached, revision };
    }
    selectionOverlayDiagnostics.geometryCacheMisses += 1;
    const boundary = buildRenderableStrokeFeature(feature);
    return { feature: setLimitedSelectionCache(selectionBoundaryGeometryCache, revision, boundary), revision };
  }

  function cachedSelectionPath(cacheKey, feature) {
    const key = `${cacheKey}:${state.projection}:${viewRevision}`;
    if (selectionProjectedPathCache.has(key)) {
      selectionOverlayDiagnostics.projectedPathCacheHits += 1;
      return selectionProjectedPathCache.get(key);
    }
    selectionOverlayDiagnostics.projectedPathCacheMisses += 1;
    return setLimitedSelectionCache(selectionProjectedPathCache, key, path(feature), 96);
  }

  function invalidateSelectionOverlay(reason = 'selection-overlay') {
    syncGpuCountryEmphasis();
    return mapRenderCoordinator?.invalidate(
      MAP_RENDER_DIRTY.SELECTION_DATA | MAP_RENDER_DIRTY.GPU_FRAME,
      reason,
    ) || false;
  }

  function renderHoverOverlay(viewState = null, { syncStrokes = true } = {}) {
    if (!syncStrokes) return false;
    if (viewState) return renderSelectionOverlay(viewState);
    return invalidateSelectionOverlay('hover-overlay');
  }

  function setMapHover(type, id, feature, ref = null) {
    if (isMobile() || state.tool !== 'select' || state.mapMoving) return;
    const nextId = `${type}:${String(id || '')}`;
    if (`${state.hovered?.type || ''}:${state.hovered?.id || ''}` === nextId) return;
    state.hovered = feature?.geometry ? { type, id: String(id || ''), feature, ref: normalizeObjectRef(ref) } : null;
    invalidateSelectionOverlay('map-hover');
  }

  function syncGpuCountryEmphasis() {
    if (!gpuMapRenderer?.setCountryEmphasis) return;
    const selection = objectSelection.snapshot();
    const countryIds = selection.items
      .filter(ref => ref.domain === 'territorial' && ref.type === TERRITORIAL_UNIT_TYPES.COUNTRY)
      .map(ref => ref.id);
    const primary = selection.items.find(ref => ref.key === selection.primaryKey);
    const hoveredCountryId = !isMobile()
      && state.hovered?.type === 'country'
      && !(state.hovered.ref && objectSelection.has(state.hovered.ref))
      ? String(state.hovered.id || '')
      : '';
    gpuMapRenderer.setCountryEmphasis({
      primaryId: primary?.domain === 'territorial' && primary.type === TERRITORIAL_UNIT_TYPES.COUNTRY ? primary.id : '',
      hoverId: hoveredCountryId,
      selectedIds: countryIds,
    });
  }

  function renderSelectionOverlayFrame(viewState = null, { updateData = true } = {}) {
    if (!selectionLayer) return false;
    selectionOverlayStage = 'selection-data-prepare';
    const selectionTarget = selectionLayer.node();
    const hoverTarget = hoverLayer?.node?.();
    const selectionStageNode = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const hoverStageNode = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const stagedSelectionLayer = d3.select(selectionStageNode);
    const stagedHoverLayer = d3.select(hoverStageNode);
    syncGpuCountryEmphasis();
    let pathCount = 0;
    let pathCharacterCount = 0;
    let boundarySegmentCount = 0;
    const svgFallbackKeys = [];
    const selection = objectSelection.snapshot();
    const genericPrimary = [];
    const genericSecondary = [];
    const genericHover = [];
    const fallbackRequests = { hover: [], primary: [], secondary: [] };
    let countryPrimaryId = '';
    const countrySecondaryIds = [];
    let countryHoverId = '';
    const genericGpuAvailable = !!selectionEmphasisRenderer?.isAvailable?.();
    const selectionOutlinesVisible = resolvedInteractionStyle.selection.outlineVisible !== false;
    const hoverActive = !isMobile() && state.hovered?.feature?.geometry && !state.mapMoving && !state.draftEdit.dragging
      && !(state.hovered.ref && objectSelection.has(state.hovered.ref));
    if (hoverActive) {
      const isCountry = state.hovered.type === 'country';
      const feature = isCountry ? countryDisplayFeature(state.hovered.feature) : state.hovered.feature;
      const key = isCountry
        ? `country:${String(state.hovered.id || '')}`
        : `hover:${state.hovered.type}:${state.hovered.id}`;
      const pendingCountry = isCountry && state.pendingCountryRenderIds?.has(String(state.hovered.id || ''));
      if ((!isCountry || pendingCountry) && ['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)) {
        stagedHoverLayer.append('path').datum(feature)
          .attr('class', 'map-hover-shape map-hover-fill')
          .attr('fill', resolvedInteractionStyle.hover.color)
          .attr('fill-opacity', resolvedInteractionStyle.hover.fillAlpha)
          .attr('d', path);
      }
      const boundary = !isCountry && ['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)
        ? cachedSelectionBoundaryFeature(key, feature, 'hover')
        : { feature, revision: selectionGeometryRevision(key, 'hover') };
      const boundaryFeature = boundary.feature;
      fallbackRequests.hover.push(isCountry
        ? { key, resolveFeature: () => countryOutlineFeature(feature), cacheKey: selectionGeometryRevision(key, 'hover-country') }
        : { key, feature: boundaryFeature, cacheKey: boundary.revision });
      if (isCountry) {
        if (!state.pendingCountryRenderIds?.has(String(state.hovered.id || ''))) countryHoverId = String(state.hovered.id || '');
      } else {
        genericHover.push({ key, geometry: boundaryFeature, geometryRevision: boundary.revision });
      }
    }
    for (const ref of selection.items) {
      const primary = selection.primaryKey === ref.key;
      const canonicalFeature = mapFeatureForObjectRef(ref);
      const isCountry = ref.domain === 'territorial' && ref.type === TERRITORIAL_UNIT_TYPES.COUNTRY;
      const feature = isCountry
        ? countryDisplayFeature(canonicalFeature)
        : canonicalFeature;
      if (!feature?.geometry && feature?.type !== 'FeatureCollection') continue;
      const geometries = feature.type === 'FeatureCollection'
        ? (feature.features || []).map(item => item.geometry)
        : [feature.geometry];
      const hasBoundaryGeometry = geometries.some(geometry => ['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString'].includes(geometry?.type));
      if (isCountry) {
        const pendingCountry = state.pendingCountryRenderIds?.has(String(ref.id));
        const style = primary ? resolvedInteractionStyle.selection.primary : resolvedInteractionStyle.selection.secondary;
        if (pendingCountry) {
          const priorityClass = primary ? ' is-primary' : ' is-secondary';
          if (style.fillAlpha > 0) stagedSelectionLayer.append('path').datum(feature)
            .attr('class', `map-selection-shape map-selection-fill${priorityClass}`)
            .attr('fill', resolvedInteractionStyle.selection.color).attr('fill-opacity', style.fillAlpha).attr('stroke', 'none').attr('d', path);
        }
        if (selectionOutlinesVisible) {
          const channel = primary ? 'primary' : 'secondary';
          const key = `country:${ref.id}`;
          fallbackRequests[channel].push({ key, resolveFeature: () => countryOutlineFeature(feature), cacheKey: selectionGeometryRevision(key, 'country-outline') });
          if (!pendingCountry) {
            if (primary) countryPrimaryId = ref.id;
            else countrySecondaryIds.push(ref.id);
          }
        }
        continue;
      }
      if (hasBoundaryGeometry && geometries.some(geometry => ['Polygon', 'MultiPolygon'].includes(geometry?.type))) {
        const fillAlpha = primary
          ? resolvedInteractionStyle.selection.primary.fillAlpha
          : resolvedInteractionStyle.selection.secondary.fillAlpha;
        if (fillAlpha > 0) stagedSelectionLayer.append('path').datum(feature)
          .attr('class', `map-selection-shape map-selection-fill${primary ? ' is-primary' : ' is-secondary'}`)
          .attr('fill', resolvedInteractionStyle.selection.color)
          .attr('fill-opacity', fillAlpha)
          .attr('stroke', 'none')
          .attr('d', path);
      }
      const boundary = hasBoundaryGeometry && geometries.some(geometry => ['Polygon', 'MultiPolygon'].includes(geometry?.type))
        ? cachedSelectionBoundaryFeature(ref.key, feature, 'selection-outline')
        : { feature, revision: selectionGeometryRevision(ref.key, 'selection-outline') };
      const boundaryFeature = boundary.feature;
      if (selectionOutlinesVisible) {
        const channel = primary ? 'primary' : 'secondary';
        fallbackRequests[channel].push({ key: ref.key, feature: boundaryFeature, cacheKey: boundary.revision });
        if (genericGpuAvailable && hasBoundaryGeometry) {
          (primary ? genericPrimary : genericSecondary).push({ key: ref.key, geometry: boundaryFeature, geometryRevision: boundary.revision });
        }
      }
    }
    let gpuSelectionStats = null;
    let gpuRenderResult = null;
    if (genericGpuAvailable) {
      if (updateData) {
        selectionEmphasisRenderer.setCountryBoundaryMesh(gpuMapRenderer.getCountryInteractionBoundaryData?.());
        selectionOverlayStage = 'selection-buffer-build';
        selectionEmphasisRenderer.updateSelectionData({
          hover: genericHover,
          primary: genericPrimary,
          secondary: genericSecondary,
          countryHoverId,
          countryPrimaryId,
          countrySecondaryIds,
          revision: state.stateRevision,
        });
      }
      selectionOverlayStage = 'selection-gpu-render';
      gpuRenderResult = selectionEmphasisRenderer.render(viewState || window.__PANDOLAB_VIEW_STATE__ || {});
      gpuSelectionStats = selectionEmphasisRenderer.stats();
      boundarySegmentCount = gpuSelectionStats.segmentCount;
    }
    if (!gpuSelectionStats) gpuSelectionStats = selectionEmphasisRenderer?.stats?.() || null;
    const renderedKeys = {
      hover: new Set(gpuRenderResult?.channels?.hover?.renderedKeys || []),
      primary: new Set(gpuRenderResult?.channels?.primary?.renderedKeys || []),
      secondary: new Set(gpuRenderResult?.channels?.secondary?.renderedKeys || []),
    };
    selectionOverlayStage = 'selection-fallback-path';
    const fallbackStartedAt = performance.now();
    const countFallbackSegments = feature => {
      try { return buildSelectionBoundarySegments(feature?.geometry).length; }
      catch (_) { return 0; }
    };
    for (const request of fallbackRequests.hover) {
      if (renderedKeys.hover.has(request.key)) continue;
      const fallbackFeature = request.feature || request.resolveFeature?.();
      const d = cachedSelectionPath(request.cacheKey || request.key, fallbackFeature);
      if (!d) continue;
      stagedHoverLayer.append('path').datum(fallbackFeature)
        .attr('class', 'map-hover-shape map-hover-outline')
        .attr('fill', 'none')
        .attr('stroke', resolvedInteractionStyle.hover.color)
        .attr('stroke-width', resolvedInteractionStyle.hover.width)
        .attr('stroke-opacity', resolvedInteractionStyle.hover.alpha)
        .attr('d', d);
      svgFallbackKeys.push(request.key);
      boundarySegmentCount += countFallbackSegments(fallbackFeature);
    }
    if (selectionOutlinesVisible) {
      for (const channel of ['secondary', 'primary']) {
        const primary = channel === 'primary';
        const style = primary ? resolvedInteractionStyle.selection.primary : resolvedInteractionStyle.selection.secondary;
        const priorityClass = primary ? ' is-primary' : ' is-secondary';
        for (const request of fallbackRequests[channel]) {
          if (renderedKeys[channel].has(request.key)) continue;
          const fallbackFeature = request.feature || request.resolveFeature?.();
          const d = cachedSelectionPath(request.cacheKey || request.key, fallbackFeature);
          if (!d) continue;
          stagedSelectionLayer.append('path').datum(fallbackFeature).attr('class', `map-selection-shape map-selection-casing${priorityClass}`)
            .attr('fill', 'none').attr('stroke', resolvedInteractionStyle.selection.casingColor)
            .attr('stroke-width', style.outerWidth).attr('stroke-opacity', style.casingAlpha).attr('d', d);
          stagedSelectionLayer.append('path').datum(fallbackFeature).attr('class', `map-selection-shape map-selection-outline${priorityClass}`)
            .attr('fill', 'none').attr('stroke', resolvedInteractionStyle.selection.color)
            .attr('stroke-width', style.innerWidth).attr('stroke-opacity', style.innerAlpha).attr('d', d);
          pathCount += 2;
          pathCharacterCount += d.length * 2;
          svgFallbackKeys.push(request.key);
          boundarySegmentCount += countFallbackSegments(fallbackFeature);
        }
      }
    }
    for (const selector of [
      '.map-selection-casing.is-secondary', '.map-selection-outline.is-secondary',
      '.map-selection-casing.is-primary', '.map-selection-outline.is-primary',
    ]) stagedSelectionLayer.selectAll(selector).each(function() { this.parentNode?.appendChild(this); });
    const fallbackPathMs = performance.now() - fallbackStartedAt;
    selectionOverlayStage = 'selection-frame-commit';
    selectionTarget?.replaceChildren(...selectionStageNode.childNodes);
    hoverTarget?.replaceChildren(...hoverStageNode.childNodes);
    selectionOverlayDiagnostics.retainedPreviousFrame = false;
    selectionOverlayDiagnostics.fallbackCount = new Set(svgFallbackKeys).size;
    selectionOverlayDiagnostics.fallbackPathMs = fallbackPathMs;
    window.__PANDOLAB_SELECTION_RENDER_METRICS__ = {
      pathCount,
      pathCharacterCount,
      selectionBoundarySegmentCount: boundarySegmentCount,
      viewRevision,
      boundaryOwner: svgFallbackKeys.length ? 'hybrid' : 'interaction-overlay',
      svgFallbackKeys: [...new Set(svgFallbackKeys)],
      fallbackCount: selectionOverlayDiagnostics.fallbackCount,
      fallbackPathMs,
      renderSucceeded: gpuRenderResult?.succeeded ?? !genericGpuAvailable,
      contextLost: gpuSelectionStats?.contextLost || false,
      retainedPreviousFrame: false,
      gpuCoverage: gpuRenderResult?.channels || null,
      channelBufferMetrics: gpuSelectionStats?.channels || null,
      drawOrder: resolvedInteractionStyle.drawOrder,
    };
    selectionOverlayStage = '';
    return true;
  }

  function renderSelectionOverlay(viewState = null, options = {}) {
    try {
      return renderSelectionOverlayFrame(viewState, options);
    } catch (error) {
      selectionOverlayDiagnostics.failureCount += 1;
      selectionOverlayDiagnostics.lastFailureStage = selectionOverlayStage || 'selection-frame-prepare';
      selectionOverlayDiagnostics.retainedPreviousFrame = true;
      reliabilityDiagnostic.push({
        category: 'render',
        operation: 'selection-overlay-render',
        result: 'recovered',
        errorCode: '',
        technicalMessage: String(error?.message || error),
        stack: error?.stack || '',
      });
      console.warn('[selection-overlay-render] 직전 정상 선택 프레임을 유지합니다.', error);
      window.__PANDOLAB_SELECTION_RENDER_METRICS__ = {
        ...(window.__PANDOLAB_SELECTION_RENDER_METRICS__ || {}),
        renderSucceeded: false,
        retainedPreviousFrame: true,
        failureCount: selectionOverlayDiagnostics.failureCount,
        lastFailureStage: selectionOverlayDiagnostics.lastFailureStage,
      };
      selectionOverlayStage = '';
      return false;
    }
  }

  function issueCoordinate(issue) {
    if (Array.isArray(issue?.coordinate) && issue.coordinate.length >= 2) return issue.coordinate;
    const bounds = issue?.bounds;
    return Array.isArray(bounds) && bounds.length >= 4
      ? [(Number(bounds[0]) + Number(bounds[2])) / 2, (Number(bounds[1]) + Number(bounds[3])) / 2]
      : null;
  }

  function renderValidationOverlay() {
    if (!validationLayer) return;
    validationLayer.selectAll('*').remove();
    const issues = state.audit.report?.issues || state.geometryPreview.session?.validation?.issues || [];
    for (const issue of issues) {
      const className = geometryPreviewIssueClass(issue.kind);
      if (issue.geometry && (state.audit.selectedIssueId === issue.id || geometryMayIntersectViewport(issue.geometry))) {
        const feature = featureFromGeometry(issue.geometry);
        const selectedClass = state.audit.selectedIssueId === issue.id ? ' selected' : '';
        if (hasAreaGeometry(feature)) {
          validationLayer.append('path').datum(feature)
            .attr('class', `map-validation-issue map-validation-fill ${className}${selectedClass}`)
            .attr('d', path);
        }
        const outline = buildRenderableStrokeFeature(feature);
        if (outline.geometry.coordinates.length) {
          validationLayer.append('path').datum(outline)
            .attr('class', `map-validation-issue map-validation-outline ${className}${selectedClass}`)
            .attr('d', path);
        }
      }
      const coordinate = issueCoordinate(issue);
      if (!coordinate || !isCoordVisible(coordinate)) continue;
      const point = activeProjection()(coordinate);
      if (!point) continue;
      validationLayer.append('circle')
        .attr('class', `map-validation-marker ${className}`)
        .attr('cx', point[0]).attr('cy', point[1]).attr('r', state.audit.selectedIssueId === issue.id ? 8 : 6)
        .append('title').text(issue.message || '지도 오류');
    }
  }

  function renderSnapIndicator() {
    if (!snapLayer) return;
    snapLayer.selectAll('*').remove();
    const indicator = state.activeSnap;
    if (!indicator?.coordinate || !isCoordVisible(indicator.coordinate)) return;
    if (indicator.segmentEndpoints?.length === 2) {
      snapLayer.append('path').datum(featureFromGeometry({ type: 'LineString', coordinates: indicator.segmentEndpoints }))
        .attr('class', 'snap-indicator-segment').attr('d', path);
    }
    const point = activeProjection()(indicator.coordinate);
    if (!point) return;
    if (indicator.kind === 'intersection') {
      snapLayer.append('path').attr('class', 'snap-indicator-cross')
        .attr('d', `M${point[0] - 7},${point[1] - 7}L${point[0] + 7},${point[1] + 7}M${point[0] + 7},${point[1] - 7}L${point[0] - 7},${point[1] + 7}`);
    }
    snapLayer.append('circle').attr('class', 'snap-indicator-point').attr('cx', point[0]).attr('cy', point[1]).attr('r', 6);
  }

  function renderProjectedOverlays() {
    for (const layer of [territorialBoundaryLayer, overlayStackLayer, hydroEditLayer, territorialOperationLayer]) {
      layer?.selectAll?.('path')?.attr('d', path);
    }
  }

  function renderDebugMapPanel() {
    const panel = $('debugMapPanel');
    if (!panel) return;
    const params = new URLSearchParams(location.search);
    const enabled = params.has('debug') || localStorage.getItem('atlaswright.debug-map') === 'true';
    const perfOnly = params.has('perf');
    panel.classList.toggle('hidden', !enabled);
    if (!enabled && !perfOnly) return;
    const metrics = gpuMapRenderer.getStats?.() || {};
    const renderMetrics = mapRenderCoordinator?.getStats?.() || {};
    const selectionMetrics = window.__PANDOLAB_SELECTION_RENDER_METRICS__ || {};
    window.__PANDOLAB_RENDER_METRICS__ = {
      ...renderMetrics,
      activeMeshQuality: metrics.activeMeshQuality || metrics.meshQuality,
      pickCount: metrics.pickCount || 0,
      pickReadPixelsMs: metrics.pickReadPixelsMs || 0,
      selectionPathCount: selectionMetrics.pathCount || 0,
      selectionPathCharacterCount: selectionMetrics.pathCharacterCount || 0,
      selection: { ...selectionPerformanceMetrics },
      spatialIndex: mapObjectSpatialIndex.stats(),
      viewportCulling: { ...viewportCullingMetrics },
      distributionRows: {
        rebuildCount: distributionRenderRowCache.rebuildCount,
        rowCount: distributionRenderRowCache.rows.length,
        buildMs: distributionRenderRowCache.buildMs,
      },
      labelLayout: { ...labelLayoutMetrics },
      territorialBoundaryTopologyRebuildCount: territorialBoundaryCache.rebuildCount,
    };
    if (!enabled) return;
    const lines = [
      `renderer: ${metrics.renderer || 'unknown'}`,
      `mesh quality: ${metrics.activeMeshQuality || metrics.meshQuality || 'unknown'}`,
      `render revision: ${mapRenderCoordinator?.revision() || 0}`,
      `view revision: ${viewRevision}`,
      `full / view renders: ${renderMetrics.fullRenderCount || 0} / ${renderMetrics.viewRenderCount || 0}`,
      `last render: ${Number(renderMetrics.lastRenderMs || 0).toFixed(1)} ms`,
      `label layouts: ${renderMetrics.labelLayoutCount || 0}`,
      `selection paths / chars: ${selectionMetrics.pathCount || 0} / ${selectionMetrics.pathCharacterCount || 0}`,
      `GPU picks: ${metrics.pickCount || 0} / ${Number(metrics.pickReadPixelsMs || 0).toFixed(1)} ms`,
      `state revision: ${state.stateRevision}`,
      `pending country patches: ${state.pendingCountryRenderIds.size}`,
      `affected country ids: ${[...state.pendingCountryRenderIds].join(', ') || '—'}`,
      `worker busy: ${metrics.canvasWorkerBusy ? 'yes' : 'no'}`,
      `frame p95: ${Number(metrics.p95CpuSubmitMs || 0).toFixed(1)} ms`,
      `terrain / hydro: ${state.physicalLoadState.terrain} / ${state.physicalLoadState.hydro}`,
      `audit: ${state.audit.status}${state.audit.report ? ` / ${state.audit.report.issues.length} issues` : ''}`,
    ];
    panel.replaceChildren();
    const output = document.createElement('pre');
    output.textContent = lines.join('\n');
    const run = document.createElement('button');
    run.type = 'button';
    run.className = 'ui-button btn ghost compact';
    run.textContent = state.audit.status === 'running' ? '지도 검사 중…' : '전체 지도 검사';
    run.disabled = state.audit.status === 'running';
    run.addEventListener('click', runFullMapAudit, { once: true });
    panel.append(output, run);
    if (state.audit.status !== 'idle') {
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'ui-button btn ghost compact';
      clear.textContent = '검사 결과 지우기';
      clear.addEventListener('click', clearMapAudit, { once: true });
      panel.append(clear);
    }
    const issues = state.audit.report?.issues || [];
    if (issues.length) {
      const list = document.createElement('div');
      list.className = 'debug-audit-issues';
      list.setAttribute('aria-label', '지도 검사 결과');
      for (const issue of issues.slice(0, 20)) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'ui-button ui-row-button';
        item.dataset.category = auditCategory(issue.kind);
        item.textContent = issue.message || issue.kind || '검사 항목';
        item.addEventListener('click', () => focusAuditIssue(issue.id));
        list.append(item);
      }
      panel.append(list);
    }
  }

  function auditCategory(kind) {
    if (kind === 'overlap') return 'overlap';
    if (kind === 'gap' || kind === 'shared-boundary-gap') return 'gap';
    if (['invalid-sovereign', 'orphan-administrative', 'outside-parent', 'missing-territorial-reference', 'duplicate-id'].includes(kind)) return 'relation';
    return 'invalid';
  }

  function renderMapAuditPanel() {
    renderDebugMapPanel();
  }

  function ensureGeometryValidationWorker() {
    if (geometryValidationWorker) return geometryValidationWorker;
    geometryValidationWorker = new Worker(runtimeAssetUrl('workers/geometry-validation-worker.js'), { name: 'atlaswright-geometry-validation' });
    geometryValidationWorker.onmessage = event => {
      const message = event.data || {};
      if (message.type !== 'result' || Number(message.requestId) !== geometryValidationRequestId) return;
      if (!message.ok) {
        state.audit.status = 'error';
        renderMapAuditPanel();
        reportOperationError(new Error(String(message.message || '')), '지도 검사에 실패했습니다. 검사할 레이어를 확인한 뒤 다시 시도하세요.', 'PL-AUDIT-001', 4200);
        return;
      }
      state.audit.status = 'ready';
      state.audit.report = message.report;
      state.audit.selectedIssueId = null;
      renderMapAuditPanel();
      renderValidationOverlay();
      setActionStatus(message.report.issues.length
        ? `지도 검사에서 ${message.report.issues.length.toLocaleString('ko-KR')}건을 찾았습니다.`
        : '지도 검사에서 오류를 찾지 못했습니다.', message.report.issues.length ? 'error' : 'success', 3600);
    };
    geometryValidationWorker.onerror = () => {
      state.audit.status = 'error';
      renderMapAuditPanel();
    };
    return geometryValidationWorker;
  }

  function runFullMapAudit() {
    geometryValidationRequestId += 1;
    state.audit = { status: 'running', revision: geometryValidationRequestId, report: null, selectedIssueId: null };
    renderMapAuditPanel();
    renderValidationOverlay();
    const worker = ensureGeometryValidationWorker();
    worker.postMessage({
      type: 'audit',
      requestId: geometryValidationRequestId,
      revision: state.stateRevision,
      payload: {
        countries: state.countriesData?.features || [],
        coarseCountries: state.auditPreviewCountries?.features || [],
        preciseAffectedIds: [...state.historyDirtyCountryIds],
        units: state.territorialUnits || [],
        distributionEntries: state.distributionEntries || [],
      },
    });
  }

  function clearMapAudit() {
    if (state.audit.status === 'running') geometryValidationWorker?.postMessage({ type: 'cancel', requestId: geometryValidationRequestId });
    geometryValidationRequestId += 1;
    state.audit = { status: 'idle', revision: geometryValidationRequestId, report: null, selectedIssueId: null };
    renderMapAuditPanel();
    renderValidationOverlay();
  }

  function focusAuditIssue(issueId) {
    const issue = state.audit.report?.issues?.find(item => item.id === issueId);
    if (!issue) return;
    state.audit.selectedIssueId = issue.id;
    renderMapAuditPanel();
    if (issue.geometry) focusCountry(featureFromGeometry(issue.geometry), { maxZoom: isMobile() ? 12 : 10 });
    else {
      const coordinate = issueCoordinate(issue);
      if (coordinate) focusCoordinate(coordinate);
    }
    renderValidationOverlay();
  }

  function projectionViewSnapshot() {
    const projection = activeProjection();
    const translate = projection.translate().map(Number);
    const center = screenToGeo(translate);
    return {
      projection: state.projection,
      size: { width: state.size.width, height: state.size.height },
      dpr: currentMapDevicePixelRatio(),
      safeInset: currentMapSafeInsets(),
      translate,
      scale: Number(projection.scale()),
      rotation: state.projection === 'globe' ? state.view.globeRotation.map(Number) : null,
      projectionCenter: state.projection === 'flat' ? state.view.flatCenter.map(Number) : null,
      flatCenter: state.view.flatCenter.map(Number),
      globeRotation: state.view.globeRotation.map(Number),
      flatZoom: Number(state.view.flatZoom),
      globeZoom: Number(state.view.globeZoom),
      geographicCenter: center ? center.map(Number) : null,
      zoom: state.projection === 'globe' ? Number(state.view.globeZoom) : Number(state.view.flatZoom),
    };
  }

  function syncViewRevision() {
    const snapshot = projectionViewSnapshot();
    const signature = JSON.stringify(snapshot);
    if (signature !== renderedViewSignature) {
      renderedViewSignature = signature;
      viewRevision += 1;
    }
    window.__PANDOLAB_VIEW_REVISION__ = viewRevision;
    const viewState = { ...snapshot, revision: viewRevision };
    window.__PANDOLAB_VIEW_STATE__ = viewState;
    return viewState;
  }

  mapRenderCoordinator = createMapRenderCoordinator({
    requestFrame: callback => requestAnimationFrame(callback),
    prepareView: () => {
      updateProjection();
      return syncViewRevision();
    },
    renderers: {
      base: renderBase,
      countries: renderCountries,
      hydro: renderHydro,
      hydroEdits: renderHydroEdits,
      boundaryEdit: renderBoundaryEditOverlay,
      territorialUnits: renderTerritorialUnits,
      distributions: renderDistributions,
      drawings: renderDrawings,
      stackOverlays: applyOverlayStackOrder,
      projectedOverlays: renderProjectedOverlays,
      geometryPreview: renderGeometryPreview,
      selectionData: renderSelectionOverlay,
      selectionStyle: renderSelectionOverlay,
      selectionView: viewState => renderSelectionOverlay(viewState, { updateData: false }),
      validation: renderValidationOverlay,
      labelLayout: visibleLabelLayout,
      countryLabelPositions: renderCountryLabelPositions,
      userLabelPositions: renderUserLabelPositions,
      countryLabels: renderCountryLabels,
      userLabels: renderUserLabels,
      vertices: renderVertices,
      draft: renderDraft,
      snapIndicator: renderSnapIndicator,
      debug: renderDebugMapPanel,
      layerTree: renderLayerTree,
    },
  });
  if (new URLSearchParams(location.search).has('debug') || new URLSearchParams(location.search).has('perf')) {
    window.__PANDOLAB_RENDER_DEBUG__ = Object.freeze({
      snapshot: () => ({
        ...mapRenderCoordinator.getStats(),
        gpu: gpuMapRenderer.getStats?.() || {},
        gpuSelection: selectionEmphasisRenderer?.stats?.() || {},
        interactionStyle: resolvedInteractionStyle,
        selection: { ...(window.__PANDOLAB_SELECTION_RENDER_METRICS__ || {}) },
        selectionInput: { ...selectionPerformanceMetrics },
        spatialIndex: mapObjectSpatialIndex.stats(),
        viewportCulling: { ...viewportCullingMetrics },
        distributionRows: {
          rebuildCount: distributionRenderRowCache.rebuildCount,
          rowCount: distributionRenderRowCache.rows.length,
          buildMs: distributionRenderRowCache.buildMs,
        },
        labelLayout: { ...labelLayoutMetrics },
        territorialBoundaryTopologyRebuildCount: territorialBoundaryCache.rebuildCount,
      }),
    });
  }

  function renderAll() {
    mapWorkScheduler.scheduleIdle('map-object-spatial-index', () => rebuildMapObjectSpatialIndex(), 40);
    return mapRenderCoordinator.scheduleFull('render-all');
  }

  function renderViewFrame() {
    return mapRenderCoordinator.scheduleView('render-view');
  }

  function initSvg() {
    const mapEl = $('map');
    const map = d3.select(mapEl);
    map.selectAll('*').remove();
    if (new URLSearchParams(location.search).has('debug')) {
      window.__PANDOLAB_VIEW_DEBUG__ = Object.freeze({
        snapshot: () => {
          updateProjection();
          return deepClone({ ...projectionViewSnapshot(), revision: viewRevision });
        },
        screenToGeo: point => {
          updateProjection();
          const coordinate = screenToGeo(point);
          return coordinate ? coordinate.slice() : null;
        },
        geoToScreen: coordinate => {
          updateProjection();
          const point = activeProjection()(coordinate);
          return point ? point.slice() : null;
        },
        featureBounds: feature => {
          updateProjection();
          try { return deepClone(path.bounds(feature)); } catch (_) { return null; }
        },
        countryLabelAnchor: id => {
          const anchor = countryFeatureById(id)?.properties?.editor_label_anchor;
          return validLabelAnchor(anchor) ? [Number(anchor[0]), Number(anchor[1])] : null;
        },
      });
    } else {
      delete window.__PANDOLAB_VIEW_DEBUG__;
    }

    baseSvg = map.append('svg')
      .attr('class', 'map-base-svg')
      .attr('aria-hidden', 'true')
      .attr('focusable', 'false');
    const baseRoot = baseSvg.append('g').attr('class', 'map-base-root');
    shadowLayer = baseRoot.append('path').attr('class', 'globe-shadow');
    oceanLayer = baseRoot.append('path').attr('class', 'map-ocean');

    const gpuCanvas = document.createElement('canvas');
    mapEl.appendChild(gpuCanvas);
    gpuMapRenderer.attach(gpuCanvas);

    svg = map.append('svg').attr('class', 'map-svg map-overlay-svg');
    const selectionCanvas = document.createElement('canvas');
    selectionCanvas.className = 'gpu-selection-canvas';
    mapEl.appendChild(selectionCanvas);
    selectionEmphasisRenderer = createSelectionEmphasisRenderer({
      canvas: selectionCanvas,
      projectionForView: () => activeProjection(),
      getSize: () => state.size,
      getDpr: () => window.devicePixelRatio || 1,
      onContextChange: event => {
        reliabilityDiagnostic.push({
          category: 'render',
          operation: 'selection-overlay-context',
          result: event?.type || 'changed',
        });
        mapRenderCoordinator?.invalidate(MAP_RENDER_DIRTY.SELECTION_DATA, `selection-context-${event?.type || 'change'}`);
      },
      onRenderError: ({ stage = 'selection-overlay-render', channel = '', error } = {}) => {
        selectionOverlayDiagnostics.failureCount += 1;
        selectionOverlayDiagnostics.lastFailureStage = stage;
        reliabilityDiagnostic.push({
          category: 'render',
          operation: 'selection-overlay-render',
          result: 'recovered',
          channel,
          technicalMessage: String(error?.message || error || stage),
          stack: error?.stack || '',
        });
        console.warn(`[${stage}]`, error);
      },
    });
    try { selectionEmphasisRenderer.init(); } catch (error) { console.warn('Generic selection overlay unavailable', error); }
    syncResolvedInteractionStyle();
    const interactionSvg = map.append('svg').attr('class', 'map-interaction-svg');
    const interactionRoot = interactionSvg.append('g').attr('class', 'map-interaction-root');
    root = svg.append('g').attr('class', 'map-root');
    mapInteractionLayer = root.append('rect').attr('class', 'map-hit-area').attr('x', 0).attr('y', 0);
    graticuleLayer = root.append('path').attr('class', 'map-graticule');
    countryLayer = root.append('g').attr('class', 'countries-layer');
    hydroLakeLayer = root.append('g').attr('class', 'hydro-lakes-layer');
    hydroRiverLayer = root.append('g').attr('class', 'hydro-rivers-layer');
    hydroEditLayer = root.append('g').attr('class', 'hydro-edit-layer');
    boundaryEditLayer = root.append('g').attr('class', 'boundary-edit-layer');
    overlayStackLayer = root.append('g').attr('class', 'overlay-stack-layer');
    territorialBoundaryLayer = root.append('g').attr('class', 'territorial-boundary-layer');
    territorialUnitLayer = overlayStackLayer;
    distributionLayer = overlayStackLayer;
    drawingLayer = overlayStackLayer;
    hoverLayer = root.append('g').attr('class', 'hover-overlay-layer');
    selectionLayer = root.append('g').attr('class', 'selection-overlay-layer');
    previewLayer = root.append('g').attr('class', 'geometry-preview-layer');
    validationLayer = root.append('g').attr('class', 'validation-overlay-layer');
    vertexLayer = root.append('g').attr('class', 'vertices-layer');
    draftLayer = root.append('g').attr('class', 'draft-layer');
    snapLayer = root.append('g').attr('class', 'snap-indicator-layer');
    territorialOperationLayer = interactionRoot.append('g').attr('class', 'territorial-operation-layer');
    countryLabelLayer = root.append('g').attr('class', 'country-label-layer');
    labelLayer = root.append('g').attr('class', 'labels-layer');
    [previewLayer, validationLayer, vertexLayer, draftLayer, snapLayer, countryLabelLayer, labelLayer]
      .forEach(layer => interactionRoot.node().appendChild(layer.node()));

    const beginMapMovement = () => {
      state.mapMoving = true;
      mapRenderCoordinator.beginInteraction('map-movement');
      mapWorkScheduler.setInteractionActive(true);
      gpuMapRenderer.setHydroInteractionActive(true);
      cancelCountryHoverPick({ clear: true });
      mapEl.classList.add('dragging');
      if (state.draftHover) {
        state.draftHover = null;
        renderDraft();
      }
    };
    const finishMapMovement = point => {
      state.mapMoving = false;
      mapWorkScheduler.setInteractionActive(false);
      gpuMapRenderer.setHydroInteractionActive(false);
      mapEl.classList.remove('dragging');
      if (point) suppressNextMapClick(point);
      mapRenderCoordinator.endInteraction('map-movement-end');
      mapRenderCoordinator.invalidate(MAP_RENDER_DIRTY.OVERLAY_DATA, 'viewport-culling-settle');
      gpuMapRenderer.prioritizeLatest();
      queueViewAutosave();
    };

    mapInputController = createMapInputController({
      element: svg.node(),
      interactiveTarget: target => !state.spacePanActive && !!target?.closest?.('.vertex-handle, .user-label, .draft-interactive'),
      canNavigate: mapNavigationEnabled,
      getRevision: () => editInteractionRevision,
      beginMovement: beginMapMovement,
      finishMovement: finishMapMovement,
      panBy: panMapBy,
      scheduleViewRender,
      getZoom: () => state.projection === 'globe' ? state.view.globeZoom : state.view.flatZoom,
      transformView: transformMapView,
      zoomBy: factor => {
        zoomBy(factor, false);
        if (navigator.vibrate && isMobile()) navigator.vibrate(8);
      },
      canDirectTap: () => {
        const annexLine = state.tool === 'annex-territory' && ['line', 'polygon'].includes(state.annexPhase);
        const newCountryLine = state.tool === 'new-country' && state.newCountryPhase === 'line';
        const draftTap = (isDrawingDraftTool(state.tool) || newCountryLine || annexLine) && state.draftEdit.inputPhase === 'draw';
        return state.labelPlacementMode || draftTap || state.tool === 'point';
      },
      directTap: handleMapClick,
      canDoubleTap: () => isMobile() && ['select', 'country-border', 'country-coast', 'merge-country'].includes(state.tool) && !state.labelPlacementMode,
      suppressClick: suppressNextMapClick,
      canDrawStroke: () => draftInputActive() && state.draftEdit.inputPhase === 'draw' && !state.spacePanActive,
      beginStroke: beginDraftStrokeInput,
      moveStroke: appendDraftStrokeInput,
      endStroke: finishDraftStrokeInput,
      cancelStroke: cancelDraftStrokeInput,
    });

    svg.on('click', function() {
      if (mapClickBlocked()) return;
      handleMapClick(d3.mouse(this));
    });

    svg.on('mousemove', function() {
      if (state.draftStroke.active) return;
      if (d3.event.target?.closest?.('.draft-interactive') || state.draftEdit.dragging) {
        if (state.draftHover) {
          state.draftHover = null;
          renderDraft();
        }
        return;
      }
      if (state.draftEdit.insertTarget && !d3.event.target?.closest?.('.draft-interactive')) {
        state.draftEdit.insertTarget = null;
        renderDraftInsertionHandle();
      }
      if (mapInputController?.isPanning()) {
        if (state.draftHover) {
          state.draftHover = null;
          renderDraft();
        }
        return;
      }
      const screenPoint = d3.mouse(this);
      const coord = screenToGeo(screenPoint);
      if (coord) {
        $('coordStatus').textContent = `경도 ${coord[0].toFixed(4)} · 위도 ${coord[1].toFixed(4)}`;
        const newCountryLineMode = state.tool === 'new-country' && state.newCountryPhase === 'line';
        if ((isDrawingDraftTool(state.tool) || newCountryLineMode || (state.tool === 'annex-territory' && ['line', 'polygon'].includes(state.annexPhase))) && state.draftEdit.inputPhase === 'draw' && state.draftCoords.length) {
          state.draftHover = snapCoordinateForInput(coord, screenPoint, 'mouse');
          renderDraft();
        }
        if (state.tool === 'select' && !isMobile() && !d3.event.target?.closest?.('.drawing-shape, .territorial-unit-shape, .distribution-shape')) {
          queueCountryHoverPick(screenPoint, coord);
        }
      } else {
        $('coordStatus').textContent = '지구본 바깥';
        if (state.draftHover) {
          state.draftHover = null;
          renderDraft();
        }
        cancelCountryHoverPick({ clear: true });
        state.hovered = null;
        clearActiveSnap();
        renderHoverOverlay();
      }
    });

    svg.on('mouseleave', function() {
      cancelCountryHoverPick();
      state.draftHover = null;
      state.draftEdit.insertTarget = null;
      state.hovered = null;
      clearActiveSnap();
      renderDraft();
      renderHoverOverlay();
    });
  }

  function queueMapResize() {
    if (mapResizeFrame) return;
    mapResizeFrame = requestAnimationFrame(() => {
      mapResizeFrame = 0;
      resizeMap();
    });
  }

  function watchDevicePixelRatio() {
    if (resolutionQuery) {
      if (typeof resolutionQuery.removeEventListener === 'function') resolutionQuery.removeEventListener('change', watchDevicePixelRatio);
      else resolutionQuery.removeListener?.(watchDevicePixelRatio);
    }
    resolutionQuery = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`) || null;
    if (typeof resolutionQuery?.addEventListener === 'function') resolutionQuery.addEventListener('change', watchDevicePixelRatio, { once: true });
    else resolutionQuery?.addListener?.(watchDevicePixelRatio);
    queueMapResize();
  }

  function startMapResizeObserver() {
    mapResizeObserver?.disconnect?.();
    if (typeof ResizeObserver === 'function') {
      mapResizeObserver = new ResizeObserver(() => queueMapResize());
      mapResizeObserver.observe($('map'));
    }
    window.visualViewport?.addEventListener?.('resize', () => {
      refreshMapSheetMetrics();
      queueMapResize();
    });
    watchDevicePixelRatio();
  }

  function resizeMap() {
    const el = $('map');
    const bounds = el.getBoundingClientRect();
    const width = Math.max(1, bounds.width || el.clientWidth || 900);
    const height = Math.max(1, bounds.height || el.clientHeight || 650);
    const safe = currentMapSafeInsets();
    const signature = `${width.toFixed(3)}:${height.toFixed(3)}:${Number(window.devicePixelRatio || 1).toFixed(3)}:${safe.left}:${safe.right}:${safe.top}:${safe.bottom}`;
    if (signature === mapResizeSignature) {
      syncMapHudBounds();
      return false;
    }
    mapResizeSignature = signature;
    state.size.width = width;
    state.size.height = height;
    const viewBox = `0 0 ${state.size.width} ${state.size.height}`;
    [baseSvg, svg].forEach(layer => {
      layer?.attr('width', state.size.width)
        .attr('height', state.size.height)
        .attr('viewBox', viewBox)
        .attr('preserveAspectRatio', 'none');
    });
    mapInteractionLayer
      ?.attr('width', state.size.width)
      .attr('height', state.size.height);
    gpuMapRenderer.resize();
    renderAll();
    syncMapHudBounds();
    requestAnimationFrame(() => gpuMapRenderer.verifyLayout());
    return true;
  }

  function syncCountryActionButtons() {
    const selectedId = (state.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY) ? state.selected.id : null;
    const borderActive = state.tool === 'country-border' && state.boundaryEditCountryIds.includes(String(selectedId));
    const coastActive = state.tool === 'country-coast' && state.coastEditCountryId === selectedId;
    const mergeActive = state.tool === 'merge-country' && state.mergeSourceCountryId === selectedId;
    const annexActive = state.tool === 'annex-territory' && state.annexTargetCountryId === selectedId;
    const borderBtn = $('editBorderBtn');
    const coastBtn = $('editCoastBtn');
    const mergeBtn = $('mergeCountryBtn');
    const annexBtn = $('annexTerritoryBtn');
    if (borderBtn) borderBtn.classList.toggle('active', borderActive);
    if (coastBtn) {
      coastBtn.classList.toggle('active', coastActive);
    }
    if (mergeBtn) mergeBtn.classList.toggle('active', mergeActive);
    if (annexBtn) annexBtn.classList.toggle('active', annexActive);
  }

  function setModeBanner(text = '') {
    const instruction = $('modeTaskInstruction');
    if (!instruction) return;
    if (instruction.textContent !== text) instruction.textContent = text;
    instruction.classList.remove('cut-valid', 'cut-invalid', 'cut-pending');
    instruction.classList.toggle('hidden', !text);
    syncStatusBar();
  }

  function syncCutDraftFeedback(assessment, preview = false) {
    const instruction = $('modeTaskInstruction');
    if (!instruction || !assessment?.line?.length) {
      instruction?.classList.remove('cut-valid', 'cut-invalid', 'cut-pending');
      return;
    }
    let message;
    if (assessment.valid) {
      message = preview
        ? '이 위치에 놓으면 유효한 경계가 됩니다. 경계 근처 끝점은 자동으로 연결됩니다.'
        : '유효한 경계입니다. 영역 나누기를 눌러 완료하세요.';
    } else if (assessment.status === 'pending') {
      message = '선택 영역을 가로질러 반대쪽까지 그리세요.';
    } else {
      message = assessment.message;
    }
    const className = `cut-${assessment.status}`;
    if (instruction.textContent === message && instruction.classList.contains(className)) return;
    setModeBanner(message);
    instruction.classList.add(className);
  }

  function activeModeTaskDescriptor() {
    return describeTool(state.tool, state, { labelPlacement: state.labelPlacementMode });
  }

  function syncGeometryPreviewSummary() {
    const element = $('geometryPreviewSummary');
    if (!element) return;
    const session = state.geometryPreview.session;
    const blocking = session?.validation?.blocking === true;
    element.classList.toggle('hidden', !session || blocking);
    if (!session || blocking) {
      element.textContent = '';
      element.removeAttribute('aria-label');
      return;
    }
    const metrics = session.metrics || {};
    const fragments = [];
    if (metrics.transferredAreaKm2 > 0) fragments.push(`이동 ${formatArea(metrics.transferredAreaKm2)}`);
    if (metrics.finalAreaKm2 > 0) fragments.push(`최종 ${formatArea(metrics.finalAreaKm2)}`);
    const text = fragments.length ? fragments.join(' · ') : '변경 결과를 확인하세요.';
    element.textContent = text;
    element.setAttribute('aria-label', text);
  }

  function mapModeContextActive() {
    const labelMode = state.labelPlacementMode || state.tool === 'label';
    return !!(labelMode || hydroToolConfig(state.tool) || state.geometryPreview.session || isSpecialTool(state.tool) || draftInputActive());
  }

  function elementHasLayout(element) {
    if (!element || element.classList.contains('hidden')) return false;
    const bounds = element.getBoundingClientRect();
    return bounds.width > 0 && bounds.height > 0;
  }

  function syncMapHudBounds() {
    const slot = $('mapTopContextSlot');
    const map = $('map');
    if (!slot || !map) return;
    const bounds = map.getBoundingClientRect();
    if (!bounds.width) return;
    const edge = 12;
    let left = edge;
    let right = bounds.width - edge;
    if (layoutMode === 'wide') {
      const leftPanel = $('leftPanel');
      const rightPanel = $('rightPanel');
      if (elementHasLayout(leftPanel)) left = Math.max(left, leftPanel.getBoundingClientRect().right - bounds.left + edge);
      if (elementHasLayout(rightPanel)) right = Math.min(right, rightPanel.getBoundingClientRect().left - bounds.left - edge);
    }
    const command = $('mapCommandToolbar');
    const view = document.querySelector('.map-view-toolbar');
    if (elementHasLayout(command)) left = Math.max(left, command.getBoundingClientRect().right - bounds.left + 8);
    if (elementHasLayout(view)) right = Math.min(right, view.getBoundingClientRect().left - bounds.left - 8);
    if (right <= left) {
      left = edge;
      right = bounds.width - edge;
    }
    slot.style.setProperty('--map-context-center', `${Math.round((left + right) / 2)}px`);
    slot.style.setProperty('--map-context-width', `${Math.max(0, Math.floor(right - left))}px`);
  }

  function syncMapContextSurfaces() {
    const editing = mapModeContextActive();
    const selectionCount = objectSelection.snapshot().items.length;
    const showSelection = selectionCount > 1 || (isMobile() && selectionCount > 0);
    if (!editing) state.modeTaskMinimized = false;
    const minimized = editing && state.modeTaskMinimized === true;
    const context = $('modeEditingContext');
    const content = $('modeTaskWindowContent');
    const minimize = $('modeTaskMinimizeBtn');
    context?.classList.toggle('hidden', !editing);
    context?.classList.toggle('is-minimized', minimized);
    if (content) content.hidden = minimized;
    if (minimize) {
      minimize.setAttribute('aria-expanded', String(!minimized));
      minimize.setAttribute('aria-label', minimized ? '지도 작업창 복원' : '지도 작업창 최소화');
      minimize.dataset.tooltip = minimized ? '복원' : '최소화';
      minimize.querySelector('use')?.setAttribute('href', minimized ? '#icon-chevron-down' : '#icon-minus');
    }
    $('multiSelectionBar')?.classList.toggle('hidden', editing || !showSelection);
    requestAnimationFrame(syncMapHudBounds);
  }

  function toggleMapTaskWindow() {
    if (!mapModeContextActive()) return;
    state.modeTaskMinimized = !state.modeTaskMinimized;
    syncMapContextSurfaces();
  }

  function syncMapCursorMode() {
    const map = $('map');
    if (!map) return;
    const mode = toolCursorMode(state.tool, state, { labelPlacement: state.labelPlacementMode });
    map.classList.toggle('country-pick-mode', mode.country);
    map.classList.toggle('drawing-mode', mode.drawing);
    map.classList.toggle('candidate-pick-mode', mode.candidate);
    map.classList.toggle('select-mode', mode.select);
  }

  function updateModeButtons() {
    const annexLineMode = state.tool === 'annex-territory' && state.annexPhase === 'line';
    const annexPolygonMode = state.tool === 'annex-territory' && state.annexPhase === 'polygon';
    const annexRiverPartitionMode = state.tool === 'annex-territory' && state.annexPhase === 'river-partitions';
    const annexPolygonPreviewMode = state.tool === 'annex-territory' && state.annexPhase === 'polygon-preview';
    const annexSideMode = state.tool === 'annex-territory' && state.annexPhase === 'side';
    const annexComponentsMode = state.tool === 'annex-territory' && state.annexPhase === 'components';
    const annexDonorMode = state.tool === 'annex-territory' && state.annexPhase === 'donor';
    const newCountrySourceMode = state.tool === 'new-country' && state.newCountryPhase === 'sources';
    const newCountryLineMode = state.tool === 'new-country' && state.newCountryPhase === 'line';
    const newCountrySideMode = state.tool === 'new-country' && state.newCountryPhase === 'side';
    const newCountryComponentsMode = state.tool === 'new-country' && state.newCountryPhase === 'components';
    const mergeTargetMode = state.tool === 'merge-country' && !!state.mergeSourceCountryId;
    const drawingMergeMode = state.tool === 'merge-drawing' && !!state.drawingMergeSourceId;
    const drawingSplitMode = state.tool === 'split-drawing' && !!state.drawingSplitSourceId;
    const territorialUnitMergeMode = state.tool === 'merge-territorial-unit' && !!state.territorialUnitMergeSourceId;
    const territorialUnitSplitMode = state.tool === 'split-territorial-unit' && !!(state.territorialUnitSplitSourceId || state.territorialUnitSplitVirtualSource);
    const territorialUnitRedrawMode = state.tool === 'redraw-territorial-unit' && !!state.territorialUnitRedrawSourceId;
    const territorialUnitCreateMode = state.tool === 'draw-territorial-unit' && !!state.territorialCreateContext;
    const boundarySelectMode = state.tool === 'country-border' && state.boundaryEditPhase === 'selecting';
    const boundaryEditMode = state.tool === 'country-border' && state.boundaryEditPhase === 'editing';
    const boundarySelectionReady = !boundarySelectMode || boundaryEditSelectionAnalysis(state.boundaryEditCountryIds).valid;
    const methodSwitchAvailable = annexLineMode || annexPolygonMode || annexRiverPartitionMode || annexPolygonPreviewMode || annexSideMode || annexComponentsMode
      || newCountryLineMode || newCountrySideMode || newCountryComponentsMode;
    const activeMethod = state.tool === 'annex-territory'
      ? state.annexSelectionMethod
      : state.newCountrySelectionMethod;
    const labelMode = state.labelPlacementMode || state.tool === 'label';
    const terrainMode = !!hydroToolConfig(state.tool);
    const draftMode = draftInputActive();
    const previewMode = !!state.geometryPreview.session;
    const specialMode = labelMode || terrainMode || previewMode || isSpecialTool(state.tool) || draftMode;
    const cutLineMode = drawingSplitMode || territorialUnitSplitMode || annexLineMode || newCountryLineMode;
    if (cutLineMode) {
      const sourceGeometry = activeCutDraftSourceGeometry();
      state.draftCutAssessment = sourceGeometry ? assessCutDraft(state.draftCoords, sourceGeometry) : null;
    }
    const cutLineReady = !cutLineMode || state.draftCutAssessment?.valid === true;
    const task = activeModeTaskDescriptor();
    const bar = $('modeActionBar');
    const methodSwitch = $('modeMethodSwitch');
    const lineMethod = $('modeLineMethodBtn');
    const polygonMethod = $('modePolygonMethodBtn');
    const riverMethod = $('modeRiverMethodBtn');
    const componentsMethod = $('modeComponentsMethodBtn');
    const draftActions = $('modeDraftActions');
    const draftRedraw = $('modeDraftRedrawBtn');
    const draftRemoveLast = $('modeDraftRemoveLastBtn');
    const draftDelete = $('modeDraftDeleteBtn');
    const primary = $('modePrimaryBtn');
    const cancel = $('modeCancelBtn');
    if ($('modeTaskName')) $('modeTaskName').textContent = task.name;
    if ($('modeTaskStage')) $('modeTaskStage').textContent = task.stage;
    if (bar) {
      bar.classList.toggle('hidden', !specialMode);
      bar.classList.toggle('single-action', labelMode);
      bar.classList.toggle('is-processing', state.modeProcessing);
      bar.setAttribute('aria-busy', String(state.modeProcessing));
    }
    methodSwitch?.classList.toggle('hidden', !methodSwitchAvailable);
    methodSwitch?.classList.toggle('annex-four-methods', state.tool === 'annex-territory');
    const refineSelection = draftMode && state.draftEdit.inputPhase === 'refine' && Number.isInteger(state.draftEdit.selectedVertexIndex);
    const draftActionsVisible = draftMode && state.draftCoords.length > 0;
    draftActions?.classList.toggle('hidden', !draftActionsVisible);
    draftRedraw?.classList.toggle('hidden', refineSelection);
    draftRemoveLast?.classList.toggle('hidden', refineSelection);
    draftDelete?.classList.toggle('hidden', !refineSelection);
    if (draftRedraw) draftRedraw.disabled = state.modeProcessing || state.draftStroke.active || !state.draftCoords.length;
    if (draftRemoveLast) draftRemoveLast.disabled = state.modeProcessing || state.draftStroke.active || !state.draftCoords.length;
    if (draftDelete) draftDelete.disabled = state.modeProcessing || state.draftStroke.active || !refineSelection;
    for (const [button, method] of [[lineMethod, 'line'], [polygonMethod, 'polygon'], [riverMethod, 'river'], [componentsMethod, 'components']]) {
      if (!button) continue;
      button.classList.toggle('hidden', state.tool !== 'annex-territory' && ['polygon', 'river'].includes(method));
      const active = activeMethod === method;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
      button.disabled = state.modeProcessing;
    }
    if (primary) {
      primary.classList.toggle('hidden', labelMode);
      primary.disabled = state.modeProcessing
        || (draftMode && (state.draftStroke.active || state.draftCoords.length < draftMinimumPoints() || state.draftEdit.issues.length > 0 || (cutLineMode && !cutLineReady)))
        || (terrainMode && state.draftCoords.length < (isPolygonDraftTool(state.tool) ? 3 : 2))
        || (newCountrySourceMode && !state.newCountrySourceIds.length)
        || (annexDonorMode && !state.annexDonorCountryIds.length)
        || (annexPolygonMode && state.draftCoords.length < 3)
        || (annexRiverPartitionMode && (state.annexRiverPartitionStatus !== 'ready' || !state.annexSelectedRiverPartitionKeys.length || !state.annexRiverPartitionPreviewGeometry))
        || (annexPolygonPreviewMode && !state.annexCandidates[0]?.geometry)
        || (mergeTargetMode && !state.mergeTargetCountryIds.length)
        || (drawingMergeMode && !state.drawingMergeTargetIds.length)
        || (territorialUnitMergeMode && !state.territorialUnitMergeTargetIds.length)
        || ((drawingSplitMode || territorialUnitSplitMode) && !cutLineReady)
        || (territorialUnitRedrawMode && state.draftCoords.length < 3)
        || (territorialUnitCreateMode && state.draftCoords.length < 3)
        || (boundarySelectMode && !boundarySelectionReady)
        || ((annexLineMode || newCountryLineMode) && !cutLineReady)
        || (annexSideMode && !state.annexCandidates[state.annexSelectedCandidateIndex]?.geometry)
        || (newCountrySideMode && !state.newCountryCandidates[state.newCountrySelectedCandidateIndex]?.geometry)
        || (annexComponentsMode && !state.annexSelectedComponentKeys.length)
        || (newCountryComponentsMode && !state.newCountrySelectedComponentKeys.length)
        || (previewMode && state.geometryPreview.session.validation?.blocking === true);
      let primaryLabel = '완료';
      if (previewMode) primaryLabel = '변경 적용';
      else if (boundarySelectMode) primaryLabel = `선택 완료 (${state.boundaryEditCountryIds.length})`;
      else if (boundaryEditMode || state.tool === 'country-coast') primaryLabel = '수정 완료';
      else if (terrainMode) primaryLabel = '그리기 완료';
      else if (newCountrySourceMode) primaryLabel = `선택 완료 (${state.newCountrySourceIds.length})`;
      else if (annexDonorMode) primaryLabel = `선택 완료 (${state.annexDonorCountryIds.length})`;
      else if (annexPolygonMode) primaryLabel = '영역 편입';
      else if (annexPolygonPreviewMode) primaryLabel = '영역 편입';
      else if (annexRiverPartitionMode) primaryLabel = `편입 (${state.annexSelectedRiverPartitionKeys.length})`;
      else if (mergeTargetMode) primaryLabel = `합병 (${state.mergeTargetCountryIds.length})`;
      else if (drawingMergeMode) primaryLabel = `영역 합치기 (${state.drawingMergeTargetIds.length})`;
      else if (territorialUnitMergeMode) primaryLabel = `영역 합치기 (${state.territorialUnitMergeTargetIds.length})`;
      else if (drawingSplitMode) primaryLabel = '영역 나누기';
      else if (territorialUnitSplitMode) primaryLabel = '영역 나누기';
      else if (territorialUnitRedrawMode) primaryLabel = '영역 다시 지정';
      else if (territorialUnitCreateMode) primaryLabel = '영역 만들기';
      else if (newCountryLineMode || annexLineMode) primaryLabel = '나누기';
      else if (newCountryComponentsMode) primaryLabel = `국가 만들기 (${state.newCountrySelectedComponentKeys.length})`;
      else if (newCountrySideMode) primaryLabel = '국가 만들기';
      else if (annexComponentsMode) primaryLabel = `편입 (${state.annexSelectedComponentKeys.length})`;
      else if (annexSideMode) primaryLabel = '편입';
      const primaryLabelNode = primary.querySelector('.mode-button-label');
      if (primaryLabelNode) primaryLabelNode.textContent = primaryLabel;
      else primary.textContent = primaryLabel;
      primary.setAttribute('aria-label', primaryLabel);
      primary.setAttribute('aria-busy', String(state.modeProcessing));
    }
    if (cancel) {
      const cancelLabelNode = cancel.querySelector('.mode-button-label');
      if (cancelLabelNode) cancelLabelNode.textContent = '취소';
      else cancel.textContent = '취소';
      cancel.setAttribute('aria-label', '작업 취소');
      cancel.disabled = state.modeProcessing;
    }
    syncGeometryPreviewSummary();
    syncMapContextSurfaces();
    syncMapCursorMode();
    syncCountryActionButtons();
    updateHistoryButtons();
    syncStatusBar();
  }

  function dispatchModePrimaryAction() {
    if (state.geometryPreview.session) return applyActiveGeometryPreview();
    if (state.tool === 'country-border' && state.boundaryEditPhase === 'selecting') return beginCountryBorderEditing();
    if (state.tool === 'country-border') return finishCountryBorderEdit();
    if (state.tool === 'country-coast') return finishCountryCoastEdit();
    if (state.tool === 'merge-drawing') return completeDrawingMerge();
    if (state.tool === 'merge-territorial-unit') return completeTerritorialUnitMerge();
    if (state.tool === 'new-country' && state.newCountryPhase === 'sources') return beginNewCountryLine();
    if (state.tool === 'annex-territory' && state.annexPhase === 'donor') return beginAnnexSelection();
    if (state.tool === 'merge-country') return completeCountryMerge();
    if (state.tool === 'new-country' && state.newCountryPhase === 'side') return completeNewCountryCreation(state.newCountrySelectedCandidateIndex);
    if (state.tool === 'new-country' && state.newCountryPhase === 'components') return completeNewCountryCreation(null);
    if (state.tool === 'annex-territory' && state.annexPhase === 'side') return completeLinearAnnexation(state.annexSelectedCandidateIndex);
    if (state.tool === 'annex-territory' && state.annexPhase === 'river-partitions') return completeLinearAnnexation(null);
    if (state.tool === 'annex-territory' && state.annexPhase === 'polygon-preview') return completeLinearAnnexation(0);
    if (state.tool === 'annex-territory' && state.annexPhase === 'components') return completeLinearAnnexation(null);
    if (isDrawingDraftTool(state.tool) || ['new-country', 'annex-territory'].includes(state.tool)) return finishDraft();
    return false;
  }

  async function runModePrimaryAction(action = dispatchModePrimaryAction) {
    if (state.modeProcessing) return false;
    state.modeProcessing = true;
    updateModeButtons();
    try {
      return await action();
    } catch (error) {
      reportOperationError(error, '지도 작업을 완료하지 못했습니다. 현재 상태를 확인한 뒤 다시 시도하세요.', 'PL-MODE-001', 4200);
      return false;
    } finally {
      state.modeProcessing = false;
      updateModeButtons();
    }
  }

  function resetAnnexState() {
    state.annexTargetCountryId = null;
    state.annexDonorCountryIds = [];
    state.annexPhase = null;
    state.annexComponentIndex = null;
    state.annexCandidates = [];
    state.annexSelectedCandidateIndex = null;
    state.annexSelectedComponentKeys = [];
    state.annexSelectionMethod = 'line';
    state.annexSourceGeometry = null;
    resetRiverPartitionState();
  }

  function resetMergeState() {
    state.mergeSourceCountryId = null;
    state.mergeTargetCountryIds = [];
  }

  function resetDrawingMergeState() {
    state.drawingMergeSourceId = null;
    state.drawingMergeTargetIds = [];
  }

  function resetTerritorialUnitEditState() {
    state.territorialUnitMergeSourceId = null;
    state.territorialUnitMergeTargetIds = [];
    state.territorialUnitSplitSourceId = null;
    state.territorialUnitSplitVirtualSource = null;
    state.territorialUnitRedrawSourceId = null;
    state.territorialCreateContext = null;
  }

  function resetNewCountryState() {
    state.newCountryPhase = null;
    state.newCountrySourceIds = [];
    state.newCountryCandidates = [];
    state.newCountrySelectedCandidateIndex = null;
    state.newCountrySelectedComponentKeys = [];
    state.newCountrySelectionMethod = 'line';
    state.newCountrySourceGeometry = null;
  }

  function switchTerritorySelectionMethod(method) {
    const annexMethods = new Set(['line', 'polygon', 'river', 'components']);
    const useComponents = method === 'components';
    const usePolygon = method === 'polygon';
    const useRiver = method === 'river';
    if (state.tool === 'annex-territory' && ['line', 'polygon', 'river-partitions', 'polygon-preview', 'side', 'components'].includes(state.annexPhase)) {
      if (!state.annexDonorCountryIds.length) return;
      clearDraftInput(true);
      state.annexComponentIndex = null;
      state.annexCandidates = [];
      state.annexSelectedCandidateIndex = null;
      state.annexSelectedComponentKeys = [];
      resetRiverPartitionState();
      state.annexSelectionMethod = annexMethods.has(method) ? method : 'line';
      state.annexPhase = useComponents ? 'components' : usePolygon ? 'polygon' : useRiver ? 'river-partitions' : 'line';
      if (useComponents) updateTerritoryComponentSelectionFeedback();
      else if (useRiver) prepareRiverPartitionCandidates();
      else {
        setModeBanner(defaultDraftInstruction());
      }
    } else if (state.tool === 'new-country' && ['line', 'side', 'components'].includes(state.newCountryPhase)) {
      clearDraftInput(true);
      state.newCountryCandidates = [];
      state.newCountrySelectedCandidateIndex = null;
      state.newCountrySelectedComponentKeys = [];
      state.newCountrySelectionMethod = useComponents ? 'components' : 'line';
      state.newCountryPhase = useComponents ? 'components' : 'line';
      if (useComponents) updateTerritoryComponentSelectionFeedback();
      else {
        setModeBanner(defaultDraftInstruction());
      }
    } else {
      return;
    }
    updateModeButtons();
    renderAll();
  }

  function draftInputActive() {
    return !!draftToolConfig(state.tool);
  }

  function draftMinimumPoints() {
    return isPolygonDraftTool(state.tool) ? 3 : 2;
  }

  function draftScreenSample(screenPoint) {
    const coordinate = screenToGeo(screenPoint);
    return coordinate ? { screen: screenPoint.slice(), coordinate } : null;
  }

  function queueDraftStrokeRender() {
    if (draftStrokeRenderFrame) return;
    draftStrokeRenderFrame = requestAnimationFrame(() => {
      draftStrokeRenderFrame = 0;
      renderDraft();
    });
  }

  function beginDraftStrokeInput(screenPoint, event) {
    const config = draftToolConfig(state.tool);
    if (!config || state.draftEdit.inputPhase !== 'draw' || state.spacePanActive) return false;
    const sample = draftScreenSample(screenPoint);
    if (!sample) return false;
    state.draftHover = null;
    state.draftEdit.insertTarget = null;
    state.draftEdit.splitPreview = null;
    const started = beginDraftStroke(state.draftStroke, {
      pointerId: event?.pointerId,
      pointerType: event?.pointerType || 'mouse',
      profile: config.profile,
      sample,
    });
    if (!started) return false;
    $('map')?.classList.add('draft-stroke-active');
    renderDraft();
    updateModeButtons();
    return true;
  }

  function appendDraftStrokeInput(screenPoints) {
    if (!state.draftStroke.active) return false;
    const samples = [];
    for (const screenPoint of screenPoints || []) {
      const sample = draftScreenSample(screenPoint);
      if (!sample) {
        state.draftStroke.acceptingSamples = false;
        continue;
      }
      if (!state.draftStroke.acceptingSamples) continue;
      samples.push(sample);
    }
    if (!appendDraftStrokeSamples(state.draftStroke, samples)) return false;
    queueDraftStrokeRender();
    return true;
  }

  function cancelDraftStrokeInput() {
    if (!state.draftStroke.active) return false;
    cancelRawDraftStroke(state.draftStroke);
    if (draftStrokeRenderFrame) cancelAnimationFrame(draftStrokeRenderFrame);
    draftStrokeRenderFrame = 0;
    $('map')?.classList.remove('draft-stroke-active');
    renderDraft();
    updateModeButtons();
    return true;
  }

  function finishDraftStrokeInput(screenPoint) {
    if (!state.draftStroke.active) return false;
    appendDraftStrokeInput([screenPoint]);
    const config = draftToolConfig(state.tool);
    const firstCoordinate = state.draftCoords[0] || state.draftStroke.samples[0]?.coordinate;
    const closeTargetScreen = firstCoordinate ? activeProjection()(firstCoordinate) : null;
    const result = finalizeDraftStroke(state.draftStroke, {
      shape: config?.shape || 'line',
      closeTargetScreen,
    });
    if (draftStrokeRenderFrame) cancelAnimationFrame(draftStrokeRenderFrame);
    draftStrokeRenderFrame = 0;
    $('map')?.classList.remove('draft-stroke-active');
    if (!result) return false;
    const next = state.draftCoords.map(coordinate => coordinate.slice());
    for (const coordinate of result.coords) {
      if (next.length && coordNear(next[next.length - 1], coordinate, 1e-9)) continue;
      next.push(coordinate.slice());
    }
    if (next.length < draftMinimumPoints()) {
      setActionStatus(`형상이 너무 짧습니다. ${config?.shape === 'polygon' ? '영역의 경계를 더 크게' : '선을 더 길게'} 그려주세요.`, 'error', 3200);
      renderDraft();
      updateModeButtons();
      return false;
    }
    commitDraftCoords(next, null, { inputPhase: 'refine', buildPreview: true });
    if (!activeCutDraftSourceGeometry()) setModeBanner('꼭짓점을 드래그해 미세조정한 뒤 완료하세요.');
    return true;
  }

  function redrawDraftInput() {
    if (!draftInputActive()) return false;
    cancelDraftStrokeInput();
    if (state.draftCoords.length) {
      commitDraftCoords([], null, { inputPhase: 'draw', buildPreview: false });
    } else {
      state.draftEdit.inputPhase = 'draw';
      state.draftEdit.selectedVertexIndex = null;
      syncDraftAfterMutation({ buildPreview: false });
    }
    setModeBanner(defaultDraftInstruction());
    return true;
  }

  function draftSelfIntersectionIssue(coords, closed = false) {
    const points = (coords || []).map(coord => coord.slice());
    if (closed && points.length >= 3) points.push(points[0].slice());
    const segmentCount = Math.max(0, points.length - 1);
    for (let i = 0; i < segmentCount; i += 1) {
      for (let j = i + 1; j < segmentCount; j += 1) {
        if (Math.abs(i - j) <= 1) continue;
        if (closed && i === 0 && j === segmentCount - 1) continue;
        const detail = segmentIntersectionDetail(points[i], points[i + 1], points[j], points[j + 1]);
        if (!detail) continue;
        return {
          kind: detail.overlap ? 'segment-overlap' : 'self-intersection',
          coordinate: detail.coord || interpolateCoordinate(points[i], points[i + 1], 0.5),
          segmentIndex: i,
        };
      }
    }
    return null;
  }

  function genericDraftIssues(coords = state.draftCoords) {
    const issues = [];
    for (let index = 1; index < coords.length; index += 1) {
      if (!coordNear(coords[index - 1], coords[index], 1e-9)) continue;
      issues.push({
        kind: 'duplicate-vertex',
        coordinate: coords[index].slice(),
        vertexIndex: index,
        segmentIndex: index - 1,
        message: '서로 다른 위치를 연결하세요.',
      });
      break;
    }
    const intersection = draftSelfIntersectionIssue(coords, isPolygonDraftTool(state.tool));
    if (intersection) issues.push({ ...intersection, message: isPolygonDraftTool(state.tool) ? '영역 경계가 자기 자신과 교차합니다.' : '선이 자기 자신과 교차합니다.' });
    return issues;
  }

  function refreshDraftDerivedState({ buildPreview = false } = {}) {
    const editState = state.draftEdit;
    if (!draftInputActive()) {
      state.draftCutAssessment = null;
      editState.issues = [];
      editState.splitPreview = null;
      return;
    }
    const sourceGeometry = activeCutDraftSourceGeometry();
    if (sourceGeometry) {
      const assessment = assessCutDraft(state.draftCoords, sourceGeometry);
      state.draftCutAssessment = assessment;
      editState.issues = assessment.issues || [];
      if (!assessment.valid || editState.dragging) {
        editState.splitPreview = null;
      } else if (buildPreview) {
        try {
          const split = buildCutSplitCandidates(sourceGeometry, state.draftCoords);
          editState.splitPreview = {
            revision: editState.revision,
            candidates: split.candidates.map(candidate => ({ geometry: deepClone(candidate.geometry), area: candidate.area })),
          };
        } catch (_) {
          editState.splitPreview = null;
        }
      }
      return;
    }
    state.draftCutAssessment = null;
    editState.issues = genericDraftIssues();
    editState.splitPreview = null;
  }

  function syncDraftAfterMutation({ buildPreview = true, render = true } = {}) {
    state.draftEdit.revision += 1;
    state.draftEdit.insertTarget = null;
    state.draftHover = null;
    refreshDraftDerivedState({ buildPreview });
    if (render) renderDraft();
    updateModeButtons();
    updateHistoryButtons();
  }

  function commitDraftCoords(nextCoords, selectedVertexIndex = state.draftEdit.selectedVertexIndex, { record = true, buildPreview = true, inputPhase = null } = {}) {
    if (!draftInputActive()) return false;
    if (record) recordDraftSnapshot(state.draftEdit, state.draftCoords, state.draftEdit.selectedVertexIndex, MAX_HISTORY);
    state.draftCoords = (nextCoords || []).map(coord => coord.slice());
    if (inputPhase) state.draftEdit.inputPhase = inputPhase;
    state.draftEdit.selectedVertexIndex = Number.isInteger(selectedVertexIndex) && selectedVertexIndex >= 0 && selectedVertexIndex < state.draftCoords.length
      ? selectedVertexIndex
      : null;
    syncDraftAfterMutation({ buildPreview });
    return true;
  }

  function appendDraftCoordinate(coord, { dedupe = false } = {}) {
    const nextCoord = coord.slice();
    if (dedupe && state.draftCoords.length && coordNear(state.draftCoords[state.draftCoords.length - 1], nextCoord, 1e-9)) return false;
    const next = [...state.draftCoords.map(item => item.slice()), nextCoord];
    return commitDraftCoords(next, next.length - 1, { inputPhase: 'draw' });
  }

  function performDraftUndo() {
    if (!draftInputActive() || state.draftStroke.active) return false;
    const snapshot = undoDraftSnapshot(state.draftEdit, state.draftCoords);
    if (!snapshot) return false;
    state.draftCoords = snapshot.coords;
    state.draftEdit.selectedVertexIndex = snapshot.selectedVertexIndex;
    syncDraftAfterMutation({ buildPreview: true });
    return true;
  }

  function performDraftRedo() {
    if (!draftInputActive() || state.draftStroke.active) return false;
    const snapshot = redoDraftSnapshot(state.draftEdit, state.draftCoords);
    if (!snapshot) return false;
    state.draftCoords = snapshot.coords;
    state.draftEdit.selectedVertexIndex = snapshot.selectedVertexIndex;
    syncDraftAfterMutation({ buildPreview: true });
    return true;
  }

  function removeLastDraftPoint() {
    if (!draftInputActive() || state.draftStroke.active || !state.draftCoords.length) return false;
    const result = removeLastDraftVertex(state.draftCoords, state.draftEdit.selectedVertexIndex);
    return commitDraftCoords(result.coords, result.selectedVertexIndex);
  }

  function deleteSelectedDraftPoint() {
    if (!draftInputActive() || state.draftStroke.active || !Number.isInteger(state.draftEdit.selectedVertexIndex)) return false;
    const result = deleteDraftVertex(state.draftCoords, state.draftEdit.selectedVertexIndex);
    return commitDraftCoords(result.coords, result.selectedVertexIndex, { inputPhase: 'refine' });
  }

  function insertDraftPoint() {
    const target = state.draftEdit.insertTarget;
    if (!draftInputActive() || state.draftStroke.active || !target?.coordinate || !Number.isInteger(target.segmentIndex)) return false;
    const result = insertDraftVertex(state.draftCoords, target.segmentIndex, target.coordinate, isPolygonDraftTool(state.tool));
    if (!Number.isInteger(result.insertedIndex)) return false;
    return commitDraftCoords(result.coords, result.insertedIndex, { inputPhase: 'refine' });
  }

  function moveSelectedDraftPointByPixels(dx, dy) {
    const index = state.draftEdit.selectedVertexIndex;
    if (!draftInputActive() || state.draftStroke.active || !Number.isInteger(index) || !state.draftCoords[index]) return false;
    const projected = activeProjection()(state.draftCoords[index]);
    if (!projected) return false;
    const coordinate = screenToGeo([projected[0] + dx, projected[1] + dy]);
    if (!coordinate) return false;
    return commitDraftCoords(moveDraftVertex(state.draftCoords, index, coordinate), index, { inputPhase: 'refine' });
  }

  function clearDraftInput(invalidateInteraction = true) {
    if (invalidateInteraction) invalidateEditInteraction();
    if (draftStrokeRenderFrame) cancelAnimationFrame(draftStrokeRenderFrame);
    draftStrokeRenderFrame = 0;
    state.spacePanActive = false;
    $('map')?.classList.remove('space-pan-active', 'draft-stroke-active');
    state.draftCoords = [];
    state.draftHover = null;
    state.draftCutAssessment = null;
    resetDraftStrokeState(state.draftStroke);
    resetDraftEditState(state.draftEdit);
    if (draftLayer) draftLayer.selectAll('*').remove();
  }

  function resetTerritoryEditingState(invalidateInteraction = true) {
    clearDraftInput(invalidateInteraction);
    resetAnnexState();
    resetNewCountryState();
  }

  function resetBoundaryEditState() {
    state.boundaryEditCountryIds = [];
    state.boundaryEditPhase = null;
    state.boundaryEditInitialSelection = null;
    state.boundaryEditSeedCountryId = null;
  }

  function setTool(tool, announce = true) {
    if (tool !== 'select' && !requireCanonicalData()) return false;
    if (state.geometryPreview.session && state.tool !== tool) discardActiveGeometryPreview({ announce: false });
    if (state.tool !== tool) clearDraftInput(true);
    clearActiveSnap();
    state.hovered = null;
    state.labelPlacementMode = false;
    if (tool !== 'country-coast') {
      state.coastEditCountryId = null;
      state.coastEditScopeDrawingId = null;
      state.coastEditReturnSelection = null;
    }
    if (tool !== 'country-border') resetBoundaryEditState();
    if (tool !== 'merge-country') resetMergeState();
    if (tool !== 'merge-drawing') resetDrawingMergeState();
    if (tool !== 'split-drawing') state.drawingSplitSourceId = null;
    if (tool !== 'merge-territorial-unit') {
      state.territorialUnitMergeSourceId = null;
      state.territorialUnitMergeTargetIds = [];
    }
    if (tool !== 'split-territorial-unit') {
      state.territorialUnitSplitSourceId = null;
      state.territorialUnitSplitVirtualSource = null;
    }
    if (tool !== 'redraw-territorial-unit') state.territorialUnitRedrawSourceId = null;
    if (tool !== 'draw-territorial-unit') state.territorialCreateContext = null;
    if (tool !== 'annex-territory') resetAnnexState();
    if (tool !== 'new-country') resetNewCountryState();
    state.tool = tool;
    setCurrentTool(toolLabel(tool));
    setModeBanner();
    renderCountries();
    renderBoundaryEditOverlay();
    renderHoverOverlay();
    renderVertices();
    renderDraft();
    syncMobileNavigation();
    updateModeButtons();
    return true;
  }

  function enterTerrainDrawingMode(tool) {
    const config = hydroToolConfig(tool);
    if (!config) return false;
    clearNotification();
    clearSelection(false);
    resetTerritoryEditingState(true);
    state.coastEditCountryId = null;
    resetMergeState();
    setTool(tool, false);
    setModeBanner(defaultDraftInstruction());
    updateModeButtons();
    return true;
  }

  function enterNewCountryMode() {
    clearNotification();
    clearSelection(false);
    state.draftCoords = [];
    state.draftHover = null;
    resetNewCountryState();
    state.newCountryPhase = 'sources';
    setTool('new-country', false);
    setModeBanner('새 국가로 분리할 영토가 있는 국가를 선택하세요.');
    return true;
  }

  function toggleNewCountrySource(id) {
    if (state.tool !== 'new-country' || state.newCountryPhase !== 'sources') return;
    const sourceId = String(id || '');
    if (!countryFeatureById(sourceId)) return;
    const selected = new Set(state.newCountrySourceIds.map(String));
    if (selected.has(sourceId)) selected.delete(sourceId);
    else selected.add(sourceId);
    state.newCountrySourceIds = [...selected];
    renderCountries();
    setModeBanner('새 국가로 분리할 영토가 있는 국가를 선택하세요.');
    updateModeButtons();
  }

  function beginNewCountryLine() {
    if (state.tool !== 'new-country' || state.newCountryPhase !== 'sources') return;
    if (!requireCountriesUnlocked(state.newCountrySourceIds, '새 국가 분리 작업을 시작')) return;
    let sourceGeometry;
    try {
      sourceGeometry = selectedCountryUnionGeometry(state.newCountrySourceIds);
    } catch (error) {
      reportOperationError(error, '선택한 국가의 영토를 합칠 수 없습니다. 서로 연결된 국가를 다시 선택하세요.', 'PL-COUNTRY-004', 3600);
      return;
    }
    state.newCountryPhase = 'line';
    state.newCountrySelectionMethod = 'line';
    state.newCountryCandidates = [];
    state.newCountrySelectedCandidateIndex = null;
    state.newCountrySelectedComponentKeys = [];
    state.newCountrySourceGeometry = sourceGeometry;
    state.draftCoords = [];
    state.draftHover = null;
    setModeBanner(defaultDraftInstruction());
    updateModeButtons();
    renderAll();
  }

  function enterAnnexTerritoryMode(id) {
    clearNotification();
    const feature = countryFeatureById(id);
    if (!feature) return false;
    if (!requireCountriesUnlocked([id], '영토 편입을 시작')) return false;
    state.draftCoords = [];
    state.draftHover = null;
    state.annexTargetCountryId = String(id);
    state.annexDonorCountryIds = [];
    state.annexPhase = 'donor';
    state.annexComponentIndex = null;
    state.annexCandidates = [];
    state.annexSelectedCandidateIndex = null;
    state.annexSelectedComponentKeys = [];
    state.annexSelectionMethod = 'line';
    resetRiverPartitionState();
    setTool('annex-territory', false);
    state.annexTargetCountryId = String(id);
    syncCountryActionButtons();
    renderCountries();
    setModeBanner('피편입국을 선택하세요. 여러 국가를 선택할 수 있습니다.');
    updateModeButtons();
    return true;
  }

  function toggleAnnexDonor(id) {
    const targetId = String(state.annexTargetCountryId || '');
    const donorId = String(id || '');
    if (state.tool !== 'annex-territory' || state.annexPhase !== 'donor') return;
    if (!targetId || donorId === targetId) {
      setActionStatus('편입받을 국가는 영토를 가져올 국가로 선택할 수 없습니다. 다른 국가를 선택하세요.', 'error', 3500);
      return;
    }
    const donor = countryFeatureById(donorId);
    if (!donor?.geometry || !['Polygon', 'MultiPolygon'].includes(donor.geometry.type)) {
      setActionStatus('영토를 가져올 국가를 찾을 수 없습니다. 지도에 표시된 다른 국가를 선택하세요.', 'error', 3500);
      return;
    }
    const selected = new Set(state.annexDonorCountryIds.map(String));
    if (selected.has(donorId)) selected.delete(donorId);
    else selected.add(donorId);
    state.annexDonorCountryIds = [...selected];
    renderCountries();
    setModeBanner('피편입국을 선택하세요. 여러 국가를 선택할 수 있습니다.');
    updateModeButtons();
  }

  function beginAnnexSelection() {
    if (state.tool !== 'annex-territory' || state.annexPhase !== 'donor') return;
    if (!requireCountriesUnlocked([state.annexTargetCountryId, ...state.annexDonorCountryIds], '영토 편입을 시작')) return;
    let sourceGeometry;
    try {
      sourceGeometry = selectedCountryUnionGeometry(state.annexDonorCountryIds);
    } catch (error) {
      reportOperationError(error, '선택한 국가의 영토를 준비할 수 없습니다. 대상을 다시 선택하세요.', 'PL-ANNEX-004', 3600);
      return;
    }
    state.annexPhase = 'line';
    state.annexComponentIndex = null;
    state.annexCandidates = [];
    state.annexSelectedCandidateIndex = null;
    state.annexSelectedComponentKeys = [];
    state.annexSelectionMethod = 'line';
    resetRiverPartitionState();
    state.annexSourceGeometry = sourceGeometry;
    state.draftCoords = [];
    state.draftHover = null;
    setModeBanner(defaultDraftInstruction());
    updateModeButtons();
    renderAll();
  }

  function selectionSessionSnapshot() {
    const snapshot = objectSelection.snapshot();
    return {
      primaryKey: snapshot.primaryKey,
      items: snapshot.items.map(ref => ({ domain: ref.domain, type: ref.type, id: ref.id })),
    };
  }

  function enterCountryBorderSelection(id) {
    clearNotification();
    const feature = countryFeatureById(id);
    if (!feature) return false;
    if (!requireCountriesUnlocked([id], '국경 조정 대상을 선택')) return false;
    const initialSelection = selectionSessionSnapshot();
    if (!setTool('country-border', false)) return false;
    state.boundaryEditCountryIds = [String(id)];
    state.boundaryEditPhase = 'selecting';
    state.boundaryEditInitialSelection = initialSelection;
    state.boundaryEditSeedCountryId = String(id);
    setCountryObjectSelection(state.boundaryEditCountryIds, id, { refreshEditor: false });
    rebuildBoundaryTopology(state.boundaryEditCountryIds);
    setModeBanner(`${countryName(feature)}와 접한 국가를 선택하세요.`);
    renderAll();
    updateModeButtons();
    return true;
  }

  function enterCountryBorderEditFromSelection() {
    clearNotification();
    const snapshot = selectionSessionSnapshot();
    const refs = objectSelection.items();
    const ids = refs.filter(ref => ref.domain === 'territorial' && ref.type === TERRITORIAL_UNIT_TYPES.COUNTRY).map(ref => ref.id);
    if (ids.length !== refs.length || ids.length < 2) {
      setActionStatus('국경 조정은 국가를 2개 이상 선택했을 때 시작할 수 있습니다.', 'error', 3200);
      return false;
    }
    if (!requireCountriesUnlocked(ids, '국경 조정을 시작')) return false;
    const analysis = boundaryEditSelectionAnalysis(ids, { rebuild: true });
    if (!analysis.valid) {
      setActionStatus(analysis.message, 'error', 3800);
      return false;
    }
    if (!setTool('country-border', false)) return false;
    state.boundaryEditCountryIds = analysis.selectedIds;
    state.boundaryEditPhase = 'editing';
    state.boundaryEditInitialSelection = snapshot;
    state.boundaryEditSeedCountryId = analysis.selectedIds[0];
    setCountryObjectSelection(analysis.selectedIds, analysis.selectedIds.at(-1), { refreshEditor: false });
    rebuildBoundaryTopology(analysis.selectedIds);
    setModeBanner('공유국경 꼭짓점을 드래그하세요. 외부 접점은 고정됩니다.');
    renderAll();
    updateModeButtons();
    return true;
  }

  function boundaryNeighborIds(selectedCountryIds = state.boundaryEditCountryIds) {
    const selected = new Set(selectedCountryIds.map(String));
    const neighbors = new Set();
    for (const segment of state.sharedBoundaryTopology?.segments?.values?.() || []) {
      if (segment.kind !== 'shared') continue;
      const owners = [...segment.ownerIds].map(String);
      if (!owners.some(id => selected.has(id))) continue;
      for (const id of owners) if (!selected.has(id)) neighbors.add(id);
    }
    return neighbors;
  }

  function toggleBoundaryEditCountry(id) {
    if (state.tool !== 'country-border' || state.boundaryEditPhase !== 'selecting') return false;
    const countryId = String(id || '');
    if (!countryFeatureById(countryId)) return false;
    const selected = new Set(state.boundaryEditCountryIds.map(String));
    if (selected.has(countryId)) {
      if (countryId === state.boundaryEditSeedCountryId) {
        setActionStatus('시작 국가는 대상 선택 단계에서 해제할 수 없습니다.', 'error', 2800);
        return false;
      }
      selected.delete(countryId);
    } else {
      rebuildBoundaryTopology([...selected]);
      if (!boundaryNeighborIds([...selected]).has(countryId)) {
        setActionStatus('현재 선택 집합과 실제 국경을 맞댄 국가만 추가할 수 있습니다.', 'error', 3200);
        return false;
      }
      selected.add(countryId);
    }
    state.boundaryEditCountryIds = [...selected];
    setCountryObjectSelection(state.boundaryEditCountryIds, countryId, { refreshEditor: false });
    const analysis = boundaryEditSelectionAnalysis(state.boundaryEditCountryIds, { rebuild: true });
    setModeBanner(analysis.valid
      ? `${analysis.selectedIds.length}개 국가 선택됨 · 완료하면 공유국경을 편집합니다.`
      : analysis.message);
    renderAll();
    updateModeButtons();
    return true;
  }

  function beginCountryBorderEditing() {
    if (state.tool !== 'country-border' || state.boundaryEditPhase !== 'selecting') return false;
    if (!requireCountriesUnlocked(state.boundaryEditCountryIds, '국경 조정을 시작')) return false;
    const analysis = boundaryEditSelectionAnalysis(state.boundaryEditCountryIds, { rebuild: true });
    if (!analysis.valid) {
      setActionStatus(analysis.message, 'error', 3400);
      return false;
    }
    state.boundaryEditCountryIds = analysis.selectedIds;
    state.boundaryEditPhase = 'editing';
    rebuildBoundaryTopology(analysis.selectedIds);
    setModeBanner('공유국경 꼭짓점을 드래그하세요. 외부 접점은 고정됩니다.');
    renderAll();
    updateModeButtons();
    return true;
  }

  function finishCountryBorderEdit() {
    if (state.tool !== 'country-border') return false;
    const ids = state.boundaryEditCountryIds.slice();
    const primaryId = (state.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY) && ids.includes(String(state.selected.id)) ? String(state.selected.id) : ids.at(-1);
    setTool('select', false);
    state.boundaryTopology = { edges: new Map(), nodes: new Map() };
    state.sharedBoundaryTopology = { segments: new Map(), nodes: new Map() };
    setCountryObjectSelection(ids, primaryId);
    queueAutosave();
    setActionStatus(`${ids.length}개 국가 사이의 공유국경 조정을 완료했습니다.`, 'success');
    return true;
  }

  function enterCountryCoastEdit(id, { scopeDrawingId = null, returnSelection = null } = {}) {
    clearNotification();
    const feature = countryFeatureById(id);
    if (!feature) return false;
    if (!requireCountriesUnlocked([id], '해안선 조정을 시작')) return false;
    rebuildBoundaryTopology(id);
    state.coastEditCountryId = String(id);
    state.coastEditScopeDrawingId = scopeDrawingId ? String(scopeDrawingId) : null;
    state.coastEditReturnSelection = returnSelection ? deepClone(returnSelection) : null;
    setTool('country-coast', false);
    state.coastEditCountryId = String(id);
    state.coastEditScopeDrawingId = scopeDrawingId ? String(scopeDrawingId) : null;
    state.coastEditReturnSelection = returnSelection ? deepClone(returnSelection) : null;
    rebuildBoundaryTopology(id);
    syncCountryActionButtons();
    setModeBanner(scopeDrawingId
      ? '해안선 꼭짓점을 드래그하세요. 연결 영역도 함께 변경됩니다.'
      : '해안선 꼭짓점을 드래그하세요. 국경 접점은 고정됩니다.');
    return true;
  }

  function finishCountryCoastEdit() {
    const id = state.coastEditCountryId;
    if (!id) return;
    const feature = countryFeatureById(id);
    const returnSelection = state.coastEditReturnSelection ? deepClone(state.coastEditReturnSelection) : null;
    setTool('select', false);
    state.boundaryTopology = { edges: new Map(), nodes: new Map() };
    state.sharedBoundaryTopology = { segments: new Map(), nodes: new Map() };
    state.coastEditScopeDrawingId = null;
    state.coastEditReturnSelection = null;
    if (returnSelection?.type === 'drawing' && state.drawings.some(item => String(item.id) === String(returnSelection.id))) selectDrawing(String(returnSelection.id), true);
    else if (feature) selectCountry(id, true);
    queueAutosave();
    setActionStatus(`${feature ? countryName(feature) : '국가'}의 해안선을 조정했습니다.`, 'success');
  }

  function enterMergeCountryMode(id) {
    clearNotification();
    const feature = countryFeatureById(id);
    if (!feature) return false;
    if (!requireCountriesUnlocked([id], '국가 합병을 시작')) return false;
    state.mergeSourceCountryId = String(id);
    state.mergeTargetCountryIds = [];
    setTool('merge-country', false);
    state.mergeSourceCountryId = String(id);
    state.mergeTargetCountryIds = [];
    setModeBanner('합병할 국가를 선택하세요.');
    syncCountryActionButtons();
    updateModeButtons();
    return true;
  }

  function toggleMergeTarget(id) {
    const sourceId = String(state.mergeSourceCountryId || '');
    const targetId = String(id || '');
    if (state.tool !== 'merge-country' || !sourceId) return;
    if (!targetId || targetId === sourceId) {
      setActionStatus('기준 국가는 합병 대상으로 선택할 수 없습니다. 다른 국가를 선택하세요.', 'error', 3200);
      return;
    }
    if (!countryFeatureById(targetId)) {
      setActionStatus('합병 대상을 찾을 수 없습니다. 지도에 표시된 다른 국가를 선택하세요.', 'error', 3200);
      return;
    }
    const selected = new Set(state.mergeTargetCountryIds.map(String));
    if (selected.has(targetId)) selected.delete(targetId);
    else selected.add(targetId);
    state.mergeTargetCountryIds = [...selected];
    renderCountries();
    setModeBanner('합병할 국가를 선택하세요.');
    updateModeButtons();
  }

  function cancelActiveMode(announce = true) {
    const cancelledTool = state.tool;
    const boundarySelectionSnapshot = state.boundaryEditInitialSelection;
    mapEditClient.cancel();
    const selectedTerritorialUnitId = state.territorialUnitSplitSourceId || state.territorialUnitMergeSourceId
      || ((state.selected?.domain === 'territorial' && state.selected.type !== TERRITORIAL_UNIT_TYPES.COUNTRY) ? state.selected.id : null);
    const selectedDrawingId = state.drawingSplitSourceId || state.drawingMergeSourceId
      || (state.coastEditReturnSelection?.type === 'drawing' ? state.coastEditReturnSelection.id : null);
    const selectedId = state.annexTargetCountryId
      || state.coastEditCountryId
      || state.mergeSourceCountryId
      || ((state.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY) ? state.selected.id : null);
    resetTerritoryEditingState(true);
    state.coastEditCountryId = null;
    state.coastEditScopeDrawingId = null;
    state.coastEditReturnSelection = null;
    resetBoundaryEditState();
    resetMergeState();
    resetDrawingMergeState();
    resetTerritorialUnitEditState();
    state.drawingSplitSourceId = null;
    setTool('select', false);
    state.boundaryTopology = { edges: new Map(), nodes: new Map() };
    state.sharedBoundaryTopology = { segments: new Map(), nodes: new Map() };
    if (cancelledTool === 'country-border' && boundarySelectionSnapshot) restoreObjectSelectionSnapshot(boundarySelectionSnapshot);
    else if (selectedDrawingId && state.drawings.some(item => String(item.id) === String(selectedDrawingId))) selectDrawing(String(selectedDrawingId), true);
    else if (selectedTerritorialUnitId && territorialUnitById(selectedTerritorialUnitId)) selectTerritorialUnit(String(selectedTerritorialUnitId), true);
    else if (selectedId && countryFeatureById(selectedId)) selectCountry(selectedId, true);
    renderDraft();
    const labels = { 'new-country': '국가 추가', 'annex-territory': '영토 편입', 'merge-country': '국가 합병', 'merge-drawing': '영역 합치기', 'split-drawing': '영역 나누기', 'merge-territorial-unit': '영역 합치기', 'split-territorial-unit': '영역 나누기', 'country-border': '국경 조정', 'country-coast': '해안선 조정' };
    if (announce) setActionStatus(`${labels[cancelledTool] || '지도 작업'}을 취소했습니다.`, 'success');
  }

  function enterLabelMode() {
    clearNotification();
    resetTerritoryEditingState(true);
    state.coastEditCountryId = null;
    resetMergeState();
    state.tool = 'label';
    state.labelPlacementMode = true;
    setCurrentTool('지명 추가');
    $('map').classList.add('drawing-mode');
    $('map').classList.remove('select-mode');
    setModeBanner('지명을 배치할 위치를 선택하세요.');
    syncMobileNavigation();
    updateModeButtons();
    return true;
  }

  function exitLabelMode(announce = true) {
    state.labelPlacementMode = false;
    state.tool = 'select';
    $('map').classList.remove('drawing-mode');
    $('map').classList.add('select-mode');
    setModeBanner();
    setCurrentTool('국가 선택');
    syncMobileNavigation();
    updateModeButtons();
    if (announce) setActionStatus('지명 추가를 취소했습니다.', 'success');
  }

  function nextCountryColor() {
    const palette = ['#6f82a1', '#8a6f9e', '#668b78', '#a17962', '#777e9f', '#9a7d4f', '#5e8f97', '#936d78'];
    return palette[(state.countriesData?.features?.length || 0) % palette.length];
  }

  function createCountryFeature(name, rawRing, color = null, geometryOverride = null) {
    const id = uid('USR');
    const geometry = geometryOverride
      ? deepClone(geometryOverride)
      : { type: 'Polygon', coordinates: [orientRing(rawRing, true)] };
    const ring = ensureClosedRing(geometryPolygonSets(geometry)?.[0]?.[0] || rawRing || []);
    const feature = {
      type: 'Feature',
      properties: {
        name,
        iso_a3: null,
        continent: '사용자 지정',
        pop_est: 0,
        gdp_md_est: 0,
        editor_id: id,
        editor_original_name: name,
        editor_name: name,
        editor_color: color || nextCountryColor(),
        editor_custom: true,
      },
      geometry,
    };
    try { feature.properties.editor_centroid = d3.geo.centroid(feature); }
    catch (_) { feature.properties.editor_centroid = ringRepresentativePoint(ring); }
    return feature;
  }

  function projectedPointDistance(left, right) {
    return Math.hypot(Number(left?.[0]) - Number(right?.[0]), Number(left?.[1]) - Number(right?.[1]));
  }

  function pointSegmentDistance(point, start, end) {
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    if (!dx && !dy) return projectedPointDistance(point, start);
    const t = clamp(((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy), 0, 1);
    return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy));
  }

  function projectedLineDistance(geometry, screenPoint) {
    if (!geometry) return Infinity;
    const lines = geometry.type === 'LineString' ? [geometry.coordinates]
      : geometry.type === 'MultiLineString' ? geometry.coordinates
        : geometry.type === 'Polygon' ? geometry.coordinates
          : geometry.type === 'MultiPolygon' ? geometry.coordinates.flat()
            : [];
    let minimum = Infinity;
    for (const line of lines) {
      let previous = null;
      for (const coordinate of line || []) {
        const projected = activeProjection()(coordinate);
        if (previous && projected) minimum = Math.min(minimum, pointSegmentDistance(screenPoint, previous, projected));
        previous = projected;
      }
    }
    return minimum;
  }

  function geometryHitsScreenPoint(geometry, coord, screenPoint, tolerance = 8) {
    if (!geometry) return false;
    let bounds = geometryBoundsCache.get(geometry);
    if (!bounds) {
      bounds = coordinateBounds(geometry.coordinates);
      geometryBoundsCache.set(geometry, bounds);
    }
    const longitudeSpan = Number(bounds?.[2]) - Number(bounds?.[0]);
    const geographicTolerance = Math.max(0.15, 4 / Math.max(1, currentMapZoom()));
    if (bounds?.every(Number.isFinite) && longitudeSpan < 350 && (coord[0] < bounds[0] - geographicTolerance || coord[0] > bounds[2] + geographicTolerance || coord[1] < bounds[1] - geographicTolerance || coord[1] > bounds[3] + geographicTolerance)) return false;
    if (geometry.type === 'Point') {
      const projected = activeProjection()(geometry.coordinates);
      return !!projected && projectedPointDistance(projected, screenPoint) <= tolerance;
    }
    if (geometry.type === 'MultiPoint') return geometry.coordinates.some(point => {
      const projected = activeProjection()(point);
      return !!projected && projectedPointDistance(projected, screenPoint) <= tolerance;
    });
    if (geometry.type.includes('Polygon')) {
      try { if (d3.geo.contains({ type: 'Feature', properties: {}, geometry }, coord)) return true; } catch (_) {}
    }
    return projectedLineDistance(geometry, screenPoint) <= tolerance;
  }

  function selectableVisualRank(ref) {
    const order = state.layerPresentation?.overlayOrder || OVERLAY_GROUPS;
    let group = '';
    if (ref.domain === 'drawing') group = 'userDrawings';
    else if (ref.domain === 'distribution') group = DISTRIBUTION_TYPE_GROUPS[ref.type] || `${ref.type}s`;
    else if (ref.domain === 'territorial') group = ref.type === TERRITORIAL_UNIT_TYPES.ADMIN ? 'administrative' : ref.type === TERRITORIAL_UNIT_TYPES.REGION ? 'regions' : ref.type === TERRITORIAL_UNIT_TYPES.COUNTRY ? 'countries' : 'territories';
    else if (ref.domain === 'label') group = 'labels';
    else if (ref.domain === 'hydro') group = 'hydro';
    const index = order.indexOf(group);
    if (index >= 0) return 1000 - index;
    return { labels: 1300, hydro: 850, countries: 500 }[group] || 700;
  }

  async function selectableObjectsAt(screenPoint, coord) {
    const candidates = [];
    const add = ref => {
      const normalized = normalizeObjectRef(ref);
      if (normalized && !candidates.some(candidate => candidate.key === normalized.key)) candidates.push(normalized);
    };
    selectionPerformanceMetrics.exactHitTestCount = 0;
    const indexed = indexedMapObjectCandidates(screenPoint);
    for (const entry of indexed) {
      if (entry.domain === 'label') {
        if (!state.layerVisibility.labels || !isLayerItemVisible('labels', entry.id)) continue;
        const label = state.labels.find(item => String(item.id) === entry.id);
        const projected = label ? activeProjection()(label.coordinates) : null;
        selectionPerformanceMetrics.exactHitTestCount += 1;
        if (projected && projectedPointDistance(projected, screenPoint) <= (isMobile() ? 18 : 11)) add({ domain: 'label', type: label.kind || 'label', id: label.id });
        continue;
      }
      if (entry.domain === 'drawing') {
        if (!state.layerVisibility.drawings || !isLayerItemVisible('drawings', entry.id)) continue;
        const feature = state.drawings.find(item => String(item.id) === entry.id);
        selectionPerformanceMetrics.exactHitTestCount += 1;
        if (feature && geometryHitsScreenPoint(feature.geometry, coord, screenPoint, isMobile() ? 14 : 8)) add({ domain: 'drawing', type: feature.properties?.category || 'custom', id: feature.id });
        continue;
      }
      if (entry.domain === 'distribution') {
        const row = indexedDistributionRow(entry.id);
        selectionPerformanceMetrics.exactHitTestCount += 1;
        if (row && geometryHitsScreenPoint(row.geometry, coord, screenPoint, isMobile() ? 12 : 7)) add({ domain: 'distribution', type: row.layer.type, id: row.layer.id });
        continue;
      }
      if (entry.domain === 'territorial') {
        const feature = territorialUnitById(entry.id);
        if (!feature) continue;
        const group = feature.properties?.unitType === TERRITORIAL_UNIT_TYPES.ADMIN ? 'administrative' : feature.properties?.unitType === TERRITORIAL_UNIT_TYPES.REGION ? 'regions' : 'territories';
        if (state.layerVisibility[group] === false || !isLayerItemVisible(group, feature.id)) continue;
        selectionPerformanceMetrics.exactHitTestCount += 1;
        if (geometryHitsScreenPoint(feature.geometry, coord, screenPoint, isMobile() ? 12 : 7)) add({ domain: 'territorial', type: feature.properties?.unitType || TERRITORIAL_UNIT_TYPES.TERRITORY, id: feature.id });
        continue;
      }
      if (entry.domain === 'hydro') {
        const feature = hydroEditById(entry.id);
        selectionPerformanceMetrics.exactHitTestCount += 1;
        if (feature && isHydroFeatureVisible(feature) && geometryHitsScreenPoint(feature.geometry, coord, screenPoint, isMobile() ? 14 : 8)) add({ domain: 'hydro', type: feature.properties?.category || 'river', id: feature.id });
      }
    }
    const canReuseHover = state.hovered?.type === 'country' && state.hovered.feature
      && lastHoverPickViewRevision === viewRevision && lastHoverPickPoint
      && Math.hypot(screenPoint[0] - lastHoverPickPoint[0], screenPoint[1] - lastHoverPickPoint[1]) < 3;
    selectionPerformanceMetrics.pickCacheHit = !!canReuseHover;
    if (state.layerVisibility.countries) {
      let country;
      if (canReuseHover) country = state.hovered.feature;
      else {
        const pickStartedAt = performance.now();
        country = countryAtScreenPoint(screenPoint, coord, { verify: false });
        selectionPerformanceMetrics.gpuPickMs = performance.now() - pickStartedAt;
      }
      if (country) add({ domain: 'territorial', type: TERRITORIAL_UNIT_TYPES.COUNTRY, id: country.properties?.editor_id });
    }
    if (state.layerVisibility.rivers || state.layerVisibility.lakes) {
      const hydro = await hydroAtScreenPoint(screenPoint, coord);
      if (hydro) add({ domain: 'hydro', type: hydro.properties?.category || 'river', id: hydro.properties?.pandolab_id || hydro.id });
    }
    return candidates.sort((left, right) => selectableVisualRank(right) - selectableVisualRank(left) || objectDisplayInfo(left).name.localeCompare(objectDisplayInfo(right).name, 'ko'));
  }

  function closeObjectChooser({ restoreFocus = false } = {}) {
    const chooser = $('objectChooser');
    if (!chooser) return;
    chooser.classList.add('hidden');
    chooser.removeAttribute('style');
    objectChooserCandidates = [];
    if (restoreFocus) $('map')?.focus();
  }

  function openObjectChooser(candidates, screenPoint) {
    const chooser = $('objectChooser');
    const list = $('objectChooserList');
    if (!chooser || !list || candidates.length < 2) return closeObjectChooser();
    if (isMobile() && surfaceController.activeMobileSheet) closeActiveMobileSheet();
    objectChooserCandidates = candidates.slice();
    list.replaceChildren(...candidates.map((ref, index) => {
      const info = objectDisplayInfo(ref);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `ui-button ui-row ui-card ui-selectable-row object-chooser-item${objectSelection.has(ref) ? ' is-selected' : ''}`;
      button.dataset.objectChooserIndex = String(index);
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(objectSelection.has(ref)));
      const name = document.createElement('span');
      const type = document.createElement('small');
      name.textContent = info.name;
      type.textContent = [info.type, info.detail].filter(Boolean).join(' · ');
      button.append(name, type);
      return button;
    }));
    chooser.classList.remove('hidden');
    if (isMobile()) {
      chooser.removeAttribute('style');
      requestAnimationFrame(() => list.querySelector('[role="option"]')?.focus({ preventScroll: true }));
      return;
    }
    const bounds = $('map')?.getBoundingClientRect();
    if (!bounds) return;
    const edge = 8;
    requestAnimationFrame(() => {
      const width = chooser.offsetWidth || 300;
      const height = chooser.offsetHeight || 200;
      chooser.style.left = `${clamp(screenPoint[0] + 12, edge, Math.max(edge, bounds.width - width - edge))}px`;
      chooser.style.top = `${clamp(screenPoint[1] + 12, edge, Math.max(edge, bounds.height - height - edge))}px`;
    });
  }

  async function handleObjectSelectionAt(screenPoint, { sourceEvent = d3.event, forcedRef = null } = {}) {
    const inputStartedAt = performance.now();
    Object.assign(selectionPerformanceMetrics, {
      handlerMs: 0, indexQueryMs: 0, indexedCandidateCount: 0, exactHitTestCount: 0,
      gpuPickMs: 0, pickCacheHit: false, direct: false,
    });
    const normalizedForced = normalizeObjectRef(forcedRef);
    if (normalizedForced && objectRefExists(normalizedForced)) {
      selectionPerformanceMetrics.direct = true;
      const event = sourceEvent?.sourceEvent || sourceEvent || {};
      const mode = event.ctrlKey || event.metaKey || state.addSelectionMode ? 'toggle' : 'replace';
      applyObjectSelection(normalizedForced, { mode, scope: 'map' });
      selectionPerformanceMetrics.handlerMs = performance.now() - inputStartedAt;
      requestAnimationFrame(() => {
        selectionPerformanceMetrics.inputToPresentMs = performance.now() - inputStartedAt;
        window.__PANDOLAB_SELECTION_PERFORMANCE__ = { ...selectionPerformanceMetrics };
      });
      return true;
    }
    const coord = screenToGeo(screenPoint);
    if (!coord) return false;
    const candidates = await selectableObjectsAt(screenPoint, coord);
    if (!candidates.length) {
      closeObjectChooser();
      clearSelection();
      return false;
    }
    const event = sourceEvent?.sourceEvent || sourceEvent || {};
    if (candidates.length > 1) {
      openObjectChooser(candidates, screenPoint);
      return true;
    }
    const target = normalizedForced || candidates[0];
    const mode = event.ctrlKey || event.metaKey || state.addSelectionMode ? 'toggle' : 'replace';
    applyObjectSelection(target, { mode, scope: 'map' });
    selectionPerformanceMetrics.handlerMs = performance.now() - inputStartedAt;
    requestAnimationFrame(() => {
      selectionPerformanceMetrics.inputToPresentMs = performance.now() - inputStartedAt;
      window.__PANDOLAB_SELECTION_PERFORMANCE__ = { ...selectionPerformanceMetrics };
    });
    return true;
  }

  async function handleMapClick(screenPoint) {
    if (state.spacePanActive) return;
    const rawCoord = screenToGeo(screenPoint);
    if (!rawCoord) return;
    const pointerType = d3.event?.pointerType === 'touch' || d3.event?.changedTouches ? 'touch' : 'mouse';
    const coord = (draftInputActive() || ['new-country', 'annex-territory'].includes(state.tool))
      ? snapCoordinateForInput(rawCoord, screenPoint, pointerType)
      : rawCoord;
    if (state.labelPlacementMode) {
      addLabelAt(coord);
      return;
    }
    if (state.tool === 'select' && !state.labelPlacementMode) return handleObjectSelectionAt(screenPoint);
    const needsCountryHit = (state.tool === 'select' && !state.labelPlacementMode) ||
      (state.tool === 'new-country' && state.newCountryPhase === 'sources') ||
      (state.tool === 'annex-territory' && state.annexPhase === 'donor') ||
      (state.tool === 'country-border' && state.boundaryEditPhase === 'selecting') ||
      (state.tool === 'merge-country' && !!state.mergeSourceCountryId);
    const clickedCountry = needsCountryHit && state.layerVisibility.countries
      ? countryAtScreenPoint(screenPoint, coord)
      : null;
    if (state.tool === 'new-country' && state.newCountryPhase === 'sources') {
      if (clickedCountry) toggleNewCountrySource(clickedCountry.properties.editor_id);
      else setActionStatus('영토를 가져올 국가를 선택할 수 없습니다. 국가 영토 안쪽을 선택하세요.', 'error', 2600);
      return;
    }
    if (state.tool === 'annex-territory' && state.annexPhase === 'donor') {
      if (clickedCountry) toggleAnnexDonor(clickedCountry.properties.editor_id);
      else setActionStatus('영토를 가져올 국가를 선택할 수 없습니다. 국가 영토 안쪽을 선택하세요.', 'error', 2600);
      return;
    }
    if (state.tool === 'merge-country' && state.mergeSourceCountryId) {
      if (clickedCountry) toggleMergeTarget(clickedCountry.properties.editor_id);
      else setActionStatus('합병 대상을 선택할 수 없습니다. 국가 영토 안쪽을 선택하세요.', 'error', 2600);
      return;
    }
    if (state.tool === 'country-border' && state.boundaryEditPhase === 'selecting') {
      if (clickedCountry) toggleBoundaryEditCountry(clickedCountry.properties.editor_id);
      else setActionStatus('접경국을 선택할 수 없습니다. 국가 영토 안쪽을 선택하세요.', 'error', 2600);
      return;
    }
    if (state.tool === 'select' && !state.labelPlacementMode && clickedCountry) return;
    if (state.tool === 'annex-territory') {
      if (state.annexPhase === 'donor') {
        setActionStatus('영토를 가져올 국가를 먼저 지도에서 선택하세요.', 'error', 3200);
        return;
      }
      if (state.annexPhase === 'river-partitions') return;
      if (state.annexPhase !== 'line' && state.annexPhase !== 'polygon') return;
      if (!state.annexDonorCountryIds.length) {
        setActionStatus('선택한 국가를 찾을 수 없습니다. 영토를 가져올 국가를 다시 선택하세요.', 'error', 3400);
        return;
      }
      if (state.draftEdit.inputPhase !== 'draw') return;
      appendDraftCoordinate(coord, { dedupe: true });
      return;
    }
    const newCountryLineMode = state.tool === 'new-country' && state.newCountryPhase === 'line';
    if (isDrawingDraftTool(state.tool) || newCountryLineMode) {
      if (state.draftEdit.inputPhase !== 'draw') return;
      appendDraftCoordinate(coord);
      return;
    }
    if (state.tool === 'point') {
      const feature = {
        type: 'Feature', id: uid('point'),
        geometry: { type: 'Point', coordinates: coord },
        properties: { name: '', editorColor: DEFAULT_DRAWING_COLOR, category: 'custom', notes: '', pandolab_role: 'custom', pandolab_land_binding: 'none', pandolab_schema_version: DRAWING_SCHEMA_VERSION },
      };
      drawingApplicationService.add(feature);
      setTool('select');
      selectDrawing(String(feature.id));
      renderAll();
      queueAutosave();
      setActionStatus('점 지형지물을 추가했습니다.', 'success');
      return;
    }
    if (state.tool === 'select') clearSelection();
  }

  function finishSplitDrawingDraft() {
    const source = state.drawings.find(item => String(item.id) === String(state.drawingSplitSourceId));
    if (!source || drawingGeometryKind(source) !== 'polygon') {
      setActionStatus('나눌 영역을 찾을 수 없습니다. 영역을 다시 선택하세요.', 'error', 3400);
      return;
    }
    try {
      const split = buildCutSplitCandidates(source.geometry, state.draftCoords);
      const untouchedComponents = geometryPolygonSets(source.geometry)
        .filter((_, index) => index !== split.componentIndex)
        .map(polygon => deepClone(polygon));
      const retainedGeometry = normalizeClippedLandGeometry([
        ...geometryMultiCoordinates(split.candidates[0].geometry),
        ...untouchedComponents,
      ]);
      if (!retainedGeometry) throw new Error('나누지 않은 영토 조각을 보존할 수 없습니다.');
      const baseName = drawingName(source);
      const sourceAfter = deepClone(source);
      sourceAfter.geometry = retainedGeometry;
      sourceAfter.properties.name = `${baseName} 1`;
      const sibling = normalizeDrawingSemantics({
        type: 'Feature',
        id: uid('area'),
        geometry: deepClone(split.candidates[1].geometry),
        properties: { ...deepClone(sourceAfter.properties), name: `${baseName} 2` },
      }, { inferOwner: false });
      beginLocalGeometryPreview({
        operation: 'split-drawing',
        beforeFeatures: [source],
        afterFeatures: [sourceAfter, sibling],
        applyResult: () => {
          recordHistory();
          source.geometry = deepClone(sourceAfter.geometry);
          source.properties = deepClone(sourceAfter.properties);
          state.drawings.push(deepClone(sibling));
          clearDraftInput(true);
          setTool('select', false);
          selectDrawing(String(source.id), true);
        },
        successMessage: `${baseName} 영역을 두 영역으로 나눴습니다.`,
        errorMessage: '영역 나누기 결과를 적용하지 못했습니다.',
      });
    } catch (error) {
      reportOperationError(error, '영역을 나누지 못했습니다. 영역을 한 번만 관통하도록 경계를 다시 그리세요.', 'PL-LAND-003', 4200);
    }
  }

  function prepareAnnexDraftCandidates() {
    const targetId = String(state.annexTargetCountryId || '');
    const target = countryFeatureById(targetId);
    if (state.annexPhase !== 'line' || !target || !state.annexDonorCountryIds.length) {
      setActionStatus('편입을 진행할 수 없습니다. 편입받을 국가와 영토를 가져올 국가를 먼저 선택하세요.', 'error', 3800);
      return;
    }
    try {
      const sourceGeometry = state.annexSourceGeometry || selectedCountryUnionGeometry(state.annexDonorCountryIds);
      const split = buildCutSplitCandidates(sourceGeometry, state.draftCoords);
      state.annexComponentIndex = split.componentIndex;
      state.draftCoords = split.cutLine.map(coord => coord.slice());
      state.draftHover = null;
      state.annexCandidates = split.candidates;
      state.annexSelectedCandidateIndex = split.candidates[0].area <= split.candidates[1].area ? 0 : 1;
      state.annexPhase = 'side';
      setModeBanner('편입할 영역을 선택하세요.', 'annex-mode');
      updateModeButtons();
      renderAll();
    } catch (error) {
      reportOperationError(error, '새 경계를 사용할 수 없습니다. 영토를 가져올 국가를 한 번만 관통하도록 선을 다시 그리세요.', 'PL-ANNEX-003');
    }
  }

  function prepareNewCountryDraftCandidates() {
    if (state.newCountryPhase !== 'line') {
      setActionStatus('새 국가를 만들 수 없습니다. 영토를 가져올 국가 선택을 먼저 완료하세요.', 'error', 3600);
      return;
    }
    try {
      const sourceGeometry = state.newCountrySourceGeometry || selectedCountryUnionGeometry(state.newCountrySourceIds);
      const split = buildCutSplitCandidates(sourceGeometry, state.draftCoords);
      state.draftCoords = split.cutLine.map(coord => coord.slice());
      state.draftHover = null;
      state.newCountryCandidates = split.candidates;
      state.newCountrySelectedCandidateIndex = split.candidates[0].area <= split.candidates[1].area ? 0 : 1;
      state.newCountryPhase = 'side';
      setModeBanner('신생국으로 만들 영역을 선택하세요.', 'add-country-mode');
      updateModeButtons();
      renderAll();
    } catch (error) {
      reportOperationError(error, '신생국 국경선을 사용할 수 없습니다. 선택 영토를 한 번만 관통하도록 선을 다시 그리세요.', 'PL-COUNTRY-003');
    }
  }

  function prepareAnnexPolygon() {
    const target = countryFeatureById(String(state.annexTargetCountryId || ''));
    const donors = state.annexDonorCountryIds.map(countryFeatureById).filter(Boolean);
    if (state.annexPhase !== 'polygon' || !target || !donors.length) return;
    const plan = planDrawnTerritoryAnnex({
      drawnGeometry: { type: 'Polygon', coordinates: [ensureClosedRing(state.draftCoords)] },
      donorFeatures: donors,
      targetFeature: target,
      clipper: window.polygonClipping,
    });
    if (!plan?.transferGeometry) {
      setActionStatus('그린 영역 안에 편입할 영토가 없습니다.', 'error', 3200);
      return;
    }
    state.annexCandidates = [{ geometry: plan.transferGeometry }];
    state.annexSelectedCandidateIndex = 0;
    state.annexPhase = 'polygon-preview';
    setModeBanner('편입할 영역을 선택하세요.', 'annex-mode');
    updateModeButtons();
    renderAll();
  }

  function resetRiverPartitionState({ preserveCache = true } = {}) {
    riverPartitionGeneration += 1;
    state.annexRiverPartitionStatus = 'idle';
    state.annexRiverPartitionCandidates = [];
    state.annexSelectedRiverPartitionKeys = [];
    state.annexHoveredRiverPartitionKey = null;
    state.annexRiverPartitionPreviewGeometry = null;
    if (!preserveCache) riverPartitionCache.clear();
  }

  function riverPartitionGeometrySignature(feature) {
    if (!feature?.geometry) return '';
    return `${String(feature.properties?.editor_id || feature.id || '')}:${JSON.stringify(feature.geometry.coordinates || [])}`;
  }

  function riverPartitionHydroSignature() {
    const edits = state.hydroEdits
      .filter(feature => feature?.properties?.category === 'river' && feature.geometry)
      .map(feature => `${String(feature.id)}:${JSON.stringify(feature.geometry.coordinates || [])}`)
      .sort();
    return `${state.hydroManifest?.version || ''}:${state.hydroManifest?.index?.sha256 || ''}:${edits.join('|')}`;
  }

  function riverPartitionCandidateSignature(donors) {
    return [
      ...donors.map(riverPartitionGeometrySignature).sort(),
      riverPartitionHydroSignature(),
      RIVER_TERRITORY_PARTITION_ALGORITHM_REVISION,
      riverTerritoryPartitionConfigFingerprint(RIVER_TERRITORY_PARTITION_CONFIG),
    ].join('::');
  }

  function riverPartitionBoundsOverlap(left, right) {
    return !!left && !!right && left[0] <= right[2] && left[2] >= right[0] && left[1] <= right[3] && left[3] >= right[1];
  }

  function riverPartitionQueryBounds(geometry) {
    const output = [];
    for (const polygon of geometryPolygonSets(geometry)) {
      const longitudes = [];
      let minLatitude = Infinity;
      let maxLatitude = -Infinity;
      let minLongitude = Infinity;
      let maxLongitude = -Infinity;
      for (const ring of polygon || []) for (const point of ring || []) {
        const longitude = Number(point?.[0]);
        const latitude = Number(point?.[1]);
        if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) continue;
        longitudes.push(longitude);
        minLatitude = Math.min(minLatitude, latitude);
        maxLatitude = Math.max(maxLatitude, latitude);
        minLongitude = Math.min(minLongitude, longitude);
        maxLongitude = Math.max(maxLongitude, longitude);
      }
      if (!longitudes.length) continue;
      if (maxLongitude - minLongitude <= 180) {
        output.push([minLongitude, minLatitude, maxLongitude, maxLatitude]);
        continue;
      }
      let eastMinimum = Infinity;
      let westMaximum = -Infinity;
      for (const longitude of longitudes) {
        if (longitude >= 0) eastMinimum = Math.min(eastMinimum, longitude);
        else westMaximum = Math.max(westMaximum, longitude);
      }
      if (Number.isFinite(eastMinimum)) output.push([eastMinimum, minLatitude, 180, maxLatitude]);
      if (Number.isFinite(westMaximum)) output.push([-180, minLatitude, westMaximum, maxLatitude]);
    }
    return output;
  }

  function riverPartitionFeatureKey(feature) {
    return String(feature?.properties?.pandolab_id ?? feature?.properties?.__logicalFid ?? feature?.id ?? '');
  }

  async function loadRiverPartitionFeatures(donors) {
    if (state.physicalLoadState.hydro !== 'ready') {
      const ready = await loadHydroData(state.physicalLoadState.hydro === 'error');
      if (!ready) throw new Error('강·호수 데이터가 아직 준비되지 않았습니다.');
    }
    const boundsList = donors.flatMap(feature => riverPartitionQueryBounds(feature.geometry));
    const logicalIds = new Map();
    for (const bounds of boundsList) {
      const ids = await gpuMapRenderer.queryHydroLogicalFeatures(bounds, { category: 'river' });
      for (const logicalId of ids || []) logicalIds.set(String(logicalId), logicalId);
    }
    const loaded = [];
    const failedLogicalIds = [];
    const queue = [...logicalIds.values()];
    const concurrency = Math.min(4, queue.length);
    let cursor = 0;
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (cursor < queue.length) {
        const logicalId = queue[cursor++];
        try {
          const feature = await gpuMapRenderer.loadHydroLogicalFeature(logicalId);
          if (feature?.properties?.category === 'river' && feature.geometry) loaded.push(feature);
        } catch (_) {
          failedLogicalIds.push(logicalId);
        }
      }
    }));
    const editRivers = state.hydroEdits.filter(feature => (
      feature?.properties?.category === 'river'
      && feature.geometry
      && boundsList.some(bounds => riverPartitionBoundsOverlap(geometryBounds(feature.geometry), bounds))
    ));
    if (queue.length && !loaded.length && failedLogicalIds.length === queue.length) {
      const error = new Error('피편입국을 가로지르는 하천 데이터를 불러오지 못했습니다.');
      error.code = 'RIVER_PARTITION_SOURCE_ERROR';
      error.failedLogicalIds = failedLogicalIds.slice();
      throw error;
    }
    const featuresByKey = new Map();
    for (const feature of loaded) featuresByKey.set(riverPartitionFeatureKey(feature), feature);
    for (const feature of editRivers) featuresByKey.set(riverPartitionFeatureKey(feature), feature);
    return {
      features: [...featuresByKey.values()],
      boundsList,
      failedLogicalIds,
      diagnostics: {
        discoveredLogicalRivers: queue.length,
        loadedRivers: featuresByKey.size,
        failedRiverLoads: failedLogicalIds.length,
      },
    };
  }

  function ensureRiverPartitionWorker() {
    if (riverPartitionWorker || typeof Worker !== 'function') return riverPartitionWorker;
    try {
      riverPartitionWorker = new Worker(runtimeAssetUrl('workers/river-territory-partition-worker.js'), {
        type: 'module', name: 'pandolab-river-territory-partitions',
      });
      riverPartitionWorker.onmessage = event => {
        const message = event.data || {};
        const pending = riverPartitionRequests.get(Number(message.requestId));
        if (!pending) return;
        riverPartitionRequests.delete(Number(message.requestId));
        if (message.type === 'error') pending.reject(new Error(message.message || '하천 영토 조각을 계산하지 못했습니다.'));
        else if (message.type === 'result') pending.resolve(message.result || { candidates: [], donorResults: [], diagnostics: {} });
      };
      riverPartitionWorker.onerror = event => {
        const error = new Error(event.message || '하천 영토 분할 Worker 실행 오류');
        for (const pending of riverPartitionRequests.values()) pending.reject(error);
        riverPartitionRequests.clear();
        riverPartitionWorker?.terminate();
        riverPartitionWorker = null;
      };
    } catch (_) {
      riverPartitionWorker = null;
    }
    return riverPartitionWorker;
  }

  function computeRiverPartitionsAsync(payload) {
    const worker = ensureRiverPartitionWorker();
    if (!worker) return Promise.resolve().then(() => buildRiverTerritoryPartitions({ ...payload, clipper: window.polygonClipping }));
    const requestId = ++riverPartitionWorkerRequestId;
    return new Promise((resolve, reject) => {
      riverPartitionRequests.set(requestId, { resolve, reject });
      worker.postMessage({ type: 'compute', requestId, payload });
    });
  }

  function selectedRiverPartitionCandidates() {
    const selected = new Set(state.annexSelectedRiverPartitionKeys);
    return state.annexRiverPartitionCandidates.filter(candidate => selected.has(candidate.key));
  }

  function refreshRiverPartitionPreview() {
    const selected = selectedRiverPartitionCandidates();
    if (!selected.length) {
      state.annexRiverPartitionPreviewGeometry = null;
      return null;
    }
    const coordinateSets = selected.map(candidate => {
      if (candidate.geometry?.type === 'Polygon') return [candidate.geometry.coordinates];
      return candidate.geometry?.type === 'MultiPolygon' ? candidate.geometry.coordinates : null;
    }).filter(Boolean);
    const merged = coordinateSets.length === 1 ? coordinateSets[0] : window.polygonClipping?.union(...coordinateSets);
    state.annexRiverPartitionPreviewGeometry = normalizeClippedLandGeometry(merged);
    return state.annexRiverPartitionPreviewGeometry;
  }

  function toggleRiverPartitionCandidate(candidateKey) {
    if (state.tool !== 'annex-territory' || state.annexPhase !== 'river-partitions') return;
    if (!state.annexRiverPartitionCandidates.some(candidate => candidate.key === candidateKey)) return;
    const selected = new Set(state.annexSelectedRiverPartitionKeys);
    if (selected.has(candidateKey)) selected.delete(candidateKey); else selected.add(candidateKey);
    state.annexSelectedRiverPartitionKeys = [...selected].sort();
    refreshRiverPartitionPreview();
    const count = state.annexSelectedRiverPartitionKeys.length;
    setModeBanner(count
      ? `편입할 영역을 선택하세요. ${count}개 영역 선택됨.`
      : '편입할 영역을 선택하세요. 여러 영역을 선택할 수 있습니다.', 'annex-mode');
    renderDraft();
    updateModeButtons();
  }

  function riverPartitionResultMessage(candidates, donorResults, donors) {
    const invalidIds = new Set((donorResults || []).filter(result => result.status === 'invalid').map(result => String(result.donorCountryId)));
    const invalidNames = donors.filter(feature => invalidIds.has(String(feature.properties?.editor_id || feature.id))).map(countryName);
    if (candidates.length) {
      const suffix = invalidNames.length ? ` ${invalidNames.join(', ')}은(는) 분할 오류로 제외했습니다.` : '';
      return `강으로 분리된 영토를 선택하세요. 여러 영역을 선택할 수 있습니다.${suffix}`;
    }
    const firstReason = (donorResults || []).find(result => result.reason)?.reason;
    return firstReason || '피편입국 영토를 둘 이상으로 나누는 강이 없습니다.';
  }

  async function prepareRiverPartitionCandidates({ targetCountryId = state.annexTargetCountryId, donorCountryIds = state.annexDonorCountryIds } = {}) {
    const target = countryFeatureById(String(targetCountryId || ''));
    const donors = [...new Set((donorCountryIds || []).map(String))].map(countryFeatureById).filter(Boolean);
    if (state.tool !== 'annex-territory' || state.annexPhase !== 'river-partitions' || !target || !donors.length) return;
    const signature = riverPartitionCandidateSignature(donors);
    resetRiverPartitionState();
    const generation = riverPartitionGeneration;
    const current = () => state.tool === 'annex-territory'
      && state.annexPhase === 'river-partitions'
      && generation === riverPartitionGeneration
      && signature === riverPartitionCandidateSignature(state.annexDonorCountryIds.map(countryFeatureById).filter(Boolean));
    const cached = riverPartitionCache.get(signature);
    if (cached) {
      state.annexRiverPartitionCandidates = structuredClone(cached.candidates);
      window.__PANDOLAB_RIVER_PARTITION_DIAGNOSTICS__ = structuredClone(cached.diagnostics || {});
      state.annexRiverPartitionStatus = cached.candidates.length ? 'ready' : 'empty';
      setModeBanner(riverPartitionResultMessage(cached.candidates, cached.donorResults, donors), 'annex-mode');
      updateModeButtons();
      renderAll();
      return;
    }
    state.annexRiverPartitionStatus = 'loading';
    setModeBanner('피편입국을 가로지르는 강으로 영토 조각을 계산하는 중입니다.', 'annex-mode');
    updateModeButtons();
    renderAll();
    try {
      const sources = await loadRiverPartitionFeatures(donors);
      if (!current()) return;
      const result = await computeRiverPartitionsAsync({
        donors: donors.map(feature => ({
          countryId: String(feature.properties?.editor_id || feature.id || ''),
          geometry: feature.geometry,
          geometryRevision: countryLandRevision,
        })),
        riverFeatures: sources.features,
        hydroRevision: riverPartitionHydroSignature(),
        config: RIVER_TERRITORY_PARTITION_CONFIG,
        algorithmRevision: RIVER_TERRITORY_PARTITION_ALGORITHM_REVISION,
      });
      if (!current()) return;
      const candidates = (result.candidates || []).filter(candidate => candidate?.geometry && candidate.donorCountryId);
      const donorResults = result.donorResults || [];
      const diagnostics = { ...sources.diagnostics, ...(result.diagnostics || {}) };
      riverPartitionCache.set(signature, { candidates: structuredClone(candidates), donorResults: structuredClone(donorResults), diagnostics });
      if (riverPartitionCache.size > 8) riverPartitionCache.delete(riverPartitionCache.keys().next().value);
      window.__PANDOLAB_RIVER_PARTITION_DIAGNOSTICS__ = structuredClone(diagnostics);
      state.annexRiverPartitionCandidates = candidates;
      state.annexRiverPartitionStatus = candidates.length ? 'ready' : 'empty';
      setModeBanner(riverPartitionResultMessage(candidates, donorResults, donors), 'annex-mode');
      updateModeButtons();
      renderAll();
    } catch (error) {
      if (!current()) return;
      state.annexRiverPartitionStatus = error?.code === 'RIVER_PARTITION_SOURCE_ERROR' ? 'source-error' : 'error';
      state.annexRiverPartitionCandidates = [];
      setModeBanner(error?.code === 'RIVER_PARTITION_SOURCE_ERROR'
        ? '피편입국을 가로지르는 하천 데이터를 불러오지 못했습니다.'
        : '강으로 분리되는 영토 조각을 계산하지 못했습니다.', 'annex-mode');
      updateModeButtons();
      reportOperationError(error, '강으로 분리되는 영토 조각을 계산하지 못했습니다. 잠시 후 다시 시도하세요.', 'PL-ANNEX-RIVER-001', 4200);
    }
  }

  function finishDrawingFeatureDraft(polygonMode) {
    const hydro = hydroToolConfig(state.tool);
    const id = uid(hydro?.prefix || (polygonMode ? 'poly' : 'line'));
    const geometry = polygonMode
      ? { type: 'Polygon', coordinates: [orientRing(state.draftCoords, true)] }
      : { type: 'LineString', coordinates: state.draftCoords.map(coord => coord.slice()) };
    if (polygonMode) {
      const issues = validateStructuredGeometry({ type: 'Feature', id, properties: {}, geometry });
      if (issues.length) {
        setActionStatus(issues[0].message || '그린 영역을 저장할 수 없습니다. 표시된 경계를 수정하세요.', 'error', 4200);
        state.draftEdit.issues = issues;
        renderDraft();
        updateModeButtons();
        return;
      }
    }
    if (polygonMode && state.distributionDraft) {
      const draft = state.distributionDraft;
      const layer = distributionLayerById(draft.layerId);
      if (!layer) {
        setActionStatus('분포 항목을 찾을 수 없습니다. 그린 영역은 유지했으니 분포 항목을 확인하세요.', 'error', 3600);
        return;
      }
      const result = distributionService.addEntry({
        id: uid('distribution_entry'),
        layerId: layer.id,
        mode: DISTRIBUTION_MODES.GEOMETRY,
        geometry,
        share: draft.share,
      });
      if (!result.ok) {
        setActionStatus(result.error?.message || '자유 분포 영역을 저장하지 못했습니다.', 'error', 3600);
        return;
      }
      state.distributionDraft = null;
      state.draftCoords = [];
      state.draftHover = null;
      setTool('select', false);
      selectDistributionLayer(layer.id);
      queueAutosave();
      setActionStatus(`${layer.name} 자유 분포 영역을 추가했습니다.`, 'success');
      return;
    }
    const feature = {
      type: 'Feature', id, geometry,
      properties: {
        name: '',
        editorColor: hydro?.color || DEFAULT_DRAWING_COLOR,
        category: hydro?.category || 'custom',
        notes: '',
      },
    };
    if (hydro) {
      recordHistory();
      normalizeHydroEdit(feature);
      state.hydroEdits.push(feature);
    } else {
      drawingApplicationService.add(feature);
    }
    state.draftCoords = [];
    state.draftHover = null;
    setTool('select', false);
    markLayerTreeDirty();
    if (hydro) selectHydro(String(id));
    else selectDrawing(String(id));
    renderAll();
    queueAutosave();
    const createdObjectLabel = hydro?.category === 'river' ? '강을' : hydro?.category === 'lake' ? '호수를' : '지형지물을';
    setActionStatus(`${createdObjectLabel} 추가했습니다.`, 'success');
  }

  function finishDraft() {
    if (!(isDrawingDraftTool(state.tool) || ['new-country', 'annex-territory'].includes(state.tool))) {
      setActionStatus('완료할 형상이 없습니다. 지도에서 점을 먼저 입력하세요.', 'error');
      return;
    }
    const polygonMode = isPolygonDraftTool(state.tool);
    const minimumPoints = polygonMode ? 3 : 2;
    if (state.draftCoords.length < minimumPoints) {
      setActionStatus(`완료하려면 점이 최소 ${minimumPoints}개 필요합니다. 지도에서 점을 더 입력하세요.`, 'error');
      return;
    }
    if (state.draftStroke.active) {
      setActionStatus('선을 그리는 중입니다. 포인터를 놓은 뒤 완료하세요.', 'error', 2400);
      return;
    }
    const cutSourceGeometry = activeCutDraftSourceGeometry();
    refreshDraftDerivedState({ buildPreview: false });
    if (!cutSourceGeometry && state.draftEdit.issues.length) {
      setActionStatus(state.draftEdit.issues[0].message || '그린 형상에서 수정이 필요한 위치를 확인하세요.', 'error', 4200);
      renderDraft();
      updateModeButtons();
      return;
    }
    if (cutSourceGeometry) {
      const assessment = assessCutDraft(state.draftCoords, cutSourceGeometry);
      state.draftCutAssessment = assessment;
      state.draftEdit.issues = assessment.issues || [];
      if (!assessment.valid) {
        setActionStatus(assessment.message || '경계선을 선택 영역의 반대쪽 경계까지 연결하세요.', 'error', 4200);
        renderDraft();
        updateModeButtons();
        return;
      }
    }
    dispatchTool(state.tool, {
      'split-drawing': finishSplitDrawingDraft,
      'split-territorial-unit': finishTerritorialUnitSplitDraft,
      'redraw-territorial-unit': finishTerritorialUnitRedrawDraft,
      'draw-territorial-unit': finishTerritorialUnitDirectDraft,
      'annex-territory': state.annexPhase === 'polygon' ? prepareAnnexPolygon : prepareAnnexDraftCandidates,
      'new-country': prepareNewCountryDraftCandidates,
    }, () => finishDrawingFeatureDraft(polygonMode));
  }

  async function completeLinearAnnexation(candidateIndex) {
    if (state.tool !== 'annex-territory' || !['side', 'river-partitions', 'polygon-preview', 'components'].includes(state.annexPhase)) return;
    const targetId = String(state.annexTargetCountryId || '');
    const riverPartitionMode = state.annexPhase === 'river-partitions';
    const selectedRiverPartitions = riverPartitionMode ? selectedRiverPartitionCandidates() : [];
    const donorIds = riverPartitionMode
      ? [...new Set(selectedRiverPartitions.map(candidate => String(candidate.donorCountryId)).filter(Boolean))]
      : state.annexDonorCountryIds.map(String);
    if (!requireCountriesUnlocked([targetId, ...donorIds], '영토를 편입')) return;
    let candidate;
    if (riverPartitionMode) {
      candidate = state.annexRiverPartitionPreviewGeometry ? { geometry: state.annexRiverPartitionPreviewGeometry } : null;
    } else if (state.annexPhase === 'components') {
      try { candidate = { geometry: selectedTerritoryComponentGeometry() }; }
      catch (error) {
        reportOperationError(error, '선택한 영토 조각을 확인하지 못했습니다. 영역을 다시 선택하세요.', 'PL-ANNEX-001', 3800);
        return;
      }
    } else {
      const selectedIndex = candidateIndex === null ? NaN : Number(candidateIndex);
      candidate = Number.isInteger(selectedIndex) && selectedIndex >= 0 ? state.annexCandidates[selectedIndex] : null;
    }
    const targetBefore = countryFeatureById(targetId);
    const donorsBefore = donorIds.map(countryFeatureById).filter(Boolean);
    if (!candidate?.geometry || !targetBefore || !donorsBefore.length) {
      setActionStatus('편입 후보나 국가 데이터를 찾을 수 없습니다.', 'error', 3800);
      return;
    }
    const targetName = countryName(targetBefore);
    const snapshot = snapshotEditable();
    await beginWorkerGeometryPreview({
      operation: 'annex',
      payload: { targetId, donorIds, transferredGeometry: candidate.geometry },
      snapshot,
      transferredGeometry: candidate.geometry,
      applyResult: plan => {
        const affectedIds = new Set(plan.affectedIds);
        applyWorkerCountryPatches(plan);
        reindexCountries(state.countriesData, true);
        transferLandDependents(candidate.geometry, donorIds, targetId);
        refreshCountryCentroids(affectedIds);
        state.boundaryTopology = { edges: new Map(), nodes: new Map() };
        if (!countryFeatureById(targetId)) throw new Error('편입받을 국가가 편입 결과에서 사라졌습니다.');
        state.draftCoords = [];
        state.draftHover = null;
        setTool('select', false);
        selectCountry(targetId, false, false);
        renderAll();
      },
      onSuccess: plan => {
        const removedText = plan.removedIds.length ? ` · ${plan.removedIds.length}개국 완전 흡수` : '';
        const selectedText = riverPartitionMode ? `선택한 ${selectedRiverPartitions.length}개 영역을 ` : '선택한 ';
        setActionStatus(`${selectedText}${plan.affectedDonorIds.length}개국의 영토를 ${targetName}에 편입했습니다${removedText}.`, 'success', 4000);
      },
      onError: error => reportOperationError(error, '영토를 편입하지 못해 변경을 되돌렸습니다. 편입 범위를 조정한 뒤 다시 시도하세요.', 'PL-ANNEX-002'),
    });
  }

  async function completeNewCountryCreation(candidateIndex) {
    if (state.tool !== 'new-country' || !['side', 'components'].includes(state.newCountryPhase)) return;
    let candidate;
    if (state.newCountryPhase === 'components') {
      try { candidate = { geometry: selectedTerritoryComponentGeometry() }; }
      catch (error) {
        reportOperationError(error, '선택한 영토 조각을 확인하지 못했습니다. 영역을 다시 선택하세요.', 'PL-COUNTRY-001', 3800);
        return;
      }
    } else {
      const selectedIndex = candidateIndex === null ? NaN : Number(candidateIndex);
      candidate = Number.isInteger(selectedIndex) && selectedIndex >= 0 ? state.newCountryCandidates[selectedIndex] : null;
    }
    if (!candidate?.geometry) {
      setActionStatus('신생국 영토 후보를 찾을 수 없습니다.', 'error', 3800);
      return;
    }
    if (!requireCountriesUnlocked(state.newCountrySourceIds, '새 국가를 분리')) return;
    const nameInput = prompt('새 국가의 국명을 입력하세요.', '새 국가');
    if (nameInput === null) return;
    const sourceIds = state.newCountrySourceIds.map(String);
    const snapshot = snapshotEditable();
    const feature = createCountryFeature(
      nameInput.trim() || '새 국가',
      state.draftCoords,
      null,
      snapGeometryToGrid(candidate.geometry, 7),
    );
    await beginWorkerGeometryPreview({
      operation: 'new-country',
      payload: { sourceIds, transferredGeometry: candidate.geometry, newFeature: feature },
      snapshot,
      transferredGeometry: candidate.geometry,
      applyResult: transferPlan => {
        const affectedIds = new Set(transferPlan.affectedIds);
        applyWorkerCountryPatches(transferPlan);
        reindexCountries(state.countriesData, true);
        transferLandDependents(candidate.geometry, sourceIds, feature.properties.editor_id);
        refreshCountryCentroids(affectedIds);
        state.boundaryTopology = { edges: new Map(), nodes: new Map() };
        state.draftCoords = [];
        state.draftHover = null;
        setTool('select', false);
        selectCountry(feature.properties.editor_id, false, false);
        renderAll();
      },
      onSuccess: transferPlan => {
        const removedText = transferPlan.removedIds.length ? ` · 원본 ${transferPlan.removedIds.length}개국 완전 흡수` : '';
        setActionStatus(`${countryName(feature)} 국가를 추가했습니다${removedText}.`, 'success', 4200);
      },
      onError: error => reportOperationError(error, '국가를 추가하지 못해 변경을 되돌렸습니다. 선택 범위를 조정한 뒤 다시 시도하세요.', 'PL-COUNTRY-002'),
    });
  }

  async function completeCountryMerge() {
    const sourceId = String(state.mergeSourceCountryId || '');
    const targetIds = [...new Set(state.mergeTargetCountryIds.map(String))].filter(id => id && id !== sourceId);
    if (!sourceId || !targetIds.length) {
      setActionStatus('합병할 국가를 하나 이상 선택하세요.', 'error', 3200);
      return;
    }
    if (!requireCountriesUnlocked([sourceId, ...targetIds], '국가를 합병')) return;
    const source = countryFeatureById(sourceId);
    const targets = targetIds.map(countryFeatureById).filter(Boolean);
    if (!source || targets.length !== targetIds.length) {
      setActionStatus('합병할 국가를 찾을 수 없습니다. 대상을 다시 선택하세요.', 'error');
      return;
    }
    const sourceName = countryName(source);
    const snapshot = snapshotEditable();
    await beginWorkerGeometryPreview({
      operation: 'merge',
      payload: { sourceId, targetIds },
      snapshot,
      applyResult: result => {
        applyWorkerCountryPatches(result);
        state.countryOverrides[sourceId] = { ...(state.countryOverrides[sourceId] || {}), name: sourceName };
        for (const targetId of targetIds) delete state.countryOverrides[targetId];
        reindexCountries(state.countriesData, true);
        reassignLandDependents(targetIds, sourceId);
        refreshCountryCentroids(new Set([sourceId]));
        state.boundaryTopology = { edges: new Map(), nodes: new Map() };
        setTool('select', false);
        selectCountry(sourceId, false, false);
        renderAll();
      },
      onSuccess: () => setActionStatus(`${targetIds.length}개국을 ${sourceName}에 합병했습니다.`, 'success', 3200),
      onError: error => reportOperationError(error, '국가를 합병하지 못해 변경을 되돌렸습니다. 대상을 다시 확인하세요.', 'PL-MERGE-001'),
    });
  }

  function countryIdsOverlappingGeometry(geometry, excludeIds = []) {
    const clipper = window.polygonClipping;
    if (!geometry || !clipper?.intersection) return [];
    const excluded = new Set(excludeIds.map(String));
    const bounds = geometryBounds(geometry);
    return spatialFeatures(bounds)
      .filter(country => {
        const id = String(country.properties?.editor_id || '');
        return id && !excluded.has(id)
          && multiPolygonPlanarArea(clipper.intersection(geometry.coordinates, country.geometry.coordinates)) > 1e-14;
      })
      .map(country => String(country.properties.editor_id));
  }

  function geometryClippedToCurrentLand(geometry) {
    const clipper = window.polygonClipping;
    if (!geometry || !clipper?.intersection || !clipper?.union) return null;
    const pieces = [];
    const bounds = geometryBounds(geometry);
    for (const country of spatialFeatures(bounds)) {
      const overlap = clipper.intersection(geometry.coordinates, country.geometry.coordinates);
      if (overlap?.length) pieces.push(...overlap);
    }
    if (!pieces.length) return null;
    return normalizeClippedLandGeometry(pieces.length === 1 ? pieces : clipper.union(...pieces.map(polygon => [polygon])));
  }

  async function applySelectedDrawingToOwnerCountry() {
    if (state.selected?.domain !== 'drawing') return;
    const feature = state.drawings.find(item => String(item.id) === String(state.selected.id));
    const ownerId = String(feature?.properties?.pandolab_owner_id || '');
    const owner = countryFeatureById(ownerId);
    if (!feature || drawingGeometryKind(feature) !== 'polygon' || !owner) {
      setActionStatus('국가 영토에 반영할 수 없습니다. 면 객체의 소유 국가를 먼저 지정하세요.', 'error', 4000);
      return;
    }
    const transferredGeometry = geometryClippedToCurrentLand(feature.geometry);
    if (!transferredGeometry) {
      setActionStatus('국가 영토에 반영할 육지 영역이 없습니다. 형상과 소유 국가를 확인하세요.', 'error', 3800);
      return;
    }
    const donorIds = countryIdsOverlappingGeometry(transferredGeometry, [ownerId]);
    if (!requireCountriesUnlocked([ownerId, ...donorIds], '국가 영토에 반영')) return;
    if (!donorIds.length) {
      recordHistory();
      feature.geometry = normalizeClippedLandGeometry(window.polygonClipping.intersection(feature.geometry.coordinates, owner.geometry.coordinates)) || feature.geometry;
      normalizeDrawingSemantics(feature, { inferOwner: false });
      selectDrawing(String(feature.id), true);
      renderAll();
      queueAutosave();
      setActionStatus('영역이 이미 소유 국가 안에 있습니다. 국가 해안선 결합을 갱신했습니다.', 'success', 3400);
      return;
    }
    const snapshot = snapshotEditable();
    setActionStatus('영역을 국가 영토에 반영하는 중입니다.', 'working', 0);
    await transactCountryEdit({
      operation: 'annex',
      payload: { targetId: ownerId, donorIds, transferredGeometry },
      snapshot,
      applyResult: result => {
        applyWorkerCountryPatches(result);
        reindexCountries(state.countriesData, true);
        transferLandDependents(transferredGeometry, donorIds, ownerId);
        normalizeDrawingSemantics(feature, { inferOwner: false });
        refreshCountryCentroids(new Set(result.affectedIds));
        selectDrawing(String(feature.id), true);
        renderAll();
      },
      onSuccess: () => setActionStatus(`${drawingName(feature)} 영역을 ${countryName(countryFeatureById(ownerId))} 영토에 반영했습니다.`, 'success', 3800),
      onError: error => reportOperationError(error, '영역을 국가 영토에 반영하지 못했습니다. 소유 국가와 겹치는 범위를 확인하세요.', 'PL-LAND-001', 4600),
    });
  }

  async function promoteSelectedDrawingToCountry() {
    if (state.selected?.domain !== 'drawing') return;
    const feature = state.drawings.find(item => String(item.id) === String(state.selected.id));
    if (!feature || drawingGeometryKind(feature) !== 'polygon') {
      setActionStatus('국가로 전환할 수 없습니다. 면 객체를 선택하세요.', 'error', 3400);
      return;
    }
    const transferredGeometry = geometryClippedToCurrentLand(feature.geometry);
    const sourceIds = transferredGeometry ? countryIdsOverlappingGeometry(transferredGeometry) : [];
    if (!transferredGeometry || !sourceIds.length) {
      setActionStatus('국가로 전환할 육지 영역이 없습니다. 객체가 현재 국가 영토와 겹치는지 확인하세요.', 'error', 4000);
      return;
    }
    if (!requireCountriesUnlocked(sourceIds, '국가로 전환')) return;
    const name = String(feature.properties?.name || '').trim();
    if (!name) {
      setActionStatus('국가로 전환하기 전에 객체 이름을 입력하세요.', 'error', 3400);
      return;
    }
    const snapshot = snapshotEditable();
    const country = createCountryFeature(name, [], feature.properties?.editorColor || null, snapGeometryToGrid(transferredGeometry, 7));
    setActionStatus('영역을 국가로 전환하는 중입니다.', 'working', 0);
    await transactCountryEdit({
      operation: 'new-country',
      payload: { sourceIds, transferredGeometry, newFeature: country },
      snapshot,
      applyResult: result => {
        applyWorkerCountryPatches(result);
        transferLandDependents(transferredGeometry, sourceIds, country.properties.editor_id, [feature.id]);
        state.drawings = state.drawings.filter(item => String(item.id) !== String(feature.id));
        reindexCountries(state.countriesData, true);
        refreshCountryCentroids(new Set(result.affectedIds));
        selectCountry(country.properties.editor_id, false, false);
        renderAll();
      },
      onSuccess: () => setActionStatus(`${name} 영역을 독립 국가로 전환했습니다.`, 'success', 3600),
      onError: error => reportOperationError(error, '영역을 국가로 전환하지 못했습니다. 다른 국가와의 중첩과 형상을 확인하세요.', 'PL-LAND-002', 4600),
    });
  }

  function alignSelectedDrawingToOwnerLand() {
    if (state.selected?.domain !== 'drawing') return;
    const feature = state.drawings.find(item => String(item.id) === String(state.selected.id));
    const owner = countryFeatureById(feature?.properties?.pandolab_owner_id);
    if (!feature || !owner || drawingGeometryKind(feature) !== 'polygon') {
      setActionStatus('국가 육지에 맞출 수 없습니다. 면 객체의 소유 국가를 먼저 지정하세요.', 'error', 3800);
      return;
    }
    const next = normalizeClippedLandGeometry(window.polygonClipping.intersection(feature.geometry.coordinates, owner.geometry.coordinates));
    if (!next) {
      setActionStatus('객체와 소유 국가가 겹치지 않습니다. 소유 국가를 다시 지정하세요.', 'error', 3800);
      return;
    }
    recordHistory();
    feature.geometry = next;
    mapObjectGeometryRevisions.drawing += 1;
    feature.properties.pandolab_land_binding = 'hard';
    feature.properties.pandolab_topology_group = `land:${feature.properties.pandolab_owner_id}`;
    drawingLandClipCache.delete(feature);
    selectDrawing(String(feature.id), true);
    renderAll();
    queueAutosave();
    setActionStatus('객체를 소유 국가의 현재 육지와 맞췄습니다.', 'success', 3200);
  }

  function enterDrawingSplitMode(id) {
    const feature = state.drawings.find(item => String(item.id) === String(id));
    if (!feature || drawingGeometryKind(feature) !== 'polygon') return false;
    state.drawingSplitSourceId = String(id);
    setTool('split-drawing', false);
    state.drawingSplitSourceId = String(id);
    setModeBanner(defaultDraftInstruction());
    return true;
  }

  function enterDrawingMergeMode(id) {
    const feature = state.drawings.find(item => String(item.id) === String(id));
    if (!feature || drawingGeometryKind(feature) !== 'polygon') return false;
    state.drawingMergeSourceId = String(id);
    state.drawingMergeTargetIds = [];
    setTool('merge-drawing', false);
    state.drawingMergeSourceId = String(id);
    setModeBanner('합칠 영역을 선택하세요.');
    return true;
  }

  function toggleDrawingMergeTarget(id) {
    if (state.tool !== 'merge-drawing') return;
    const source = state.drawings.find(item => String(item.id) === String(state.drawingMergeSourceId));
    const target = state.drawings.find(item => String(item.id) === String(id));
    if (!source || !target || String(source.id) === String(target.id)) return;
    if (drawingRole(source) !== drawingRole(target) || drawingGeometryKind(target) !== 'polygon') {
      setActionStatus('같은 역할의 면 영역만 합칠 수 있습니다.', 'error', 3200);
      return;
    }
    if (['territory', 'administrative'].includes(drawingRole(source)) && String(source.properties?.pandolab_owner_id || '') !== String(target.properties?.pandolab_owner_id || '')) {
      setActionStatus('소유 국가가 같은 영역끼리만 합칠 수 있습니다.', 'error', 3400);
      return;
    }
    const targets = new Set(state.drawingMergeTargetIds.map(String));
    if (targets.has(String(id))) targets.delete(String(id)); else targets.add(String(id));
    state.drawingMergeTargetIds = [...targets];
    renderDrawings();
    updateModeButtons();
  }

  function completeDrawingMerge() {
    const source = state.drawings.find(item => String(item.id) === String(state.drawingMergeSourceId));
    const targets = state.drawingMergeTargetIds.map(id => state.drawings.find(item => String(item.id) === String(id))).filter(Boolean);
    if (!source || !targets.length) {
      setActionStatus('합칠 영역을 하나 이상 선택하세요.', 'error', 3000);
      return;
    }
    const merged = normalizeClippedLandGeometry(window.polygonClipping.union(source.geometry.coordinates, ...targets.map(item => item.geometry.coordinates)));
    if (!merged) {
      setActionStatus('선택한 영역을 합칠 수 없습니다. 형상을 확인하세요.', 'error', 3400);
      return;
    }
    const removed = new Set(targets.map(item => String(item.id)));
    const sourceAfter = deepClone(source);
    sourceAfter.geometry = merged;
    beginLocalGeometryPreview({
      operation: 'merge-drawing',
      beforeFeatures: [source, ...targets],
      afterFeatures: [sourceAfter],
      removedIds: [...removed],
      applyResult: () => {
        recordHistory();
        source.geometry = deepClone(merged);
        reassignDrawingParents([...removed], String(source.id));
        state.drawings = state.drawings.filter(item => !removed.has(String(item.id)));
        normalizeDrawingSemantics(source, { inferOwner: false });
        setTool('select', false);
        selectDrawing(String(source.id), true);
      },
      successMessage: `${targets.length + 1}개 영역을 하나로 합쳤습니다.`,
      errorMessage: '영역 합치기 결과를 적용하지 못했습니다.',
    });
  }

  function requestDraftDiscard(action) {
    if (!draftInputActive() || state.draftCoords.length < 3) {
      action?.();
      return true;
    }
    openConfirmModal({
      title: '그리기 취소',
      message: `작성 중인 점 ${state.draftCoords.length}개를 버리고 현재 그리기를 취소합니다.`,
      confirmText: '그리기 취소',
      cancelText: '계속 그리기',
      danger: true,
      onConfirm: () => action?.(),
    });
    return false;
  }

  function discardActiveDraftSilently() {
    if (!draftInputActive()) return;
    if (isDrawingDraftTool(state.tool)) cancelDraft(false);
    else cancelActiveMode(false);
  }

  function cancelDraft(showMessage = true) {
    const terrain = hydroToolConfig(state.tool);
    const splitSourceId = state.tool === 'split-drawing' ? state.drawingSplitSourceId : null;
    const territorialSplitSourceId = state.tool === 'split-territorial-unit' ? state.territorialUnitSplitSourceId : null;
    const territorialRedrawSourceId = state.tool === 'redraw-territorial-unit' ? state.territorialUnitRedrawSourceId : null;
    const directTerritorialUnit = state.tool === 'draw-territorial-unit';
    const distributionDraft = state.distributionDraft;
    state.distributionDraft = null;
    clearDraftInput(true);
    setTool('select', false);
    if (splitSourceId && state.drawings.some(item => String(item.id) === String(splitSourceId))) selectDrawing(String(splitSourceId), true);
    else if (territorialSplitSourceId && territorialUnitById(territorialSplitSourceId)) selectTerritorialUnit(territorialSplitSourceId, true);
    else if (territorialRedrawSourceId && territorialUnitById(territorialRedrawSourceId)) selectTerritorialUnit(territorialRedrawSourceId, true);
    renderAll();
    if (distributionDraft?.layerId && distributionLayerById(distributionDraft.layerId)) selectDistributionLayer(distributionDraft.layerId, true);
    if (showMessage) setActionStatus(distributionDraft ? '자유 분포 그리기를 취소했습니다.' : splitSourceId || territorialSplitSourceId || territorialRedrawSourceId || directTerritorialUnit ? '영역 작업을 취소했습니다.' : `${terrain?.label || '지형지물'} 추가를 취소했습니다.`, 'success');
  }

  function addLabelAt(coord) {
    const name = prompt('지명 또는 도시명을 입력하세요.', '새 지명');
    if (name === null) return;
    recordHistory();
    const label = { id: uid('label'), name: name.trim() || '새 지명', kind: 'city', coordinates: coord.slice(), notes: '' };
    state.labels.push(label);
    state.labelSettings[labelKey('label', label.id)] = automaticLabelSettings(label.kind, { pinned: false });
    exitLabelMode(false);
    selectLabel(label.id);
    renderAll();
    queueAutosave();
    setActionStatus(`${label.name} 지명을 추가했습니다.`, 'success');
  }

  function vertexDragBehavior(feature) {
    let blockedByCanonicalCoast = false;
    let beforeGeometry = null;
    const hydroEdit = isHydroEditFeature(feature);
    return d3.behavior.drag()
      .on('dragstart', function(vertex) {
        if (!feature || state.tool !== 'select') return;
        if (feature.properties?.locked === true) {
          blockedByCanonicalCoast = true;
          d3.event.sourceEvent?.stopPropagation?.();
          setActionStatus('잠금을 해제한 뒤 꼭짓점을 이동하세요.', 'error', 3200);
          return;
        }
        const owner = hydroEdit ? null : countryFeatureById(feature.properties?.pandolab_owner_id);
        blockedByCanonicalCoast = !hydroEdit && drawingLandBinding(feature) === 'hard' && owner
          ? pointOnGeometryBoundary(vertex.coord, owner.geometry, 0.00012)
          : false;
        if (blockedByCanonicalCoast) {
          d3.event.sourceEvent?.stopPropagation?.();
          setActionStatus('국가 해안선과 연결된 점입니다. 편집창의 해안 구간 수정을 사용하세요.', 'error', 3800);
          return;
        }
        beforeGeometry = deepClone(feature.geometry);
        recordHistory();
        d3.event.sourceEvent?.stopPropagation?.();
      })
      .on('drag', function(vertex) {
        if (!feature || state.tool !== 'select' || blockedByCanonicalCoast) return;
        const screenPoint = d3.mouse(svg.node());
        const rawCoord = screenToGeo(screenPoint);
        if (!rawCoord) return;
        const pointerType = d3.event.sourceEvent?.pointerType === 'touch' || d3.event.sourceEvent?.touches ? 'touch' : 'mouse';
        const coord = snapCoordinateForInput(rawCoord, screenPoint, pointerType, { excludeCoordinate: vertex.coord });
        setEditableVertexCoord(feature, vertex, coord);
        if (hydroEdit) hydroEditLayer.selectAll('path.hydro-edit-shape').attr('d', bound => path(bound));
        else drawingLayer.selectAll('path.drawing-shape').attr('d', bound => {
          const source = state.drawings.find(item => String(item.id) === String(bound.id));
          return source ? path(drawingDisplayFeature(source)) : '';
        });
        vertexLayer.selectAll('circle.vertex-handle').attr('transform', d => {
          const f = hydroEdit ? hydroEditById(state.selected?.id) : state.drawings.find(x => String(x.id) === state.selected?.id);
          const verts = getEditableVertices(f);
          const fresh = verts.find(v => v.key === d.key) || d;
          const p = activeProjection()(fresh.coord);
          return p ? `translate(${p[0]},${p[1]})` : 'translate(-9999,-9999)';
        });
      })
      .on('dragend', function() {
        if (!feature || blockedByCanonicalCoast) return;
        const owner = hydroEdit ? null : countryFeatureById(feature.properties?.pandolab_owner_id);
        if (!hydroEdit && drawingLandBinding(feature) === 'hard' && owner && drawingGeometryKind(feature) === 'polygon') {
          const clipped = normalizeClippedLandGeometry(window.polygonClipping.intersection(feature.geometry.coordinates, owner.geometry.coordinates));
          if (clipped) feature.geometry = clipped;
        }
        const issues = ['Polygon', 'MultiPolygon'].includes(feature.geometry?.type) ? validateStructuredGeometry(feature) : [];
        if (issues.length && beforeGeometry) {
          feature.geometry = beforeGeometry;
          historyService.discardLast();
          beforeGeometry = null;
          clearActiveSnap();
          renderAll();
          setActionStatus(issues[0].message || '유효하지 않은 geometry라 꼭짓점 이동을 되돌렸습니다.', 'error', 3800);
          return;
        }
        beforeGeometry = null;
        clearActiveSnap();
        renderAll();
        queueAutosave();
        setActionStatus('꼭짓점을 이동했습니다.', 'success');
      });
  }

  function boundaryTopologyPreviewTargets(nodeKey) {
    const topology = state.sharedBoundaryTopology;
    const precision = topology?.precision || 7;
    const node = topology?.nodes?.get?.(nodeKey);
    const currentNodeKey = node ? topologyNodeKey(node.coordinate, precision) : nodeKey;
    const endpoints = [];
    for (const segment of topology?.segments?.values?.() || []) {
      if (topologyNodeKey(segment.a, precision) === currentNodeKey) endpoints.push(segment.a);
      if (topologyNodeKey(segment.b, precision) === currentNodeKey) endpoints.push(segment.b);
    }
    return { node, endpoints };
  }

  function moveBoundaryTopologyPreviewTargets(targets, coordinate) {
    for (const endpoint of targets?.endpoints || []) {
      endpoint[0] = coordinate[0];
      endpoint[1] = coordinate[1];
    }
    if (!targets?.node) return;
    targets.node.coordinate[0] = coordinate[0];
    targets.node.coordinate[1] = coordinate[1];
  }

  function countryBoundaryVertexDragBehavior(feature) {
    let activeRefs = [];
    let affectedIds = new Set();
    let transactionSnapshot = null;
    let startCoord = null;
    let dragEnabled = false;
    let changed = false;
    let ownerBeforeGeometries = new Map();
    let validationBaseline = null;
    let structuredValidationBaseline = new Set();
    let activeNodeKey = null;
    let activePreviewTargets = null;
    let editTool = null;
    return d3.behavior.drag()
      .on('dragstart', function(vertex) {
        if (!feature || vertex.fixed || !['country-border', 'country-coast'].includes(state.tool)) return;
        dragEnabled = false;
        const node = state.sharedBoundaryTopology?.nodes?.get(vertex.nodeKey || coordKey(vertex.coord));
        if (!node) return;
        editTool = state.tool;
        const borderMode = editTool === 'country-border';
        const selectedIds = new Set(state.boundaryEditCountryIds.map(String));
        const coastId = String(state.coastEditCountryId || feature.properties.editor_id);
        const allowed = borderMode
          ? node.ownerIds.size >= 2 && [...node.ownerIds].every(id => selectedIds.has(String(id)))
          : node.kind === 'coast' && node.ownerIds.size === 1 && node.ownerIds.has(coastId);
        if (!allowed) return;
        const nextAffectedIds = borderMode ? new Set([...node.ownerIds].map(String)) : new Set([coastId]);
        if (!requireCountriesUnlocked([...nextAffectedIds], borderMode ? '국경을 조정' : '해안선을 조정')) return;
        transactionSnapshot = snapshotEditable();
        startCoord = node.coordinate.slice();
        changed = false;
        const selectedId = borderMode ? String(state.boundaryEditCountryIds[0] || feature.properties.editor_id) : coastId;
        affectedIds = nextAffectedIds;
        ownerBeforeGeometries = new Map([...affectedIds].map(id => [id, deepClone(countryFeatureById(id)?.geometry)]));
        structuredValidationBaseline = new Set([...affectedIds]
          .flatMap(id => validateStructuredGeometry(countryFeatureById(id)).filter(Boolean))
          .map(structuredGeometryIssueKey));
        validationBaseline = affectedIds.size > 1 ? captureCountryGeometryValidationBaseline(affectedIds) : null;
        const featureMap = new Map([...affectedIds].map(id => [id, countryFeatureById(id)]).filter(([, country]) => country));
        moveTopologyNode(featureMap, node, startCoord);
        rebuildBoundaryTopology(borderMode ? state.boundaryEditCountryIds : selectedId);
        const materializedNode = state.sharedBoundaryTopology?.nodes?.get(topologyNodeKey(startCoord, state.sharedBoundaryTopology?.precision || 7));
        activeNodeKey = materializedNode?.key || node.key;
        activePreviewTargets = boundaryTopologyPreviewTargets(activeNodeKey);
        activeRefs = (materializedNode?.refs || []).filter(ref => affectedIds.has(String(ref.featureId))).map(ref => ({
          countryId: String(ref.featureId),
          feature: countryFeatureById(ref.featureId),
          vertex: { polygonIndex: ref.polygonIndex, ringIndex: ref.ringIndex, index: ref.vertexIndex },
        })).filter(ref => ref.feature);
        if (!activeRefs.length) activeRefs = [{ countryId: selectedId, feature, vertex }];
        dragEnabled = true;
        d3.event.sourceEvent?.stopPropagation?.();
      })
      .on('drag', function() {
        if (!feature || state.tool !== editTool || !dragEnabled) return;
        const screenPoint = d3.mouse(svg.node());
        const rawCoord = screenToGeo(screenPoint);
        if (!rawCoord) return;
        const pointerType = d3.event.sourceEvent?.pointerType === 'touch' || d3.event.sourceEvent?.touches ? 'touch' : 'mouse';
        const coord = snapCoordinateForInput(rawCoord, screenPoint, pointerType, { excludeNodeKey: activeNodeKey });
        changed = changed || !coordNear(startCoord, coord, 1e-9);
        for (const ref of activeRefs) setCountryVertexCoord(ref.feature, ref.vertex, coord);
        moveBoundaryTopologyPreviewTargets(activePreviewTargets, coord);
        countryLayer.selectAll('path.country-shape').attr('d', path);
        mapRenderCoordinator.advanceRevision();
        gpuMapRenderer.render(viewRevision);
        boundaryEditLayer.selectAll('path.boundary-edit-segment')
          .attr('d', d => path({ type: 'Feature', geometry: d.geometry, properties: {} }));
        vertexLayer.selectAll('circle.vertex-handle').attr('transform', d => {
          const activeRef = d.nodeKey === activeNodeKey
            ? activeRefs.find(ref => String(ref.countryId) === String(editTool === 'country-border' ? state.boundaryEditCountryIds[0] : state.coastEditCountryId)) || activeRefs[0]
            : null;
          const fresh = activeRef ? countryRingForVertex(activeRef.feature, activeRef.vertex)?.[activeRef.vertex.index] : d.coord;
          const p = activeProjection()(fresh);
          return p ? `translate(${p[0]},${p[1]})` : 'translate(-9999,-9999)';
        });
      })
      .on('dragend', function() {
        if (!feature || state.tool !== editTool || !dragEnabled || !transactionSnapshot) return;
        const snapshot = transactionSnapshot;
        const borderMode = editTool === 'country-border';
        dragEnabled = false;
        transactionSnapshot = null;
        activePreviewTargets = null;
        try {
          if (!changed) {
            renderAll();
            return;
          }
          for (const id of affectedIds) {
            const current = countryFeatureById(id);
            const beforeGeometry = ownerBeforeGeometries.get(id);
            if (current && beforeGeometry) syncHardLandDependents(id, beforeGeometry, current.geometry, startCoord);
          }
          markCountryGeometriesChanged(affectedIds);
          refreshCountryCentroids(affectedIds);
          rebuildBoundaryTopology(borderMode ? state.boundaryEditCountryIds : state.coastEditCountryId);
          const structuredIssues = [...affectedIds]
            .flatMap(id => validateStructuredGeometry(countryFeatureById(id)).filter(Boolean))
            .filter(issue => !structuredValidationBaseline.has(structuredGeometryIssueKey(issue)));
          if (structuredIssues.length) throw new Error(structuredIssues[0].message);
          const validation = validateCountryGeometryEdit(affectedIds, validationBaseline);
          if (!validation.ok) throw new Error(validation.message);
          commitHistorySnapshot(snapshot);
          renderAll();
          queueAutosave();
          if (borderMode) {
            setModeBanner('공유국경 꼭짓점을 드래그하세요. 외부 접점은 고정됩니다.');
            setActionStatus(`${affectedIds.size}개 국가의 공유국경을 함께 수정했습니다.`, 'success');
          } else {
            setModeBanner(state.coastEditScopeDrawingId
              ? '해안선 꼭짓점을 드래그하세요. 연결 영역도 함께 변경됩니다.'
              : '해안선 꼭짓점을 드래그하세요. 국경 접점은 고정됩니다.');
            setActionStatus('해안선을 수정했습니다.', 'success');
          }
        } catch (error) {
          restoreCountryEditSnapshot(snapshot);
          reportOperationError(error, borderMode
            ? '공유국경을 이동하지 못해 변경을 되돌렸습니다. 중첩·빈틈·자기 교차가 생기지 않는 위치로 다시 이동하세요.'
            : '해안선을 이동하지 못해 변경을 되돌렸습니다. 중첩·빈틈·자기 교차가 생기지 않는 위치로 다시 이동하세요.', borderMode ? 'PL-BORDER-001' : 'PL-COAST-001', 4300);
        }
      });
  }

  function labelDragBehavior() {
    return d3.behavior.drag()
      .on('dragstart', function() {
        if (state.tool !== 'select') return;
        recordHistory();
        d3.event.sourceEvent?.stopPropagation?.();
      })
      .on('drag', function(label) {
        if (state.tool !== 'select') return;
        const coord = screenToGeo(d3.mouse(svg.node()));
        if (!coord) return;
        label.coordinates = coord;
        const p = activeProjection()(coord);
        d3.select(this).attr('transform', `translate(${p[0]},${p[1]})`);
      })
      .on('dragend', function(label) {
        if (state.tool !== 'select') return;
        state.labelSettings[labelKey('label', label.id)] = normalizeLabelSettings({
          ...(state.labelSettings[labelKey('label', label.id)] || {}),
          manualPosition: label.coordinates,
          pinned: true,
        });
        mapObjectGeometryRevisions.label += 1;
        renderAll();
        queueAutosave();
        setActionStatus(`${label.name} 지명을 이동했습니다.`, 'success');
      });
  }

  function setEditorShellView(view) {
    const actions = view === 'actions' && !$('actionsTabBtn')?.hidden;
    $('rightPanel')?.setAttribute('data-editor-view', actions ? 'actions' : 'info');
    $('editorTabBtn')?.classList.toggle('active', !actions);
    $('actionsTabBtn')?.classList.toggle('active', actions);
    $('editorTabBtn')?.setAttribute('aria-selected', String(!actions));
    $('actionsTabBtn')?.setAttribute('aria-selected', String(actions));
    if ($('editorTabBtn')) $('editorTabBtn').tabIndex = actions ? -1 : 0;
    if ($('actionsTabBtn')) $('actionsTabBtn').tabIndex = actions ? 0 : -1;
  }

  const PROPERTY_TYPE_LABELS = Object.freeze({
    country: '국가', territory: '권역', administrative: '행정구역', region: '지방',
    distribution: '분포', drawing: '지형지물', label: '지명', hydro: '강·호수', multi: '다중선택',
  });

  function activePropertyForm(type) {
    return type ? $({
      country: 'countryProperties', territory: 'territoryProperties', administrative: 'administrativeProperties',
      region: 'regionProperties', distribution: 'distributionProperties', drawing: 'drawingProperties',
      label: 'labelProperties', hydro: 'hydroProperties', multi: 'multiProperties',
    }[type]) : null;
  }

  function syncEditorActionTab(type) {
    const form = activePropertyForm(type);
    const available = !!form && [...form.children].some(element => element.matches?.('.editor-action-section') && !element.hidden);
    $('actionsTabBtn').hidden = !available;
    $('actionsTabBtn').setAttribute('aria-disabled', String(!available));
    if (!available) setEditorShellView('info');
  }

  function showPropertyForm(type, title = '', { resetScroll = true, typeLabel = '' } = {}) {
    if (type && resetScroll) setEditorShellView('info');
    $('emptyProperties').classList.toggle('hidden', !!type);
    $('editorObjectHeader').classList.toggle('hidden', !type);
    document.querySelector('.editor-view-tabs')?.classList.toggle('hidden', !type);
    $('editSheetTitle')?.classList.toggle('hidden', !!type);
    $('rightPanel')?.setAttribute('aria-labelledby', type ? 'editorObjectHeading' : 'editSheetTitle');
    $('countryProperties').classList.toggle('hidden', type !== 'country');
    $('territoryProperties').classList.toggle('hidden', type !== 'territory');
    $('administrativeProperties').classList.toggle('hidden', type !== 'administrative');
    $('regionProperties').classList.toggle('hidden', type !== 'region');
    $('distributionProperties').classList.toggle('hidden', type !== 'distribution');
    $('drawingProperties').classList.toggle('hidden', type !== 'drawing');
    $('labelProperties').classList.toggle('hidden', type !== 'label');
    $('hydroProperties').classList.toggle('hidden', type !== 'hydro');
    $('multiProperties')?.classList.toggle('hidden', type !== 'multi');
    $('propertyTitle').textContent = type ? String(title || '') : '';
    const visibleTypeLabel = typeLabel || (type ? PROPERTY_TYPE_LABELS[type] || type : '');
    if ($('propertyTypeLabel')) $('propertyTypeLabel').textContent = visibleTypeLabel;
    const fullTitle = type ? `${String(title || '')}, ${visibleTypeLabel}` : '';
    document.querySelector('.editor-object-heading')?.setAttribute('aria-label', fullTitle);
    if (type) syncObjectActionsMenu();
    else closeObjectActionsMenu();
    syncEditorActionTab(type);
    if (resetScroll && $('editorScrollBody')) $('editorScrollBody').scrollTop = 0;
    syncStatusBar();
  }

  function renderFlag(dataUrl) {
    const preview = $('flagPreview');
    preview.innerHTML = '';
    if (!dataUrl) {
      preview.textContent = '국기 없음';
      $('flagRemoveBtn')?.classList.add('hidden');
      return;
    }
    $('flagRemoveBtn')?.classList.remove('hidden');
    const img = document.createElement('img');
    img.src = dataUrl;
    img.alt = '등록된 국기';
    preview.appendChild(img);
  }

  function geometryAreaStatusSuffix(geometry) {
    return ['Polygon', 'MultiPolygon'].includes(geometry?.type) ? ` · ${formatArea(displayGeometryAreaKm2(geometry))}` : '';
  }

  function displayGeometryAreaKm2(geometry) {
    if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) return 0;
    if (geometryAreaDisplayCache.has(geometry)) return geometryAreaDisplayCache.get(geometry);
    const value = sphericalGeometryAreaKm2(geometry);
    geometryAreaDisplayCache.set(geometry, value);
    return value;
  }

  function updateSelectedCountryAreaWhenIdle(feature, id, displayName) {
    const geometry = feature?.geometry;
    if (!geometry || pendingCountryAreaDisplay.has(geometry)) return;
    pendingCountryAreaDisplay.add(geometry);
    const calculate = () => {
      const areaKm2 = displayGeometryAreaKm2(geometry);
      pendingCountryAreaDisplay.delete(geometry);
      if (!(state.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY) || String(state.selected.id) !== String(id) || countryFeatureById(id)?.geometry !== geometry) return;
      $('countryAreaValue').textContent = formatArea(areaKm2);
      $('selectionStatus').textContent = `국가 · ${displayName} · ${formatArea(areaKm2)}`;
      syncStatusBar();
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(calculate, { timeout: 800 });
    else setTimeout(calculate, 0);
  }

  function selectCountry(id, refreshOnly = false, shouldRender = true) {
    const idx = state.countryIndex.get(String(id));
    if (idx === undefined) return;
    const feature = state.countriesData.features[idx];
    const p = feature.properties || {};
    const override = state.countryOverrides[id] || {};
    const displayName = override.name || p.editor_name || p.editor_original_name || id;
    state.selected = countryObjectRef(id);
    syncObjectSelection(state.selected);
    showPropertyForm('country', displayName, { resetScroll: !refreshOnly });
    $('countryNameInput').value = override.name || p.editor_name || p.editor_original_name || '';
    $('countryCodeInput').textContent = id;
    const color = readDomainColor(COLOR_DOMAINS.COUNTRY, { feature, override }, { fallback: defaultCountryColor() });
    $('countryColorInput').value = color.value;
    syncColorPicker('country', { value: color.value, defaultColor: defaultCountryColor(), isDefault: color.isDefault });
    $('capitalInput').value = override.capital || p.capital || '';
    $('notesInput').value = override.notes || p.notes || '';
    $('originalNameValue').textContent = p.editor_original_name || p.editor_name || '—';
    renderFlag(override.flagDataUrl || p.flagDataUrl || null);
    const hasCachedArea = geometryAreaDisplayCache.has(feature.geometry);
    const areaKm2 = hasCachedArea ? geometryAreaDisplayCache.get(feature.geometry) : null;
    $('countryAreaValue').textContent = hasCachedArea ? formatArea(areaKm2) : '면적 계산 중…';
    $('countryAreaValue').dataset.tooltip = '구면 근사 면적이며 고정밀 GIS 측정값과 차이가 날 수 있습니다.';
    $('selectionStatus').textContent = hasCachedArea ? `국가 · ${displayName} · ${formatArea(areaKm2)}` : `국가 · ${displayName}`;
    if (!hasCachedArea) updateSelectedCountryAreaWhenIdle(feature, id, displayName);
    syncStatusBar();
    syncCountryActionButtons();
    if (!refreshOnly) openSelectionEditor();
    if (shouldRender) mapRenderCoordinator.invalidate(
      MAP_RENDER_DIRTY.DYNAMIC_OVERLAYS | MAP_RENDER_DIRTY.SELECTION_DATA | MAP_RENDER_DIRTY.LABEL_LAYOUT | MAP_RENDER_DIRTY.HUD,
      'select-country',
    );
  }

  function replaceSelectOptions(select, options, selectedValue = '') {
    if (!select) return;
    select.replaceChildren(...options.map(option => {
      const element = document.createElement('option');
      element.value = String(option.value ?? '');
      element.textContent = String(option.label ?? option.value ?? '');
      if (option.searchText) element.dataset.searchText = String(option.searchText);
      return element;
    }));
    select.value = String(selectedValue || '');
  }

  function territorialUnitCountryOptions() {
    return [
      { value: '', label: '소속 국가 미지정' },
      ...(state.countriesData?.features || []).map(feature => {
        const properties = feature.properties || {};
        return {
          value: String(properties.editor_id || ''),
          label: countryName(feature),
          searchText: [properties.editor_original_name, properties.name, properties.iso_a3, properties.editor_id].filter(Boolean).join(' '),
        };
      }).sort((a, b) => layerNameCollator.compare(a.label, b.label)),
    ];
  }

  function territorialUnitParentOptions(feature) {
    const countryId = String(feature?.properties?.sovereignId || '');
    const excluded = new Set([String(feature?.id || '')]);
    const queue = [...excluded];
    while (queue.length) {
      const current = queue.shift();
      for (const child of territorialChildren(state.territorialUnits, current)) {
        if (excluded.has(String(child.id))) continue;
        excluded.add(String(child.id));
        queue.push(String(child.id));
      }
    }
    return [
      { value: countryId, label: '국가 직속' },
      ...state.territorialUnits.filter(candidate => !excluded.has(String(candidate.id))
        && String(candidate.properties?.sovereignId || '') === countryId)
        .map(candidate => ({
          value: String(candidate.id),
          label: `${territorialUnitName(candidate)}${candidate.properties?.unitType === TERRITORIAL_UNIT_TYPES.ADMIN ? ` · ${candidate.properties.adminLevel}급` : ' · 권역'}`,
        }))
        .sort((a, b) => layerNameCollator.compare(a.label, b.label)),
    ];
  }

  function territorialParentOptions(feature) {
    const excluded = new Set([String(feature?.id || '')]);
    const queue = [...excluded];
    while (queue.length) {
      const current = queue.shift();
      for (const child of territorialChildren(state.territorialUnits, current)) {
        if (excluded.has(String(child.id))) continue;
        excluded.add(String(child.id));
        queue.push(String(child.id));
      }
    }
    return [
      { value: '', label: '상위 영역 없음' },
      ...territorialRepository.list()
        .filter(candidate => !excluded.has(String(candidate.id)))
        .map(candidate => ({
          value: String(candidate.id),
          label: `${candidate.properties?.name || territorialUnitName(candidate)} · ${territorialTypeLabel(candidate.properties?.unitType)}`,
        }))
        .sort((left, right) => layerNameCollator.compare(left.label, right.label)),
    ];
  }

  function selectTerritorialUnit(id, refreshOnly = false) {
    const feature = territorialUnitById(id);
    if (!feature) return;
    const properties = feature.properties || {};
    const administrative = properties.unitType === TERRITORIAL_UNIT_TYPES.ADMIN;
    const region = properties.unitType === TERRITORIAL_UNIT_TYPES.REGION;
    const formType = administrative ? 'administrative' : region ? 'region' : 'territory';
    const displayName = territorialUnitName(feature);
    state.selected = normalizeObjectRef({ domain: 'territorial', type: properties.unitType, id: String(feature.id) });
    syncObjectSelection(state.selected);
    showPropertyForm(formType, displayName, { resetScroll: !refreshOnly });
    const prefix = administrative ? 'administrative' : region ? 'region' : 'territory';
    const normalizedName = String(properties.name || '').trim().toLocaleLowerCase('ko');
    const hasNameConflict = !!normalizedName && state.territorialUnits.some(candidate => candidate.id !== feature.id
      && candidate.properties?.unitType === properties.unitType
      && String(candidate.properties?.sovereignId || '') === String(properties.sovereignId || '')
      && String(candidate.properties?.name || '').trim().toLocaleLowerCase('ko') === normalizedName);
    $(`${prefix}NameConflict`).classList.toggle('hidden', !hasNameConflict);
    $(`${prefix}NameInput`).value = properties.name || '';
    replaceSelectOptions($(`${prefix}CountryInput`), territorialUnitCountryOptions(), properties.sovereignId);
    const inheritedColor = territorialUnitColor({ ...feature, properties: { ...properties, style: {} } });
    const color = readDomainColor(COLOR_DOMAINS.TERRITORIAL, { feature }, { inherited: inheritedColor, fallback: DEFAULT_DRAWING_COLOR });
    $(`${prefix}ColorInput`).value = color.value;
    syncColorPicker(prefix, { value: color.value, defaultColor: inheritedColor, isDefault: color.isDefault });
    $(`${prefix}NotesInput`).value = properties.notes || '';
    const actionIds = region
      ? ['reassignRegionShapeBtn', 'mergeRegionBtn', 'transferRegionBtn']
      : administrative
      ? ['splitAdministrativeBtn', 'mergeAdministrativeBtn', 'reassignAdministrativeShapeBtn', 'reconcileAdministrativeCoastBtn', 'transferAdministrativeBtn', 'promoteAdministrativeBtn', 'changeAdministrativeTypeBtn', 'removeAdministrativeDivisionBtn']
      : ['splitTerritoryBtn', 'mergeTerritoryBtn', 'reassignTerritoryShapeBtn', 'transferTerritoryBtn', 'promoteTerritoryBtn', 'changeTerritoryTypeBtn', 'removeTerritoryDivisionBtn'];
    for (const actionId of actionIds) $(actionId).disabled = properties.locked === true;
    if (administrative) {
      replaceSelectOptions($('administrativeParentInput'), territorialUnitParentOptions(feature), properties.parentId);
      $('administrativeLevelValue').textContent = `${Number(properties.adminLevel) || 1}급`;
    } else if (region) {
      replaceSelectOptions($('regionParentInput'), territorialParentOptions(feature), properties.parentId);
      $('regionValidFromInput').value = properties.validFrom || '';
      $('regionValidToInput').value = properties.validTo || '';
    }
    $('selectionStatus').textContent = administrative
      ? `행정구역 · ${territorialUnitCountryName(feature)} · ${Number(properties.adminLevel) || 1}급 · ${displayName}`
      : region
        ? `지방 · ${displayName}`
        : `권역 · ${territorialUnitCountryName(feature)} · ${displayName}`;
    $('selectionStatus').textContent += geometryAreaStatusSuffix(feature.geometry);
    syncStatusBar();
    syncLayerSelectionRows();
    renderAll();
    if (!refreshOnly) openSelectionEditor();
  }

  function distributionLayerById(id) {
    return distributionService.getLayer(id);
  }

  function distributionTerritorialUnitOptions() {
    return territorialRepository.list().map(unit => ({
      value: unit.id,
      label: `${unit.properties?.name || unit.id} · ${territorialTypeLabel(unit.properties?.unitType)}`,
    })).sort((left, right) => layerNameCollator.compare(left.label, right.label));
  }

  function distributionParentOptions(layer) {
    return [
      { value: '', label: '상위 분류 없음' },
      ...distributionService.parentCandidates(layer.id).map(candidate => ({
        value: candidate.id,
        label: candidate.name,
      })).sort((left, right) => layerNameCollator.compare(left.label, right.label)),
    ];
  }

  function distributionEntryLabel(entry) {
    if (entry.mode === DISTRIBUTION_MODES.TERRITORIAL) return territorialRepository.get(entry.territorialUnitId)?.properties?.name || entry.territorialUnitId;
    return '자유 영역';
  }

  function renderDistributionEntryList(layer) {
    const container = $('distributionEntryList');
    const entries = distributionEntriesForLayer(state.distributionEntries, layer.id);
    if (!entries.length) {
      container.replaceChildren(createEmptyState('아직 분포가 없습니다.', '기준 영역을 선택하거나 자유 영역을 그리세요.', { compact: true }));
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const entry of entries) {
      const row = document.createElement('div');
      row.className = 'ui-row ui-card distribution-entry-row';
      const label = document.createElement('span');
      label.innerHTML = '<strong></strong><small></small>';
      label.querySelector('strong').textContent = distributionEntryLabel(entry);
      label.querySelector('small').textContent = `${entry.mode === DISTRIBUTION_MODES.TERRITORIAL ? '영역 참조' : '자유 형상'} · ${Math.round(entry.share)}%`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ui-button icon-btn distribution-entry-delete';
      remove.dataset.distributionEntryDelete = entry.id;
      remove.setAttribute('aria-label', `${distributionEntryLabel(entry)} 분포 삭제`);
      remove.append(createSvgIcon(document, 'icon-trash'));
      remove.disabled = layer.locked;
      row.append(label, remove);
      fragment.appendChild(row);
    }
    container.replaceChildren(fragment);
  }

  function selectDistributionLayer(id, refreshOnly = false) {
    const layer = distributionLayerById(id);
    if (!layer) return false;
    state.selected = normalizeObjectRef({ domain: 'distribution', type: layer.type, id: layer.id });
    syncObjectSelection(state.selected);
    state.selectedDistributionLayerId = layer.id;
    showPropertyForm('distribution', layer.name, { resetScroll: !refreshOnly });
    $('distributionNameInput').value = layer.name;
    $('distributionTypeValue').textContent = DISTRIBUTION_TYPE_LABELS[layer.type] || layer.type;
    const color = readDomainColor(COLOR_DOMAINS.DISTRIBUTION, { layer }, { fallback: DEFAULT_DRAWING_COLOR });
    $('distributionColorInput').value = color.value;
    syncColorPicker('distribution', { value: color.value, defaultColor: DEFAULT_DRAWING_COLOR, isDefault: color.isDefault });
    replaceSelectOptions($('distributionParentInput'), distributionParentOptions(layer), layer.parentId);
    replaceSelectOptions($('distributionTerritorialUnitInput'), distributionTerritorialUnitOptions(), $('distributionTerritorialUnitInput').value);
    $('distributionLockedInput').checked = layer.locked;
    $('distributionRenderModeInput').value = state.distributionSettings.renderMode;
    for (const idValue of ['distributionNameInput', 'distributionColorTrigger', 'distributionParentInput', 'addTerritorialDistributionBtn', 'addGeometryDistributionBtn']) $(idValue).disabled = layer.locked;
    renderDistributionEntryList(layer);
    $('selectionStatus').textContent = `${DISTRIBUTION_TYPE_LABELS[layer.type]} · ${layer.name}`;
    syncStatusBar();
    syncLayerSelectionRows();
    renderAll();
    if (!refreshOnly) openSelectionEditor();
    return true;
  }

  function commitDistributionMeta(field, value) {
    if (state.selected?.domain !== 'distribution') return false;
    const layer = distributionLayerById(state.selected.id);
    if (!layer) return false;
    if (layer.locked && field !== 'locked') {
      setActionStatus('잠금을 해제한 뒤 분포 항목을 변경할 수 있습니다.', 'error', 3200);
      selectDistributionLayer(layer.id, true);
      return false;
    }
    const result = distributionService.updateLayer(layer.id, field, value);
    if (!result.ok) {
      if (result.code === 'invalid') setActionStatus('자기 자신이나 하위 분류를 상위 분류로 설정할 수 없습니다.', 'error', 3600);
      selectDistributionLayer(layer.id, true);
      return false;
    }
    if (field === 'locked') syncObjectLockStateChange([{ domain: 'distribution', type: layer.type, id: layer.id }]);
    else markLayerTreeDirty();
    selectDistributionLayer(layer.id, true);
    queueAutosave();
    setActionStatus(`${DISTRIBUTION_TYPE_LABELS[layer.type]} 정보를 변경했습니다.`, 'success');
    return true;
  }

  function createDistributionLayerFromPrompt(type) {
    const label = DISTRIBUTION_TYPE_LABELS[type];
    const name = prompt(`새 ${label} 항목의 이름을 입력하세요.`, `새 ${label}`);
    if (name === null) return false;
    const layer = distributionService.createLayer({
      id: uid(`distribution_${type}`),
      type,
      name: name.trim() || `새 ${label}`,
      color: COLOR_PRESETS[state.distributionLayers.length % COLOR_PRESETS.length] || DEFAULT_DRAWING_COLOR,
    });
    state.layerFolders = Object.fromEntries(activeLayerFolderKeys().map(key => [key, key === DISTRIBUTION_TYPE_GROUPS[type]]));
    markLayerTreeDirty();
    renderLayerTree(true);
    selectDistributionLayer(layer.id);
    queueAutosave();
    setActionStatus(`${layer.name} ${label} 항목을 추가했습니다. 분포를 이어서 입력하세요.`, 'success', 3600);
    return true;
  }

  function addTerritorialDistributionEntry() {
    const layer = state.selected?.domain === 'distribution' ? distributionLayerById(state.selected.id) : null;
    const territorialUnitId = $('distributionTerritorialUnitInput').value;
    if (!layer || layer.locked || !territorialRepository.get(territorialUnitId)) return false;
    let entry;
    try {
      entry = createDistributionEntry({
        id: uid(),
        layerId: layer.id,
        mode: DISTRIBUTION_MODES.TERRITORIAL,
        territorialUnitId,
        share: Number($('distributionShareInput').value),
      });
    } catch (error) {
      const validationMessage = compactNotificationMessage(error?.message || '분포 정보를 검증하지 못했습니다.', { tone: 'error', maxLength: 52 });
      setActionStatus(validationMessage, 'error', 0);
      return false;
    }
    const result = distributionService.addEntry(entry);
    if (!result.ok) return false;
    selectDistributionLayer(layer.id, true);
    queueAutosave();
    setActionStatus(`${distributionEntryLabel(result.entry)}에 ${layer.name} 분포를 추가했습니다.`, 'success');
    return true;
  }

  function startGeometryDistributionDraft() {
    const layer = state.selected?.domain === 'distribution' ? distributionLayerById(state.selected.id) : null;
    if (!layer || layer.locked) return false;
    const share = Number($('distributionShareInput').value);
    if (!Number.isFinite(share) || share < 0 || share > 100) {
      setActionStatus('분포 비율은 0~100 범위의 숫자여야 합니다.', 'error', 0);
      return false;
    }
    state.distributionDraft = { layerId: layer.id, share };
    setTool('polygon', false);
    setModeBanner('분포 영역을 그리세요.');
    return true;
  }

  function removeDistributionEntry(id) {
    const entry = state.distributionEntries.find(candidate => candidate.id === String(id));
    const layer = entry ? distributionLayerById(entry.layerId) : null;
    if (!entry || !layer || layer.locked) return false;
    const result = distributionService.removeEntry(entry.id);
    if (!result.ok) return false;
    selectDistributionLayer(layer.id, true);
    queueAutosave();
    setActionStatus('분포 엔트리를 삭제했습니다.', 'success');
    return true;
  }

  function deleteDistributionLayer(id, { confirm = true } = {}) {
    const layer = distributionLayerById(id);
    if (!layer) return false;
    if (layer.locked) {
      setActionStatus('잠금을 해제한 뒤 분포 항목을 삭제할 수 있습니다.', 'error', 3200);
      return false;
    }
    const performDelete = () => {
      const result = distributionService.deleteLayer(layer.id);
      if (!result.ok) return false;
      if (state.selectedDistributionLayerId === layer.id) state.selectedDistributionLayerId = '';
      markLayerTreeDirty();
      clearSelection(false);
      renderAll();
      queueAutosave();
      setActionStatus(`${layer.name} ${DISTRIBUTION_TYPE_LABELS[layer.type]} 항목을 삭제했습니다.`, 'success');
      return true;
    };
    if (!confirm) {
      performDelete();
      return true;
    }
    openConfirmModal({
      title: `${DISTRIBUTION_TYPE_LABELS[layer.type]} 삭제`,
      message: `${layer.name}과 연결된 분포 ${distributionEntriesForLayer(state.distributionEntries, layer.id).length}개를 함께 삭제합니다.`,
      impacts: [`${DISTRIBUTION_TYPE_LABELS[layer.type]} 항목 1개 삭제`, `연결된 분포 ${distributionEntriesForLayer(state.distributionEntries, layer.id).length}개 삭제`],
      confirmText: '분포 항목 삭제',
      danger: true,
      onConfirm: performDelete,
    });
    return true;
  }

  function setDistributionLayerVisible(id, visible) {
    const layer = distributionLayerById(id);
    if (!layer) return false;
    const group = DISTRIBUTION_TYPE_GROUPS[layer.type];
    if (!state.itemVisibility[group]) state.itemVisibility[group] = {};
    if (visible === false) state.itemVisibility[group][layer.id] = false;
    else delete state.itemVisibility[group][layer.id];
    distributionVisibilityRevision += 1;
    markLayerTreeDirty();
    renderAll();
    queuePresentationAutosave();
    return true;
  }

  function selectTerritorialObject(type, id, refreshOnly = false, shouldRender = true) {
    const unitType = String(type || territorialUnitById(id)?.properties?.unitType || '');
    if (unitType === TERRITORIAL_UNIT_TYPES.COUNTRY) {
      selectCountry(id, refreshOnly, shouldRender);
      return true;
    }
    const unit = territorialUnitById(id);
    if (!unit || unit.properties?.unitType !== unitType) return false;
    selectTerritorialUnit(id, refreshOnly);
    return true;
  }

  function setTerritorialUnitName(type, id, name) {
    if (!selectTerritorialObject(type, id, true, false)) return false;
    if (type === TERRITORIAL_UNIT_TYPES.COUNTRY) commitCountryEdit('name', name);
    else commitTerritorialUnitMeta('name', name);
    return true;
  }

  function setTerritorialUnitColor(type, id, color) {
    if (!selectTerritorialObject(type, id, true, false)) return false;
    if (type === TERRITORIAL_UNIT_TYPES.COUNTRY) commitCountryEdit('color', color);
    else commitTerritorialUnitMeta('color', color);
    return true;
  }

  function setTerritorialUnitLocked(type, id, locked) {
    const key = String(id || '');
    const result = territorialApplicationService.setLocked(type, key, locked, {
      history: type === TERRITORIAL_UNIT_TYPES.COUNTRY
        ? { description: `${countryName(countryFeatureById(key))} ${locked ? '잠금' : '잠금 해제'}` }
        : {},
    });
    if (!result.ok) return false;
    if (!result.changed) return true;
    syncObjectLockStateChange([{ domain: 'territorial', type, id: key }]);
    if (type === TERRITORIAL_UNIT_TYPES.COUNTRY) {
      if ((state.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY) && String(state.selected.id) === key) selectCountry(key, true);
      syncBatchActionAvailability();
    } else selectTerritorialUnit(key, true);
    queueAutosave();
    return true;
  }

  window.PANDOLAB_TERRITORIAL = Object.freeze({
    get: id => territorialApplicationService.get(id),
    list: options => territorialApplicationService.list(options),
    select: selectTerritorialObject,
    setName: setTerritorialUnitName,
    setColor: setTerritorialUnitColor,
    setLocked: setTerritorialUnitLocked,
    isLocked: (type, id) => territorialApplicationService.isLocked(type, id),
  });

  window.PANDOLAB_DISTRIBUTIONS = Object.freeze({
    getLayer: id => distributionLayerById(id),
    listLayers: type => distributionService.listLayers(type),
    listEntries: layerId => distributionService.listEntries(layerId),
    select: selectDistributionLayer,
    setVisible: setDistributionLayerVisible,
  });

  function syncDrawingSemanticEditor(feature) {
    const geometryKind = drawingGeometryKind(feature);
    const role = drawingRole(feature);
    const editableArea = geometryKind === 'polygon' && role === 'custom';
    const hasOwnerCountry = !!countryFeatureById(feature?.properties?.pandolab_owner_id);
    $('drawingLandRelationSection').classList.toggle('hidden', !editableArea);
    $('drawingLandActionsSection').classList.toggle('hidden', !editableArea);
    $('drawingOwnerField').classList.add('hidden');
    $('drawingParentField').classList.add('hidden');
    $('drawingLandBindingField').classList.toggle('hidden', !editableArea);
    $('splitDrawingBtn').classList.toggle('hidden', !editableArea);
    $('mergeDrawingBtn').classList.toggle('hidden', !editableArea);
    for (const id of ['syncDrawingCoastBtn', 'editDrawingCoastBtn', 'applyDrawingToCountryBtn', 'promoteDrawingToCountryBtn']) $(id).classList.toggle('hidden', !editableArea);
    for (const id of ['syncDrawingCoastBtn', 'editDrawingCoastBtn', 'applyDrawingToCountryBtn']) {
      const button = $(id);
      button.disabled = editableArea && !hasOwnerCountry;
      if (button.disabled) button.dataset.tooltip = '소유 국가가 지정된 영역에서 사용할 수 있습니다.';
      else delete button.dataset.tooltip;
    }
    $('promoteDrawingToCountryBtn').disabled = !editableArea;
    $('drawingLandBindingInput').value = drawingLandBinding(feature);
    $('drawingRoleHelp').textContent = drawingRoleHelp(feature);
    $('drawingRoleValue').textContent = DRAWING_ROLE_LABELS[role] || role;
    $('drawingTopologyValue').textContent = feature.properties?.pandolab_topology_group || '—';
  }

  function selectDrawing(id, refreshOnly = false) {
    const feature = state.drawings.find(f => String(f.id) === String(id));
    if (!feature) return;
    normalizeDrawingSemantics(feature);
    const meta = feature.properties || (feature.properties = {});
    const typeLabel = drawingCategoryLabel(feature);
    const displayName = drawingName(feature);
    state.selected = normalizeObjectRef({ domain: 'drawing', type: feature.properties?.category || 'custom', id: String(id) });
    syncObjectSelection(state.selected);
    showPropertyForm('drawing', displayName, { resetScroll: !refreshOnly });
    $('drawingNameInput').value = meta.name || '';
    $('drawingIdInput').textContent = String(id);
    const defaultColor = defaultDrawingColor(feature);
    const color = readDomainColor(COLOR_DOMAINS.DRAWING, { feature }, { fallback: defaultColor });
    $('drawingColorInput').value = color.value;
    syncColorPicker('drawing', { value: color.value, defaultColor, isDefault: color.isDefault });
    $('drawingNotesInput').value = meta.notes || '';
    $('deleteDrawingInlineBtn').textContent = `${typeLabel} 삭제`;
    syncDrawingSemanticEditor(feature);
    $('selectionStatus').textContent = `${typeLabel} · ${meta.name || String(id).slice(0, 8)}${geometryAreaStatusSuffix(feature.geometry)}`;
    syncStatusBar();
    syncLayerSelectionRows();
    renderAll();
    if (!refreshOnly) openSelectionEditor();
  }

  function selectLabel(id, refreshOnly = false) {
    const label = state.labels.find(item => item.id === id);
    if (!label) return;
    state.selected = normalizeObjectRef({ domain: 'label', type: label.kind || 'label', id });
    syncObjectSelection(state.selected);
    showPropertyForm('label', label.name, { resetScroll: !refreshOnly });
    $('labelNameInput').value = label.name;
    $('labelKindInput').value = label.kind;
    $('labelNotesInput').value = label.notes || '';
    const settings = automaticLabelSettings(label.kind, state.labelSettings[labelKey('label', label.id)] || {});
    $('labelPositionValue').textContent = settings.pinned ? '사용자 위치에 고정됨' : '종류별 정책으로 자동 배치';
    $('selectionStatus').textContent = `지명 · ${label.name}`;
    syncStatusBar();
    syncLayerSelectionRows();
    renderAll();
    if (!refreshOnly) openSelectionEditor();
  }

  function hydroEditorName(value, fallback) {
    const name = String(value || '').trim();
    if (/^미명명 수계(?:\s+\d+)?$/.test(name)) return fallback;
    return name || fallback;
  }

  function selectHydro(id, refreshOnly = false) {
    const feature = hydroFeatureById(id);
    if (!feature || !isHydroFeatureVisible(feature)) return;
    const properties = feature.properties || {};
    const editable = !!hydroEditById(id);
    const categoryKey = hydroCategoryKey(properties.category);
    const category = hydroCategoryLabel(categoryKey);
    const displayName = hydroEditorName(properties.name, hydroFallbackName(categoryKey));
    state.selected = normalizeObjectRef({ domain: 'hydro', type: hydroCategoryKey(properties.category), id: String(editable ? feature.id : properties.pandolab_id || feature.id) });
    syncObjectSelection(state.selected);
    showPropertyForm('hydro', displayName, { resetScroll: !refreshOnly, typeLabel: category });
    $('hydroColorPopover').setAttribute('aria-label', `${category} 색상 팔레트`);
    $('hydroEditFields').classList.toggle('hidden', !editable);
    $('hydroBuiltinHelp').classList.toggle('hidden', editable);
    const copyActionSection = $('copyHydroBtn').closest('.editor-action-section');
    if (copyActionSection) copyActionSection.hidden = editable;
    $('deleteHydroEditBtn').hidden = !editable;
    $('deleteHydroEditBtn').textContent = `${category} 삭제`;
    syncEditorActionTab('hydro');
    if (editable) {
      $('hydroNameInput').value = properties.name || '';
      $('hydroColorInput').value = properties.editorColor || HYDRO_TOOL_CONFIG[properties.category].color;
      syncColorPicker('hydro', { value: $('hydroColorInput').value, defaultColor: HYDRO_TOOL_CONFIG[properties.category].color, isDefault: false });
      $('hydroNotesInput').value = properties.notes || '';
    }
    const systemName = categoryKey === 'river'
      ? hydroEditorName(properties.mainstem_name_ko || properties.name, hydroFallbackName(categoryKey))
      : '';
    const hydroId = String(properties.system_id || properties.pandolab_id || feature.id || '').replace(/^hydro-system:/, '');
    $('hydroCategoryValue').textContent = category;
    $('hydroIdLabel').textContent = `${category} ID`;
    $('hydroIdValue').textContent = hydroId || '—';
    $('hydroSystemValue').textContent = systemName;
    $('hydroSystemRow').classList.toggle('hidden', !systemName || systemName === displayName);
    $('hydroSystemValue').previousElementSibling.textContent = '대표 수계';
    $('hydroTributaryValue').textContent = categoryKey === 'river' ? '본류·표시 지류' : '호수';
    $('hydroSourceValue').textContent = properties.source || `판도연구소 내장 ${category}`;
    $('hydroBuiltinHelp').lastChild.textContent = ` 기반 내장 ${category}입니다. 직접 수정하려면 복사본을 만드세요.`;
    $('selectionStatus').textContent = `${category} · ${displayName}`;
    syncStatusBar();
    syncLayerSelectionRows();
    renderAll();
    if (!refreshOnly) openSelectionEditor();
    if (!editable && !feature.geometry && !feature.__geometryLoading) {
      feature.__geometryLoading = true;
      gpuMapRenderer.loadHydroLogicalFeature(Number(properties.__logicalFid)).then(full => {
        if (!full) return;
        prepareHydroFeature(full);
        const key = String(full.properties?.pandolab_id || full.id);
        state.hydroFeatureCache.set(key, full);
        for (const [fid, cached] of state.hydroFeatureByFid) {
          if (String(cached?.properties?.pandolab_id || cached?.id) === key) state.hydroFeatureByFid.set(fid, full);
        }
        if (state.selected?.domain === 'hydro' && state.selected.id === key) selectHydro(key, true);
      }).catch(error => console.warn('강·호수 선택 형상을 불러오지 못했습니다.', error)).finally(() => { feature.__geometryLoading = false; });
    }
  }

  async function copySelectedHydroForEditing() {
    if (state.selected?.domain !== 'hydro') return;
    let source = builtInHydroFeatureById(state.selected.id);
    if (!source) {
      setActionStatus('복사할 강·호수 객체를 찾을 수 없습니다. 다시 선택하세요.', 'error', 3200);
      return;
    }
    if (!source.geometry || (source.properties?.category === 'river' && Number(source.properties?.fragment_count || 1) > 1)) {
      setActionStatus('강·호수 전체 형상을 준비하는 중입니다.', 'working', 0);
      try {
        source = await gpuMapRenderer.loadHydroLogicalFeature(Number(source.properties.__logicalFid));
      } catch (error) {
        reportOperationError(error, '강·호수 전체 형상을 불러오지 못했습니다. 잠시 후 다시 시도하세요.', 'PL-WATER-002', 0);
        return;
      }
      if (!source) {
        setActionStatus('강·호수 전체 형상을 찾을 수 없습니다. 다시 선택하세요.', 'error', 3200);
        return;
      }
    }
    recordHistory();
    const category = source.properties?.category === 'lake' ? 'lake' : 'river';
    const copy = {
      type: 'Feature',
      id: uid(category),
      geometry: deepClone(source.geometry),
      properties: {
        name: source.properties?.name || '',
        category,
        editorColor: HYDRO_TOOL_CONFIG[category].color,
        notes: `판도연구소 내장 ${hydroCategoryLabel(category)} 편집용 복사본 · 원본 ${source.properties?.pandolab_id || source.id}`,
        source: source.properties?.source || `판도연구소 내장 ${hydroCategoryLabel(category)}`,
        sourceFeatureId: source.properties?.pandolab_id || source.id,
      },
    };
    normalizeHydroEdit(copy);
    state.hydroEdits.push(copy);
    state.physicalSettings.hiddenHydroIds[String(source.properties?.pandolab_id || source.id)] = true;
    gpuMapRenderer.invalidateHydroVisibility();
    markLayerTreeDirty();
    selectHydro(String(copy.id));
    renderAll();
    queueAutosave();
    setActionStatus(`${source.properties?.name || (category === 'lake' ? '호수' : '강')} 편집 복사본을 만들었습니다.`, 'success', 3600);
  }

  function clearSelection(announce = true) {
    if (!objectSelectionSyncing) objectSelection.clear();
    state.selected = null;
    state.addSelectionMode = false;
    $('selectionStatus').textContent = '';
    showPropertyForm(null);
    syncCountryActionButtons();
    syncMobileNavigation();
    mapRenderCoordinator.invalidate(
      MAP_RENDER_DIRTY.DYNAMIC_OVERLAYS | MAP_RENDER_DIRTY.SELECTION_DATA | MAP_RENDER_DIRTY.LABEL_LAYOUT | MAP_RENDER_DIRTY.HUD,
      'clear-selection',
    );
    if (layoutMode === 'wide') {
      surfaceState.editorManuallyCollapsed = false;
      if (surfaceState.editorOpen) closeSurface('editor');
    }
  }

  function territorialPartitionContext(unitType) {
    const selectedUnit = (state.selected?.domain === 'territorial' && state.selected.type !== TERRITORIAL_UNIT_TYPES.COUNTRY) ? territorialUnitById(state.selected.id) : null;
    const selectedCountry = (state.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY) ? countryFeatureById(state.selected.id) : null;
    if (unitType === TERRITORIAL_UNIT_TYPES.TERRITORY) {
      const sovereignId = String(selectedUnit?.properties?.sovereignId || selectedCountry?.properties?.editor_id || '');
      const country = countryFeatureById(sovereignId);
      if (!country) return null;
      const existing = selectedUnit?.properties?.unitType === TERRITORIAL_UNIT_TYPES.TERRITORY
        ? selectedUnit
        : state.territorialUnits.find(feature => feature.properties?.unitType === unitType
          && String(feature.properties?.sovereignId || '') === sovereignId
          && feature.properties?.isRemainder === true)
          || state.territorialUnits.find(feature => feature.properties?.unitType === unitType && String(feature.properties?.sovereignId || '') === sovereignId);
      return { unitType, sovereignId, parentId: '', adminLevel: null, container: country, source: existing || null };
    }
    const sovereignId = String(selectedUnit?.properties?.sovereignId || selectedCountry?.properties?.editor_id || '');
    const country = countryFeatureById(sovereignId);
    if (!country) return null;
    const parent = selectedUnit || null;
    const parentId = String(parent?.id || '');
    const adminLevel = parent?.properties?.unitType === TERRITORIAL_UNIT_TYPES.ADMIN
      ? Math.max(1, Number(parent.properties.adminLevel) || 1) + 1
      : parent?.properties?.unitType === TERRITORIAL_UNIT_TYPES.TERRITORY ? 2 : 1;
    const existing = state.territorialUnits.find(feature => feature.properties?.unitType === unitType
      && String(feature.properties?.sovereignId || '') === sovereignId
      && String(feature.properties?.parentId || '') === parentId
      && Number(feature.properties?.adminLevel || 1) === adminLevel
      && feature.properties?.isRemainder === true)
      || state.territorialUnits.find(feature => feature.properties?.unitType === unitType
        && String(feature.properties?.sovereignId || '') === sovereignId
        && String(feature.properties?.parentId || '') === parentId
        && Number(feature.properties?.adminLevel || 1) === adminLevel);
    return { unitType, sovereignId, parentId, adminLevel, container: parent || country, source: existing || null };
  }

  function explicitRegionCreateContext() {
    const selectedUnit = (state.selected?.domain === 'territorial' && state.selected.type !== TERRITORIAL_UNIT_TYPES.COUNTRY) ? territorialUnitById(state.selected.id) : null;
    const selectedCountry = (state.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY) ? countryFeatureById(state.selected.id) : null;
    return {
      unitType: TERRITORIAL_UNIT_TYPES.REGION,
      sovereignId: String(selectedUnit?.properties?.sovereignId || selectedCountry?.properties?.editor_id || ''),
      parentId: String(selectedUnit?.id || ''),
      adminLevel: null,
      container: selectedUnit || selectedCountry || null,
      source: null,
    };
  }

  function territorialCreateContext(unitType) {
    return unitType === TERRITORIAL_UNIT_TYPES.REGION
      ? explicitRegionCreateContext()
      : territorialPartitionContext(unitType);
  }

  function enterTerritorialUnitSplitMode(idOrFeature, { virtual = false } = {}) {
    const feature = typeof idOrFeature === 'object' ? idOrFeature : territorialUnitById(idOrFeature);
    if (!feature?.geometry) return false;
    setTool('split-territorial-unit', false);
    state.territorialUnitSplitSourceId = virtual ? null : String(feature.id);
    state.territorialUnitSplitVirtualSource = virtual ? deepClone(feature) : null;
    setModeBanner(defaultDraftInstruction());
    updateModeButtons();
    return true;
  }

  function startTerritorialUnitCreate(unitType) {
    if (unitType === TERRITORIAL_UNIT_TYPES.REGION) return false;
    const context = territorialPartitionContext(unitType);
    if (!context) {
      setActionStatus(unitType === TERRITORIAL_UNIT_TYPES.ADMIN
        ? '행정구역의 부모로 사용할 국가·권역·행정구역을 먼저 선택하세요.'
        : '권역을 만들 국가를 먼저 선택하세요.', 'error', 3900);
      return false;
    }
    const source = context.source || createPartitionTerritorialFeature({
      id: uid(unitType === TERRITORIAL_UNIT_TYPES.ADMIN ? 'administrative' : 'territory'),
      unitType,
      sovereignId: context.sovereignId,
      parentId: context.parentId,
      adminLevel: context.adminLevel,
      isRemainder: true,
      geometry: deepClone(context.container.geometry),
    });
    return enterTerritorialUnitSplitMode(source, { virtual: !context.source });
  }

  let pendingTerritorialCreateType = null;

  function closeTerritorialCreateModal() {
    $('territorialCreateModal').classList.add('hidden');
    pendingTerritorialCreateType = null;
  }

  function openTerritorialCreateModal(unitType) {
    const context = territorialCreateContext(unitType);
    if (!context) {
      setActionStatus(unitType === TERRITORIAL_UNIT_TYPES.ADMIN
        ? '행정구역의 부모로 사용할 국가·권역·행정구역을 먼저 선택하세요.'
        : '권역을 만들 국가를 먼저 선택하세요.', 'error', 3900);
      return false;
    }
    const administrative = unitType === TERRITORIAL_UNIT_TYPES.ADMIN;
    const region = unitType === TERRITORIAL_UNIT_TYPES.REGION;
    pendingTerritorialCreateType = unitType;
    $('territorialCreateTitle').textContent = `${territorialTypeLabel(unitType)} 추가`;
    $('territorialCreateContext').textContent = region
      ? context.parentId
        ? `상위 영역 기본값: ${territorialUnitName(context.container)}`
        : context.sovereignId
          ? `주권 국가 기본값: ${countryName(context.container)}`
          : '주권 국가와 상위 영역은 생성 후 설정할 수 있습니다.'
      : administrative
        ? `부모: ${territorialUnitName(context.container) || countryName(context.container)} · 자동 ${context.adminLevel}급`
        : `소속 국가: ${countryName(context.container)}`;
    replaceSelectOptions($('territorialCreateMethod'), region
      ? [{ value: 'draw', label: '영역 직접 지정' }, { value: 'geojson', label: 'GeoJSON에서 가져오기' }]
      : [{ value: 'split', label: '기존 영역 나누기' }, { value: 'draw', label: '영역 직접 지정' }, { value: 'geojson', label: 'GeoJSON에서 가져오기' }], region ? 'draw' : 'split');
    $('territorialCreateModal').classList.remove('hidden');
    $('territorialCreateMethod').focus();
    return true;
  }

  function enterTerritorialUnitDirectCreate(unitType) {
    const context = territorialCreateContext(unitType);
    if (!context) return false;
    setTool('draw-territorial-unit', false);
    state.territorialCreateContext = {
      unitType,
      sovereignId: context.sovereignId,
      parentId: context.parentId,
      adminLevel: context.adminLevel,
    };
    setModeBanner(defaultDraftInstruction());
    updateModeButtons();
    return true;
  }

  function finishTerritorialUnitSplitDraft() {
    const source = territorialUnitById(state.territorialUnitSplitSourceId) || state.territorialUnitSplitVirtualSource;
    if (!source?.geometry) {
      setActionStatus('나눌 권역을 찾을 수 없습니다. 권역을 다시 선택하세요.', 'error', 3400);
      return;
    }
    try {
      const split = buildCutSplitCandidates(source.geometry, state.draftCoords);
      const untouched = geometryPolygonSets(source.geometry)
        .filter((_, index) => index !== split.componentIndex)
        .map(polygon => deepClone(polygon));
      const smallerIndex = split.candidates[0].area <= split.candidates[1].area ? 0 : 1;
      const otherIndex = smallerIndex === 0 ? 1 : 0;
      const wasRemainder = source.properties?.isRemainder === true;
      const typeLabel = territorialTypeLabel(source.properties?.unitType);
      const baseName = territorialUnitName(source).replace(/^미지정\s*/, '') || typeLabel;
      const newName = prompt(`새 ${typeLabel} 이름을 입력하세요.`, `새 ${typeLabel}`);
      if (newName === null) return;
      let retainedName = source.properties?.name || '';
      if (!wasRemainder) {
        const entered = prompt(`기존 쪽 ${typeLabel} 이름을 입력하세요.`, `${baseName} 1`);
        if (entered === null) return;
        retainedName = entered.trim() || `${baseName} 1`;
      }
      const retainedCoordinates = wasRemainder
        ? [...geometryMultiCoordinates(split.candidates[otherIndex].geometry), ...untouched]
        : [...geometryMultiCoordinates(split.candidates[0].geometry), ...untouched];
      const retainedGeometry = normalizeClippedLandGeometry(retainedCoordinates);
      const siblingGeometry = deepClone(split.candidates[wasRemainder ? smallerIndex : 1].geometry);
      if (!retainedGeometry || !siblingGeometry) throw new Error('나누지 않은 섬과 월경지를 보존할 수 없습니다.');
      const retainedAfter = deepClone(source);
      retainedAfter.geometry = retainedGeometry;
      retainedAfter.properties.name = retainedName;
      retainedAfter.properties.isRemainder = wasRemainder;
      const sibling = createPartitionTerritorialFeature({
        id: uid(source.properties.unitType === TERRITORIAL_UNIT_TYPES.ADMIN ? 'administrative' : 'territory'),
        unitType: source.properties.unitType,
        sovereignId: source.properties.sovereignId,
        parentId: source.properties.parentId,
        adminLevel: source.properties.adminLevel,
        isRemainder: false,
        name: newName.trim() || `새 ${typeLabel}`,
        color: territorialStyleColor(source),
        notes: '',
        sourceFolderId: source.properties.sourceFolderId || '',
        geometry: siblingGeometry,
      });
      beginLocalGeometryPreview({
        operation: 'split-territorial-unit',
        beforeFeatures: [source],
        afterFeatures: [retainedAfter, sibling],
        applyResult: () => {
          recordHistory();
          const retained = state.territorialUnitSplitSourceId ? territorialUnitById(state.territorialUnitSplitSourceId) : null;
          if (retained) {
            retained.geometry = deepClone(retainedAfter.geometry);
            retained.properties = deepClone(retainedAfter.properties);
          } else state.territorialUnits.push(deepClone(retainedAfter));
          state.territorialUnits.push(deepClone(sibling));
          state.territorialUnits = normalizeTerritorialUnits(state.territorialUnits, { countryExists: id => !!countryFeatureById(id) });
          clearDraftInput(true);
          setTool('select', false);
          markLayerTreeDirty();
          selectTerritorialUnit(sibling.id, true);
        },
        successMessage: `${typeLabel}을(를) 나누고 나머지 면적을 ${wasRemainder ? '미지정 영역으로 ' : ''}보존했습니다.`,
        errorMessage: '영역 나누기 결과를 적용하지 못했습니다.',
      });
    } catch (error) {
      reportOperationError(error, '영역을 나누지 못했습니다. 한 영역을 정확히 한 번 관통하도록 경계를 다시 그리세요.', 'PL-REGION-SPLIT-001', 4400);
    }
  }

  function territorialUnitsAreAdjacent(left, right) {
    return territorialGeometry.areAdjacent(left, right);
  }

  function enterTerritorialUnitMergeMode(id) {
    const source = territorialUnitById(id);
    if (!source) return false;
    setTool('merge-territorial-unit', false);
    state.territorialUnitMergeSourceId = String(source.id);
    state.territorialUnitMergeTargetIds = [];
    setModeBanner('합칠 인접 영역을 선택하세요.');
    updateModeButtons();
    renderTerritorialUnits();
    return true;
  }

  function toggleTerritorialUnitMergeTarget(id) {
    if (state.tool !== 'merge-territorial-unit') return;
    const source = territorialUnitById(state.territorialUnitMergeSourceId);
    const target = territorialUnitById(id);
    if (!source || !target || String(source.id) === String(target.id)) return;
    if (!territorialSiblings(state.territorialUnits, source).some(candidate => String(candidate.id) === String(target.id))) {
      setActionStatus('같은 국가·부모·단계의 영역만 합칠 수 있습니다.', 'error', 3400);
      return;
    }
    if (!territorialUnitsAreAdjacent(source, target)) {
      setActionStatus('경계를 공유하는 인접 영역만 합칠 수 있습니다.', 'error', 3400);
      return;
    }
    const targets = new Set(state.territorialUnitMergeTargetIds.map(String));
    if (targets.has(String(id))) targets.delete(String(id)); else targets.add(String(id));
    state.territorialUnitMergeTargetIds = [...targets];
    renderTerritorialUnits();
    updateModeButtons();
  }

  function completeTerritorialUnitMerge() {
    const source = territorialUnitById(state.territorialUnitMergeSourceId);
    const targets = state.territorialUnitMergeTargetIds.map(territorialUnitById).filter(Boolean);
    if (!source || !targets.length) return;
    try {
      const mergeResult = territorialGeometry.mergeUnits(source, targets);
      const removed = new Set(mergeResult.removedIds);
      const sourceAfter = deepClone(source);
      sourceAfter.geometry = deepClone(mergeResult.survivor.geometry);
      beginLocalGeometryPreview({
        operation: 'merge-territorial-unit',
        beforeFeatures: [source, ...targets],
        afterFeatures: [sourceAfter],
        removedIds: [...removed],
        applyResult: () => {
          recordHistory();
          source.geometry = deepClone(sourceAfter.geometry);
          for (const child of state.territorialUnits) {
            if (removed.has(String(child.properties?.parentId || ''))) child.properties.parentId = String(source.id);
          }
          state.territorialUnits = state.territorialUnits.filter(item => !removed.has(String(item.id)));
          state.territorialUnits = normalizeTerritorialUnits(state.territorialUnits, { countryExists: id => !!countryFeatureById(id) });
          setTool('select', false);
          markLayerTreeDirty();
          selectTerritorialUnit(source.id, true);
        },
        successMessage: `${targets.length + 1}개 ${territorialTypeLabel(source.properties.unitType)}을 하나로 합쳤습니다.`,
        errorMessage: '영역 합치기 결과를 적용하지 못했습니다.',
      });
    } catch (error) {
      reportOperationError(error, '영역을 합치지 못했습니다.', 'PL-REGION-MERGE-001', 4200);
    }
  }

  function enterTerritorialUnitRedrawMode(id) {
    const source = territorialUnitById(id);
    if (!source) return false;
    setTool('redraw-territorial-unit', false);
    state.territorialUnitRedrawSourceId = String(source.id);
    setModeBanner(defaultDraftInstruction());
    updateModeButtons();
    return true;
  }

  async function finishTerritorialUnitRedrawDraft() {
    const source = territorialUnitById(state.territorialUnitRedrawSourceId);
    const container = territorialUnitContainer(source);
    const clipper = window.polygonClipping;
    if (!source || !container || !clipper?.intersection || !clipper?.difference) return;
    try {
      const drawn = { type: 'Polygon', coordinates: [orientRing(state.draftCoords, true)] };
      let nextGeometry = normalizeClippedLandGeometry(clipper.intersection(drawn.coordinates, container.geometry.coordinates));
      if (!nextGeometry) throw new Error('그린 영역이 부모 영역 안에 없습니다.');
      const siblings = territorialSiblings(state.territorialUnits, source);
      for (const sibling of siblings) {
        if (sibling.properties?.isRemainder === true) continue;
        const overlap = clipper.intersection(nextGeometry.coordinates, sibling.geometry.coordinates);
        if (multiPolygonPlanarArea(overlap) > Math.max(1e-9, multiPolygonPlanarArea(nextGeometry.coordinates) * 1e-9)) {
          throw new Error(`${territorialUnitName(sibling)}과(와) 겹칩니다. 이름 있는 형제 영역은 침범할 수 없습니다.`);
        }
      }
      let released = normalizeClippedLandGeometry(clipper.difference(source.geometry.coordinates, nextGeometry.coordinates));
      const sourceAfter = deepClone(source);
      sourceAfter.geometry = deepClone(nextGeometry);
      const coastGeometryOverrides = new Map();
      let coastDirection = 'none';
      if (source.properties?.unitType === TERRITORIAL_UNIT_TYPES.ADMIN) {
        const rawSourceAfter = deepClone(sourceAfter);
        rawSourceAfter.geometry = deepClone(drawn);
        const country = countryFeatureById(source.properties?.sovereignId);
        const resolution = await resolveTerritorialCoast(rawSourceAfter, country, coastGeometryOverrides);
        if (resolution.direction === 'cancel') {
          setActionStatus('해안선 정합을 취소했습니다.', 'ready');
          return;
        }
        coastDirection = resolution.direction;
        if (coastDirection === 'country-to-admin') {
          nextGeometry = normalizeClippedLandGeometry(clipper.intersection(rawSourceAfter.geometry.coordinates, container.geometry.coordinates));
          if (!nextGeometry) throw new Error('국가 해안선을 기준으로 조정한 영역이 부모 영역 안에 없습니다.');
          sourceAfter.geometry = deepClone(nextGeometry);
        } else if (coastDirection === 'admin-to-country' || coastDirection === 'independent') {
          nextGeometry = deepClone(rawSourceAfter.geometry);
          sourceAfter.geometry = deepClone(nextGeometry);
        }
        released = normalizeClippedLandGeometry(clipper.difference(source.geometry.coordinates, nextGeometry.coordinates));
      }
      for (const sibling of siblings) {
        if (sibling.properties?.isRemainder === true) continue;
        const overlap = clipper.intersection(nextGeometry.coordinates, sibling.geometry.coordinates);
        if (multiPolygonPlanarArea(overlap) > Math.max(1e-9, multiPolygonPlanarArea(nextGeometry.coordinates) * 1e-9)) {
          throw new Error(`${territorialUnitName(sibling)}과(와) 겹칩니다. 이름 있는 형제 영역은 침범할 수 없습니다.`);
        }
      }
      beginLocalGeometryPreview({
        operation: 'redraw-territorial-unit',
        beforeFeatures: [source],
        afterFeatures: [sourceAfter],
        applyResult: async () => {
          recordHistory();
          for (const [countryId, geometry] of coastGeometryOverrides) {
            const country = countryFeatureById(countryId);
            if (!country) continue;
            country.geometry = deepClone(geometry);
            state.historyDirtyCountryIds.add(countryId);
          }
          source.geometry = deepClone(nextGeometry);
          for (const sibling of siblings.filter(item => item.properties?.isRemainder === true)) {
            const remainder = normalizeClippedLandGeometry(clipper.difference(sibling.geometry.coordinates, nextGeometry.coordinates));
            if (remainder) sibling.geometry = remainder;
            else state.territorialUnits = state.territorialUnits.filter(item => String(item.id) !== String(sibling.id));
          }
          if (released && source.properties?.isRemainder !== true) addUnassignedTerritorialUnitGeometry({
            unitType: source.properties.unitType,
            sovereignId: source.properties.sovereignId,
            parentId: source.properties.parentId,
            adminLevel: source.properties.adminLevel,
          }, released);
          reconcileTerritorialUnitCompleteness([source.properties.sovereignId], {
            preserveIds: coastDirection === 'admin-to-country' || coastDirection === 'independent' ? [String(source.id)] : [],
          });
          clearDraftInput(true);
          setTool('select', false);
          markLayerTreeDirty();
          selectTerritorialUnit(source.id, true);
        },
        successMessage: '영역을 다시 지정하고 남는 면적을 미지정 영역으로 보존했습니다.',
        errorMessage: '영역 다시 지정 결과를 적용하지 못했습니다.',
      });
    } catch (error) {
      reportOperationError(error, '영역을 다시 지정하지 못했습니다.', 'PL-REGION-REDRAW-001', 4300);
    }
  }

  function finishTerritorialUnitDirectDraft() {
    const context = state.territorialCreateContext;
    if (!context) return;
    const typeLabel = territorialTypeLabel(context.unitType);
    const name = prompt(`새 ${typeLabel} 이름을 입력하세요.`, `새 ${typeLabel}`);
    if (name === null) return;
    const geometry = normalizeCountryGeometry({ type: 'Polygon', coordinates: [orientRing(state.draftCoords, true)] });
    try {
      if (!geometry) throw new Error('그린 영역을 닫힌 Polygon으로 만들 수 없습니다.');
      const rawFeature = {
        type: 'Feature',
        id: uid(`${context.unitType}-preview`),
        properties: {
          name: name.trim() || `새 ${typeLabel}`,
          sovereignId: context.sovereignId,
          parentId: context.parentId,
          adminLevel: context.adminLevel,
        },
        geometry,
      };
      const issues = validateStructuredGeometry(rawFeature);
      if (issues.length) throw new Error(issues[0].message);
      const explicitRegion = context.unitType === TERRITORIAL_UNIT_TYPES.REGION
        ? createTerritorialFeature({
          id: uid('region'),
          unitType: TERRITORIAL_UNIT_TYPES.REGION,
          name: rawFeature.properties.name,
          parentId: context.parentId,
          sovereignId: context.sovereignId,
          coverageMode: TERRITORIAL_COVERAGE_MODES.EXPLICIT,
          isRemainder: false,
          geometry: deepClone(geometry),
        })
        : null;
      beginLocalGeometryPreview({
        operation: 'draw-territorial-unit',
        beforeFeatures: [],
        afterFeatures: [explicitRegion || rawFeature],
        applyResult: async () => {
          let createdId = explicitRegion?.id || '';
          if (explicitRegion) {
            recordHistory({ type: 'territorial-create', affectedIds: [String(explicitRegion.id)] });
            state.territorialUnits.push(explicitRegion);
            state.territorialUnits = normalizeTerritorialUnits(state.territorialUnits, { countryExists: id => !!countryFeatureById(id) });
            state.layerVisibility.regions = true;
            delete state.itemVisibility.regions?.[String(explicitRegion.id)];
            markLayerTreeDirty();
            queueAutosave();
          } else {
            const createdIds = await importGeoJsonTerritorialUnits([rawFeature], context.unitType, {
              nameField: 'name', countryField: 'sovereignId', parentField: 'parentId', levelField: 'adminLevel',
            });
            createdId = createdIds[0] || '';
          }
          clearDraftInput(true);
          setTool('select', false);
          if (createdId) selectTerritorialUnit(createdId, true);
        },
        successMessage: `${typeLabel}을 직접 지정했습니다.`,
        errorMessage: `${typeLabel} 직접 지정 결과를 적용하지 못했습니다.`,
      });
    } catch (error) {
      reportOperationError(error, `${typeLabel}을 직접 지정하지 못했습니다.`, 'PL-REGION-DRAW-001', 4400);
    }
  }

  function normalizeEditorColor(value, fallback) {
    return normalizeColorValue(value, fallback);
  }

  function preferenceDefaultColor(kind) {
    const token = kind === 'preferencesCountryLabel'
      ? '--map-label'
      : kind === 'preferencesPlaceLabel'
        ? '--user-label-text'
        : kind === 'preferencesPlacePoint'
          ? '--user-label-dot'
          : kind === 'preferencesSelection'
            ? '--accent'
          : '';
    const fallback = kind === 'preferencesSelection' ? resolvedInteractionStyle.selection.color : '#8c68d8';
    return token ? normalizeEditorColor(getComputedStyle(document.documentElement).getPropertyValue(token).trim(), fallback) : fallback;
  }

  function syncColorPicker(kind, { value, defaultColor, isDefault }) {
    const picker = document.querySelector(`[data-color-picker="${kind}"]`);
    if (!picker) return;
    const fallback = kind.startsWith('preferences') ? preferenceDefaultColor(kind)
      : kind === 'country' ? defaultCountryColor()
      : (kind === 'territory' || kind === 'administrative') && (state.selected?.domain === 'territorial' && state.selected.type !== TERRITORIAL_UNIT_TYPES.COUNTRY)
        ? territorialUnitColor(territorialUnitById(state.selected.id))
        : DEFAULT_DRAWING_COLOR;
    const resolvedDefault = normalizeEditorColor(defaultColor, fallback);
    const resolvedValue = normalizeEditorColor(value, resolvedDefault);
    const input = picker.querySelector('.ui-native-color-input');
    const triggerPreview = picker.querySelector('.ui-color-trigger .ui-color-preview');
    const valueLabel = picker.querySelector('.ui-color-value');
    const defaultButton = picker.querySelector('[data-color-default]');
    const defaultPreview = defaultButton?.querySelector('.ui-color-preview');
    if (input) input.value = resolvedValue;
    triggerPreview?.style.setProperty('--swatch-color', resolvedValue);
    defaultPreview?.style.setProperty('--swatch-color', resolvedDefault);
    if (valueLabel) valueLabel.textContent = isDefault ? (kind === 'territory' || kind === 'administrative' ? '국가색 상속' : '기본 색상') : resolvedValue.toUpperCase();
    defaultButton?.setAttribute('aria-pressed', String(!!isDefault));
    picker.querySelectorAll('[data-color-value]').forEach(button => {
      button.setAttribute('aria-pressed', String(!isDefault && button.dataset.colorValue === resolvedValue));
    });
    picker.dataset.colorDefault = resolvedDefault;
    picker.dataset.colorValue = resolvedValue;
    picker.dataset.colorIsDefault = String(!!isDefault);
  }

  function closeColorPicker(picker, { restoreFocus = false } = {}) {
    if (!picker) return;
    const popover = picker.querySelector('.ui-color-popover');
    const trigger = picker.querySelector('.ui-color-trigger');
    if (popover?.classList.contains('hidden')) return;
    popover.classList.add('hidden');
    picker.classList.remove('is-open');
    trigger?.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger?.focus({ preventScroll: true });
  }

  function closeAllColorPickers(except = null, options = {}) {
    document.querySelectorAll('[data-color-picker]').forEach(picker => {
      if (picker !== except) closeColorPicker(picker, options);
    });
  }

  function alignColorPopoverToViewport(popover) {
    if (!popover || popover.classList.contains('hidden')) return;
    popover.style.removeProperty('--ui-color-popover-shift-x');
    popover.style.removeProperty('--ui-color-popover-shift-y');
    delete popover.dataset.placement;
    const rootStyle = getComputedStyle(document.documentElement);
    const screenEdge = Number.parseFloat(rootStyle.getPropertyValue('--ui-popover-screen-edge')) || 8;
    const pickerBounds = popover.closest('.ui-color-picker')?.getBoundingClientRect();
    let bounds = popover.getBoundingClientRect();
    if (pickerBounds && bounds.bottom > window.innerHeight - screenEdge && pickerBounds.top - screenEdge >= bounds.height) {
      popover.dataset.placement = 'top';
      bounds = popover.getBoundingClientRect();
    }
    let shiftX = 0;
    let shiftY = 0;
    if (bounds.left < screenEdge) shiftX = screenEdge - bounds.left;
    if (bounds.right + shiftX > window.innerWidth - screenEdge) shiftX += (window.innerWidth - screenEdge) - (bounds.right + shiftX);
    if (bounds.top < screenEdge) shiftY = screenEdge - bounds.top;
    if (bounds.bottom + shiftY > window.innerHeight - screenEdge) shiftY += (window.innerHeight - screenEdge) - (bounds.bottom + shiftY);
    if (shiftX) popover.style.setProperty('--ui-color-popover-shift-x', `${shiftX}px`);
    if (shiftY) popover.style.setProperty('--ui-color-popover-shift-y', `${shiftY}px`);
  }

  function openColorPicker(picker) {
    if (!picker) return;
    const popover = picker.querySelector('.ui-color-popover');
    const trigger = picker.querySelector('.ui-color-trigger');
    if (!popover || !trigger) return;
    const opening = popover.classList.contains('hidden');
    closeAllColorPickers(picker);
    popover.classList.toggle('hidden', !opening);
    picker.classList.toggle('is-open', opening);
    trigger.setAttribute('aria-expanded', String(opening));
    if (opening) requestAnimationFrame(() => {
      alignColorPopoverToViewport(popover);
      popover.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
    });
  }

  function resetCountryColor() {
    if (!(state.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY)) return false;
    const id = state.selected.id;
    const idx = state.countryIndex.get(id);
    const feature = idx === undefined ? null : state.countriesData.features[idx];
    const override = state.countryOverrides[id] || {};
    const color = readDomainColor(COLOR_DOMAINS.COUNTRY, { feature, override }, { fallback: defaultCountryColor() });
    if (color.isDefault) {
      syncColorPicker('country', { value: defaultCountryColor(), defaultColor: defaultCountryColor(), isDefault: true });
      return true;
    }
    recordHistory();
    state.countryOverrides[id] = override;
    writeDomainColor(COLOR_DOMAINS.COUNTRY, { feature, override }, '', { clear: true, fallback: defaultCountryColor() });
    selectCountry(id, true);
    queueAutosave();
    setActionStatus('국가 색상을 기본값으로 되돌렸습니다.', 'success');
    return true;
  }

  function resetDrawingColor() {
    if (state.selected?.domain !== 'drawing') return false;
    const feature = state.drawings.find(item => String(item.id) === String(state.selected.id));
    if (!feature) return false;
    feature.properties ||= {};
    const color = readDomainColor(COLOR_DOMAINS.DRAWING, { feature }, { fallback: defaultDrawingColor(feature) });
    if (color.isDefault) {
      const defaultColor = defaultDrawingColor(feature);
      syncColorPicker('drawing', { value: defaultColor, defaultColor, isDefault: true });
      return true;
    }
    recordHistory();
    writeDomainColor(COLOR_DOMAINS.DRAWING, { feature }, '', { clear: true, fallback: defaultDrawingColor(feature) });
    drawingLandClipCache.delete(feature);
    selectDrawing(String(feature.id), true);
    queueAutosave();
    setActionStatus('지형지물 색상을 기본값으로 되돌렸습니다.', 'success');
    return true;
  }

  function resetTerritorialUnitColor(kind) {
    if (!(state.selected?.domain === 'territorial' && state.selected.type !== TERRITORIAL_UNIT_TYPES.COUNTRY)) return false;
    const feature = territorialUnitById(state.selected.id);
    if (!feature) return false;
    if (!territorialStyleColor(feature)) {
      const inherited = territorialUnitColor(feature);
      syncColorPicker(kind, { value: inherited, defaultColor: inherited, isDefault: true });
      return true;
    }
    commitTerritorialUnitMeta('color', '');
    return true;
  }

  function applyColorPickerSelection(kind, value, isDefault = false) {
    if (kind === 'preferencesSelection' || kind === 'preferencesCountryLabel' || kind === 'preferencesPlaceLabel' || kind === 'preferencesPlacePoint') {
      const defaultColor = preferenceDefaultColor(kind);
      const color = normalizeEditorColor(value, defaultColor);
      const nextLabels = structuredClone(userPreferences.labels);
      const nextSelection = { ...userPreferences.selection };
      if (kind === 'preferencesSelection') nextSelection.color = isDefault ? null : color;
      if (kind === 'preferencesCountryLabel') nextLabels.country.color = isDefault ? null : color;
      if (kind === 'preferencesPlaceLabel') nextLabels.place.color = isDefault ? null : color;
      if (kind === 'preferencesPlacePoint') nextLabels.place.pointColor = isDefault ? null : color;
      applyUserPreferences({
        ...userPreferences,
        labels: nextLabels,
        selection: nextSelection,
      });
      const resolvedValue = kind === 'preferencesSelection' ? userPreferences.selection.color
        : kind === 'preferencesCountryLabel' ? userPreferences.labels.country.color
          : kind === 'preferencesPlaceLabel' ? userPreferences.labels.place.color
            : userPreferences.labels.place.pointColor;
      syncColorPicker(kind, { value: resolvedValue || defaultColor, defaultColor, isDefault: !resolvedValue });
      return true;
    }
    if (kind === 'multiProperties') {
      const color = normalizeEditorColor(value, '#3f6fae');
      syncColorPicker('multiProperties', { value: color, defaultColor: color, isDefault: false });
      batchSetColor(color);
      return true;
    }
    if (isDefault) {
      if (kind === 'country') return resetCountryColor();
      if (kind === 'territory' || kind === 'administrative' || kind === 'region') return resetTerritorialUnitColor(kind);
      return resetDrawingColor();
    }
    const color = normalizeEditorColor(value, kind === 'country' ? defaultCountryColor() : DEFAULT_DRAWING_COLOR);
    if (kind === 'country') {
      if (!(state.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY)) return false;
      commitCountryEdit('color', color);
      return true;
    }
    if (kind === 'territory' || kind === 'administrative' || kind === 'region') {
      if (!(state.selected?.domain === 'territorial' && state.selected.type !== TERRITORIAL_UNIT_TYPES.COUNTRY)) return false;
      commitTerritorialUnitMeta('color', color);
      return true;
    }
    if (kind === 'distribution') {
      if (state.selected?.domain !== 'distribution') return false;
      return commitDistributionMeta('color', color);
    }
    if (kind === 'hydro') {
      const feature = state.selected?.domain === 'hydro' ? hydroEditById(state.selected.id) : null;
      if (!feature) return false;
      return commitHydroEdit('editorColor', normalizeEditorColor(value, HYDRO_TOOL_CONFIG[feature.properties.category].color));
    }
    if (state.selected?.domain !== 'drawing') return false;
    commitDrawingMeta('editorColor', color);
    return true;
  }

  function colorSwatchCheckTone(color) {
    const normalized = normalizeEditorColor(color, '#000000').slice(1);
    const red = Number.parseInt(normalized.slice(0, 2), 16) / 255;
    const green = Number.parseInt(normalized.slice(2, 4), 16) / 255;
    const blue = Number.parseInt(normalized.slice(4, 6), 16) / 255;
    const luminance = (red * 0.2126) + (green * 0.7152) + (blue * 0.0722);
    return luminance >= 0.62 ? 'dark' : 'light';
  }

  function createColorSwatch({ color, label, family = '', tone = '' }) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ui-button ui-color-swatch';
    button.dataset.colorValue = color;
    button.dataset.checkTone = colorSwatchCheckTone(color);
    if (family) button.dataset.colorFamily = family;
    if (tone) button.dataset.colorTone = tone;
    button.setAttribute('aria-label', `${label} (${color.toUpperCase()}) 색상`);
    button.setAttribute('aria-pressed', 'false');
    button.style.setProperty('--swatch-color', color);
    return button;
  }

  function appendColorPaletteSection(container, label, colors, modifier) {
    const section = document.createElement('section');
    section.className = 'ui-color-palette-section';
    const heading = document.createElement('span');
    heading.className = 'ui-color-palette-label';
    heading.textContent = label;
    const grid = document.createElement('div');
    grid.className = `ui-color-swatch-grid ui-color-swatch-grid--${modifier}`;
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-label', `${label} 색상`);
    colors.forEach(color => grid.appendChild(createColorSwatch(color)));
    section.append(heading, grid);
    container.appendChild(section);
  }

  function populateColorPalette(container) {
    if (!container || container.children.length) return;
    appendColorPaletteSection(container, '무채색', COLOR_PALETTE_NEUTRALS, 'neutral');
    appendColorPaletteSection(container, '색상', COLOR_PALETTE_COLORS, 'chromatic');
  }

  function bindColorPickers() {
    document.querySelectorAll('[data-color-picker]').forEach(picker => {
      const kind = picker.dataset.colorPicker;
      const trigger = picker.querySelector('.ui-color-trigger');
      const input = picker.querySelector('.ui-native-color-input');
      const swatches = picker.querySelector('.ui-color-swatches');
      const defaultButton = picker.querySelector('[data-color-default]');
      const customButton = picker.querySelector('[data-color-custom]');
      populateColorPalette(swatches);
      trigger?.addEventListener('click', () => openColorPicker(picker));
      defaultButton?.addEventListener('click', () => {
        if (applyColorPickerSelection(kind, '', true)) closeColorPicker(picker, { restoreFocus: true });
      });
      swatches?.addEventListener('click', event => {
        const button = event.target.closest('[data-color-value]');
        if (!button) return;
        if (applyColorPickerSelection(kind, button.dataset.colorValue)) closeColorPicker(picker, { restoreFocus: true });
      });
      customButton?.addEventListener('click', () => {
        closeColorPicker(picker);
        input?.click();
      });
      input?.addEventListener('change', event => {
        applyColorPickerSelection(kind, event.target.value);
        trigger?.focus({ preventScroll: true });
      });
    });
    document.addEventListener('pointerdown', event => {
      if (!event.target.closest('[data-color-picker]')) closeAllColorPickers();
    }, true);
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      const openPicker = document.querySelector('[data-color-picker].is-open');
      if (!openPicker) return;
      closeColorPicker(openPicker, { restoreFocus: true });
      event.preventDefault();
    });
    window.addEventListener('resize', () => {
      document.querySelectorAll('[data-color-picker].is-open .ui-color-popover').forEach(alignColorPopoverToViewport);
    });
  }

  function commitCountryEdit(field, value) {
    if (!(state.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY)) return;
    const id = state.selected.id;
    const result = territorialApplicationService.updateMetadata(TERRITORIAL_UNIT_TYPES.COUNTRY, id, field, value);
    if (!result.ok) return;
    if (field === 'color') gpuMapRenderer.invalidateCountryPalette({ base: true, emphasis: true }, 'country-color');
    if (field === 'name') markLayerTreeDirty();
    selectCountry(id, true);
    queueAutosave();
    setActionStatus('국가 정보를 변경했습니다.', 'success');
  }

  function commitDrawingMeta(field, value) {
    if (state.selected?.domain !== 'drawing') return;
    const f = state.drawings.find(x => String(x.id) === state.selected.id);
    if (!f) return;
    const result = drawingApplicationService.updateMetadata(f.id, field, value);
    if (!result.ok) return;
    drawingLandClipCache.delete(f);
    if (field === 'name') markLayerTreeDirty();
    selectDrawing(state.selected.id, true);
    queueAutosave();
    setActionStatus('지형지물 정보를 변경했습니다.', 'success');
  }

  function commitHydroEdit(field, value) {
    if (state.selected?.domain !== 'hydro') return;
    const feature = hydroEditById(state.selected.id);
    if (!feature || feature.properties?.locked === true) {
      if (feature?.properties?.locked === true) setActionStatus(`잠금을 해제한 뒤 ${hydroCategoryLabel(feature.properties.category)} 정보를 변경하세요.`, 'error', 3200);
      return;
    }
    recordHistory();
    feature.properties[field] = field === 'editorColor'
      ? normalizeEditorColor(value, HYDRO_TOOL_CONFIG[feature.properties.category].color)
      : value;
    if (field === 'name') markLayerTreeDirty();
    selectHydro(String(feature.id), true);
    queueAutosave();
    setActionStatus(`${hydroCategoryLabel(feature.properties.category)} 정보를 변경했습니다.`, 'success');
  }

  function territorialUnitContainer(feature, { sovereignId = feature?.properties?.sovereignId, parentId = feature?.properties?.parentId } = {}) {
    if (parentId && (feature?.properties?.unitType === TERRITORIAL_UNIT_TYPES.ADMIN
      || feature?.properties?.coverageMode === TERRITORIAL_COVERAGE_MODES.EXPLICIT)) {
      return territorialUnitById(parentId);
    }
    return countryFeatureById(sovereignId);
  }

  function territorialUnitInsideContainer(feature, container) {
    const clipper = window.polygonClipping;
    if (!feature?.geometry || !container?.geometry || !clipper?.difference) return false;
    const outside = clipper.difference(feature.geometry.coordinates, container.geometry.coordinates);
    return multiPolygonPlanarArea(outside) <= Math.max(1e-9, multiPolygonPlanarArea(feature.geometry.coordinates) * 1e-9);
  }

  function commitTerritorialUnitMeta(field, value) {
    if (!(state.selected?.domain === 'territorial' && state.selected.type !== TERRITORIAL_UNIT_TYPES.COUNTRY)) return;
    const feature = territorialUnitById(state.selected.id);
    if (!feature) return;
    if (feature.properties?.locked) {
      setActionStatus('잠금을 해제한 뒤 영역 정보를 변경할 수 있습니다.', 'error', 3200);
      selectTerritorialUnit(feature.id, true);
      return;
    }
    const explicitCoverage = feature.properties?.coverageMode === TERRITORIAL_COVERAGE_MODES.EXPLICIT;
    if (field === 'sovereignId' && explicitCoverage && String(value) !== String(feature.properties.sovereignId || '')) {
      const candidateUnits = deepClone(state.territorialUnits);
      const candidateFeature = candidateUnits.find(item => String(item.id) === String(feature.id));
      Object.assign(candidateFeature, changeSovereign(candidateFeature, value));
      const normalizedUnits = normalizeTerritorialUnits(candidateUnits, { countryExists: id => !!countryFeatureById(id) });
      territorialApplicationService.replaceUnits(normalizedUnits, {
        type: 'territorial-sovereign', affectedIds: [feature.id],
      });
      markLayerTreeDirty();
      selectTerritorialUnit(feature.id, true);
      queueAutosave();
      setActionStatus('지방의 주권 관계를 변경했습니다. 형상은 변경하지 않았습니다.', 'success');
      return;
    }
    if (field === 'sovereignId' && String(value) !== String(feature.properties.sovereignId || '')) {
      const nextCountry = countryFeatureById(value);
      const prefix = feature.properties.unitType === TERRITORIAL_UNIT_TYPES.ADMIN ? 'administrative' : 'territory';
      $(`${prefix}CountryInput`).value = String(feature.properties.sovereignId || '');
      if (!nextCountry) {
        recordHistory();
        feature.properties.sovereignId = '';
        feature.properties.parentId = '';
        feature.properties.isRemainder = false;
        normalizeProjectObjects();
        selectTerritorialUnit(feature.id, true);
        markLayerTreeDirty();
        renderAll();
        queueAutosave();
        return;
      }
      requestTerritorialUnitTransfer(feature.id, String(value));
      return;
    }
    if (field === 'parentId' && !explicitCoverage) {
      const parent = value ? territorialUnitById(value) : countryFeatureById(feature.properties.sovereignId);
      if (!parent || !territorialUnitInsideContainer(feature, parent)) {
        $('administrativeParentInput').value = String(feature.properties.parentId || '');
        setActionStatus('행정구역 전체가 새 부모 안에 들어갈 때만 상위 영역을 변경할 수 있습니다.', 'error', 4200);
        return;
      }
    }
    const canonicalField = field === 'level' ? 'adminLevel' : field;
    const candidateUnits = deepClone(state.territorialUnits);
    const candidateFeature = candidateUnits.find(item => String(item.id) === String(feature.id));
    if (field === 'color') setTerritorialStyleColor(candidateFeature, value);
    else if (canonicalField === 'parentId') Object.assign(candidateFeature, changeParent(candidateFeature, value));
    else if (canonicalField === 'sovereignId') Object.assign(candidateFeature, changeSovereign(candidateFeature, value));
    else if (canonicalField === 'unitType') Object.assign(candidateFeature, changeUnitType(candidateFeature, value));
    else candidateFeature.properties[canonicalField] = value;
    let normalizedUnits;
    try {
      normalizedUnits = normalizeTerritorialUnits(candidateUnits, { countryExists: id => !!countryFeatureById(id) });
    } catch (error) {
      selectTerritorialUnit(feature.id, true);
      const validationMessage = compactNotificationMessage(error?.message || '영역 정보를 검증하지 못했습니다.', { tone: 'error', maxLength: 52 });
      setActionStatus(validationMessage, 'error', 0);
      return;
    }
    territorialApplicationService.replaceUnits(normalizedUnits, {
      type: 'territorial-metadata', affectedIds: [feature.id],
    });
    markLayerTreeDirty();
    selectTerritorialUnit(feature.id, true);
    queueAutosave();
    const unitLabel = feature.properties.unitType === TERRITORIAL_UNIT_TYPES.ADMIN
      ? '행정구역'
      : feature.properties.unitType === TERRITORIAL_UNIT_TYPES.REGION
        ? '지방'
        : '권역';
    setActionStatus(`${unitLabel} 정보를 변경했습니다.`, 'success');
  }

  async function transferTerritorialUnitToCountry(unitId, targetCountryId) {
    const source = territorialUnitById(unitId);
    const donor = countryFeatureById(source?.properties?.sovereignId);
    const target = countryFeatureById(targetCountryId);
    const clipper = window.polygonClipping;
    if (!source || !donor || !target || donor === target || !clipper?.difference || !clipper?.union) return false;
    if (source.properties?.locked) {
      setActionStatus('영역 잠금을 해제한 뒤 소속과 국경을 변경하세요.', 'error', 3600);
      return false;
    }
    if (!requireCountriesUnlocked([donor.properties?.editor_id, targetCountryId], '권역과 국경을 이전')) return false;
    const movedIds = new Set([String(source.id)]);
    const queue = [String(source.id)];
    while (queue.length) {
      const parentId = queue.shift();
      for (const child of territorialChildren(state.territorialUnits, parentId)) {
        if (movedIds.has(String(child.id))) continue;
        movedIds.add(String(child.id));
        queue.push(String(child.id));
      }
    }
    const sourceGeometry = deepClone(source.geometry);
    try {
      await runTerritorialUnitTransaction({
        snapshot: snapshotEditable,
        calculate: async () => {
          const donorGeometry = normalizeClippedLandGeometry(clipper.difference(donor.geometry.coordinates, sourceGeometry.coordinates));
          const targetGeometry = normalizeClippedLandGeometry(clipper.union(target.geometry.coordinates, sourceGeometry.coordinates));
          if (!donorGeometry) throw new Error('이전하면 기존 국가의 국토가 남지 않습니다. 새 국가로 독립을 사용하세요.');
          if (!targetGeometry) throw new Error('대상 국가에 권역을 결합하지 못했습니다.');
          const nextUnits = deepClone(state.territorialUnits).flatMap(feature => {
            if (movedIds.has(String(feature.id))) {
              feature.properties.sovereignId = String(targetCountryId);
              if (String(feature.id) === String(source.id)) feature.properties.parentId = String(targetCountryId);
              return [feature];
            }
            if (String(feature.properties?.sovereignId || '') !== String(donor.properties.editor_id)) return [feature];
            const remainder = normalizeClippedLandGeometry(clipper.difference(feature.geometry.coordinates, sourceGeometry.coordinates));
            if (!remainder) return [];
            feature.geometry = remainder;
            return [feature];
          });
          return {
            donorGeometry: normalizeCountryGeometry(donorGeometry),
            targetGeometry: normalizeCountryGeometry(targetGeometry),
            nextUnits: normalizeTerritorialUnits(nextUnits, { countryExists: id => !!countryFeatureById(id) }),
          };
        },
        validate: result => {
          if (!result.donorGeometry || !result.targetGeometry) return { ok: false, message: '국경 변경 결과가 유효하지 않습니다.' };
          return validateTerritorialUnitRelations(result.nextUnits, { countryExists: id => !!countryFeatureById(id) });
        },
        apply: async result => {
          donor.geometry = result.donorGeometry;
          target.geometry = result.targetGeometry;
          state.territorialUnits = result.nextUnits;
          reindexCountries(state.countriesData, true);
          reconcileTerritorialUnitCompleteness([donor.properties.editor_id, target.properties.editor_id]);
          markCountryGeometriesChanged([donor.properties.editor_id, target.properties.editor_id]);
          refreshCountryCentroids([donor.properties.editor_id, target.properties.editor_id]);
          markLayerTreeDirty();
          selectTerritorialUnit(unitId, true);
          renderAll();
          clearActiveSnap();
        },
        restore: before => restoreEditable(before),
        recordHistory: before => commitHistorySnapshot(before),
        autosave: queueAutosave,
      });
      setActionStatus(`${territorialUnitName(source)} 소속과 국경을 변경했습니다.`, 'success', 4200);
      return true;
        } catch (error) {
          clearActiveSnap();
      reportOperationError(error, '권역을 다른 국가로 이전하지 못해 변경을 되돌렸습니다.', 'PL-REGION-TRANSFER-001', 4800);
      return false;
    }
  }

  function requestTerritorialUnitTransfer(unitId, targetCountryId) {
    const feature = territorialUnitById(unitId);
    const target = countryFeatureById(targetCountryId);
    if (!feature || !target) return;
    openConfirmModal({
      title: '실제 국경 변경',
      message: `${territorialUnitName(feature)}의 형상을 기존 국가에서 제거하고 ${countryName(target)} 국토에 더합니다. 하위 행정구역도 함께 이전되며 실행취소할 수 있습니다.`,
      impacts: [
        '국가 2개의 실제 국경 변경',
        `${territorialUnitName(feature)} 소속 국가 변경`,
        `하위 영역 ${territorialChildren(state.territorialUnits, feature.id).length}개 함께 이전`,
      ],
      confirmText: '권역과 국경 이전',
      danger: true,
      onConfirm: () => transferTerritorialUnitToCountry(feature.id, targetCountryId),
    });
  }

  async function promoteTerritorialUnitToCountry(unitId) {
    const source = territorialUnitById(unitId);
    const sourceCountryId = String(source?.properties?.sovereignId || '');
    const sourceCountry = countryFeatureById(sourceCountryId);
    const name = String(source?.properties?.name || '').trim();
    if (!source || !sourceCountry || !name) {
      setActionStatus('새 국가로 독립하려면 이름과 소속 국가가 있는 권역을 선택하세요.', 'error', 3800);
      return false;
    }
    if (source.properties?.locked) {
      setActionStatus('영역 잠금을 해제한 뒤 국가로 전환하세요.', 'error', 3400);
      return false;
    }
    if (!requireCountriesUnlocked([sourceCountryId], '권역을 국가로 전환')) return false;
    if (countryFeatureById(source.id)) {
      setActionStatus('영역 ID가 국가 ID와 겹칩니다. ID를 바꾸세요.', 'error', 4200);
      return false;
    }
    const descendantIds = new Set();
    const queue = [String(source.id)];
    while (queue.length) {
      const parentId = queue.shift();
      for (const child of territorialChildren(state.territorialUnits, parentId)) {
        if (descendantIds.has(String(child.id))) continue;
        descendantIds.add(String(child.id));
        queue.push(String(child.id));
      }
    }
    const convertedMetadata = source.properties?.metadata?.convertedFromCountry || {};
    const restoredProperties = convertedMetadata.properties && typeof convertedMetadata.properties === 'object'
      ? deepClone(convertedMetadata.properties)
      : {};
    const country = createCountryFeature(name, [], territorialStyleColor(source) || null, snapGeometryToGrid(source.geometry, 7));
    country.properties = {
      ...country.properties,
      ...restoredProperties,
      editor_id: String(source.id),
      editor_name: name,
      editor_original_name: String(restoredProperties.editor_original_name || name),
      editor_color: territorialStyleColor(source) || restoredProperties.editor_color || country.properties.editor_color,
      notes: String(source.properties?.notes || restoredProperties.notes || ''),
    };
    const restoredOverride = convertedMetadata.override && typeof convertedMetadata.override === 'object'
      ? deepClone(convertedMetadata.override)
      : {};
    const snapshot = snapshotEditable();
    setActionStatus('선택한 권역을 새 국가로 독립시키는 중입니다.', 'working', 0);
    const result = await transactCountryEdit({
      operation: 'new-country',
      payload: { sourceIds: [sourceCountryId], transferredGeometry: source.geometry, newFeature: country },
      snapshot,
      applyResult: plan => {
        state.countryOverrides[source.id] = {
          ...restoredOverride,
          name,
          color: territorialStyleColor(source) || restoredOverride.color || '',
          notes: String(source.properties?.notes || restoredOverride.notes || ''),
        };
        applyWorkerCountryPatches(plan);
        reindexCountries(state.countriesData, true);
        state.territorialUnits = state.territorialUnits.flatMap(feature => {
          if (String(feature.id) === String(source.id)) return [];
          if (descendantIds.has(String(feature.id))) {
            feature.properties.sovereignId = String(country.properties.editor_id);
            if (String(feature.properties?.parentId || '') === String(source.id)) feature.properties.parentId = String(country.properties.editor_id);
            return [feature];
          }
          if (String(feature.properties?.sovereignId || '') !== sourceCountryId) return [feature];
          const remainder = normalizeClippedLandGeometry(window.polygonClipping.difference(feature.geometry.coordinates, source.geometry.coordinates));
          if (!remainder) return [];
          feature.geometry = remainder;
          return [feature];
        });
        state.territorialRelations = state.territorialRelations.filter(relation => String(relation.unitId || '') !== String(source.id));
        for (const relation of state.territorialRelations) {
          const related = String(relation.unitId || '') === String(source.id) || descendantIds.has(String(relation.unitId || ''));
          if (related && String(relation.sovereignId || '') === sourceCountryId) relation.sovereignId = String(country.properties.editor_id);
          if (String(relation.parentId || '') === String(source.id)) relation.parentId = String(country.properties.editor_id);
        }
        for (const entry of state.distributionEntries) {
          if (entry.mode === DISTRIBUTION_MODES.TERRITORIAL && String(entry.territorialUnitId) === String(source.id)) entry.territorialUnitId = String(country.properties.editor_id);
        }
        state.territorialUnits = normalizeTerritorialUnits(state.territorialUnits, { countryExists: id => !!countryFeatureById(id) });
        reconcileTerritorialUnitCompleteness([sourceCountryId, country.properties.editor_id]);
        refreshCountryCentroids(new Set(plan.affectedIds));
        markLayerTreeDirty();
        selectCountry(country.properties.editor_id, false, false);
        renderAll();
      },
      onSuccess: () => setActionStatus(`${name} 권역을 새 국가로 독립시켰습니다. 하위 행정구역은 유지했습니다.`, 'success', 4000),
      onError: error => reportOperationError(error, '권역을 새 국가로 독립시키지 못했습니다.', 'PL-REGION-PROMOTE-001', 4700),
    });
    return result.ok;
  }

  function buildTerritorialStructurePreview({ source, sourceType, targetType, sovereignId = '', parentId = '' } = {}) {
    if (!source || !sourceType || !targetType) return null;
    const sourceName = territorialTypeSourceName(source);
    const sourceLabel = TERRITORIAL_TYPE_LABELS[sourceType] || '영역';
    const targetLabel = TERRITORIAL_TYPE_LABELS[targetType] || '영역';
    const subjectLabel = ({ 국가: '국가를', 권역: '권역을', 지방: '지방을', 행정구역: '행정구역을' })[sourceLabel] || `${sourceLabel}을`;
    const directionLabel = ({ 국가: '국가로', 권역: '권역으로', 지방: '지방으로', 행정구역: '행정구역으로' })[targetLabel] || `${targetLabel}으로`;
    const sourceIsCountry = sourceType === TERRITORIAL_UNIT_TYPES.COUNTRY;
    const targetIsCountry = targetType === TERRITORIAL_UNIT_TYPES.COUNTRY;
    const childCount = sourceIsCountry
      ? state.territorialUnits.filter(candidate => String(candidate.properties?.sovereignId || '') === String(source.properties?.editor_id || source.id || '')).length
      : territorialChildren(state.territorialUnits, source.id).length;
    const targetCountry = countryFeatureById(sovereignId);
    const targetParent = territorialUnitById(parentId);
    const impacts = [];
    let summary = `${sourceName}의 종류를 ${targetLabel}(으)로 변경합니다.`;

    if (sourceIsCountry && !targetIsCountry) {
      if (!targetCountry) {
        return {
          title: `${subjectLabel} ${directionLabel} 전환`,
          summary: '소속 국가를 선택해야 변경 결과를 확인할 수 있습니다.',
          impacts: [],
          confirmText: `${directionLabel} 전환`,
          danger: true,
        };
      }
      summary = `${sourceName}의 국토를 ${countryName(targetCountry)}에 합치고 같은 객체를 ${targetLabel}(으)로 유지합니다.`;
      impacts.push(`${countryName(targetCountry)} 국경 변경 및 기존 국가 관계 해제`);
    } else if (targetIsCountry) {
      summary = `${sourceName}의 영역을 현재 소속 국가에서 분리해 독립 국가로 전환합니다.`;
      impacts.push('기존 상위 영역과 소속 국가 관계 해제', '기존 국가 국경 변경 및 새 국가 1개 생성');
    } else {
      const sovereign = countryFeatureById(sovereignId || source.properties?.sovereignId);
      impacts.push(`소속 국가 유지${sovereign ? `: ${countryName(sovereign)}` : ''}`);
      if (targetType === TERRITORIAL_UNIT_TYPES.ADMIN) {
        const parentName = targetParent ? territorialUnitName(targetParent) : sovereign ? `${countryName(sovereign)} 직속` : '선택한 상위 영역';
        impacts.push(`상위 영역: ${parentName}`, '행정 단계는 상위 관계에서 자동 계산');
      } else if (sourceType === TERRITORIAL_UNIT_TYPES.ADMIN) {
        impacts.push('기존 행정 단계와 상위 행정 관계 해제');
      }
    }

    impacts.push('현재 형상과 객체 ID 유지', `하위 영역 ${childCount}개 유지`, '연결된 분포 참조 유지', '한 번의 실행취소로 복구 가능');
    return {
      title: `${subjectLabel} ${directionLabel} 전환`,
      summary,
      impacts,
      confirmText: `${directionLabel} 전환`,
      danger: sourceIsCountry || targetIsCountry,
    };
  }

  function requestTerritorialUnitPromotion(unitId) {
    const feature = territorialUnitById(unitId);
    if (!feature) return;
    const preview = buildTerritorialStructurePreview({
      source: feature,
      sourceType: feature.properties?.unitType,
      targetType: TERRITORIAL_UNIT_TYPES.COUNTRY,
      sovereignId: feature.properties?.sovereignId,
    });
    if (!preview) return;
    openConfirmModal({
      title: preview.title,
      message: preview.summary,
      impacts: preview.impacts,
      confirmText: preview.confirmText,
      danger: preview.danger,
      onConfirm: () => promoteTerritorialUnitToCountry(feature.id),
    });
  }

  let territorialTypeSource = null;

  function territorialTypeSourceFeature() {
    if (!territorialTypeSource) return null;
    return territorialTypeSource.unitType === TERRITORIAL_UNIT_TYPES.COUNTRY
      ? countryFeatureById(territorialTypeSource.id)
      : territorialUnitById(territorialTypeSource.id);
  }

  function territorialTypeSourceName(feature = territorialTypeSourceFeature()) {
    return territorialTypeSource?.unitType === TERRITORIAL_UNIT_TYPES.COUNTRY
      ? countryName(feature)
      : territorialUnitName(feature);
  }

  function territorialTypeParentOptions(source, sovereignId) {
    const country = countryFeatureById(sovereignId);
    if (!country) return [];
    const excluded = new Set([String(source?.id || source?.properties?.editor_id || '')]);
    const queue = [...excluded];
    while (queue.length) {
      const current = queue.shift();
      for (const child of territorialChildren(state.territorialUnits, current)) {
        if (excluded.has(String(child.id))) continue;
        excluded.add(String(child.id));
        queue.push(String(child.id));
      }
    }
    return [
      { value: String(sovereignId), label: `${countryName(country)} · 국가 직속` },
      ...state.territorialUnits
        .filter(candidate => !excluded.has(String(candidate.id))
          && String(candidate.properties?.sovereignId || '') === String(sovereignId)
          && territorialUnitInsideContainer(source, candidate))
        .map(candidate => ({
          value: String(candidate.id),
          label: `${territorialUnitName(candidate)} · ${candidate.properties?.unitType === TERRITORIAL_UNIT_TYPES.ADMIN ? `${Number(candidate.properties.adminLevel) || 1}급 행정구역` : territorialTypeLabel(candidate.properties?.unitType)}`,
        }))
        .sort((left, right) => layerNameCollator.compare(left.label, right.label)),
    ];
  }

  function syncTerritorialTypeModal() {
    const source = territorialTypeSourceFeature();
    if (!source) {
      closeTerritorialTypeModal();
      return;
    }
    const sourceType = territorialTypeSource.unitType;
    const targetType = $('territorialTypeInput').value;
    const sourceIsCountry = sourceType === TERRITORIAL_UNIT_TYPES.COUNTRY;
    const targetIsCountry = targetType === TERRITORIAL_UNIT_TYPES.COUNTRY;
    const targetIsAdmin = targetType === TERRITORIAL_UNIT_TYPES.ADMIN;
    const sovereignRow = $('territorialTypeSovereignRow');
    sovereignRow.classList.toggle('hidden', !sourceIsCountry || targetIsCountry);

    let sovereignId = sourceIsCountry ? $('territorialTypeSovereignInput').value : String(source.properties?.sovereignId || '');
    if (sourceIsCountry && !targetIsCountry) {
      const options = territorialUnitCountryOptions().filter(option => option.value && option.value !== String(territorialTypeSource.id));
      if (!options.some(option => option.value === sovereignId)) sovereignId = String(options[0]?.value || '');
      replaceSelectOptions($('territorialTypeSovereignInput'), options, sovereignId);
    }

    const parentRow = $('territorialTypeParentRow');
    parentRow.classList.toggle('hidden', !targetIsAdmin);
    if (targetIsAdmin) {
      const options = territorialTypeParentOptions(source, sovereignId);
      const currentParent = $('territorialTypeParentInput').value;
      const preferredParent = options.some(option => option.value === currentParent)
        ? currentParent
        : options.some(option => option.value === String(source.properties?.parentId || ''))
          ? String(source.properties.parentId)
          : String(options[0]?.value || '');
      replaceSelectOptions($('territorialTypeParentInput'), options, preferredParent);
    }

    const targetCountry = countryFeatureById(sovereignId);
    const preview = buildTerritorialStructurePreview({
      source,
      sourceType,
      targetType,
      sovereignId,
      parentId: $('territorialTypeParentInput').value,
    });
    $('territorialTypeTitle').textContent = preview?.title || '종류 변경';
    $('territorialTypeImpactSummary').textContent = preview?.summary || '';
    $('territorialTypeImpactList').replaceChildren(...(preview?.impacts || []).map(value => {
      const item = document.createElement('li');
      item.textContent = value;
      return item;
    }));
    $('territorialTypeImpact').classList.toggle('danger-preview', preview?.danger === true);
    const confirm = $('territorialTypeConfirmBtn');
    confirm.textContent = preview?.confirmText || '종류 변경';
    confirm.classList.toggle('danger-confirm', preview?.danger === true);
    confirm.disabled = sourceType === targetType || (sourceIsCountry && !targetIsCountry && !targetCountry)
      || (targetIsAdmin && !$('territorialTypeParentInput').value);
  }

  function openTerritorialTypeModal(unitType, id) {
    const source = unitType === TERRITORIAL_UNIT_TYPES.COUNTRY ? countryFeatureById(id) : territorialUnitById(id);
    if (!source || ![TERRITORIAL_UNIT_TYPES.COUNTRY, TERRITORIAL_UNIT_TYPES.TERRITORY, TERRITORIAL_UNIT_TYPES.ADMIN].includes(unitType)) return;
    if (!requireCanonicalData()) return;
    const sourceLocked = unitType === TERRITORIAL_UNIT_TYPES.COUNTRY ? isCountryLocked(id) : source.properties?.locked === true;
    if (sourceLocked) {
      setActionStatus('잠금을 해제한 뒤 종류를 변경하세요.', 'error', 3400);
      return;
    }
    territorialTypeSource = { unitType, id: String(id) };
    const options = Object.entries(TERRITORIAL_TYPE_LABELS)
      .filter(([type]) => [TERRITORIAL_UNIT_TYPES.COUNTRY, TERRITORIAL_UNIT_TYPES.TERRITORY, TERRITORIAL_UNIT_TYPES.ADMIN].includes(type) && type !== unitType)
      .map(([value, label]) => ({ value, label }));
    const preferred = unitType === TERRITORIAL_UNIT_TYPES.ADMIN ? TERRITORIAL_UNIT_TYPES.TERRITORY
      : unitType === TERRITORIAL_UNIT_TYPES.TERRITORY ? TERRITORIAL_UNIT_TYPES.ADMIN
        : TERRITORIAL_UNIT_TYPES.TERRITORY;
    replaceSelectOptions($('territorialTypeInput'), options, preferred);
    $('territorialTypeContext').textContent = `${territorialTypeSourceName(source)} · 현재 ${TERRITORIAL_TYPE_LABELS[unitType]}`;
    $('territorialTypeSovereignInput').value = '';
    $('territorialTypeParentInput').value = '';
    $('territorialTypeModal').classList.remove('hidden');
    syncTerritorialTypeModal();
    requestAnimationFrame(() => $('territorialTypeInput').focus());
  }

  function closeTerritorialTypeModal() {
    $('territorialTypeModal')?.classList.add('hidden');
    territorialTypeSource = null;
  }

  async function convertTerritorialUnitType(unitId, targetType, parentId = '') {
    const source = territorialUnitById(unitId);
    if (!source || ![TERRITORIAL_UNIT_TYPES.TERRITORY, TERRITORIAL_UNIT_TYPES.ADMIN].includes(targetType)) return false;
    if (source.properties?.locked) {
      setActionStatus('잠금을 해제한 뒤 종류를 변경하세요.', 'error', 3200);
      return false;
    }
    const sovereignId = String(source.properties?.sovereignId || '');
    const parent = targetType === TERRITORIAL_UNIT_TYPES.ADMIN
      ? territorialUnitById(parentId || sovereignId)
      : countryFeatureById(sovereignId);
    if (!parent || (targetType === TERRITORIAL_UNIT_TYPES.ADMIN && !territorialUnitInsideContainer(source, parent))) {
      setActionStatus('영역 전체를 포함하는 올바른 상위 영역을 선택하세요.', 'error', 3900);
      return false;
    }
    try {
      await runTerritorialUnitTransaction({
        snapshot: snapshotEditable,
        calculate: async () => {
          const nextUnits = deepClone(state.territorialUnits);
          const index = nextUnits.findIndex(feature => String(feature.id) === String(unitId));
          if (index < 0) throw new Error('종류를 변경할 영역을 찾을 수 없습니다.');
          const converted = changeUnitType(nextUnits[index], targetType);
          converted.properties.parentId = targetType === TERRITORIAL_UNIT_TYPES.ADMIN
            ? String(parentId || sovereignId)
            : sovereignId;
          nextUnits[index] = converted;
          return normalizeTerritorialUnits(nextUnits, { countryExists: id => !!countryFeatureById(id) });
        },
        validate: nextUnits => validateTerritorialUnitRelations(nextUnits, {
          countryExists: id => !!countryFeatureById(id),
          relations: state.territorialRelations,
        }),
        apply: async nextUnits => {
          state.territorialUnits = nextUnits;
          reconcileTerritorialUnitCompleteness([sovereignId]);
          state.territorialUnits = normalizeTerritorialUnits(state.territorialUnits, { countryExists: id => !!countryFeatureById(id) });
          markLayerTreeDirty();
          selectTerritorialUnit(unitId, true);
          renderAll();
        },
        restore: before => restoreEditable(before),
        recordHistory: before => commitHistorySnapshot(before),
        autosave: queueAutosave,
      });
      setActionStatus(`${territorialUnitName(territorialUnitById(unitId))}을(를) ${TERRITORIAL_TYPE_LABELS[targetType]}(으)로 변경했습니다.`, 'success', 3600);
      return true;
    } catch (error) {
      reportOperationError(error, '영역 종류를 변경하지 못해 변경을 되돌렸습니다.', 'PL-TYPE-001', 4500);
      return false;
    }
  }

  async function convertCountryToRegionType(countryId, targetType, targetCountryId, parentId = '') {
    const source = countryFeatureById(countryId);
    const target = countryFeatureById(targetCountryId);
    if (!source || !target || source === target || ![TERRITORIAL_UNIT_TYPES.TERRITORY, TERRITORIAL_UNIT_TYPES.ADMIN].includes(targetType)) {
      setActionStatus('종류를 변경할 국가와 소속 국가를 다시 선택하세요.', 'error', 3800);
      return false;
    }
    if (!requireCountriesUnlocked([countryId, targetCountryId], '국가 종류를 변경')) return false;
    if (territorialUnitById(countryId)) {
      setActionStatus('같은 ID의 영역이 이미 있어 종류를 변경할 수 없습니다.', 'error', 4000);
      return false;
    }
    const parent = targetType === TERRITORIAL_UNIT_TYPES.ADMIN ? territorialUnitById(parentId || targetCountryId) : target;
    if (!parent || (String(parent.id || parent.properties?.editor_id || '') !== String(targetCountryId) && !territorialUnitInsideContainer(source, parent))) {
      setActionStatus('국가 영역 전체를 포함하는 올바른 상위 영역을 선택하세요.', 'error', 3900);
      return false;
    }
    const sourceOverride = deepClone(state.countryOverrides[countryId] || {});
    const sourceProperties = deepClone(source.properties || {});
    const name = countryName(source);
    const sourceGeometry = deepClone(source.geometry);
    const converted = createTerritorialFeature({
      id: uid(),
      unitType: targetType,
      name,
      geometry: sourceGeometry,
      parentId: targetType === TERRITORIAL_UNIT_TYPES.ADMIN ? String(parentId || targetCountryId) : String(targetCountryId),
      sovereignId: String(targetCountryId),
      isRemainder: false,
      coverageMode: TERRITORIAL_COVERAGE_MODES.PARTITION,
      adminLevel: targetType === TERRITORIAL_UNIT_TYPES.ADMIN ? 1 : null,
      color: String(sourceOverride.color || sourceProperties.editor_color || ''),
      notes: String(sourceOverride.notes || sourceProperties.notes || ''),
      metadata: { convertedFromCountry: { properties: sourceProperties, override: sourceOverride } },
    });
    const snapshot = snapshotEditable();
    setActionStatus(`${name}의 국가 경계를 대상 국가에 합치는 중입니다.`, 'working', 0);
    const result = await transactCountryEdit({
      operation: 'merge',
      payload: { sourceId: String(targetCountryId), targetIds: [String(countryId)] },
      snapshot,
      applyResult: plan => {
        applyWorkerCountryPatches(plan);
        state.territorialUnits.push(converted);
        for (const feature of state.territorialUnits) {
          if (String(feature.properties?.sovereignId || '') !== String(countryId)) continue;
          feature.properties.sovereignId = String(targetCountryId);
          if (String(feature.properties?.parentId || '') === String(countryId)) feature.properties.parentId = String(converted.id);
        }
        for (const relation of state.territorialRelations) {
          if (String(relation.sovereignId || '') === String(countryId)) relation.sovereignId = String(targetCountryId);
          if (String(relation.parentId || '') === String(countryId)) relation.parentId = String(converted.id);
        }
        for (const entry of state.distributionEntries) {
          if (entry.mode === DISTRIBUTION_MODES.TERRITORIAL && String(entry.territorialUnitId) === String(countryId)) entry.territorialUnitId = String(converted.id);
        }
        for (const drawing of state.drawings) {
          if (String(drawing.properties?.pandolab_owner_id || '') !== String(countryId)) continue;
          drawing.properties.pandolab_owner_id = String(targetCountryId);
          if (String(drawing.properties.pandolab_topology_group || '') === `land:${countryId}`) drawing.properties.pandolab_topology_group = `land:${targetCountryId}`;
        }
        state.territorialUnits = normalizeTerritorialUnits(state.territorialUnits, { countryExists: id => !!countryFeatureById(id) });
        reconcileTerritorialUnitCompleteness([targetCountryId]);
        state.territorialUnits = normalizeTerritorialUnits(state.territorialUnits, { countryExists: id => !!countryFeatureById(id) });
        const territorialValidation = validateTerritorialUnitRelations(state.territorialUnits, {
          countryExists: id => !!countryFeatureById(id),
          relations: state.territorialRelations,
        });
        if (!territorialValidation.ok) throw new Error(territorialValidation.issues[0] || '영역 관계가 올바르지 않습니다.');
        refreshCountryCentroids(new Set(plan.affectedIds));
        state.boundaryTopology = { edges: new Map(), nodes: new Map() };
        markLayerTreeDirty();
        selectTerritorialUnit(countryId, true);
        renderAll();
      },
      onSuccess: () => setActionStatus(`${name}을(를) ${countryName(target)} 소속 ${TERRITORIAL_TYPE_LABELS[targetType]}(으)로 변경했습니다.`, 'success', 4300),
      onError: error => reportOperationError(error, '국가 종류를 변경하지 못해 변경을 되돌렸습니다.', 'PL-TYPE-002', 4800),
    });
    return result.ok;
  }

  async function confirmTerritorialTypeConversion() {
    const source = territorialTypeSourceFeature();
    if (!source || !territorialTypeSource) return;
    const sourceRef = { ...territorialTypeSource };
    const targetType = $('territorialTypeInput').value;
    const sovereignId = sourceRef.unitType === TERRITORIAL_UNIT_TYPES.COUNTRY
      ? $('territorialTypeSovereignInput').value
      : String(source.properties?.sovereignId || '');
    const parentId = $('territorialTypeParentInput').value;
    closeTerritorialTypeModal();
    if (sourceRef.unitType === TERRITORIAL_UNIT_TYPES.COUNTRY) {
      await convertCountryToRegionType(sourceRef.id, targetType, sovereignId, parentId);
    } else if (targetType === TERRITORIAL_UNIT_TYPES.COUNTRY) {
      await promoteTerritorialUnitToCountry(sourceRef.id);
    } else {
      await convertTerritorialUnitType(sourceRef.id, targetType, parentId);
    }
  }

  function commitLabelEdit(field, value) {
    if (state.selected?.domain !== 'label') return;
    const label = state.labels.find(x => x.id === state.selected.id);
    if (!label) return;
    recordHistory();
    label[field] = value;
    if (field === 'name' || field === 'kind') markLayerTreeDirty();
    selectLabel(label.id, true);
    queueAutosave();
    setActionStatus('지명 정보를 변경했습니다.', 'success');
  }

  function configureDatasetSession(project = null) {
    const deltaProject = project?.format === 'pandolab-autosave-delta';
    const pristineCompatible = !project?.countriesData || project.baseDataset === BASE_DATASET || deltaProject;
    state.sessionBaseCountriesJson = pristineCompatible
      ? null
      : JSON.stringify(state.countriesData || { type: 'FeatureCollection', features: [] });
    state.historyDirtyCountryIds = new Set();
    if (deltaProject) {
      const delta = project.countryDelta || { changed: [], removedIds: [] };
      state.historyDirtyCountryIds = new Set([
        ...(delta.changed || []).map(feature => String(feature.properties?.editor_id || '')),
        ...(delta.removedIds || []).map(String),
      ].filter(Boolean));
      return;
    }
    if (project?.countriesData && pristineCompatible) {
      const pristine = parsePristineCountries();
      const pristineById = new Map((pristine.features || []).map((feature, index) => [featureCountryId(feature, index), feature]));
      const currentIds = new Set();
      for (const feature of state.countriesData?.features || []) {
        const id = String(feature.properties?.editor_id || feature.properties?.iso_a3 || '');
        currentIds.add(id);
        const pristine = pristineById.get(id);
        if (!pristine || JSON.stringify(pristine.geometry) !== JSON.stringify(feature.geometry)) state.historyDirtyCountryIds.add(id);
      }
      for (const id of pristineById.keys()) if (!currentIds.has(String(id))) state.historyDirtyCountryIds.add(String(id));
    }
  }

  function buildCountryDelta() {
    const current = new Map((state.countriesData?.features || []).map(feature => [String(feature.properties?.editor_id || ''), feature]));
    const changed = [];
    const removedIds = [];
    for (const id of state.historyDirtyCountryIds) {
      const feature = current.get(String(id));
      if (feature) changed.push(deepClone(feature));
      else removedIds.push(String(id));
    }
    return { changed, removedIds };
  }

  function restoreCountriesFromSnapshot(snapshot) {
    if (snapshot.countriesData) {
      state.countriesData = reindexCountries(deepClone(snapshot.countriesData), true);
      state.historyDirtyCountryIds = new Set();
      return;
    }
    const base = state.sessionBaseCountriesJson
      ? JSON.parse(state.sessionBaseCountriesJson)
      : parsePristineCountries();
    const delta = snapshot.countryDelta || { changed: [], removedIds: [] };
    const changed = new Map((delta.changed || []).map(feature => [String(feature.properties?.editor_id || ''), feature]));
    const removed = new Set((delta.removedIds || []).map(String));
    const seen = new Set();
    base.features = (base.features || []).filter(feature => !removed.has(String(feature.properties?.editor_id || feature.properties?.iso_a3 || ''))).map(feature => {
      const id = String(feature.properties?.editor_id || feature.properties?.iso_a3 || '');
      if (!changed.has(id)) return feature;
      seen.add(id);
      return deepClone(changed.get(id));
    });
    for (const [id, feature] of changed) if (!seen.has(id)) base.features.push(deepClone(feature));
    state.countriesData = reindexCountries(base, true);
    const unchangedIds = (state.countriesData.features || []).map(feature => String(feature.properties?.editor_id || '')).filter(id => !changed.has(id));
    if (!state.sessionBaseCountriesJson) applyPristineLabelAnchors(state.countriesData, unchangedIds);
    state.historyDirtyCountryIds = new Set(snapshot.historyDirtyCountryIds || [...changed.keys(), ...removed]);
  }

  function snapshotEditable() {
    return {
      countryDelta: buildCountryDelta(),
      historyDirtyCountryIds: [...state.historyDirtyCountryIds],
      ...pickProjectFields(state, { scope: 'history', clone: deepClone }),
    };
  }

  function applySharedProjectFields(source, scope = 'project') {
    return applyProjectFields(state, source, {
      scope,
      clone: deepClone,
      normalizers: {
        labelSettings: value => deepClone(value || {}),
        drawings: value => deepClone(value || []),
        hydroEdits: value => deepClone(value || []),
        territorialUnits: value => deepClone(value || []),
        territorialRelations: value => deepClone(value || []),
        distributionLayers: value => deepClone(value || []),
        distributionEntries: value => deepClone(value || []),
        distributionSettings: value => ({
          renderMode: value?.renderMode === DISTRIBUTION_RENDER_MODES.INTENSITY ? DISTRIBUTION_RENDER_MODES.INTENSITY : DISTRIBUTION_RENDER_MODES.DOMINANT,
          boundaryVisible: value?.boundaryVisible !== false,
        }),
        physicalSettings: (value, current) => normalizePhysicalSettings(value || current),
        layerVisibility: (value, current) => normalizeLayerVisibility(value, current),
        itemVisibility: value => normalizeLayerItemState(value),
        layerPresentation: value => normalizeLayerPresentation(value),
      },
    });
  }

  function normalizeProjectObjects() {
    state.hydroEdits = normalizeHydroEditCollection(state.hydroEdits);
    state.drawings = normalizeDrawingCollection(state.drawings || []);
    state.distributionLayers = normalizeDistributionLayers(state.distributionLayers);
    const distributionLayerIds = new Set(state.distributionLayers.map(layer => layer.id));
    state.distributionEntries = normalizeDistributionEntries(state.distributionEntries, {
      layerExists: id => distributionLayerIds.has(id),
    });
    state.distributionSettings = {
      renderMode: state.distributionSettings?.renderMode === DISTRIBUTION_RENDER_MODES.INTENSITY ? DISTRIBUTION_RENDER_MODES.INTENSITY : DISTRIBUTION_RENDER_MODES.DOMINANT,
      boundaryVisible: state.distributionSettings?.boundaryVisible !== false,
    };
    state.selectedDistributionLayerId = distributionLayerIds.has(String(state.selectedDistributionLayerId || ''))
      ? String(state.selectedDistributionLayerId)
      : '';
    state.territorialUnits = normalizeTerritorialUnits(state.territorialUnits, {
      countryExists: id => !!countryFeatureById(id),
    });
    state.territorialRelations = normalizeTerritorialRelations(state.territorialRelations);
    const relationValidation = territorialApplicationService.validateRelations(state.territorialUnits, {
      countryExists: id => !!countryFeatureById(id),
      relations: state.territorialRelations,
    });
    if (!relationValidation.ok) throw new Error(relationValidation.issues[0] || '영역 관계가 올바르지 않습니다.');
    const distributionValidation = validateDistributionModel(state.distributionLayers, state.distributionEntries, {
      territorialExists: id => !!territorialRepository.get(id),
    });
    if (!distributionValidation.ok) throw new Error(distributionValidation.issues[0] || '분포 참조가 올바르지 않습니다.');
    state.layerFolders = normalizeLayerFolderState(state.layerFolders);
  }

  function normalizeHistoryMetadata(meta = {}) {
    const primary = objectSelection.primary();
    const info = primary ? objectDisplayInfo(primary) : null;
    return {
      id: uid('history'),
      timestamp: new Date().toISOString(),
      type: String(meta.type || 'edit'),
      description: String(meta.description || (info ? `${info.name} 편집` : '지도 편집')),
      targetName: String(meta.targetName || info?.name || ''),
      affectedIds: [...new Set((meta.affectedIds || (primary ? [primary.id] : [])).map(String))],
    };
  }

  const historyStore = {
    get history() { return state.history; },
    set history(value) { state.history = value; },
    get historyMeta() { return state.historyMeta; },
    set historyMeta(value) { state.historyMeta = value; },
    get future() { return state.future; },
    set future(value) { state.future = value; },
    get futureMeta() { return state.futureMeta; },
    set futureMeta(value) { state.futureMeta = value; },
  };
  const historyService = createHistoryService({
    store: historyStore,
    maxEntries: MAX_HISTORY,
    snapshot: snapshotEditable,
    restore: restoreEditable,
    normalizeMetadata: normalizeHistoryMetadata,
    onRecord: () => saveState.markContentChanged(),
    onChange: updateHistoryButtons,
  });

  function commitHistorySnapshot(snapshot, meta = {}) {
    historyService.commitSnapshot(snapshot, meta);
  }

  function recordHistory(meta = {}) {
    historyService.record(meta);
  }

  function restoreEditable(snapshot) {
    const changedCountryIds = new Set(state.historyDirtyCountryIds);
    applySharedProjectFields(snapshot, 'history');
    gpuMapRenderer.invalidateHydroVisibility();
    syncPhysicalControls();
    restoreCountriesFromSnapshot(snapshot);
    normalizeProjectObjects();
    const restoredDirtyIds = new Set(state.historyDirtyCountryIds);
    for (const id of state.historyDirtyCountryIds) changedCountryIds.add(String(id));
    pruneLayerItemVisibility();
    scheduleCountryLabelAnchors(null, 10);
    markLayerTreeDirty();
    state.selected = null;
    objectSelectionSyncing = true;
    objectSelection.clear();
    objectSelectionSyncing = false;
    state.coastEditCountryId = null;
    state.coastEditScopeDrawingId = null;
    state.coastEditReturnSelection = null;
    resetBoundaryEditState();
    resetMergeState();
    resetDrawingMergeState();
    resetTerritorialUnitEditState();
    state.drawingSplitSourceId = null;
    resetTerritoryEditingState(true);
    state.tool = 'select';
    showPropertyForm(null);
    $('selectionStatus').textContent = '';
    state.boundaryTopology = { edges: new Map(), nodes: new Map() };
    state.sharedBoundaryTopology = { segments: new Map(), nodes: new Map() };
    updateModeButtons();
    if (changedCountryIds.size) markCountryGeometriesChanged(changedCountryIds);
    state.historyDirtyCountryIds = restoredDirtyIds;
    renderAll();
    queueAutosave();
  }

  function undo() {
    if (!requireCanonicalData()) return;
    if (state.modeProcessing) return;
    if (state.geometryPreview.session) {
      discardActiveGeometryPreview();
      return;
    }
    if (draftInputActive()) {
      performDraftUndo();
      return;
    }
    if (!historyService.undo({ description: '작업 실행취소' })) return;
    setActionStatus('이전 작업을 실행 취소했습니다.', 'success');
  }

  function redo() {
    if (!requireCanonicalData()) return;
    if (state.modeProcessing) return;
    if (state.geometryPreview.session) {
      setActionStatus('변경 미리보기를 먼저 적용하거나 취소하세요.', 'error', 2600);
      return;
    }
    if (draftInputActive()) {
      performDraftRedo();
      return;
    }
    if (!historyService.redo({ description: '작업 다시 실행' })) return;
    setActionStatus('작업을 다시 실행했습니다.', 'success');
  }

  function updateHistoryButtons() {
    const draftMode = draftInputActive();
    const undoAvailable = draftMode ? state.draftEdit.history.length > 0 : historyService.canUndo();
    const redoAvailable = draftMode ? state.draftEdit.future.length > 0 : historyService.canRedo();
    $('undoBtn').disabled = state.modeProcessing || !undoAvailable;
    $('redoBtn').disabled = state.modeProcessing || !redoAvailable;
    $('undoBtn').dataset.tooltip = draftMode ? '작성 중 실행 취소' : '실행 취소';
    $('redoBtn').dataset.tooltip = draftMode ? '작성 중 다시 실행' : '다시 실행';
    $('undoBtn').setAttribute('aria-label', draftMode ? '작성 중 실행 취소' : '실행 취소');
    $('redoBtn').setAttribute('aria-label', draftMode ? '작성 중 다시 실행' : '다시 실행');
    $('mapCommandToolbar')?.classList.toggle('history-empty', !undoAvailable && !redoAvailable);
  }

  function syncProjectionButtons() {
    for (const [id, projection] of [['globeBtn', 'globe'], ['flatBtn', 'flat']]) {
      const button = $(id);
      if (!button) continue;
      const active = state.projection === projection;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  function setProjection(type) {
    const targetProjection = type === 'globe' ? 'globe' : 'flat';
    if (targetProjection === state.projection) return false;
    updateProjection();
    const currentProjection = activeProjection();
    const currentCenter = screenToGeo(currentProjection.translate()) || (state.projection === 'globe'
      ? [-state.view.globeRotation[0], -state.view.globeRotation[1]]
      : state.view.flatCenter.slice());
    const currentScale = Number(currentProjection.scale()) || 1;
    const layout = projectionLayoutMetrics();
    const nextView = deepClone(state.view);
    if (targetProjection === 'globe') {
      nextView.globeRotation = [
        -wrappedLongitudeDelta(currentCenter[0]),
        -clamp(Number(currentCenter[1]), -89, 89),
        0,
      ];
      nextView.globeZoom = clamp(currentScale / layout.globeBaseScale, ZOOM_LIMITS.globe.min, ZOOM_LIMITS.globe.max);
    } else {
      nextView.flatCenter = [
        wrappedLongitudeDelta(currentCenter[0]),
        clamp(Number(currentCenter[1]), -85, 85),
      ];
      nextView.flatZoom = clamp(currentScale / layout.flatBaseScale, ZOOM_LIMITS.flat.min, ZOOM_LIMITS.flat.max);
    }
    const token = atomicMapStateController.begin({ kind: 'projection', type: targetProjection });
    if (!atomicMapStateController.commit(token, { projection: targetProjection, view: nextView })) return false;
    invalidateEditInteraction();
    syncProjectionButtons();
    renderAll();
    queueViewAutosave();
    return true;
  }

  function setLayerVisibility(key, visible) {
    state.layerVisibility[key] = visible;
    if (DISTRIBUTION_GROUP_TYPES[key]) distributionVisibilityRevision += 1;
    if (key === 'countries') gpuMapRenderer.invalidateCountryPalette({ base: true, emphasis: true }, 'country-layer-visibility');
    if (key === 'rivers' || key === 'lakes') gpuMapRenderer.invalidateHydroVisibility();
    renderAll();
    queuePresentationAutosave();
  }

  const LAYER_STYLE_TARGETS = Object.freeze({
    countries: { presentationGroup: 'countries', label: '국가', opacity: true, boundary: true, boundaryLabel: '국경 표시' },
    territories: { presentationGroup: 'territories', label: '권역', opacity: true, boundary: true },
    administrative: { presentationGroup: 'administrative', label: '행정구역', opacity: true, boundary: true },
    regions: { presentationGroup: 'regions', label: '지방', opacity: true, boundary: true },
    languages: { presentationGroup: 'languages', label: '언어', opacity: true, blendMode: true },
    ethnicities: { presentationGroup: 'ethnicities', label: '민족', opacity: true, blendMode: true },
    religions: { presentationGroup: 'religions', label: '종교', opacity: true, blendMode: true },
    rivers: { presentationGroup: 'rivers', label: '강', opacity: true },
    lakes: { presentationGroup: 'lakes', label: '호수', opacity: true },
    userDrawings: { presentationGroup: 'userDrawings', label: '사용자 지형지물', opacity: true, opacityLabel: '전체 투명도' },
  });

  function updateLayerPresentationStyle(group, patch) {
    const target = LAYER_STYLE_TARGETS[group];
    if (!target) return false;
    const currentStyle = layerStyle(state.layerPresentation, target.presentationGroup);
    state.layerPresentation = normalizeLayerPresentation({
      ...state.layerPresentation,
      styles: {
        ...state.layerPresentation.styles,
        [target.presentationGroup]: {
          ...currentStyle,
          ...patch,
          boundaryWidth: 1,
          labelsVisible: currentStyle.labelsVisible,
        },
      },
    });
    syncLayerStylePanels();
    if (target.presentationGroup === 'countries') {
      gpuMapRenderer.invalidateCountryPalette({ base: true, emphasis: true }, 'country-presentation');
    }
    if (target.presentationGroup === 'rivers' || target.presentationGroup === 'lakes') {
      gpuMapRenderer.invalidatePhysicalStyle('hydro-presentation');
    }
    renderAll();
    queuePresentationAutosave();
    return true;
  }

  function createLayerInlineStylePanel(group) {
    const panel = document.querySelector(`[data-layer-style-panel="${group}"]`);
    const target = LAYER_STYLE_TARGETS[group];
    if (!panel || panel.dataset.initialized === 'true') return panel;
    panel.dataset.initialized = 'true';
    if (!target) return panel;
    if (target.opacity) {
      const field = document.createElement('label');
      field.className = 'ui-field field-group layer-inline-style-field';
      const title = document.createElement('span');
      title.textContent = target.opacityLabel || '투명도';
      const output = document.createElement('output');
      output.dataset.layerStyleOpacityValue = group;
      title.append(' ', output);
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0'; input.max = '100'; input.value = '100';
      input.dataset.layerStyleOpacity = group;
      input.setAttribute('aria-label', `${target.label} ${target.opacityLabel || '투명도'}`);
      field.append(title, input);
      panel.append(field);
    }
    if (target.blendMode) {
      const field = document.createElement('label');
      field.className = 'ui-field field-group layer-inline-style-field';
      const title = document.createElement('span');
      title.textContent = '겹침 방식';
      const select = document.createElement('select');
      select.dataset.layerStyleBlendMode = group;
      select.setAttribute('aria-label', `${target.label} 겹침 방식`);
      select.innerHTML = '<option value="normal">일반</option><option value="multiply">곱하기</option>';
      field.append(title, select);
      panel.append(field);
    }
    if (target.boundary) {
      const choice = document.createElement('label');
      choice.className = 'ui-choice-row';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.layerStyleBoundary = group;
      checkbox.setAttribute('aria-label', `${target.label} ${target.boundaryLabel || '경계 표시'}`);
      const text = document.createElement('span');
      text.textContent = target.boundaryLabel || '경계 표시';
      choice.append(checkbox, text);
      panel.append(choice);
    }
    return panel;
  }

  function syncLayerStylePanels() {
    state.layerPresentation = normalizeLayerPresentation(state.layerPresentation);
    document.querySelectorAll('[data-layer-style-panel]').forEach(panel => {
      const group = panel.dataset.layerStylePanel;
      createLayerInlineStylePanel(group);
      const expanded = expandedLayerStyleGroups.has(group);
      panel.hidden = !expanded;
      const toggle = document.querySelector(`[data-layer-style-toggle="${group}"]`);
      toggle?.setAttribute('aria-expanded', String(expanded));
      toggle?.classList.toggle('active', expanded);
      const target = LAYER_STYLE_TARGETS[group];
      if (!target) return;
      const style = layerStyle(state.layerPresentation, target.presentationGroup);
      const input = panel.querySelector('[data-layer-style-opacity]');
      if (input) { input.value = String(Math.round(style.opacity * 100)); syncRangeProgress(input); }
      const output = panel.querySelector('[data-layer-style-opacity-value]');
      if (output) output.textContent = `${Math.round(style.opacity * 100)}%`;
      const boundary = panel.querySelector('[data-layer-style-boundary]');
      if (boundary) boundary.checked = style.boundaryVisible;
      const blendMode = panel.querySelector('[data-layer-style-blend-mode]');
      if (blendMode) blendMode.value = style.blendMode;
    });
  }

  function toggleLayerStylePanel(group) {
    const panel = createLayerInlineStylePanel(group);
    const toggle = document.querySelector(`[data-layer-style-toggle="${group}"]`);
    if (!panel || !toggle) return;
    const open = !expandedLayerStyleGroups.has(group);
    if (open) expandedLayerStyleGroups.add(group); else expandedLayerStyleGroups.delete(group);
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.classList.toggle('active', open);
    syncLayerStylePanels();
  }

  function renderLayerPresentationList() {
    state.layerPresentation = normalizeLayerPresentation(state.layerPresentation);
    syncLayerStylePanels();
    syncDistributionPresentationControls();
    syncPhysicalControls();
  }

  function syncDistributionPresentationControls() {
    const mode = state.distributionSettings?.renderMode || DISTRIBUTION_RENDER_MODES.DOMINANT;
    for (const id of ['distributionLayerModeInput', 'distributionRenderModeInput']) {
      const input = $(id);
      if (input) input.value = mode;
    }
    const boundary = $('distributionBoundaryVisibleInput');
    if (boundary) boundary.checked = state.distributionSettings?.boundaryVisible !== false;
    const hint = $('distributionLayerModeHint');
    if (!hint) return;
    hint.textContent = mode === DISTRIBUTION_RENDER_MODES.INTENSITY
      ? '선택한 분포를 비율이 높을수록 진하게 표시합니다.'
      : '각 영역에서 비율이 가장 높은 분포만 표시합니다.';
  }


  function setMapPanelView(view, { focus = false } = {}) {
    mapPanelView = view === 'view' ? 'view' : 'layers';
    const showingView = mapPanelView === 'view';
    $('layerSection')?.classList.toggle('hidden', showingView);
    $('mapViewSection')?.classList.toggle('hidden', !showingView);
    $('mapLayersTabBtn')?.classList.toggle('active', !showingView);
    $('mapViewTabBtn')?.classList.toggle('active', showingView);
    $('mapLayersTabBtn')?.setAttribute('aria-selected', String(!showingView));
    $('mapViewTabBtn')?.setAttribute('aria-selected', String(showingView));
    if ($('mapLayersTabBtn')) $('mapLayersTabBtn').tabIndex = showingView ? -1 : 0;
    if ($('mapViewTabBtn')) $('mapViewTabBtn').tabIndex = showingView ? 0 : -1;
    if (showingView) renderLayerPresentationList();
    if (focus) requestAnimationFrame(() => $(showingView ? 'mapViewTabBtn' : 'mapLayersTabBtn')?.focus());
  }

  const projectSerializer = createProjectSerializer({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    baseDataset: BASE_DATASET,
    drawingSchemaVersion: DRAWING_SCHEMA_VERSION,
    distributionSchemaVersion: DISTRIBUTION_SCHEMA_VERSION,
    distributionTypes: Object.values(DISTRIBUTION_TYPES),
    distributionModes: Object.values(DISTRIBUTION_MODES),
    terrainDataset: TERRAIN_DATASET,
    hydroDataset: HYDRO_DATASET,
    readSnapshot: () => ({
      countriesData: state.countriesData,
      projectFields: pickProjectFields(state, { clone: value => value }),
      countryDelta: buildCountryDelta(),
      fullAutosave: !!state.sessionBaseCountriesJson,
      terrainManifest: state.terrainManifest,
      hydroManifest: state.hydroManifest,
    }),
  });

  function buildAtlasState() {
    return projectSerializer.buildProject();
  }

  function buildAutosaveData() {
    return projectSerializer.buildAutosave();
  }

  function countriesFromAutosaveDelta(project, suppliedBase = null) {
    return restoreCountriesFromDelta(project, {
      base: suppliedBase || parsePristineCountries(),
      clone: deepClone,
      reindex: base => reindexCountries(base, true),
      applyPristineLabelAnchors,
    });
  }

  async function deleteAutosavedProject() {
    return persistenceService.clear();
  }

  function queueViewAutosave(delay = 120) {
    persistenceService.queueView(delay);
  }

  async function persistAutosave(project = null) {
    return persistenceService.persist(project);
  }

  function queueAutosave(delay = 650, { scope = 'document' } = {}) {
    persistenceService.queueProject(delay, { scope });
  }

  function queuePresentationAutosave(delay = 650) {
    persistenceService.queuePresentation(delay);
  }

  async function restoreAutosavedProject() {
    return persistenceService.restore();
  }

  function applyAutosavedView(viewRecord) {
    if (!viewRecord || typeof viewRecord !== 'object') return false;
    if (viewRecord.projection === 'globe' || viewRecord.projection === 'flat') state.projection = viewRecord.projection;
    if (viewRecord.view && typeof viewRecord.view === 'object') {
      state.view = clampViewZooms({ ...state.view, ...deepClone(viewRecord.view) });
    }
    return true;
  }

  const browserProjectStorage = createBrowserProjectStorage({
    indexedDB: window.indexedDB,
    localStorage: window.localStorage,
    databaseName: AUTOSAVE_DB_NAME,
    storeName: AUTOSAVE_STORE_NAME,
    projectKey: AUTOSAVE_RECORD_KEY,
    viewKey: AUTOSAVE_VIEW_KEY,
    fallbackKey: STORAGE_KEY,
  });
  const persistenceService = createPersistenceService({
    storage: browserProjectStorage,
    scheduler: mapWorkScheduler,
    canPersist: () => canMutateProject(state.dataReadiness),
    buildAutosave: buildAutosaveData,
    readView: () => ({ projection: state.projection, view: deepClone(state.view) }),
    validateProject: assertCurrentProjectSchema,
    onDirty: scope => {
      if (scope === 'presentation') saveState.markPresentationChanged();
      else saveState.markDocumentChanged();
    },
    onAutosaveState: (value, options) => saveState.setAutosave(value, options),
    onSaved: savedAt => {
      state.lastSavedAt = savedAt;
    },
    onFailure: () => setActionStatus('자동저장 실패. 파일로 저장하세요.', 'error', 0),
    onWarning: (...args) => console.warn(...args),
  });

  function applyAtlasState(project, manual = false) {
    assertCurrentProjectSchema(project);
    if (project.countriesData?.features) {
      assertProjectReferenceIntegrity({
        countries: project.countriesData.features,
        countryOverrides: project.countryOverrides || {},
        territorialUnits: project.territorialUnits || [],
        territorialRelations: project.territorialRelations || [],
        distributionLayers: project.distributionLayers || [],
        distributionEntries: project.distributionEntries || [],
        labels: project.labels || [],
        drawings: project.drawings || [],
        itemVisibility: project.itemVisibility || {},
        labelSettings: project.labelSettings || {},
      });
    }
    resetCountryLabelAnchorRuntime();
    gpuMapRenderer.resetCountryGeometryVisualState();
    applySharedProjectFields(project);
    gpuMapRenderer.invalidateHydroVisibility();
    state.layerSearch = '';
    state.countriesData = project.countriesData
      ? reindexCountries(deepClone(project.countriesData), true)
      : freshPristineCountries(true);
    normalizeProjectObjects();
    pruneLayerItemVisibility();
    scheduleCountryLabelAnchors(null, 10);
    markLayerTreeDirty();
    configureDatasetSession(project);
    const externalGeometry = !!project.countriesData && project.baseDataset !== BASE_DATASET;
    historyService.reset();
    state.selected = null;
    objectSelectionSyncing = true;
    objectSelection.clear();
    objectSelectionSyncing = false;
    state.draftCoords = [];
    state.draftHover = null;

    syncProjectionButtons();
    $('countriesVisible').checked = state.layerVisibility.countries;
    $('territoriesVisible').checked = state.layerVisibility.territories !== false;
    $('administrativeVisible').checked = state.layerVisibility.administrative !== false;
    $('regionsVisible').checked = state.layerVisibility.regions !== false;
    $('languagesVisible').checked = state.layerVisibility.languages !== false;
    $('ethnicitiesVisible').checked = state.layerVisibility.ethnicities !== false;
    $('religionsVisible').checked = state.layerVisibility.religions !== false;
    $('riversVisible').checked = state.layerVisibility.rivers !== false;
    $('lakesVisible').checked = state.layerVisibility.lakes !== false;
    $('drawingsVisible').checked = state.layerVisibility.drawings;
    $('labelsVisible').checked = state.layerVisibility.labels;
    $('basemapLabelsVisible').checked = state.layerVisibility.basemapLabels;
    syncPhysicalControls();
    if ($('layerSearchInput')) $('layerSearchInput').value = state.layerSearch;
    renderLayerTree(true);
    showPropertyForm(null);
    $('selectionStatus').textContent = '';
    state.boundaryTopology = { edges: new Map(), nodes: new Map() };
    scheduleGpuMeshRebuild(0);
    renderAll();
    updateHistoryButtons();
    setTool('select');
    queueAutosave();
    if (manual) saveState.markOpenedFile(`content:${Date.now()}`);
    if (manual) setActionStatus(externalGeometry
      ? '외부 GIS 형상을 저장 당시 상태로 불러왔습니다.'
      : '프로젝트를 불러왔습니다.', 'success', 3200);
  }

  const confirmModalController = createConfirmModalController({
    document,
    window,
    elements: {
      modal: $('confirmModal'),
      backdrop: $('confirmModal')?.querySelector('.confirm-modal-dim'),
      title: $('confirmModalTitle'),
      message: $('confirmModalMessage'),
      impactSection: $('confirmModalImpactSection'),
      impactList: $('confirmModalImpactList'),
      ok: $('confirmModalOkBtn'),
      cancel: $('confirmModalCancelBtn'),
      choiceRow: $('confirmModalChoiceRow'),
      choice: $('confirmModalChoice'),
    },
    setChoices: replaceSelectOptions,
    beforeOpen: clearNotification,
  });
  const openConfirmModal = options => confirmModalController.open(options);
  const closeConfirmModal = () => confirmModalController.close();

  const coastReconciliationController = createCoastReconciliationController({
    document,
    window,
    elements: {
      modal: $('coastReconciliationModal'),
      backdrop: $('coastReconciliationModal')?.querySelector('.confirm-modal-dim'),
      title: $('coastReconciliationTitle'),
      message: $('coastReconciliationMessage'),
      impact: $('coastReconciliationImpact'),
      impactList: $('coastReconciliationImpactList'),
      country: $('coastReconciliationCountryBtn'),
      subject: $('coastReconciliationAdminBtn'),
      independent: $('coastReconciliationIndependentBtn'),
      cancel: $('coastReconciliationCancelBtn'),
    },
  });

  function analyzeAdminCountryCoastConflicts(adminId) {
    const admin = territorialUnitById(adminId);
    const countryId = String(admin?.properties?.sovereignId || '');
    const country = countryFeatureById(countryId);
    if (!admin || admin.properties?.unitType !== TERRITORIAL_UNIT_TYPES.ADMIN || !country) return { admin, country, status: 'unavailable', conflicts: [] };
    const topology = buildSharedBoundaryTopology(state.countriesData?.features || []);
    const result = analyzeAdminCountryCoast({ adminFeature: admin, countryFeature: country, countryTopology: topology });
    return { admin, country, status: result.status, unavailableReason: result.unavailableReason, conflicts: result.conflicts || [] };
  }

  async function reconcileAdminCountryCoast(adminId, { manual = true } = {}) {
    const analysis = analyzeAdminCountryCoastConflicts(adminId);
    if (!analysis.admin || !analysis.country) {
      setActionStatus('소속 국가를 찾을 수 없어 해안선을 비교할 수 없습니다.', 'error', 3600);
      return { ok: false, code: 'missing-country' };
    }
    if (analysis.status === 'unavailable') {
      setActionStatus('국가 해안선을 신뢰할 수 있게 판별하지 못해 자동 정합할 수 없습니다.', 'error', 4200);
      return { ok: false, code: analysis.unavailableReason || 'coast-unavailable' };
    }
    if (!analysis.conflicts.length) {
      if (manual) setActionStatus('국가 해안선과 일치하는 불일치 구간이 없습니다.', 'success', 3000);
      return { ok: true, changed: false };
    }
    const decision = await coastReconciliationController.open({
      subjectName: territorialUnitName(analysis.admin),
      subjectActionLabel: '행정구역',
      countryName: countryName(analysis.country),
      conflicts: analysis.conflicts,
    });
    if (decision.direction === 'cancel') return { ok: false, cancelled: true };
    if (decision.direction === 'independent') {
      setActionStatus('두 해안선을 자동으로 맞추지 않고 현재 상태를 유지했습니다.', 'success', 3200);
      return { ok: true, changed: false, independent: true };
    }

    const snapshot = snapshotEditable();
    const countryId = String(analysis.country.properties?.editor_id || '');
    const adminIdKey = String(analysis.admin.id);
    const countryBefore = deepClone(analysis.country.geometry);
    const adminBefore = deepClone(analysis.admin.geometry);
    try {
      const planned = planCoastReconciliations({ conflicts: analysis.conflicts, direction: decision.direction });
      const nextCountry = planned.countryGeometry;
      const nextAdmin = planned.adminGeometry;
      const countryValidation = validateCoastReplacement(nextCountry, { clipper: window.polygonClipping });
      const adminValidation = validateCoastReplacement(nextAdmin, { clipper: window.polygonClipping });
      if (!countryValidation.ok || !adminValidation.ok) throw new Error('정합 결과 geometry가 올바르지 않습니다.');
      recordHistory({
        type: 'coast-reconciliation',
        description: `${territorialUnitName(analysis.admin)}·${countryName(analysis.country)} 해안선 정합`,
        affectedIds: [adminIdKey, countryId],
      });
      if (decision.direction === 'admin-to-country') {
        analysis.country.geometry = nextCountry;
        state.historyDirtyCountryIds.add(countryId);
        reconcileTerritorialUnitCompleteness([countryId], { preserveIds: [adminIdKey] });
      } else {
        analysis.admin.geometry = nextAdmin;
        reconcileTerritorialUnitCompleteness([countryId]);
      }
      normalizeProjectObjects();
      assertCurrentProjectReferences();
      markLayerTreeDirty();
      renderAll();
      queueAutosave();
      setActionStatus(decision.direction === 'admin-to-country' ? '행정구역 해안선을 기준으로 국가 해안선을 조정했습니다.' : '국가 해안선을 기준으로 행정구역 해안선을 조정했습니다.', 'success', 4200);
      return { ok: true, changed: true, direction: decision.direction };
    } catch (error) {
      analysis.country.geometry = countryBefore;
      analysis.admin.geometry = adminBefore;
      restoreEditable(snapshot);
      reportOperationError(error, '해안선 정합을 적용하지 못했습니다.', 'PL-COAST-RECONCILE-001', 4400);
      return { ok: false, error };
    }
  }

  async function resetProjectInPlace() {
    closeConfirmModal();
    closeMobileSheets();
    gpuMapRenderer.resetCountryGeometryVisualState();

    // 자동저장 타이머가 직전 편집 geometry를 다시 저장하는 것을 먼저 차단한다.
    await deleteAutosavedProject();
    resetCountryLabelAnchorRuntime();

    state.countryOverrides = {};
    state.sourceInfo = null;
    state.labels = [];
    state.labelSettings = {};
    state.drawings = [];
    state.hydroEdits = [];
    state.territorialUnits = [];
    state.territorialRelations = [];
    state.distributionLayers = [];
    state.distributionEntries = [];
    state.distributionSettings = { renderMode: DISTRIBUTION_RENDER_MODES.DOMINANT, boundaryVisible: true };
    state.selectedDistributionLayerId = '';
    state.distributionDraft = null;
    clearGeometryPreview(state.geometryPreview);
    state.activeSnap = null;
    state.audit = { status: 'idle', revision: state.audit.revision + 1, report: null, selectedIssueId: null };
    state.hovered = null;
    state.physicalSettings = normalizePhysicalSettings(null);
    state.projection = 'globe';
    state.layerVisibility = normalizeLayerVisibility();
    state.itemVisibility = normalizeLayerItemState(null);
    state.layerPresentation = normalizeLayerPresentation();
    gpuMapRenderer.invalidateHydroVisibility();
    state.layerFolders = normalizeLayerFolderState(null);
    state.layerSearch = '';
    state.tool = 'select';
    state.labelPlacementMode = false;
    state.coastEditCountryId = null;
    state.coastEditScopeDrawingId = null;
    state.coastEditReturnSelection = null;
    resetBoundaryEditState();
    state.drawingMergeSourceId = null;
    state.drawingMergeTargetIds = [];
    state.drawingSplitSourceId = null;
    resetTerritorialUnitEditState();
    resetMergeState();
    resetTerritoryEditingState(true);
    historyService.reset();
    state.selected = null;
    objectSelectionSyncing = true;
    objectSelection.clear();
    objectSelectionSyncing = false;
    state.view = { globeRotation: [-15, -25, 0], globeZoom: 1, flatCenter: [0, 20], flatZoom: 1 };

    // 핵심: 현재 state나 window 객체가 아니라 앱 시작 때 고정해 둔 불변 원본 스냅샷에서 다시 생성한다.
    // false = 이전 국가명/색상 override까지 적용하지 않고 최초 데이터 그대로 복원.
    state.countryIndex.clear();
    state.countriesData = freshPristineCountries(false);
    pruneLayerItemVisibility();
    markLayerTreeDirty();
    configureDatasetSession(null);
    scheduleGpuMeshRebuild(0);
    const restoredGeometrySignature = JSON.stringify(
      state.countriesData.features.map(f => [String(f.properties?.editor_id || f.properties?.iso_a3 || ''), f.geometry])
    );
    const pristineGeometrySignature = JSON.stringify(
      (parsePristineCountries().features || []).map(f => [String(f.properties?.editor_id || f.properties?.iso_a3 || ''), f.geometry])
    );
    if (restoredGeometrySignature !== pristineGeometrySignature) {
      throw new Error('내장 원본 국경 복원 검증에 실패했습니다.');
    }
    refreshCountryCentroids();
    state.boundaryTopology = { edges: new Map(), nodes: new Map() };

    $('countriesVisible').checked = true;
    $('territoriesVisible').checked = true;
    $('administrativeVisible').checked = true;
    $('regionsVisible').checked = true;
    $('languagesVisible').checked = true;
    $('ethnicitiesVisible').checked = true;
    $('religionsVisible').checked = true;
    $('riversVisible').checked = true;
    $('lakesVisible').checked = true;
    $('drawingsVisible').checked = true;
    $('labelsVisible').checked = true;
    $('basemapLabelsVisible').checked = true;
    syncPhysicalControls();
    if ($('layerSearchInput')) $('layerSearchInput').value = '';
    renderLayerTree(true);
    syncProjectionButtons();
    showPropertyForm(null);
    $('selectionStatus').textContent = '';
    setTool('select', false);

    // 기존 SVG 노드는 편집된 Feature 객체를 __data__로 들고 있을 수 있으므로 완전히 제거 후 원본으로 재바인딩한다.
    countryLayer?.selectAll('*').remove();
    countryLabelLayer?.selectAll('*').remove();
    boundaryEditLayer?.selectAll('*').remove();
    territorialUnitLayer?.selectAll('*').remove();
    distributionLayer?.selectAll('*').remove();
    vertexLayer?.selectAll('*').remove();
    drawingLayer?.selectAll('*').remove();
    labelLayer?.selectAll('*').remove();

    resizeMap();
    renderAll();
    updateHistoryButtons();
    // 복원된 최초 geometry를 새 자동저장 기준으로 기록한다.
    queueAutosave();
    saveState.markNewProject('content:0');
    setActionStatus('새 프로젝트를 만들었습니다.', 'success', 3200);
  }

  function requestNewProject(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();

    closeFileMenu();
    const hasUnsavedChanges = saveState.snapshot().hasUnsavedChanges;
    openConfirmModal({
      title: '새 프로젝트',
      message: hasUnsavedChanges
        ? '파일에 저장되지 않은 변경 사항이 있습니다. 현재 편집 내용, 실행취소 기록과 자동저장을 모두 지우고\n내장된 최초 세계 국경으로 돌아갑니다.'
        : '현재 편집 내용, 실행취소 기록과 자동저장을 모두 지우고\n내장된 최초 세계 국경으로 돌아갑니다.',
      impacts: hasUnsavedChanges ? ['파일에 저장되지 않은 변경 사항 삭제', '현재 실행취소 기록 초기화', '내장된 최초 세계 국경 복원'] : ['현재 실행취소 기록 초기화', '내장된 최초 세계 국경 복원'],
      confirmText: '초기 상태로 시작',
      danger: true,
      onConfirm: () => resetProjectInPlace(),
    });
  }

  function requestDeleteCountry(id) {
    const key = String(id);
    if (!requireCountriesUnlocked([key], '삭제')) return;
    const feature = countryFeatureById(key);
    if (!feature) return;
    const children = territorialRepository.children(key);
    if (children.length) {
      setActionStatus(`하위 영역 ${children.length}개를 먼저 옮기거나 삭제하세요.`, 'error', 4400);
      return;
    }
    const name = countryName(feature);
    openConfirmModal({
      title: '국가 삭제',
      message: `${name} 국가 객체를 지도에서 삭제합니다. 실행취소로 복구할 수 있습니다.`,
      impacts: ['국가 1개 삭제', '국가명 제거', '하위 영역 없음'],
      confirmText: '국가 삭제',
      danger: true,
      onConfirm: () => {
        recordHistory();
        for (const unit of state.territorialUnits) {
          if (String(unit.properties?.sovereignId || '') !== key) continue;
          unit.properties.sovereignId = '';
          unit.properties.parentId = '';
          unit.properties.isRemainder = false;
        }
        state.countriesData.features = state.countriesData.features.filter(f => String(f.properties?.editor_id) !== key);
        delete state.countryOverrides[key];
        reindexCountries(state.countriesData, true);
        markCountryGeometriesChanged([key]);
        state.boundaryTopology = { edges: new Map(), nodes: new Map() };
        if ((state.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY) && String(state.selected.id) === key) clearSelection(false);
        else {
          markLayerTreeDirty();
          renderAll();
        }
        queueAutosave();
        setActionStatus(`${name} 국가를 삭제했습니다.`, 'success');
      },
    });
  }

  function deleteSelectedCountry() {
    if (!requireCanonicalData()) return;
    if (!(state.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY)) return;
    requestDeleteCountry(state.selected.id);
  }

  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function saveGeoPackageFile() {
    if (!requireCanonicalData()) return;
    if (!window.PandoLabGIS?.exportGeoPackage) throw new Error('GeoPackage 저장 모듈을 불러오지 못했습니다.');
    const button = $('saveProjectBtn');
    if (button) button.disabled = true;
    saveState.markFileSaving();
    setActionStatus('프로젝트 저장 준비 중…', 'working', 0);
    try {
      const blob = await window.PandoLabGIS.exportGeoPackage(buildAtlasState(), (_message, percent) => {
        setActionStatus(`프로젝트 저장 중${Number.isFinite(percent) ? ` · ${Math.round(percent)}%` : ''}`, 'working', 0);
      });
      const filename = '판도연구소-프로젝트.gpkg';
      if (typeof window.showSaveFilePicker === 'function') {
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: 'GeoPackage', accept: { 'application/geopackage+sqlite3': ['.gpkg'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        saveState.markFileSaved();
        setActionStatus('프로젝트 파일을 저장했습니다.', 'success', 3200);
      } else {
        downloadBlob(filename, blob);
        saveState.markFileSaved({ downloaded: true });
        setActionStatus('프로젝트 다운로드를 만들었습니다.', 'success', 3600);
      }
    } catch (error) {
      if (error?.name === 'AbortError') {
        const snapshot = saveState.snapshot();
        saveState.setContentToken(snapshot.currentContentToken, { markDirty: true });
        setActionStatus('파일 저장을 취소했습니다.', 'ready', 2200);
        return;
      }
      saveState.markFileError();
      console.error('[PL-GPKG-001]', error);
      setActionStatus('프로젝트 저장에 실패했습니다.', 'error', 0);
    } finally {
      if (button) button.disabled = false;
    }
  }

  function geometryAreaKm2(geometry) {
    if (!geometry) return 0;
    try { return Math.max(0, d3.geo.area(geometry) * 6371.0088 * 6371.0088); }
    catch (_) { return 0; }
  }

  function gisImportCountryOptions() {
    return (state.countriesData?.features || []).map(feature => ({
      id: String(feature.properties?.editor_id || feature.id || ''),
      name: countryName(feature),
    })).filter(country => country.id).sort((left, right) => layerNameCollator.compare(left.name, right.name));
  }

  function gisImportParentOptions() {
    return (state.territorialUnits || []).filter(feature => [TERRITORIAL_UNIT_TYPES.TERRITORY, TERRITORIAL_UNIT_TYPES.ADMIN].includes(feature.properties?.unitType)).map(feature => ({
      id: String(feature.id),
      name: territorialUnitName(feature),
      countryId: String(feature.properties?.sovereignId || ''),
      type: feature.properties?.unitType,
      level: Number(feature.properties?.adminLevel) || 1,
    })).filter(unit => unit.id && unit.countryId).sort((left, right) => layerNameCollator.compare(left.name, right.name));
  }

  function planTerritorialImportImpact(collection, mapping) {
    return buildTerritorialImportTransactionPlan({
      features: collection?.features || [],
      countries: state.countriesData?.features || [],
      targetCountryId: mapping.targetCountryId,
      useFeatureCountryField: mapping.useFeatureCountryField,
      countryField: mapping.countryField,
      clipper: window.polygonClipping,
      areaKm2: geometryAreaKm2,
    });
  }

  function planCountryImportIdentity(collection, _mapping, manualMappings = {}) {
    const resolutions = resolveCountryIdentities(
      collection?.features || [],
      state.countriesData?.features || [],
      { manualMappings },
    );
    return {
      summary: identityResolutionSummary(resolutions),
      rows: resolutions.map(row => ({
        status: row.status,
        editorId: row.editorId,
        name: row.name,
        sourceKey: row.sourceKey,
        sourceId: row.sourceIdentity.sourceId,
        sourceIdField: row.sourceIdentity.sourceIdField,
        sourceNamespace: row.sourceIdentity.sourceNamespace,
        candidates: (row.candidates || []).map(candidate => ({
          editorId: candidate.editorId,
          reason: candidate.reason,
          confidence: candidate.confidence,
        })),
        resolutionReason: row.resolutionReason,
      })),
    };
  }

  function materializeCountryImport(collection, { manualMappings = {}, allowImplicitNew = false } = {}) {
    const resolutions = resolveCountryIdentities(
      collection?.features || [],
      allowImplicitNew ? [] : (state.countriesData?.features || []),
      { manualMappings, allowImplicitNew },
    );
    return {
      type: 'FeatureCollection',
      features: materializeResolvedCountries(resolutions, { createId: createProjectObjectId }),
    };
  }

  const gisGeometryValidator = createGisGeometryValidator({
    createWorker: () => new Worker(runtimeAssetUrl('workers/gis-geometry-worker.js'), { name: 'pandolab-gis-geometry' }),
  });
  const validateGisCountryCollection = (collection, affectedIds = null) => gisGeometryValidator.validate(collection, affectedIds);
  const planGisMerge = createCountryImportMergePlanner({
    clipper: window.polygonClipping,
    clone: deepClone,
    featureCountryId,
    countryName,
    geometryBounds,
    boundsOverlap,
    normalizeGeometry: normalizeClippedLandGeometry,
    geometryCoordinates: geometryMultiCoordinates,
    planarArea: multiPolygonPlanarArea,
    areaKm2: geometryAreaKm2,
    validateCountryCollection: validateGisCountryCollection,
  });

  function applyImportedReplacement(result) {
    const packageState = result.atlasMetadata?.projectState || {};
    const restoredOverrides = {
      ...importedCountryOverrides(result.countriesData),
      ...(packageState.countryOverrides || {}),
    };
    const mergedState = {
      ...packageState,
      countriesData: result.countriesData,
      countryOverrides: applyImportedPackageAssets(result.atlasMetadata, restoredOverrides),
      sourceInfo: result.atlasMetadata?.sourceInfo || result.sourceInfo,
    };
    applyAtlasState(mergedState, true);
    setActionStatus(`국가 경계 ${state.countriesData.features.length}개를 새 프로젝트로 열었습니다.`, 'success', 3200);
  }

  async function commitGisMerge(result, plan) {
    const importedIds = new Set((result.countriesData?.features || []).map(feature => String(feature.properties?.editor_id || '')));
    const packagedOverrides = applyImportedPackageAssets(result.atlasMetadata, {
      ...importedCountryOverrides(result.countriesData),
      ...(result.atlasMetadata?.projectState?.countryOverrides || {}),
    });
    const draftCountries = deepClone(plan.countriesData);
    const draftCountryIds = new Set((draftCountries.features || []).map(feature => String(feature.properties?.editor_id || '')).filter(Boolean));
    const draftOverrides = Object.fromEntries(Object.entries(deepClone(state.countryOverrides || {}))
      .filter(([id]) => draftCountryIds.has(String(id))));
    for (const feature of result.countriesData?.features || []) {
      const id = String(feature.properties?.editor_id || '');
      if (!id) continue;
      const existingOverride = draftOverrides[id] || {};
      const next = { ...(packagedOverrides[id] || {}), ...existingOverride };
      if (!Object.prototype.hasOwnProperty.call(existingOverride, 'name') && feature.properties?.editor_name) next.name = feature.properties.editor_name;
      if (!Object.prototype.hasOwnProperty.call(existingOverride, 'color') && feature.properties?.editor_color) next.color = feature.properties.editor_color;
      draftOverrides[id] = next;
    }
    for (const [countryId, update] of Object.entries(result.countryUpdates || {})) {
      const id = String(countryId || '');
      if (!id || !draftCountryIds.has(id) || !update || typeof update !== 'object') continue;
      const next = { ...(draftOverrides[id] || {}) };
      if (String(update.name || '').trim()) next.name = String(update.name).trim();
      draftOverrides[id] = next;
    }
    const validation = await validateGisCountryCollection(draftCountries, plan.affectedIds || importedIds);
    if (Number(validation?.overlapAreaKm2 || 0) > 0.001) {
      throw createGisImportError('가져온 국가가 다른 국가와 실제로 겹칩니다.', {
        category: RELIABILITY_ERROR_CATEGORIES.GEOMETRY,
        objectIds: validation?.firstOverlap || [...importedIds],
        technicalMessage: `Residual overlap: ${validation.overlapAreaKm2} km2`,
      });
    }
    assertProjectReferenceIntegrity({
      countries: draftCountries.features || [],
      countryOverrides: draftOverrides,
      territorialUnits: state.territorialUnits || [],
      territorialRelations: state.territorialRelations || [],
      distributionLayers: state.distributionLayers || [],
      distributionEntries: state.distributionEntries || [],
      labels: state.labels || [],
      drawings: state.drawings || [],
      itemVisibility: state.itemVisibility || {},
      labelSettings: state.labelSettings || {},
    });

    const before = snapshotEditable();
    state.sourceInfo = appendImportedSourceInfo(state.sourceInfo, result.sourceInfo);
    state.countryOverrides = draftOverrides;
    state.countriesData = reindexCountries(draftCountries, true);
    pruneLayerItemVisibility();
    scheduleCountryLabelAnchors(null, 10);
    markCountryGeometriesChanged(plan.affectedIds || importedIds);
    commitHistorySnapshot(before);
    clearSelection(false);
    renderAll();
    queueAutosave();
    setActionStatus(result.commitStatus || 'GIS 레이어를 한 번의 편집 작업으로 병합했습니다.', 'success', 3200);
    return {
      added: Number(plan.counts?.added || 0),
      subtracted: Number(plan.counts?.subtracted || 0),
      deleted: Number(plan.counts?.deleted || 0),
      affectedIds: [...new Set(plan.affectedIds || [])],
    };
  }

  let requestedVectorTarget = '';

  const importService = createImportService({
    openImportWizard: (files, options) => {
      if (!window.PandoLabGIS?.openImportWizard) throw new Error('GIS 가져오기 모듈을 불러오지 못했습니다.');
      return window.PandoLabGIS.openImportWizard(files, options);
    },
    getWizardOptions: () => ({
      countryOptions: gisImportCountryOptions(),
      parentOptions: gisImportParentOptions(),
      hasUnsavedChanges: saveState.snapshot().hasUnsavedChanges,
      planImpact: planTerritorialImportImpact,
      planCountryIdentity: planCountryImportIdentity,
    }),
    validateStructuredGeometry,
    featureCountryId,
    validateCountryCollection: validateGisCountryCollection,
    getCurrentCountries: () => state.countriesData,
    materializeCountryImport,
    planCountryMerge: planGisMerge,
    materializers: {
      replaceProject: applyImportedReplacement,
      territorial: commitTerritorialImportWithTransfer,
      geoJson: importGeoJson,
      mergeCountries: commitGisMerge,
    },
    onStage: message => setActionStatus(message, 'working', 0),
  });

  function captureGisImportSnapshot() {
    return {
      projectFields: pickProjectFields(state, { scope: 'project', clone: deepClone }),
      sessionFields: pickProjectFields(state, { scope: 'session', clone: deepClone }),
      countries: {
        countryDelta: buildCountryDelta(),
        historyDirtyCountryIds: [...state.historyDirtyCountryIds],
      },
      history: deepClone(state.history),
      historyMeta: deepClone(state.historyMeta),
      future: deepClone(state.future),
      futureMeta: deepClone(state.futureMeta),
      selection: deepClone(objectSelection.snapshot()),
      saveState: saveState.checkpoint(),
    };
  }

  function restoreGisImportSnapshot(snapshot) {
    if (!snapshot) throw new Error('GIS 가져오기 복구 snapshot이 없습니다.');
    const changedCountryIds = new Set((state.countriesData?.features || []).map(feature => String(feature.properties?.editor_id || '')).filter(Boolean));
    applySharedProjectFields(snapshot.projectFields, 'project');
    applySharedProjectFields(snapshot.sessionFields, 'session');
    restoreCountriesFromSnapshot(snapshot.countries);
    for (const feature of state.countriesData?.features || []) changedCountryIds.add(String(feature.properties?.editor_id || ''));
    state.history = deepClone(snapshot.history || []);
    state.historyMeta = deepClone(snapshot.historyMeta || []);
    state.future = deepClone(snapshot.future || []);
    state.futureMeta = deepClone(snapshot.futureMeta || []);
    normalizeProjectObjects();
    gpuMapRenderer.invalidateHydroVisibility();
    syncPhysicalControls();
    pruneLayerItemVisibility();
    scheduleCountryLabelAnchors(null, 10);
    markLayerTreeDirty();
    markCountryGeometriesChanged(changedCountryIds);
    mapEditClient.rebase(state.countriesData?.features || []);
    rebuildBoundaryTopology();
    saveState.restore(snapshot.saveState);
    updateHistoryButtons();
    restoreObjectSelectionSnapshot(snapshot.selection);
    renderAll();
  }

  async function openGisFiles(files) {
    if (!files?.length) return;
    const requestedTarget = requestedVectorTarget;
    requestedVectorTarget = '';
    const importSnapshot = captureGisImportSnapshot();
    setActionStatus('파일 확인 중…', 'working', 0);
    try {
      await importService.openFiles(files, { targetType: requestedTarget });
    } catch (error) {
      let rollback = 'restored';
      try {
        restoreGisImportSnapshot(importSnapshot);
      } catch (restoreError) {
        rollback = 'failed';
        console.error('[PL-GIS-ROLLBACK-001]', restoreError);
        reliabilityDiagnostic.push({
          category: 'transaction',
          operation: 'gis-import-rollback',
          result: 'failed',
          errorCode: 'PL-GIS-ROLLBACK-001',
          technicalMessage: restoreError?.message || String(restoreError),
          stack: restoreError?.stack || '',
          rollback,
        });
      }
      if (isAbortError(error)) {
        reliabilityDiagnostic.push({
          category: 'gis',
          operation: 'gis-import',
          result: 'cancelled',
          rollback,
        });
        if (rollback === 'failed') {
          setActionStatus('파일 불러오기를 취소했지만 이전 상태를 복구하지 못했습니다. · PL-GIS-ROLLBACK-001', 'error', 0);
          return;
        }
        setActionStatus('파일 불러오기를 취소했습니다.', 'ready');
        return;
      }
      reportGisImportError(error, { rollback });
    }
  }

  const LIBRARY_TYPE_LABELS = Object.freeze({
    [LIBRARY_ENTITY_TYPES.COUNTRY]: '국가',
    [LIBRARY_ENTITY_TYPES.TERRITORY]: '권역',
    [LIBRARY_ENTITY_TYPES.ADMIN]: '행정구역',
    [LIBRARY_ENTITY_TYPES.REGION]: '지방',
  });

  function combineHistoricalLibraryGeometries(geometries) {
    const coordinates = geometries.filter(geometry => ['Polygon', 'MultiPolygon'].includes(geometry?.type)).map(geometry => geometry.coordinates);
    if (!coordinates.length) return null;
    const union = coordinates.length === 1 ? coordinates[0] : window.polygonClipping.union(...coordinates);
    return normalizeClippedLandGeometry(union);
  }

  const historicalLibraryService = createHistoricalLibraryService({
    dataUrl: HISTORICAL_LIBRARY_DATA_URL,
    fetchJson: async url => {
      const response = await fetch(url, { cache: 'force-cache' });
      if (!response.ok) throw new Error(`라이브러리 HTTP ${response.status}`);
      return response.json();
    },
    getCountriesData: () => state.countriesData,
    displayName: countryName,
    combineGeometries: combineHistoricalLibraryGeometries,
  });

  function historicalLibraryPreviewSvg(entity, version) {
    const wrapper = document.createElement('div');
    wrapper.className = 'historical-library-preview-map';
    const svgNode = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgNode.setAttribute('viewBox', '0 0 420 190');
    svgNode.setAttribute('aria-label', `${entity.displayNames?.ko || entity.canonicalName} 경계 미리보기`);
    const projection = d3.geo.equirectangular().scale(1).translate([0, 0]);
    const previewPath = d3.geo.path().projection(projection);
    const feature = { type: 'Feature', properties: {}, geometry: version.geometry };
    const bounds = previewPath.bounds(feature);
    const width = Math.max(1, bounds[1][0] - bounds[0][0]);
    const height = Math.max(1, bounds[1][1] - bounds[0][1]);
    const scale = 0.86 / Math.max(width / 420, height / 190);
    const center = [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2];
    projection.scale(scale).translate([210 - scale * center[0], 95 - scale * center[1]]);
    const pathNode = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathNode.setAttribute('d', previewPath(feature) || '');
    pathNode.setAttribute('fill', 'var(--accent-surface)');
    pathNode.setAttribute('stroke', 'var(--accent-border)');
    pathNode.setAttribute('stroke-width', '1.5');
    pathNode.setAttribute('vector-effect', 'non-scaling-stroke');
    svgNode.appendChild(pathNode);
    wrapper.appendChild(svgNode);
    return wrapper;
  }

  function libraryInstanceId(libraryId) {
    const entity = historicalLibraryService.get(libraryId);
    const currentCountryId = String(entity?.metadata?.currentCountryId || '');
    if (currentCountryId && countryFeatureById(currentCountryId)) return currentCountryId;
    const preferredInstanceId = String(entity?.metadata?.preferredInstanceId || '');
    if (preferredInstanceId && countryFeatureById(preferredInstanceId)) return preferredInstanceId;
    const country = state.countriesData?.features?.find(feature => String(feature.properties?.sourceLibraryId || '') === String(libraryId));
    if (country) return String(country.properties.editor_id);
    const unit = state.territorialUnits.find(feature => String(feature.properties?.sourceLibraryId || '') === String(libraryId));
    return unit ? String(unit.id) : '';
  }

  async function instantiateHistoricalLibraryEntities(rootIds, referenceDate, childDepth = 'none') {
    const descriptors = historicalLibraryService.instantiateDescriptors(rootIds, referenceDate, childDepth);
    const pending = descriptors.filter(descriptor => !libraryInstanceId(descriptor.libraryId));
    if (!pending.length) return { added: 0, subtracted: 0, deleted: 0, affectedIds: [] };
    const priority = pending.filter(descriptor => descriptor.instantiation?.mode === 'country-territory-priority');
    if (priority.length) {
      if (priority.length !== 1 || pending.length !== 1 || priority[0].type !== LIBRARY_ENTITY_TYPES.COUNTRY) {
        throw new Error('영토 우선 라이브러리 항목은 한 번에 국가 1개만 추가할 수 있습니다.');
      }
      const descriptor = priority[0];
      const feature = createCountryFeature(descriptor.name, [], nextCountryColor(), descriptor.geometry);
      feature.properties.sourceLibraryId = descriptor.libraryId;
      feature.properties.sourceGeometryVersion = descriptor.geometryVersionId;
      feature.properties.validFrom = descriptor.validFrom;
      feature.properties.validTo = descriptor.validTo;
      feature.properties.libraryMetadata = descriptor.metadata;
      const countriesData = { type: 'FeatureCollection', features: [feature] };
      const plan = await planGisMerge(state.countriesData, countriesData, 'imported-territory-priority');
      if (!plan.canCommit) throw new Error('자동 차감 후에도 국가 간 중첩이 남아 라이브러리 항목을 추가할 수 없습니다.');
      if (plan.counts?.deleted) throw new Error('동독 영토 추가 과정에서 기존 국가가 삭제되어 작업을 중단했습니다.');
      return commitGisMerge({
        countriesData,
        countryUpdates: descriptor.instantiation?.countryUpdates || {},
        sourceInfo: descriptor.metadata?.librarySourceInfo || {},
        commitStatus: '독일 민주 공화국을 추가하고 기존 독일 영토를 한 번의 작업으로 차감했습니다.',
      }, plan);
    }
    recordHistory();
    let countriesAdded = 0;
    for (const descriptor of pending) {
      if (descriptor.type === LIBRARY_ENTITY_TYPES.COUNTRY) {
        const preferredInstanceId = String(descriptor.metadata?.preferredInstanceId || '');
        const feature = createCountryFeature(
          descriptor.name,
          [],
          descriptor.metadata?.defaultColor || nextCountryColor(),
          descriptor.geometry,
        );
        if (preferredInstanceId && !countryFeatureById(preferredInstanceId)) {
          feature.properties.editor_id = preferredInstanceId;
        }
        feature.properties.sourceLibraryId = descriptor.libraryId;
        feature.properties.sourceGeometryVersion = descriptor.geometryVersionId;
        feature.properties.validFrom = descriptor.validFrom;
        feature.properties.validTo = descriptor.validTo;
        feature.properties.libraryMetadata = descriptor.metadata;
        if (descriptor.metadata?.territoryMerge === 'imported-priority') {
          const overlappingCountryIds = new Set(countryIdsOverlappingGeometry(descriptor.geometry));
          const donorIds = [];
          const nextFeatures = [];
          for (const candidate of state.countriesData.features || []) {
            const donorId = String(candidate.properties?.editor_id || '');
            if (!overlappingCountryIds.has(donorId)) {
              nextFeatures.push(candidate);
              continue;
            }
            if (donorId) donorIds.push(donorId);
            const remainder = normalizeClippedLandGeometry(window.polygonClipping.difference(
              candidate.geometry.coordinates,
              descriptor.geometry.coordinates,
            ));
            if (!remainder || geometryAreaKm2(remainder) <= 0.000001) continue;
            nextFeatures.push({ ...candidate, geometry: remainder });
          }
          state.countriesData.features = nextFeatures;
          for (const donorId of donorIds) state.historyDirtyCountryIds.add(donorId);
          if (preferredInstanceId) transferLandDependents(descriptor.geometry, donorIds, preferredInstanceId);
        }
        state.countriesData.features.push(feature);
        state.historyDirtyCountryIds.add(String(feature.properties.editor_id || ''));
        countriesAdded += 1;
        continue;
      }
      const parentId = libraryInstanceId(descriptor.parentLibraryId);
      const sovereignId = libraryInstanceId(descriptor.sovereignLibraryId);
      state.territorialUnits.push(createTerritorialFeature({
        id: uid(`library_${descriptor.type}`),
        unitType: descriptor.type,
        name: descriptor.name,
        geometry: descriptor.geometry,
        parentId,
        sovereignId,
        adminLevel: descriptor.adminLevel,
        coverageMode: descriptor.type === LIBRARY_ENTITY_TYPES.REGION ? TERRITORIAL_COVERAGE_MODES.EXPLICIT : TERRITORIAL_COVERAGE_MODES.PARTITION,
        isRemainder: false,
        validFrom: descriptor.validFrom,
        validTo: descriptor.validTo,
        metadata: descriptor.metadata,
        sourceLibraryId: descriptor.libraryId,
        sourceGeometryVersion: descriptor.geometryVersionId,
      }));
    }
    if (countriesAdded) {
      reindexCountries(state.countriesData, true);
      mapEditClient.rebase(state.countriesData.features);
      scheduleGpuMeshRebuild(0);
    }
    normalizeProjectObjects();
    markLayerTreeDirty();
    renderAll();
    queueAutosave();
    saveState.markNewProject('content:0');
    return {
      added: pending.length,
      subtracted: 0,
      deleted: 0,
      affectedIds: pending.map(descriptor => libraryInstanceId(descriptor.libraryId)).filter(Boolean),
    };
  }

  const historicalLibraryController = createHistoricalLibraryController({
    document,
    elements: {
      open: $('addFromLibraryBtn'),
      modal: $('historicalLibraryModal'),
      card: document.querySelector('.historical-library-card'),
      close: $('historicalLibraryCloseBtn'),
      backdrop: $('historicalLibraryModal').querySelector('.ui-dialog-backdrop'),
      search: $('historicalLibrarySearchInput'),
      clearSearch: $('historicalLibrarySearchClearBtn'),
      type: $('historicalLibraryTypeInput'),
      status: $('historicalLibraryStatusInput'),
      year: $('historicalLibraryYearInput'),
      geographicRegion: $('historicalLibraryGeographicRegionInput'),
      results: $('historicalLibraryResults'),
      preview: $('historicalLibraryPreview'),
      snapshot: $('historicalLibrarySnapshotInput'),
      snapshotButton: $('historicalLibrarySnapshotBtn'),
      childDepth: $('historicalLibraryChildDepthInput'),
      add: $('historicalLibraryAddBtn'),
      addOptions: $('historicalLibraryAddOptions'),
      optionsBack: $('historicalLibraryOptionsBackBtn'),
    },
    service: historicalLibraryService,
    typeLabels: LIBRARY_TYPE_LABELS,
    selectGeometryVersion,
    renderMapPreview: historicalLibraryPreviewSvg,
    createEmptyState,
    replaceSelectOptions,
    collator: layerNameCollator,
    isMobile,
    closeCreateMenu,
    instantiate: instantiateHistoricalLibraryEntities,
    confirm: openConfirmModal,
    setStatus: setActionStatus,
    reportError: reportOperationError,
  });

  window.PANDOLAB_HISTORICAL_LIBRARY = Object.freeze({
    load: historicalLibraryService.load,
    get: historicalLibraryService.get,
    list: historicalLibraryService.list,
    search: historicalLibraryService.search,
    snapshots: historicalLibraryService.snapshots,
    instantiate: (id, referenceDate = '', childDepth = 'none') => instantiateHistoricalLibraryEntities([id], referenceDate, childDepth),
  });

  function territorialUnitMatchesFromImportedValue(value, countryId = '', units = state.territorialUnits) {
    const key = String(value ?? '').trim();
    if (!key) return [];
    const exact = units.filter(feature => String(feature.id) === key);
    if (exact.length) return exact;
    return units.filter(feature => territorialUnitName(feature).toLocaleLowerCase('ko') === key.toLocaleLowerCase('ko')
      && (!countryId || String(feature.properties?.sovereignId || '') === String(countryId)));
  }

  function importedTerritorialUnitFeature(raw, index, kind, mapping, sourceFolderId, knownUnits) {
    if (!['Polygon', 'MultiPolygon'].includes(raw.geometry?.type)) return null;
    const properties = raw.properties || {};
    const rawCountryValue = mapping.useFeatureCountryField && mapping.countryField
      ? String(properties[mapping.countryField] ?? '').trim()
      : '';
    const fieldCountry = rawCountryValue
      ? resolveImportedCountryId(rawCountryValue, state.countriesData?.features || [])
      : '';
    if (rawCountryValue && !fieldCountry) throw createGisImportError(`객체별 소속 국가 값 "${rawCountryValue}"을(를) 현재 지도에서 찾을 수 없습니다.`, {
      category: RELIABILITY_ERROR_CATEGORIES.RELATION,
      objectIds: [String(raw.id ?? index + 1), rawCountryValue],
    });
    const countryId = String(fieldCountry || resolveImportedCountryId(mapping.targetCountryId, state.countriesData?.features || []) || '');
    const commonParent = kind === TERRITORIAL_UNIT_TYPES.ADMIN && mapping.parentId
      ? knownUnits.find(candidate => String(candidate.id) === String(mapping.parentId)
        && String(candidate.properties?.sovereignId || '') === countryId)
      : null;
    const rawParentValue = kind === TERRITORIAL_UNIT_TYPES.ADMIN && mapping.useFeatureCountryField && mapping.parentField
      ? String(properties[mapping.parentField] ?? '').trim()
      : '';
    const parentMatches = rawParentValue
      ? territorialUnitMatchesFromImportedValue(rawParentValue, countryId, knownUnits)
      : [];
    const mappedParent = parentMatches.length === 1 ? parentMatches[0] : null;
    if (rawParentValue && parentMatches.length > 1) throw createGisImportError(`객체별 상위 영역 값 "${rawParentValue}"이(가) 여러 영역과 일치합니다. 고유 ID로 직접 연결하세요.`, {
      category: RELIABILITY_ERROR_CATEGORIES.RELATION,
      objectIds: [String(raw.id ?? index + 1), ...parentMatches.map(feature => String(feature.id))],
    });
    if (rawParentValue && !mappedParent) throw createGisImportError(`객체별 상위 영역 값 "${rawParentValue}"을(를) 현재 지도에서 찾을 수 없습니다.`, {
      category: RELIABILITY_ERROR_CATEGORIES.RELATION,
      objectIds: [String(raw.id ?? index + 1), rawParentValue],
    });
    const parent = commonParent || mappedParent;
    const level = kind === TERRITORIAL_UNIT_TYPES.ADMIN
      ? (parent?.properties?.unitType === TERRITORIAL_UNIT_TYPES.ADMIN
        ? Math.max(1, Number(parent.properties.adminLevel) || 1) + 1
        : parent?.properties?.unitType === TERRITORIAL_UNIT_TYPES.TERRITORY
          ? 2
          : 1)
      : null;
    const mappedId = mapping.idField === '__fid__' ? raw.id : properties[mapping.idField];
    const sourceId = String(mappedId ?? raw.id ?? '').trim();
    const baseOptions = {
      id: uid(),
      unitType: kind,
      sovereignId: countryId,
      parentId: parent?.id || '',
      adminLevel: level,
      isRemainder: false,
      name: String(mapping.nameField ? properties[mapping.nameField] || '' : properties.name || '').trim() || `가져온 ${territorialTypeLabel(kind)} ${index + 1}`,
      color: properties.color || properties.editorColor || '',
      notes: properties.notes || '',
      sourceFolderId,
      metadata: { sourceId },
      geometry: normalizeCountryGeometry(raw.geometry) || raw.geometry,
    };
    if (kind === TERRITORIAL_UNIT_TYPES.REGION) {
      return createTerritorialFeature({
        ...baseOptions,
        coverageMode: TERRITORIAL_COVERAGE_MODES.EXPLICIT,
        isRemainder: false,
        adminLevel: null,
      });
    }
    return createPartitionTerritorialFeature(baseOptions);
  }

  function prepareImportedTerritorialUnitFeatures(features, kind, mapping, sourceFolderId) {
    const knownUnits = deepClone(state.territorialUnits);
    const imported = [];
    const ids = new Set(knownUnits.map(feature => String(feature.id)));
    for (let index = 0; index < features.length; index += 1) {
      const feature = importedTerritorialUnitFeature(features[index], index, kind, mapping, sourceFolderId, [...knownUnits, ...imported]);
      if (!feature) continue;
      if (!feature.properties?.sovereignId && kind !== TERRITORIAL_UNIT_TYPES.REGION) throw createGisImportError(`${territorialUnitName(feature)}의 소속 국가를 정하지 못했습니다.`, {
        category: RELIABILITY_ERROR_CATEGORIES.RELATION,
        objectIds: [feature.id],
      });
      if (ids.has(String(feature.id))) throw new Error(`영역 ID 충돌: ${feature.id}`);
      ids.add(String(feature.id));
      imported.push(feature);
    }
    if (!imported.length) throw new Error('가져올 Polygon 또는 MultiPolygon 객체가 없습니다.');
    return imported;
  }

  function appendPreparedTerritorialUnits(imported, kind, { preserveIds = [] } = {}) {
    const clipper = window.polygonClipping;
    const nextUnits = deepClone(state.territorialUnits);
    const preserved = new Set(preserveIds.map(String));
    const affectedCountries = new Set();
    for (const feature of imported) {
      const countryId = String(feature.properties?.sovereignId || '');
      const country = countryFeatureById(countryId);
      const parent = feature.properties.parentId
        ? nextUnits.find(candidate => String(candidate.id) === String(feature.properties.parentId))
        : null;
      const container = parent || country;
      if (!country?.geometry) throw createGisImportError(`${territorialUnitName(feature)}의 소속 국가를 찾을 수 없습니다.`, {
        category: RELIABILITY_ERROR_CATEGORIES.RELATION,
        objectIds: [feature.id, countryId],
      });
      if (feature.properties.parentId && !parent?.geometry) throw createGisImportError(`${territorialUnitName(feature)}의 지정된 부모 영역을 찾을 수 없습니다.`, {
        category: RELIABILITY_ERROR_CATEGORIES.RELATION,
        objectIds: [feature.id, feature.properties.parentId],
      });
      if (!container?.geometry) throw createGisImportError(`${territorialUnitName(feature)}의 소속 국가 또는 상위 영역을 찾을 수 없습니다.`, {
        category: RELIABILITY_ERROR_CATEGORIES.RELATION,
        objectIds: [feature.id, countryId, feature.properties.parentId],
      });
      const outside = preserved.has(String(feature.id))
        ? null
        : normalizeClippedLandGeometry(clipper.difference(feature.geometry.coordinates, container.geometry.coordinates));
      if (outside && geometryAreaKm2(outside) > Math.max(0.0001, geometryAreaKm2(feature.geometry) * 1e-9)) {
        throw new Error(`${territorialUnitName(feature)}의 전체 geometry가 선택한 국가 또는 상위 영역 안에 포함되지 않습니다.`);
      }
      const context = {
        unitType: kind,
        sovereignId: countryId,
        parentId: feature.properties.parentId,
        adminLevel: feature.properties.adminLevel,
      };
      const siblings = nextUnits.filter(candidate => partitionGroupMatches(candidate, context));
      for (const sibling of siblings.filter(candidate => candidate.properties?.isRemainder !== true)) {
        const overlap = clipper.intersection(feature.geometry.coordinates, sibling.geometry.coordinates);
        if (multiPolygonPlanarArea(overlap) > Math.max(1e-9, multiPolygonPlanarArea(feature.geometry.coordinates) * 1e-9)) {
          throw new Error(`${territorialUnitName(feature)}이(가) 기존 ${territorialUnitName(sibling)}과(와) 겹칩니다.`);
        }
      }
      const hadPartition = siblings.length > 0;
      for (const sibling of siblings.filter(candidate => candidate.properties?.isRemainder === true)) {
        const remainder = normalizeClippedLandGeometry(clipper.difference(sibling.geometry.coordinates, feature.geometry.coordinates));
        const siblingIndex = nextUnits.findIndex(candidate => String(candidate.id) === String(sibling.id));
        if (remainder) nextUnits[siblingIndex].geometry = remainder;
        else nextUnits.splice(siblingIndex, 1);
      }
      if (!hadPartition) {
        const remainder = normalizeClippedLandGeometry(clipper.difference(container.geometry.coordinates, feature.geometry.coordinates));
        if (remainder) nextUnits.push(createPartitionTerritorialFeature({
          id: uid(kind === TERRITORIAL_UNIT_TYPES.ADMIN ? 'administrative' : 'territory'),
          ...context,
          isRemainder: true,
          geometry: remainder,
        }));
      }
      nextUnits.push(feature);
      affectedCountries.add(countryId);
    }
    state.territorialUnits = normalizeTerritorialUnits(nextUnits, { countryExists: id => !!countryFeatureById(id) });
    reconcileTerritorialUnitCompleteness(affectedCountries, { preserveIds: [...preserved] });
    return affectedCountries;
  }

  async function commitTerritorialImportWithTransfer(result, fileName) {
    const kind = result.targetType === 'administrative'
      ? TERRITORIAL_UNIT_TYPES.ADMIN
      : result.targetType === 'region'
        ? TERRITORIAL_UNIT_TYPES.REGION
        : TERRITORIAL_UNIT_TYPES.TERRITORY;
    const mapping = result.mapping || {};
    const sourceFolderId = `gis:${uid('source')}`;
    const imported = prepareImportedTerritorialUnitFeatures(result.collection?.features || [], kind, mapping, sourceFolderId);
    const snapshot = snapshotEditable();
    const affectedCountryIds = new Set();
    const preservedIds = new Set();
    const countryGeometryOverrides = new Map();
    let activeRequestId = null;
    try {
      // Coast decisions are made against a detached draft before any annex or
      // canonical project mutation. Every later impact calculation uses the
      // resulting geometry, not the raw import geometry.
      for (const feature of imported) {
        const country = countryFeatureById(feature.properties?.sovereignId);
        const resolution = requireImportCoastResolution(await resolveTerritorialCoast(feature, country, countryGeometryOverrides));
        if (resolution.direction === 'admin-to-country' || resolution.direction === 'independent') preservedIds.add(String(feature.id));
      }

      const draftCountries = deepClone(state.countriesData);
      const draftById = new Map((draftCountries.features || []).map(feature => [String(feature.properties?.editor_id || ''), feature]));
      for (const [countryId, geometry] of countryGeometryOverrides) {
        const country = draftById.get(String(countryId));
        if (country) country.geometry = deepClone(geometry);
      }

      let impact = { groups: [], absorbedCountryIds: [] };
      let annexResponse = null;
      if (kind !== TERRITORIAL_UNIT_TYPES.REGION) {
        impact = buildTerritorialImportTransactionPlan({
          features: imported,
          countries: draftCountries.features || [],
          targetCountryId: '',
          useFeatureCountryField: true,
          countryField: 'sovereignId',
          clipper: window.polygonClipping,
          areaKm2: geometryAreaKm2,
        });
        const targetIds = new Set((impact.groups || []).map(group => String(group.targetCountryId)));
        const absorbedTarget = (impact.absorbedCountryIds || []).find(id => targetIds.has(String(id)));
        if (absorbedTarget) throw new Error('한 가져오기 작업에서 소속 국가가 다른 대상 국가에 완전히 흡수됩니다. 객체별 소속 국가를 다시 확인하세요.');
        const operations = (impact.groups || []).map(group => ({
          targetId: String(group.targetCountryId),
          donorIds: (group.donorIds || []).map(String).filter(id => id && id !== String(group.targetCountryId) && draftById.has(id)),
          transferredGeometry: group.importedGeometry,
          allowUnclaimed: true,
        }));
        mapEditClient.rebase(draftCountries.features || []);
        annexResponse = await mapEditClient.execute('annex-batch', { operations });
        activeRequestId = annexResponse.requestId;
        const patchById = new Map((annexResponse.result.features || []).map(feature => [String(feature.properties?.editor_id || ''), feature]));
        const removed = new Set((annexResponse.result.removedIds || []).map(String));
        draftCountries.features = (draftCountries.features || [])
          .filter(feature => !removed.has(String(feature.properties?.editor_id || '')))
          .map(feature => patchById.get(String(feature.properties?.editor_id || '')) || feature);
        for (const [id, feature] of patchById) {
          if (!draftById.has(id)) draftCountries.features.push(feature);
        }
        for (const id of annexResponse.result.affectedIds || []) affectedCountryIds.add(String(id));
      }
      for (const id of countryGeometryOverrides.keys()) affectedCountryIds.add(String(id));

      const draftCountryById = new Map((draftCountries.features || [])
        .map(feature => [String(feature.properties?.editor_id || ''), feature]));
      for (const feature of imported) {
        const sovereignId = String(feature.properties?.sovereignId || '');
        if (!sovereignId && kind === TERRITORIAL_UNIT_TYPES.REGION) continue;
        const country = draftCountryById.get(sovereignId);
        const parentId = String(feature.properties?.parentId || '');
        const parent = parentId ? state.territorialUnits.find(candidate => String(candidate.id) === parentId) : null;
        if (!country?.geometry) throw createGisImportError('소속 국가를 찾을 수 없습니다.', {
          category: RELIABILITY_ERROR_CATEGORIES.RELATION,
          objectIds: [feature.id, sovereignId],
        });
        if (parentId && !parent?.geometry) throw createGisImportError('지정된 부모 영역을 찾을 수 없습니다.', {
          category: RELIABILITY_ERROR_CATEGORIES.RELATION,
          objectIds: [feature.id, parentId],
        });
        const container = parent || country;
        const overlap = normalizeClippedLandGeometry(window.polygonClipping.intersection(
          feature.geometry.coordinates,
          container.geometry.coordinates,
        ));
        if (!overlap || geometryAreaKm2(overlap) <= Math.max(0.000001, geometryAreaKm2(feature.geometry) * 1e-10)) {
          throw createGisImportError('가져온 영역이 선택한 국가 또는 부모 영역과 겹치지 않습니다.', {
            category: RELIABILITY_ERROR_CATEGORIES.GEOMETRY,
            objectIds: [feature.id, sovereignId, parentId],
          });
        }
        if (parent) {
          const outsideParent = normalizeClippedLandGeometry(window.polygonClipping.difference(
            feature.geometry.coordinates,
            parent.geometry.coordinates,
          ));
          if (outsideParent && geometryAreaKm2(outsideParent) > Math.max(0.0001, geometryAreaKm2(feature.geometry) * 1e-9)) {
            throw createGisImportError('가져온 행정구역이 지정된 부모 영역 밖에 존재합니다.', {
              category: RELIABILITY_ERROR_CATEGORIES.GEOMETRY,
              objectIds: [feature.id, parentId],
            });
          }
        }
      }

      const draftValidation = await validateGisCountryCollection(draftCountries, affectedCountryIds);
      if (Number(draftValidation?.overlapAreaKm2 || 0) > 0.001) throw createGisImportError('해안선 정합 및 영토 이전 결과에 국가 간 중첩이 남았습니다.', {
        category: RELIABILITY_ERROR_CATEGORIES.GEOMETRY,
        objectIds: draftValidation?.firstOverlap || [...affectedCountryIds],
      });

      // Canonical mutation begins only after coast, impact, worker and geometry
      // validation have all succeeded. The surrounding snapshot restores this
      // short synchronous commit if project reference validation fails.
      state.countriesData = reindexCountries(draftCountries, true);
      for (const id of affectedCountryIds) state.historyDirtyCountryIds.add(id);
      for (const group of impact.groups || []) {
        const targetId = String(group.targetCountryId);
        const donorIds = (group.donorIds || []).map(String).filter(id => id && id !== targetId);
        transferLandDependents(group.importedGeometry, donorIds, targetId);
      }
      let importedCountries;
      if (kind === TERRITORIAL_UNIT_TYPES.REGION) {
        state.territorialUnits.push(...deepClone(imported));
        importedCountries = new Set(imported.map(feature => String(feature.properties?.sovereignId || '')).filter(Boolean));
      } else {
        importedCountries = appendPreparedTerritorialUnits(imported, kind, { preserveIds: [...preservedIds] });
      }
      for (const id of importedCountries) affectedCountryIds.add(String(id));
      normalizeProjectObjects();
      assertCurrentProjectReferences();
      refreshCountryCentroids(affectedCountryIds);
      markLayerTreeDirty();
      commitHistorySnapshot(snapshot, {
        type: 'gis-import',
        description: `${fileName} 영토 이전 및 ${territorialTypeLabel(kind)} 가져오기`,
        affectedIds: [...affectedCountryIds, ...imported.map(feature => String(feature.id))],
      });
      renderAll();
      queueAutosave();
      setActionStatus(`${territorialTypeLabel(kind)} ${imported.length}개를 전체 형상으로 가져왔습니다.`, 'success', 4400);
      if (activeRequestId != null) mapEditClient.discard(activeRequestId);
      activeRequestId = null;
      mapEditClient.rebase(state.countriesData?.features || []);
    } catch (error) {
      if (activeRequestId != null) mapEditClient.discard(activeRequestId);
      restoreCountryEditSnapshot(snapshot);
      mapEditClient.rebase(state.countriesData?.features || []);
      throw error;
    }
  }

  function requireImportCoastResolution(resolution) {
    if (resolution?.direction === 'cancel') throw createCancellationError('해안선 정합을 취소했습니다.');
    return resolution;
  }

  async function resolveTerritorialCoast(feature, country, countryGeometryOverrides) {
    const unitType = feature?.properties?.unitType;
    if (![TERRITORIAL_UNIT_TYPES.TERRITORY, TERRITORIAL_UNIT_TYPES.ADMIN, TERRITORIAL_UNIT_TYPES.REGION].includes(unitType)) return { direction: 'none' };
    if (!country?.geometry) {
      if (!feature?.properties?.sovereignId && unitType === TERRITORIAL_UNIT_TYPES.REGION) return { direction: 'none' };
      throw createGisImportError('소속 국가를 찾을 수 없습니다.', {
        category: RELIABILITY_ERROR_CATEGORIES.RELATION,
        objectIds: [feature?.id, feature?.properties?.sovereignId],
      });
    }
    const draftCountryFeatures = (state.countriesData?.features || []).map(candidate => {
      const id = String(candidate.properties?.editor_id || '');
      const geometry = countryGeometryOverrides.get(id);
      return geometry ? { ...candidate, geometry } : candidate;
    });
    const topology = buildSharedBoundaryTopology(draftCountryFeatures);
    const analysis = analyzeAdminCountryCoast({
      adminFeature: feature,
      countryFeature: { ...country, geometry: countryGeometryOverrides.get(String(country.properties?.editor_id || '')) || country.geometry },
      countryTopology: topology,
    });
    if (analysis.status !== 'unavailable' && !analysis.conflicts.length) return { direction: 'none' };
    const choice = await coastReconciliationController.open({
      subjectName: territorialUnitName(feature),
      subjectActionLabel: '가져온 영역',
      countryName: countryName(country),
      conflicts: analysis.conflicts,
      automaticAvailable: analysis.status !== 'unavailable',
      unavailableReason: analysis.unavailableReason,
    });
    const direction = normalizeCoastDecision(choice);
    if (direction === 'cancel') return { direction };
    if (direction === 'independent') return { direction };
    const baseCountryGeometry = deepClone(countryGeometryOverrides.get(String(country.properties?.editor_id || '')) || country.geometry);
    const baseAdminGeometry = deepClone(feature.geometry);
    const planned = planCoastReconciliations({
      conflicts: analysis.conflicts.map(conflict => ({ ...conflict, countryGeometry: baseCountryGeometry, adminGeometry: baseAdminGeometry })),
      direction,
    });
    const nextAdmin = planned.adminGeometry;
    const nextCountry = planned.countryGeometry;
    const adminValidation = validateCoastReplacement(nextAdmin, { clipper: window.polygonClipping });
    const countryValidation = validateCoastReplacement(nextCountry, { clipper: window.polygonClipping });
    if (!adminValidation.ok || !countryValidation.ok) throw createGisImportError('해안선 정합 결과가 유효한 닫힌 영역이 아닙니다.', {
      category: RELIABILITY_ERROR_CATEGORIES.GEOMETRY,
      objectIds: [feature.id, country.properties?.editor_id],
      technicalMessage: [...(adminValidation.issues || []), ...(countryValidation.issues || [])].join(' / '),
    });
    if (direction === 'country-to-admin') feature.geometry = nextAdmin;
    else countryGeometryOverrides.set(String(country.properties?.editor_id || ''), nextCountry);
    return { direction };
  }

  async function importGeoJsonTerritorialUnits(features, kind, mapping) {
    const clipper = window.polygonClipping;
    const sourceFolderId = `geojson:${uid('source')}`;
    const nextUnits = deepClone(state.territorialUnits);
    const countryGeometryOverrides = new Map();
    const preservedIds = new Set();
    const importedIds = [];
    let importedCount = 0;
    for (let index = 0; index < features.length; index += 1) {
      const feature = importedTerritorialUnitFeature(features[index], index, kind, mapping, sourceFolderId, nextUnits);
      if (!feature) continue;
      const country = countryFeatureById(feature.properties.sovereignId);
      const coastResolution = requireImportCoastResolution(await resolveTerritorialCoast(feature, country, countryGeometryOverrides));
      if (coastResolution.direction === 'admin-to-country' || coastResolution.direction === 'independent') preservedIds.add(String(feature.id));
      const parent = feature.properties.parentId
        ? nextUnits.find(candidate => String(candidate.id) === String(feature.properties.parentId))
        : null;
      const container = parent || (country ? { ...country, geometry: countryGeometryOverrides.get(String(country.properties?.editor_id || '')) || country.geometry } : country);
      if (!container?.geometry) {
        feature.properties.sovereignId = '';
        feature.properties.parentId = '';
        feature.properties.isRemainder = false;
        nextUnits.push(feature);
        importedCount += 1;
        continue;
      }
      const clipped = preservedIds.has(String(feature.id))
        ? normalizeClippedLandGeometry(feature.geometry)
        : normalizeClippedLandGeometry(clipper.intersection(feature.geometry.coordinates, container.geometry.coordinates));
      if (!clipped) throw new Error(`${territorialUnitName(feature)}이(가) 지정된 국가 또는 부모와 겹치지 않습니다.`);
      feature.geometry = clipped;
      const context = {
        unitType: kind,
        sovereignId: feature.properties.sovereignId,
        parentId: feature.properties.parentId,
        adminLevel: feature.properties.adminLevel,
      };
      const siblings = nextUnits.filter(candidate => partitionGroupMatches(candidate, context));
      for (const sibling of siblings.filter(candidate => candidate.properties?.isRemainder !== true)) {
        const overlap = clipper.intersection(feature.geometry.coordinates, sibling.geometry.coordinates);
        if (multiPolygonPlanarArea(overlap) > Math.max(1e-9, multiPolygonPlanarArea(feature.geometry.coordinates) * 1e-9)) {
          throw new Error(`${territorialUnitName(feature)}이(가) 기존 ${territorialUnitName(sibling)}과(와) 겹칩니다.`);
        }
      }
      const hadPartition = siblings.length > 0;
      for (const sibling of siblings.filter(candidate => candidate.properties?.isRemainder === true)) {
        const remainder = normalizeClippedLandGeometry(clipper.difference(sibling.geometry.coordinates, feature.geometry.coordinates));
        const siblingIndex = nextUnits.findIndex(candidate => String(candidate.id) === String(sibling.id));
        if (remainder) nextUnits[siblingIndex].geometry = remainder;
        else nextUnits.splice(siblingIndex, 1);
      }
      if (!hadPartition) {
        const remainder = normalizeClippedLandGeometry(clipper.difference(container.geometry.coordinates, feature.geometry.coordinates));
        if (remainder) nextUnits.push(createPartitionTerritorialFeature({
          id: uid(kind === TERRITORIAL_UNIT_TYPES.ADMIN ? 'administrative' : 'territory'),
          ...context,
          isRemainder: true,
          geometry: remainder,
        }));
      }
      nextUnits.push(feature);
      importedCount += 1;
      importedIds.push(String(feature.id));
    }
    if (!importedCount) throw new Error('가져올 Polygon 또는 MultiPolygon 객체가 없습니다.');
    recordHistory();
    for (const [countryId, geometry] of countryGeometryOverrides) {
      const country = countryFeatureById(countryId);
      if (country) {
        country.geometry = geometry;
        state.historyDirtyCountryIds.add(countryId);
      }
    }
    state.territorialUnits = normalizeTerritorialUnits(nextUnits, { countryExists: id => !!countryFeatureById(id) });
    const affectedCountryIds = new Set(state.territorialUnits.map(feature => String(feature.properties?.sovereignId || '')).filter(Boolean));
    reconcileTerritorialUnitCompleteness(affectedCountryIds, { preserveIds: [...preservedIds] });
    markLayerTreeDirty();
    renderAll();
    queueAutosave();
    setActionStatus(`${territorialTypeLabel(kind)} ${importedCount}개를 가져왔습니다.`, 'success', 3800);
    return importedIds;
  }

  async function importGeoJsonRegions(features, mapping) {
    const imported = [];
    const defaultContext = { sovereignId: '', parentId: '' };
    const existingIds = new Set(state.territorialUnits.map(feature => String(feature.id)));
    const countryGeometryOverrides = new Map();
    for (let index = 0; index < features.length; index += 1) {
      const raw = features[index];
      if (!['Polygon', 'MultiPolygon'].includes(raw.geometry?.type)) continue;
      const properties = raw.properties || {};
      const sourceId = String(raw.id ?? properties.id ?? '').trim();
      const id = uid();
      if (existingIds.has(id)) throw new Error(`영역 ID 충돌: ${id}`);
      existingIds.add(id);
      const rawCountry = String(mapping.countryField ? properties[mapping.countryField] ?? '' : properties.sovereign_id || properties.sovereignId || properties.country_id || '').trim();
      const resolvedCountryId = resolveImportedCountryId(rawCountry, state.countriesData?.features || []);
      if (rawCountry && !resolvedCountryId) throw createGisImportError('소속 국가를 찾을 수 없습니다.', {
        category: RELIABILITY_ERROR_CATEGORIES.RELATION,
        objectIds: [id, rawCountry],
        technicalMessage: `Unresolved imported region country: ${rawCountry}`,
      });
      const parentValue = String(mapping.parentField ? properties[mapping.parentField] ?? '' : properties.parent_id || properties.parentId || '').trim();
      const parentMatches = parentValue
        ? territorialUnitMatchesFromImportedValue(parentValue, resolvedCountryId || defaultContext.sovereignId)
        : [];
      const parent = parentMatches.length === 1 ? parentMatches[0] : null;
      if (parentValue && parentMatches.length > 1) throw createGisImportError('지정된 부모 이름이 여러 영역과 일치합니다. 고유 ID로 직접 연결하세요.', {
        category: RELIABILITY_ERROR_CATEGORIES.RELATION,
        objectIds: [id, ...parentMatches.map(feature => String(feature.id))],
      });
      if (parentValue && !parent) throw createGisImportError('지정된 부모 영역을 찾을 수 없습니다.', {
        category: RELIABILITY_ERROR_CATEGORIES.RELATION,
        objectIds: [id, parentValue],
        technicalMessage: `Unresolved imported region parent: ${parentValue}`,
      });
      const sovereignId = String(resolvedCountryId || parent?.properties?.sovereignId || defaultContext.sovereignId || '');
      const feature = createTerritorialFeature({
        id,
        unitType: TERRITORIAL_UNIT_TYPES.REGION,
        name: String(mapping.nameField ? properties[mapping.nameField] || '' : properties.name || '').trim() || `가져온 지방 ${index + 1}`,
        parentId: String(parent?.id || (!rawCountry ? defaultContext.parentId : '') || ''),
        sovereignId,
        coverageMode: TERRITORIAL_COVERAGE_MODES.EXPLICIT,
        isRemainder: false,
        validFrom: properties.valid_from || properties.validFrom || null,
        validTo: properties.valid_to || properties.validTo || null,
        color: properties.color || properties.editorColor || '',
        metadata: { sourceId },
        geometry: normalizeCountryGeometry(raw.geometry) || raw.geometry,
      });
      const country = sovereignId ? countryFeatureById(sovereignId) : null;
      if (sovereignId && !country?.geometry) throw createGisImportError('소속 국가를 찾을 수 없습니다.', {
        category: RELIABILITY_ERROR_CATEGORIES.RELATION,
        objectIds: [id, sovereignId],
      });
      if (country?.geometry) {
        const countryGeometry = countryGeometryOverrides.get(sovereignId) || country.geometry;
        const overlap = window.polygonClipping.intersection(feature.geometry.coordinates, countryGeometry.coordinates);
        if (multiPolygonPlanarArea(overlap) <= 1e-12) throw createGisImportError('가져온 영역이 지정된 국가와 겹치지 않습니다.', {
          category: RELIABILITY_ERROR_CATEGORIES.GEOMETRY,
          objectIds: [id, sovereignId],
        });
        requireImportCoastResolution(await resolveTerritorialCoast(feature, country, countryGeometryOverrides));
      }
      imported.push(feature);
    }
    if (!imported.length) throw new Error('가져올 Polygon 또는 MultiPolygon 지방이 없습니다.');
    recordHistory();
    const changedCountryIds = new Set();
    for (const [countryId, geometry] of countryGeometryOverrides) {
      const country = countryFeatureById(countryId);
      if (!country) continue;
      country.geometry = geometry;
      state.historyDirtyCountryIds.add(countryId);
      changedCountryIds.add(countryId);
    }
    state.territorialUnits.push(...imported);
    normalizeProjectObjects();
    if (changedCountryIds.size) {
      refreshCountryCentroids(changedCountryIds);
      markCountryGeometriesChanged(changedCountryIds);
    }
    state.layerVisibility.regions = true;
    for (const feature of imported) delete state.itemVisibility.regions?.[String(feature.id)];
    markLayerTreeDirty();
    if (imported.length === 1) selectTerritorialUnit(imported[0].id, true);
    else renderAll();
    queueAutosave();
    setActionStatus(`지방 ${imported.length}개를 가져왔습니다.`, 'success', 3800);
    return imported.map(feature => String(feature.id));
  }

  function importGeoJsonDistributions(features, type, mapping, fileName) {
    const layerMap = new Map(state.distributionLayers.map(layer => [layer.id, layer]));
    const entryIds = new Set(state.distributionEntries.map(entry => entry.id));
    const newLayers = [];
    const newEntries = [];
    const generatedLayerIds = new Map();
    const fallbackName = fileName.replace(/\.[^.]+$/, '') || DISTRIBUTION_TYPE_LABELS[type];
    for (let index = 0; index < features.length; index += 1) {
      const raw = features[index];
      if (!['Polygon', 'MultiPolygon'].includes(raw.geometry?.type)) continue;
      const properties = raw.properties || {};
      const name = String(mapping.nameField ? properties[mapping.nameField] || '' : properties.name || '').trim() || fallbackName;
      const sourceLayerId = String(properties.layer_id || '').trim();
      const layerKey = sourceLayerId || `name:${name}`;
      if (!generatedLayerIds.has(layerKey)) generatedLayerIds.set(layerKey, uid());
      const layerId = generatedLayerIds.get(layerKey);
      let layer = layerMap.get(layerId);
      if (layer && layer.type !== type) throw new Error(`분포 레이어 ID 충돌: ${layerId}`);
      if (!layer) {
        layer = createDistributionLayer({
          id: layerId,
          type,
          name,
          color: properties.color || DEFAULT_DRAWING_COLOR,
          metadata: { sourceId: sourceLayerId },
        });
        layerMap.set(layerId, layer);
        newLayers.push(layer);
      }
      const sourceEntryId = String(properties.entry_id ?? raw.id ?? '').trim();
      if (sourceEntryId && newEntries.some(entry => entry.metadata?.sourceId === sourceEntryId)) throw new Error(`외부 분포 엔트리 ID가 중복되었습니다: ${sourceEntryId}`);
      const entryId = uid();
      if (entryIds.has(entryId)) throw new Error(`분포 엔트리 ID 충돌: ${entryId}`);
      entryIds.add(entryId);
      const territorialUnitId = String(properties.territorial_unit_id || '').trim();
      const useTerritorial = !!territorialUnitId && !!territorialRepository.get(territorialUnitId);
      newEntries.push(createDistributionEntry({
        id: entryId,
        layerId,
        mode: useTerritorial ? DISTRIBUTION_MODES.TERRITORIAL : DISTRIBUTION_MODES.GEOMETRY,
        territorialUnitId: useTerritorial ? territorialUnitId : '',
        geometry: useTerritorial ? null : normalizeCountryGeometry(raw.geometry) || raw.geometry,
        share: properties.share ?? 100,
        certainty: properties.certainty || 'unknown',
        validFrom: properties.valid_from || properties.validFrom || null,
        validTo: properties.valid_to || properties.validTo || null,
        metadata: { sourceId: sourceEntryId },
      }));
    }
    if (!newEntries.length) throw new Error('가져올 Polygon 또는 MultiPolygon 분포가 없습니다.');
    distributionService.append({ layers: newLayers, entries: newEntries });
    normalizeProjectObjects();
    markLayerTreeDirty();
    renderAll();
    queueAutosave();
    setActionStatus(`${DISTRIBUTION_TYPE_LABELS[type]} 분포 ${newEntries.length}개를 가져왔습니다.`, 'success', 3800);
  }

  async function importGeoJson(file, { parsed = null, target = 'drawing', mapping = {} } = {}) {
    parsed ||= JSON.parse(await file.text());
    const features = parsed.type === 'FeatureCollection' ? parsed.features : parsed.type === 'Feature' ? [parsed] : [];
    const structuredIssues = features.filter(feature => ['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)).flatMap(validateStructuredGeometry);
    if (structuredIssues.length) throw new Error(`가져온 geometry가 올바르지 않습니다. ${structuredIssues[0].message}`);
    if (target === 'territory' || target === 'administrative') {
      await importGeoJsonTerritorialUnits(features, target === 'administrative' ? TERRITORIAL_UNIT_TYPES.ADMIN : TERRITORIAL_UNIT_TYPES.TERRITORY, mapping);
      return;
    }
    if (target === 'region') {
      await importGeoJsonRegions(features, mapping);
      return;
    }
    if (Object.values(DISTRIBUTION_TYPES).includes(target)) {
      importGeoJsonDistributions(features, target, mapping, file.name);
      return;
    }
    const supported = [];
    for (const raw of features) {
      if (!['Point', 'LineString', 'Polygon', 'MultiLineString', 'MultiPolygon'].includes(raw.geometry?.type)) continue;
      const f = deepClone(raw);
      const sourceId = String(f.id ?? f.properties?.id ?? '').trim();
      f.id = uid();
      if (['Polygon', 'MultiPolygon'].includes(f.geometry?.type)) f.geometry = normalizeCountryGeometry(f.geometry) || f.geometry;
      const p = f.properties || {};
      f.properties = {
        ...p,
        name: p.name || '',
        editorColor: p.editorColor || p.color || DEFAULT_DRAWING_COLOR,
        category: 'custom',
        notes: p.notes || '',
        metadata: { ...(p.metadata && typeof p.metadata === 'object' ? p.metadata : {}), sourceId },
      };
      supported.push(normalizeDrawingSemantics(f));
    }
    if (!supported.length) throw new Error('지원되는 점·선·면 지도 객체가 없습니다.');
    drawingApplicationService.addMany(supported);
    state.layerFolders = Object.fromEntries(activeLayerFolderKeys().map(key => [key, key === 'drawings']));
    markLayerTreeDirty();
    renderAll();
    queueAutosave();
    setActionStatus(`GeoJSON 지형지물 ${supported.length}개를 가져왔습니다.`, 'success', 3200);
  }

  let gisExportStep = 0;
  let gisExportReturnFocus = null;

  function gisExportCounts() {
    const units = state.territorialUnits || [];
    return {
      countries: state.countriesData?.features?.length || 0,
      territories: units.filter(feature => feature.properties?.unitType === TERRITORIAL_UNIT_TYPES.TERRITORY).length,
      administrative: units.filter(feature => feature.properties?.unitType === TERRITORIAL_UNIT_TYPES.ADMIN).length,
      regions: units.filter(feature => feature.properties?.unitType === TERRITORIAL_UNIT_TYPES.REGION).length,
      drawings: state.drawings.length,
      distributions: state.distributionEntries.length,
      labels: state.labels.length,
    };
  }

  function selectedGisExportLayers() {
    return [...document.querySelectorAll('#gisExportForm .gis-export-layers input:checked')].map(input => input.value);
  }

  function updateGisExportSummary() {
    const labels = {
      countries: '국가', territories: '권역', administrative: '행정구역', regions: '지방',
      drawings: '지형지물', distributions: '분포', labels: '사용자 지명',
    };
    const counts = gisExportCounts();
    const selected = selectedGisExportLayers();
    const nonEmpty = selected.filter(layer => counts[layer] > 0);
    const empty = selected.filter(layer => counts[layer] === 0);
    const format = $('gisExportFormat')?.value === 'geojson-zip' ? 'GeoJSON 묶음' : 'GIS용 GeoPackage';
    const summary = $('gisExportSummary')?.querySelector('p');
    if (!summary) return;
    const included = nonEmpty.length ? nonEmpty.map(layer => `${labels[layer]} ${counts[layer].toLocaleString()}개`).join(' · ') : '생성할 데이터 없음';
    const omitted = empty.length ? ` 비어 있는 ${empty.map(layer => labels[layer]).join(', ')} 파일은 만들지 않습니다.` : '';
    summary.textContent = `${format} · ${included}.${omitted}`;
  }

  function setGisExportStep(step, { focus = false } = {}) {
    gisExportStep = step === 1 ? 1 : 0;
    for (const element of document.querySelectorAll('[data-gis-export-step]')) element.dataset.gisActive = String(Number(element.dataset.gisExportStep) === gisExportStep);
    $('gisExportStepIndicator').textContent = `${gisExportStep + 1}/2 · ${gisExportStep ? '형식과 파일 내용 확인' : '내보낼 데이터'}`;
    $('gisExportBackBtn').disabled = gisExportStep === 0;
    $('gisExportNextBtn').classList.toggle('hidden', gisExportStep === 1);
    $('gisExportConfirmBtn').classList.toggle('hidden', gisExportStep !== 1);
    if (gisExportStep === 1) updateGisExportSummary();
    if (focus) requestAnimationFrame(() => document.querySelector(`[data-gis-export-step="${gisExportStep}"][data-gis-active="true"] :is(input, select, button)`)?.focus());
  }

  function openGisDataExport() {
    if (!requireCanonicalData()) return;
    gisExportReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : $('dataExportBtn');
    $('gisExportError').textContent = '';
    $('gisExportError').classList.add('hidden');
    $('gisExportModal').classList.remove('hidden');
    document.body.classList.add('modal-open');
    setGisExportStep(0, { focus: true });
  }

  function closeGisDataExport() {
    if ($('gisExportModal')?.classList.contains('hidden')) return;
    $('gisExportModal').classList.add('hidden');
    document.body.classList.remove('modal-open');
    const target = gisExportReturnFocus?.isConnected ? gisExportReturnFocus : $('dataExportBtn');
    gisExportReturnFocus = null;
    target?.focus({ preventScroll: true });
  }

  async function confirmGisDataExport() {
    const selectedLayers = selectedGisExportLayers();
    const counts = gisExportCounts();
    if (!selectedLayers.some(layer => counts[layer] > 0)) {
      $('gisExportError').textContent = '내보낼 데이터가 있는 범주를 하나 이상 선택하세요.';
      $('gisExportError').classList.remove('hidden');
      return;
    }
    const button = $('gisExportConfirmBtn');
    button.disabled = true;
    $('gisExportError').classList.add('hidden');
    const format = $('gisExportFormat').value;
    try {
      setActionStatus('GIS 데이터를 내보내는 중입니다.', 'working', 0);
      if (format === 'geojson-zip') {
        const result = await window.PandoLabGIS.exportGeoJsonBundle(buildAtlasState(), selectedLayers, (_message, percent) => {
          setActionStatus(`GeoJSON 묶음 생성 중 · ${Math.round(percent || 0)}%`, 'working', 0);
        });
        downloadBlob('판도연구소-GIS-데이터.zip', result.blob);
        closeGisDataExport();
        setActionStatus(`GeoJSON 레이어 ${result.manifest.layers.length}개를 만들었습니다.`, 'success', 3600);
      } else {
        const blob = await window.PandoLabGIS.exportGeoPackage(buildAtlasState(), (_message, percent) => {
          setActionStatus(`GIS용 GeoPackage 생성 중 · ${Math.round(percent || 0)}%`, 'working', 0);
        }, { mode: 'gis', layers: selectedLayers });
        downloadBlob('판도연구소-GIS-데이터.gpkg', blob);
        closeGisDataExport();
        setActionStatus('GIS용 GeoPackage를 만들었습니다.', 'success', 3600);
      }
    } catch (error) {
      $('gisExportError').textContent = error?.message || String(error);
      $('gisExportError').classList.remove('hidden');
      reportOperationError(error, 'GIS 데이터를 내보내지 못했습니다.', 'PL-GIS-EXPORT-001', 4200);
    } finally {
      button.disabled = false;
    }
  }

  function removeDrawingById(id, statusText = '') {
    const key = String(id);
    const feature = drawingApplicationService.get(key);
    if (!feature) return false;
    const result = drawingApplicationService.remove(key, {
      beforeRemove: () => reassignDrawingParents([key]),
    });
    if (!result.ok) return false;
    markLayerTreeDirty();
    if (state.selected?.domain === 'drawing' && String(state.selected.id) === key) clearSelection(false);
    renderAll();
    queueAutosave();
    setActionStatus(statusText || `${drawingName(feature)} 지형지물을 삭제했습니다.`, 'success');
    return true;
  }

  function removeHydroEditById(id, statusText = '') {
    const key = String(id);
    const feature = hydroEditById(key);
    if (!feature) return false;
    recordHistory();
    state.hydroEdits = state.hydroEdits.filter(candidate => String(candidate.id) !== key);
    const sourceId = String(feature.properties?.sourceFeatureId || '');
    if (sourceId && !state.hydroEdits.some(candidate => String(candidate.properties?.sourceFeatureId || '') === sourceId)) {
      delete state.physicalSettings.hiddenHydroIds[sourceId];
      gpuMapRenderer.invalidateHydroVisibility();
    }
    markLayerTreeDirty();
    if (state.selected?.domain === 'hydro' && String(state.selected.id) === key) clearSelection(false);
    renderAll();
    queueAutosave();
    const category = hydroCategoryLabel(feature.properties?.category);
    const fallback = hydroFallbackName(feature.properties?.category);
    setActionStatus(statusText || `${hydroEditorName(feature.properties?.name, fallback)}${hydroAccusativeLabel(feature.properties?.category).slice(category.length)} 삭제했습니다.`, 'success');
    return true;
  }

  function removeLabelById(id, statusText = '') {
    const key = String(id);
    const label = state.labels.find(candidate => String(candidate.id) === key);
    if (!label) return false;
    recordHistory();
    state.labels = state.labels.filter(candidate => String(candidate.id) !== key);
    delete state.labelSettings[labelKey('label', key)];
    markLayerTreeDirty();
    if (state.selected?.domain === 'label' && String(state.selected.id) === key) clearSelection(false);
    renderAll();
    queueAutosave();
    setActionStatus(statusText || `${label.name || '지명'} 지명을 삭제했습니다.`, 'success');
    return true;
  }

  function performTerritorialUnitDivisionRemoval(id, action = 'unassigned') {
    const feature = territorialUnitById(id);
    if (!feature) return false;
    const children = territorialChildren(state.territorialUnits, feature.id);
    if (children.length) {
      setActionStatus(`하위 행정구역 ${children.length}개를 먼저 다른 부모로 옮기거나 구분 해제하세요.`, 'error', 4200);
      return false;
    }
    const siblings = territorialSiblings(state.territorialUnits, feature);
    const countryId = String(feature.properties?.sovereignId || '');
    let mergeTarget = null;
    let mergedGeometry = null;
    if (action.startsWith('merge:')) {
      const targetId = action.slice('merge:'.length);
      mergeTarget = siblings.find(candidate => String(candidate.id) === targetId);
      if (!mergeTarget || !territorialUnitsAreAdjacent(feature, mergeTarget)) {
        setActionStatus('합칠 인접 영역을 찾을 수 없어 변경하지 않았습니다.', 'error', 3800);
        return false;
      }
      mergedGeometry = normalizeClippedLandGeometry(window.polygonClipping.union(mergeTarget.geometry.coordinates, feature.geometry.coordinates));
      if (!mergedGeometry) {
        setActionStatus('선택한 영역을 합칠 수 없어 변경하지 않았습니다.', 'error', 3800);
        return false;
      }
    }
    if (action === 'clear-all') {
      const groupIds = new Set([feature, ...siblings].map(candidate => String(candidate.id)));
      if (state.territorialUnits.some(candidate => groupIds.has(String(candidate.properties?.parentId || '')))) {
        setActionStatus('하위 행정구역이 있는 단계는 전체 구분을 해제할 수 없습니다.', 'error', 4200);
        return false;
      }
    }
    recordHistory();
    if (action.startsWith('merge:')) {
      mergeTarget.geometry = mergedGeometry;
      for (const entry of state.distributionEntries) if (entry.mode === DISTRIBUTION_MODES.TERRITORIAL && String(entry.territorialUnitId) === String(feature.id)) entry.territorialUnitId = String(mergeTarget.id);
      state.territorialRelations = state.territorialRelations
        .filter(relation => String(relation.unitId) !== String(feature.id))
        .map(relation => String(relation.parentId) === String(feature.id) ? { ...relation, parentId: String(mergeTarget.id) } : relation);
      state.territorialUnits = state.territorialUnits.filter(candidate => String(candidate.id) !== String(feature.id));
      selectTerritorialUnit(mergeTarget.id, true);
    } else if (action === 'clear-all') {
      const groupIds = new Set([feature, ...siblings].map(candidate => String(candidate.id)));
      state.distributionEntries = state.distributionEntries.filter(entry => entry.mode !== DISTRIBUTION_MODES.TERRITORIAL || !groupIds.has(String(entry.territorialUnitId)));
      state.territorialRelations = state.territorialRelations.filter(relation => !groupIds.has(String(relation.unitId)) && !groupIds.has(String(relation.parentId)));
      state.territorialUnits = state.territorialUnits.filter(candidate => !groupIds.has(String(candidate.id)));
      clearSelection(false);
    } else if (!siblings.length) {
      state.distributionEntries = state.distributionEntries.filter(entry => entry.mode !== DISTRIBUTION_MODES.TERRITORIAL || String(entry.territorialUnitId) !== String(feature.id));
      state.territorialRelations = state.territorialRelations.filter(relation => String(relation.unitId) !== String(feature.id) && String(relation.parentId) !== String(feature.id));
      state.territorialUnits = state.territorialUnits.filter(candidate => String(candidate.id) !== String(feature.id));
      clearSelection(false);
    } else {
      const unassigned = siblings.find(candidate => candidate.properties?.isRemainder === true);
      if (unassigned) {
        unassigned.geometry = normalizeClippedLandGeometry(window.polygonClipping.union(unassigned.geometry.coordinates, feature.geometry.coordinates));
        for (const entry of state.distributionEntries) if (entry.mode === DISTRIBUTION_MODES.TERRITORIAL && String(entry.territorialUnitId) === String(feature.id)) entry.territorialUnitId = String(unassigned.id);
        state.territorialRelations = state.territorialRelations
          .filter(relation => String(relation.unitId) !== String(feature.id))
          .map(relation => String(relation.parentId) === String(feature.id) ? { ...relation, parentId: String(unassigned.id) } : relation);
        state.territorialUnits = state.territorialUnits.filter(candidate => String(candidate.id) !== String(feature.id));
        selectTerritorialUnit(unassigned.id, true);
      } else {
        feature.properties.isRemainder = true;
        feature.properties.name = '';
        feature.properties.notes = '';
        setTerritorialStyleColor(feature, '');
        selectTerritorialUnit(feature.id, true);
      }
    }
    if (countryId) reconcileTerritorialUnitCompleteness([countryId]);
    state.territorialUnits = normalizeTerritorialUnits(state.territorialUnits, { countryExists: key => !!countryFeatureById(key) });
    markLayerTreeDirty();
    renderAll();
    queueAutosave();
    setActionStatus(`${territorialTypeLabel(feature.properties.unitType)} 구분을 안전하게 해제했습니다.`, 'success', 3600);
    return true;
  }

  function requestExplicitTerritorialUnitDelete(feature) {
    const children = territorialChildren(state.territorialUnits, feature.id);
    if (children.length) {
      setActionStatus(`하위 영역 ${children.length}개를 먼저 다른 부모로 옮기거나 삭제해야 합니다.`, 'error', 4200);
      return false;
    }
    openConfirmModal({
      title: '지방 삭제',
      message: `${territorialUnitName(feature)}을(를) 프로젝트에서 삭제합니다. 국가나 다른 영역의 형상은 변경하지 않습니다.`,
      impacts: ['지방 1개 삭제', '국가 및 다른 영역 형상 변경 없음'],
      confirmText: '지방 삭제',
      danger: true,
      onConfirm: () => {
        recordHistory();
        state.territorialUnits = state.territorialUnits.filter(candidate => String(candidate.id) !== String(feature.id));
        state.territorialRelations = state.territorialRelations.filter(relation => String(relation.unitId) !== String(feature.id) && String(relation.parentId) !== String(feature.id));
        state.distributionEntries = state.distributionEntries.filter(entry => entry.mode !== DISTRIBUTION_MODES.TERRITORIAL || String(entry.territorialUnitId) !== String(feature.id));
        markLayerTreeDirty();
        if ((state.selected?.domain === 'territorial' && state.selected.type !== TERRITORIAL_UNIT_TYPES.COUNTRY) && String(state.selected.id) === String(feature.id)) clearSelection(false);
        else renderAll();
        queueAutosave();
        setActionStatus(`${territorialUnitName(feature)} 지방을 삭제했습니다.`, 'success');
      },
    });
    return true;
  }

  function requestTerritorialUnitDivisionRemoval(id) {
    const feature = territorialUnitById(id);
    if (!feature) return;
    if (feature.properties?.locked) {
      setActionStatus('잠금을 해제한 뒤 영역을 삭제할 수 있습니다.', 'error', 3200);
      return;
    }
    if (feature.properties?.coverageMode === TERRITORIAL_COVERAGE_MODES.EXPLICIT) {
      requestExplicitTerritorialUnitDelete(feature);
      return;
    }
    const children = territorialChildren(state.territorialUnits, feature.id);
    if (children.length) {
      setActionStatus(`하위 행정구역 ${children.length}개가 있어 구분을 해제할 수 없습니다.`, 'error', 4200);
      return;
    }
    const label = territorialTypeLabel(feature.properties?.unitType);
    const siblings = territorialSiblings(state.territorialUnits, feature);
    const groupIds = new Set([feature, ...siblings].map(candidate => String(candidate.id)));
    const groupHasChildren = state.territorialUnits.some(candidate => groupIds.has(String(candidate.properties?.parentId || '')));
    const choices = [];
    if (siblings.length && feature.properties?.isRemainder !== true) {
      choices.push({ value: 'unassigned', label: '미지정 영역으로 전환' });
    }
    for (const sibling of siblings.filter(candidate => candidate.properties?.isRemainder !== true && territorialUnitsAreAdjacent(feature, candidate))) {
      choices.push({ value: `merge:${sibling.id}`, label: `${territorialUnitName(sibling)}에 합치기` });
    }
    if (siblings.length && !groupHasChildren) choices.push({ value: 'clear-all', label: '이 단계의 영역 구분 전체 해제' });
    if (siblings.length && !choices.length) {
      setActionStatus('이 영역은 인접 형제에 합치거나 하위 행정구역을 정리한 뒤 구분 해제할 수 있습니다.', 'error', 4400);
      return;
    }
    openConfirmModal({
      title: `${label} 구분 해제`,
      message: siblings.length
        ? `${territorialUnitName(feature)}을(를) 제거한 뒤에도 부모 면적이 완전히 유지되도록 처리 방식을 선택하세요.`
        : `${territorialUnitName(feature)}의 유일한 구분을 해제하고 암시적 전체 국토 상태로 돌아갑니다.`,
      confirmText: '구분 해제',
      danger: true,
      choices,
      onConfirm: action => performTerritorialUnitDivisionRemoval(feature.id, action),
    });
  }

  function deleteTerritorialUnit(type, id) {
    if (type === TERRITORIAL_UNIT_TYPES.COUNTRY) {
      requestDeleteCountry(id);
      return true;
    }
    const feature = territorialUnitById(id);
    if (!feature || feature.properties?.unitType !== type) return false;
    if (territorialChildren(state.territorialUnits, feature.id).length) {
      setActionStatus('하위 영역을 먼저 다른 부모로 옮기거나 삭제해야 합니다.', 'error', 4200);
      return false;
    }
    requestTerritorialUnitDivisionRemoval(id);
    return true;
  }

  function deleteSelected() {
    if (!requireCanonicalData()) return;
    if (!state.selected) {
      setActionStatus('삭제할 객체가 없습니다. 지도에서 객체를 먼저 선택하세요.', 'error');
      return;
    }
    if ((state.selected.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY)) {
      deleteTerritorialUnit(TERRITORIAL_UNIT_TYPES.COUNTRY, state.selected.id);
      return;
    }
    if (state.selected.domain === 'hydro') {
      const feature = hydroFeatureById(state.selected.id);
      const category = hydroCategoryLabel(feature?.properties?.category);
      if (hydroEditById(state.selected.id)) removeHydroEditById(state.selected.id, `선택한 ${hydroAccusativeLabel(feature?.properties?.category)} 삭제했습니다.`);
      else setActionStatus(`내장 ${category}는 삭제할 수 없습니다. 편집용 복사본을 만들어 수정하세요.`, 'error', 3400);
      return;
    }
    if (state.selected.domain === 'drawing') {
      removeDrawingById(state.selected.id, '선택한 객체를 삭제했습니다.');
    } else if (state.selected.domain === 'distribution') {
      deleteDistributionLayer(state.selected.id, { confirm: false });
    } else if ((state.selected.domain === 'territorial' && state.selected.type !== TERRITORIAL_UNIT_TYPES.COUNTRY)) {
      deleteTerritorialUnit(state.selected.type, state.selected.id);
    } else if (state.selected.domain === 'label') {
      removeLabelById(state.selected.id, '선택한 객체를 삭제했습니다.');
    }
  }

  function zoomBy(factor, announce = true) {
    const current = state.projection === 'globe' ? state.view.globeZoom : state.view.flatZoom;
    if (!setMapZoomValue(current * factor)) return false;
    renderViewFrame();
    mapRenderCoordinator.endInteraction('zoom-control-settle');
    queueViewAutosave();
    return true;
  }

  function currentObjectFitInsets() {
    const mapRect = $('map')?.getBoundingClientRect();
    const base = currentMapSafeInsets();
    if (!mapRect?.width || !mapRect?.height) return base;
    const insets = { ...base };
    const panel = $('rightPanel');
    const panelOpen = panel?.classList.contains('mobile-open') && getComputedStyle(panel).visibility !== 'hidden';
    if (!panelOpen) return insets;
    const panelRect = panel.getBoundingClientRect();
    const edge = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-map-edge')) || 12;
    const overlapLeft = Math.max(mapRect.left, panelRect.left);
    const overlapRight = Math.min(mapRect.right, panelRect.right);
    const overlapTop = Math.max(mapRect.top, panelRect.top);
    const overlapBottom = Math.min(mapRect.bottom, panelRect.bottom);
    if (overlapRight <= overlapLeft || overlapBottom <= overlapTop) return insets;
    if (layoutMode === 'mobile') {
      insets.bottom = Math.max(insets.bottom, mapRect.bottom - panelRect.top + edge);
    } else if (panelRect.left >= mapRect.left + mapRect.width / 2) {
      insets.right = Math.max(insets.right, mapRect.right - panelRect.left + edge);
    } else {
      insets.left = Math.max(insets.left, panelRect.right - mapRect.left + edge);
    }
    insets.left = clamp(insets.left, 0, mapRect.width - 96);
    insets.right = clamp(insets.right, 0, mapRect.width - insets.left - 96);
    insets.top = clamp(insets.top, 0, mapRect.height - 96);
    insets.bottom = clamp(insets.bottom, 0, mapRect.height - insets.top - 96);
    return insets;
  }

  function focusCountry(feature, { announce = false, maxZoom = null, preferredAnchor = null } = {}) {
    if (!feature?.geometry && feature?.type !== 'FeatureCollection') return;
    const geometryCenter = d3.geo.centroid(feature);
    const anchor = validLabelAnchor(preferredAnchor) ? preferredAnchor.map(Number) : geometryCenter;
    if (!validLabelAnchor(anchor)) return;
    const { width, height } = state.size;
    const mobile = isMobile();
    const safe = currentObjectFitInsets();
    const contentWidth = Math.max(96, width - safe.left - safe.right);
    const contentHeight = Math.max(96, height - safe.top - safe.bottom);
    if (state.projection === 'globe') {
      state.view.globeRotation = [-anchor[0], -anchor[1], 0];
      state.view.globeZoom = 1;
    } else {
      state.view.flatCenter = [anchor[0], anchor[1]];
      state.view.flatZoom = 1;
    }
    updateProjection();
    let bounds;
    try { bounds = path.bounds(feature); } catch (_) { bounds = null; }
    if (bounds && bounds[0] && bounds[1]) {
      const bw = Math.max(1, Math.abs(bounds[1][0] - bounds[0][0]));
      const bh = Math.max(1, Math.abs(bounds[1][1] - bounds[0][1]));
      const targetW = contentWidth * 0.82;
      const targetH = contentHeight * 0.82;
      const fitted = Math.min(targetW / bw, targetH / bh) * 0.88;
      if (state.projection === 'globe') {
        state.view.globeZoom = clamp(fitted, 1.25, Math.min(ZOOM_LIMITS.globe.max, maxZoom || (mobile ? 9.5 : 8)));
      } else {
        state.view.flatZoom = clamp(fitted, 1.25, Math.min(ZOOM_LIMITS.flat.max, maxZoom || (mobile ? 16 : 13)));
      }
    } else if (state.projection === 'globe') {
      state.view.globeZoom = 3.2;
    } else {
      state.view.flatZoom = 5;
    }
    updateProjection();
    const viewportCenter = [width / 2, height / 2];
    if (validLabelAnchor(preferredAnchor)) {
      alignGeographicAnchor(preferredAnchor, viewportCenter);
    } else {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        let focusedBounds;
        try { focusedBounds = path.bounds(feature); } catch (_) { focusedBounds = null; }
        if (!focusedBounds?.[0] || !focusedBounds?.[1]) break;
        const boundsCenter = [
          (Number(focusedBounds[0][0]) + Number(focusedBounds[1][0])) / 2,
          (Number(focusedBounds[0][1]) + Number(focusedBounds[1][1])) / 2,
        ];
        if (!boundsCenter.every(Number.isFinite)) break;
        const offsetX = viewportCenter[0] - boundsCenter[0];
        const offsetY = viewportCenter[1] - boundsCenter[1];
        if (Math.abs(offsetX) < 0.25 && Math.abs(offsetY) < 0.25) break;
        panMapBy(offsetX, offsetY);
        updateProjection();
      }
    }
    renderAll();
    queueViewAutosave();
  }

  function focusCoordinate(coord, zoom = null) {
    if (!validLabelAnchor(coord)) return;
    if (state.projection === 'globe') {
      state.view.globeRotation = [-Number(coord[0]), -Number(coord[1]), 0];
      state.view.globeZoom = clamp(zoom || Math.max(4.5, state.view.globeZoom), ZOOM_LIMITS.globe.min, ZOOM_LIMITS.globe.max);
    } else {
      state.view.flatCenter = [Number(coord[0]), Number(coord[1])];
      state.view.flatZoom = clamp(zoom || Math.max(6, state.view.flatZoom), ZOOM_LIMITS.flat.min, ZOOM_LIMITS.flat.max);
    }
    renderAll();
    queueViewAutosave();
  }

  function selectLayerTreeItem(group, id, { mode = 'replace', range = false } = {}) {
    const key = String(id);
    if (group === 'hydro' && HYDRO_LAYER_META[key]) {
        if (!state.hydroManifest) loadHydroData(true);
        else {
          const cacheState = state.physicalLoadState.hydroCache;
          if (cacheState === 'error') {
            gpuMapRenderer.retryHydroCache?.();
            setActionStatus('전 세계 강·호수 자료의 오프라인 저장을 다시 시도합니다.', 'working', 0);
          } else {
            const suffix = cacheState === 'ready' ? '오프라인에서도 바로 사용할 수 있습니다.' : `전 세계 강·호수 자료를 백그라운드에서 준비하고 있습니다. ${Math.round(state.physicalLoadState.hydroCachePercent || 0)}%`;
            setActionStatus(suffix, 'success', 3200);
          }
        }
        return false;
    }
    const ref = layerItemObjectRef(group, key);
    if (!ref || !objectRefExists(ref)) return false;
    const orderedRefs = range ? layerTreeItems(group).sort((left, right) => layerNameCollator.compare(left.name, right.name) || layerNameCollator.compare(left.id, right.id)).map(item => layerItemObjectRef(group, item.id)).filter(Boolean) : [];
    return applyObjectSelection(ref, { mode: range ? 'range' : mode, orderedRefs, scope: `layer:${group}` });
  }

  function resetView() {
    if (state.projection === 'globe') {
      state.view.globeZoom = 1;
    } else {
      state.view.flatZoom = 1;
    }
    renderViewFrame();
    mapRenderCoordinator.endInteraction('world-view-settle');
    queueViewAutosave();
  }

  function bindHoldZoom(button, factor) {
    if (!button) return;
    let timer = null;
    let repeater = null;
    let repeated = false;
    let suppressNextClick = false;
    const clear = () => {
      clearTimeout(timer); clearInterval(repeater); timer = repeater = null;
      if (repeated) {
        queueViewAutosave();
        suppressNextClick = true;
      }
      repeated = false;
    };
    button.addEventListener('pointerdown', event => {
      repeated = false;
      suppressNextClick = false;
      button.setPointerCapture?.(event.pointerId);
      timer = setTimeout(() => {
        repeated = true;
        zoomBy(factor, false);
        repeater = setInterval(() => zoomBy(factor, false), 115);
      }, 360);
    });
    button.addEventListener('pointerup', clear);
    button.addEventListener('pointercancel', clear);
    button.addEventListener('lostpointercapture', clear);
    button.addEventListener('click', event => {
      if (suppressNextClick) {
        suppressNextClick = false;
        event.preventDefault();
        return;
      }
      zoomBy(factor, true);
      if (navigator.vibrate && isMobile()) navigator.vibrate(6);
    });
  }

  function bindNavigationUI() {
    document.addEventListener('pointerdown', event => {
      if (!event.target.closest('#notificationCloseBtn')) clearErrorNotification();
    }, true);
    document.addEventListener('click', e => {
      if (!e.target.closest('.top-actions') && !e.target.closest('#mobileFileBtn')) {
        closeFileMenu();
      }
      if (!e.target.closest('#objectActionsMenu') && !e.target.closest('[data-layer-item-menu]')) closeObjectActionsMenu();
      if (!e.target.closest('#objectChooser')) closeObjectChooser();
    });
    $('objectChooserCloseBtn')?.addEventListener('click', () => closeObjectChooser({ restoreFocus: true }));
    $('objectChooserList')?.addEventListener('click', event => {
      const button = event.target.closest('[data-object-chooser-index]');
      const ref = button ? objectChooserCandidates[Number(button.dataset.objectChooserIndex)] : null;
      if (!ref) return;
      applyObjectSelection(ref, { mode: event.ctrlKey || event.metaKey || state.addSelectionMode ? 'toggle' : 'replace', scope: 'map' });
    });
    $('objectChooserList')?.addEventListener('keydown', event => {
      const items = [...event.currentTarget.querySelectorAll('[data-object-chooser-index]')];
      const current = items.indexOf(document.activeElement);
      const delta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
      if (!delta) return;
      event.preventDefault();
      items[(current + delta + items.length) % items.length]?.focus();
    });

    $('globeBtn').addEventListener('click', () => setProjection('globe'));
    $('flatBtn').addEventListener('click', () => setProjection('flat'));

    $('mobileFileBtn')?.addEventListener('click', event => {
      event.stopPropagation();
      toggleFileMenu();
    });
    $('notificationCloseBtn')?.addEventListener('click', clearNotification);
    $('createMenuBtn')?.addEventListener('click', event => {
      event.stopPropagation();
      toggleCreateMenu(event.currentTarget);
    });
    $('mobileBackdrop')?.addEventListener('click', () => {
      closeFileMenu({ restoreFocus: true });
    });
    Object.values(MOBILE_SHEET_IDS).forEach(id => bindMobileSheetSurface($(id)));
    bindHoldZoom($('mobileZoomInBtn'), 1.34);
    bindHoldZoom($('mobileZoomOutBtn'), 0.746);
    $('mobileWorldBtn')?.addEventListener('click', () => {
      resetView();
      if (navigator.vibrate) navigator.vibrate(8);
    });
    $('mobileMapBtn')?.addEventListener('click', event => toggleSurface('layers', event.currentTarget));
    $('mobileCreateBtn')?.addEventListener('click', event => {
      event.stopPropagation();
      toggleSurface('create', event.currentTarget);
    });
    $('mobileEditBtn')?.addEventListener('click', event => toggleSurface('editor', event.currentTarget));
    $('mobileCloseLeftBtn')?.addEventListener('click', () => closeSurface('layers', { restoreFocus: true }));
    $('mobileCloseRightBtn')?.addEventListener('click', () => {
      closeSurface('editor', { manual: layoutMode === 'wide', restoreFocus: true });
    });
    $('mobileCloseCreateBtn')?.addEventListener('click', () => closeCreateMenu({ restoreFocus: true }));
    $('createMenu')?.addEventListener('keydown', event => {
      const items = [...event.currentTarget.querySelectorAll('[role="menuitem"]')];
      const index = items.indexOf(document.activeElement);
      let nextIndex;
      if (event.key === 'ArrowDown') nextIndex = (index + 1 + items.length) % items.length;
      else if (event.key === 'ArrowUp') nextIndex = (index - 1 + items.length) % items.length;
      else if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = items.length - 1;
      else return;
      event.preventDefault();
      items[nextIndex]?.focus();
    });

  }

  function bindLayerUI() {
    createLayerPanelController({
      window,
      elements: {
        visibilityInputs: Object.fromEntries([
          ['countries', 'countriesVisible'], ['territories', 'territoriesVisible'], ['administrative', 'administrativeVisible'],
          ['regions', 'regionsVisible'], ['languages', 'languagesVisible'], ['ethnicities', 'ethnicitiesVisible'],
          ['religions', 'religionsVisible'], ['rivers', 'riversVisible'], ['lakes', 'lakesVisible'], ['drawings', 'drawingsVisible'],
          ['labels', 'labelsVisible'], ['basemapLabels', 'basemapLabelsVisible'],
        ].map(([group, id]) => [group, $(id)])),
        panelTabs: $('mapPanelTabs'),
        layersTab: $('mapLayersTabBtn'),
        viewTab: $('mapViewTabBtn'),
        terrainVisible: $('terrainVisible'),
        terrainStyleInputs: [$('terrainPoliticalRadio'), $('terrainPhysicalRadio')],
        terrainStrength: $('terrainStrengthInput'),
        distributionModeInputs: [$('distributionLayerModeInput'), $('distributionRenderModeInput')],
        distributionBoundaryVisible: $('distributionBoundaryVisibleInput'),
        search: $('layerSearchInput'),
        searchClear: $('layerSearchClearBtn'),
        section: $('layerSection'),
      },
      commands: {
        setLayerVisibility,
        toggleLayerStyle: group => toggleLayerStylePanel(group),
        updateLayerStyle: (group, patch) => updateLayerPresentationStyle(group, patch),
        setDistributionRenderMode: mode => {
          distributionService.setRenderMode(mode);
          syncDistributionPresentationControls();
          renderDistributions();
          queuePresentationAutosave();
        },
        setDistributionBoundaryVisible: visible => {
          distributionService.setBoundaryVisible(visible);
          syncDistributionPresentationControls();
          renderDistributions();
          queuePresentationAutosave();
        },
        setPanelView: setMapPanelView,
        setTerrainVisible: visible => {
          state.physicalSettings.terrainVisible = !!visible;
          gpuMapRenderer.invalidatePhysicalStyle('terrain-visibility');
          syncPhysicalControls();
          markLayerTreeDirty();
          renderLayerTree();
          renderAll();
          queuePresentationAutosave();
        },
        setTerrainStyle: value => {
          state.physicalSettings.terrainStyle = value === 'physical' ? 'physical' : 'political';
          gpuMapRenderer.invalidatePhysicalStyle('terrain-style');
          syncPhysicalControls();
          markLayerTreeDirty();
          renderLayerTree();
          renderAll();
          queuePresentationAutosave();
          setActionStatus(`${state.physicalSettings.terrainStyle === 'physical' ? '지형색 강조' : '국가색 + 음영'} 모드로 전환했습니다.`, 'success', 2200);
        },
        previewTerrainStrength: value => {
          state.physicalSettings.terrainStrength = clamp(Number(value) / 100, 0, 1);
          gpuMapRenderer.invalidatePhysicalStyle('terrain-strength');
          $('terrainStrengthValue').textContent = `${Math.round(state.physicalSettings.terrainStrength * 100)}%`;
          syncRangeProgress($('terrainStrengthInput'));
          scheduleRender();
        },
        commitTerrainStrength: queuePresentationAutosave,
        setSearchValue: value => {
          state.layerSearch = value;
          syncSearchClearButton($('layerSearchInput'), $('layerSearchClearBtn'));
        },
        commitSearch: () => {
          markLayerTreeDirty();
          renderLayerTree();
        },
        openItemMenu: (group, id, trigger) => {
          selectLayerTreeItem(group, id, { mode: 'replace' });
          openObjectActionsMenu(trigger);
        },
        toggleTerritorialUnitFolder: folderKey => {
          if (!folderKey.startsWith(TERRITORIAL_UNIT_FOLDER_STATE_PREFIX)) return;
          state.layerFolders[folderKey] = state.layerFolders[folderKey] === false;
          markLayerTreeDirty();
          renderLayerTree();
        },
        toggleFolder: group => {
          const folderKeys = activeLayerFolderKeys();
          if (!folderKeys.includes(group)) return;
          const willExpand = !state.layerFolders[group];
          for (const key of folderKeys) {
            if (!key.startsWith(TERRITORIAL_UNIT_FOLDER_STATE_PREFIX)) state.layerFolders[key] = false;
          }
          state.layerFolders[group] = willExpand;
          markLayerTreeDirty();
          renderLayerTree();
        },
        selectItem: ({ group, id, additive, range }) => {
          const mode = additive || (isMobile() && state.addSelectionMode) ? 'toggle' : 'replace';
          const selected = selectLayerTreeItem(group, id, { mode, range });
          if (selected && isMobile() && mode === 'replace' && !range) returnToMapAfterMobileAction(true);
        },
        handleScroll: event => {
          closeObjectActionsMenu();
          if (event.target === $('layerSearchResults')) {
            layerSearchScrollTop = event.target.scrollTop;
            if (event.target.dataset.virtualized === 'true' && layerSearchVirtualMatches.length) renderVirtualizedLayerSearch(event.target, layerSearchVirtualMatches, layerSearchScrollTop);
            return;
          }
          const container = event.target.closest?.('.layer-children');
          if (!container) return;
          const folder = container.closest('.layer-folder');
          const group = folder?.dataset.layerGroup;
          const folderKey = folder?.dataset.layerFolderKey || group;
          if (!group || !folderKey) return;
          const scrollTop = container.scrollTop;
          layerGroupScrollTop.set(folderKey, scrollTop);
          const items = layerVirtualItems.get(folderKey);
          if (items && container.dataset.virtualized === 'true') renderVirtualizedLayerGroup(group, container, items, { scrollTop, folderKey });
        },
        syncVisibilityToggle: syncLayerVisibilityToggle,
        setItemVisibility: setLayerItemVisibility,
      },
    }).bind();
  }

  function bindToolUI() {
    $('addCountryBtn')?.addEventListener('click', () => {
      requestDraftDiscard(() => returnToMapAfterMobileAction(enterNewCountryMode(), { fromCreate: true }));
    });
    $('addTerritoryBtn')?.addEventListener('click', () => {
      openTerritorialCreateModal(TERRITORIAL_UNIT_TYPES.TERRITORY);
    });
    $('addAdministrativeBtn')?.addEventListener('click', () => {
      openTerritorialCreateModal(TERRITORIAL_UNIT_TYPES.ADMIN);
    });
    $('addRegionBtn')?.addEventListener('click', () => {
      openTerritorialCreateModal(TERRITORIAL_UNIT_TYPES.REGION);
    });
    const closeDistributionTypeModal = () => {
      $('distributionTypeModal')?.classList.add('hidden');
      $('addDistributionBtn')?.focus();
    };
    $('addDistributionBtn')?.addEventListener('click', () => {
      $('distributionTypeModal')?.classList.remove('hidden');
      requestAnimationFrame(() => $('distributionTypeInput')?.focus());
    });
    $('distributionTypeCancelBtn')?.addEventListener('click', closeDistributionTypeModal);
    $('distributionTypeModal')?.querySelector('.confirm-modal-dim')?.addEventListener('click', closeDistributionTypeModal);
    $('distributionTypeConfirmBtn')?.addEventListener('click', () => {
      const type = $('distributionTypeInput')?.value || DISTRIBUTION_TYPES.LANGUAGE;
      closeDistributionTypeModal();
      requestDraftDiscard(() => {
        discardActiveDraftSilently();
        const created = createDistributionLayerFromPrompt(type);
        if (!created) return;
        closeCreateMenu();
        if (layoutMode !== 'wide') openSurface('editor');
      });
    });
    $('territorialCreateCancelBtn')?.addEventListener('click', closeTerritorialCreateModal);
    $('territorialCreateModal')?.querySelector('.confirm-modal-dim')?.addEventListener('click', closeTerritorialCreateModal);
    $('territorialCreateConfirmBtn')?.addEventListener('click', () => {
      const unitType = pendingTerritorialCreateType;
      const method = $('territorialCreateMethod').value;
      closeTerritorialCreateModal();
      if (!unitType) return;
      if (method === 'geojson') {
        requestDraftDiscard(() => {
          discardActiveDraftSilently();
          requestedVectorTarget = unitType === TERRITORIAL_UNIT_TYPES.ADMIN
            ? 'administrative'
            : unitType === TERRITORIAL_UNIT_TYPES.REGION
              ? 'region'
              : 'territory';
          $('gisFileInput').dataset.returnFocusId = unitType === TERRITORIAL_UNIT_TYPES.ADMIN
            ? 'addAdministrativeBtn'
            : unitType === TERRITORIAL_UNIT_TYPES.REGION
              ? 'addRegionBtn'
              : 'addTerritoryBtn';
          $('gisFileInput').click();
        });
        return;
      }
      requestDraftDiscard(() => {
        const started = method === 'draw' ? enterTerritorialUnitDirectCreate(unitType) : startTerritorialUnitCreate(unitType);
        returnToMapAfterMobileAction(started, { fromCreate: true });
      });
    });
    $('addLabelBtn')?.addEventListener('click', () => {
      requestDraftDiscard(() => returnToMapAfterMobileAction(enterLabelMode(), { fromCreate: true }));
    });
    $('addRiverBtn')?.addEventListener('click', () => {
      requestDraftDiscard(() => returnToMapAfterMobileAction(enterTerrainDrawingMode('river'), { fromCreate: true }));
    });
    $('addLakeBtn')?.addEventListener('click', () => {
      requestDraftDiscard(() => returnToMapAfterMobileAction(enterTerrainDrawingMode('lake'), { fromCreate: true }));
    });
    $('modePrimaryBtn')?.addEventListener('click', () => { void runModePrimaryAction(); });
    $('modeTaskMinimizeBtn')?.addEventListener('click', toggleMapTaskWindow);
    $('modeTaskCloseBtn')?.addEventListener('click', () => $('modeCancelBtn')?.click());
    $('modeLineMethodBtn')?.addEventListener('click', () => requestDraftDiscard(() => switchTerritorySelectionMethod('line')));
    $('modePolygonMethodBtn')?.addEventListener('click', () => requestDraftDiscard(() => switchTerritorySelectionMethod('polygon')));
    $('modeRiverMethodBtn')?.addEventListener('click', () => requestDraftDiscard(() => switchTerritorySelectionMethod('river')));
    $('modeComponentsMethodBtn')?.addEventListener('click', () => requestDraftDiscard(() => switchTerritorySelectionMethod('components')));
    $('modeDraftRedrawBtn')?.addEventListener('click', redrawDraftInput);
    $('modeDraftRemoveLastBtn')?.addEventListener('click', removeLastDraftPoint);
    $('modeDraftDeleteBtn')?.addEventListener('click', deleteSelectedDraftPoint);
    $('modeCancelBtn')?.addEventListener('click', () => {
      requestDraftDiscard(() => {
        if (state.geometryPreview.session) discardActiveGeometryPreview();
        else if (state.labelPlacementMode || state.tool === 'label') exitLabelMode();
        else if (isDrawingDraftTool(state.tool)) cancelDraft(true);
        else cancelActiveMode();
      });
    });
    $('annexTerritoryBtn')?.addEventListener('click', () => {
      if (!(state.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY)) return;
      requestDraftDiscard(() => {
        if (state.tool === 'annex-territory' && state.annexTargetCountryId === state.selected.id) cancelActiveMode();
        else returnToMapAfterMobileAction(enterAnnexTerritoryMode(state.selected.id));
      });
    });
    $('editBorderBtn')?.addEventListener('click', () => {
      if (!(state.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY)) return;
      requestDraftDiscard(() => {
        if (state.tool === 'country-border' && state.boundaryEditPhase === 'editing') finishCountryBorderEdit();
        else returnToMapAfterMobileAction(enterCountryBorderSelection(state.selected.id));
      });
    });
    $('editCoastBtn')?.addEventListener('click', () => {
      if (!(state.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY)) return;
      requestDraftDiscard(() => {
        if (state.tool === 'country-coast' && state.coastEditCountryId === state.selected.id) finishCountryCoastEdit();
        else returnToMapAfterMobileAction(enterCountryCoastEdit(state.selected.id));
      });
    });
    $('mergeCountryBtn')?.addEventListener('click', () => {
      if ((state.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY)) requestDraftDiscard(() => returnToMapAfterMobileAction(enterMergeCountryMode(state.selected.id)));
    });
    $('resetViewBtn').addEventListener('click', resetView);
  }

  function bindChangeFields(definitions) {
    for (const { id, field, commit, transform = value => value } of definitions) {
      $(id).addEventListener('change', event => commit(field, transform(event.target.value)));
    }
  }

  function bindEditorFields() {
    bindColorPickers();
    bindChangeFields([
      { id: 'countryNameInput', field: 'name', commit: commitCountryEdit, transform: value => value.trim() },
      { id: 'capitalInput', field: 'capital', commit: commitCountryEdit, transform: value => value.trim() },
      { id: 'notesInput', field: 'notes', commit: commitCountryEdit },
      { id: 'drawingNameInput', field: 'name', commit: commitDrawingMeta, transform: value => value.trim() },
      { id: 'drawingOwnerInput', field: 'pandolab_owner_id', commit: commitDrawingMeta },
      { id: 'drawingParentInput', field: 'pandolab_parent_id', commit: commitDrawingMeta },
      { id: 'drawingLandBindingInput', field: 'pandolab_land_binding', commit: commitDrawingMeta },
      { id: 'drawingNotesInput', field: 'notes', commit: commitDrawingMeta },
      { id: 'hydroNameInput', field: 'name', commit: commitHydroEdit, transform: value => value.trim() },
      { id: 'hydroNotesInput', field: 'notes', commit: commitHydroEdit },
      { id: 'territoryNameInput', field: 'name', commit: commitTerritorialUnitMeta, transform: value => value.trim() },
      { id: 'territoryCountryInput', field: 'sovereignId', commit: commitTerritorialUnitMeta },
      { id: 'territoryNotesInput', field: 'notes', commit: commitTerritorialUnitMeta },
      { id: 'administrativeNameInput', field: 'name', commit: commitTerritorialUnitMeta, transform: value => value.trim() },
      { id: 'administrativeCountryInput', field: 'sovereignId', commit: commitTerritorialUnitMeta },
      { id: 'administrativeParentInput', field: 'parentId', commit: commitTerritorialUnitMeta },
      { id: 'administrativeNotesInput', field: 'notes', commit: commitTerritorialUnitMeta },
      { id: 'regionNameInput', field: 'name', commit: commitTerritorialUnitMeta, transform: value => value.trim() },
      { id: 'regionCountryInput', field: 'sovereignId', commit: commitTerritorialUnitMeta },
      { id: 'regionParentInput', field: 'parentId', commit: commitTerritorialUnitMeta },
      { id: 'regionValidFromInput', field: 'validFrom', commit: commitTerritorialUnitMeta, transform: value => value.trim() },
      { id: 'regionValidToInput', field: 'validTo', commit: commitTerritorialUnitMeta, transform: value => value.trim() },
      { id: 'regionNotesInput', field: 'notes', commit: commitTerritorialUnitMeta },
      { id: 'distributionNameInput', field: 'name', commit: commitDistributionMeta, transform: value => value.trim() },
      { id: 'distributionParentInput', field: 'parentId', commit: commitDistributionMeta },
      { id: 'labelNameInput', field: 'name', commit: commitLabelEdit, transform: value => value.trim() },
      { id: 'labelKindInput', field: 'kind', commit: commitLabelEdit },
      { id: 'labelNotesInput', field: 'notes', commit: commitLabelEdit },
    ]);
    $('distributionLockedInput').addEventListener('change', event => commitDistributionMeta('locked', event.target.checked));
    $('distributionEntryList').addEventListener('click', event => {
      const button = event.target.closest('[data-distribution-entry-delete]');
      if (button) removeDistributionEntry(button.dataset.distributionEntryDelete);
    });
    $('addTerritorialDistributionBtn').addEventListener('click', addTerritorialDistributionEntry);
    $('addGeometryDistributionBtn').addEventListener('click', () => requestDraftDiscard(() => returnToMapAfterMobileAction(startGeometryDistributionDraft())));
    $('deleteDistributionBtn').addEventListener('click', () => state.selected?.domain === 'distribution' && deleteDistributionLayer(state.selected.id));
    $('flagUploadBtn').addEventListener('click', () => $('flagFileInput').click());
    $('flagFileInput').addEventListener('change', e => {
      const file = e.target.files?.[0];
      if (!file || !(state.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY)) return;
      const reader = new FileReader();
      reader.onload = () => commitCountryEdit('flagDataUrl', reader.result);
      reader.readAsDataURL(file);
      e.target.value = '';
    });
    $('flagRemoveBtn').addEventListener('click', () => commitCountryEdit('flagDataUrl', null));
    $('removeTerritoryDivisionBtn').addEventListener('click', () => (state.selected?.domain === 'territorial' && state.selected.type !== TERRITORIAL_UNIT_TYPES.COUNTRY) && requestTerritorialUnitDivisionRemoval(state.selected.id));
    $('removeAdministrativeDivisionBtn').addEventListener('click', () => (state.selected?.domain === 'territorial' && state.selected.type !== TERRITORIAL_UNIT_TYPES.COUNTRY) && requestTerritorialUnitDivisionRemoval(state.selected.id));
    $('splitTerritoryBtn').addEventListener('click', () => (state.selected?.domain === 'territorial' && state.selected.type !== TERRITORIAL_UNIT_TYPES.COUNTRY) && requestDraftDiscard(() => returnToMapAfterMobileAction(enterTerritorialUnitSplitMode(state.selected.id))));
    $('splitAdministrativeBtn').addEventListener('click', () => (state.selected?.domain === 'territorial' && state.selected.type !== TERRITORIAL_UNIT_TYPES.COUNTRY) && requestDraftDiscard(() => returnToMapAfterMobileAction(enterTerritorialUnitSplitMode(state.selected.id))));
    $('mergeTerritoryBtn').addEventListener('click', () => (state.selected?.domain === 'territorial' && state.selected.type !== TERRITORIAL_UNIT_TYPES.COUNTRY) && requestDraftDiscard(() => returnToMapAfterMobileAction(enterTerritorialUnitMergeMode(state.selected.id))));
    $('mergeAdministrativeBtn').addEventListener('click', () => (state.selected?.domain === 'territorial' && state.selected.type !== TERRITORIAL_UNIT_TYPES.COUNTRY) && requestDraftDiscard(() => returnToMapAfterMobileAction(enterTerritorialUnitMergeMode(state.selected.id))));
    $('mergeRegionBtn').addEventListener('click', () => (state.selected?.domain === 'territorial' && state.selected.type !== TERRITORIAL_UNIT_TYPES.COUNTRY) && requestDraftDiscard(() => returnToMapAfterMobileAction(enterTerritorialUnitMergeMode(state.selected.id))));
    $('reassignTerritoryShapeBtn').addEventListener('click', () => (state.selected?.domain === 'territorial' && state.selected.type !== TERRITORIAL_UNIT_TYPES.COUNTRY) && requestDraftDiscard(() => returnToMapAfterMobileAction(enterTerritorialUnitRedrawMode(state.selected.id))));
    $('reassignAdministrativeShapeBtn').addEventListener('click', () => (state.selected?.domain === 'territorial' && state.selected.type !== TERRITORIAL_UNIT_TYPES.COUNTRY) && requestDraftDiscard(() => returnToMapAfterMobileAction(enterTerritorialUnitRedrawMode(state.selected.id))));
    $('reconcileAdministrativeCoastBtn').addEventListener('click', () => {
      if (!(state.selected?.domain === 'territorial' && state.selected.type !== TERRITORIAL_UNIT_TYPES.COUNTRY)) return;
      const feature = territorialUnitById(state.selected.id);
      if (feature?.properties?.unitType !== TERRITORIAL_UNIT_TYPES.ADMIN || feature.properties?.locked === true) return;
      reconcileAdminCountryCoast(state.selected.id);
    });
    $('reassignRegionShapeBtn').addEventListener('click', () => (state.selected?.domain === 'territorial' && state.selected.type !== TERRITORIAL_UNIT_TYPES.COUNTRY) && requestDraftDiscard(() => returnToMapAfterMobileAction(enterTerritorialUnitRedrawMode(state.selected.id))));
    $('promoteTerritoryBtn').addEventListener('click', () => (state.selected?.domain === 'territorial' && state.selected.type !== TERRITORIAL_UNIT_TYPES.COUNTRY) && requestTerritorialUnitPromotion(state.selected.id));
    $('promoteAdministrativeBtn').addEventListener('click', () => (state.selected?.domain === 'territorial' && state.selected.type !== TERRITORIAL_UNIT_TYPES.COUNTRY) && requestTerritorialUnitPromotion(state.selected.id));
    $('changeCountryTypeBtn').addEventListener('click', () => (state.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY)
      && openTerritorialTypeModal(TERRITORIAL_UNIT_TYPES.COUNTRY, state.selected.id));
    $('changeTerritoryTypeBtn').addEventListener('click', () => (state.selected?.domain === 'territorial' && state.selected.type !== TERRITORIAL_UNIT_TYPES.COUNTRY)
      && openTerritorialTypeModal(TERRITORIAL_UNIT_TYPES.TERRITORY, state.selected.id));
    $('changeAdministrativeTypeBtn').addEventListener('click', () => (state.selected?.domain === 'territorial' && state.selected.type !== TERRITORIAL_UNIT_TYPES.COUNTRY)
      && openTerritorialTypeModal(TERRITORIAL_UNIT_TYPES.ADMIN, state.selected.id));
    $('territorialTypeInput').addEventListener('change', syncTerritorialTypeModal);
    $('territorialTypeSovereignInput').addEventListener('change', syncTerritorialTypeModal);
    $('territorialTypeParentInput').addEventListener('change', syncTerritorialTypeModal);
    $('territorialTypeCancelBtn').addEventListener('click', closeTerritorialTypeModal);
    $('territorialTypeModal').querySelector('.confirm-modal-dim')?.addEventListener('click', closeTerritorialTypeModal);
    $('territorialTypeConfirmBtn').addEventListener('click', confirmTerritorialTypeConversion);
    $('transferTerritoryBtn').addEventListener('click', () => {
      setEditorShellView('info');
      $('territoryCountryInput').focus();
      setActionStatus('소속 국가 목록에서 이전할 국가를 선택하세요. 실제 국경 변경 전에 확인합니다.', 'success', 3400);
    });
    $('transferAdministrativeBtn').addEventListener('click', () => {
      setEditorShellView('info');
      $('administrativeCountryInput').focus();
      setActionStatus('소속 국가 목록에서 이전할 국가를 선택하세요. 실제 국경 변경 전에 확인합니다.', 'success', 3400);
    });
    $('transferRegionBtn').addEventListener('click', () => {
      setEditorShellView('info');
      $('regionCountryInput').focus();
      setActionStatus('주권 국가와 상위 영역을 확인한 뒤 변경하세요.', 'success', 3400);
    });

    $('editDrawingBoundaryBtn').addEventListener('click', () => {
      if (state.selected?.domain !== 'drawing') return;
      const primary = objectSelection.primary();
      if (primary) focusObjectRef(primary);
      returnToMapAfterMobileAction(true);
      setActionStatus('지도 위 꼭짓점을 드래그해 경계를 수정하세요.', 'success', 3400);
    });

    $('splitDrawingBtn').addEventListener('click', () => {
      if (state.selected?.domain === 'drawing') requestDraftDiscard(() => returnToMapAfterMobileAction(enterDrawingSplitMode(state.selected.id)));
    });
    $('mergeDrawingBtn').addEventListener('click', () => {
      if (state.selected?.domain === 'drawing') requestDraftDiscard(() => returnToMapAfterMobileAction(enterDrawingMergeMode(state.selected.id)));
    });
    $('syncDrawingCoastBtn').addEventListener('click', alignSelectedDrawingToOwnerLand);
    $('editDrawingCoastBtn').addEventListener('click', () => {
      if (state.selected?.domain !== 'drawing') return;
      const feature = state.drawings.find(item => String(item.id) === String(state.selected.id));
      const ownerId = String(feature?.properties?.pandolab_owner_id || '');
      if (!countryFeatureById(ownerId)) return;
      requestDraftDiscard(() => returnToMapAfterMobileAction(enterCountryCoastEdit(ownerId, { scopeDrawingId: feature.id, returnSelection: { type: 'drawing', id: String(feature.id) } })));
    });
    $('applyDrawingToCountryBtn').addEventListener('click', () => openConfirmModal({
      title: '국가 영토에 반영',
      message: '선택한 영역과 겹치는 다른 국가의 영토를 소유 국가로 이전합니다. 한 번의 실행취소로 복구할 수 있습니다.',
      impacts: ['소유 국가와 겹치는 국가들의 실제 국경 변경', '선택 지형지물은 유지'],
      confirmText: '영토 반영',
      onConfirm: applySelectedDrawingToOwnerCountry,
    }));
    $('promoteDrawingToCountryBtn').addEventListener('click', () => openConfirmModal({
      title: '국가로 전환',
      message: '선택한 영역을 기존 국가들에서 분리해 새 국가로 전환합니다. 객체 이름을 새 국명으로 사용합니다.',
      impacts: ['새 국가 1개 생성', '겹치는 기존 국가들의 실제 국경 변경', '선택 지형지물 제거'],
      confirmText: '국가로 전환',
      onConfirm: promoteSelectedDrawingToCountry,
    }));

    $('deleteLabelBtn').addEventListener('click', deleteSelected);
    $('copyHydroBtn').addEventListener('click', copySelectedHydroForEditing);
    $('deleteHydroEditBtn').addEventListener('click', deleteSelected);
    $('deleteDrawingInlineBtn')?.addEventListener('click', deleteSelected);

    $('undoBtn').addEventListener('click', undo);
    $('redoBtn').addEventListener('click', redo);
    $('zoomOutBtn')?.addEventListener('click', () => zoomBy(0.8));
    $('zoomInBtn')?.addEventListener('click', () => zoomBy(1.25));

    $('togglePanelBtn').addEventListener('click', toggleEditorPanel);
    $('editorTabBtn')?.addEventListener('click', () => setEditorShellView('info'));
    $('actionsTabBtn')?.addEventListener('click', () => setEditorShellView('actions'));
    document.querySelector('.editor-view-tabs')?.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const actions = event.key === 'ArrowRight' || event.key === 'End';
      setEditorShellView(actions ? 'actions' : 'info');
      $(actions ? 'actionsTabBtn' : 'editorTabBtn')?.focus();
    });
    $('focusSelectedObjectBtn')?.addEventListener('click', () => objectSelection.primary() && focusObjectRef(objectSelection.primary()));
    $('objectLockBtn')?.addEventListener('click', batchToggleLocked);
    $('objectDeleteBtn')?.addEventListener('click', deleteSelectedFromObjectMenu);
    $('objectLockMenuBtn')?.addEventListener('click', () => { closeObjectActionsMenu(); batchToggleLocked(); });
    $('objectCoastReconcileMenuBtn')?.addEventListener('click', () => {
      const primary = objectSelection.primary();
      closeObjectActionsMenu();
      if (primary?.domain !== 'territorial' || primary.type !== TERRITORIAL_UNIT_TYPES.ADMIN) return;
      if (territorialUnitById(primary.id)?.properties?.locked === true) return;
      reconcileAdminCountryCoast(primary.id);
    });
    $('objectDeleteMenuBtn')?.addEventListener('click', deleteSelectedFromObjectMenu);
    $('objectActionsMenu')?.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeObjectActionsMenu({ restoreFocus: true }); return; }
      const items = [...event.currentTarget.querySelectorAll('[role="menuitem"]:not(.hidden):not(:disabled)')];
      const current = items.indexOf(document.activeElement);
      const delta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
      if (!delta || !items.length) return;
      event.preventDefault();
      items[(current + delta + items.length) % items.length]?.focus();
    });
    $('multiPropertiesVisibilityInput')?.addEventListener('change', event => batchSetVisibility(event.target.checked));
    $('multiPropertiesLockInput')?.addEventListener('change', event => batchSetLocked(event.target.checked));
    $('multiBorderEditBtn')?.addEventListener('click', () => requestDraftDiscard(() => returnToMapAfterMobileAction(enterCountryBorderEditFromSelection())));
    $('multiSelectionModeBtn')?.addEventListener('click', () => {
      if (!isMobile() || objectSelection.size() === 0) return;
      state.addSelectionMode = !state.addSelectionMode;
      syncSelectionSummary();
      syncMapContextSurfaces();
    });
    $('clearMultiSelectionBtn')?.addEventListener('click', () => clearSelection(false));
    $('multiEditBtn')?.addEventListener('click', () => { setEditorShellView('info'); openSelectionEditor(); });

  }

  function bindFileAndGisUI() {
    const openShortcutHelp = trigger => {
      if (!shortcutHelpReturnFocus) {
        shortcutHelpReturnFocus = trigger?.closest?.('.top-actions') ? $('mobileFileBtn') : trigger;
      }
      closeFileMenu();
      $('shortcutHelpModal').classList.remove('hidden');
      requestAnimationFrame(() => $('shortcutHelpCloseBtn').focus());
    };
    $('keyboardHelpBtn')?.addEventListener('click', event => openShortcutHelp(event.currentTarget));
    const closeShortcutHelp = () => {
      $('shortcutHelpModal').classList.add('hidden');
      const returnFocus = shortcutHelpReturnFocus?.isConnected ? shortcutHelpReturnFocus : $('mobileFileBtn');
      shortcutHelpReturnFocus = null;
      returnFocus?.focus({ preventScroll: true });
    };
    $('shortcutHelpCloseBtn')?.addEventListener('click', closeShortcutHelp);
    $('shortcutHelpModal')?.querySelector('.confirm-modal-dim')?.addEventListener('click', closeShortcutHelp);
    historicalLibraryController.connect();
    $('saveProjectBtn').addEventListener('click', saveGeoPackageFile);
    $('openGisBtn').addEventListener('click', () => {
      $('gisFileInput').dataset.returnFocusId = 'openGisBtn';
      $('gisFileInput').click();
    });
    $('gisFileInput').addEventListener('change', async e => {
      const files = [...(e.target.files || [])];
      e.target.value = '';
      await openGisFiles(files);
    });

    $('newProjectBtn').addEventListener('click', requestNewProject);
    confirmModalController.bind();
    coastReconciliationController.bind();

    $('dataExportBtn').addEventListener('click', openGisDataExport);
    const preferencesModal = $('preferencesModal');
    let preferencesOrigin = null;
    const syncPreferencesForm = () => {
      $('preferencesThemeInput').value = userPreferences.appearance.theme;
      $('preferencesCountryLabelFontInput').value = userPreferences.labels.country.font;
      $('preferencesPlaceLabelFontInput').value = userPreferences.labels.place.font;
      $('preferencesSelectionColorInput').value = resolvedInteractionStyle.selection.color;
      $('preferencesSelectionOutlineInput').checked = userPreferences.selection.outlineVisible;
      $('preferencesSelectionFillStrengthInput').value = String(Math.round(userPreferences.selection.fillStrength * 100));
      $('preferencesSelectionFillStrengthValue').value = `${Math.round(userPreferences.selection.fillStrength * 100)}%`;
      syncColorPicker('preferencesSelection', {
        value: userPreferences.selection.color || resolvedInteractionStyle.selection.color,
        defaultColor: preferenceDefaultColor('preferencesSelection'),
        isDefault: !userPreferences.selection.color,
      });
      syncColorPicker('preferencesCountryLabel', {
        value: userPreferences.labels.country.color || preferenceDefaultColor('preferencesCountryLabel'),
        defaultColor: preferenceDefaultColor('preferencesCountryLabel'),
        isDefault: !userPreferences.labels.country.color,
      });
      syncColorPicker('preferencesPlaceLabel', {
        value: userPreferences.labels.place.color || preferenceDefaultColor('preferencesPlaceLabel'),
        defaultColor: preferenceDefaultColor('preferencesPlaceLabel'),
        isDefault: !userPreferences.labels.place.color,
      });
      syncColorPicker('preferencesPlacePoint', {
        value: userPreferences.labels.place.pointColor || preferenceDefaultColor('preferencesPlacePoint'),
        defaultColor: preferenceDefaultColor('preferencesPlacePoint'),
        isDefault: !userPreferences.labels.place.pointColor,
      });
    };
    const preferencesFromForm = () => ({
      version: userPreferences.version,
      appearance: { theme: $('preferencesThemeInput').value },
      labels: {
        country: { ...userPreferences.labels.country, font: $('preferencesCountryLabelFontInput').value },
        place: { ...userPreferences.labels.place, font: $('preferencesPlaceLabelFontInput').value },
      },
      selection: {
        ...userPreferences.selection,
        outlineVisible: $('preferencesSelectionOutlineInput').checked,
        fillStrength: Number($('preferencesSelectionFillStrengthInput').value) / 100,
      },
    });
    const applyPreferencesForm = () => {
      applyUserPreferences(preferencesFromForm());
      syncPreferencesForm();
    };
    const closePreferences = ({ restoreFocus = true, revert = false } = {}) => {
      if (!preferencesModal || preferencesModal.classList.contains('hidden')) return;
      if (revert && preferencesOrigin) applyUserPreferences(preferencesOrigin);
      preferencesOrigin = null;
      preferencesModal.classList.add('hidden');
      if (restoreFocus) $('preferencesBtn')?.focus({ preventScroll: true });
    };
    const openPreferences = () => {
      syncPreferencesForm();
      preferencesOrigin = structuredClone(userPreferences);
      preferencesModal?.classList.remove('hidden');
      $('preferencesThemeInput')?.focus({ preventScroll: true });
    };
    $('preferencesBtn')?.addEventListener('click', openPreferences);
    $('preferencesCloseBtn')?.addEventListener('click', () => closePreferences({ revert: true }));
    $('preferencesCancelBtn')?.addEventListener('click', () => closePreferences({ revert: true }));
    preferencesModal?.querySelector('.ui-dialog-backdrop')?.addEventListener('click', () => closePreferences({ revert: true }));
    $('preferencesResetBtn')?.addEventListener('click', () => {
      applyUserPreferences(defaultUserPreferences());
      syncPreferencesForm();
    });
    $('preferencesThemeInput')?.addEventListener('change', applyPreferencesForm);
    $('preferencesCountryLabelFontInput')?.addEventListener('change', applyPreferencesForm);
    $('preferencesPlaceLabelFontInput')?.addEventListener('change', applyPreferencesForm);
    $('preferencesSelectionOutlineInput')?.addEventListener('change', applyPreferencesForm);
    $('preferencesSelectionFillStrengthInput')?.addEventListener('input', applyPreferencesForm);
    $('preferencesApplyBtn')?.addEventListener('click', () => closePreferences({ revert: false }));
    $('gisExportCloseBtn').addEventListener('click', closeGisDataExport);
    $('gisExportCancelBtn').addEventListener('click', closeGisDataExport);
    $('gisExportModal').querySelector('.ui-dialog-backdrop')?.addEventListener('click', closeGisDataExport);
    $('gisExportBackBtn').addEventListener('click', () => setGisExportStep(0, { focus: true }));
    $('gisExportNextBtn').addEventListener('click', () => {
      const counts = gisExportCounts();
      if (!selectedGisExportLayers().some(layer => counts[layer] > 0)) {
        $('gisExportError').textContent = '내보낼 데이터가 있는 범주를 하나 이상 선택하세요.';
        $('gisExportError').classList.remove('hidden');
        return;
      }
      $('gisExportError').classList.add('hidden');
      setGisExportStep(1, { focus: true });
    });
    $('gisExportConfirmBtn').addEventListener('click', confirmGisDataExport);
    $('gisExportFormat').addEventListener('change', updateGisExportSummary);
    $('gisExportForm').querySelector('.gis-export-layers')?.addEventListener('change', updateGisExportSummary);
    const fileMenu = document.querySelector('.top-actions');
    const visibleFileMenuItems = () => [...(fileMenu?.querySelectorAll('[role="menuitem"]:not(:disabled)') || [])]
      .filter(item => !item.closest('.hidden'));
    fileMenu?.addEventListener('keydown', event => {
      const active = document.activeElement;
      if (event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        closeFileMenu({ restoreFocus: true });
        return;
      }
      const items = visibleFileMenuItems();
      if (!items.length) return;
      let targetIndex = -1;
      const currentIndex = items.indexOf(active);
      if (event.key === 'ArrowDown') targetIndex = (currentIndex + 1 + items.length) % items.length;
      else if (event.key === 'ArrowUp') targetIndex = (currentIndex - 1 + items.length) % items.length;
      else if (event.key === 'Home') targetIndex = 0;
      else if (event.key === 'End') targetIndex = items.length - 1;
      if (targetIndex < 0) return;
      event.preventDefault();
      items[targetIndex]?.focus();
    });
    fileMenu?.addEventListener('click', e => {
      const button = e.target.closest('button');
      if (!button) return;
      setTimeout(() => {
        closeFileMenu();
      }, 80);
    });
    document.addEventListener('pandolab:restore-file-menu-focus', event => {
      const target = document.getElementById(String(event.detail?.targetId || ''));
      if (layoutMode === 'wide' || !target || !fileMenu?.contains(target)) return;
      event.preventDefault();
      requestAnimationFrame(() => {
        fileMenuTrigger = $('mobileFileBtn');
        fileMenu.classList.add('mobile-open');
        syncOverlayState();
        requestAnimationFrame(() => target.focus({ preventScroll: true }));
      });
    });

  }

  function bindGlobalInputUI() {
    document.addEventListener('keydown', e => {
      const tag = document.activeElement?.tagName;
      const editingText = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag);
      if (e.key === '?' && !editingText) {
        e.preventDefault();
        shortcutHelpReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : $('map');
        $('keyboardHelpBtn')?.click();
        return;
      }
      if (e.code === 'Space' && !editingText && (draftInputActive() || ['country-border', 'country-coast'].includes(state.tool) || state.selected?.domain === 'drawing' || (state.selected?.domain === 'hydro' && hydroEditById(state.selected.id)))) {
        state.spacePanActive = true;
        $('map')?.classList.add('space-pan-active');
        state.draftEdit.insertTarget = null;
        renderDraftInsertionHandle();
        e.preventDefault();
        return;
      }
      if (e.key === 'Escape') {
        if (state.modeProcessing) { e.preventDefault(); return; }
        if (!$('shortcutHelpModal')?.classList.contains('hidden')) { $('shortcutHelpCloseBtn')?.click(); return; }
        if (!$('preferencesModal')?.classList.contains('hidden')) { $('preferencesCancelBtn')?.click(); return; }
        if (!$('objectChooser')?.classList.contains('hidden')) { closeObjectChooser({ restoreFocus: true }); return; }
        if (!$('objectActionsMenu')?.classList.contains('hidden')) { closeObjectActionsMenu({ restoreFocus: true }); return; }
        if (historicalLibraryController.isOpen()) { historicalLibraryController.close(); return; }
        if (!$('territorialTypeModal')?.classList.contains('hidden')) { closeTerritorialTypeModal(); return; }
        if (!$('distributionTypeModal')?.classList.contains('hidden')) { $('distributionTypeCancelBtn')?.click(); return; }
        if (!$('territorialCreateModal')?.classList.contains('hidden')) { closeTerritorialCreateModal(); return; }
        if (!$('gisImportModal')?.classList.contains('hidden')) { $('gisImportCancelBtn')?.click(); return; }
        if (!$('gisExportModal')?.classList.contains('hidden')) { closeGisDataExport(); return; }
        if (confirmModalController.isOpen()) { closeConfirmModal(); return; }
        if (document.body.classList.contains('file-menu-open')) { closeFileMenu({ restoreFocus: true }); return; }
        if (isCreateMenuOpen()) { closeCreateMenu({ restoreFocus: true }); return; }
        if (state.geometryPreview.session) { discardActiveGeometryPreview(); return; }
        if (state.labelPlacementMode) exitLabelMode();
        else if (draftInputActive()) requestDraftDiscard(() => isDrawingDraftTool(state.tool) ? cancelDraft(true) : cancelActiveMode());
        else if (['new-country', 'annex-territory', 'merge-country', 'merge-drawing', 'country-border', 'country-coast'].includes(state.tool)) cancelActiveMode();
        else if (state.draftCoords.length) cancelDraft(true);
        else if ($('rightPanel')?.classList.contains('mobile-open')) {
          closeSurface('editor', { manual: layoutMode === 'wide', restoreFocus: true });
        }
        else if (layoutMode !== 'wide' && $('leftPanel')?.classList.contains('mobile-open')) closeSurface('layers', { restoreFocus: true });
        else if (!$('actionStatus')?.classList.contains('hidden')) clearNotification();
        else clearSelection();
      }
      const newCountryLineMode = state.tool === 'new-country' && state.newCountryPhase === 'line';
      const newCountrySourceMode = state.tool === 'new-country' && state.newCountryPhase === 'sources';
      const newCountrySideMode = state.tool === 'new-country' && state.newCountryPhase === 'side';
      const newCountryComponentsMode = state.tool === 'new-country' && state.newCountryPhase === 'components';
      const annexDonorMode = state.tool === 'annex-territory' && state.annexPhase === 'donor';
      const annexSideMode = state.tool === 'annex-territory' && state.annexPhase === 'side';
      const annexRiverPartitionMode = state.tool === 'annex-territory' && state.annexPhase === 'river-partitions';
      const annexPolygonPreviewMode = state.tool === 'annex-territory' && state.annexPhase === 'polygon-preview';
      const annexComponentsMode = state.tool === 'annex-territory' && state.annexPhase === 'components';
      const mergeTargetMode = state.tool === 'merge-country' && !!state.mergeSourceCountryId;
      const boundarySelectMode = state.tool === 'country-border' && state.boundaryEditPhase === 'selecting';
      if (e.key === 'Enter' && !editingText && state.geometryPreview.session) {
        e.preventDefault();
        applyActiveGeometryPreview();
        return;
      }
      if (e.key === 'Enter' && !editingText && (newCountrySourceMode || annexDonorMode || mergeTargetMode || boundarySelectMode)) {
        e.preventDefault();
        if (newCountrySourceMode) beginNewCountryLine();
        else if (annexDonorMode) beginAnnexSelection();
        else if (mergeTargetMode) completeCountryMerge();
        else beginCountryBorderEditing();
        return;
      }
      if (e.key === 'Enter' && !editingText && (newCountrySideMode || annexSideMode || annexRiverPartitionMode || annexPolygonPreviewMode || newCountryComponentsMode || annexComponentsMode)) {
        e.preventDefault();
        if (newCountrySideMode) completeNewCountryCreation(state.newCountrySelectedCandidateIndex);
        else if (newCountryComponentsMode) completeNewCountryCreation(null);
        else if (annexSideMode) completeLinearAnnexation(state.annexSelectedCandidateIndex);
        else if (annexRiverPartitionMode) completeLinearAnnexation(null);
        else if (annexPolygonPreviewMode) completeLinearAnnexation(0);
        else completeLinearAnnexation(null);
        return;
      }
      if (e.key === 'Enter' && !editingText && (isDrawingDraftTool(state.tool) || newCountryLineMode || (state.tool === 'annex-territory' && ['line', 'polygon'].includes(state.annexPhase))) && state.draftCoords.length) {
        e.preventDefault(); finishDraft();
      }
      if (!editingText && Number.isInteger(state.draftEdit.selectedVertexIndex) && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && draftInputActive()) {
        const distance = e.shiftKey ? 10 : 1;
        const offsets = {
          ArrowLeft: [-distance, 0],
          ArrowRight: [distance, 0],
          ArrowUp: [0, -distance],
          ArrowDown: [0, distance],
        };
        e.preventDefault();
        moveSelectedDraftPointByPixels(...offsets[e.key]);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault(); saveGeoPackageFile();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey && !editingText) {
        e.preventDefault(); undo();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) && !editingText) {
        e.preventDefault(); redo();
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !editingText) {
        if (draftInputActive()) {
          e.preventDefault();
          deleteSelectedDraftPoint();
          return;
        }
        if (state.selected) {
          e.preventDefault();
          if (objectSelection.size() > 1) requestBatchDelete();
          else deleteSelected();
        }
      }
    });

    document.addEventListener('keyup', e => {
      if (e.code !== 'Space') return;
      state.spacePanActive = false;
      $('map')?.classList.remove('space-pan-active');
    });
    window.addEventListener('blur', () => {
      state.spacePanActive = false;
      $('map')?.classList.remove('space-pan-active');
    });

    window.addEventListener('resize', () => {
      closeObjectActionsMenu();
      const layoutChanged = applyLayoutMode();
      if (!layoutChanged) {
        refreshMapSheetMetrics();
        queueMapResize();
      }
    });
    window.visualViewport?.addEventListener?.('resize', closeObjectActionsMenu);
    const onSystemThemeChange = event => applySystemTheme(!!event.matches);
    if (typeof systemThemeQuery.addEventListener === 'function') systemThemeQuery.addEventListener('change', onSystemThemeChange);
    else if (typeof systemThemeQuery.addListener === 'function') systemThemeQuery.addListener(onSystemThemeChange);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        mapWorkScheduler.cancel('autosave');
        mapWorkScheduler.cancel('view-autosave');
        persistAutosave().catch(error => console.warn('Immediate autosave failed', error));
      }
    });
    window.addEventListener('beforeunload', () => {
      if (!canMutateProject(state.dataReadiness)) return;
      try { persistenceService.writeProject(buildAutosaveData()).catch(() => {}); } catch (_) {}
    });
    window.addEventListener('popstate', event => {
      if (ignoreNextMobileSheetPopstate) {
        ignoreNextMobileSheetPopstate = false;
        return;
      }
      if (isMobile() && surfaceController.activeMobileSheet) {
        const openSelect = document.querySelector('.ui-select-popover:not([hidden])');
        if (openSelect) {
          selectController.closeAll({ restoreFocus: true });
          trackMobileSheetHistory(surfaceController.activeMobileSheet);
          return;
        }
        const openPicker = document.querySelector('[data-color-picker].is-open');
        if (openPicker) {
          closeColorPicker(openPicker, { restoreFocus: true });
          trackMobileSheetHistory(surfaceController.activeMobileSheet);
          return;
        }
        closeActiveMobileSheet({ restoreFocus: true, syncHistory: false });
        return;
      }
      if (event.state?.[MOBILE_SHEET_HISTORY_KEY]) {
        const nextState = { ...event.state };
        delete nextState[MOBILE_SHEET_HISTORY_KEY];
        window.history.replaceState(nextState, '', window.location.href);
      }
    });
  }

  function bindUI() {
    bindUiTooltips();
    bindNavigationUI();
    bindLayerUI();
    bindToolUI();
    bindEditorFields();
    bindFileAndGisUI();
    bindGlobalInputUI();
    syncSearchClearButton($('layerSearchInput'), $('layerSearchClearBtn'));
    syncSearchClearButton($('historicalLibrarySearchInput'), $('historicalLibrarySearchClearBtn'));
    syncColorPicker('multiProperties', { value: $('multiPropertiesColorInput')?.value, defaultColor: '#3f6fae', isDefault: false });
    syncProjectSaveStatus(saveState.snapshot());
  }

  function syncProjectControls() {
    $('countriesVisible').checked = state.layerVisibility.countries;
    $('territoriesVisible').checked = state.layerVisibility.territories !== false;
    $('administrativeVisible').checked = state.layerVisibility.administrative !== false;
    $('regionsVisible').checked = state.layerVisibility.regions !== false;
    $('languagesVisible').checked = state.layerVisibility.languages !== false;
    $('ethnicitiesVisible').checked = state.layerVisibility.ethnicities !== false;
    $('religionsVisible').checked = state.layerVisibility.religions !== false;
    $('riversVisible').checked = state.layerVisibility.rivers !== false;
    $('lakesVisible').checked = state.layerVisibility.lakes !== false;
    $('drawingsVisible').checked = state.layerVisibility.drawings;
    $('labelsVisible').checked = state.layerVisibility.labels;
    $('basemapLabelsVisible').checked = state.layerVisibility.basemapLabels;
    syncPhysicalControls();
    if ($('layerSearchInput')) $('layerSearchInput').value = state.layerSearch;
    renderLayerTree(true);
    syncProjectionButtons();
    syncCanonicalControls();
  }

  function handleGeometryProgress(event) {
    const detail = event.detail || {};
    state.geometryProgress = Number(detail.percent || 0);
    const metrics = window.__PANDOLAB_STARTUP_METRICS__;
    if (metrics) metrics.geometryProgress = { stage: detail.stage || '', percent: state.geometryProgress };
    if (canMutateProject(state.dataReadiness)) return;
    if (state.dataReadiness === DATA_READINESS.ERROR) applyDataReadinessEvent(READINESS_EVENTS.RETRY_GEOMETRY);
    $('engineStatus').textContent = `빠른 미리보기 · 편집 데이터 ${Math.round(state.geometryProgress)}%`;
    if (detail.stage?.includes('retry') || state.geometryProgress >= 95 || state.geometryProgress % 10 === 0) {
      setActionStatus(detail.message || `편집 데이터 준비 중 · ${Math.round(state.geometryProgress)}%`, 'working', 0);
    }
  }

  function handleMeshProgress(event) {
    const detail = event.detail || {};
    state.meshProgress = Number(detail.percent || 0);
    const metrics = window.__PANDOLAB_STARTUP_METRICS__;
    if (metrics) metrics.meshProgress = { stage: detail.stage || '', percent: state.meshProgress };
    if (!canMutateProject(state.dataReadiness) || state.dataReadiness === DATA_READINESS.ENHANCED) return;
    $('engineStatus').textContent = `빠른 미리보기 · 고화질 지도 ${Math.round(state.meshProgress)}%`;
    if (detail.stage?.includes('retry')) setActionStatus(detail.message || '고화질 지도를 다시 준비하는 중입니다.', 'working', 0);
  }

  function handleGeometryError(event) {
    applyDataReadinessEvent(READINESS_EVENTS.GEOMETRY_ERROR);
    $('engineStatus').textContent = '빠른 미리보기 · 무손실 데이터 대기';
    const detail = String(event.detail || '무손실 데이터를 준비하지 못했습니다.');
    setActionStatus(`${detail} 미리보기 오류. 자동 재시도합니다.`, 'error', 0);
  }

  function handleMeshError(event) {
    if (!canMutateProject(state.dataReadiness)) return;
    $('engineStatus').textContent = '빠른 미리보기 · 고화질 지도 대기';
    const detail = String(event.detail || '고화질 지도를 준비하지 못했습니다.');
    setActionStatus(`${detail} 편집 데이터 오류. 자동 재시도합니다.`, 'error', 0);
  }

  async function completeGeometryInitialization(geometry, autosaveRestore, previewStart) {
    const applyStartedAt = performance.now();
    const navigationView = deepClone(state.view);
    const navigationProjection = state.projection;
    const navigationChanged = navigationProjection !== previewStart.projection
      || JSON.stringify(navigationView) !== previewStart.viewJson;
    const previewSearch = state.layerSearch;
    const previewSelection = (state.selected?.domain === 'territorial' && state.selected.type === TERRITORIAL_UNIT_TYPES.COUNTRY) ? String(state.selected.id || '') : '';
    installPristineCountrySource(geometry.countriesSourceBuffer);
    gpuMapRenderer.resetCountryGeometryVisualState();

    const restored = autosaveRestore.project;
    if (restored) applySharedProjectFields(restored);
    const restoredDelta = restored?.format === 'pandolab-autosave-delta';
    state.countriesData = restoredDelta
      ? countriesFromAutosaveDelta(restored, geometry.countries)
      : restored?.countriesData
        ? reindexCountries(restored.countriesData, true)
        : reindexCountries(geometry.countries, true);
    if (navigationChanged) {
      state.view = navigationView;
      state.projection = navigationProjection;
    } else {
      applyAutosavedView(autosaveRestore.view);
    }
    state.layerSearch = previewSearch;
    normalizeProjectObjects();
    pruneLayerItemVisibility();
    scheduleCountryLabelAnchors(null, 10);
    markLayerTreeDirty();
    configureDatasetSession(restored);
    state.boundaryTopology = { edges: new Map(), nodes: new Map() };
    const externalGeometry = !!restored?.countriesData && restored.baseDataset !== BASE_DATASET;
    const useBuiltInMesh = !externalGeometry && !state.sessionBaseCountriesJson;
    window.PANDOLAB_COUNTRIES = null;
    applyDataReadinessEvent(READINESS_EVENTS.GEOMETRY_READY);
    state.geometryProgress = 100;
    syncProjectControls();
    resizeMap();
    updateHistoryButtons();
    setTool('select', false);
    renderAll();
    if (previewSelection && countryFeatureById(previewSelection)) selectCountry(previewSelection, true, false);
    loadHydroData();
    await completeLayerTreeHydration();
    mapWorkScheduler.scheduleIdle('map-edit-warmup', () => mapEditClient.rebase(state.countriesData?.features || []), 1600);

    const startupMetrics = window.__PANDOLAB_STARTUP_METRICS__;
    if (startupMetrics) {
      startupMetrics.geometryApplyMs = performance.now() - applyStartedAt;
      const renderer = gpuMapRenderer.getStats();
      startupMetrics.renderer = renderer.renderer;
      startupMetrics.fallbackReason = renderer.fallbackReason;
      startupMetrics.devicePixelRatio = renderer.devicePixelRatio;
      startupMetrics.effectivePixelRatio = renderer.effectivePixelRatio;
    }
    if (restored) {
      saveState.markNewProject(`content:${Date.now()}`);
      saveState.setAutosave(AUTOSAVE_STATES.SAVED, { fallback: autosaveRestore.source === 'localstorage' ? '브라우저 로컬 저장소' : '' });
      if (restored.countriesData && restored.baseDataset === BASE_DATASET) queueAutosave(0);
      const restoredLabel = externalGeometry ? '외부 GIS 자동저장 데이터를' : '자동저장 프로젝트를';
      setActionStatus(`${restoredLabel} 복원 완료. 고화질 지도 준비 중…`, 'success', 3600);
    } else {
      saveState.markNewProject('content:0');
      const restoreMessage = autosaveRestore.error
        ? compactNotificationMessage(autosaveRestore.error?.message || '현재 스키마와 다른 자동저장입니다.', { tone: 'error', maxLength: 52 })
        : '편집 준비 완료. 고화질 지도 준비 중…';
      setActionStatus(restoreMessage, autosaveRestore.error ? 'error' : 'success', autosaveRestore.error ? 0 : 3200);
    }
    $('engineStatus').textContent = useBuiltInMesh ? '빠른 미리보기 · 고화질 지도 준비 중' : '프로젝트 지도를 다시 구성하는 중입니다.';
    window.dispatchEvent(new CustomEvent('pandolab:editable', { detail: { useBuiltInMesh } }));
    return { useBuiltInMesh, restored };
  }

  async function completeMeshEnhancement(mesh, context) {
    const meshReplaceStartedAt = performance.now();
    let meshApplied;
    if (!context.useBuiltInMesh || state.sessionBaseCountriesJson) {
      meshApplied = (await gpuMapRenderer.rebuildFromCountries(state.countriesData?.features || [])) !== false;
    } else {
      meshApplied = (await gpuMapRenderer.replaceBuiltInMesh({
        meshBuffer: mesh.meshBuffer,
        features: state.countriesData?.features || [],
        quality: 'canonical',
      })) !== false;
      const dirtyIds = new Set([...state.historyDirtyCountryIds, ...state.pendingCountryRenderIds]);
      if (dirtyIds.size) {
        for (const id of dirtyIds) state.pendingCountryRenderIds.add(String(id));
        await gpuMapRenderer.applyCountryPatch(dirtyIds);
      }
    }
    // Once the canonical mesh is successfully displayed, every country SVG
    // path must use the same source. This prevents edit/selection state from
    // mixing preview and canonical geometries on a single frame.
    if (meshApplied) {
      state.countryVisualPhase = 'canonical';
      countryDisplaySource = null;
      countryDisplayIndex = new Map();
    }
    applyDataReadinessEvent(READINESS_EVENTS.MESH_READY);
    state.meshProgress = 100;
    renderAll();
    const renderer = gpuMapRenderer.getStats();
    $('engineStatus').textContent = `Natural Earth 5.1.1 · ${renderer.renderer === 'webgl2' ? 'WebGL2' : renderer.renderer === 'webgl1' ? 'WebGL1' : 'Canvas'} 고화질`;
    const startupMetrics = window.__PANDOLAB_STARTUP_METRICS__;
    if (startupMetrics) {
      startupMetrics.meshApplyMs = performance.now() - meshReplaceStartedAt;
      startupMetrics.renderer = renderer.renderer;
      startupMetrics.fallbackReason = renderer.fallbackReason;
      startupMetrics.devicePixelRatio = renderer.devicePixelRatio;
      startupMetrics.effectivePixelRatio = renderer.effectivePixelRatio;
    }
    setActionStatus('고화질 지도를 준비했습니다.', 'success', 2400);
  }

  async function initProgressive() {
    beginLayerTreeHydration();
    assertRuntimeCompatibility();
    if (!window.d3) throw new Error('내장 지도 엔진을 불러올 수 없습니다. 페이지를 새로고침하세요.');
    if (!window.PANDOLAB_COUNTRIES?.features?.length) throw new Error('미리보기 국가 데이터를 불러올 수 없습니다. 페이지를 새로고침하세요.');

    const autosavePromise = restoreAutosavedProject();
    state.countriesData = reindexCountries(window.PANDOLAB_COUNTRIES, true);
    normalizeProjectObjects();
    pruneLayerItemVisibility();
    scheduleCountryLabelAnchors(null, 10);
    markLayerTreeDirty();
    configureDatasetSession(null);
    state.boundaryTopology = { edges: new Map(), nodes: new Map() };
    $('engineStatus').textContent = '빠른 미리보기 GPU 지도를 준비하는 중입니다.';

    applyLayoutMode({ initial: true });
    bindUI();
    window.addEventListener('pandolab:geometry-progress', handleGeometryProgress);
    window.addEventListener('pandolab:mesh-progress', handleMeshProgress);
    window.addEventListener('pandolab:geometry-error', handleGeometryError);
    window.addEventListener('pandolab:mesh-error', handleMeshError);
    initSvg();
    resizeMap();
    await new Promise(resolve => requestAnimationFrame(resolve));
    const previewMeshStartedAt = performance.now();
    await gpuMapRenderer.initialize();
    if (window.__PANDOLAB_STARTUP_METRICS__) {
      const previewRenderer = gpuMapRenderer.getStats();
      window.__PANDOLAB_STARTUP_METRICS__.previewMeshUploadMs = performance.now() - previewMeshStartedAt;
      window.__PANDOLAB_STARTUP_METRICS__.renderer = previewRenderer.renderer;
      window.__PANDOLAB_STARTUP_METRICS__.fallbackReason = previewRenderer.fallbackReason;
      window.__PANDOLAB_STARTUP_METRICS__.devicePixelRatio = previewRenderer.devicePixelRatio;
      window.__PANDOLAB_STARTUP_METRICS__.effectivePixelRatio = previewRenderer.effectivePixelRatio;
    }
    startMapResizeObserver();

    syncProjectControls();
    resizeMap();
    updateHistoryButtons();
    setTool('select', false);
    applyDataReadinessEvent(READINESS_EVENTS.PREVIEW_READY);
    runtimeReady = true;
    const previewStart = { projection: state.projection, viewJson: JSON.stringify(state.view) };
    setActionStatus('미리보기 표시 완료. 편집 데이터 준비 중…', 'working', 0);
    window.dispatchEvent(new CustomEvent('pandolab:interactive'));
    requestAnimationFrame(() => loadTerrainManifest());
    if (window.__PANDOLAB_STARTUP_METRICS__?.geometryError) {
      handleGeometryError({ detail: window.__PANDOLAB_STARTUP_METRICS__.geometryError });
    }

    const [geometry, autosaveRestore] = await Promise.all([
      window.PANDOLAB_CANONICAL_GEOMETRY_PROMISE,
      autosavePromise,
    ]);
    const previewCountries = state.countriesData;
    state.auditPreviewCountries = previewCountries;
    let context;
    try {
      context = await completeGeometryInitialization(geometry, autosaveRestore, previewStart);
    } catch (error) {
      console.error('[PL-GEOMETRY-APPLY-001]', error);
      state.countriesData = reindexCountries(previewCountries, true);
      applyDataReadinessEvent(READINESS_EVENTS.GEOMETRY_ERROR);
      renderAll();
      handleGeometryError({ detail: '무손실 편집 지도를 적용하지 못했습니다.' });
      await new Promise(() => {});
    }
    if (!context.useBuiltInMesh) {
      await completeMeshEnhancement(null, context);
      return;
    }
    if (window.__PANDOLAB_STARTUP_METRICS__?.meshError) {
      handleMeshError({ detail: window.__PANDOLAB_STARTUP_METRICS__.meshError });
    }
    const mesh = await window.PANDOLAB_CANONICAL_MESH_PROMISE;
    try {
      await completeMeshEnhancement(mesh, context);
    } catch (error) {
      console.error('[PL-MESH-APPLY-001]', error);
      handleMeshError({ detail: '고화질 지도를 적용하지 못했습니다.' });
      await new Promise(() => {});
    }
  }

  async function init() {
    if (window.PANDOLAB_CANONICAL_GEOMETRY_PROMISE instanceof Promise) return initProgressive();
    beginLayerTreeHydration();
    assertRuntimeCompatibility();
    if (!window.d3) {
      $('engineStatus').textContent = '엔진 오류';
      setActionStatus('내장 지도 엔진을 불러올 수 없습니다. 페이지를 새로고침하세요.', 'error', 0);
      return;
    }
    if (!window.PANDOLAB_COUNTRIES?.features?.length) {
      setActionStatus('내장 국가 데이터를 불러올 수 없습니다. 페이지를 새로고침하세요.', 'error', 0);
      return;
    }

    const autosaveRestore = await restoreAutosavedProject();
    const restored = autosaveRestore.project;
    if (restored) applySharedProjectFields(restored);
    applyAutosavedView(autosaveRestore.view);
    state.auditPreviewCountries = window.PANDOLAB_COUNTRIES;

    const restoredDelta = restored?.format === 'pandolab-autosave-delta';
    state.countriesData = restoredDelta
      ? countriesFromAutosaveDelta(restored)
      : restored?.countriesData
        ? reindexCountries(deepClone(restored.countriesData), true)
        : freshPristineCountries(true);
    state.countryVisualPhase = 'canonical';
    normalizeProjectObjects();
    pruneLayerItemVisibility();
    scheduleCountryLabelAnchors(null, 10);
    markLayerTreeDirty();
    configureDatasetSession(restored);
    const externalGeometry = !!restored?.countriesData && restored.baseDataset !== BASE_DATASET;
    $('engineStatus').textContent = 'Natural Earth 5.1.1 · GPU 렌더러를 준비하는 중입니다.';
    state.boundaryTopology = { edges: new Map(), nodes: new Map() };

    applyLayoutMode({ initial: true });
    bindUI();
    initSvg();
    resizeMap();
    mapEditClient.rebase(state.countriesData?.features || []);
    await new Promise(resolve => requestAnimationFrame(resolve));
    const gpuReady = await gpuMapRenderer.initialize();
    if (gpuReady) {
      state.countryVisualPhase = 'canonical';
      countryDisplaySource = null;
      countryDisplayIndex = new Map();
    }
    startMapResizeObserver();
    if (restored && gpuReady) {
      if (externalGeometry || state.sessionBaseCountriesJson) scheduleGpuMeshRebuild(0);
      else if (state.historyDirtyCountryIds.size) {
        for (const id of state.historyDirtyCountryIds) state.pendingCountryRenderIds.add(String(id));
        gpuMapRenderer.applyCountryPatch(state.historyDirtyCountryIds);
      }
    }

    $('countriesVisible').checked = state.layerVisibility.countries;
    $('territoriesVisible').checked = state.layerVisibility.territories !== false;
    $('administrativeVisible').checked = state.layerVisibility.administrative !== false;
    $('regionsVisible').checked = state.layerVisibility.regions !== false;
    $('languagesVisible').checked = state.layerVisibility.languages !== false;
    $('ethnicitiesVisible').checked = state.layerVisibility.ethnicities !== false;
    $('religionsVisible').checked = state.layerVisibility.religions !== false;
    $('riversVisible').checked = state.layerVisibility.rivers !== false;
    $('lakesVisible').checked = state.layerVisibility.lakes !== false;
    $('drawingsVisible').checked = state.layerVisibility.drawings;
    $('labelsVisible').checked = state.layerVisibility.labels;
    $('basemapLabelsVisible').checked = state.layerVisibility.basemapLabels;
    syncPhysicalControls();
    if ($('layerSearchInput')) $('layerSearchInput').value = state.layerSearch;
    renderLayerTree(true);
    syncProjectionButtons();

    resizeMap();
    updateHistoryButtons();
    setTool('select');
    loadPhysicalData();
    await completeLayerTreeHydration();

    if (restored) {
      saveState.markNewProject(`content:${Date.now()}`);
      saveState.setAutosave(AUTOSAVE_STATES.SAVED, { fallback: autosaveRestore.source === 'localstorage' ? '브라우저 로컬 저장소' : '' });
      if (restored.countriesData && restored.baseDataset === BASE_DATASET) queueAutosave(0);
      if (gpuReady) {
        const restoredLabel = externalGeometry ? '외부 GIS 자동저장 데이터를' : '자동저장 프로젝트를';
        setActionStatus(`${restoredLabel} 복원했습니다.`, 'success', 3200);
      } else {
        setActionStatus('자동저장을 복원했습니다.', 'success', 4200);
      }
    } else {
      saveState.markNewProject('content:0');
      if (autosaveRestore.error) {
        const restoreMessage = compactNotificationMessage(autosaveRestore.error?.message || '현재 스키마와 다른 자동저장입니다.', { tone: 'error', maxLength: 52 });
        setActionStatus(restoreMessage, 'error', 0);
      } else if (gpuReady) {
        setActionStatus('고해상도 지도를 준비했습니다.', 'success');
      } else {
        setActionStatus('무손실 렌더러 준비 완료.', 'success', 4200);
      }
    }
  }

  try {
    init()
      .then(() => {
        runtimeReady = true;
        window.dispatchEvent(new CustomEvent('pandolab:ready'));
      })
      .catch(error => {
        window.dispatchEvent(new CustomEvent('pandolab:error', { detail: error?.message || String(error) }));
        showFatalError(error);
      });
  } catch (error) {
    window.dispatchEvent(new CustomEvent('pandolab:error', { detail: error?.message || String(error) }));
    showFatalError(error);
  }
})();
