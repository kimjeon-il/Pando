/* AtlasWright v0.12.1
 * GitHub Pages-ready static map editor.
 * Rendering: bundled D3 v3 + Natural Earth 5.1.1 Admin 0 Countries 1:10m.
 * The full 1:10m geometry remains canonical; rendering and editing use lossless source data.
 * Source: naturalearthdata.com (public domain), default de facto boundary viewpoint.
 */

(() => {
  'use strict';

  const APP_VERSION = '0.12.1';
  const ASSET_REVISION = window.ATLASWRIGHT_ASSET_REVISION || APP_VERSION;
  const ATLASWRIGHT_ASSET_BASE_URL = window.ATLASWRIGHT_ASSET_BASE_URL || new URL('./assets/js/', location.href).href;
  const PHYSICAL_DATA_BASE_URL = new URL('../data/', ATLASWRIGHT_ASSET_BASE_URL);
  const PHYSICAL_DATASET = 'Natural Earth 5.0.0 base · HydroRIVERS/HydroLAKES 1.0 성능 필터 · raster 3.2.0';

  const STORAGE_KEY = 'atlaswright-editor-v010-project';
  const AUTOSAVE_DB_NAME = 'atlaswright-editor-v010';
  const AUTOSAVE_STORE_NAME = 'projects';
  const AUTOSAVE_RECORD_KEY = 'active-project';
  const AUTOSAVE_VIEW_KEY = 'active-view';
  const BASE_DATASET = 'Natural Earth 5.1.1 · Admin 0 Countries · 1:10m · de facto';
  const DARK_DEFAULT_COLOR = '#63758a';
  const LIGHT_DEFAULT_COLOR = '#cccccc';
  const DEFAULT_DRAWING_COLOR = '#8c68d8';
  const ZOOM_LIMITS = Object.freeze({
    globe: Object.freeze({ min: 0.72, max: 32 }),
    flat: Object.freeze({ min: 0.75, max: 64 }),
  });
  const TERRAIN_TOOL_CONFIG = Object.freeze({
    river: Object.freeze({ geometry: 'LineString', category: 'river', label: '강', color: '#3b82c4', prefix: 'river' }),
    lake: Object.freeze({ geometry: 'Polygon', category: 'lake', label: '호수', color: '#5aa9d6', prefix: 'lake' }),
  });
  const HYDRO_LAYER_META = Object.freeze({
    rivers_base: Object.freeze({ label: '강 · Natural Earth 기본', category: 'river', color: '#3b82c4' }),
    rivers_hydro: Object.freeze({ label: '강 · Hydro 보충', category: 'river', color: '#3b82c4' }),
    lakes_base: Object.freeze({ label: '호수 · Natural Earth 기본', category: 'lake', color: '#5aa9d6' }),
    lakes_hydro: Object.freeze({ label: '호수 · Hydro 보충', category: 'lake', color: '#5aa9d6' }),
  });
  const MAX_HISTORY = 30;
  const LAYOUT_QUERIES = {
    mobile: window.matchMedia('(max-width: 799px)'),
    compact: window.matchMedia('(min-width: 800px) and (max-width: 1199px)'),
  };

  const systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  let systemTheme = systemThemeQuery.matches ? 'dark' : 'light';
  document.documentElement.dataset.systemTheme = systemTheme;
  window.__ATLASWRIGHT_THEME__ = systemTheme;

  function mapTheme() {
    const terrainVisible = state?.physicalSettings?.terrainVisible !== false;
    const terrainStyle = state?.physicalSettings?.terrainStyle || 'political';
    const terrainStrength = clamp(Number(state?.physicalSettings?.terrainStrength ?? 0.32), 0, 1);
    const terrainFillAlpha = terrainVisible
      ? (terrainStyle === 'physical' ? 0.22 : 1 - terrainStrength)
      : null;
    return systemTheme === 'light'
      ? { defaultLand: LIGHT_DEFAULT_COLOR, fillAlpha: terrainFillAlpha ?? 1, fillAlphaByte: Math.round((terrainFillAlpha ?? 1) * 255), border: '#ffffff', borderGpu: [1, 1, 1], borderAlpha: 1 }
      : { defaultLand: DARK_DEFAULT_COLOR, fillAlpha: terrainFillAlpha ?? 0.74, fillAlphaByte: Math.round((terrainFillAlpha ?? 0.74) * 255), border: '#323c46', borderGpu: [0.196, 0.235, 0.275], borderAlpha: 0.92 };
  }

  function defaultCountryColor() {
    return mapTheme().defaultLand;
  }

  function applySystemTheme(matchesDark) {
    const nextTheme = matchesDark ? 'dark' : 'light';
    if (nextTheme === systemTheme) return;
    systemTheme = nextTheme;
    document.documentElement.dataset.systemTheme = systemTheme;
    window.__ATLASWRIGHT_THEME__ = systemTheme;
    if (state?.selected?.type === 'country') {
      const id = String(state.selected.id);
      const feature = countryFeatureById(id);
      const hasExplicitColor = !!(state.countryOverrides[id]?.color || feature?.properties?.editor_color);
      if (!hasExplicitColor && $('countryColorInput')) $('countryColorInput').value = defaultCountryColor();
    }
    if (svg) renderAll();
  }

  const $ = (id) => document.getElementById(id);
  function runtimeAssetUrl(relativePath) {
    const url = new URL(relativePath, ATLASWRIGHT_ASSET_BASE_URL);
    url.searchParams.set('v', ASSET_REVISION);
    return url;
  }
  const REQUIRED_UI_IDS = Object.freeze([
    'app', 'map', 'engineStatus', 'countryStatus',
    'globeBtn', 'flatBtn', 'countriesVisible', 'drawingsVisible', 'labelsVisible', 'basemapLabelsVisible', 'countriesLocked',
    'resetViewBtn', 'terrainStyleSelect', 'terrainStrengthInput', 'terrainStrengthValue', 'countryNameInput', 'countryColorInput', 'capitalInput', 'notesInput',
    'flagUploadBtn', 'flagFileInput', 'flagRemoveBtn',
    'drawingNameInput', 'drawingColorInput', 'drawingCategoryInput', 'drawingNotesInput',
    'labelNameInput', 'labelKindInput', 'labelNotesInput', 'deleteLabelBtn',
    'hydroProperties', 'hydroNameValue', 'hydroCategoryValue', 'hydroLayerValue', 'hydroSourceValue', 'copyHydroBtn',
    'undoBtn', 'redoBtn', 'togglePanelBtn', 'rightPanel',
    'saveProjectBtn', 'openGisBtn', 'gisFileInput', 'newProjectBtn',
    'importGeoJsonBtn', 'geoJsonFileInput', 'exportGeoJsonBtn',
  ]);
  const CACHE_MISMATCH_MESSAGE = '화면 파일과 스크립트 버전이 다릅니다. 페이지를 강력 새로고침하세요. PC에서는 Ctrl+F5를 사용할 수 있습니다.';

  function assertRuntimeCompatibility() {
    const htmlVersion = $('app')?.dataset.appVersion;
    const bootstrapVersion = window.ATLASWRIGHT_BUILD_ID;
    if (htmlVersion !== APP_VERSION || bootstrapVersion !== APP_VERSION) throw new Error(CACHE_MISMATCH_MESSAGE);
    const missingIds = REQUIRED_UI_IDS.filter(id => !$(id));
    const missingSelectors = ['.workspace'].filter(selector => !document.querySelector(selector));
    if (missingIds.length || missingSelectors.length) throw new Error(CACHE_MISMATCH_MESSAGE);
  }

  const deepClone = (obj) => JSON.parse(JSON.stringify(obj));
  // 내장 원본은 읽기 전용 기준 지도다. 렌더링 메시와 편집 사본을 분리해 원본 좌표를 보존한다.
  const PRISTINE_COUNTRIES = window.ATLASWRIGHT_COUNTRIES || { type: 'FeatureCollection', features: [] };
  const PRISTINE_LABEL_ANCHORS = window.ATLASWRIGHT_LABEL_ANCHORS || {};

  function freshPristineCountries(applyOverrides = true) {
    const countries = reindexCountries(deepClone(PRISTINE_COUNTRIES), applyOverrides);
    applyPristineLabelAnchors(countries);
    return countries;
  }
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const terrainToolConfig = tool => TERRAIN_TOOL_CONFIG[tool] || null;
  const isPolygonDraftTool = tool => tool === 'polygon' || tool === 'lake';
  const isLineDraftTool = tool => tool === 'line' || tool === 'river';
  const isDrawingDraftTool = tool => isPolygonDraftTool(tool) || isLineDraftTool(tool);
  const clampViewZooms = view => {
    if (!view) return view;
    view.globeZoom = clamp(Number(view.globeZoom) || 1, ZOOM_LIMITS.globe.min, ZOOM_LIMITS.globe.max);
    view.flatZoom = clamp(Number(view.flatZoom) || 1, ZOOM_LIMITS.flat.min, ZOOM_LIMITS.flat.max);
    return view;
  };
  const uid = (prefix = 'obj') => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const detectLayoutMode = () => LAYOUT_QUERIES.mobile.matches ? 'mobile' : LAYOUT_QUERIES.compact.matches ? 'compact' : 'wide';
  let layoutMode = detectLayoutMode();
  const isMobile = () => layoutMode === 'mobile';
  const isCompact = () => layoutMode === 'compact';
  const usesOverlayEditor = () => layoutMode !== 'wide';
  let lastOverlayTrigger = null;
  let createMenuTrigger = null;
  let mapContextCollapseTimer = 0;

  function scheduleMapContextCollapse(delay = 4200) {
    window.clearTimeout(mapContextCollapseTimer);
    const context = $('currentTool');
    if (!context || context.classList.contains('has-active-context')) return;
    mapContextCollapseTimer = window.setTimeout(() => {
      if (!context.classList.contains('has-active-context')) context.classList.add('is-collapsed');
    }, delay);
  }

  function updateMapContextDefault() {
    const hint = $('mapContextDefault');
    if (!hint) return;
    hint.textContent = isMobile()
      ? '한 손가락으로 이동 · 두 손가락으로 확대·축소'
      : '드래그로 이동 · 휠로 확대·축소 · 지도에서 객체 선택';
  }

  function applyLayoutMode({ initial = false } = {}) {
    const previous = layoutMode;
    layoutMode = detectLayoutMode();
    const app = $('app');
    if (app) app.dataset.layout = layoutMode;
    document.body.dataset.layout = layoutMode;
    updateMapContextDefault();

    const left = $('leftPanel');
    const right = $('rightPanel');
    const fileMenu = document.querySelector('.top-actions');
    if (layoutMode === 'wide') {
      left?.classList.remove('mobile-open');
      right?.classList.remove('mobile-open');
      fileMenu?.classList.remove('mobile-open');
    } else if (layoutMode === 'compact') {
      left?.classList.remove('mobile-open');
      fileMenu?.classList.remove('mobile-open');
    } else if (previous === 'wide') {
      right?.classList.remove('mobile-open');
    }
    syncMobileBackdrop();
    if (layoutMode === 'mobile') syncMobileNavigation();
    if (!initial && previous !== layoutMode) queueMapResize();
    return previous !== layoutMode;
  }

  function syncMobileBackdrop() {
    const fileOpen = document.querySelector('.top-actions')?.classList.contains('mobile-open');
    $('mobileFileBtn')?.classList.toggle('sheet-open', !!fileOpen);
    $('mobileFileBtn')?.setAttribute('aria-expanded', String(!!fileOpen));
    const leftOpen = $('leftPanel')?.classList.contains('mobile-open');
    const rightOpen = $('rightPanel')?.classList.contains('mobile-open');
    const overlayOpen = isMobile() ? (leftOpen || rightOpen || fileOpen) : isCompact() ? rightOpen : false;
    document.body.classList.toggle('mobile-sheet-open', !!overlayOpen);
    document.body.classList.toggle('responsive-overlay-open', !!overlayOpen);
    $('mobileMapBtn')?.classList.toggle('sheet-open', !!leftOpen);
    $('mobileMapBtn')?.setAttribute('aria-expanded', String(!!leftOpen));
    $('mobileEditBtn')?.classList.toggle('sheet-open', !!rightOpen);
    $('mobileEditBtn')?.setAttribute('aria-expanded', String(!!rightOpen));
    $('togglePanelBtn')?.setAttribute('aria-expanded', String(layoutMode === 'wide' ? !$('rightPanel')?.classList.contains('collapsed') : !!rightOpen));
    $('mobileFileBtn')?.classList.toggle('sheet-open', !!fileOpen);
    syncMobileNavigation();
  }

  function isCreateMenuOpen() {
    const menu = $('createMenu');
    return !!menu && !menu.classList.contains('hidden');
  }

  function syncCreateMenuState() {
    const open = isCreateMenuOpen();
    $('createMenuBtn')?.setAttribute('aria-expanded', String(open));
    $('mobileCreateBtn')?.setAttribute('aria-expanded', String(open));
    $('mobileCreateBtn')?.classList.toggle('sheet-open', open);
    document.body.classList.toggle('create-menu-open', open);
    syncMobileNavigation();
  }

  function closeCreateMenu({ restoreFocus = false } = {}) {
    const menu = $('createMenu');
    if (!menu || menu.classList.contains('hidden')) return;
    menu.classList.add('hidden');
    syncCreateMenuState();
    if (restoreFocus && createMenuTrigger?.isConnected) createMenuTrigger.focus({ preventScroll: true });
    createMenuTrigger = null;
  }

  function toggleCreateMenu(trigger) {
    const menu = $('createMenu');
    if (!menu) return;
    const willOpen = menu.classList.contains('hidden');
    if (!willOpen) {
      closeCreateMenu({ restoreFocus: true });
      return;
    }
    createMenuTrigger = trigger instanceof HTMLElement ? trigger : null;
    closeMobileSheets(null, { restoreFocus: false });
    document.querySelector('.top-actions')?.classList.remove('mobile-open');
    menu.classList.remove('hidden');
    syncCreateMenuState();
    requestAnimationFrame(() => menu.querySelector('[role="menuitem"]')?.focus({ preventScroll: true }));
  }

  function closeMobileSheets(except = null, { restoreFocus = false } = {}) {
    if (!isMobile() && !isCompact()) return;
    if (except !== 'left') $('leftPanel')?.classList.remove('mobile-open');
    if (except !== 'right') $('rightPanel')?.classList.remove('mobile-open');
    if (except !== 'file') document.querySelector('.top-actions')?.classList.remove('mobile-open');
    syncMobileBackdrop();
    if (restoreFocus && lastOverlayTrigger?.isConnected) lastOverlayTrigger.focus({ preventScroll: true });
    if (restoreFocus) lastOverlayTrigger = null;
  }

  function toggleMobileSheet(which) {
    if (layoutMode === 'wide' || (which === 'left' && !isMobile())) return;
    const map = { left: $('leftPanel'), right: $('rightPanel'), file: document.querySelector('.top-actions') };
    const el = map[which];
    if (!el) return;
    const willOpen = !el.classList.contains('mobile-open');
    if (willOpen) lastOverlayTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeCreateMenu();
    closeMobileSheets(null, { restoreFocus: false });
    if (willOpen) el.classList.add('mobile-open');
    syncMobileBackdrop();
    if (willOpen) requestAnimationFrame(() => el.querySelector('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')?.focus({ preventScroll: true }));
  }

  function toggleFileMenu() {
    closeCreateMenu();
    if (isMobile()) {
      toggleMobileSheet('file');
      return;
    }
    const menu = document.querySelector('.top-actions');
    if (!menu) return;
    menu.classList.toggle('mobile-open');
    syncMobileBackdrop();
  }

  function openMobileLeftAt() {
    if (!isMobile()) return;
    const left = $('leftPanel');
    if (!left) return;
    const sameOpen = left.classList.contains('mobile-open');
    if (!sameOpen) lastOverlayTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeCreateMenu();
    closeMobileSheets();
    if (sameOpen) return;
    left.classList.add('mobile-open');
    syncMobileBackdrop();
    requestAnimationFrame(() => {
      left.scrollTop = 0;
      left.querySelector('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')?.focus({ preventScroll: true });
    });
  }

  function openSelectionEditor() {
    const panel = $('rightPanel');
    if (!panel) return;
    if (usesOverlayEditor()) {
      lastOverlayTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      closeMobileSheets(null, { restoreFocus: false });
      panel.classList.remove('collapsed');
      panel.classList.add('mobile-open');
      syncMobileBackdrop();
      panel.scrollTop = 0;
    } else {
      panel.classList.remove('collapsed');
      document.querySelector('.workspace')?.classList.remove('panel-collapsed');
      setTimeout(resizeMap, 40);
    }
  }

  function syncMobileNavigation() {
    const adding = state?.tool === 'new-country' || !!terrainToolConfig(state?.tool) || state?.labelPlacementMode || state?.tool === 'label';
    $('mobileCreateBtn')?.classList.toggle('active', !!adding || isCreateMenuOpen());
    $('createMenuBtn')?.classList.toggle('active', !!adding);
    $('addCountryBtn')?.classList.toggle('active', state?.tool === 'new-country');
    $('addLabelBtn')?.classList.toggle('active', !!state?.labelPlacementMode || state?.tool === 'label');
    $('addRiverBtn')?.classList.toggle('active', state?.tool === 'river');
    $('addLakeBtn')?.classList.toggle('active', state?.tool === 'lake');
  }

  let renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      renderAll();
    });
  }

  const state = {
    countriesData: null,
    countryIndex: new Map(),
    countryOverrides: {},
    sourceInfo: null,
    labels: [],
    drawings: [],
    selected: null,
    projection: 'globe',
    layerVisibility: {
      countries: true,
      drawings: true,
      labels: true,
      basemapLabels: true,
    },
    physicalSettings: {
      terrainVisible: true,
      terrainStyle: 'political',
      terrainStrength: 0.32,
      hydroLayers: {
        rivers_base: true, rivers_hydro: true,
        lakes_base: true, lakes_hydro: true,
      },
      hiddenHydroIds: {},
      dataset: PHYSICAL_DATASET,
    },
    hydroCollections: {},
    hydroFeatureCache: new Map(),
    hydroFeatureByFid: new Map(),
    hydroManifest: null,
    terrainManifest: null,
    physicalLoadState: { terrain: 'idle', hydro: 'idle' },
    itemVisibility: {
      countries: {},
      drawings: {},
      labels: {},
      countryLabels: {},
    },
    layerFolders: {
      countries: false,
      drawings: false,
      labels: false,
      countryLabels: false,
    },
    layerSearch: '',
    countriesLocked: false,
    tool: 'select',
    labelPlacementMode: false,
    coastEditCountryId: null,
    mergeSourceCountryId: null,
    annexTargetCountryId: null,
    annexDonorCountryId: null,
    annexPhase: null,
    annexComponentIndex: null,
    annexCandidates: [],
    annexSelectedCandidateIndex: null,
    annexSelectedComponentKeys: [],
    newCountryPhase: null,
    newCountrySourceIds: [],
    newCountryCandidates: [],
    newCountrySelectedCandidateIndex: null,
    newCountrySelectedComponentKeys: [],
    boundaryTopology: { edges: new Map(), nodes: new Map() },
    spatialIndex: [],
    mapMoving: false,
    historyDirtyCountryIds: new Set(),
    sessionBaseCountriesJson: null,
    draftCoords: [],
    draftHover: null,
    suppressNextMapClick: null,
    history: [],
    future: [],
    autosaveTimer: null,
    lastSavedAt: null,
    view: {
      globeRotation: [-15, -25, 0],
      globeZoom: 1,
      flatCenter: [0, 20],
      flatZoom: 1,
    },
    size: { width: 1000, height: 700 },
    layerTreeRevision: 1,
  };

  let baseSvg;
  let svg;
  let root;
  let shadowLayer;
  let oceanLayer;
  let graticuleLayer;
  let countryLayer;
  let boundaryEditLayer;
  let drawingLayer;
  let hydroLakeLayer;
  let hydroRiverLayer;
  let hydroSelectionLayer;
  let countryLabelLayer;
  let labelLayer;
  let vertexLayer;
  let draftLayer;
  let mapInteractionLayer;
  let mapResizeObserver = null;
  let mapResizeFrame = 0;
  let resolutionQuery = null;
  let renderRevision = 0;
  let editInteractionRevision = 0;
  let mousePan = null;
  let touchTap = null;
  let pendingMapClickRevision = null;
  let geometryBoundsCache = new WeakMap();
  const pendingCountryLabelAnchors = new Set();
  const countryLabelAnchorVersions = new Map();
  let countryLabelAnchorWorker = null;
  let countryLabelAnchorTimer = 0;
  let countryLabelAnchorRequestId = 0;

  const globeProjection = d3.geo.orthographic().clipAngle(90).precision(isMobile() ? 0.9 : 0.35);
  const flatProjection = d3.geo.equirectangular().precision(isMobile() ? 0.7 : 0.25);
  const path = d3.geo.path().pointRadius(5);
  const graticule = d3.geo.graticule();



  const gpuMapRenderer = (() => {
    const PI = Math.PI;
    let canvas = null;
    let gl = null;
    let glVersion = 0;
    let webGlContextKind = '';
    let uintIndexExtension = null;
    let ctx2d = null;
    let rendererMode = 'pending';
    let fillProgram = null;
    let lineProgram = null;
    let pickProgram = null;
    let terrainProgram = null;
    let hydroFillProgram = null;
    let hydroLineProgram = null;
    let hydroPickProgram = null;
    let hydroLinePickProgram = null;
    let hydroCornerBuffer = null;
    let instancedExtension = null;
    let hydroVisibilityTexture = null;
    let hydroVisibilityWidth = 1;
    let hydroVisibilityHeight = 1;
    let hydroManifest = null;
    let hydroManifestUrl = null;
    let hydroWorker = null;
    let hydroWorkerReady = false;
    let hydroPendingView = null;
    let hydroViewKey = '';
    let hydroRequestRevision = 0;
    let hydroActivePackIds = new Set();
    const hydroPacks = new Map();
    let fillVao = null;
    let lineVao = null;
    let positionBuffer = null;
    let countryBuffer = null;
    let fillIndexBuffer = null;
    let lineIndexBuffer = null;
    let paletteTexture = null;
    let terrainManifest = null;
    const terrainTiles = new Map();
    const terrainTileRequests = new Map();
    const terrainGridMeshes = new Map();
    let terrainLastLevel = -1;
    let mesh = null;
    let meshCountryIds = [];
    let pixelWidth = 0;
    let pixelHeight = 0;
    let cssWidth = 0;
    let cssHeight = 0;
    let pickFramebuffer = null;
    let pickTexture = null;
    let worker = null;
    let workerUrl = null;
    let canvasWorker = null;
    let canvasWorkerUrl = null;
    let canvasWorkerBitmapContext = null;
    let canvasWorker2dContext = null;
    let canvasWorkerReady = false;
    let canvasWorkerBusy = false;
    let canvasWorkerPendingMessage = null;
    let canvasWorkerLatestRequestedRevision = 0;
    let canvasWorkerDisplayedRevision = 0;
    let rebuildToken = 0;
    let fallbackReason = '';
    let layoutMismatchCount = 0;
    let layoutVerificationFrame = 0;
    let webglRecoveryTimer = 0;
    let webglContextLost = false;
    let currentRenderRevision = 0;
    let displayedRenderRevision = 0;
    let webGl1PositionData = null;
    let webGl1CountryData = null;
    const frameTimes = [];
    const forcedRenderer = (() => {
      try {
        const value = new URLSearchParams(location.search).get('renderer');
        return ['webgl2', 'webgl1', 'canvas'].includes(value) ? value : '';
      } catch (_) { return ''; }
    })();

    const vertexShaderSourceWebGl2 = `#version 300 es
      precision highp float;
      precision highp int;
      layout(location=0) in ivec2 aCoord;
      layout(location=1) in uint aCountry;
      uniform vec2 uViewport;
      uniform vec2 uTranslate;
      uniform float uScale;
      uniform vec3 uRowX;
      uniform vec3 uRowY;
      uniform vec3 uRowZ;
      uniform vec2 uFlatCenter;
      uniform float uWorldOffset;
      uniform int uMode;
      out float vDepth;
      flat out uint vCountry;
      void main() {
        float lon = float(aCoord.x) * 0.000001 * ${Math.PI / 180};
        float lat = float(aCoord.y) * 0.000001 * ${Math.PI / 180};
        vec2 screenPoint;
        if (uMode == 0) {
          vec3 point = vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat));
          screenPoint = uTranslate + uScale * vec2(dot(uRowX, point), dot(uRowY, point));
          vDepth = dot(uRowZ, point);
        } else {
          screenPoint = uTranslate + uScale * vec2(lon + uWorldOffset - uFlatCenter.x, -(lat - uFlatCenter.y));
          vDepth = 1.0;
        }
        vec2 clip = vec2(screenPoint.x * 2.0 / uViewport.x - 1.0, 1.0 - screenPoint.y * 2.0 / uViewport.y);
        gl_Position = vec4(clip, 0.0, 1.0);
        vCountry = aCountry;
      }`;
    const fillFragmentSourceWebGl2 = `#version 300 es
      precision highp float;
      precision highp int;
      in float vDepth;
      flat in uint vCountry;
      uniform sampler2D uPalette;
      uniform int uMode;
      out vec4 outColor;
      void main() {
        if (uMode == 0 && vDepth < 0.0) discard;
        vec4 color = texelFetch(uPalette, ivec2(int(vCountry), 0), 0);
        if (color.a <= 0.0) discard;
        outColor = color;
      }`;
    const lineFragmentSourceWebGl2 = `#version 300 es
      precision highp float;
      precision highp int;
      in float vDepth;
      flat in uint vCountry;
      uniform sampler2D uPalette;
      uniform int uMode;
      uniform vec4 uBorderColor;
      out vec4 outColor;
      void main() {
        if (uMode == 0 && vDepth < 0.0) discard;
        if (texelFetch(uPalette, ivec2(int(vCountry), 0), 0).a <= 0.0) discard;
        outColor = uBorderColor;
      }`;
    const pickFragmentSourceWebGl2 = `#version 300 es
      precision highp float;
      precision highp int;
      in float vDepth;
      flat in uint vCountry;
      uniform sampler2D uPalette;
      uniform int uMode;
      out vec4 outColor;
      void main() {
        if (uMode == 0 && vDepth < 0.0) discard;
        if (texelFetch(uPalette, ivec2(int(vCountry), 0), 0).a <= 0.0) discard;
        uint id = vCountry + 1u;
        outColor = vec4(float(id & 255u), float((id >> 8u) & 255u), float((id >> 16u) & 255u), 255.0) / 255.0;
      }`;
    const vertexShaderSourceWebGl1 = `
      precision highp float;
      precision mediump int;
      attribute vec2 aCoord;
      attribute float aCountry;
      uniform vec2 uViewport;
      uniform vec2 uTranslate;
      uniform float uScale;
      uniform vec3 uRowX;
      uniform vec3 uRowY;
      uniform vec3 uRowZ;
      uniform vec2 uFlatCenter;
      uniform float uWorldOffset;
      uniform int uMode;
      varying float vDepth;
      varying float vCountry;
      void main() {
        float lon = aCoord.x * 0.000001 * ${Math.PI / 180};
        float lat = aCoord.y * 0.000001 * ${Math.PI / 180};
        vec2 screenPoint;
        if (uMode == 0) {
          vec3 point = vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat));
          screenPoint = uTranslate + uScale * vec2(dot(uRowX, point), dot(uRowY, point));
          vDepth = dot(uRowZ, point);
        } else {
          screenPoint = uTranslate + uScale * vec2(lon + uWorldOffset - uFlatCenter.x, -(lat - uFlatCenter.y));
          vDepth = 1.0;
        }
        vec2 clip = vec2(screenPoint.x * 2.0 / uViewport.x - 1.0, 1.0 - screenPoint.y * 2.0 / uViewport.y);
        gl_Position = vec4(clip, 0.0, 1.0);
        vCountry = aCountry;
      }`;
    const hydroRibbonVertexSourceWebGl2 = `#version 300 es
      precision highp float;
      precision highp int;
      layout(location=0) in vec2 aCorner;
      layout(location=1) in ivec2 aStart;
      layout(location=2) in ivec2 aEnd;
      layout(location=3) in uint aCountry;
      layout(location=4) in float aWidth;
      uniform vec2 uViewport;
      uniform vec2 uTranslate;
      uniform float uScale;
      uniform vec3 uRowX;
      uniform vec3 uRowY;
      uniform vec3 uRowZ;
      uniform vec2 uFlatCenter;
      uniform float uWorldOffset;
      uniform float uWidthBoost;
      uniform int uMode;
      out float vDepth;
      flat out uint vCountry;
      void projectCoord(ivec2 coord, out vec2 screenPoint, out float depth) {
        float lon = float(coord.x) * 0.000001 * ${Math.PI / 180};
        float lat = float(coord.y) * 0.000001 * ${Math.PI / 180};
        if (uMode == 0) {
          vec3 point = vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat));
          screenPoint = uTranslate + uScale * vec2(dot(uRowX, point), dot(uRowY, point));
          depth = dot(uRowZ, point);
        } else {
          screenPoint = uTranslate + uScale * vec2(lon + uWorldOffset - uFlatCenter.x, -(lat - uFlatCenter.y));
          depth = 1.0;
        }
      }
      void main() {
        vec2 startPoint;
        vec2 endPoint;
        float startDepth;
        float endDepth;
        projectCoord(aStart, startPoint, startDepth);
        projectCoord(aEnd, endPoint, endDepth);
        vec2 direction = endPoint - startPoint;
        float segmentLength = length(direction);
        direction = segmentLength > 0.0001 ? direction / segmentLength : vec2(1.0, 0.0);
        vec2 normal = vec2(-direction.y, direction.x);
        vec2 screenPoint = mix(startPoint, endPoint, aCorner.x) + normal * aCorner.y * (aWidth + uWidthBoost) * 0.5;
        vDepth = mix(startDepth, endDepth, aCorner.x);
        vec2 clip = vec2(screenPoint.x * 2.0 / uViewport.x - 1.0, 1.0 - screenPoint.y * 2.0 / uViewport.y);
        gl_Position = vec4(clip, 0.0, 1.0);
        vCountry = aCountry;
      }`;
    const hydroRibbonVertexSourceWebGl1 = `
      precision highp float;
      precision mediump int;
      attribute vec2 aCorner;
      attribute vec2 aStart;
      attribute vec2 aEnd;
      attribute float aCountry;
      attribute float aWidth;
      uniform vec2 uViewport;
      uniform vec2 uTranslate;
      uniform float uScale;
      uniform vec3 uRowX;
      uniform vec3 uRowY;
      uniform vec3 uRowZ;
      uniform vec2 uFlatCenter;
      uniform float uWorldOffset;
      uniform float uWidthBoost;
      uniform int uMode;
      varying float vDepth;
      varying float vCountry;
      void projectCoord(vec2 coord, out vec2 screenPoint, out float depth) {
        float lon = coord.x * 0.000001 * ${Math.PI / 180};
        float lat = coord.y * 0.000001 * ${Math.PI / 180};
        if (uMode == 0) {
          vec3 point = vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat));
          screenPoint = uTranslate + uScale * vec2(dot(uRowX, point), dot(uRowY, point));
          depth = dot(uRowZ, point);
        } else {
          screenPoint = uTranslate + uScale * vec2(lon + uWorldOffset - uFlatCenter.x, -(lat - uFlatCenter.y));
          depth = 1.0;
        }
      }
      void main() {
        vec2 startPoint;
        vec2 endPoint;
        float startDepth;
        float endDepth;
        projectCoord(aStart, startPoint, startDepth);
        projectCoord(aEnd, endPoint, endDepth);
        vec2 direction = endPoint - startPoint;
        float segmentLength = length(direction);
        direction = segmentLength > 0.0001 ? direction / segmentLength : vec2(1.0, 0.0);
        vec2 normal = vec2(-direction.y, direction.x);
        vec2 screenPoint = mix(startPoint, endPoint, aCorner.x) + normal * aCorner.y * (aWidth + uWidthBoost) * 0.5;
        vDepth = mix(startDepth, endDepth, aCorner.x);
        vec2 clip = vec2(screenPoint.x * 2.0 / uViewport.x - 1.0, 1.0 - screenPoint.y * 2.0 / uViewport.y);
        gl_Position = vec4(clip, 0.0, 1.0);
        vCountry = aCountry;
      }`;
    const fillFragmentSourceWebGl1 = `
      precision highp float;
      precision mediump int;
      varying float vDepth;
      varying float vCountry;
      uniform sampler2D uPalette;
      uniform float uPaletteWidth;
      uniform int uMode;
      void main() {
        if (uMode == 0 && vDepth < 0.0) discard;
        float index = floor(vCountry + 0.5);
        vec4 color = texture2D(uPalette, vec2((index + 0.5) / uPaletteWidth, 0.5));
        if (color.a <= 0.0) discard;
        gl_FragColor = color;
      }`;
    const lineFragmentSourceWebGl1 = `
      precision highp float;
      precision mediump int;
      varying float vDepth;
      varying float vCountry;
      uniform sampler2D uPalette;
      uniform float uPaletteWidth;
      uniform int uMode;
      uniform vec4 uBorderColor;
      void main() {
        if (uMode == 0 && vDepth < 0.0) discard;
        float index = floor(vCountry + 0.5);
        if (texture2D(uPalette, vec2((index + 0.5) / uPaletteWidth, 0.5)).a <= 0.0) discard;
        gl_FragColor = uBorderColor;
      }`;
    const pickFragmentSourceWebGl1 = `
      precision highp float;
      precision mediump int;
      varying float vDepth;
      varying float vCountry;
      uniform sampler2D uPalette;
      uniform float uPaletteWidth;
      uniform int uMode;
      void main() {
        if (uMode == 0 && vDepth < 0.0) discard;
        float index = floor(vCountry + 0.5);
        if (texture2D(uPalette, vec2((index + 0.5) / uPaletteWidth, 0.5)).a <= 0.0) discard;
        float id = floor(vCountry + 1.5);
        float r = mod(id, 256.0);
        float g = mod(floor(id / 256.0), 256.0);
        float b = mod(floor(id / 65536.0), 256.0);
        gl_FragColor = vec4(r, g, b, 255.0) / 255.0;
      }`;
    const terrainVertexSourceWebGl2 = `#version 300 es
      precision highp float;
      layout(location=0) in vec2 aGrid;
      uniform vec4 uGeoBounds;
      uniform vec4 uUvBounds;
      uniform vec2 uViewport;
      uniform vec2 uTranslate;
      uniform float uScale;
      uniform vec3 uRowX;
      uniform vec3 uRowY;
      uniform vec3 uRowZ;
      uniform vec2 uFlatCenter;
      uniform float uWorldOffset;
      uniform int uMode;
      out vec2 vUv;
      out float vDepth;
      void main() {
        float lon = mix(uGeoBounds.x, uGeoBounds.z, aGrid.x) * ${Math.PI / 180};
        float lat = mix(uGeoBounds.y, uGeoBounds.w, aGrid.y) * ${Math.PI / 180};
        vec2 screenPoint;
        if (uMode == 0) {
          vec3 point = vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat));
          screenPoint = uTranslate + uScale * vec2(dot(uRowX, point), dot(uRowY, point));
          vDepth = dot(uRowZ, point);
        } else {
          screenPoint = uTranslate + uScale * vec2(lon + uWorldOffset - uFlatCenter.x, -(lat - uFlatCenter.y));
          vDepth = 1.0;
        }
        vec2 clip = vec2(screenPoint.x * 2.0 / uViewport.x - 1.0, 1.0 - screenPoint.y * 2.0 / uViewport.y);
        gl_Position = vec4(clip, 0.0, 1.0);
        vUv = mix(uUvBounds.xy, uUvBounds.zw, aGrid);
      }`;
    const terrainFragmentSourceWebGl2 = `#version 300 es
      precision highp float;
      precision highp int;
      in vec2 vUv;
      in float vDepth;
      uniform sampler2D uTerrain;
      uniform int uMode;
      uniform float uPhysicalStyle;
      uniform float uDarkTheme;
      out vec4 outColor;
      void main() {
        if (uMode == 0 && vDepth < 0.0) discard;
        vec4 terrainSample = texture(uTerrain, vUv);
        vec3 neutral = vec3(terrainSample.a);
        vec3 color = mix(neutral, terrainSample.rgb, uPhysicalStyle);
        color = mix(color, color * vec3(0.60, 0.68, 0.76), uDarkTheme * 0.48);
        outColor = vec4(color, 1.0);
      }`;
    const terrainVertexSourceWebGl1 = `
      precision highp float;
      precision mediump int;
      attribute vec2 aGrid;
      uniform vec4 uGeoBounds;
      uniform vec4 uUvBounds;
      uniform vec2 uViewport;
      uniform vec2 uTranslate;
      uniform float uScale;
      uniform vec3 uRowX;
      uniform vec3 uRowY;
      uniform vec3 uRowZ;
      uniform vec2 uFlatCenter;
      uniform float uWorldOffset;
      uniform int uMode;
      varying vec2 vUv;
      varying float vDepth;
      void main() {
        float lon = mix(uGeoBounds.x, uGeoBounds.z, aGrid.x) * ${Math.PI / 180};
        float lat = mix(uGeoBounds.y, uGeoBounds.w, aGrid.y) * ${Math.PI / 180};
        vec2 screenPoint;
        if (uMode == 0) {
          vec3 point = vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat));
          screenPoint = uTranslate + uScale * vec2(dot(uRowX, point), dot(uRowY, point));
          vDepth = dot(uRowZ, point);
        } else {
          screenPoint = uTranslate + uScale * vec2(lon + uWorldOffset - uFlatCenter.x, -(lat - uFlatCenter.y));
          vDepth = 1.0;
        }
        vec2 clip = vec2(screenPoint.x * 2.0 / uViewport.x - 1.0, 1.0 - screenPoint.y * 2.0 / uViewport.y);
        gl_Position = vec4(clip, 0.0, 1.0);
        vUv = mix(uUvBounds.xy, uUvBounds.zw, aGrid);
      }`;
    const terrainFragmentSourceWebGl1 = `
      precision highp float;
      precision mediump int;
      varying vec2 vUv;
      varying float vDepth;
      uniform sampler2D uTerrain;
      uniform int uMode;
      uniform float uPhysicalStyle;
      uniform float uDarkTheme;
      void main() {
        if (uMode == 0 && vDepth < 0.0) discard;
        vec4 terrainSample = texture2D(uTerrain, vUv);
        vec3 neutral = vec3(terrainSample.a);
        vec3 color = mix(neutral, terrainSample.rgb, uPhysicalStyle);
        color = mix(color, color * vec3(0.60, 0.68, 0.76), uDarkTheme * 0.48);
        gl_FragColor = vec4(color, 1.0);
      }`;
    const hydroFragmentSourceWebGl2 = `#version 300 es
      precision highp float;
      precision highp int;
      in float vDepth;
      flat in uint vCountry;
      uniform sampler2D uHydroVisibility;
      uniform ivec2 uHydroVisibilitySize;
      uniform vec4 uHydroColor;
      uniform int uMode;
      out vec4 outColor;
      void main() {
        if (uMode == 0 && vDepth < 0.0) discard;
        int featureId = int(vCountry);
        ivec2 cell = ivec2(featureId % uHydroVisibilitySize.x, featureId / uHydroVisibilitySize.x);
        if (texelFetch(uHydroVisibility, cell, 0).a <= 0.0) discard;
        outColor = uHydroColor;
      }`;
    const hydroPickFragmentSourceWebGl2 = `#version 300 es
      precision highp float;
      precision highp int;
      in float vDepth;
      flat in uint vCountry;
      uniform sampler2D uHydroVisibility;
      uniform ivec2 uHydroVisibilitySize;
      uniform int uMode;
      out vec4 outColor;
      void main() {
        if (uMode == 0 && vDepth < 0.0) discard;
        int featureId = int(vCountry);
        ivec2 cell = ivec2(featureId % uHydroVisibilitySize.x, featureId / uHydroVisibilitySize.x);
        if (texelFetch(uHydroVisibility, cell, 0).a <= 0.0) discard;
        uint id = vCountry + 1u;
        outColor = vec4(float(id & 255u), float((id >> 8u) & 255u), float((id >> 16u) & 255u), 255.0) / 255.0;
      }`;
    const hydroFragmentSourceWebGl1 = `
      precision highp float;
      precision mediump int;
      varying float vDepth;
      varying float vCountry;
      uniform sampler2D uHydroVisibility;
      uniform vec2 uHydroVisibilitySize;
      uniform vec4 uHydroColor;
      uniform int uMode;
      void main() {
        if (uMode == 0 && vDepth < 0.0) discard;
        float featureId = floor(vCountry + 0.5);
        float x = mod(featureId, uHydroVisibilitySize.x);
        float y = floor(featureId / uHydroVisibilitySize.x);
        if (texture2D(uHydroVisibility, vec2((x + 0.5) / uHydroVisibilitySize.x, (y + 0.5) / uHydroVisibilitySize.y)).a <= 0.0) discard;
        gl_FragColor = uHydroColor;
      }`;
    const hydroPickFragmentSourceWebGl1 = `
      precision highp float;
      precision mediump int;
      varying float vDepth;
      varying float vCountry;
      uniform sampler2D uHydroVisibility;
      uniform vec2 uHydroVisibilitySize;
      uniform int uMode;
      void main() {
        if (uMode == 0 && vDepth < 0.0) discard;
        float featureId = floor(vCountry + 0.5);
        float x = mod(featureId, uHydroVisibilitySize.x);
        float y = floor(featureId / uHydroVisibilitySize.x);
        if (texture2D(uHydroVisibility, vec2((x + 0.5) / uHydroVisibilitySize.x, (y + 0.5) / uHydroVisibilitySize.y)).a <= 0.0) discard;
        float id = featureId + 1.0;
        gl_FragColor = vec4(mod(id, 256.0), mod(floor(id / 256.0), 256.0), mod(floor(id / 65536.0), 256.0), 255.0) / 255.0;
      }`;

    function compileShader(type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(shader) || 'shader compile failed';
        gl.deleteShader(shader);
        throw new Error(message);
      }
      return shader;
    }

    function createProgram(vertexSource, fragmentSource) {
      const program = gl.createProgram();
      const vertex = compileShader(gl.VERTEX_SHADER, vertexSource);
      const fragment = compileShader(gl.FRAGMENT_SHADER, fragmentSource);
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const message = gl.getProgramInfoLog(program) || 'program link failed';
        gl.deleteProgram(program);
        throw new Error(message);
      }
      return program;
    }

    function attach(nextCanvas) {
      canvas = nextCanvas;
      canvas.className = 'gpu-map-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      canvas.style.position = 'absolute';
      canvas.style.inset = '0';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      layoutMismatchCount = 0;
    }

    function replaceCanvas() {
      const replacement = document.createElement('canvas');
      canvas?.replaceWith(replacement);
      attach(replacement);
      gl = null;
      glVersion = 0;
      webGlContextKind = '';
      uintIndexExtension = null;
      instancedExtension = null;
      ctx2d = null;
      canvasWorkerBitmapContext = null;
      canvasWorker2dContext = null;
      return replacement;
    }

    function isWebGlRenderer() {
      return rendererMode === 'webgl2' || rendererMode === 'webgl1';
    }

    function rendererName() {
      return glVersion === 2 ? 'WebGL2' : glVersion === 1 ? 'WebGL1' : 'Canvas';
    }

    function updateRendererBadge(label, reason = '') {
      const status = $('engineStatus');
      if (!status) return;
      status.textContent = reason ? `${label} · ${reason}` : label;
      status.title = status.textContent;
    }

    function createWebGlResources() {
      const vertexSource = glVersion === 2 ? vertexShaderSourceWebGl2 : vertexShaderSourceWebGl1;
      fillProgram = createProgram(vertexSource, glVersion === 2 ? fillFragmentSourceWebGl2 : fillFragmentSourceWebGl1);
      lineProgram = createProgram(vertexSource, glVersion === 2 ? lineFragmentSourceWebGl2 : lineFragmentSourceWebGl1);
      pickProgram = createProgram(vertexSource, glVersion === 2 ? pickFragmentSourceWebGl2 : pickFragmentSourceWebGl1);
      terrainProgram = createProgram(
        glVersion === 2 ? terrainVertexSourceWebGl2 : terrainVertexSourceWebGl1,
        glVersion === 2 ? terrainFragmentSourceWebGl2 : terrainFragmentSourceWebGl1,
      );
      hydroFillProgram = createProgram(vertexSource, glVersion === 2 ? hydroFragmentSourceWebGl2 : hydroFragmentSourceWebGl1);
      hydroLineProgram = createProgram(
        glVersion === 2 ? hydroRibbonVertexSourceWebGl2 : hydroRibbonVertexSourceWebGl1,
        glVersion === 2 ? hydroFragmentSourceWebGl2 : hydroFragmentSourceWebGl1,
      );
      hydroPickProgram = createProgram(vertexSource, glVersion === 2 ? hydroPickFragmentSourceWebGl2 : hydroPickFragmentSourceWebGl1);
      hydroLinePickProgram = createProgram(
        glVersion === 2 ? hydroRibbonVertexSourceWebGl2 : hydroRibbonVertexSourceWebGl1,
        glVersion === 2 ? hydroPickFragmentSourceWebGl2 : hydroPickFragmentSourceWebGl1,
      );
      paletteTexture = gl.createTexture();
      hydroVisibilityTexture = gl.createTexture();
      hydroCornerBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, hydroCornerBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      positionBuffer = gl.createBuffer();
      countryBuffer = gl.createBuffer();
      fillIndexBuffer = gl.createBuffer();
      lineIndexBuffer = gl.createBuffer();
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.DEPTH_TEST);
      pickFramebuffer = null;
      pickTexture = null;
      terrainTiles.clear();
      terrainTileRequests.clear();
      terrainGridMeshes.clear();
      for (const entry of hydroPacks.values()) entry.resources = null;
    }

    function handleWebGlContextLost(event) {
      if (event.currentTarget !== canvas) return;
      event.preventDefault();
      webglContextLost = true;
      rendererMode = 'webgl-recovering';
      clearTimeout(webglRecoveryTimer);
      $('engineStatus').textContent = `${rendererName()} · 컨텍스트를 복구하는 중입니다.`;
      updateRendererBadge(`${rendererName()} · GPU를 복구하는 중입니다.`);
      setActionStatus('지도 GPU를 복구하는 중입니다.', 'working', 0);
      webglRecoveryTimer = setTimeout(() => {
        if (webglContextLost && rendererMode === 'webgl-recovering') {
          activateCanvasFallback('WebGL 컨텍스트 복구 시간 초과');
        }
      }, 5000);
    }

    function handleWebGlContextRestored(event) {
      if (event.currentTarget !== canvas || !webglContextLost) return;
      clearTimeout(webglRecoveryTimer);
      try {
        gl = canvas.getContext(webGlContextKind);
        if (!gl) throw new Error(`복구된 ${rendererName()} 컨텍스트를 가져올 수 없습니다.`);
        if (glVersion === 1) {
          uintIndexExtension = gl.getExtension('OES_element_index_uint');
          if (!uintIndexExtension) throw new Error('WebGL1 32비트 인덱스를 지원하지 않습니다.');
          instancedExtension = gl.getExtension('ANGLE_instanced_arrays');
          if (!instancedExtension) throw new Error('WebGL1 인스턴스 수계 렌더링을 지원하지 않습니다.');
        }
        createWebGlResources();
        webglContextLost = false;
        rendererMode = glVersion === 2 ? 'webgl2' : 'webgl1';
        if (mesh) setMesh(mesh, meshCountryIds);
        else render(currentRenderRevision);
        $('engineStatus').textContent = `Natural Earth 5.1.1 · ${rendererName()} 무손실`;
        updateRendererBadge(`${rendererName()} · GPU 실시간`);
        setActionStatus('지도 GPU를 복구했습니다.', 'success', 2200);
      } catch (error) {
        webglContextLost = false;
        activateCanvasFallback(`WebGL 컨텍스트 복구 실패: ${error?.message || error}`);
      }
    }

    function initWebGl(version) {
      const contextKind = version === 2 ? 'webgl2' : 'webgl';
      webGlContextKind = contextKind;
      gl = canvas.getContext(contextKind, {
        alpha: true,
        antialias: true,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
        premultipliedAlpha: true,
        powerPreference: 'high-performance',
      });
      if (!gl && version === 1) {
        webGlContextKind = 'experimental-webgl';
        gl = canvas.getContext(webGlContextKind);
      }
      if (!gl) throw new Error(`${version === 2 ? 'WebGL2' : 'WebGL1'}를 지원하지 않습니다.`);
      glVersion = version;
      uintIndexExtension = version === 1 ? gl.getExtension('OES_element_index_uint') : true;
      if (version === 1 && !uintIndexExtension) throw new Error('WebGL1 OES_element_index_uint를 지원하지 않습니다.');
      instancedExtension = version === 1 ? gl.getExtension('ANGLE_instanced_arrays') : true;
      if (version === 1 && !instancedExtension) throw new Error('WebGL1 ANGLE_instanced_arrays를 지원하지 않습니다.');
      createWebGlResources();
      canvas.addEventListener('webglcontextlost', handleWebGlContextLost);
      canvas.addEventListener('webglcontextrestored', handleWebGlContextRestored);
      webglContextLost = false;
      rendererMode = version === 2 ? 'webgl2' : 'webgl1';
    }

    function setMesh(nextMesh, countryIds) {
      mesh = nextMesh;
      meshCountryIds = [...countryIds];
      webGl1PositionData = null;
      webGl1CountryData = null;
      if (!gl || !isWebGlRenderer()) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      if (glVersion === 2) {
        gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
      } else {
        webGl1PositionData = new Float32Array(mesh.positions.length);
        for (let index = 0; index < mesh.positions.length; index += 1) webGl1PositionData[index] = mesh.positions[index];
        gl.bufferData(gl.ARRAY_BUFFER, webGl1PositionData, gl.STATIC_DRAW);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, countryBuffer);
      if (glVersion === 2) {
        gl.bufferData(gl.ARRAY_BUFFER, mesh.countryIndices, gl.STATIC_DRAW);
      } else {
        webGl1CountryData = new Float32Array(mesh.countryIndices.length);
        for (let index = 0; index < mesh.countryIndices.length; index += 1) webGl1CountryData[index] = mesh.countryIndices[index];
        gl.bufferData(gl.ARRAY_BUFFER, webGl1CountryData, gl.STATIC_DRAW);
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, fillIndexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.triangleIndices, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, lineIndexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.lineIndices, gl.STATIC_DRAW);

      fillVao = null;
      lineVao = null;
      if (glVersion === 2) {
        fillVao = gl.createVertexArray();
        gl.bindVertexArray(fillVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribIPointer(0, 2, gl.INT, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, countryBuffer);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_SHORT, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, fillIndexBuffer);

        lineVao = gl.createVertexArray();
        gl.bindVertexArray(lineVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribIPointer(0, 2, gl.INT, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, countryBuffer);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_SHORT, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, lineIndexBuffer);
        gl.bindVertexArray(null);
      }
      window.__ATLASWRIGHT_GPU_METRICS__ = getStats();
      render(currentRenderRevision);
    }

    async function decodeBuiltInMesh() {
      const buffer = window.ATLASWRIGHT_GPU_MESH_BUFFER;
      if (!(buffer instanceof ArrayBuffer)) throw new Error('외부 GPU 메시가 준비되지 않았습니다.');
      window.ATLASWRIGHT_GPU_MESH_BUFFER = null;
      const header = new Uint32Array(buffer, 0, 8);
      if (header[0] !== 0x434d4731 || header[1] !== 1 || header[2] !== 258 || header[6] !== 548471 || header[7] !== 2) {
        throw new Error('외부 GPU 메시 형식 또는 알고리즘 리비전이 올바르지 않습니다.');
      }
      const countryCount = header[2];
      const vertexCount = header[3];
      const triangleIndexCount = header[4];
      const lineIndexCount = header[5];
      let offset = 8 * 4;
      const positions = new Int32Array(buffer, offset, vertexCount * 2);
      offset += positions.byteLength;
      const countryIndices = new Uint16Array(buffer, offset, vertexCount);
      offset += (countryIndices.byteLength + 3) & ~3;
      const triangleIndices = new Uint32Array(buffer, offset, triangleIndexCount);
      offset += triangleIndices.byteLength;
      const lineIndices = new Uint32Array(buffer, offset, lineIndexCount);
      const ids = (window.ATLASWRIGHT_COUNTRIES?.features || []).slice(0, countryCount)
        .map((feature, index) => String(feature.properties?.editor_id || feature.properties?.iso_a3 || index));
      return { mesh: { positions, countryIndices, triangleIndices, lineIndices }, ids, sourceCoordinateCount: header[6] };
    }

    function createWorker() {
      if (worker) worker.terminate();
      worker = new Worker(runtimeAssetUrl('workers/gpu-mesh-worker.js'), {
        name: 'atlaswright-gpu-mesh',
      });
      return worker;
    }

    function rebuildFromCountries(features) {
      if (rendererMode === 'canvas-worker' && canvasWorker) {
        canvasWorker.postMessage({ type: 'data', features });
        renderCanvasWorker();
        return;
      }
      if (!isWebGlRenderer()) {
        render();
        return;
      }
      const token = ++rebuildToken;
      let currentWorker;
      try { currentWorker = createWorker(); }
      catch (error) {
        activateCanvasFallback(`동적 메시 준비 실패: ${error.message}`);
        return;
      }
      $('engineStatus').textContent = `${rendererName()} · 편집 메시를 계산하는 중입니다.`;
      currentWorker.onmessage = event => {
        if (event.data?.token !== token || token !== rebuildToken) return;
        currentWorker.terminate();
        worker = null;
        if (!event.data?.ok) {
          activateCanvasFallback(`동적 메시 실패: ${event.data?.message || '알 수 없는 오류'}`);
          return;
        }
        const next = event.data.mesh;
        setMesh({
          positions: new Int32Array(next.positions),
          countryIndices: new Uint16Array(next.countryIndices),
          triangleIndices: new Uint32Array(next.triangleIndices),
          lineIndices: new Uint32Array(next.lineIndices),
        }, next.countryIds || []);
        $('engineStatus').textContent = `Natural Earth 5.1.1 · ${rendererName()} 무손실`;
        updateRendererBadge(`${rendererName()} · GPU 실시간`);
      };
      currentWorker.onerror = event => {
        if (token !== rebuildToken) return;
        activateCanvasFallback(`동적 메시 워커 오류: ${event.message || '알 수 없는 오류'}`);
      };
      currentWorker.postMessage({ token, features });
    }

    function parseColor(value) {
      const match = /^#([0-9a-f]{6})$/i.exec(String(value || ''));
      if (!match) return parseColor(defaultCountryColor());
      const n = Number.parseInt(match[1], 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    function updatePalette() {
      if (!gl || !meshCountryIds.length) return;
      const pixels = new Uint8Array(meshCountryIds.length * 4);
      for (let index = 0; index < meshCountryIds.length; index += 1) {
        const feature = countryFeatureById(meshCountryIds[index]);
        const color = parseColor(feature ? countryColor(feature) : '#000000');
        pixels[index * 4] = color[0];
        pixels[index * 4 + 1] = color[1];
        pixels[index * 4 + 2] = color[2];
        pixels[index * 4 + 3] = feature && isCountryVisibleById(meshCountryIds[index]) ? mapTheme().fillAlphaByte : 0;
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, paletteTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const internalFormat = glVersion === 2 ? gl.RGBA8 : gl.RGBA;
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, Math.max(1, meshCountryIds.length), 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    }

    function rotationRows() {
      const projection = globeProjection;
      const translate = projection.translate();
      const scale = projection.scale();
      const basis = [[0, 0], [90, 0], [0, 90]].map(coord => projection(coord));
      const rowX = basis.map(point => (point[0] - translate[0]) / scale);
      const rowY = basis.map(point => (point[1] - translate[1]) / scale);
      const cross = [
        rowX[1] * rowY[2] - rowX[2] * rowY[1],
        rowX[2] * rowY[0] - rowX[0] * rowY[2],
        rowX[0] * rowY[1] - rowX[1] * rowY[0],
      ];
      const length = Math.hypot(...cross) || 1;
      const rowZ = cross.map(value => -value / length);
      return { rowX, rowY, rowZ, translate, scale };
    }

    function setViewUniforms(program, worldOffset = 0) {
      const mode = state.projection === 'globe' ? 0 : 1;
      const data = mode === 0
        ? rotationRows()
        : {
            rowX: [1, 0, 0], rowY: [0, 1, 0], rowZ: [0, 0, 1],
            translate: flatProjection.translate(), scale: flatProjection.scale(),
          };
      gl.uniform2f(gl.getUniformLocation(program, 'uViewport'), cssWidth, cssHeight);
      gl.uniform2f(gl.getUniformLocation(program, 'uTranslate'), data.translate[0], data.translate[1]);
      gl.uniform1f(gl.getUniformLocation(program, 'uScale'), data.scale);
      gl.uniform3fv(gl.getUniformLocation(program, 'uRowX'), data.rowX);
      gl.uniform3fv(gl.getUniformLocation(program, 'uRowY'), data.rowY);
      gl.uniform3fv(gl.getUniformLocation(program, 'uRowZ'), data.rowZ);
      gl.uniform2f(gl.getUniformLocation(program, 'uFlatCenter'), state.view.flatCenter[0] * PI / 180, state.view.flatCenter[1] * PI / 180);
      gl.uniform1f(gl.getUniformLocation(program, 'uWorldOffset'), worldOffset);
      gl.uniform1i(gl.getUniformLocation(program, 'uMode'), mode);
    }

    function resize() {
      if (!canvas) return;
      cssWidth = Math.max(1, state.size.width);
      cssHeight = Math.max(1, state.size.height);
      const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
      const nextWidth = Math.max(1, Math.round(cssWidth * dpr));
      const nextHeight = Math.max(1, Math.round(cssHeight * dpr));
      if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
        canvas.width = nextWidth;
        canvas.height = nextHeight;
        pickFramebuffer = null;
        pickTexture = null;
      }
      pixelWidth = nextWidth;
      pixelHeight = nextHeight;
      canvas.style.width = '100%';
      canvas.style.height = '100%';
    }

    function layoutMismatch() {
      const mapElement = $('map');
      if (!canvas || !mapElement?.isConnected || !canvas.isConnected) return 0;
      const mapRect = mapElement.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      return Math.max(
        Math.abs(mapRect.left - canvasRect.left),
        Math.abs(mapRect.top - canvasRect.top),
        Math.abs(mapRect.width - canvasRect.width),
        Math.abs(mapRect.height - canvasRect.height),
      );
    }

    function verifyLayout() {
      if (!canvas) return true;
      const mismatch = layoutMismatch();
      if (mismatch <= 0.5) {
        layoutMismatchCount = 0;
        return true;
      }
      canvas.style.position = 'absolute';
      canvas.style.inset = '0';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      resize();
      if (layoutVerificationFrame) cancelAnimationFrame(layoutVerificationFrame);
      layoutVerificationFrame = requestAnimationFrame(() => {
        layoutVerificationFrame = 0;
        if (layoutMismatch() <= 0.5) {
          layoutMismatchCount = 0;
          render(currentRenderRevision);
          return;
        }
        layoutMismatchCount += 1;
        if (layoutMismatchCount <= 3) {
          queueMapResize();
          verifyLayout();
        } else {
          console.warn('지도 레이어 크기를 완전히 맞추지 못했습니다.', layoutMismatch());
          layoutMismatchCount = 0;
        }
      });
      return false;
    }

    function bindWebGl1Attributes(program, indexBuffer) {
      const coordLocation = gl.getAttribLocation(program, 'aCoord');
      const countryLocation = gl.getAttribLocation(program, 'aCountry');
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      if (coordLocation >= 0) {
        gl.enableVertexAttribArray(coordLocation);
        gl.vertexAttribPointer(coordLocation, 2, gl.FLOAT, false, 0, 0);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, countryBuffer);
      if (countryLocation >= 0) {
        gl.enableVertexAttribArray(countryLocation);
        gl.vertexAttribPointer(countryLocation, 1, gl.FLOAT, false, 0, 0);
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      return [coordLocation, countryLocation];
    }

    function drawProgram(program, vao, indexBuffer, indexCount, primitive) {
      gl.useProgram(program);
      if (program === fillProgram || program === lineProgram || program === pickProgram) {
        gl.uniform1i(gl.getUniformLocation(program, 'uPalette'), 0);
        const paletteWidthLocation = gl.getUniformLocation(program, 'uPaletteWidth');
        if (paletteWidthLocation) gl.uniform1f(paletteWidthLocation, Math.max(1, meshCountryIds.length));
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, paletteTexture);
      }
      if (program === lineProgram) {
        const theme = mapTheme();
        gl.uniform4f(gl.getUniformLocation(program, 'uBorderColor'), theme.borderGpu[0], theme.borderGpu[1], theme.borderGpu[2], theme.borderAlpha);
      }
      const webGl1Locations = glVersion === 2 ? null : bindWebGl1Attributes(program, indexBuffer);
      if (glVersion === 2) gl.bindVertexArray(vao);
      const offsets = state.projection === 'globe' ? [0] : [-2 * PI, 0, 2 * PI];
      for (const offset of offsets) {
        setViewUniforms(program, offset);
        gl.drawElements(primitive, indexCount, gl.UNSIGNED_INT, 0);
      }
      if (glVersion === 2) gl.bindVertexArray(null);
      else {
        for (const location of webGl1Locations) if (location >= 0) gl.disableVertexAttribArray(location);
      }
    }

    function createHydroBuffer(data, target = gl.ARRAY_BUFFER) {
      const buffer = gl.createBuffer();
      gl.bindBuffer(target, buffer);
      gl.bufferData(target, data, gl.STATIC_DRAW);
      return buffer;
    }

    function uploadHydroPack(entry) {
      if (!gl || !isWebGlRenderer() || entry.resources) return;
      const meshData = entry.mesh;
      const riverStarts = glVersion === 2 ? meshData.riverStarts : Float32Array.from(meshData.riverStarts);
      const riverEnds = glVersion === 2 ? meshData.riverEnds : Float32Array.from(meshData.riverEnds);
      const riverFeatureIds = glVersion === 2 ? meshData.riverFeatureIds : Float32Array.from(meshData.riverFeatureIds);
      const lakePositions = glVersion === 2 ? meshData.lakePositions : Float32Array.from(meshData.lakePositions);
      const lakeFeatureIds = glVersion === 2 ? meshData.lakeFeatureIds : Float32Array.from(meshData.lakeFeatureIds);
      entry.resources = {
        riverStartBuffer: createHydroBuffer(riverStarts),
        riverEndBuffer: createHydroBuffer(riverEnds),
        riverFeatureBuffer: createHydroBuffer(riverFeatureIds),
        riverWidthBuffer: createHydroBuffer(meshData.riverWidths),
        riverSegmentCount: meshData.riverFeatureIds.length,
        lakePositionBuffer: createHydroBuffer(lakePositions),
        lakeFeatureBuffer: createHydroBuffer(lakeFeatureIds),
        lakeIndexBuffer: createHydroBuffer(meshData.lakeIndices, gl.ELEMENT_ARRAY_BUFFER),
        lakeIndexCount: meshData.lakeIndices.length,
      };
    }

    function deleteHydroPackResources(entry) {
      if (!entry?.resources || !gl) return;
      for (const key of ['riverStartBuffer', 'riverEndBuffer', 'riverFeatureBuffer', 'riverWidthBuffer', 'lakePositionBuffer', 'lakeFeatureBuffer', 'lakeIndexBuffer']) {
        if (entry.resources[key]) gl.deleteBuffer(entry.resources[key]);
      }
      entry.resources = null;
    }

    function updateHydroVisibility() {
      if (!gl || !hydroVisibilityTexture || !hydroManifest) return;
      const count = Math.max(1, Number(hydroManifest.stats?.featureCount || 1));
      hydroVisibilityWidth = Math.min(4096, Math.max(1, count));
      hydroVisibilityHeight = Math.ceil(count / hydroVisibilityWidth);
      const pixels = new Uint8Array(hydroVisibilityWidth * hydroVisibilityHeight * 4);
      for (const feature of state.hydroFeatureCache?.values?.() || []) {
        const fid = Number(feature.properties?.__fid);
        if (!Number.isInteger(fid) || fid < 0 || fid >= count || !isHydroFeatureVisible(feature)) continue;
        const offset = fid * 4;
        pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = pixels[offset + 3] = 255;
      }
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, hydroVisibilityTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const internalFormat = glVersion === 2 ? gl.RGBA8 : gl.RGBA;
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, hydroVisibilityWidth, hydroVisibilityHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    }

    function bindLakeAttributes(program, resources) {
      const coordLocation = glVersion === 2 ? 0 : gl.getAttribLocation(program, 'aCoord');
      const featureLocation = glVersion === 2 ? 1 : gl.getAttribLocation(program, 'aCountry');
      gl.bindBuffer(gl.ARRAY_BUFFER, resources.lakePositionBuffer);
      gl.enableVertexAttribArray(coordLocation);
      if (glVersion === 2) gl.vertexAttribIPointer(coordLocation, 2, gl.INT, 0, 0);
      else gl.vertexAttribPointer(coordLocation, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, resources.lakeFeatureBuffer);
      gl.enableVertexAttribArray(featureLocation);
      if (glVersion === 2) gl.vertexAttribIPointer(featureLocation, 1, gl.UNSIGNED_INT, 0, 0);
      else gl.vertexAttribPointer(featureLocation, 1, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, resources.lakeIndexBuffer);
      return [coordLocation, featureLocation];
    }

    function setHydroUniforms(program, color) {
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, hydroVisibilityTexture);
      gl.uniform1i(gl.getUniformLocation(program, 'uHydroVisibility'), 2);
      const sizeLocation = gl.getUniformLocation(program, 'uHydroVisibilitySize');
      if (glVersion === 2) gl.uniform2i(sizeLocation, hydroVisibilityWidth, hydroVisibilityHeight);
      else gl.uniform2f(sizeLocation, hydroVisibilityWidth, hydroVisibilityHeight);
      const colorLocation = gl.getUniformLocation(program, 'uHydroColor');
      if (colorLocation && color) gl.uniform4fv(colorLocation, color);
    }

    function setInstanceDivisor(location, divisor) {
      if (glVersion === 2) gl.vertexAttribDivisor(location, divisor);
      else instancedExtension.vertexAttribDivisorANGLE(location, divisor);
    }

    function bindRiverAttributes(program, resources) {
      const locations = glVersion === 2 ? [0, 1, 2, 3, 4] : [
        gl.getAttribLocation(program, 'aCorner'), gl.getAttribLocation(program, 'aStart'),
        gl.getAttribLocation(program, 'aEnd'), gl.getAttribLocation(program, 'aCountry'),
        gl.getAttribLocation(program, 'aWidth'),
      ];
      const [corner, start, end, feature, width] = locations;
      gl.bindBuffer(gl.ARRAY_BUFFER, hydroCornerBuffer);
      gl.enableVertexAttribArray(corner);
      gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, resources.riverStartBuffer);
      gl.enableVertexAttribArray(start);
      if (glVersion === 2) gl.vertexAttribIPointer(start, 2, gl.INT, 0, 0);
      else gl.vertexAttribPointer(start, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, resources.riverEndBuffer);
      gl.enableVertexAttribArray(end);
      if (glVersion === 2) gl.vertexAttribIPointer(end, 2, gl.INT, 0, 0);
      else gl.vertexAttribPointer(end, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, resources.riverFeatureBuffer);
      gl.enableVertexAttribArray(feature);
      if (glVersion === 2) gl.vertexAttribIPointer(feature, 1, gl.UNSIGNED_INT, 0, 0);
      else gl.vertexAttribPointer(feature, 1, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, resources.riverWidthBuffer);
      gl.enableVertexAttribArray(width);
      gl.vertexAttribPointer(width, 1, gl.FLOAT, false, 0, 0);
      setInstanceDivisor(corner, 0);
      for (const location of [start, end, feature, width]) setInstanceDivisor(location, 1);
      return locations;
    }

    function drawHydroEntry(program, entry, category, color = null, picking = false) {
      uploadHydroPack(entry);
      const resources = entry.resources;
      if (!resources) return;
      const count = category === 'lake' ? resources.lakeIndexCount : resources.riverSegmentCount;
      if (!count) return;
      setHydroUniforms(program, color);
      const locations = category === 'lake' ? bindLakeAttributes(program, resources) : bindRiverAttributes(program, resources);
      const widthBoostLocation = gl.getUniformLocation(program, 'uWidthBoost');
      if (widthBoostLocation) gl.uniform1f(widthBoostLocation, picking ? 6 : 0);
      const offsets = state.projection === 'globe' ? [0] : [-2 * PI, 0, 2 * PI];
      for (const offset of offsets) {
        setViewUniforms(program, offset);
        if (category === 'lake') gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_INT, 0);
        else if (glVersion === 2) gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
        else instancedExtension.drawArraysInstancedANGLE(gl.TRIANGLE_STRIP, 0, 4, count);
      }
      if (category === 'river') for (const location of locations.slice(1)) setInstanceDivisor(location, 0);
      for (const location of locations) gl.disableVertexAttribArray(location);
      entry.lastUsed = performance.now();
    }

    function drawHydro(category, picking = false) {
      if (!hydroManifest || !hydroActivePackIds.size || !state.layerVisibility.drawings) return;
      updateHydroVisibility();
      const program = category === 'river'
        ? (picking ? hydroLinePickProgram : hydroLineProgram)
        : (picking ? hydroPickProgram : hydroFillProgram);
      const color = category === 'lake' ? [0.353, 0.663, 0.839, 0.92] : [0.231, 0.510, 0.769, 0.96];
      for (const packId of hydroActivePackIds) {
        const entry = hydroPacks.get(packId);
        if (entry) drawHydroEntry(program, entry, category, color, picking);
      }
    }

    function hydroVisibleTileSpecs() {
      if (!hydroManifest?.stages?.length) return [];
      const threshold = hydroVisibilityThreshold();
      const flatScale = Math.max(1, flatProjection.scale());
      const flatHalfLon = state.size.width / flatScale * 90 / Math.PI + 2;
      const flatHalfLat = state.size.height / flatScale * 90 / Math.PI + 2;
      const flatCenter = state.view.flatCenter || [0, 0];
      const globeCenter = [-Number(state.view.globeRotation?.[0] || 0), -Number(state.view.globeRotation?.[1] || 0)];
      const globeRadius = Math.asin(Math.min(1, Math.hypot(state.size.width, state.size.height) * 0.5 / Math.max(1, globeProjection.scale())));
      const specs = [];
      for (const stage of hydroManifest.stages) {
        if (Number(stage.minZoom) > threshold + 1e-9) continue;
        const tileLon = 360 / stage.columns;
        const tileLat = 180 / stage.rows;
        for (let y = 0; y < stage.rows; y += 1) {
          const centerLat = 90 - (y + 0.5) * tileLat;
          for (let x = 0; x < stage.columns; x += 1) {
            const centerLon = -180 + (x + 0.5) * tileLon;
            let visible;
            if (state.projection === 'flat') {
              const deltaLon = Math.abs((((centerLon - flatCenter[0]) + 540) % 360) - 180);
              visible = deltaLon <= flatHalfLon + tileLon / 2 && Math.abs(centerLat - flatCenter[1]) <= flatHalfLat + tileLat / 2;
            } else {
              const tileRadius = Math.hypot(tileLon, tileLat) * Math.PI / 360;
              visible = d3.geo.distance(globeCenter, [centerLon, centerLat]) <= globeRadius + tileRadius + 0.04;
            }
            if (visible) specs.push({ stage: Number(stage.id), x, y });
          }
        }
      }
      return specs;
    }

    function requestHydroView() {
      if (!hydroWorker || !hydroWorkerReady || !hydroManifest) return;
      const tiles = hydroVisibleTileSpecs();
      const key = tiles.map(spec => `${spec.stage}/${spec.x}-${spec.y}`).join('|');
      if (key === hydroViewKey) return;
      hydroViewKey = key;
      const message = { type: 'view', revision: ++hydroRequestRevision, tiles };
      hydroPendingView = message;
      hydroWorker.postMessage(message);
    }

    let hydroRenderFrame = 0;
    function queueHydroRender() {
      if (hydroRenderFrame) return;
      hydroRenderFrame = requestAnimationFrame(() => {
        hydroRenderFrame = 0;
        renderAll();
      });
    }

    function receiveHydroWorkerMessage(event) {
      const message = event.data || {};
      if (message.type === 'ready') {
        hydroWorkerReady = true;
        hydroViewKey = '';
        requestHydroView();
        return;
      }
      if (message.type === 'active') {
        hydroActivePackIds = new Set(message.packIds || []);
        pruneHydroCache();
        queueHydroRender();
        return;
      }
      if (message.type === 'pack') {
        const meshData = message.mesh || {};
        const features = (message.features || []).map(prepareHydroFeature);
        const entry = {
          id: Number(message.packId), features, resources: null, lastUsed: performance.now(),
          mesh: {
            riverStarts: new Int32Array(meshData.riverStarts || 0),
            riverEnds: new Int32Array(meshData.riverEnds || 0),
            riverFeatureIds: new Uint32Array(meshData.riverFeatureIds || 0),
            riverWidths: new Float32Array(meshData.riverWidths || 0),
            lakePositions: new Int32Array(meshData.lakePositions || 0),
            lakeFeatureIds: new Uint32Array(meshData.lakeFeatureIds || 0),
            lakeIndices: new Uint32Array(meshData.lakeIndices || 0),
          },
        };
        entry.byteLength = Object.values(entry.mesh).reduce((sum, value) => sum + value.byteLength, 0)
          + Number(message.sourceBytesEstimate || 0);
        hydroPacks.set(entry.id, entry);
        for (const feature of features) {
          const id = String(feature.properties?.aw_id || feature.id);
          state.hydroFeatureCache.set(id, feature);
          state.hydroFeatureByFid.set(Number(feature.properties?.__fid), feature);
        }
        if (isWebGlRenderer()) uploadHydroPack(entry);
        pruneHydroCache();
        queueHydroRender();
        return;
      }
      if (message.type === 'error') {
        console.warn('Hydro tile worker failed', message.message);
        setActionStatus(`현재 화면의 수계 데이터를 불러올 수 없습니다. 지도를 조금 이동하거나 다시 시도하세요. ${message.message || ''}`, 'error', 0);
      }
    }

    function pruneHydroCache() {
      const limit = (isMobile() ? 48 : 96) * 1024 * 1024;
      let total = [...hydroPacks.values()].reduce((sum, entry) => sum + entry.byteLength, 0);
      if (total <= limit) return;
      const selectedPack = state.selected?.type === 'hydro' ? Number(hydroFeatureById(state.selected.id)?.properties?.pack_id) : -1;
      const candidates = [...hydroPacks.values()]
        .filter(entry => !hydroActivePackIds.has(entry.id) && entry.id !== selectedPack)
        .sort((left, right) => left.lastUsed - right.lastUsed);
      const released = [];
      for (const entry of candidates) {
        if (total <= limit) break;
        deleteHydroPackResources(entry);
        hydroPacks.delete(entry.id);
        for (const feature of entry.features) {
          state.hydroFeatureCache.delete(String(feature.properties?.aw_id || feature.id));
          state.hydroFeatureByFid.delete(Number(feature.properties?.__fid));
        }
        total -= entry.byteLength;
        released.push(entry.id);
      }
      if (released.length) hydroWorker?.postMessage({ type: 'release', packIds: released });
    }

    function setHydroManifest(nextManifest, sourceUrl) {
      hydroManifest = nextManifest?.stages?.length ? nextManifest : null;
      hydroManifestUrl = sourceUrl ? new URL(sourceUrl) : null;
      hydroWorker?.terminate();
      hydroWorker = null;
      hydroWorkerReady = false;
      hydroViewKey = '';
      hydroActivePackIds.clear();
      for (const entry of hydroPacks.values()) deleteHydroPackResources(entry);
      hydroPacks.clear();
      if (!hydroManifest || !hydroManifestUrl || typeof Worker !== 'function') return;
      hydroWorker = new Worker(runtimeAssetUrl('workers/hydro-tile-worker.js'), { name: 'atlaswright-hydro-tiles' });
      hydroWorker.onmessage = receiveHydroWorkerMessage;
      hydroWorker.onerror = event => receiveHydroWorkerMessage({ data: { type: 'error', message: event.message || '수계 Worker 실행 오류' } });
      hydroWorker.postMessage({ type: 'init', manifest: hydroManifest, baseUrl: new URL('./', hydroManifestUrl).href, assetRevision: ASSET_REVISION });
    }

    function terrainLevelForView() {
      if (!terrainManifest?.levels?.length) return null;
      const scale = activeProjection().scale();
      const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
      const desiredWidth = Math.max(1, 2 * PI * scale * dpr);
      return terrainManifest.levels.find(level => level.width >= desiredWidth * 1.12)
        || terrainManifest.levels[terrainManifest.levels.length - 1];
    }

    function terrainTileSpec(level, column, row) {
      const x0 = column * level.tileSize;
      const y0 = row * level.tileSize;
      const x1 = Math.min(level.width, x0 + level.tileSize);
      const y1 = Math.min(level.height, y0 + level.tileSize);
      return {
        key: `${level.id}/${column}-${row}`,
        level: level.id,
        column,
        row,
        pixelWidth: x1 - x0,
        pixelHeight: y1 - y0,
        bounds: [
          -180 + x0 / level.width * 360,
          90 - y0 / level.height * 180,
          -180 + x1 / level.width * 360,
          90 - y1 / level.height * 180,
        ],
      };
    }

    function visibleTerrainTileSpecs(level, includeAll = false) {
      const specs = [];
      const projection = activeProjection();
      const scale = projection.scale();
      const flatHalfLon = cssWidth / Math.max(1, scale) * 90 / PI;
      const flatHalfLat = cssHeight / Math.max(1, scale) * 90 / PI;
      const globeCenter = [-Number(state.view.globeRotation?.[0] || 0), -Number(state.view.globeRotation?.[1] || 0)];
      const globeRadius = Math.asin(Math.min(1, Math.hypot(cssWidth, cssHeight) * 0.5 / Math.max(1, scale)));
      for (let row = 0; row < level.rows; row += 1) {
        for (let column = 0; column < level.columns; column += 1) {
          const spec = terrainTileSpec(level, column, row);
          if (includeAll) {
            specs.push(spec);
            continue;
          }
          const [west, north, east, south] = spec.bounds;
          const center = [(west + east) / 2, (north + south) / 2];
          const halfLon = (east - west) / 2;
          const halfLat = (north - south) / 2;
          if (state.projection === 'flat') {
            const deltaLon = Math.abs((((center[0] - state.view.flatCenter[0]) + 540) % 360) - 180);
            const deltaLat = Math.abs(center[1] - state.view.flatCenter[1]);
            if (deltaLon <= flatHalfLon + halfLon + 2 && deltaLat <= flatHalfLat + halfLat + 2) specs.push(spec);
          } else {
            const padding = Math.hypot(halfLon, halfLat) * PI / 180;
            if (d3.geo.distance(globeCenter, center) <= globeRadius + padding + 0.04) specs.push(spec);
          }
        }
      }
      return specs;
    }

    function terrainTileUrl(spec) {
      const relative = terrainManifest.urlTemplate
        .replace('{level}', String(spec.level))
        .replace('{column}', String(spec.column))
        .replace('{row}', String(spec.row));
      const url = new URL(relative, PHYSICAL_DATA_BASE_URL);
      url.searchParams.set('v', terrainManifest.version || APP_VERSION);
      return url;
    }

    async function requestTerrainTile(spec) {
      if (!gl || terrainTiles.has(spec.key) || terrainTileRequests.has(spec.key)) return;
      const request = (async () => {
        const response = await fetch(terrainTileUrl(spec));
        if (!response.ok) throw new Error(`지형 타일 HTTP ${response.status}`);
        const blob = await response.blob();
        let bitmap;
        try { bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }); }
        catch (_) { bitmap = await createImageBitmap(blob); }
        if (!gl || !isWebGlRenderer()) {
          bitmap.close?.();
          return;
        }
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
        bitmap.close?.();
        terrainTiles.set(spec.key, { texture, lastUsed: performance.now() });
        while (terrainTiles.size > 96) {
          const oldest = [...terrainTiles.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
          if (!oldest || oldest[0] === spec.key) break;
          gl.deleteTexture(oldest[1].texture);
          terrainTiles.delete(oldest[0]);
        }
        scheduleRender();
      })().catch(error => {
        console.warn(`지형 타일을 불러오지 못했습니다: ${spec.key}`, error);
      }).finally(() => terrainTileRequests.delete(spec.key));
      terrainTileRequests.set(spec.key, request);
    }

    function terrainGridMesh(spec) {
      const spanLon = Math.abs(spec.bounds[2] - spec.bounds[0]);
      const spanLat = Math.abs(spec.bounds[1] - spec.bounds[3]);
      const stepsX = Math.max(1, Math.ceil(spanLon / 0.499));
      const stepsY = Math.max(1, Math.ceil(spanLat / 0.499));
      const key = `${stepsX}x${stepsY}`;
      if (terrainGridMeshes.has(key)) return terrainGridMeshes.get(key);
      const vertices = new Float32Array((stepsX + 1) * (stepsY + 1) * 2);
      let vertexOffset = 0;
      for (let y = 0; y <= stepsY; y += 1) {
        for (let x = 0; x <= stepsX; x += 1) {
          vertices[vertexOffset++] = x / stepsX;
          vertices[vertexOffset++] = y / stepsY;
        }
      }
      const indices = new Uint32Array(stepsX * stepsY * 6);
      let indexOffset = 0;
      for (let y = 0; y < stepsY; y += 1) {
        for (let x = 0; x < stepsX; x += 1) {
          const a = y * (stepsX + 1) + x;
          const b = a + 1;
          const c = a + stepsX + 1;
          const d = c + 1;
          indices[indexOffset++] = a; indices[indexOffset++] = c; indices[indexOffset++] = b;
          indices[indexOffset++] = b; indices[indexOffset++] = c; indices[indexOffset++] = d;
        }
      }
      const vertexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
      const indexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
      const meshEntry = { vertexBuffer, indexBuffer, indexCount: indices.length };
      terrainGridMeshes.set(key, meshEntry);
      return meshEntry;
    }

    function drawTerrainTile(spec) {
      const tile = terrainTiles.get(spec.key);
      if (!tile || !terrainProgram) return false;
      tile.lastUsed = performance.now();
      const grid = terrainGridMesh(spec);
      gl.useProgram(terrainProgram);
      const gridLocation = glVersion === 2 ? 0 : gl.getAttribLocation(terrainProgram, 'aGrid');
      gl.bindBuffer(gl.ARRAY_BUFFER, grid.vertexBuffer);
      gl.enableVertexAttribArray(gridLocation);
      gl.vertexAttribPointer(gridLocation, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, grid.indexBuffer);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, tile.texture);
      gl.uniform1i(gl.getUniformLocation(terrainProgram, 'uTerrain'), 1);
      const [west, north, east, south] = spec.bounds;
      gl.uniform4f(gl.getUniformLocation(terrainProgram, 'uGeoBounds'), west, north, east, south);
      const gutter = Number(terrainManifest.gutter || 0);
      const u0 = gutter / (spec.pixelWidth + gutter * 2);
      const v0 = gutter / (spec.pixelHeight + gutter * 2);
      const u1 = (gutter + spec.pixelWidth) / (spec.pixelWidth + gutter * 2);
      const v1 = (gutter + spec.pixelHeight) / (spec.pixelHeight + gutter * 2);
      gl.uniform4f(gl.getUniformLocation(terrainProgram, 'uUvBounds'), u0, v0, u1, v1);
      gl.uniform1f(gl.getUniformLocation(terrainProgram, 'uPhysicalStyle'), state.physicalSettings.terrainStyle === 'physical' ? 1 : 0);
      gl.uniform1f(gl.getUniformLocation(terrainProgram, 'uDarkTheme'), systemTheme === 'dark' ? 1 : 0);
      const offsets = state.projection === 'globe' ? [0] : [-2 * PI, 0, 2 * PI];
      for (const offset of offsets) {
        setViewUniforms(terrainProgram, offset);
        gl.drawElements(gl.TRIANGLES, grid.indexCount, gl.UNSIGNED_INT, 0);
      }
      gl.disableVertexAttribArray(gridLocation);
      return true;
    }

    function renderTerrain() {
      if (!state.physicalSettings.terrainVisible || !terrainManifest?.levels?.length || !terrainProgram) return;
      const baseLevel = terrainManifest.levels[0];
      const targetLevel = terrainLevelForView() || baseLevel;
      terrainLastLevel = Number(targetLevel.id);
      const baseSpecs = visibleTerrainTileSpecs(baseLevel, true);
      const targetSpecs = Number(targetLevel.id) === Number(baseLevel.id) ? [] : visibleTerrainTileSpecs(targetLevel);
      for (const spec of [...baseSpecs, ...targetSpecs]) requestTerrainTile(spec);
      for (const spec of baseSpecs) drawTerrainTile(spec);
      for (const spec of targetSpecs) drawTerrainTile(spec);
    }

    function renderWebGl() {
      if (!gl || !mesh) return;
      resize();
      requestHydroView();
      const started = performance.now();
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, pixelWidth, pixelHeight);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.BLEND);
      renderTerrain();
      updatePalette();
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      if (state.layerVisibility.countries) {
        drawProgram(fillProgram, fillVao, fillIndexBuffer, mesh.triangleIndices.length, gl.TRIANGLES);
      }
      drawHydro('lake');
      drawHydro('river');
      if (state.layerVisibility.countries) drawProgram(lineProgram, lineVao, lineIndexBuffer, mesh.lineIndices.length, gl.LINES);
      gl.flush();
      displayedRenderRevision = currentRenderRevision;
      frameTimes.push(performance.now() - started);
      if (frameTimes.length > 240) frameTimes.shift();
      window.__ATLASWRIGHT_GPU_METRICS__ = getStats();
    }

    function renderCanvasFallback() {
      if (!ctx2d || !canvas) return;
      resize();
      const dpr = pixelWidth / cssWidth;
      ctx2d.setTransform(1, 0, 0, 1, 0, 0);
      ctx2d.clearRect(0, 0, pixelWidth, pixelHeight);
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!state.layerVisibility.countries) return;
      const canvasPath = d3.geo.path().projection(activeProjection()).context(ctx2d);
      const theme = mapTheme();
      ctx2d.lineJoin = 'round';
      ctx2d.lineWidth = 0.72;
      for (const feature of state.countriesData?.features || []) {
        if (!isLayerItemVisible('countries', feature.properties?.editor_id || '')) continue;
        ctx2d.beginPath();
        canvasPath(feature);
        ctx2d.globalAlpha = theme.fillAlpha;
        ctx2d.fillStyle = countryColor(feature);
        ctx2d.fill();
        ctx2d.globalAlpha = theme.borderAlpha;
        ctx2d.strokeStyle = theme.border;
        ctx2d.stroke();
      }
      ctx2d.globalAlpha = 1;
      displayedRenderRevision = currentRenderRevision;
    }

    function canvasWorkerRenderMessage(type = 'render', revision = currentRenderRevision) {
      const colors = {};
      for (const feature of state.countriesData?.features || []) {
        colors[String(feature.properties?.editor_id || feature.properties?.iso_a3 || '')] = countryColor(feature);
      }
      return {
        type,
        width: Math.max(1, state.size.width),
        height: Math.max(1, state.size.height),
        dpr: Math.min(3, Math.max(1, window.devicePixelRatio || 1)),
        projection: state.projection,
        view: deepClone(state.view),
        revision: Number(revision || 0),
        visible: !!state.layerVisibility.countries,
        hiddenCountryIds: Object.keys(state.itemVisibility.countries || {}).filter(id => state.itemVisibility.countries[id] === false),
        colors,
        theme: mapTheme(),
        physicalSettings: deepClone(state.physicalSettings),
        darkTheme: systemTheme === 'dark',
        terrainManifestUrl: new URL('terrain/v0.12.0/manifest.json', PHYSICAL_DATA_BASE_URL).href,
      };
    }

    function postCanvasWorkerFrame(message) {
      if (!canvasWorker || !canvasWorkerReady) {
        canvasWorkerPendingMessage = message;
        return;
      }
      canvasWorkerBusy = true;
      canvasWorker.postMessage(message);
    }

    function renderCanvasWorker(revision = currentRenderRevision) {
      if (!canvasWorker) return;
      resize();
      const message = canvasWorkerRenderMessage('render', revision);
      canvasWorkerLatestRequestedRevision = Math.max(canvasWorkerLatestRequestedRevision, message.revision);
      if (!canvasWorkerReady || canvasWorkerBusy) {
        canvasWorkerPendingMessage = message;
        return;
      }
      postCanvasWorkerFrame(message);
    }

    function render(revision = currentRenderRevision) {
      currentRenderRevision = Math.max(currentRenderRevision, Number(revision || 0));
      requestHydroView();
      if (isWebGlRenderer()) renderWebGl();
      else if (rendererMode === 'canvas-worker') renderCanvasWorker(currentRenderRevision);
      else if (rendererMode === 'canvas2d') renderCanvasFallback();
    }

    function prioritizeLatest() {
      if (rendererMode !== 'canvas-worker' || !canvasWorker) return;
      const message = canvasWorkerRenderMessage('render', currentRenderRevision);
      canvasWorkerLatestRequestedRevision = Math.max(canvasWorkerLatestRequestedRevision, message.revision);
      if (!canvasWorkerReady || canvasWorkerBusy) {
        if (!canvasWorkerPendingMessage || canvasWorkerPendingMessage.revision <= message.revision) {
          canvasWorkerPendingMessage = message;
        }
        return;
      }
      postCanvasWorkerFrame(message);
    }

    function failCanvasWorker(message) {
      console.warn('Canvas worker failed', message);
      canvasWorker?.terminate();
      canvasWorker = null;
      canvasWorkerReady = false;
      canvasWorkerBusy = false;
      canvasWorkerPendingMessage = null;
      replaceCanvas();
      rendererMode = 'canvas2d';
      resize();
      ctx2d = canvas.getContext('2d', { alpha: true });
      if (!ctx2d) throw new Error('Canvas 대체 렌더러도 사용할 수 없습니다.');
      $('engineStatus').textContent = `Canvas 무손실 대체 · ${fallbackReason}`;
      updateRendererBadge('Canvas · 무손실 대체', fallbackReason);
      setActionStatus(`무손실 Canvas 렌더러로 전환했습니다. 사유: ${fallbackReason}`, 'working', 4200);
      renderCanvasFallback();
    }

    function receiveCanvasWorkerMessage(event) {
      const message = event.data || {};
      if (message.type === 'ready') {
        canvasWorkerReady = true;
        const pending = canvasWorkerPendingMessage || canvasWorkerRenderMessage('render', currentRenderRevision);
        canvasWorkerPendingMessage = null;
        postCanvasWorkerFrame(pending);
        return;
      }
      if (message.type === 'terrain-ready') {
        renderCanvasWorker(currentRenderRevision);
        return;
      }
      if (message.type === 'terrain-warning') {
        console.warn('Canvas 지형 타일을 불러오지 못했습니다.', message.message || '알 수 없는 오류');
        return;
      }
      if (message.type === 'error') {
        failCanvasWorker(message.message || 'Canvas Worker 렌더링 오류');
        return;
      }
      if (message.type !== 'frame') return;
      canvasWorkerBusy = false;
      const revision = Number(message.revision || 0);
      const canDisplay = revision >= canvasWorkerDisplayedRevision;
      if (canDisplay && message.bitmap) {
        if (canvasWorkerBitmapContext) {
          canvasWorkerBitmapContext.transferFromImageBitmap(message.bitmap);
        } else if (canvasWorker2dContext) {
          canvasWorker2dContext.setTransform(1, 0, 0, 1, 0, 0);
          canvasWorker2dContext.clearRect(0, 0, canvas.width, canvas.height);
          canvasWorker2dContext.drawImage(message.bitmap, 0, 0, canvas.width, canvas.height);
          message.bitmap.close?.();
        }
        canvasWorkerDisplayedRevision = revision;
        displayedRenderRevision = revision;
      } else {
        message.bitmap?.close?.();
      }
      const pending = canvasWorkerPendingMessage;
      canvasWorkerPendingMessage = null;
      if (pending) postCanvasWorkerFrame(pending);
    }

    function activateCanvasFallback(reason) {
      fallbackReason = reason || 'GPU 미지원';
      clearTimeout(webglRecoveryTimer);
      webglContextLost = false;
      canvasWorker?.terminate();
      canvasWorker = null;
      canvasWorkerReady = false;
      canvasWorkerBusy = false;
      canvasWorkerPendingMessage = null;
      if (canvasWorkerUrl) URL.revokeObjectURL(canvasWorkerUrl);
      canvasWorkerUrl = null;
      if (canvas) replaceCanvas();
      if (typeof Worker === 'function' && typeof OffscreenCanvas === 'function') {
        try {
          rendererMode = 'canvas-worker';
          resize();
          const canvasRuntimeUrl = runtimeAssetUrl('workers/canvas-render-worker.js');
          canvasRuntimeUrl.searchParams.set('physical', '1');
          canvasWorker = new Worker(canvasRuntimeUrl, {
            name: 'atlaswright-canvas-renderer',
          });
          canvasWorkerReady = false;
          canvasWorkerBusy = false;
          canvasWorkerPendingMessage = canvasWorkerRenderMessage('render', currentRenderRevision);
          canvasWorkerLatestRequestedRevision = currentRenderRevision;
          canvasWorkerDisplayedRevision = 0;
          canvasWorkerBitmapContext = canvas.getContext('bitmaprenderer');
          if (!canvasWorkerBitmapContext) canvasWorker2dContext = canvas.getContext('2d', { alpha: true });
          if (!canvasWorkerBitmapContext && !canvasWorker2dContext) throw new Error('Canvas 표시 컨텍스트를 만들 수 없습니다.');
          const initMessage = canvasWorkerRenderMessage('init');
          initMessage.features = state.countriesData?.features || [];
          canvasWorker.postMessage(initMessage);
          canvasWorker.onmessage = receiveCanvasWorkerMessage;
          canvasWorker.onerror = event => failCanvasWorker(event.message || 'Canvas Worker 실행 오류');
          $('engineStatus').textContent = `Canvas Worker 무손실 · ${fallbackReason}`;
          updateRendererBadge('Canvas Worker · 완성 프레임 즉시 표시', fallbackReason);
          setActionStatus(`무손실 Canvas Worker로 전환했습니다. 사유: ${fallbackReason}`, 'working', 4200);
          return;
        } catch (error) {
          console.warn('Canvas worker unavailable', error);
          canvasWorker?.terminate();
          canvasWorker = null;
          replaceCanvas();
        }
      }
      rendererMode = 'canvas2d';
      ctx2d = canvas.getContext('2d', { alpha: true });
      if (!ctx2d) throw new Error('Canvas 대체 렌더러도 사용할 수 없습니다.');
      $('engineStatus').textContent = `Canvas 무손실 대체 · ${fallbackReason}`;
      updateRendererBadge('Canvas · 무손실 대체', fallbackReason);
      setActionStatus('GPU를 사용할 수 없어 무손실 Canvas 렌더러로 전환했습니다.', 'working', 4200);
      renderCanvasFallback();
    }

    function ensurePickTarget() {
      if (pickFramebuffer && pickTexture) return;
      pickFramebuffer = gl.createFramebuffer();
      pickTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, pickTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      const internalFormat = glVersion === 2 ? gl.RGBA8 : gl.RGBA;
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, pixelWidth, pixelHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, pickFramebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pickTexture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('GPU 선택 버퍼 생성 실패');
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    function pick(screenPoint) {
      if (!isWebGlRenderer() || !gl || !mesh || !state.layerVisibility.countries) return null;
      resize();
      try { ensurePickTarget(); } catch (_) { return null; }
      gl.bindFramebuffer(gl.FRAMEBUFFER, pickFramebuffer);
      gl.viewport(0, 0, pixelWidth, pixelHeight);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      drawProgram(pickProgram, fillVao, fillIndexBuffer, mesh.triangleIndices.length, gl.TRIANGLES);
      const dpr = pixelWidth / cssWidth;
      const x = Math.max(0, Math.min(pixelWidth - 1, Math.round(screenPoint[0] * dpr)));
      const y = Math.max(0, Math.min(pixelHeight - 1, Math.round(pixelHeight - 1 - screenPoint[1] * dpr)));
      const pixel = new Uint8Array(4);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      gl.enable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const index = (pixel[0] | (pixel[1] << 8) | (pixel[2] << 16)) - 1;
      return index >= 0 ? meshCountryIds[index] || null : null;
    }

    function pickHydro(screenPoint) {
      if (!isWebGlRenderer() || !gl || !hydroManifest || !hydroActivePackIds.size || !state.layerVisibility.drawings) return null;
      resize();
      try { ensurePickTarget(); } catch (_) { return null; }
      gl.bindFramebuffer(gl.FRAMEBUFFER, pickFramebuffer);
      gl.viewport(0, 0, pixelWidth, pixelHeight);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      drawHydro('lake', true);
      drawHydro('river', true);
      const dpr = pixelWidth / cssWidth;
      const x = Math.max(0, Math.min(pixelWidth - 1, Math.round(screenPoint[0] * dpr)));
      const y = Math.max(0, Math.min(pixelHeight - 1, Math.round(pixelHeight - 1 - screenPoint[1] * dpr)));
      const pixel = new Uint8Array(4);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      gl.enable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const fid = (pixel[0] | (pixel[1] << 8) | (pixel[2] << 16)) - 1;
      return fid >= 0 ? state.hydroFeatureByFid.get(fid) || null : null;
    }

    async function initialize() {
      if (forcedRenderer === 'canvas') {
        activateCanvasFallback('강제 Canvas 테스트');
        return false;
      }
      let decoded = null;
      const failures = [];
      const versions = forcedRenderer === 'webgl2' ? [2] : forcedRenderer === 'webgl1' ? [1] : [2, 1];
      for (let index = 0; index < versions.length; index += 1) {
        const version = versions[index];
        if (index > 0 || gl) replaceCanvas();
        try {
          initWebGl(version);
          $('engineStatus').textContent = `${rendererName()} · 원본 메시를 준비하는 중입니다.`;
          updateRendererBadge(`${rendererName()} · GPU를 준비하는 중입니다.`);
          if (!decoded) decoded = await decodeBuiltInMesh();
          setMesh(decoded.mesh, decoded.ids);
          if (isWebGlRenderer()) {
            $('engineStatus').textContent = `Natural Earth 5.1.1 · ${rendererName()} 무손실`;
            updateRendererBadge(`${rendererName()} · GPU 실시간`);
            return true;
          }
        } catch (error) {
          const message = error?.message || String(error);
          failures.push(`${version === 2 ? 'WebGL2' : 'WebGL1'}: ${message}`);
          console.warn(`${version === 2 ? 'WebGL2' : 'WebGL1'} renderer unavailable`, error);
        }
      }
      if (gl) replaceCanvas();
      activateCanvasFallback(failures.join(' / ') || 'WebGL을 사용할 수 없습니다.');
      return false;
    }

    function setTerrainManifest(manifest) {
      terrainManifest = manifest?.levels?.length ? manifest : null;
      terrainLastLevel = -1;
      if (terrainManifest && isWebGlRenderer()) {
        for (const spec of visibleTerrainTileSpecs(terrainManifest.levels[0], true)) requestTerrainTile(spec);
      }
      render(currentRenderRevision);
    }

    function getStats() {
      const sorted = [...frameTimes].sort((a, b) => a - b);
      const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0;
      return {
        renderer: rendererMode,
        countries: meshCountryIds.length,
        renderVertices: mesh?.countryIndices?.length || 0,
        triangleCount: (mesh?.triangleIndices?.length || 0) / 3,
        lineSegmentCount: (mesh?.lineIndices?.length || 0) / 2,
        p95CpuSubmitMs: Number(p95.toFixed(3)),
        viewportCss: [Number(cssWidth.toFixed(3)), Number(cssHeight.toFixed(3))],
        canvasBackingPixels: [pixelWidth, pixelHeight],
        layoutMismatchCssPx: Number(layoutMismatch().toFixed(3)),
        requestedRevision: currentRenderRevision,
        displayedRevision: displayedRenderRevision,
        canvasWorkerBusy,
        canvasWorkerHasPendingFrame: !!canvasWorkerPendingMessage,
        webglContextLost,
        webGlVersion: glVersion || null,
        forcedRenderer: forcedRenderer || null,
        fallbackReason,
        terrainLevel: terrainLastLevel,
        terrainTilesLoaded: terrainTiles.size,
        terrainTilesLoading: terrainTileRequests.size,
        hydroFeaturesLoaded: state.hydroFeatureCache?.size || 0,
        hydroPacksLoaded: hydroPacks.size,
        hydroPacksActive: hydroActivePackIds.size,
        hydroCacheBytes: [...hydroPacks.values()].reduce((sum, entry) => sum + Number(entry.byteLength || 0), 0),
      };
    }

    return { attach, initialize, render, resize, verifyLayout, pick, pickHydro, rebuildFromCountries, prioritizeLatest, getStats, setTerrainManifest, setHydroManifest };
  })();

  let gpuRebuildTimer = null;
  function scheduleGpuMeshRebuild(delay = 80) {
    clearTimeout(gpuRebuildTimer);
    gpuRebuildTimer = setTimeout(() => {
      gpuMapRenderer.rebuildFromCountries(state.countriesData?.features || []);
    }, delay);
  }

  function cpuCountryAtCoordinate(coord) {
    if (!coord) return null;
    const candidates = (state.spatialIndex || []).filter(item => {
      const b = item.bounds;
      return coord[0] >= b[0] && coord[0] <= b[2] && coord[1] >= b[1] && coord[1] <= b[3];
    });
    for (let i = candidates.length - 1; i >= 0; i -= 1) {
      const feature = candidates[i].feature;
      if (!isLayerItemVisible('countries', feature.properties?.editor_id || '')) continue;
      if (pointInCountryFeature(coord, feature)) return feature;
    }
    return null;
  }

  function countryAtScreenPoint(screenPoint, coord) {
    const gpuId = gpuMapRenderer.pick(screenPoint);
    const gpuFeature = gpuId ? countryFeatureById(gpuId) : null;
    if (gpuFeature && isLayerItemVisible('countries', gpuId) && pointInCountryFeature(coord, gpuFeature)) return gpuFeature;
    return cpuCountryAtCoordinate(coord);
  }

  function hydroLineParts(geometry) {
    if (geometry?.type === 'LineString') return [geometry.coordinates || []];
    if (geometry?.type === 'MultiLineString') return geometry.coordinates || [];
    return [];
  }

  function hydroAtScreenPoint(screenPoint, coord) {
    if (!state.layerVisibility.drawings || state.tool !== 'select') return null;
    const picked = gpuMapRenderer.pickHydro(screenPoint);
    if (picked && isHydroFeatureVisible(picked) && hydroFeatureInView(picked)) return picked;
    const projection = activeProjection();
    const toleranceDegrees = 9 / Math.max(1, projection.scale()) * 180 / Math.PI;
    let nearest = null;
    for (const feature of allHydroFeatures()) {
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
      && ['select', 'country-coast', 'merge-country', 'new-country', 'annex-territory', 'river', 'lake'].includes(state.tool);
  }

  function mapClickBlocked(event = d3.event) {
    if (event?.defaultPrevented) {
      event.stopPropagation?.();
      return true;
    }
    if (pendingMapClickRevision !== null) {
      const staleInteraction = pendingMapClickRevision !== editInteractionRevision;
      pendingMapClickRevision = null;
      if (staleInteraction) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        return true;
      }
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
    if (mousePan) mousePan.cancelled = true;
    if (touchTap) touchTap.cancelled = true;
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

  function setAutosaveStatus(text) {
    $('autosaveStatus').textContent = text;
  }

  function setCurrentTool(name) {
    $('currentToolName').textContent = name || '선택·편집';
    $('currentTool')?.classList.remove('is-collapsed');
    scheduleMapContextCollapse();
  }

  function clearNotification() {
    clearTimeout(setActionStatus._timer);
    const chip = $('actionStatus');
    if (!chip) return;
    chip.classList.add('hidden');
    chip.classList.remove('working', 'success', 'error');
    chip.classList.add('ready');
    chip.setAttribute('role', 'status');
    document.body.classList.remove('notification-visible');
  }

  function clearErrorNotification() {
    if ($('actionStatus')?.classList.contains('error')) clearNotification();
  }

  function setActionStatus(message, tone = 'success', timeout = 1800) {
    const chip = $('actionStatus');
    if (!chip) return;
    clearTimeout(setActionStatus._timer);
    chip.classList.remove('hidden');
    chip.classList.remove('ready', 'working', 'success', 'error');
    chip.classList.add(tone);
    chip.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    const strong = chip.querySelector('strong');
    if (strong) strong.textContent = message;
    document.body.classList.add('notification-visible');
    if (tone === 'error' || timeout <= 0) return;
    setActionStatus._timer = setTimeout(clearNotification, timeout);
  }

  function flashButton(button) {
    if (!button || button.disabled) return;
    button.classList.remove('button-flash');
    void button.offsetWidth;
    button.classList.add('button-flash');
    setTimeout(() => button.classList.remove('button-flash'), 260);
  }

  function showFatalError(error) {
    console.error(error);
    const message = error?.message || String(error || '알 수 없는 오류');
    let box = document.getElementById('fatalErrorBox');
    if (!box) {
      box = document.createElement('div');
      box.id = 'fatalErrorBox';
      box.style.cssText = 'position:fixed;z-index:99999;left:10px;right:10px;top:70px;padding:14px;border:1px solid #8a4f4f;border-radius:10px;background:#3b2525;color:#ffd1d1;font:13px/1.55 sans-serif;white-space:pre-wrap;';
      document.body.appendChild(box);
    }
    box.textContent = `AtlasWright 실행 오류\n${message}\n\nGitHub Pages 또는 로컬 HTTP 서버에서 열었는지 확인해 주세요.`;
    try { $('engineStatus').textContent = '실행 오류'; } catch (_) {}
  }

  window.addEventListener('error', event => showFatalError(event.error || event.message));
  window.addEventListener('unhandledrejection', event => showFatalError(event.reason));

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
      name: 'atlaswright-label-anchors',
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

  function normalizeCountries(raw) {
    const fc = raw?.type === 'FeatureCollection' ? deepClone(raw) : { type: 'FeatureCollection', features: [] };
    return reindexCountries(fc, true);
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
      if (!wanted.size || wanted.has(String(feature.properties?.editor_id || ''))) geometryBoundsCache.delete(feature.geometry);
    }
    rebuildSpatialIndex();
  }

  function markCountryGeometriesChanged(ids = []) {
    for (const rawId of ids) {
      const id = String(rawId || '');
      if (!id) continue;
      state.historyDirtyCountryIds.add(id);
    }
    invalidateGeometryCaches(ids);
    state.boundaryTopology = { edges: new Map(), nodes: new Map() };
    scheduleGpuMeshRebuild();
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
  function rebuildBoundaryTopology(targetCountryId = state.coastEditCountryId) {
    const edges = new Map();
    const nodes = new Map();
    const target = targetCountryId ? countryFeatureById(targetCountryId) : null;
    if (!target) {
      state.boundaryTopology = { edges, nodes };
      return;
    }
    const targetBounds = geometryBounds(target.geometry);
    const margin = 0.0002;
    const queryBounds = [targetBounds[0] - margin, targetBounds[1] - margin, targetBounds[2] + margin, targetBounds[3] + margin];
    const features = spatialFeatures(queryBounds);

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
  }

  function getCountryCoastHandles(feature) {
    if (!feature) return [];
    const countryId = String(feature.properties?.editor_id || '');
    const handles = [];
    for (const node of state.boundaryTopology?.nodes?.values?.() || []) {
      const ownRefs = node.refs.filter(ref => String(ref.countryId) === countryId);
      // 육상국경을 보존하기 위해 양쪽 선분이 모두 해안선인 꼭짓점만 편집한다.
      const ref = ownRefs.find(r => r.prevKind === 'coast' && r.nextKind === 'coast');
      if (!ref) continue;
      handles.push({
        ...ref.vertex,
        nodeKey: node.key,
        coord: ref.vertex.coord,
      });
    }
    return handles;
  }

  function getCountryCoastSegments(feature) {
    if (!feature) return [];
    const countryId = String(feature.properties?.editor_id || '');
    const result = [];
    for (const edge of state.boundaryTopology?.edges?.values?.() || []) {
      if (edge.kind !== 'coast' || !edge.countryIds.has(countryId)) continue;
      const ref = edge.refs.find(r => String(r.countryId) === countryId);
      if (!ref) continue;
      result.push({
        key: edge.key,
        geometry: { type: 'LineString', coordinates: [ref.a, ref.b] },
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
      const donor = countryFeatureById(state.annexDonorCountryId);
      return {
        selectedKeys: state.annexSelectedComponentKeys,
        features: donor ? [donor] : [],
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

  function territoryComponentSelectionSummary() {
    const selected = selectedTerritoryComponentItems();
    const totalArea = selected.reduce((sum, item) => sum + item.areaKm2, 0);
    return `${selected.length}개 · ${formatTerritoryArea(totalArea)}`;
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

  function validateCountryGeometryEdit(affectedIds, unionBefore = null) {
    const clipper = window.polygonClipping;
    const affected = new Set([...affectedIds].map(String));
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
        const overlap = clipper.intersection(feature.geometry.coordinates, other.geometry.coordinates);
        if (multiPolygonPlanarArea(overlap) > 1e-8) {
          return { ok: false, message: `${countryName(feature)}과(와) ${countryName(other)}의 영토가 겹칩니다.` };
        }
      }
    }

    if (unionBefore) {
      const unionAfter = countryUnionFromFeatures(features, affected);
      const changedArea = multiPolygonPlanarArea(clipper.xor(unionBefore, unionAfter));
      const tolerance = Math.max(1e-8, multiPolygonPlanarArea(unionBefore) * 1e-10);
      if (changedArea > tolerance) return { ok: false, message: '편집 과정에서 국토에 빈틈이 생겼습니다.' };
    }
    return { ok: true };
  }

  function restoreCountryEditSnapshot(snapshot) {
    state.countryOverrides = deepClone(snapshot.countryOverrides || {});
    restoreCountriesFromSnapshot(snapshot);
    rebuildBoundaryTopology(state.coastEditCountryId);
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

  function closestCoordinateOnSegment(screenPoint, a, b, sampleCount = 24) {
    const projection = activeProjection();
    let best = null;
    for (let i = 0; i < sampleCount; i += 1) {
      const t0 = i / sampleCount;
      const t1 = (i + 1) / sampleCount;
      const c0 = interpolateCoordinate(a, b, t0);
      const c1 = interpolateCoordinate(a, b, t1);
      const p0 = projection(c0);
      const p1 = projection(c1);
      if (!p0 || !p1) continue;
      const vx = p1[0] - p0[0], vy = p1[1] - p0[1];
      const length2 = vx * vx + vy * vy;
      const local = length2
        ? clamp(((screenPoint[0] - p0[0]) * vx + (screenPoint[1] - p0[1]) * vy) / length2, 0, 1)
        : 0;
      const px = p0[0] + vx * local, py = p0[1] + vy * local;
      const distance = Math.hypot(screenPoint[0] - px, screenPoint[1] - py);
      const t = t0 + (t1 - t0) * local;
      if (!best || distance < best.distance) best = { coord: interpolateCoordinate(a, b, t), t, distance };
    }
    return best;
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

  function ensureClosedRing(rawRing) {
    const ring = (rawRing || []).map(c => [Number(c[0]), Number(c[1])]);
    if (ring.length && !coordNear(ring[0], ring[ring.length - 1], 1e-10)) ring.push(ring[0].slice());
    return ring;
  }

  function ringSignedArea(ring) {
    let sum = 0;
    for (let i = 0; i < ring.length - 1; i += 1) {
      sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    }
    return sum / 2;
  }

  function orientRing(rawRing, wantClockwise) {
    let ring = ensureClosedRing(rawRing);
    const clockwise = ringSignedArea(ring) < 0;
    if (clockwise !== wantClockwise) {
      const open = ring.slice(0, -1).reverse();
      ring = ensureClosedRing(open);
    }
    return ring;
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
    const polygons = (multiPolygon || []).map(polygon => {
      const rings = (polygon || [])
        .map((ring, index) => orientRing(ring, index === 0))
        .filter(ring => ring.length >= 4 && Math.abs(ringSignedArea(ring)) > 1e-14);
      return rings;
    }).filter(polygon => polygon[0]?.length >= 4);
    if (!polygons.length) return null;
    return polygons.length === 1
      ? { type: 'Polygon', coordinates: polygons[0] }
      : { type: 'MultiPolygon', coordinates: polygons };
  }

  function clipDraftToCurrentLand(rawRing) {
    const clipper = window.polygonClipping;
    if (!clipper?.intersection || !clipper?.union) throw new Error('해안선 처리 엔진을 불러오지 못했습니다.');

    const draftRing = ensureClosedRing(rawRing);
    const subjectPolygon = [draftRing];
    const draftBounds = coordinateBounds(subjectPolygon);
    const currentFeatures = state.countriesData?.features || [];
    const maskFeatures = currentFeatures.length
      ? spatialFeatures(draftBounds)
      : (PRISTINE_COUNTRIES.features || []);
    const pieces = [];

    for (const feature of maskFeatures) {
      const geometry = feature?.geometry;
      if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) continue;
      if (!boundsOverlap(draftBounds, geometryBounds(geometry))) continue;
      const clipped = clipper.intersection(subjectPolygon, geometry.coordinates);
      if (clipped?.length) pieces.push(...clipped);
    }

    if (!pieces.length) return null;
    const dissolved = pieces.length === 1 ? pieces : clipper.union(...pieces);
    return normalizeClippedLandGeometry(dissolved);
  }

  function buildTerritoryTransferPlan(newGeometry) {
    const clipper = window.polygonClipping;
    if (!clipper?.intersection || !clipper?.difference) throw new Error('영토 이전 엔진을 불러오지 못했습니다.');
    const newBounds = coordinateBounds(newGeometry.coordinates);
    const updates = [];
    const removedIds = [];

    for (const feature of spatialFeatures(newBounds)) {
      const geometry = feature?.geometry;
      if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) continue;
      const overlap = clipper.intersection(geometry.coordinates, newGeometry.coordinates);
      if (!overlap?.length) continue;

      const id = String(feature.properties?.editor_id || '');
      const remainder = clipper.difference(geometry.coordinates, newGeometry.coordinates);
      const normalized = normalizeClippedLandGeometry(remainder);
      if (normalized) updates.push({ id, geometry: normalized });
      else removedIds.push(id);
    }

    return { updates, removedIds, affectedCount: updates.length + removedIds.length };
  }

  function differenceGeometryByRegion(geometry, regionCoordinates) {
    const clipper = window.polygonClipping;
    const regionBounds = coordinateBounds(regionCoordinates);
    const untouched = [];
    const changed = [];
    for (const polygon of geometryPolygonSets(geometry)) {
      if (!boundsOverlap(geometryBounds({ coordinates: polygon }), regionBounds)) {
        untouched.push(deepClone(polygon));
        continue;
      }
      const result = clipper.difference([polygon], regionCoordinates);
      if (result?.length) changed.push(...result);
    }
    return normalizeClippedLandGeometry([...untouched, ...changed]);
  }

  function unionGeometryWithRegion(geometry, regionCoordinates) {
    const clipper = window.polygonClipping;
    const regionBounds = coordinateBounds(regionCoordinates);
    const untouched = [];
    const impacted = [];
    for (const polygon of geometryPolygonSets(geometry)) {
      if (boundsOverlap(geometryBounds({ coordinates: polygon }), regionBounds)) impacted.push(polygon);
      else untouched.push(deepClone(polygon));
    }
    const merged = impacted.length
      ? clipper.union(...impacted.map(polygon => [polygon]), regionCoordinates)
      : deepClone(regionCoordinates);
    return normalizeClippedLandGeometry([...untouched, ...(merged || [])]);
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

  function closestDonorExteriorPoint(screenPoint, donor, componentIndex = null) {
    let best = null;
    const polygons = geometryPolygonSets(donor?.geometry);
    polygons.forEach((polygon, polygonIndex) => {
      if (componentIndex !== null && polygonIndex !== componentIndex) return;
      const ring = ensureClosedRing(polygon?.[0] || []);
      for (let segmentIndex = 0; segmentIndex < ring.length - 1; segmentIndex += 1) {
        const candidate = closestCoordinateOnSegment(screenPoint, ring[segmentIndex], ring[segmentIndex + 1]);
        if (!candidate || (best && candidate.distance >= best.distance)) continue;
        let coord = candidate.coord.slice();
        let t = candidate.t;
        if (t <= 0.002) { coord = ring[segmentIndex].slice(); t = 0; }
        else if (t >= 0.998) { coord = ring[segmentIndex + 1].slice(); t = 1; }
        best = { polygonIndex, segmentIndex, coord, t, distance: candidate.distance };
      }
    });
    return best;
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
      if (interiorComponentIndex(before, polygons) !== null) throw new Error('국경선은 선택 영토 밖이나 경계에서 시작해 주세요.');
    }
    const maxPosition = line.length - 1;
    if (exit.position < maxPosition - 1e-7) {
      const after = coordinateAtPathPosition(line, (exit.position + maxPosition) / 2);
      if (interiorComponentIndex(after, polygons) !== null) throw new Error('국경선은 선택 영토 밖이나 경계에서 끝내 주세요.');
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
      throw new Error('편입선의 양 끝점을 피편입국 경계에서 구분할 수 없습니다.');
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
    if (index !== endIndex) throw new Error('피편입국 경계 경로를 만들 수 없습니다.');
    return result;
  }

  function validateAnnexCutLine(cutLine, component) {
    if (!Array.isArray(cutLine) || cutLine.length < 2) throw new Error('새 국경선에는 두 점 이상이 필요합니다.');
    const unique = new Set(cutLine.map(coord => coordKey(coord, 8)));
    if (unique.size < 2 || cutLine.some((coord, index) => index > 0 && coordNear(coord, cutLine[index - 1], 1e-9))) {
      throw new Error('서로 다른 위치를 연결해 주세요.');
    }
    if (lineHasSelfIntersection(cutLine)) throw new Error('새 국경선이 자기 자신과 교차합니다.');
    for (let i = 1; i < cutLine.length - 1; i += 1) {
      if (!pointInPolygonSetInterior(cutLine[i], component)) {
        throw new Error('중간 국경점은 피편입국 내부에 놓아야 합니다.');
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
          throw new Error('새 국경선은 피편입국 밖이나 호수·구멍을 통과할 수 없습니다.');
        }
      }
      for (const ring of component) {
        const closed = ensureClosedRing(ring);
        for (let j = 0; j < closed.length - 1; j += 1) {
          if (segmentsProperlyIntersect(a, b, closed[j], closed[j + 1])) {
            throw new Error('새 국경선이 피편입국 경계를 중간에서 가로지릅니다.');
          }
        }
      }
    }
  }

  function buildCutSplitCandidates(sourceGeometry, rawLine) {
    const clipper = window.polygonClipping;
    if (!clipper?.intersection || !clipper?.union || !clipper?.xor) throw new Error('영토 편입 엔진을 불러오지 못했습니다.');
    if (!sourceGeometry || !['Polygon', 'MultiPolygon'].includes(sourceGeometry.type)) throw new Error('분할할 영토를 찾을 수 없습니다.');
    const extracted = extractSingleInteriorCut(rawLine, sourceGeometry);
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
    if (overlapArea > tolerance || missingArea > tolerance) throw new Error('새 국경선이 피편입국을 정확히 두 영역으로 나누지 못했습니다.');

    return {
      componentIndex,
      cutLine,
      candidates: candidates.map((geometry, index) => ({ geometry, area: areas[index] })),
    };
  }

  function buildAnnexSplitCandidates(donorId, rawLine) {
    const donor = countryFeatureById(donorId);
    if (!donor?.geometry || !['Polygon', 'MultiPolygon'].includes(donor.geometry.type)) throw new Error('피편입국을 찾을 수 없습니다.');
    return buildCutSplitCandidates(donor.geometry, rawLine);
  }

  function buildAnnexationPlan(targetId, donorId, transferredGeometry) {
    const clipper = window.polygonClipping;
    if (!clipper?.intersection || !clipper?.difference || !clipper?.union) throw new Error('영토 편입 엔진을 불러오지 못했습니다.');
    const target = countryFeatureById(targetId);
    const donor = countryFeatureById(donorId);
    if (!target?.geometry || !donor?.geometry) throw new Error('수령국 또는 피편입국을 찾을 수 없습니다.');
    if (String(targetId) === String(donorId)) throw new Error('수령국 자신은 피편입국으로 선택할 수 없습니다.');

    const transferred = geometryMultiCoordinates(transferredGeometry);
    const transferredArea = multiPolygonPlanarArea(transferred);
    if (transferredArea <= 1e-14) throw new Error('편입할 유효한 영토가 없습니다.');
    const outsideDonor = clipper.difference(transferred, donor.geometry.coordinates);
    if (multiPolygonPlanarArea(outsideDonor) > Math.max(1e-10, transferredArea * 1e-10)) {
      throw new Error('선택 영역이 피편입국 밖으로 벗어났습니다.');
    }

    const donorRemainder = differenceGeometryByRegion(donor.geometry, transferred);
    const targetResult = unionGeometryWithRegion(target.geometry, transferred);
    if (!targetResult) throw new Error('편입 후 수령국 경계를 만들 수 없습니다.');
    const updates = [{ id: String(targetId), geometry: targetResult }];
    const removedIds = [];
    if (donorRemainder) updates.push({ id: String(donorId), geometry: donorRemainder });
    else removedIds.push(String(donorId));
    return {
      targetId: String(targetId), donorId: String(donorId),
      updates, removedIds,
      affectedIds: [String(targetId), String(donorId)],
      transferredArea,
    };
  }

  function selectedCountryUnionGeometry(sourceIds) {
    const ids = new Set((sourceIds || []).map(String));
    if (!ids.size) throw new Error('원본 국가를 하나 이상 선택하세요.');
    const union = countryUnionFromFeatures(state.countriesData?.features || [], ids);
    const geometry = normalizeClippedLandGeometry(union);
    if (!geometry) throw new Error('선택 국가의 영토 합집합을 만들 수 없습니다.');
    return geometry;
  }

  function buildNewCountryTransferPlan(sourceIds, transferredGeometry) {
    const clipper = window.polygonClipping;
    if (!clipper?.intersection || !clipper?.difference || !clipper?.union) throw new Error('국가 분리 엔진을 불러오지 못했습니다.');
    const ids = new Set((sourceIds || []).map(String));
    const sourceFeatures = (state.countriesData?.features || [])
      .filter(feature => ids.has(String(feature.properties?.editor_id || '')));
    if (!sourceFeatures.length) throw new Error('원본 국가를 찾을 수 없습니다.');
    const transferred = geometryMultiCoordinates(transferredGeometry);
    const transferredArea = multiPolygonPlanarArea(transferred);
    if (transferredArea <= 1e-14) throw new Error('신생국으로 만들 유효한 영토가 없습니다.');
    const sourceUnion = clipper.union(...sourceFeatures.map(feature => feature.geometry.coordinates));
    const outsideSource = clipper.difference(transferred, sourceUnion);
    if (multiPolygonPlanarArea(outsideSource) > Math.max(1e-10, transferredArea * 1e-10)) {
      throw new Error('선택 영역이 원본 국가들의 영토 밖으로 벗어났습니다.');
    }

    const updates = [];
    const removedIds = [];
    const affectedSourceIds = [];
    const tolerance = Math.max(1e-10, transferredArea * 1e-10);
    for (const feature of sourceFeatures) {
      const id = String(feature.properties?.editor_id || '');
      const overlap = clipper.intersection(feature.geometry.coordinates, transferred);
      if (multiPolygonPlanarArea(overlap) <= tolerance) continue;
      affectedSourceIds.push(id);
      const remainder = differenceGeometryByRegion(feature.geometry, transferred);
      if (remainder) updates.push({ id, geometry: remainder });
      else removedIds.push(id);
    }
    if (!affectedSourceIds.length) throw new Error('선택 영역과 겹치는 원본 국가가 없습니다.');
    return { updates, removedIds, affectedSourceIds, transferredArea };
  }

  function applyTerritoryTransferPlan(plan) {
    const updates = new Map(plan.updates.map(item => [item.id, item.geometry]));
    const removed = new Set(plan.removedIds);
    state.countriesData.features = state.countriesData.features.filter(feature => {
      const id = String(feature.properties?.editor_id || '');
      if (removed.has(id)) {
        delete state.countryOverrides[id];
        return false;
      }
      if (updates.has(id)) feature.geometry = deepClone(updates.get(id));
      return true;
    });
    markCountryGeometriesChanged(new Set([...updates.keys(), ...removed]));
  }

  function ringRepresentativePoint(ring) {
    if (!ring?.length) return [0, 0];
    let x = 0, y = 0, n = Math.max(1, ring.length - 1);
    for (let i = 0; i < n; i += 1) { x += ring[i][0]; y += ring[i][1]; }
    return [x / n, y / n];
  }

  function mergeCountryGeometries(geometries) {
    const edgeMap = new Map();
    let cancelled = 0;
    const addEdge = (a, b) => {
      const ka = coordKey(a, 5), kb = coordKey(b, 5);
      if (ka === kb) return;
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (edgeMap.has(key)) { edgeMap.delete(key); cancelled += 1; }
      else edgeMap.set(key, { a: a.slice(), b: b.slice(), ka, kb });
    };
    for (const geometry of geometries) {
      for (const polygon of geometryPolygonSets(geometry)) {
        for (const rawRing of polygon) {
          const ring = ensureClosedRing(rawRing);
          for (let i = 0; i < ring.length - 1; i += 1) addEdge(ring[i], ring[i + 1]);
        }
      }
    }

    if (!cancelled) {
      const polygons = [];
      for (const geometry of geometries) polygons.push(...geometryPolygonSets(geometry).map(p => deepClone(p)));
      return polygons.length === 1
        ? { geometry: { type: 'Polygon', coordinates: polygons[0] }, seamless: true }
        : { geometry: { type: 'MultiPolygon', coordinates: polygons }, seamless: false };
    }

    const edges = [...edgeMap.values()].map((e, index) => ({ ...e, index, used: false }));
    const adjacency = new Map();
    const link = (key, index) => { if (!adjacency.has(key)) adjacency.set(key, []); adjacency.get(key).push(index); };
    edges.forEach((e, i) => { link(e.ka, i); link(e.kb, i); });
    const rings = [];
    for (const start of edges) {
      if (start.used) continue;
      start.used = true;
      const ring = [start.a.slice(), start.b.slice()];
      let currentKey = start.kb;
      const startKey = start.ka;
      let guard = 0;
      while (currentKey !== startKey && guard++ < edges.length + 10) {
        const candidates = (adjacency.get(currentKey) || []).filter(i => !edges[i].used);
        if (!candidates.length) break;
        const edge = edges[candidates[0]];
        edge.used = true;
        if (edge.ka === currentKey) { ring.push(edge.b.slice()); currentKey = edge.kb; }
        else { ring.push(edge.a.slice()); currentKey = edge.ka; }
      }
      if (currentKey === startKey && ring.length >= 4) {
        if (!coordNear(ring[0], ring[ring.length - 1], 1e-7)) ring.push(ring[0].slice());
        rings.push(ring);
      }
    }

    if (!rings.length || edges.some(e => !e.used)) {
      const polygons = [];
      for (const geometry of geometries) polygons.push(...geometryPolygonSets(geometry).map(p => deepClone(p)));
      return { geometry: { type: polygons.length === 1 ? 'Polygon' : 'MultiPolygon', coordinates: polygons.length === 1 ? polygons[0] : polygons }, seamless: false };
    }

    const items = rings
      .map(ring => ({ ring: ensureClosedRing(ring), area: Math.abs(ringSignedArea(ring)), parent: -1, depth: 0 }))
      .filter(item => item.area > 1e-9)
      .sort((a, b) => b.area - a.area);
    for (let i = 0; i < items.length; i += 1) {
      const p = ringRepresentativePoint(items[i].ring);
      let parent = -1;
      let parentArea = Infinity;
      for (let j = 0; j < i; j += 1) {
        if (items[j].area < parentArea && pointInRing(p, items[j].ring)) { parent = j; parentArea = items[j].area; }
      }
      items[i].parent = parent;
      items[i].depth = parent >= 0 ? items[parent].depth + 1 : 0;
    }
    const polygons = [];
    const outerIndexToPolygon = new Map();
    items.forEach((item, i) => {
      if (item.depth % 2 === 0) {
        const poly = [orientRing(item.ring, true)];
        outerIndexToPolygon.set(i, poly);
        polygons.push(poly);
      }
    });
    items.forEach((item, i) => {
      if (item.depth % 2 === 0) return;
      let ancestor = item.parent;
      while (ancestor >= 0 && items[ancestor].depth % 2 !== 0) ancestor = items[ancestor].parent;
      const poly = outerIndexToPolygon.get(ancestor);
      if (poly) poly.push(orientRing(item.ring, false));
    });
    if (!polygons.length) return { geometry: geometries[0], seamless: false };
    return {
      geometry: polygons.length === 1 ? { type: 'Polygon', coordinates: polygons[0] } : { type: 'MultiPolygon', coordinates: polygons },
      seamless: true,
    };
  }

  function activeProjection() {
    return state.projection === 'globe' ? globeProjection : flatProjection;
  }

  function updateProjection() {
    const { width, height } = state.size;
    if (state.projection === 'globe') {
      const base = Math.max(60, Math.min(width, height - 26) * 0.455);
      globeProjection
        .translate([width / 2, height / 2])
        .scale(base * state.view.globeZoom)
        .rotate(state.view.globeRotation)
        .clipAngle(90);
      path.projection(globeProjection);
    } else {
      const base = Math.max(30, width / (2 * Math.PI));
      flatProjection
        .translate([width / 2, height / 2])
        .scale(base * state.view.flatZoom)
        .center(state.view.flatCenter)
        .rotate([0, 0, 0])
        .clipExtent([[0, 0], [width, height - 25]]);
      path.projection(flatProjection);
    }
    updateZoomStatus();
  }

  function updateZoomStatus() {
    const zoom = state.projection === 'globe' ? state.view.globeZoom : state.view.flatZoom;
    $('zoomStatus').textContent = state.projection === 'globe'
      ? `지구본 ×${zoom.toFixed(1)}`
      : `평면 ×${zoom.toFixed(1)}`;
    const mobileValue = $('mobileZoomValue');
    if (mobileValue) mobileValue.textContent = `×${zoom.toFixed(1)}`;
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

  function drawingColor(feature) {
    return feature.properties?.editorColor || DEFAULT_DRAWING_COLOR;
  }

  function drawingCategoryLabel(feature) {
    const labels = {
      river: '강', lake: '호수', territory: '영토', administrative: '행정구역',
      ethnicity: '민족', religion: '종교', language: '언어', custom: '사용자 정의',
    };
    return labels[feature?.properties?.category] || '지형지물';
  }

  function drawingName(feature) {
    return feature.properties?.name || `이름 없는 ${drawingCategoryLabel(feature)} ${String(feature.id || '').slice(0, 8)}`;
  }

  function countryColor(feature) {
    return feature.properties?.editor_color || defaultCountryColor();
  }

  function countryName(feature) {
    return feature.properties?.editor_name || feature.properties?.editor_original_name || feature.properties?.name || '국가';
  }

  const LAYER_GROUP_KEYS = ['countries', 'drawings', 'labels', 'countryLabels'];
  const layerGroupVisibilityKey = group => group === 'countryLabels' ? 'basemapLabels' : group;
  const layerGroupNames = { countries: '국가', drawings: '지형지물', labels: '도시·지명', countryLabels: '국가명 라벨' };
  const layerGroupTargetIds = {
    countries: ['countriesLayerChildren', 'countriesLayerCount'],
    drawings: ['drawingsLayerChildren', 'drawingsLayerCount'],
    labels: ['labelsLayerChildren', 'labelsLayerCount'],
    countryLabels: ['countryLabelsLayerChildren', 'countryLabelsLayerCount'],
  };
  const layerNameCollator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
  let renderedLayerTreeRevision = -1;

  function normalizePhysicalSettings(value) {
    const hydroLayers = {};
    const legacyRiverSupplement = ['rivers_europe', 'rivers_north_america', 'rivers_australia'].some(id => value?.hydroLayers?.[id] !== false);
    const legacyLakeSupplement = ['lakes_europe', 'lakes_north_america', 'lakes_australia'].some(id => value?.hydroLayers?.[id] !== false);
    for (const id of Object.keys(HYDRO_LAYER_META)) {
      if (id === 'rivers_hydro' && value?.hydroLayers?.[id] === undefined) hydroLayers[id] = legacyRiverSupplement;
      else if (id === 'lakes_hydro' && value?.hydroLayers?.[id] === undefined) hydroLayers[id] = legacyLakeSupplement;
      else hydroLayers[id] = value?.hydroLayers?.[id] !== false;
    }
    return {
      terrainVisible: value?.terrainVisible !== false,
      terrainStyle: value?.terrainStyle === 'physical' ? 'physical' : 'political',
      terrainStrength: clamp(Number(value?.terrainStrength ?? 0.32), 0, 1),
      hydroLayers,
      userFeaturesVisible: value?.userFeaturesVisible !== false,
      hiddenHydroIds: value?.hiddenHydroIds && typeof value.hiddenHydroIds === 'object' ? { ...value.hiddenHydroIds } : {},
      dataset: PHYSICAL_DATASET,
    };
  }

  function syncPhysicalControls() {
    if ($('terrainStyleSelect')) $('terrainStyleSelect').value = state.physicalSettings.terrainStyle;
    if ($('terrainStrengthInput')) $('terrainStrengthInput').value = String(Math.round(state.physicalSettings.terrainStrength * 100));
    if ($('terrainStrengthValue')) $('terrainStrengthValue').textContent = `${Math.round(state.physicalSettings.terrainStrength * 100)}%`;
  }

  function hydroLayerVisible(layerId) {
    return !!state.layerVisibility.drawings && state.physicalSettings.hydroLayers?.[layerId] !== false;
  }

  function isHydroFeatureVisible(feature) {
    const id = String(feature?.properties?.aw_id || feature?.id || '');
    return hydroLayerVisible(feature?.properties?.layer_id) && state.physicalSettings.hiddenHydroIds?.[id] !== true;
  }

  function allHydroFeatures() {
    const tiled = state.hydroFeatureCache instanceof Map ? [...state.hydroFeatureCache.values()] : [];
    const legacy = Object.values(state.hydroCollections || {}).flatMap(collection => collection?.features || []);
    return [...tiled, ...legacy];
  }

  function hydroFeatureById(id) {
    const key = String(id);
    if (state.hydroFeatureCache instanceof Map && state.hydroFeatureCache.has(key)) return state.hydroFeatureCache.get(key);
    for (const feature of allHydroFeatures()) {
      if (String(feature.properties?.aw_id || feature.id || '') === key) return feature;
    }
    return null;
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
    return Object.fromEntries(LAYER_GROUP_KEYS.map(group => [group, !!value?.[group]]));
  }

  function markLayerTreeDirty() {
    state.layerTreeRevision += 1;
  }

  function isLayerItemVisible(group, id) {
    if (group === 'drawings' && id === 'terrain') return state.physicalSettings.terrainVisible;
    if (group === 'drawings' && id === 'user-terrain') return state.physicalSettings.userFeaturesVisible !== false;
    if (group === 'drawings' && String(id).startsWith('hydro-layer:')) {
      return state.physicalSettings.hydroLayers?.[String(id).slice('hydro-layer:'.length)] !== false;
    }
    return state.itemVisibility?.[group]?.[String(id)] !== false;
  }

  function isCountryVisibleById(id) {
    return !!state.layerVisibility.countries && isLayerItemVisible('countries', id);
  }

  function setLayerItemVisibility(group, id, visible) {
    if (!LAYER_GROUP_KEYS.includes(group)) return;
    const key = String(id);
    if (group === 'drawings' && key === 'terrain') {
      state.physicalSettings.terrainVisible = !!visible;
      markLayerTreeDirty();
      renderAll();
      queueAutosave();
      return;
    }
    if (group === 'drawings' && key === 'user-terrain') {
      state.physicalSettings.userFeaturesVisible = !!visible;
      markLayerTreeDirty();
      renderAll();
      queueAutosave();
      return;
    }
    if (group === 'drawings' && key.startsWith('hydro-layer:')) {
      state.physicalSettings.hydroLayers[key.slice('hydro-layer:'.length)] = !!visible;
      markLayerTreeDirty();
      renderAll();
      queueAutosave();
      return;
    }
    state.itemVisibility[group] ||= {};
    if (visible) delete state.itemVisibility[group][key];
    else state.itemVisibility[group][key] = false;
    markLayerTreeDirty();
    renderAll();
    queueAutosave();
  }

  function layerTreeItems(group) {
    if (group === 'countries' || group === 'countryLabels') {
      return (state.countriesData?.features || []).map(feature => {
        const id = String(feature.properties?.editor_id || '');
        return {
          id,
          name: countryName(feature),
          color: countryColor(feature),
          meta: group === 'countries' ? id : (pendingCountryLabelAnchors.has(id) ? '계산 중' : '국명'),
          selected: state.selected?.type === 'country' && state.selected.id === id,
        };
      });
    }
    if (group === 'drawings') {
      const builtIns = [
        { id: 'terrain', name: '지형 음영', color: '#8a9c78', meta: state.physicalLoadState.terrain === 'error' ? '불러오기 실패 · 다시 선택해 재시도' : 'Natural Earth 1:10m', selected: false },
        ...Object.entries(HYDRO_LAYER_META).map(([id, meta]) => ({
          id: `hydro-layer:${id}`,
          name: meta.label,
          color: meta.color,
          meta: state.hydroManifest?.stats?.layerCounts?.[id] !== undefined
            ? `${Number(state.hydroManifest.stats.layerCounts[id]).toLocaleString()}개 · 필요할 때 불러옴`
            : state.physicalLoadState.hydro === 'error' ? '불러오기 실패' : '목록을 불러오는 중',
          selected: false,
        })),
        { id: 'user-terrain', name: '사용자 지형지물', color: '#7d5ca8', meta: `${state.drawings.length.toLocaleString()}개 · 편집 가능`, selected: false },
      ];
      const userItems = state.drawings.map(feature => ({
        id: String(feature.id),
        name: drawingName(feature),
        color: drawingColor(feature),
        meta: `${drawingCategoryLabel(feature)} · 사용자`,
        selected: state.selected?.type === 'drawing' && state.selected.id === String(feature.id),
      }));
      return [...builtIns, ...userItems];
    }
    return state.labels.map(label => ({
      id: String(label.id),
      name: label.name || '이름 없는 지명',
      color: '#d6b969',
      meta: label.kind || '지명',
      selected: state.selected?.type === 'label' && state.selected.id === String(label.id),
    }));
  }

  function pruneLayerItemVisibility() {
    const valid = {
      countries: new Set((state.countriesData?.features || []).map(feature => String(feature.properties?.editor_id || ''))),
      countryLabels: new Set((state.countriesData?.features || []).map(feature => String(feature.properties?.editor_id || ''))),
      drawings: new Set(['terrain', 'user-terrain', ...Object.keys(HYDRO_LAYER_META).map(id => `hydro-layer:${id}`), ...state.drawings.map(feature => String(feature.id))]),
      labels: new Set(state.labels.map(label => String(label.id))),
    };
    for (const group of LAYER_GROUP_KEYS) {
      state.itemVisibility[group] ||= {};
      for (const id of Object.keys(state.itemVisibility[group])) if (!valid[group].has(id)) delete state.itemVisibility[group][id];
    }
  }

  function renderLayerTree(force = false) {
    if (!force && renderedLayerTreeRevision === state.layerTreeRevision) return;
    pruneLayerItemVisibility();
    const search = String(state.layerSearch || '').trim().toLocaleLowerCase('ko');
    for (const group of LAYER_GROUP_KEYS) {
      const folder = document.querySelector(`.layer-folder[data-layer-group="${group}"]`);
      const [childrenId, countId] = layerGroupTargetIds[group];
      const container = $(childrenId);
      const count = $(countId);
      if (!folder || !container || !count) continue;
      const allItems = layerTreeItems(group).sort((a, b) => layerNameCollator.compare(a.name, b.name) || layerNameCollator.compare(a.id, b.id));
      const filtered = search ? allItems.filter(item => `${item.name} ${item.id} ${item.meta}`.toLocaleLowerCase('ko').includes(search)) : allItems;
      const visibleCount = allItems.filter(item => isLayerItemVisible(group, item.id)).length;
      const expanded = !!search || !!state.layerFolders[group];
      folder.classList.toggle('is-expanded', expanded);
      folder.querySelectorAll('[data-layer-folder-toggle]').forEach(button => {
        button.setAttribute('aria-expanded', String(expanded));
        button.setAttribute('aria-label', `${layerGroupNames[group]} 폴더 ${expanded ? '접기' : '펼치기'}`);
      });
      count.textContent = visibleCount === allItems.length ? String(allItems.length) : `${visibleCount}/${allItems.length}`;
      container.hidden = !expanded;
      container.replaceChildren();
      if (!expanded) continue;
      if (!filtered.length) {
        const empty = document.createElement('div');
        empty.className = 'layer-empty';
        empty.textContent = search ? '검색 결과 없음' : '항목 없음';
        container.appendChild(empty);
        continue;
      }
      const fragment = document.createDocumentFragment();
      for (const item of filtered) {
        const row = document.createElement('div');
        row.className = `layer-child${item.selected ? ' is-selected' : ''}`;
        row.dataset.layerGroup = group;
        row.dataset.itemId = item.id;
        const visibility = document.createElement('input');
        visibility.type = 'checkbox';
        visibility.checked = isLayerItemVisible(group, item.id);
        visibility.dataset.layerItemVisibility = group;
        visibility.dataset.itemId = item.id;
        visibility.setAttribute('aria-label', `${item.name} 표시`);
        const swatch = document.createElement('span');
        swatch.className = `layer-child-swatch ${group === 'labels' || group === 'countryLabels' ? 'label' : 'polygon'}`;
        if (group === 'countryLabels') swatch.textContent = 'A';
        else swatch.style.setProperty('--layer-item-color', item.color || '#63758a');
        const name = document.createElement('button');
        name.type = 'button';
        name.className = 'layer-child-name';
        name.dataset.layerItemSelect = group;
        name.dataset.itemId = item.id;
        name.textContent = item.name;
        name.title = `${item.name} 선택하고 이동`;
        const meta = document.createElement('span');
        meta.className = 'layer-child-meta';
        meta.textContent = item.meta;
        row.append(visibility, swatch, name, meta);
        fragment.appendChild(row);
      }
      container.appendChild(fragment);
    }
    renderedLayerTreeRevision = state.layerTreeRevision;
  }

  function currentMapZoom() {
    return state.projection === 'globe' ? state.view.globeZoom : state.view.flatZoom;
  }

  function shouldShowCountryLabel(feature) {
    if (!state.layerVisibility.basemapLabels) return false;
    const id = String(feature.properties?.editor_id || '');
    if (!isLayerItemVisible('countryLabels', id) || pendingCountryLabelAnchors.has(id)) return false;
    const pop = Number(feature.properties?.pop_est || 0);
    const z = state.projection === 'globe' ? state.view.globeZoom : state.view.flatZoom;
    let threshold = isMobile() ? 120_000_000 : 30_000_000;
    if (z >= 1.4) threshold = isMobile() ? 25_000_000 : 12_000_000;
    if (z >= 2) threshold = 4_000_000;
    if (z >= 3) threshold = 1_000_000;
    if (z >= 4.5) threshold = 0;
    if (state.selected?.type === 'country' && state.selected.id === feature.properties?.editor_id) return true;
    return pop >= threshold;
  }

  function renderCountries(revision = ++renderRevision) {
    gpuMapRenderer.render(revision);
    const highlighted = state.layerVisibility.countries && state.countriesData
      ? state.countriesData.features.filter(feature => {
          const id = String(feature.properties?.editor_id || '');
          if (!isLayerItemVisible('countries', id)) return false;
          return (state.selected?.type === 'country' && state.selected.id === id) ||
            (state.tool === 'country-coast' && state.coastEditCountryId === id) ||
            (state.tool === 'annex-territory' && (state.annexTargetCountryId === id || state.annexDonorCountryId === id)) ||
            (state.tool === 'new-country' && state.newCountrySourceIds.includes(id));
        })
      : [];
    const selection = countryLayer.selectAll('path.country-shape')
      .data(highlighted, feature => feature.properties.editor_id);
    selection.enter().append('path').attr('class', 'country-shape gpu-country-highlight');
    const allCountries = countryLayer.selectAll('path.country-shape');
    allCountries
      .attr('d', path)
      .classed('selected', feature => state.selected?.type === 'country' && state.selected.id === feature.properties.editor_id)
      .classed('coast-editing', feature => state.tool === 'country-coast' && state.coastEditCountryId === feature.properties.editor_id)
      .classed('annex-editing', feature => state.tool === 'annex-territory' && state.annexTargetCountryId === feature.properties.editor_id)
      .classed('annex-donor', feature => state.tool === 'annex-territory' && state.annexDonorCountryId === feature.properties.editor_id)
      .classed('new-country-source', feature => state.tool === 'new-country' && state.newCountrySourceIds.includes(String(feature.properties.editor_id)));
    selection.exit().remove();
  }

  function renderCountryLabels() {
    const features = state.countriesData?.features || [];
    const candidates = features
      .filter(f => {
        const c = f.properties?.editor_label_anchor;
        return shouldShowCountryLabel(f) && isCoordVisible(c);
      })
      .map(f => ({
        feature: f,
        point: activeProjection()(f.properties.editor_label_anchor),
        population: Number(f.properties?.pop_est || 0),
        selected: state.selected?.type === 'country' && state.selected.id === f.properties?.editor_id,
      }))
      .filter(x => x.point && Number.isFinite(x.point[0]) && Number.isFinite(x.point[1]))
      .sort((a, b) => Number(b.selected) - Number(a.selected) || b.population - a.population);

    // 모바일에서는 작은 화면에서 국명이 겹치지 않도록 간단한 충돌 검사를 적용한다.
    const placed = [];
    const data = [];
    for (const item of candidates) {
      const name = countryName(item.feature);
      const fontSize = item.population >= 50_000_000 ? (isMobile() ? 10 : 10) : (isMobile() ? 8 : 9);
      const width = Math.max(20, [...name].length * fontSize * 1.02 + 8);
      const height = fontSize * 1.65 + 4;
      const box = {
        left: item.point[0] - width / 2,
        right: item.point[0] + width / 2,
        top: item.point[1] - height / 2,
        bottom: item.point[1] + height / 2,
      };
      const pad = isMobile() ? 5 : 3;
      const collides = placed.some(b => !(box.right + pad < b.left || box.left - pad > b.right || box.bottom + pad < b.top || box.top - pad > b.bottom));
      if (item.selected || !collides) {
        placed.push(box);
        data.push(item.feature);
      }
    }

    const selection = countryLabelLayer.selectAll('text.country-label')
      .data(data, d => d.properties.editor_id);

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
          selectAnnexDonor(d.properties.editor_id);
          return;
        }
        if (state.tool === 'merge-country' && state.mergeSourceCountryId) {
          d3.event.stopPropagation();
          completeCountryMerge(d.properties.editor_id);
          return;
        }
        if (state.tool !== 'select' || state.labelPlacementMode) return;
        d3.event.stopPropagation();
        if (state.countriesLocked) return;
        selectCountry(d.properties.editor_id);
      });

    const allCountryLabels = countryLabelLayer.selectAll('text.country-label');
    allCountryLabels
      .text(countryName)
      .classed('major', d => Number(d.properties?.pop_est || 0) >= 50_000_000)
      .attr('transform', d => {
        const p = activeProjection()(d.properties.editor_label_anchor);
        return p ? `translate(${p[0]},${p[1]})` : 'translate(-9999,-9999)';
      });

    selection.exit().remove();
  }

  function prepareHydroFeature(feature) {
    const bounds = coordinateBounds(feature?.geometry?.coordinates);
    feature.__awBounds = bounds.every(Number.isFinite) ? bounds : [-180, -90, 180, 90];
    try { feature.__awCentroid = d3.geo.centroid(feature); }
    catch (_) { feature.__awCentroid = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2]; }
    feature.__awRadius = Math.min(180, Math.hypot(bounds[2] - bounds[0], bounds[3] - bounds[1]) / 2);
    return feature;
  }

  async function loadTerrainManifest(force = false) {
    if (!force && ['loading', 'ready'].includes(state.physicalLoadState.terrain)) return;
    state.physicalLoadState.terrain = 'loading';
    markLayerTreeDirty();
    renderLayerTree();
    try {
      const url = new URL('terrain/v0.12.0/manifest.json', PHYSICAL_DATA_BASE_URL);
      url.searchParams.set('v', ASSET_REVISION);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const manifest = await response.json();
      if (!manifest.levels?.length) throw new Error('지형 타일 manifest가 올바르지 않습니다.');
      state.terrainManifest = manifest;
      state.physicalLoadState.terrain = 'ready';
      gpuMapRenderer.setTerrainManifest(manifest);
      markLayerTreeDirty();
      renderLayerTree();
      renderAll();
    } catch (error) {
      state.physicalLoadState.terrain = 'error';
      markLayerTreeDirty();
      renderLayerTree();
      console.warn('Terrain load failed', error);
      setActionStatus(`지형 음영을 불러올 수 없습니다. 국가 지도는 계속 사용할 수 있습니다. ${error.message}`, 'error', 0);
    }
  }

  async function loadHydroData(force = false) {
    if (!force && ['loading', 'ready'].includes(state.physicalLoadState.hydro)) return;
    state.physicalLoadState.hydro = 'loading';
    markLayerTreeDirty();
    renderLayerTree();
    try {
      const manifestUrl = new URL('hydro/v0.12.1/manifest.json', PHYSICAL_DATA_BASE_URL);
      manifestUrl.searchParams.set('v', ASSET_REVISION);
      const response = await fetch(manifestUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const manifest = await response.json();
      if (manifest.version !== APP_VERSION || manifest.schema !== 'atlaswright-hydro-packs-v1') throw new Error('수계 타일 버전이 맞지 않습니다.');
      state.hydroManifest = manifest;
      state.hydroCollections = {};
      state.hydroFeatureCache = new Map();
      state.hydroFeatureByFid = new Map();
      gpuMapRenderer.setHydroManifest(manifest, manifestUrl);
      state.physicalLoadState.hydro = 'ready';
      markLayerTreeDirty();
      renderLayerTree();
      renderHydro();
    } catch (error) {
      state.physicalLoadState.hydro = 'error';
      markLayerTreeDirty();
      renderLayerTree();
      console.warn('Hydro load failed', error);
      setActionStatus(`수계 목록을 불러올 수 없습니다. 국가 지도는 계속 사용할 수 있습니다. 페이지를 새로고침하거나 잠시 후 다시 시도하세요. ${error.message}`, 'error', 0);
    }
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
    for (const feature of allHydroFeatures()) {
      const layerId = feature.properties?.layer_id;
      if (HYDRO_LAYER_META[layerId]?.category !== category || !hydroLayerVisible(layerId) || !hydroFeatureInView(feature)) continue;
      const width = category === 'river' ? Math.max(0.45, Math.min(3.2, Number(feature.properties?.stroke_width || 0.8))) : 1;
      const widthBucket = Math.round(width * 2) / 2;
      const key = `${layerId}:${widthBucket}`;
      if (!groups.has(key)) groups.set(key, { key, layerId, width: widthBucket, features: [] });
      groups.get(key).features.push(feature);
    }
    return [...groups.values()].map(group => ({ ...group, collection: { type: 'FeatureCollection', features: group.features } }));
  }

  function renderHydro() {
    if (!hydroLakeLayer || !hydroRiverLayer) return;
    const gpuHydro = gpuMapRenderer.getStats().renderer === 'webgl2' || gpuMapRenderer.getStats().renderer === 'webgl1';
    if (gpuHydro) {
      hydroLakeLayer.selectAll('*').remove();
      hydroRiverLayer.selectAll('*').remove();
    } else {
      const lakes = hydroRenderGroups('lake');
      const lakeSelection = hydroLakeLayer.selectAll('path.hydro-lake-group').data(lakes, item => item.key);
      lakeSelection.enter().append('path').attr('class', 'hydro-lake-group');
      lakeSelection.attr('d', item => path(item.collection));
      lakeSelection.exit().remove();

      const rivers = hydroRenderGroups('river');
      const riverSelection = hydroRiverLayer.selectAll('path.hydro-river-group').data(rivers, item => item.key);
      riverSelection.enter().append('path').attr('class', 'hydro-river-group');
      riverSelection.attr('d', item => path(item.collection)).style('stroke-width', item => `${item.width}px`);
      riverSelection.exit().remove();
    }

    const selected = state.selected?.type === 'hydro' ? hydroFeatureById(state.selected.id) : null;
    const selection = hydroSelectionLayer.selectAll('path.hydro-selected').data(selected && hydroFeatureInView(selected) ? [selected] : [], item => item.properties.aw_id);
    selection.enter().append('path').attr('class', 'hydro-selected');
    selection.attr('d', path).classed('is-lake', item => item.properties.category === 'lake');
    selection.exit().remove();
  }

  function renderDrawings() {
    const data = state.layerVisibility.drawings && state.physicalSettings.userFeaturesVisible !== false
      ? state.drawings.filter(feature => isLayerItemVisible('drawings', feature.id))
      : [];
    const selection = drawingLayer.selectAll('path.drawing-shape')
      .data(data, d => String(d.id));

    selection.enter().append('path')
      .attr('class', 'drawing-shape')
      .on('click', function(d) {
        if (mapClickBlocked()) return;
        if (state.tool !== 'select' || state.labelPlacementMode) return;
        d3.event.stopPropagation();
        selectDrawing(String(d.id));
      });

    selection
      .attr('d', path)
      .style('fill', d => d.geometry?.type?.includes('Polygon') ? drawingColor(d) : 'none')
      .style('fill-opacity', d => d.geometry?.type?.includes('Polygon') ? 0.34 : 0)
      .style('stroke', drawingColor)
      .classed('selected', d => state.selected?.type === 'drawing' && state.selected.id === String(d.id));

    selection.exit().remove();
  }

  function renderUserLabels() {
    const data = state.layerVisibility.labels
      ? state.labels.filter(l => isLayerItemVisible('labels', l.id) && isCoordVisible(l.coordinates))
      : [];

    const selection = labelLayer.selectAll('g.user-label')
      .data(data, d => d.id);

    const enter = selection.enter().append('g')
      .attr('class', 'user-label')
      .on('click', function(d) {
        if (mapClickBlocked()) return;
        if (state.tool !== 'select' || state.labelPlacementMode) return;
        d3.event.stopPropagation();
        selectLabel(d.id);
      });

    enter.append('circle').attr('class', 'user-label-dot').attr('r', 4);
    enter.append('text').attr('class', 'user-label-text').attr('x', 7).attr('dy', '.35em');

    selection
      .classed('selected', d => state.selected?.type === 'label' && state.selected.id === d.id)
      .attr('transform', d => {
        const p = activeProjection()(d.coordinates);
        return p ? `translate(${p[0]},${p[1]})` : 'translate(-9999,-9999)';
      });

    selection.select('text').text(d => d.name);
    // Drag capture would otherwise eat clicks intended for drawing tools.
    selection.on('.drag', null);
    if (state.tool === 'select' && !state.labelPlacementMode) selection.call(labelDragBehavior());
    selection.exit().remove();
  }

  function getEditableVertices(feature) {
    if (!feature?.geometry) return [];
    const type = feature.geometry.type;
    if (type === 'LineString') {
      return feature.geometry.coordinates.map((coord, index) => ({ index, coord }));
    }
    if (type === 'Polygon') {
      const ring = feature.geometry.coordinates?.[0] || [];
      return ring.slice(0, Math.max(0, ring.length - 1)).map((coord, index) => ({ index, coord }));
    }
    return [];
  }

  function renderBoundaryEditOverlay() {
    const feature = state.tool === 'country-coast' && state.coastEditCountryId
      ? countryFeatureById(state.coastEditCountryId)
      : null;
    const visibleSegments = feature
      ? getCountryCoastSegments(feature).filter(seg => seg.geometry.coordinates.some(isCoordVisible))
      : [];
    const data = visibleSegments.length ? [{
      key: `coast:${state.coastEditCountryId}`,
      geometry: { type: 'MultiLineString', coordinates: visibleSegments.map(seg => seg.geometry.coordinates) },
    }] : [];
    const selection = boundaryEditLayer.selectAll('path.boundary-edit-segment').data(data, d => d.key);
    selection.enter().append('path').attr('class', 'boundary-edit-segment');
    selection.exit().remove();
    const allSegments = boundaryEditLayer.selectAll('path.boundary-edit-segment');
    allSegments
      .attr('d', d => path({ type: 'Feature', geometry: d.geometry, properties: {} }))
      .classed('coast', true)
      .on('click.vertex-add', null)
      .on('dblclick.vertex-add', null);
  }

  function thinVisibleCoastHandles(handles) {
    const projection = activeProjection();
    const zoom = currentMapZoom();
    const minDistance = Math.max(isMobile() ? 7 : 4, (isMobile() ? 18 : 11) / Math.sqrt(Math.max(1, zoom)));
    const cellSize = minDistance;
    const occupied = new Map();
    const accepted = [];
    for (const handle of handles) {
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
    if (state.tool === 'select' && state.selected?.type === 'drawing') {
      feature = state.drawings.find(f => String(f.id) === state.selected.id);
      if (feature) data = getEditableVertices(feature).filter(v => isCoordVisible(v.coord));
    } else if (state.tool === 'country-coast' && state.coastEditCountryId) {
      feature = countryFeatureById(state.coastEditCountryId);
      if (feature) data = thinVisibleCoastHandles(getCountryCoastHandles(feature));
    }
    const coastMode = state.tool === 'country-coast' && !!state.coastEditCountryId;
    const selection = vertexLayer.selectAll('circle.vertex-handle').data(data, d => d.nodeKey || d.key || d.index);
    selection.enter().append('circle').attr('class', 'vertex-handle');
    selection.exit().remove();
    const allVertices = vertexLayer.selectAll('circle.vertex-handle');
    allVertices
      .attr('r', coastMode ? (isMobile() ? 7.2 : 5.2) : 4.5)
      .classed('country-vertex', coastMode)
      .classed('coast-vertex', coastMode)
      .attr('transform', d => {
        const p = activeProjection()(d.coord);
        return p ? `translate(${p[0]},${p[1]})` : 'translate(-9999,-9999)';
      });
    allVertices.on('.drag', null);
    if (feature) allVertices.call(coastMode ? countryCoastVertexDragBehavior(feature) : vertexDragBehavior(feature));
    allVertices.on('click.vertex-select', null);
    allVertices.each(function(d) {
      let title = d3.select(this).select('title');
      if (title.empty()) title = d3.select(this).append('title');
      if (coastMode) title.text('해안선 꼭짓점');
      else title.text('꼭짓점');
    });
  }

  function draftFeature() {
    const coords = state.draftCoords.slice();
    if (state.draftHover) coords.push(state.draftHover);
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

  function renderDraft() {
    draftLayer.selectAll('*').remove();
    const annexSide = state.tool === 'annex-territory' && state.annexPhase === 'side';
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
    const feature = draftFeature();
    if (feature && (feature.geometry.coordinates?.length || feature.geometry.coordinates?.[0]?.length)) {
      draftLayer.append('path').datum(feature)
        .attr('class', state.tool === 'annex-territory' ? 'draft-shape annex-draft' : 'draft-shape')
        .attr('d', path);
    }
    const visible = state.draftCoords.filter(isCoordVisible);
    draftLayer.selectAll('circle.draft-vertex').data(visible).enter().append('circle')
      .attr('class', 'draft-vertex').attr('r', 3.5)
      .attr('transform', d => {
        const p = activeProjection()(d);
        return `translate(${p[0]},${p[1]})`;
      });
  }

  function selectTerritoryCandidate(candidateIndex) {
    const index = Number(candidateIndex);
    if (state.tool === 'annex-territory' && state.annexPhase === 'side' && state.annexCandidates[index]?.geometry) {
      state.annexSelectedCandidateIndex = index;
      setModeBanner('초록색 편입 영역을 확인하세요. 반대 영역을 선택하려면 보라색 영역을 선택한 뒤 완료하세요.', 'annex-mode');
    } else if (state.tool === 'new-country' && state.newCountryPhase === 'side' && state.newCountryCandidates[index]?.geometry) {
      state.newCountrySelectedCandidateIndex = index;
      setModeBanner('초록색 신생국 영역을 확인하세요. 반대 영역을 선택하려면 보라색 영역을 선택한 뒤 완료하세요.', 'add-country-mode');
    } else {
      return;
    }
    renderDraft();
    updateModeButtons();
  }

  function updateTerritoryComponentSelectionFeedback() {
    const summary = territoryComponentSelectionSummary();
    if (state.tool === 'annex-territory' && state.annexPhase === 'components') {
      const donor = countryFeatureById(state.annexDonorCountryId);
      setModeBanner(`${donor ? countryName(donor) : '피편입국'}의 영토 조각을 선택하세요. 현재 선택: ${summary}. 완료하면 선택한 조각이 편입됩니다.`, 'annex-mode');
    } else if (state.tool === 'new-country' && state.newCountryPhase === 'components') {
      setModeBanner(`신생국으로 만들 영토 조각을 선택하세요. 현재 선택: ${summary}. 완료하면 선택한 조각이 새 국가가 됩니다.`, 'add-country-mode');
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

  function renderAll() {
    const revision = ++renderRevision;
    updateProjection();
    renderBase();
    renderCountries(revision);
    renderHydro();
    renderBoundaryEditOverlay();
    renderDrawings();
    renderCountryLabels();
    renderUserLabels();
    renderVertices();
    renderDraft();
    renderLayerTree();
    window.__ATLASWRIGHT_VIEW_REVISION__ = revision;
  }

  function initSvg() {
    const mapEl = $('map');
    const map = d3.select(mapEl);
    map.selectAll('*').remove();

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
    root = svg.append('g').attr('class', 'map-root');
    mapInteractionLayer = root.append('rect')
      .attr('class', 'map-hit-area')
      .attr('x', 0)
      .attr('y', 0);
    graticuleLayer = root.append('path').attr('class', 'map-graticule');
    countryLayer = root.append('g').attr('class', 'countries-layer');
    hydroLakeLayer = root.append('g').attr('class', 'hydro-lakes-layer');
    hydroRiverLayer = root.append('g').attr('class', 'hydro-rivers-layer');
    hydroSelectionLayer = root.append('g').attr('class', 'hydro-selection-layer');
    boundaryEditLayer = root.append('g').attr('class', 'boundary-edit-layer');
    drawingLayer = root.append('g').attr('class', 'drawings-layer');
    countryLabelLayer = root.append('g').attr('class', 'country-label-layer');
    labelLayer = root.append('g').attr('class', 'labels-layer');
    vertexLayer = root.append('g').attr('class', 'vertices-layer');
    draftLayer = root.append('g').attr('class', 'draft-layer');

    const interactiveDragTarget = target => !!target?.closest?.('.vertex-handle, .user-label');
    const beginMapMovement = () => {
      state.mapMoving = true;
      mapEl.classList.add('dragging');
      if (state.draftHover) {
        state.draftHover = null;
        renderDraft();
      }
    };
    const finishMapMovement = point => {
      state.mapMoving = false;
      mapEl.classList.remove('dragging');
      suppressNextMapClick(point);
      renderAll();
      gpuMapRenderer.prioritizeLatest();
      queueViewAutosave();
    };

    svg.node().addEventListener('mousedown', event => {
      if (event.button !== 0 || !mapNavigationEnabled() || interactiveDragTarget(event.target)) return;
      pendingMapClickRevision = null;
      mousePan = {
        startX: event.clientX, startY: event.clientY,
        lastX: event.clientX, lastY: event.clientY,
        moved: false, cancelled: false,
        revision: editInteractionRevision,
      };
    });
    window.addEventListener('mousemove', event => {
      if (!mousePan || mousePan.cancelled || mousePan.revision !== editInteractionRevision) return;
      if (!mousePan.moved && Math.hypot(event.clientX - mousePan.startX, event.clientY - mousePan.startY) <= 4) return;
      if (!mousePan.moved) {
        mousePan.moved = true;
        beginMapMovement();
      }
      panMapBy(event.clientX - mousePan.lastX, event.clientY - mousePan.lastY);
      mousePan.lastX = event.clientX;
      mousePan.lastY = event.clientY;
      scheduleRender();
      event.preventDefault();
    }, { passive: false });
    window.addEventListener('mouseup', event => {
      if (!mousePan) return;
      const gesture = mousePan;
      mousePan = null;
      pendingMapClickRevision = gesture.revision;
      if (gesture.cancelled || gesture.revision !== editInteractionRevision) return;
      if (gesture.moved) finishMapMovement([event.clientX, event.clientY]);
    });

    svg.on('click', function() {
      if (mapClickBlocked()) return;
      handleMapClick(d3.mouse(this));
    });

    svg.on('dblclick', function() {
      const newCountryLineMode = state.tool === 'new-country' && state.newCountryPhase === 'line';
      if ((isDrawingDraftTool(state.tool) || newCountryLineMode || (state.tool === 'annex-territory' && state.annexPhase === 'line')) && state.draftCoords.length) {
        d3.event.preventDefault();
        finishDraft();
      }
    });

    svg.on('mousemove', function() {
      if (mousePan?.moved || touchTap?.panned) {
        if (state.draftHover) {
          state.draftHover = null;
          renderDraft();
        }
        return;
      }
      const coord = screenToGeo(d3.mouse(this));
      if (coord) {
        $('coordStatus').textContent = `경도 ${coord[0].toFixed(4)} · 위도 ${coord[1].toFixed(4)}`;
        const newCountryLineMode = state.tool === 'new-country' && state.newCountryPhase === 'line';
        if ((isDrawingDraftTool(state.tool) || newCountryLineMode || (state.tool === 'annex-territory' && state.annexPhase === 'line')) && state.draftCoords.length) {
          state.draftHover = coord;
          renderDraft();
        }
      } else {
        $('coordStatus').textContent = '지구본 바깥';
        if (state.draftHover) {
          state.draftHover = null;
          renderDraft();
        }
      }
    });

    mapEl.addEventListener('wheel', (event) => {
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0013);
      if (state.projection === 'globe') {
        state.view.globeZoom = clamp(state.view.globeZoom * factor, ZOOM_LIMITS.globe.min, ZOOM_LIMITS.globe.max);
      } else {
        state.view.flatZoom = clamp(state.view.flatZoom * factor, ZOOM_LIMITS.flat.min, ZOOM_LIMITS.flat.max);
      }
      scheduleRender();
      queueViewAutosave();
    }, { passive: false });

    // Mobile: 8px까지는 탭, 그 이상은 편집 상태를 유지한 지도 이동으로 판정한다.
    mapEl.addEventListener('touchstart', event => {
      if (event.touches.length !== 1) { touchTap = null; return; }
      if (interactiveDragTarget(event.target)) { touchTap = null; return; }
      const t = event.touches[0];
      touchTap = {
        x: t.clientX, y: t.clientY,
        lastX: t.clientX, lastY: t.clientY,
        moved: false, panned: false, cancelled: false,
        navigable: mapNavigationEnabled(),
        revision: editInteractionRevision,
      };
    }, { passive: true });
    mapEl.addEventListener('touchmove', event => {
      if (!touchTap || touchTap.cancelled || touchTap.revision !== editInteractionRevision || event.touches.length !== 1) return;
      const t = event.touches[0];
      if (!touchTap.moved && Math.hypot(t.clientX - touchTap.x, t.clientY - touchTap.y) > 8) {
        touchTap.moved = true;
        touchTap.panned = touchTap.navigable;
        if (touchTap.panned) beginMapMovement();
      }
      if (!touchTap.panned) return;
      panMapBy(t.clientX - touchTap.lastX, t.clientY - touchTap.lastY);
      touchTap.lastX = t.clientX;
      touchTap.lastY = t.clientY;
      scheduleRender();
      event.preventDefault();
    }, { passive: false });
    mapEl.addEventListener('touchend', event => {
      if (touchTap && (touchTap.cancelled || touchTap.revision !== editInteractionRevision)) {
        const endPoint = [touchTap.lastX, touchTap.lastY];
        touchTap = null;
        suppressNextMapClick(endPoint, 700);
        return;
      }
      if (touchTap?.panned) {
        const endPoint = [touchTap.lastX, touchTap.lastY];
        touchTap = null;
        finishMapMovement(endPoint);
        return;
      }
      const directAnnexLineTap = state.tool === 'annex-territory' && state.annexPhase === 'line';
      const directNewCountryLineTap = state.tool === 'new-country' && state.newCountryPhase === 'line';
      if (!touchTap || touchTap.moved || !(state.labelPlacementMode || isDrawingDraftTool(state.tool) || state.tool === 'point' || directNewCountryLineTap || directAnnexLineTap)) {
        touchTap = null;
        return;
      }
      const rect = svg.node().getBoundingClientRect();
      handleMapClick([touchTap.x - rect.left, touchTap.y - rect.top]);
      suppressNextMapClick([touchTap.x, touchTap.y], 700);
      touchTap = null;
    }, { passive: true });

    // 모바일 확대·축소: 두 손가락 핀치 감도를 높이고, 선택 모드에서는 두 번 탭 확대를 지원한다.
    let pinch = null;
    let lastTapAt = 0;
    let lastTapPoint = null;
    const touchDistance = touches => {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.max(1, Math.hypot(dx, dy));
    };
    mapEl.addEventListener('touchstart', event => {
      if (event.touches.length !== 2) return;
      mapEl.classList.remove('dragging');
      state.mapMoving = true;
      pinch = {
        distance: touchDistance(event.touches),
        zoom: state.projection === 'globe' ? state.view.globeZoom : state.view.flatZoom,
      };
      touchTap = null;
      event.preventDefault();
      event.stopPropagation();
    }, { passive: false, capture: true });
    mapEl.addEventListener('touchmove', event => {
      if (!pinch || event.touches.length !== 2) return;
      const rawFactor = touchDistance(event.touches) / pinch.distance;
      const factor = Math.pow(rawFactor, 1.18);
      if (state.projection === 'globe') state.view.globeZoom = clamp(pinch.zoom * factor, ZOOM_LIMITS.globe.min, ZOOM_LIMITS.globe.max);
      else state.view.flatZoom = clamp(pinch.zoom * factor, ZOOM_LIMITS.flat.min, ZOOM_LIMITS.flat.max);
      scheduleRender();
      event.preventDefault();
      event.stopPropagation();
    }, { passive: false, capture: true });
    mapEl.addEventListener('touchend', event => {
      if (pinch && event.touches.length < 2) {
        pinch = null;
        state.mapMoving = false;
        renderAll();
        queueViewAutosave();
      }
      if (touchTap?.moved) return;
      if (!isMobile() || event.changedTouches.length !== 1 || !['select', 'country-coast', 'merge-country'].includes(state.tool) || state.labelPlacementMode) return;
      const t = event.changedTouches[0];
      const now = Date.now();
      const point = [t.clientX, t.clientY];
      if (lastTapPoint && now - lastTapAt < 320 && Math.hypot(point[0] - lastTapPoint[0], point[1] - lastTapPoint[1]) < 28) {
        zoomBy(1.55, false);
        lastTapAt = 0;
        lastTapPoint = null;
        suppressNextMapClick(point, 500);
        if (navigator.vibrate) navigator.vibrate(8);
      } else {
        lastTapAt = now;
        lastTapPoint = point;
      }
    }, { passive: true, capture: true });
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
    window.visualViewport?.addEventListener?.('resize', queueMapResize);
    watchDevicePixelRatio();
  }

  function resizeMap() {
    const el = $('map');
    const bounds = el.getBoundingClientRect();
    state.size.width = Math.max(1, bounds.width || el.clientWidth || 900);
    state.size.height = Math.max(1, bounds.height || el.clientHeight || 650);
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
    requestAnimationFrame(() => gpuMapRenderer.verifyLayout());
  }

  function syncCountryActionButtons() {
    const selectedId = state.selected?.type === 'country' ? state.selected.id : null;
    const coastActive = state.tool === 'country-coast' && state.coastEditCountryId === selectedId;
    const mergeActive = state.tool === 'merge-country' && state.mergeSourceCountryId === selectedId;
    const annexActive = state.tool === 'annex-territory' && state.annexTargetCountryId === selectedId;
    const coastBtn = $('editCoastBtn');
    const mergeBtn = $('mergeCountryBtn');
    const annexBtn = $('annexTerritoryBtn');
    if (coastBtn) {
      coastBtn.classList.toggle('active', coastActive);
      coastBtn.textContent = coastActive ? '해안선 수정 완료' : '해안선 수정';
    }
    if (mergeBtn) mergeBtn.classList.toggle('active', mergeActive);
    if (annexBtn) annexBtn.classList.toggle('active', annexActive);
    const hint = $('countryActionHint');
    if (hint) {
      if (annexActive && state.annexPhase === 'donor') hint.textContent = '지도에서 영토를 가져올 피편입국 하나를 선택하세요. 드래그로 지도 이동이 가능합니다.';
      else if (annexActive && state.annexPhase === 'line') hint.textContent = '피편입국 밖이나 경계에서 시작해 한 영토 조각을 한 번 관통하세요. 외부 구간은 제외됩니다.';
      else if (annexActive && state.annexPhase === 'side') hint.textContent = '두 미리보기 중 수령국에 넘길 영토를 지도에서 선택하세요. 지도를 드래그해 이동할 수 있습니다.';
      else if (coastActive) hint.textContent = '해안선만 수정 중입니다. 육상국경은 잠겨 있습니다.';
      else if (mergeActive) hint.textContent = '지도에서 합병할 다른 국가를 선택하세요.';
      else hint.textContent = '피편입국을 지정한 뒤 새 국경선을 연결해 원하는 쪽 영토만 편입할 수 있습니다.';
    }
  }

  function setModeBanner(text = '', modeClass = '') {
    const banner = $('modeBanner');
    const context = $('currentTool');
    const defaultHint = $('mapContextDefault');
    banner.classList.remove('coast-mode', 'merge-mode', 'add-country-mode', 'annex-mode');
    if (!text) {
      banner.classList.add('hidden');
      defaultHint?.classList.remove('hidden');
      context?.classList.remove('has-active-context');
      scheduleMapContextCollapse();
      return;
    }
    window.clearTimeout(mapContextCollapseTimer);
    banner.textContent = text;
    if (modeClass) banner.classList.add(modeClass);
    banner.classList.remove('hidden');
    defaultHint?.classList.add('hidden');
    context?.classList.remove('is-collapsed');
    context?.classList.add('has-active-context');
  }

  function syncMapCursorMode() {
    const map = $('map');
    if (!map) return;
    const countryPickMode = (state.tool === 'new-country' && state.newCountryPhase === 'sources')
      || (state.tool === 'annex-territory' && state.annexPhase === 'donor')
      || (state.tool === 'merge-country' && !!state.mergeSourceCountryId);
    const drawingMode = state.labelPlacementMode
      || isDrawingDraftTool(state.tool)
      || (state.tool === 'new-country' && state.newCountryPhase === 'line')
      || (state.tool === 'annex-territory' && state.annexPhase === 'line');
    const candidatePickMode = (state.tool === 'new-country' && ['side', 'components'].includes(state.newCountryPhase))
      || (state.tool === 'annex-territory' && ['side', 'components'].includes(state.annexPhase));
    map.classList.toggle('country-pick-mode', countryPickMode);
    map.classList.toggle('drawing-mode', drawingMode);
    map.classList.toggle('candidate-pick-mode', candidatePickMode);
    map.classList.toggle('select-mode', !countryPickMode && !drawingMode && !candidatePickMode);
  }

  function updateModeButtons() {
    const annexLineMode = state.tool === 'annex-territory' && state.annexPhase === 'line';
    const annexSideMode = state.tool === 'annex-territory' && state.annexPhase === 'side';
    const annexComponentsMode = state.tool === 'annex-territory' && state.annexPhase === 'components';
    const annexDonorMode = state.tool === 'annex-territory' && state.annexPhase === 'donor';
    const newCountrySourceMode = state.tool === 'new-country' && state.newCountryPhase === 'sources';
    const newCountryLineMode = state.tool === 'new-country' && state.newCountryPhase === 'line';
    const newCountrySideMode = state.tool === 'new-country' && state.newCountryPhase === 'side';
    const newCountryComponentsMode = state.tool === 'new-country' && state.newCountryPhase === 'components';
    const componentsMode = annexComponentsMode || newCountryComponentsMode;
    const methodSwitchAvailable = annexLineMode || annexSideMode || annexComponentsMode
      || newCountryLineMode || newCountrySideMode || newCountryComponentsMode;
    const labelMode = state.labelPlacementMode || state.tool === 'label';
    const terrainMode = !!terrainToolConfig(state.tool);
    const specialMode = labelMode || terrainMode || ['new-country', 'annex-territory', 'merge-country', 'country-coast'].includes(state.tool);
    const bar = $('modeActionBar');
    const primary = $('modePrimaryBtn');
    const secondary = $('modeSecondaryBtn');
    const cancel = $('modeCancelBtn');
    if (bar) {
      bar.classList.toggle('hidden', !specialMode);
      bar.classList.toggle('single-action', state.tool === 'merge-country' || annexDonorMode || labelMode);
    }
    if (primary) {
      primary.classList.toggle('hidden', state.tool === 'merge-country' || annexDonorMode || labelMode);
      primary.disabled = (terrainMode && state.draftCoords.length < (isPolygonDraftTool(state.tool) ? 3 : 2))
        || (annexSideMode && !state.annexCandidates[state.annexSelectedCandidateIndex]?.geometry)
        || (newCountrySideMode && !state.newCountryCandidates[state.newCountrySelectedCandidateIndex]?.geometry)
        || (annexComponentsMode && !state.annexSelectedComponentKeys.length)
        || (newCountryComponentsMode && !state.newCountrySelectedComponentKeys.length);
      if (state.tool === 'country-coast') primary.textContent = '해안선 수정 완료';
      else if (terrainMode) primary.textContent = '그리기 완료';
      else if (newCountrySourceMode) primary.textContent = '선택 완료';
      else if (newCountryLineMode) primary.textContent = '선 연결 완료';
      else if (annexLineMode) primary.textContent = '선 연결 완료';
      else if (newCountrySideMode) primary.textContent = '선택 영역으로 국가 추가';
      else if (annexSideMode) primary.textContent = '선택 영역 편입';
      else if (newCountryComponentsMode) primary.textContent = '선택 조각으로 국가 추가';
      else if (annexComponentsMode) primary.textContent = '선택 조각 편입';
      else primary.textContent = '완료';
    }
    if (secondary) {
      secondary.classList.toggle('hidden', !methodSwitchAvailable);
      secondary.textContent = componentsMode ? '국경선으로 일부 선택' : '영토 조각 전체 선택';
    }
    if (cancel) cancel.textContent = '취소';
    syncMapCursorMode();
    syncCountryActionButtons();
  }

  function resetAnnexState() {
    state.annexTargetCountryId = null;
    state.annexDonorCountryId = null;
    state.annexPhase = null;
    state.annexComponentIndex = null;
    state.annexCandidates = [];
    state.annexSelectedCandidateIndex = null;
    state.annexSelectedComponentKeys = [];
  }

  function resetNewCountryState() {
    state.newCountryPhase = null;
    state.newCountrySourceIds = [];
    state.newCountryCandidates = [];
    state.newCountrySelectedCandidateIndex = null;
    state.newCountrySelectedComponentKeys = [];
  }

  function switchTerritorySelectionMethod(method) {
    const useComponents = method === 'components';
    if (state.tool === 'annex-territory' && ['line', 'side', 'components'].includes(state.annexPhase)) {
      const donor = countryFeatureById(state.annexDonorCountryId);
      if (!donor) return;
      clearDraftInput(true);
      state.annexComponentIndex = null;
      state.annexCandidates = [];
      state.annexSelectedCandidateIndex = null;
      state.annexSelectedComponentKeys = [];
      state.annexPhase = useComponents ? 'components' : 'line';
      if (useComponents) updateTerritoryComponentSelectionFeedback();
      else {
        setModeBanner(`${countryName(donor)}의 경계 밖에서 시작해 영토 조각 하나를 한 번 관통하는 선을 그리세요. 국가 밖의 선은 판정에서 제외됩니다.`, 'annex-mode');
      }
    } else if (state.tool === 'new-country' && ['line', 'side', 'components'].includes(state.newCountryPhase)) {
      clearDraftInput(true);
      state.newCountryCandidates = [];
      state.newCountrySelectedCandidateIndex = null;
      state.newCountrySelectedComponentKeys = [];
      state.newCountryPhase = useComponents ? 'components' : 'line';
      if (useComponents) updateTerritoryComponentSelectionFeedback();
      else {
        setModeBanner('선택한 영토 밖에서 시작해 연결 영역 하나를 한 번 관통하는 국경선을 그리세요. 영토 밖의 선은 판정에서 제외됩니다.', 'add-country-mode');
      }
    } else {
      return;
    }
    updateModeButtons();
    renderAll();
  }

  function toggleTerritorySelectionMethod() {
    const componentsMode = (state.tool === 'annex-territory' && state.annexPhase === 'components')
      || (state.tool === 'new-country' && state.newCountryPhase === 'components');
    switchTerritorySelectionMethod(componentsMode ? 'line' : 'components');
  }

  function clearDraftInput(invalidateInteraction = true) {
    if (invalidateInteraction) invalidateEditInteraction();
    state.draftCoords = [];
    state.draftHover = null;
    if (draftLayer) draftLayer.selectAll('*').remove();
  }

  function resetTerritoryEditingState(invalidateInteraction = true) {
    clearDraftInput(invalidateInteraction);
    resetAnnexState();
    resetNewCountryState();
  }

  function setTool(tool, announce = true) {
    if (state.tool !== tool) clearDraftInput(true);
    state.labelPlacementMode = false;
    if (tool !== 'country-coast') state.coastEditCountryId = null;
    if (tool !== 'merge-country') state.mergeSourceCountryId = null;
    if (tool !== 'annex-territory') resetAnnexState();
    if (tool !== 'new-country') resetNewCountryState();
    state.tool = tool;
    const names = {
      select: '국가 선택',
      'new-country': '국가 추가',
      'annex-territory': '영토 편입',
      'merge-country': '국가 합병 대상 선택',
      'country-coast': '해안선 수정',
      label: '지명 배치',
      river: '강 추가', lake: '호수 추가',
      polygon: '영역 그리기', line: '선 그리기', point: '점 찍기',
    };
    setCurrentTool(names[tool] || tool);
    setModeBanner();
    renderCountries();
    renderBoundaryEditOverlay();
    renderVertices();
    renderDraft();
    syncMobileNavigation();
    updateModeButtons();
  }

  function enterTerrainDrawingMode(tool) {
    const config = terrainToolConfig(tool);
    if (!config) return;
    clearNotification();
    clearSelection(false);
    resetTerritoryEditingState(true);
    state.coastEditCountryId = null;
    state.mergeSourceCountryId = null;
    setTool(tool, false);
    setModeBanner(config.geometry === 'LineString'
      ? '강의 흐름을 따라 점을 연결하세요. 완료하면 하나의 선으로 저장합니다.'
      : '호수의 경계를 따라 점을 연결하세요. 완료하면 영역을 자동으로 닫습니다.');
    updateModeButtons();
    if (usesOverlayEditor()) closeMobileSheets();
  }

  function enterNewCountryMode() {
    clearNotification();
    if (state.countriesLocked) {
      setActionStatus('국가를 편집할 수 없습니다. 국가 레이어 잠금을 해제하세요.', 'error', 3200);
      return;
    }
    clearSelection(false);
    state.draftCoords = [];
    state.draftHover = null;
    resetNewCountryState();
    state.newCountryPhase = 'sources';
    setTool('new-country', false);
    setModeBanner('신생국 영토를 가져올 원본 국가를 하나 이상 선택하세요. 여러 국가를 선택할 수 있습니다.', 'add-country-mode');
  }

  function toggleNewCountrySource(id) {
    if (state.tool !== 'new-country' || state.newCountryPhase !== 'sources') return;
    const sourceId = String(id || '');
    if (!countryFeatureById(sourceId)) return;
    const selected = new Set(state.newCountrySourceIds.map(String));
    if (selected.has(sourceId)) selected.delete(sourceId);
    else selected.add(sourceId);
    state.newCountrySourceIds = [...selected];
    const count = state.newCountrySourceIds.length;
    renderCountries();
    setModeBanner(`원본 국가 ${count}개를 선택했습니다. 지도에서 국가를 선택해 추가하거나 해제한 뒤 선택을 완료하세요.`, 'add-country-mode');
  }

  function beginNewCountryLine() {
    if (state.tool !== 'new-country' || state.newCountryPhase !== 'sources') return;
    try {
      selectedCountryUnionGeometry(state.newCountrySourceIds);
    } catch (error) {
      setActionStatus(error.message, 'error', 3600);
      return;
    }
    state.newCountryPhase = 'line';
    state.newCountryCandidates = [];
    state.newCountrySelectedCandidateIndex = null;
    state.newCountrySelectedComponentKeys = [];
    state.draftCoords = [];
    state.draftHover = null;
    setModeBanner('선택한 영토 밖에서 시작해 연결 영역 하나를 한 번 관통하는 국경선을 그리세요. 영토 밖의 선은 판정에서 제외됩니다.', 'add-country-mode');
    updateModeButtons();
    renderAll();
  }

  function enterAnnexTerritoryMode(id) {
    clearNotification();
    const feature = countryFeatureById(id);
    if (!feature) return;
    if (state.countriesLocked) {
      setActionStatus('국가를 편집할 수 없습니다. 국가 레이어 잠금을 해제하세요.', 'error', 3200);
      return;
    }
    state.draftCoords = [];
    state.draftHover = null;
    state.annexTargetCountryId = String(id);
    state.annexDonorCountryId = null;
    state.annexPhase = 'donor';
    state.annexComponentIndex = null;
    state.annexCandidates = [];
    state.annexSelectedCandidateIndex = null;
    state.annexSelectedComponentKeys = [];
    setTool('annex-territory', false);
    state.annexTargetCountryId = String(id);
    syncCountryActionButtons();
    renderCountries();
    if (usesOverlayEditor()) closeMobileSheets();
    focusCountry(feature);
    setModeBanner(`${countryName(feature)}에 영토를 넘길 피편입국을 지도에서 선택하세요.`, 'annex-mode');
  }

  function selectAnnexDonor(id) {
    const targetId = String(state.annexTargetCountryId || '');
    const donorId = String(id || '');
    if (state.tool !== 'annex-territory' || state.annexPhase !== 'donor') return;
    if (!targetId || donorId === targetId) {
      setActionStatus('수령국은 피편입국으로 선택할 수 없습니다. 다른 국가를 선택하세요.', 'error', 3500);
      return;
    }
    const donor = countryFeatureById(donorId);
    if (!donor?.geometry || !['Polygon', 'MultiPolygon'].includes(donor.geometry.type)) {
      setActionStatus('피편입국을 찾을 수 없습니다. 지도에 표시된 다른 국가를 선택하세요.', 'error', 3500);
      return;
    }
    state.annexDonorCountryId = donorId;
    state.annexPhase = 'line';
    state.annexComponentIndex = null;
    state.annexCandidates = [];
    state.annexSelectedCandidateIndex = null;
    state.annexSelectedComponentKeys = [];
    state.draftCoords = [];
    state.draftHover = null;
    focusCountry(donor);
    setModeBanner(`${countryName(donor)}의 경계 밖에서 시작해 영토 조각 하나를 한 번 관통하는 선을 그리세요. 국가 밖의 선은 판정에서 제외됩니다.`, 'annex-mode');
    updateModeButtons();
    renderAll();
  }

  function enterCountryCoastEdit(id) {
    clearNotification();
    const feature = countryFeatureById(id);
    if (!feature) return;
    if (state.countriesLocked) {
      setActionStatus('국가를 편집할 수 없습니다. 국가 레이어 잠금을 해제하세요.', 'error', 3200);
      return;
    }
    rebuildBoundaryTopology(id);
    state.coastEditCountryId = String(id);
    setTool('country-coast', false);
    state.coastEditCountryId = String(id);
    rebuildBoundaryTopology(id);
    syncCountryActionButtons();
    if (usesOverlayEditor()) closeMobileSheets();
    focusCountry(feature);
    setModeBanner(`${countryName(feature)}의 해안선 꼭짓점을 드래그하세요. 육상 국경은 변경되지 않습니다.`, 'coast-mode');
  }

  function finishCountryCoastEdit() {
    const id = state.coastEditCountryId;
    if (!id) return;
    const feature = countryFeatureById(id);
    setTool('select', false);
    state.boundaryTopology = { edges: new Map(), nodes: new Map() };
    if (feature) selectCountry(id, true);
    queueAutosave();
    setActionStatus(`${feature ? countryName(feature) : '국가'}의 해안선을 수정했습니다.`, 'success');
  }

  function enterMergeCountryMode(id) {
    clearNotification();
    const feature = countryFeatureById(id);
    if (!feature) return;
    if (state.countriesLocked) {
      setActionStatus('국가를 편집할 수 없습니다. 국가 레이어 잠금을 해제하세요.', 'error', 3200);
      return;
    }
    state.mergeSourceCountryId = String(id);
    setTool('merge-country', false);
    state.mergeSourceCountryId = String(id);
    setModeBanner(`${countryName(feature)}에 합병할 국가를 지도에서 선택하세요.`, 'merge-mode');
    syncCountryActionButtons();
    if (usesOverlayEditor()) closeMobileSheets();
  }

  function cancelActiveMode() {
    const cancelledTool = state.tool;
    const selectedId = state.annexTargetCountryId
      || state.coastEditCountryId
      || state.mergeSourceCountryId
      || (state.selected?.type === 'country' ? state.selected.id : null);
    resetTerritoryEditingState(true);
    state.coastEditCountryId = null;
    state.mergeSourceCountryId = null;
    setTool('select', false);
    if (selectedId && countryFeatureById(selectedId)) selectCountry(selectedId, true);
    renderDraft();
    const labels = { 'new-country': '국가 추가', 'annex-territory': '영토 편입', 'merge-country': '국가 합병', 'country-coast': '해안선 수정' };
    setActionStatus(`${labels[cancelledTool] || '지도 작업'}을 취소했습니다.`, 'success');
  }

  function enterLabelMode() {
    clearNotification();
    resetTerritoryEditingState(true);
    state.coastEditCountryId = null;
    state.mergeSourceCountryId = null;
    state.tool = 'label';
    state.labelPlacementMode = true;
    setCurrentTool('지명 배치');
    $('map').classList.add('drawing-mode');
    $('map').classList.remove('select-mode');
    setModeBanner('지도에서 지명을 배치할 위치를 선택하세요. Esc를 누르면 취소됩니다.');
    syncMobileNavigation();
    updateModeButtons();
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

  function handleMapClick(screenPoint) {
    const coord = screenToGeo(screenPoint);
    if (!coord) return;
    if (state.labelPlacementMode) {
      addLabelAt(coord);
      return;
    }
    if (state.tool === 'select' && !state.labelPlacementMode) {
      const clickedHydro = hydroAtScreenPoint(screenPoint, coord);
      if (clickedHydro) {
        selectHydro(String(clickedHydro.properties?.aw_id || clickedHydro.id));
        return;
      }
    }
    const needsCountryHit = (state.tool === 'select' && !state.labelPlacementMode) ||
      (state.tool === 'new-country' && state.newCountryPhase === 'sources') ||
      (state.tool === 'annex-territory' && state.annexPhase === 'donor') ||
      (state.tool === 'merge-country' && !!state.mergeSourceCountryId);
    const clickedCountry = needsCountryHit && state.layerVisibility.countries
      ? countryAtScreenPoint(screenPoint, coord)
      : null;
    if (state.tool === 'new-country' && state.newCountryPhase === 'sources') {
      if (clickedCountry) toggleNewCountrySource(clickedCountry.properties.editor_id);
      else setActionStatus('원본 국가를 선택할 수 없습니다. 국가 영토 안쪽을 선택하세요.', 'error', 2600);
      return;
    }
    if (state.tool === 'annex-territory' && state.annexPhase === 'donor') {
      if (clickedCountry) selectAnnexDonor(clickedCountry.properties.editor_id);
      else setActionStatus('피편입국을 선택할 수 없습니다. 국가 영토 안쪽을 선택하세요.', 'error', 2600);
      return;
    }
    if (state.tool === 'merge-country' && state.mergeSourceCountryId) {
      if (clickedCountry) completeCountryMerge(clickedCountry.properties.editor_id);
      else setActionStatus('합병 대상을 선택할 수 없습니다. 국가 영토 안쪽을 선택하세요.', 'error', 2600);
      return;
    }
    if (state.tool === 'select' && !state.labelPlacementMode && clickedCountry) {
      if (state.countriesLocked) {
        setActionStatus('국가를 선택할 수 없습니다. 국가 레이어 잠금을 해제하세요.', 'error');
        return;
      }
      selectCountry(clickedCountry.properties.editor_id);
      return;
    }
    if (state.tool === 'annex-territory') {
      if (state.annexPhase === 'donor') {
        setActionStatus('피편입국을 먼저 지도에서 선택하세요.', 'error', 3200);
        return;
      }
      if (state.annexPhase !== 'line') return;
      const donor = countryFeatureById(state.annexDonorCountryId);
      if (!donor) {
        setActionStatus('선택한 피편입국을 찾을 수 없습니다. 피편입국을 다시 선택하세요.', 'error', 3400);
        return;
      }
      const nextCoord = coord.slice();
      if (!state.draftCoords.length || !coordNear(state.draftCoords[state.draftCoords.length - 1], nextCoord, 1e-9)) {
        state.draftCoords.push(nextCoord);
      }
      state.draftHover = null;
      renderDraft();
      setModeBanner(
        `${countryName(donor)}의 영토 조각 하나를 한 번 관통하도록 새 국경선을 그리세요. 현재 ${state.draftCoords.length}개 점을 입력했습니다.`,
        'annex-mode'
      );
      return;
    }
    const newCountryLineMode = state.tool === 'new-country' && state.newCountryPhase === 'line';
    if (isDrawingDraftTool(state.tool) || newCountryLineMode) {
      state.draftCoords.push(coord);
      state.draftHover = null;
      renderDraft();
      const polygonMode = isPolygonDraftTool(state.tool);
      const min = polygonMode ? 3 : 2;
      const terrain = terrainToolConfig(state.tool);
      if (terrain) {
        setModeBanner(`${terrain.label}의 ${polygonMode ? '경계를' : '흐름을'} 따라 점을 연결하세요. 현재 ${state.draftCoords.length}개를 입력했으며 최소 ${min}개가 필요합니다.`);
      } else if (newCountryLineMode) {
        setModeBanner(`선택한 영토의 연결 영역을 한 번 관통하도록 새 국경선을 그리세요. 현재 ${state.draftCoords.length}개 점을 입력했습니다.`, 'add-country-mode');
      } else {
        setModeBanner(`점 ${state.draftCoords.length}개를 입력했습니다. 최소 ${min}개를 입력한 뒤 완료하세요.`);
      }
      updateModeButtons();
      return;
    }
    if (state.tool === 'point') {
      recordHistory();
      const feature = {
        type: 'Feature', id: uid('point'),
        geometry: { type: 'Point', coordinates: coord },
        properties: { name: '', editorColor: DEFAULT_DRAWING_COLOR, category: 'custom', notes: '' },
      };
      state.drawings.push(feature);
      setTool('select');
      selectDrawing(String(feature.id));
      renderAll();
      queueAutosave();
      setActionStatus('점 지형지물을 추가했습니다.', 'success');
      return;
    }
    if (state.tool === 'select') clearSelection();
  }

  function finishDraft() {
    if (!(isDrawingDraftTool(state.tool) || ['new-country', 'annex-territory'].includes(state.tool))) {
      setActionStatus('완료할 형상이 없습니다. 지도에서 점을 먼저 입력하세요.', 'error');
      return;
    }
    const polygonMode = isPolygonDraftTool(state.tool);
    const min = polygonMode ? 3 : 2;
    if (state.draftCoords.length < min) {
      setActionStatus(`완료하려면 점이 최소 ${min}개 필요합니다. 지도에서 점을 더 입력하세요.`, 'error');
      return;
    }

    if (state.tool === 'annex-territory') {
      const targetId = String(state.annexTargetCountryId || '');
      const donorId = String(state.annexDonorCountryId || '');
      const target = countryFeatureById(targetId);
      const donor = countryFeatureById(donorId);
      if (state.annexPhase !== 'line' || !target || !donor) {
        setActionStatus('편입을 진행할 수 없습니다. 수령국과 피편입국을 먼저 선택하세요.', 'error', 3800);
        return;
      }

      try {
        const split = buildAnnexSplitCandidates(donorId, state.draftCoords);
        state.annexComponentIndex = split.componentIndex;
        state.draftCoords = split.cutLine.map(coord => coord.slice());
        state.draftHover = null;
        state.annexCandidates = split.candidates;
        state.annexSelectedCandidateIndex = split.candidates[0].area <= split.candidates[1].area ? 0 : 1;
        state.annexPhase = 'side';
        setModeBanner('작은 영역을 자동으로 선택했습니다. 초록색 영역을 확인하거나 보라색 영역을 선택해 전환한 뒤 완료하세요.', 'annex-mode');
        updateModeButtons();
        renderAll();
      } catch (error) {
        setActionStatus(`새 국경선을 사용할 수 없습니다. ${error.message}`, 'error', 4400);
        return;
      }
      return;
    }

    if (state.tool === 'new-country') {
      if (state.newCountryPhase !== 'line') {
        setActionStatus('새 국가를 만들 수 없습니다. 원본 국가 선택을 먼저 완료하세요.', 'error', 3600);
        return;
      }
      try {
        const sourceGeometry = selectedCountryUnionGeometry(state.newCountrySourceIds);
        const split = buildCutSplitCandidates(sourceGeometry, state.draftCoords);
        state.draftCoords = split.cutLine.map(coord => coord.slice());
        state.draftHover = null;
        state.newCountryCandidates = split.candidates;
        state.newCountrySelectedCandidateIndex = split.candidates[0].area <= split.candidates[1].area ? 0 : 1;
        state.newCountryPhase = 'side';
        setModeBanner('작은 영역을 자동으로 선택했습니다. 초록색 영역을 확인하거나 보라색 영역을 선택해 전환한 뒤 완료하세요.', 'add-country-mode');
        updateModeButtons();
        renderAll();
      } catch (error) {
        setActionStatus(`신생국 국경선을 사용할 수 없습니다. ${error.message}`, 'error', 4400);
        return;
      }
      return;
    }

    // 기존 프로젝트, GeoJSON과 지형지물 편집이 공유하는 도형 처리.
    recordHistory();
    const terrain = terrainToolConfig(state.tool);
    const id = uid(terrain?.prefix || (polygonMode ? 'poly' : 'line'));
    let geometry;
    if (polygonMode) {
      const ring = orientRing(state.draftCoords, true);
      geometry = { type: 'Polygon', coordinates: [ring] };
    } else {
      geometry = { type: 'LineString', coordinates: state.draftCoords.map(c => c.slice()) };
    }
    const feature = {
      type: 'Feature', id, geometry,
      properties: {
        name: '',
        editorColor: terrain?.color || DEFAULT_DRAWING_COLOR,
        category: terrain?.category || 'custom',
        notes: '',
      },
    };
    state.drawings.push(feature);
    state.draftCoords = [];
    state.draftHover = null;
    setTool('select', false);
    selectDrawing(String(id));
    renderAll();
    queueAutosave();
    const createdObjectLabel = terrain?.category === 'river' ? '강을' : terrain?.category === 'lake' ? '호수를' : '지형지물을';
    setActionStatus(`${createdObjectLabel} 추가했습니다.`, 'success');
  }

  function completeLinearAnnexation(candidateIndex) {
    if (state.tool !== 'annex-territory' || !['side', 'components'].includes(state.annexPhase)) return;
    const targetId = String(state.annexTargetCountryId || '');
    const donorId = String(state.annexDonorCountryId || '');
    let candidate = null;
    if (state.annexPhase === 'components') {
      try { candidate = { geometry: selectedTerritoryComponentGeometry() }; }
      catch (error) { setActionStatus(error.message, 'error', 3800); return; }
    } else {
      const selectedIndex = candidateIndex === null ? NaN : Number(candidateIndex);
      candidate = Number.isInteger(selectedIndex) && selectedIndex >= 0
        ? state.annexCandidates[selectedIndex]
        : null;
    }
    const targetBefore = countryFeatureById(targetId);
    const donorBefore = countryFeatureById(donorId);
    if (!candidate?.geometry || !targetBefore || !donorBefore) {
      setActionStatus('편입 후보나 국가 데이터를 찾을 수 없습니다.', 'error', 3800);
      return;
    }
    const targetName = countryName(targetBefore);
    const donorName = countryName(donorBefore);
    const snapshot = snapshotEditable();
    let plan;
    try {
      plan = buildAnnexationPlan(targetId, donorId, candidate.geometry);
      const affectedIds = new Set(plan.affectedIds);
      const unionBefore = countryUnionFromFeatures(state.countriesData.features, affectedIds);
      applyTerritoryTransferPlan(plan);
      reindexCountries(state.countriesData, true);
      refreshCountryCentroids(affectedIds);
      state.boundaryTopology = { edges: new Map(), nodes: new Map() };
      const validation = validateCountryGeometryEdit(affectedIds, unionBefore);
      if (!validation.ok) throw new Error(validation.message);
      const targetAfter = countryFeatureById(targetId);
      if (!targetAfter) throw new Error('수령국이 편입 결과에서 사라졌습니다.');

      commitHistorySnapshot(snapshot);
      state.draftCoords = [];
      state.draftHover = null;
      setTool('select', false);
      selectCountry(targetId);
      renderAll();
      queueAutosave();
      const removedText = plan.removedIds.includes(donorId) ? ' · 피편입국 완전 흡수' : '';
      setActionStatus(`${donorName}의 선택 영토를 ${targetName}에 편입했습니다${removedText}.`, 'success', 4000);
    } catch (error) {
      restoreCountryEditSnapshot(snapshot);
      setActionStatus(`영토를 편입할 수 없어 변경을 되돌렸습니다. ${error.message}`, 'error', 4400);
    }
  }

  function completeNewCountryCreation(candidateIndex) {
    if (state.tool !== 'new-country' || !['side', 'components'].includes(state.newCountryPhase)) return;
    let candidate = null;
    if (state.newCountryPhase === 'components') {
      try { candidate = { geometry: selectedTerritoryComponentGeometry() }; }
      catch (error) { setActionStatus(error.message, 'error', 3800); return; }
    } else {
      const selectedIndex = candidateIndex === null ? NaN : Number(candidateIndex);
      candidate = Number.isInteger(selectedIndex) && selectedIndex >= 0
        ? state.newCountryCandidates[selectedIndex]
        : null;
    }
    if (!candidate?.geometry) {
      setActionStatus('신생국 영토 후보를 찾을 수 없습니다.', 'error', 3800);
      return;
    }
    const nameInput = prompt('새 국가의 국명을 입력하세요.', '새 국가');
    if (nameInput === null) return;
    const sourceIds = state.newCountrySourceIds.map(String);
    const snapshot = snapshotEditable();
    try {
      const transferPlan = buildNewCountryTransferPlan(sourceIds, candidate.geometry);
      const unionBefore = countryUnionFromFeatures(state.countriesData.features, new Set(transferPlan.affectedSourceIds));
      applyTerritoryTransferPlan(transferPlan);
      const feature = createCountryFeature(nameInput.trim() || '새 국가', state.draftCoords, null, candidate.geometry);
      state.countriesData.features.push(feature);
      const affectedIds = new Set([...transferPlan.affectedSourceIds, feature.properties.editor_id]);
      markCountryGeometriesChanged(affectedIds);
      reindexCountries(state.countriesData, true);
      refreshCountryCentroids(affectedIds);
      state.boundaryTopology = { edges: new Map(), nodes: new Map() };
      const validation = validateCountryGeometryEdit(affectedIds, unionBefore);
      if (!validation.ok) throw new Error(validation.message);

      commitHistorySnapshot(snapshot);
      state.draftCoords = [];
      state.draftHover = null;
      setTool('select', false);
      selectCountry(feature.properties.editor_id);
      renderAll();
      queueAutosave();
      const removedText = transferPlan.removedIds.length ? ` · 원본 ${transferPlan.removedIds.length}개국 완전 흡수` : '';
      setActionStatus(`${countryName(feature)} 국가를 추가했습니다. 선택한 ${transferPlan.affectedSourceIds.length}개국의 영토만 이전했습니다${removedText}.`, 'success', 4200);
    } catch (error) {
      restoreCountryEditSnapshot(snapshot);
      setActionStatus(`국가를 추가할 수 없어 변경을 되돌렸습니다. ${error.message}`, 'error', 4400);
    }
  }

  function completeCountryMerge(targetId) {
    const sourceId = state.mergeSourceCountryId;
    if (!sourceId) return;
    if (String(targetId) === String(sourceId)) {
      setActionStatus('같은 국가는 합병할 수 없습니다. 다른 국가를 선택하세요.', 'error');
      return;
    }
    const source = countryFeatureById(sourceId);
    const target = countryFeatureById(targetId);
    if (!source || !target) {
      setActionStatus('합병할 국가를 찾을 수 없습니다. 대상을 다시 선택하세요.', 'error');
      return;
    }
    const sourceName = countryName(source);
    const targetName = countryName(target);
    if (!confirm(`${sourceName}에 ${targetName}을(를) 합병할까요?\n두 국가의 영토가 하나의 국가 데이터로 합쳐집니다.`)) return;
    const mergedNameInput = prompt('합병 후 국명을 입력하세요.', sourceName);
    if (mergedNameInput === null) return;
    recordHistory();
    const result = mergeCountryGeometries([source.geometry, target.geometry]);
    source.geometry = result.geometry;
    const mergedName = mergedNameInput.trim() || sourceName;
    source.properties.editor_name = mergedName;
    source.properties.name = mergedName;
    source.properties.pop_est = Number(source.properties.pop_est || 0) + Number(target.properties.pop_est || 0);
    source.properties.gdp_md_est = Number(source.properties.gdp_md_est || 0) + Number(target.properties.gdp_md_est || 0);
    state.countryOverrides[sourceId] = { ...(state.countryOverrides[sourceId] || {}), name: mergedName };
    delete state.countryOverrides[String(targetId)];
    state.countriesData.features = state.countriesData.features.filter(f => String(f.properties?.editor_id) !== String(targetId));
    markCountryGeometriesChanged(new Set([sourceId, String(targetId)]));
    reindexCountries(state.countriesData, true);
    state.boundaryTopology = { edges: new Map(), nodes: new Map() };
    refreshCountryCentroids(new Set([sourceId]));
    setTool('select', false);
    selectCountry(sourceId);
    renderAll();
    queueAutosave();
    if (!result.seamless) setActionStatus('국가를 합병했습니다. 원본 국경 꼭짓점이 일치하지 않는 일부 구간에는 내부 경계선이 남을 수 있습니다.', 'success', 4300);
    else setActionStatus(`${targetName}을(를) ${mergedName}에 합병했습니다.`, 'success', 3000);
  }

  function cancelDraft(showMessage = true) {
    const terrain = terrainToolConfig(state.tool);
    clearDraftInput(true);
    setTool('select', false);
    renderAll();
    if (showMessage) setActionStatus(`${terrain?.label || '지형지물'} 추가를 취소했습니다.`, 'success');
  }

  function addLabelAt(coord) {
    const name = prompt('지명 또는 도시명을 입력하세요.', '새 지명');
    if (name === null) return;
    recordHistory();
    const label = { id: uid('label'), name: name.trim() || '새 지명', kind: 'city', coordinates: coord.slice(), notes: '' };
    state.labels.push(label);
    exitLabelMode(false);
    selectLabel(label.id);
    renderAll();
    queueAutosave();
    setActionStatus(`${label.name} 지명을 추가했습니다.`, 'success');
  }

  function vertexDragBehavior(feature) {
    return d3.behavior.drag()
      .on('dragstart', function() {
        if (!feature || state.tool !== 'select') return;
        recordHistory();
        d3.event.sourceEvent?.stopPropagation?.();
      })
      .on('drag', function(vertex) {
        if (!feature || state.tool !== 'select') return;
        const coord = screenToGeo(d3.mouse(svg.node()));
        if (!coord) return;
        if (feature.geometry.type === 'LineString') {
          feature.geometry.coordinates[vertex.index] = coord;
        } else if (feature.geometry.type === 'Polygon') {
          const ring = feature.geometry.coordinates[0];
          ring[vertex.index] = coord;
          if (vertex.index === 0) ring[ring.length - 1] = coord.slice();
        }
        drawingLayer.selectAll('path.drawing-shape').attr('d', path);
        vertexLayer.selectAll('circle.vertex-handle').attr('transform', d => {
          const f = state.drawings.find(x => String(x.id) === state.selected?.id);
          const verts = getEditableVertices(f);
          const fresh = verts.find(v => v.index === d.index) || d;
          const p = activeProjection()(fresh.coord);
          return p ? `translate(${p[0]},${p[1]})` : 'translate(-9999,-9999)';
        });
      })
      .on('dragend', function() {
        if (!feature) return;
        renderAll();
        queueAutosave();
        setActionStatus('꼭짓점을 이동했습니다.', 'success');
      });
  }

  function countryCoastVertexDragBehavior(feature) {
    let activeRefs = [];
    let affectedIds = new Set();
    let transactionSnapshot = null;
    let startCoord = null;
    let dragEnabled = false;
    let changed = false;
    return d3.behavior.drag()
      .on('dragstart', function(vertex) {
        if (!feature || state.tool !== 'country-coast') return;
        dragEnabled = false;
        const node = state.boundaryTopology?.nodes?.get(vertex.nodeKey || coordKey(vertex.coord));
        if (!node) return;
        transactionSnapshot = snapshotEditable();
        startCoord = node.coord.slice();
        changed = false;
        const selectedId = String(state.coastEditCountryId || feature.properties.editor_id);
        activeRefs = (node?.refs || [])
          .filter(ref => String(ref.countryId) === selectedId)
          .map(ref => ({ countryId: ref.countryId, feature: ref.feature, vertex: ref.vertex }));
        if (!activeRefs.length) activeRefs = [{ countryId: feature.properties.editor_id, feature, vertex }];
        affectedIds = new Set(activeRefs.map(ref => String(ref.countryId)));
        dragEnabled = true;
        d3.event.sourceEvent?.stopPropagation?.();
      })
      .on('drag', function() {
        if (!feature || state.tool !== 'country-coast' || !dragEnabled) return;
        const coord = screenToGeo(d3.mouse(svg.node()));
        if (!coord) return;
        changed = changed || !coordNear(startCoord, coord, 1e-9);
        for (const ref of activeRefs) setCountryVertexCoord(ref.feature, ref.vertex, coord);
        countryLayer.selectAll('path.country-shape').attr('d', path);
        gpuMapRenderer.render(++renderRevision);
        boundaryEditLayer.selectAll('path.boundary-edit-segment')
          .attr('d', d => path({ type: 'Feature', geometry: d.geometry, properties: {} }));
        vertexLayer.selectAll('circle.vertex-handle').attr('transform', d => {
          const node = state.boundaryTopology?.nodes?.get(d.nodeKey || '');
          const fresh = node?.refs?.[0]?.vertex?.coord || d.coord;
          const p = activeProjection()(fresh);
          return p ? `translate(${p[0]},${p[1]})` : 'translate(-9999,-9999)';
        });
      })
      .on('dragend', function() {
        if (!feature || state.tool !== 'country-coast' || !dragEnabled || !transactionSnapshot) return;
        const snapshot = transactionSnapshot;
        dragEnabled = false;
        transactionSnapshot = null;
        try {
          if (!changed) {
            renderAll();
            return;
          }
          markCountryGeometriesChanged(affectedIds);
          refreshCountryCentroids(affectedIds);
          rebuildBoundaryTopology(state.coastEditCountryId);
          const validation = validateCountryGeometryEdit(affectedIds);
          if (!validation.ok) throw new Error(validation.message);
          commitHistorySnapshot(snapshot);
          const editedFeature = countryFeatureById(state.coastEditCountryId);
          renderAll();
          queueAutosave();
          setModeBanner(`${editedFeature ? countryName(editedFeature) : '국가'}의 해안선 꼭짓점을 드래그하세요. 육상 국경은 변경되지 않습니다.`, 'coast-mode');
          setActionStatus('해안선을 수정했습니다.', 'success');
        } catch (error) {
          restoreCountryEditSnapshot(snapshot);
          setActionStatus(`해안선을 이동할 수 없어 변경을 되돌렸습니다. ${error.message}`, 'error', 4300);
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
        queueAutosave();
        setActionStatus(`${label.name} 지명을 이동했습니다.`, 'success');
      });
  }

  function showPropertyForm(type) {
    $('emptyProperties').classList.toggle('hidden', !!type);
    $('countryProperties').classList.toggle('hidden', type !== 'country');
    $('drawingProperties').classList.toggle('hidden', type !== 'drawing');
    $('labelProperties').classList.toggle('hidden', type !== 'label');
    $('hydroProperties').classList.toggle('hidden', type !== 'hydro');
  }

  function renderFlag(dataUrl) {
    const preview = $('flagPreview');
    preview.innerHTML = '';
    if (!dataUrl) {
      preview.textContent = '국기 없음';
      return;
    }
    const img = document.createElement('img');
    img.src = dataUrl;
    img.alt = '등록된 국기';
    preview.appendChild(img);
  }

  function selectCountry(id, refreshOnly = false) {
    const idx = state.countryIndex.get(String(id));
    if (idx === undefined) return;
    const feature = state.countriesData.features[idx];
    const p = feature.properties || {};
    const override = state.countryOverrides[id] || {};
    state.selected = { type: 'country', id: String(id) };
    showPropertyForm('country');
    $('propertyTitle').textContent = override.name || p.editor_name || p.editor_original_name || id;
    $('propertyType').textContent = '국가';
    $('countryNameInput').value = override.name || p.editor_name || p.editor_original_name || '';
    $('countryCodeInput').value = id;
    $('countryColorInput').value = override.color || p.editor_color || defaultCountryColor();
    $('capitalInput').value = override.capital || p.capital || '';
    $('notesInput').value = override.notes || p.notes || '';
    $('originalNameValue').textContent = p.editor_original_name || p.editor_name || '—';
    renderFlag(override.flagDataUrl || p.flagDataUrl || null);
    $('selectionStatus').textContent = `국가 · ${$('propertyTitle').textContent}`;
    syncCountryActionButtons();
    markLayerTreeDirty();
    renderAll();
    if (!refreshOnly) openSelectionEditor();
  }

  function selectDrawing(id, refreshOnly = false) {
    const feature = state.drawings.find(f => String(f.id) === String(id));
    if (!feature) return;
    const meta = feature.properties || (feature.properties = {});
    const typeLabel = drawingCategoryLabel(feature);
    state.selected = { type: 'drawing', id: String(id) };
    showPropertyForm('drawing');
    $('propertyTitle').textContent = drawingName(feature);
    $('propertyType').textContent = typeLabel;
    $('drawingNameInput').value = meta.name || '';
    $('drawingIdInput').value = String(id);
    $('drawingColorInput').value = meta.editorColor || DEFAULT_DRAWING_COLOR;
    $('drawingCategoryInput').value = meta.category || 'custom';
    $('drawingNotesInput').value = meta.notes || '';
    $('selectionStatus').textContent = `${typeLabel} · ${meta.name || String(id).slice(0, 8)}`;
    markLayerTreeDirty();
    renderAll();
    if (!refreshOnly) openSelectionEditor();
  }

  function selectLabel(id, refreshOnly = false) {
    const label = state.labels.find(item => item.id === id);
    if (!label) return;
    state.selected = { type: 'label', id };
    showPropertyForm('label');
    $('propertyTitle').textContent = label.name;
    $('propertyType').textContent = '지명';
    $('labelNameInput').value = label.name;
    $('labelKindInput').value = label.kind;
    $('labelNotesInput').value = label.notes || '';
    $('selectionStatus').textContent = `지명 · ${label.name}`;
    markLayerTreeDirty();
    renderAll();
    if (!refreshOnly) openSelectionEditor();
  }

  function selectHydro(id, refreshOnly = false) {
    const feature = hydroFeatureById(id);
    if (!feature || !isHydroFeatureVisible(feature)) return;
    const properties = feature.properties || {};
    const category = properties.category === 'lake' ? '호수' : '강';
    state.selected = { type: 'hydro', id: String(properties.aw_id || feature.id) };
    showPropertyForm('hydro');
    $('propertyTitle').textContent = properties.name || `이름 없는 ${category}`;
    $('propertyType').textContent = `${category} · 내장 잠금`;
    $('hydroNameValue').textContent = properties.name || '이름 없음';
    $('hydroCategoryValue').textContent = category;
    $('hydroLayerValue').textContent = HYDRO_LAYER_META[properties.layer_id]?.label || properties.layer_id || '수계';
    $('hydroSourceValue').textContent = properties.source || 'Natural Earth 5.0.0 1:10m';
    $('selectionStatus').textContent = `${category} · ${properties.name || '이름 없음'}`;
    markLayerTreeDirty();
    renderAll();
    if (!refreshOnly) openSelectionEditor();
  }

  function copySelectedHydroForEditing() {
    if (state.selected?.type !== 'hydro') return;
    const source = hydroFeatureById(state.selected.id);
    if (!source) {
      setActionStatus('복사할 수계 객체를 찾을 수 없습니다. 다시 선택하세요.', 'error', 3200);
      return;
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
        editorColor: TERRAIN_TOOL_CONFIG[category].color,
        notes: `Natural Earth 편집용 복사본 · 원본 ${source.properties?.aw_id || source.id}`,
        source: source.properties?.source || 'Natural Earth 5.0.0 1:10m',
        sourceFeatureId: source.properties?.aw_id || source.id,
      },
    };
    state.drawings.push(copy);
    state.physicalSettings.hiddenHydroIds[String(source.properties?.aw_id || source.id)] = true;
    markLayerTreeDirty();
    selectDrawing(String(copy.id));
    renderAll();
    queueAutosave();
    setActionStatus(`${source.properties?.name || (category === 'lake' ? '호수' : '강')}의 편집용 복사본을 만들고 내장 원본을 숨겼습니다.`, 'success', 3600);
  }

  function clearSelection(announce = true) {
    state.selected = null;
    $('propertyTitle').textContent = '지도에서 객체를 선택하세요';
    $('propertyType').textContent = '선택 없음';
    $('selectionStatus').textContent = '선택 없음';
    showPropertyForm(null);
    syncCountryActionButtons();
    markLayerTreeDirty();
    renderAll();
  }

  function commitCountryEdit(field, value) {
    if (state.selected?.type !== 'country') return;
    recordHistory();
    const id = state.selected.id;
    state.countryOverrides[id] = { ...(state.countryOverrides[id] || {}), [field]: value };
    const idx = state.countryIndex.get(id);
    if (idx !== undefined) {
      const f = state.countriesData.features[idx];
      f.properties.editor_name = state.countryOverrides[id].name || f.properties.editor_original_name;
      const explicitColor = state.countryOverrides[id].color || f.properties.editor_color;
      if (explicitColor) f.properties.editor_color = explicitColor;
      else delete f.properties.editor_color;
    }
    markLayerTreeDirty();
    selectCountry(id, true);
    queueAutosave();
    setActionStatus('국가 정보를 변경했습니다.', 'success');
  }

  function commitDrawingMeta(field, value) {
    if (state.selected?.type !== 'drawing') return;
    const f = state.drawings.find(x => String(x.id) === state.selected.id);
    if (!f) return;
    recordHistory();
    f.properties = f.properties || {};
    f.properties[field] = value;
    markLayerTreeDirty();
    selectDrawing(state.selected.id, true);
    queueAutosave();
    setActionStatus('지형지물 정보를 변경했습니다.', 'success');
  }

  function commitLabelEdit(field, value) {
    if (state.selected?.type !== 'label') return;
    const label = state.labels.find(x => x.id === state.selected.id);
    if (!label) return;
    recordHistory();
    label[field] = value;
    markLayerTreeDirty();
    selectLabel(label.id, true);
    queueAutosave();
    setActionStatus('지명 정보를 변경했습니다.', 'success');
  }

  function configureDatasetSession(project = null) {
    const deltaProject = project?.format === 'atlaswright-autosave-delta';
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
      const pristineById = new Map((PRISTINE_COUNTRIES.features || []).map((feature, index) => [featureCountryId(feature, index), feature]));
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
      : deepClone(PRISTINE_COUNTRIES);
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
      countryOverrides: deepClone(state.countryOverrides),
      sourceInfo: deepClone(state.sourceInfo),
      labels: deepClone(state.labels),
      drawings: deepClone(state.drawings),
      physicalSettings: deepClone(state.physicalSettings),
    };
  }

  function commitHistorySnapshot(snapshot) {
    state.history.push(snapshot);
    if (state.history.length > MAX_HISTORY) state.history.shift();
    state.future = [];
    updateHistoryButtons();
  }

  function recordHistory() {
    commitHistorySnapshot(snapshotEditable());
  }

  function restoreEditable(snapshot) {
    state.countryOverrides = deepClone(snapshot.countryOverrides || {});
    state.sourceInfo = deepClone(snapshot.sourceInfo || null);
    state.labels = deepClone(snapshot.labels || []);
    state.drawings = deepClone(snapshot.drawings || []);
    state.physicalSettings = normalizePhysicalSettings(snapshot.physicalSettings || state.physicalSettings);
    syncPhysicalControls();
    restoreCountriesFromSnapshot(snapshot);
    pruneLayerItemVisibility();
    scheduleCountryLabelAnchors(null, 10);
    markLayerTreeDirty();
    state.selected = null;
    state.coastEditCountryId = null;
    state.mergeSourceCountryId = null;
    resetTerritoryEditingState(true);
    state.tool = 'select';
    showPropertyForm(null);
    $('propertyTitle').textContent = '지도에서 객체를 선택하세요';
    $('propertyType').textContent = '선택 없음';
    $('selectionStatus').textContent = '선택 없음';
    state.boundaryTopology = { edges: new Map(), nodes: new Map() };
    updateModeButtons();
    scheduleGpuMeshRebuild(0);
    renderAll();
    $('countryStatus').textContent = `현재 지도 ${state.countriesData?.features?.length || 0}개`;
    queueAutosave();
  }

  function undo() {
    if (!state.history.length) return;
    state.future.push(snapshotEditable());
    const prev = state.history.pop();
    restoreEditable(prev);
    updateHistoryButtons();
    setActionStatus('이전 작업을 실행 취소했습니다.', 'success');
  }

  function redo() {
    if (!state.future.length) return;
    state.history.push(snapshotEditable());
    const next = state.future.pop();
    restoreEditable(next);
    updateHistoryButtons();
    setActionStatus('작업을 다시 실행했습니다.', 'success');
  }

  function updateHistoryButtons() {
    $('undoBtn').disabled = !state.history.length;
    $('redoBtn').disabled = !state.future.length;
  }

  function setProjection(type) {
    state.projection = type === 'globe' ? 'globe' : 'flat';
    $('globeBtn').classList.toggle('active', state.projection === 'globe');
    $('flatBtn').classList.toggle('active', state.projection === 'flat');
    renderAll();
    queueViewAutosave();
  }

  function setLayerVisibility(key, visible) {
    state.layerVisibility[key] = visible;
    renderAll();
    queueAutosave();
  }

  function buildAtlasState() {
    const project = {
      format: 'atlaswright-project-state',
      version: APP_VERSION,
      savedAt: new Date().toISOString(),
      countriesData: state.countriesData,
      countryOverrides: state.countryOverrides,
      labels: state.labels,
      drawings: state.drawings,
      physicalSettings: state.physicalSettings,
      projection: state.projection,
      layerVisibility: state.layerVisibility,
      itemVisibility: state.itemVisibility,
      layerFolders: state.layerFolders,
      countriesLocked: state.countriesLocked,
      view: state.view,
      baseDataset: BASE_DATASET,
      sourceInfo: state.sourceInfo,
    };
    project.physicalSourceInfo = {
      terrain: {
        dataset: state.terrainManifest?.dataset || TERRAIN_DATASET,
        version: state.terrainManifest?.version || '0.12.0',
      },
      hydro: {
        dataset: state.hydroManifest?.dataset || HYDRO_DATASET,
        version: state.hydroManifest?.version || APP_VERSION,
        coordinatePolicy: state.hydroManifest?.coordinatePolicy || 'selected source coordinates retained without simplification',
        selection: deepClone(state.hydroManifest?.selection || {}),
      },
    };
    return project;
  }

  function buildAutosaveData() {
    if (state.sessionBaseCountriesJson) return { ...buildAtlasState(), format: 'atlaswright-autosave-full' };
    return {
      format: 'atlaswright-autosave-delta',
      version: APP_VERSION,
      savedAt: new Date().toISOString(),
      countryDelta: buildCountryDelta(),
      countryOverrides: state.countryOverrides,
      labels: state.labels,
      drawings: state.drawings,
      physicalSettings: state.physicalSettings,
      projection: state.projection,
      layerVisibility: state.layerVisibility,
      itemVisibility: state.itemVisibility,
      layerFolders: state.layerFolders,
      countriesLocked: state.countriesLocked,
      view: state.view,
      baseDataset: BASE_DATASET,
      sourceInfo: state.sourceInfo,
    };
  }

  function countriesFromAutosaveDelta(project) {
    const base = deepClone(PRISTINE_COUNTRIES);
    const delta = project?.countryDelta || { changed: [], removedIds: [] };
    const changed = new Map((delta.changed || []).map(feature => [String(feature.properties?.editor_id || feature.properties?.iso_a3 || ''), feature]));
    const removed = new Set((delta.removedIds || []).map(String));
    const seen = new Set();
    base.features = (base.features || []).filter(feature => {
      const id = String(feature.properties?.editor_id || feature.properties?.iso_a3 || '');
      return !removed.has(id);
    }).map(feature => {
      const id = String(feature.properties?.editor_id || feature.properties?.iso_a3 || '');
      if (!changed.has(id)) return feature;
      seen.add(id);
      return deepClone(changed.get(id));
    });
    for (const [id, feature] of changed) if (!seen.has(id) && !removed.has(id)) base.features.push(deepClone(feature));
    const result = reindexCountries(base, true);
    const unchangedIds = (result.features || []).map(feature => String(feature.properties?.editor_id || '')).filter(id => !changed.has(id));
    applyPristineLabelAnchors(result, unchangedIds);
    return result;
  }

  let autosaveDbPromise = null;

  function openAutosaveDatabase() {
    if (!window.indexedDB) return Promise.reject(new Error('IndexedDB를 지원하지 않는 브라우저입니다.'));
    if (autosaveDbPromise) return autosaveDbPromise;
    autosaveDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(AUTOSAVE_DB_NAME, 2);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(AUTOSAVE_STORE_NAME)) db.createObjectStore(AUTOSAVE_STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB 열기 실패'));
      request.onblocked = () => reject(new Error('다른 창에서 자동저장 DB를 사용 중입니다.'));
    });
    return autosaveDbPromise;
  }

  async function readIndexedDbProject() {
    const db = await openAutosaveDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(AUTOSAVE_STORE_NAME, 'readonly');
      const store = transaction.objectStore(AUTOSAVE_STORE_NAME);
      const projectRequest = store.get(AUTOSAVE_RECORD_KEY);
      const viewRequest = store.get(AUTOSAVE_VIEW_KEY);
      transaction.oncomplete = () => {
        const project = projectRequest.result || null;
        const viewRecord = viewRequest.result || null;
        resolve(project && viewRecord
          ? { ...project, projection: viewRecord.projection || project.projection, view: { ...(project.view || {}), ...(viewRecord.view || {}) } }
          : project);
      };
      transaction.onerror = () => reject(transaction.error || new Error('자동저장 읽기 실패'));
    });
  }

  async function writeIndexedDbProject(project) {
    const db = await openAutosaveDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(AUTOSAVE_STORE_NAME, 'readwrite');
      transaction.objectStore(AUTOSAVE_STORE_NAME).put(project, AUTOSAVE_RECORD_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('자동저장 쓰기 실패'));
      transaction.onabort = () => reject(transaction.error || new Error('자동저장 쓰기 취소'));
    });
  }

  async function writeIndexedDbView() {
    const db = await openAutosaveDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(AUTOSAVE_STORE_NAME, 'readwrite');
      transaction.objectStore(AUTOSAVE_STORE_NAME).put({ projection: state.projection, view: deepClone(state.view), savedAt: new Date().toISOString() }, AUTOSAVE_VIEW_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('보기 위치 저장 실패'));
    });
  }

  async function deleteAutosavedProject() {
    clearTimeout(state.autosaveTimer);
    state.autosaveTimer = null;
    try {
      const db = await openAutosaveDatabase();
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(AUTOSAVE_STORE_NAME, 'readwrite');
        const store = transaction.objectStore(AUTOSAVE_STORE_NAME);
        store.delete(AUTOSAVE_RECORD_KEY);
        store.delete(AUTOSAVE_VIEW_KEY);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error('자동저장 삭제 실패'));
      });
    } catch (_) {}
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (_) {}
  }

  function saveLocalStorageFallback(project) {
    const serialized = JSON.stringify(project);
    if (serialized.length > 4_500_000) throw new Error('고해상도 프로젝트가 localStorage 용량을 초과합니다.');
    localStorage.setItem(STORAGE_KEY, serialized);
  }

  function queueViewAutosave(delay = 120) {
    clearTimeout(state.viewAutosaveTimer);
    state.viewAutosaveTimer = setTimeout(() => {
      writeIndexedDbView().catch(error => console.warn('View autosave failed', error));
    }, delay);
  }

  function queueAutosave(delay = 650) {
    setAutosaveStatus('저장 대기…');
    clearTimeout(state.autosaveTimer);
    state.autosaveTimer = setTimeout(async () => {
      const project = buildAutosaveData();
      try {
        await writeIndexedDbProject(project);
        state.lastSavedAt = new Date();
        setAutosaveStatus(state.lastSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      } catch (error) {
        try {
          saveLocalStorageFallback(project);
          state.lastSavedAt = new Date();
          setAutosaveStatus(`${state.lastSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · 호환 저장`);
        } catch (fallbackError) {
          console.warn('Autosave failed', error, fallbackError);
          setAutosaveStatus('수동 저장 필요');
          setActionStatus('자동저장 용량을 초과했습니다. GeoPackage 파일로 직접 저장하세요.', 'error', 5200);
        }
      }
    }, delay);
  }

  function restoreLocalAutosave() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  async function restoreAutosavedProject() {
    try {
      const project = await readIndexedDbProject();
      if (project) return { project, source: 'indexeddb' };
    } catch (error) {
      console.warn('IndexedDB restore failed', error);
    }
    const local = restoreLocalAutosave();
    if (!local) return { project: null, source: null };
    try {
      await writeIndexedDbProject(local);
      localStorage.removeItem(STORAGE_KEY);
    } catch (_) {}
    return { project: local, source: 'localstorage' };
  }

  function applyAtlasState(project, manual = false) {
    if (!project || typeof project !== 'object') throw new Error('프로젝트 형식이 올바르지 않습니다.');
    resetCountryLabelAnchorRuntime();
    state.countryOverrides = deepClone(project.countryOverrides || {});
    state.labels = deepClone(project.labels || []);
    state.drawings = deepClone(project.drawings || []);
    state.physicalSettings = normalizePhysicalSettings(project.physicalSettings);
    state.projection = project.projection || project.view?.projection || 'globe';
    state.layerVisibility = { ...state.layerVisibility, ...(project.layerVisibility || {}) };
    state.itemVisibility = normalizeLayerItemState(project.itemVisibility);
    state.layerFolders = normalizeLayerFolderState(project.layerFolders);
    state.layerSearch = '';
    state.countriesLocked = !!project.countriesLocked;
    state.sourceInfo = deepClone(project.sourceInfo || null);
    state.view = clampViewZooms({ ...state.view, ...(project.view || {}) });
    state.countriesData = project.countriesData
      ? reindexCountries(deepClone(project.countriesData), true)
      : freshPristineCountries(true);
    pruneLayerItemVisibility();
    scheduleCountryLabelAnchors(null, 10);
    markLayerTreeDirty();
    configureDatasetSession(project);
    const externalGeometry = !!project.countriesData && project.baseDataset !== BASE_DATASET;
    state.history = [];
    state.future = [];
    state.selected = null;
    state.draftCoords = [];
    state.draftHover = null;

    $('globeBtn').classList.toggle('active', state.projection === 'globe');
    $('flatBtn').classList.toggle('active', state.projection !== 'globe');
    $('countriesVisible').checked = state.layerVisibility.countries;
    $('drawingsVisible').checked = state.layerVisibility.drawings;
    $('labelsVisible').checked = state.layerVisibility.labels;
    $('basemapLabelsVisible').checked = state.layerVisibility.basemapLabels;
    $('countriesLocked').checked = state.countriesLocked;
    syncPhysicalControls();
    if ($('layerSearchInput')) $('layerSearchInput').value = state.layerSearch;
    renderLayerTree(true);
    showPropertyForm(null);
    state.boundaryTopology = { edges: new Map(), nodes: new Map() };
    scheduleGpuMeshRebuild(0);
    renderAll();
    updateHistoryButtons();
    setTool('select');
    queueAutosave();
    $('countryStatus').textContent = `${externalGeometry ? '외부 형상' : '프로젝트'} ${state.countriesData.features.length}개`;
    if (manual) setActionStatus(externalGeometry
      ? '외부 GIS 형상을 저장 당시 상태로 불러왔습니다.'
      : '프로젝트를 불러왔습니다.', 'success', 3200);
  }

  let confirmModalAction = null;

  function openConfirmModal({ title = '확인', message = '', confirmText = '확인', danger = false, onConfirm = null } = {}) {
    const modal = $('confirmModal');
    if (!modal) return;
    clearNotification();
    closeMobileSheets();
    $('confirmModalTitle').textContent = title;
    $('confirmModalMessage').textContent = message;
    const ok = $('confirmModalOkBtn');
    ok.textContent = confirmText;
    ok.classList.toggle('danger-confirm', !!danger);
    confirmModalAction = typeof onConfirm === 'function' ? onConfirm : null;
    modal.classList.remove('hidden');
    requestAnimationFrame(() => ok.focus());
  }

  function closeConfirmModal() {
    $('confirmModal')?.classList.add('hidden');
    confirmModalAction = null;
  }

  async function resetProjectInPlace() {
    closeConfirmModal();
    closeMobileSheets();

    // 자동저장 타이머가 직전 편집 geometry를 다시 저장하는 것을 먼저 차단한다.
    await deleteAutosavedProject();
    resetCountryLabelAnchorRuntime();

    state.countryOverrides = {};
    state.sourceInfo = null;
    state.labels = [];
    state.drawings = [];
    state.physicalSettings = normalizePhysicalSettings(null);
    state.projection = 'globe';
    state.layerVisibility = { countries: true, drawings: true, labels: true, basemapLabels: true };
    state.itemVisibility = normalizeLayerItemState(null);
    state.layerFolders = normalizeLayerFolderState(null);
    state.layerSearch = '';
    state.countriesLocked = false;
    state.tool = 'select';
    state.labelPlacementMode = false;
    state.coastEditCountryId = null;
    state.mergeSourceCountryId = null;
    resetTerritoryEditingState(true);
    state.history = [];
    state.future = [];
    state.selected = null;
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
      (PRISTINE_COUNTRIES.features || []).map(f => [String(f.properties?.editor_id || f.properties?.iso_a3 || ''), f.geometry])
    );
    if (restoredGeometrySignature !== pristineGeometrySignature) {
      throw new Error('내장 원본 국경 복원 검증에 실패했습니다.');
    }
    refreshCountryCentroids();
    state.boundaryTopology = { edges: new Map(), nodes: new Map() };

    $('countriesVisible').checked = true;
    $('drawingsVisible').checked = true;
    $('labelsVisible').checked = true;
    $('basemapLabelsVisible').checked = true;
    $('countriesLocked').checked = false;
    syncPhysicalControls();
    if ($('layerSearchInput')) $('layerSearchInput').value = '';
    renderLayerTree(true);
    $('globeBtn').classList.add('active');
    $('flatBtn').classList.remove('active');
    showPropertyForm(null);
    $('propertyTitle').textContent = '지도에서 객체를 선택하세요';
    $('propertyType').textContent = '선택 없음';
    $('selectionStatus').textContent = '선택 없음';
    setTool('select', false);

    // 기존 SVG 노드는 편집된 Feature 객체를 __data__로 들고 있을 수 있으므로 완전히 제거 후 원본으로 재바인딩한다.
    countryLayer?.selectAll('*').remove();
    countryLabelLayer?.selectAll('*').remove();
    boundaryEditLayer?.selectAll('*').remove();
    vertexLayer?.selectAll('*').remove();
    drawingLayer?.selectAll('*').remove();
    labelLayer?.selectAll('*').remove();

    resizeMap();
    renderAll();
    updateHistoryButtons();
    updateZoomStatus();

    $('countryStatus').textContent = `내장 ${state.countriesData.features.length}개`;
    setAutosaveStatus('새 프로젝트');
    // 복원된 최초 geometry를 새 자동저장 기준으로 기록한다.
    queueAutosave();
    setActionStatus('새 프로젝트: 모든 국경을 최초 상태로 복원했습니다.', 'success', 3200);
  }

  function requestNewProject(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();

    // 모바일 파일 메뉴 위의 공용 backdrop과 확인 UI를 분리한다.
    // 파일 메뉴를 닫은 뒤 DOM 최상단 confirmModal에서 확인하므로 터치가 가로채이지 않는다.
    closeMobileSheets();
    openConfirmModal({
      title: '새 프로젝트',
      message: '현재 편집한 국경, 추가한 국가·지명·영역, 실행취소 기록과 자동저장을 모두 지우고\n내장된 최초 세계 국경으로 돌아갑니다.',
      confirmText: '초기 상태로 시작',
      danger: true,
      onConfirm: () => resetProjectInPlace(),
    });
  }

  function deleteSelectedCountry() {
    if (state.selected?.type !== 'country') return;
    const id = String(state.selected.id);
    const feature = countryFeatureById(id);
    if (!feature) return;
    const name = countryName(feature);
    openConfirmModal({
      title: '국가 삭제',
      message: `${name} 국가 객체를 지도에서 삭제합니다. 실행취소로 복구할 수 있습니다.`,
      confirmText: '국가 삭제',
      danger: true,
      onConfirm: () => {
        recordHistory();
        state.countriesData.features = state.countriesData.features.filter(f => String(f.properties?.editor_id) !== id);
        delete state.countryOverrides[id];
        markCountryGeometriesChanged([id]);
        reindexCountries(state.countriesData, true);
        state.boundaryTopology = { edges: new Map(), nodes: new Map() };
        clearSelection(false);
        renderAll();
        queueAutosave();
        setActionStatus(`${name} 국가를 삭제했습니다.`, 'success');
      },
    });
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
    if (!window.AtlasWrightGIS?.exportGeoPackage) throw new Error('GeoPackage 저장 모듈을 불러오지 못했습니다.');
    const button = $('saveProjectBtn');
    if (button) button.disabled = true;
    setActionStatus('GeoPackage 저장을 준비하는 중입니다.', 'working', 0);
    try {
      const blob = await window.AtlasWrightGIS.exportGeoPackage(buildAtlasState(), (message, percent) => {
        setActionStatus(`${message}${Number.isFinite(percent) ? ` · ${Math.round(percent)}%` : ''}`, 'working', 0);
      });
      downloadBlob('AtlasWright-프로젝트.gpkg', blob);
      setActionStatus('QGIS에서 열 수 있는 GeoPackage를 저장했습니다.', 'success', 3200);
    } catch (error) {
      setActionStatus(`GeoPackage를 저장할 수 없습니다. ${error.message}`, 'error', 5200);
    } finally {
      if (button) button.disabled = false;
    }
  }

  function geometryAreaKm2(geometry) {
    if (!geometry) return 0;
    try { return Math.max(0, d3.geo.area(geometry) * 6371.0088 * 6371.0088); }
    catch (_) { return 0; }
  }

  function mergeImportedCountryProperties(existing, imported, geometry) {
    const importedId = String(imported.properties?.editor_id || imported.id || '');
    return {
      type: 'Feature',
      id: importedId,
      properties: {
        ...(existing?.properties || {}),
        ...(imported.properties || {}),
        editor_id: importedId,
      },
      geometry,
    };
  }

  let gisGeometryWorker = null;
  let gisGeometrySequence = 0;
  const gisGeometryPending = new Map();

  function getGisGeometryWorker() {
    if (gisGeometryWorker) return gisGeometryWorker;
    gisGeometryWorker = new Worker(runtimeAssetUrl('workers/gis-geometry-worker.js'), { name: 'atlaswright-gis-geometry' });
    gisGeometryWorker.onmessage = event => {
      const pending = gisGeometryPending.get(event.data?.id);
      if (!pending) return;
      gisGeometryPending.delete(event.data.id);
      if (event.data.ok) pending.resolve(event.data);
      else pending.reject(new Error(event.data.error || 'GIS 지오메트리 검증에 실패했습니다.'));
    };
    gisGeometryWorker.onerror = event => {
      const error = new Error(event.message || 'GIS 지오메트리 Worker 오류');
      for (const pending of gisGeometryPending.values()) pending.reject(error);
      gisGeometryPending.clear();
      gisGeometryWorker?.terminate();
      gisGeometryWorker = null;
    };
    return gisGeometryWorker;
  }

  function validateGisCountryCollection(collection) {
    return new Promise((resolve, reject) => {
      const worker = getGisGeometryWorker();
      const id = ++gisGeometrySequence;
      gisGeometryPending.set(id, { resolve, reject });
      worker.postMessage({ id, action: 'validate', collection });
    });
  }

  async function planGisMerge(importedCountries, strategy) {
    const clipper = window.polygonClipping;
    if (!clipper?.union || !clipper?.difference || !clipper?.intersection) throw new Error('국가 병합 연산 엔진을 불러오지 못했습니다.');
    const current = (state.countriesData?.features || []).map(deepClone);
    const imported = (deepClone(importedCountries)?.features || []).map((feature, index) => {
      feature.properties = feature.properties || {};
      feature.properties.editor_id = featureCountryId(feature, index);
      return feature;
    });
    if (!imported.length) throw new Error('병합할 국가 객체가 없습니다.');

    const currentById = new Map(current.map(feature => [String(feature.properties?.editor_id || ''), feature]));
    const importedById = new Map(imported.map(feature => [String(feature.properties?.editor_id || ''), feature]));
    const importedIds = new Set(importedById.keys());
    const matched = [...importedIds].filter(id => currentById.has(id)).length;
    const added = imported.length - matched;
    const counts = { matched, added, replaced: 0, subtracted: 0, deleted: 0, overlapAreaKm2: 0, residualOverlapAreaKm2: 0 };
    let result;

    if (strategy === 'id-replace') {
      counts.replaced = matched;
      result = current.filter(feature => !importedIds.has(String(feature.properties?.editor_id || '')));
      result.push(...imported.map(deepClone));
      const unaffected = result.filter(feature => !importedIds.has(String(feature.properties?.editor_id || '')));
      for (const incoming of imported) {
        for (const other of unaffected) {
          if (!boundsOverlap(geometryBounds(incoming.geometry), geometryBounds(other.geometry))) continue;
          const overlap = normalizeClippedLandGeometry(clipper.intersection(incoming.geometry.coordinates, other.geometry.coordinates));
          if (!overlap || multiPolygonPlanarArea(geometryMultiCoordinates(overlap)) <= 1e-8) continue;
          counts.overlapAreaKm2 += geometryAreaKm2(overlap);
        }
      }
      return { countriesData: { type: 'FeatureCollection', features: result }, counts, canCommit: counts.overlapAreaKm2 <= 0.001 };
    }

    const importedRawUnion = normalizeClippedLandGeometry(clipper.union(...imported.map(feature => feature.geometry.coordinates)));
    if (!importedRawUnion) throw new Error('가져온 영토를 결합할 수 없습니다.');
    result = [];
    for (const existing of current) {
      const id = String(existing.properties?.editor_id || '');
      if (importedIds.has(id)) continue;
      if (!boundsOverlap(geometryBounds(existing.geometry), geometryBounds(importedRawUnion))) {
        result.push(existing);
        continue;
      }
      const overlap = normalizeClippedLandGeometry(clipper.intersection(existing.geometry.coordinates, importedRawUnion.coordinates));
      if (!overlap || multiPolygonPlanarArea(geometryMultiCoordinates(overlap)) <= 1e-8) {
        result.push(existing);
        continue;
      }
      counts.overlapAreaKm2 += geometryAreaKm2(overlap);
      const remainder = normalizeClippedLandGeometry(clipper.difference(existing.geometry.coordinates, importedRawUnion.coordinates));
      counts.subtracted += 1;
      if (!remainder) { counts.deleted += 1; continue; }
      existing.geometry = remainder;
      result.push(existing);
    }
    for (const incoming of imported) {
      const id = String(incoming.properties?.editor_id || '');
      const existing = currentById.get(id);
      const geometry = existing
        ? normalizeClippedLandGeometry(clipper.union(existing.geometry.coordinates, incoming.geometry.coordinates))
        : deepClone(incoming.geometry);
      if (!geometry) throw new Error(`${countryName(incoming)} 영토를 결합할 수 없습니다.`);
      result.push(mergeImportedCountryProperties(existing, incoming, geometry));
    }
    const countriesData = { type: 'FeatureCollection', features: result };
    counts.residualOverlapAreaKm2 = (await validateGisCountryCollection(countriesData)).overlapAreaKm2;
    return { countriesData, counts, canCommit: counts.residualOverlapAreaKm2 <= 0.001 };
  }

  function applyGpkgAssets(metadata, overrides) {
    const output = deepClone(overrides || {});
    for (const asset of metadata?.countryAssets || []) {
      if (!asset?.countryId || !asset?.base64) continue;
      const id = String(asset.countryId);
      output[id] = { ...(output[id] || {}), flagDataUrl: `data:${asset.mimeType || 'application/octet-stream'};base64,${asset.base64}` };
    }
    return output;
  }

  function importedCountryOverrides(collection) {
    const output = {};
    for (const feature of collection?.features || []) {
      const properties = feature.properties || {};
      const id = String(properties.editor_id || feature.id || '');
      if (!id) continue;
      const mapped = {
        name: properties.aw_name || properties.editor_name || properties.editor_original_name || properties.name || id,
        capital: properties.aw_capital || properties.capital || '',
        notes: properties.aw_notes || properties.notes || '',
      };
      const explicitColor = properties.aw_color || properties.editor_color;
      if (explicitColor) mapped.color = explicitColor;
      output[id] = mapped;
    }
    return output;
  }

  function appendSourceInfo(previous, next) {
    const imports = [];
    const append = value => {
      if (!value) return;
      if (Array.isArray(value.imports)) imports.push(...value.imports);
      else imports.push(value);
    };
    append(previous);
    append(next);
    return { mergedAt: new Date().toISOString(), imports };
  }

  function applyImportedReplacement(result) {
    const packageState = result.atlasMetadata?.projectState || {};
    const restoredOverrides = {
      ...importedCountryOverrides(result.countriesData),
      ...(packageState.countryOverrides || {}),
    };
    const mergedState = {
      ...packageState,
      countriesData: result.countriesData,
      countryOverrides: applyGpkgAssets(result.atlasMetadata, restoredOverrides),
      sourceInfo: result.atlasMetadata?.sourceInfo || result.sourceInfo,
    };
    applyAtlasState(mergedState, false);
    $('countryStatus').textContent = `GIS 레이어 ${state.countriesData.features.length}개`;
    setActionStatus(`국가 경계 ${state.countriesData.features.length}개를 새 프로젝트로 열었습니다.`, 'success', 3200);
  }

  function commitGisMerge(result, plan) {
    const before = snapshotEditable();
    const beforeIds = (state.countriesData?.features || []).map(feature => String(feature.properties?.editor_id || ''));
    state.sourceInfo = appendSourceInfo(state.sourceInfo, result.sourceInfo);
    const importedIds = new Set((result.countriesData?.features || []).map(feature => String(feature.properties?.editor_id || '')));
    const packagedOverrides = applyGpkgAssets(result.atlasMetadata, {
      ...importedCountryOverrides(result.countriesData),
      ...(result.atlasMetadata?.projectState?.countryOverrides || {}),
    });
    for (const feature of result.countriesData?.features || []) {
      const id = String(feature.properties?.editor_id || '');
      if (!id) continue;
      const next = { ...(state.countryOverrides[id] || {}), ...(packagedOverrides[id] || {}) };
      if (feature.properties?.editor_name) next.name = feature.properties.editor_name;
      if (feature.properties?.editor_color) next.color = feature.properties.editor_color;
      state.countryOverrides[id] = next;
    }
    state.countriesData = reindexCountries(deepClone(plan.countriesData), true);
    pruneLayerItemVisibility();
    scheduleCountryLabelAnchors(null, 10);
    markCountryGeometriesChanged([...beforeIds, ...importedIds, ...state.countriesData.features.map(feature => String(feature.properties?.editor_id || ''))]);
    commitHistorySnapshot(before);
    clearSelection(false);
    renderAll();
    queueAutosave();
    $('countryStatus').textContent = `병합 지도 ${state.countriesData.features.length}개`;
    setActionStatus('GIS 레이어를 한 번의 편집 작업으로 병합했습니다.', 'success', 3200);
  }

  function showGisMergePreview(result, plan) {
    const c = plan.counts;
    const lines = [
      `일치 ${c.matched}개 · 추가 ${c.added}개 · 교체 ${c.replaced}개`,
      `차감 ${c.subtracted}개 · 삭제 ${c.deleted}개`,
      `겹치는 면적 ${Math.round(c.overlapAreaKm2).toLocaleString()} km²`,
    ];
    if (c.residualOverlapAreaKm2 > 0.001) lines.push(`처리 후 남는 중첩 ${Math.round(c.residualOverlapAreaKm2).toLocaleString()} km²`);
    if (!plan.canCommit) lines.push('', c.residualOverlapAreaKm2 > 0.001
      ? '자동 차감 후에도 국가 간 중첩이 남아 확정할 수 없습니다.'
      : 'ID 기준 교체 후 다른 국가와 영토가 겹치므로 확정할 수 없습니다.');
    openConfirmModal({
      title: plan.canCommit ? 'GIS 병합 미리보기' : 'GIS 병합 중첩 발견',
      message: lines.join('\n'),
      confirmText: plan.canCommit ? '병합 확정' : '닫기',
      danger: !plan.canCommit,
      onConfirm: plan.canCommit ? () => commitGisMerge(result, plan) : null,
    });
  }

  async function openGisFiles(files) {
    if (!files?.length) return;
    if (!window.AtlasWrightGIS?.openImportWizard) throw new Error('GIS 가져오기 모듈을 불러오지 못했습니다.');
    setActionStatus('GIS 파일을 검사하는 중입니다.', 'working', 0);
    try {
      const result = await window.AtlasWrightGIS.openImportWizard(files);
      setActionStatus('국가 경계의 무결성을 검사하는 중입니다.', 'working', 0);
      const importedOverlapAreaKm2 = (await validateGisCountryCollection(result.countriesData)).overlapAreaKm2;
      if (importedOverlapAreaKm2 > 0.001) throw new Error(`가져온 레이어 안에서 서로 다른 국가가 ${Math.round(importedOverlapAreaKm2).toLocaleString()} km² 겹칩니다.`);
      if (result.openMode === 'replace') {
        openConfirmModal({
          title: '새 GIS 프로젝트로 열기',
          message: `현재 지도를 선택한 ${result.countriesData.features.length}개 국가 경계로 교체합니다.\n현재 자동저장은 새 상태로 바뀌지만 원본 입력 파일은 수정하지 않습니다.`,
          confirmText: '새 프로젝트로 열기',
          danger: true,
          onConfirm: () => applyImportedReplacement(result),
        });
      } else {
        showGisMergePreview(result, await planGisMerge(result.countriesData, result.mergeStrategy));
      }
    } catch (error) {
      if (error?.name === 'AbortError') { setActionStatus('GIS 파일 가져오기를 취소했습니다.', 'success'); return; }
      setActionStatus(`GIS 파일을 열 수 없습니다. ${error.message}`, 'error', 5600);
    }
  }

  async function importGeoJson(file) {
    const parsed = JSON.parse(await file.text());
    const features = parsed.type === 'FeatureCollection' ? parsed.features : parsed.type === 'Feature' ? [parsed] : [];
    const supported = [];
    for (const raw of features) {
      if (!['Point', 'LineString', 'Polygon', 'MultiLineString', 'MultiPolygon'].includes(raw.geometry?.type)) continue;
      const f = deepClone(raw);
      f.id = String(f.id || uid('import'));
      const p = f.properties || {};
      f.properties = {
        ...p,
        name: p.name || '',
        editorColor: p.editorColor || p.color || DEFAULT_DRAWING_COLOR,
        category: p.category || 'custom',
        notes: p.notes || '',
      };
      supported.push(f);
    }
    if (!supported.length) throw new Error('지원되는 점·선·면 지도 객체가 없습니다.');
    recordHistory();
    state.drawings.push(...supported);
    markLayerTreeDirty();
    renderAll();
    queueAutosave();
    setActionStatus(`GeoJSON ${supported.length}개 객체를 가져왔습니다.`, 'success', 3200);
  }

  function exportDrawingsGeoJson() {
    const geojson = { type: 'FeatureCollection', features: deepClone(state.drawings) };
    downloadBlob('AtlasWright-지형지물.geojson', new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' }));
    setActionStatus(`지형지물 ${state.drawings.length}개를 GeoJSON으로 내보냈습니다.`, 'success', 3200);
  }

  function deleteSelected() {
    if (!state.selected) {
      setActionStatus('삭제할 객체가 없습니다. 지도에서 객체를 먼저 선택하세요.', 'error');
      return;
    }
    if (state.selected.type === 'country') {
      setActionStatus('선택한 국가는 이 방법으로 삭제할 수 없습니다. 편집 패널의 국가 삭제 또는 합병 기능을 사용하세요.', 'error', 3500);
      return;
    }
    if (state.selected.type === 'hydro') {
      setActionStatus('내장 수계는 삭제할 수 없습니다. 편집용 복사본을 만들어 수정하세요.', 'error', 3400);
      return;
    }
    recordHistory();
    if (state.selected.type === 'drawing') {
      state.drawings = state.drawings.filter(f => String(f.id) !== state.selected.id);
    } else if (state.selected.type === 'label') {
      state.labels = state.labels.filter(l => l.id !== state.selected.id);
    }
    clearSelection();
    queueAutosave();
    setActionStatus('선택한 객체를 삭제했습니다.', 'success');
  }

  function zoomBy(factor, announce = true) {
    if (state.projection === 'globe') state.view.globeZoom = clamp(state.view.globeZoom * factor, ZOOM_LIMITS.globe.min, ZOOM_LIMITS.globe.max);
    else state.view.flatZoom = clamp(state.view.flatZoom * factor, ZOOM_LIMITS.flat.min, ZOOM_LIMITS.flat.max);
    renderAll();
    queueViewAutosave();
  }

  function focusCountry(feature, { announce = false, maxZoom = null } = {}) {
    if (!feature?.geometry) return;
    const center = d3.geo.centroid(feature);
    if (!center || !Number.isFinite(center[0]) || !Number.isFinite(center[1])) return;
    const { width, height } = state.size;
    const mobile = isMobile();
    if (state.projection === 'globe') {
      state.view.globeRotation = [-center[0], -center[1], 0];
      state.view.globeZoom = 1;
    } else {
      state.view.flatCenter = [center[0], center[1]];
      state.view.flatZoom = 1;
    }
    updateProjection();
    let bounds;
    try { bounds = path.bounds(feature); } catch (_) { bounds = null; }
    if (bounds && bounds[0] && bounds[1]) {
      const bw = Math.max(1, Math.abs(bounds[1][0] - bounds[0][0]));
      const bh = Math.max(1, Math.abs(bounds[1][1] - bounds[0][1]));
      const targetW = width * (mobile ? 0.68 : 0.62);
      const targetH = height * (mobile ? 0.48 : 0.68);
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
    renderAll();
    queueAutosave();
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

  function selectLayerTreeItem(group, id) {
    const key = String(id);
    if (group === 'countries' || group === 'countryLabels') {
      const feature = countryFeatureById(key);
      if (!feature) return;
      if (!state.countriesLocked) selectCountry(key);
      const primary = largestCountryComponentFeature(feature) || feature;
      focusCountry(primary, { maxZoom: isMobile() ? 10 : 9 });
      if (state.countriesLocked) setActionStatus('국가 레이어가 잠겨 있어 위치만 이동했습니다.', 'error', 2600);
    } else if (group === 'drawings') {
      if (key === 'terrain') {
        if (state.physicalLoadState.terrain === 'error') loadTerrainManifest(true);
        else setActionStatus(`지형 음영은 ${state.physicalSettings.terrainVisible ? '표시 중' : '숨김 상태'}입니다.`, 'success', 2200);
        return;
      }
      if (key === 'user-terrain') {
        setActionStatus(`사용자 지형지물은 ${state.drawings.length.toLocaleString()}개입니다. 항목을 선택하면 위치로 이동하고 편집할 수 있습니다.`, 'success', 2600);
        return;
      }
      if (key.startsWith('hydro-layer:')) {
        const layerId = key.slice('hydro-layer:'.length);
        if (!state.hydroManifest) loadHydroData(true);
        else {
          const count = Number(state.hydroManifest?.stats?.layerCounts?.[layerId] || 0);
          setActionStatus(`${HYDRO_LAYER_META[layerId]?.label || '수계'}에 ${count.toLocaleString()}개 객체가 있습니다. 현재 화면에 필요한 자료만 자동으로 불러옵니다.`, 'success', 3200);
        }
        return;
      }
      const feature = state.drawings.find(item => String(item.id) === key);
      if (!feature) return;
      selectDrawing(key);
      focusCountry(feature, { maxZoom: isMobile() ? 12 : 10 });
    } else if (group === 'labels') {
      const label = state.labels.find(item => String(item.id) === key);
      if (!label) return;
      selectLabel(key);
      focusCoordinate(label.coordinates);
    }
    markLayerTreeDirty();
    if (isMobile()) closeMobileSheets();
  }

  function resetView() {
    if (state.projection === 'globe') {
      state.view.globeRotation = [-15, -25, 0];
      state.view.globeZoom = 1;
    } else {
      state.view.flatCenter = [0, 20];
      state.view.flatZoom = 1;
    }
    renderAll();
    queueAutosave();
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
        queueAutosave();
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

  function bindUI() {
    document.addEventListener('pointerdown', event => {
      if (!event.target.closest('#notificationCloseBtn')) clearErrorNotification();
    }, true);
    document.addEventListener('click', e => {
      const button = e.target.closest('button');
      if (button) flashButton(button);
      if (!e.target.closest('.top-actions') && !e.target.closest('#mobileFileBtn')) {
        document.querySelector('.top-actions')?.classList.remove('mobile-open');
        syncMobileBackdrop();
      }
      if (!e.target.closest('.create-menu-wrap') && !e.target.closest('#mobileCreateBtn')) closeCreateMenu();
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
      closeCreateMenu();
      closeMobileSheets(null, { restoreFocus: true });
    });
    bindHoldZoom($('mobileZoomInBtn'), 1.34);
    bindHoldZoom($('mobileZoomOutBtn'), 0.746);
    $('mobileWorldBtn')?.addEventListener('click', () => {
      resetView();
      if (navigator.vibrate) navigator.vibrate(8);
    });
    $('mobileMapBtn')?.addEventListener('click', () => openMobileLeftAt());
    $('mobileCreateBtn')?.addEventListener('click', event => {
      event.stopPropagation();
      toggleCreateMenu(event.currentTarget);
    });
    $('mobileEditBtn')?.addEventListener('click', () => toggleMobileSheet('right'));
    $('mobileCloseLeftBtn')?.addEventListener('click', () => closeMobileSheets(null, { restoreFocus: true }));
    $('mobileCloseRightBtn')?.addEventListener('click', () => closeMobileSheets(null, { restoreFocus: true }));
    $('createMenu')?.addEventListener('keydown', event => {
      const items = [...event.currentTarget.querySelectorAll('[role="menuitem"]')];
      const index = items.indexOf(document.activeElement);
      let nextIndex = index;
      if (event.key === 'ArrowDown') nextIndex = (index + 1 + items.length) % items.length;
      else if (event.key === 'ArrowUp') nextIndex = (index - 1 + items.length) % items.length;
      else if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = items.length - 1;
      else return;
      event.preventDefault();
      items[nextIndex]?.focus();
    });

    $('countriesVisible').addEventListener('change', e => setLayerVisibility('countries', e.target.checked));
    $('drawingsVisible').addEventListener('change', e => setLayerVisibility('drawings', e.target.checked));
    $('labelsVisible').addEventListener('change', e => setLayerVisibility('labels', e.target.checked));
    $('basemapLabelsVisible').addEventListener('change', e => setLayerVisibility('basemapLabels', e.target.checked));
    $('terrainStyleSelect').addEventListener('change', event => {
      state.physicalSettings.terrainStyle = event.target.value === 'physical' ? 'physical' : 'political';
      renderAll();
      queueAutosave();
      setActionStatus(`${state.physicalSettings.terrainStyle === 'physical' ? '지형색 강조' : '국가색 + 음영'} 스타일로 전환했습니다.`, 'success', 2200);
    });
    $('terrainStrengthInput').addEventListener('input', event => {
      state.physicalSettings.terrainStrength = clamp(Number(event.target.value) / 100, 0, 1);
      $('terrainStrengthValue').textContent = `${Math.round(state.physicalSettings.terrainStrength * 100)}%`;
      scheduleRender();
    });
    $('terrainStrengthInput').addEventListener('change', () => queueAutosave());
    $('layerSearchInput')?.addEventListener('input', event => {
      state.layerSearch = event.target.value || '';
      markLayerTreeDirty();
      renderLayerTree();
    });
    $('layerSection')?.addEventListener('click', event => {
      const folderButton = event.target.closest('[data-layer-folder-toggle]');
      if (folderButton) {
        const group = folderButton.dataset.layerFolderToggle;
        if (!LAYER_GROUP_KEYS.includes(group)) return;
        state.layerFolders[group] = !state.layerFolders[group];
        markLayerTreeDirty();
        renderLayerTree();
        queueAutosave();
        return;
      }
      const itemButton = event.target.closest('[data-layer-item-select]');
      if (itemButton) selectLayerTreeItem(itemButton.dataset.layerItemSelect, itemButton.dataset.itemId);
    });
    $('layerSection')?.addEventListener('change', event => {
      const checkbox = event.target.closest('[data-layer-item-visibility]');
      if (!checkbox) return;
      setLayerItemVisibility(checkbox.dataset.layerItemVisibility, checkbox.dataset.itemId, checkbox.checked);
    });
    $('countriesLocked').addEventListener('change', e => {
      state.countriesLocked = e.target.checked;
      renderCountries();
      queueAutosave();
    });

    $('addCountryBtn')?.addEventListener('click', () => {
      closeCreateMenu();
      enterNewCountryMode();
    });
    $('addLabelBtn')?.addEventListener('click', () => {
      closeCreateMenu();
      enterLabelMode();
    });
    $('addRiverBtn')?.addEventListener('click', () => {
      closeCreateMenu();
      enterTerrainDrawingMode('river');
    });
    $('addLakeBtn')?.addEventListener('click', () => {
      closeCreateMenu();
      enterTerrainDrawingMode('lake');
    });
    $('modePrimaryBtn')?.addEventListener('click', () => {
      if (state.tool === 'country-coast') finishCountryCoastEdit();
      else if (state.tool === 'new-country' && state.newCountryPhase === 'sources') beginNewCountryLine();
      else if (state.tool === 'new-country' && state.newCountryPhase === 'side') completeNewCountryCreation(state.newCountrySelectedCandidateIndex);
      else if (state.tool === 'new-country' && state.newCountryPhase === 'components') completeNewCountryCreation(null);
      else if (state.tool === 'annex-territory' && state.annexPhase === 'side') completeLinearAnnexation(state.annexSelectedCandidateIndex);
      else if (state.tool === 'annex-territory' && state.annexPhase === 'components') completeLinearAnnexation(null);
      else if (isDrawingDraftTool(state.tool) || ['new-country', 'annex-territory'].includes(state.tool)) finishDraft();
    });
    $('modeSecondaryBtn')?.addEventListener('click', toggleTerritorySelectionMethod);
    $('modeCancelBtn')?.addEventListener('click', () => {
      if (state.labelPlacementMode || state.tool === 'label') exitLabelMode();
      else if (isDrawingDraftTool(state.tool)) cancelDraft(true);
      else cancelActiveMode();
    });
    $('annexTerritoryBtn')?.addEventListener('click', () => {
      if (state.selected?.type !== 'country') return;
      if (state.tool === 'annex-territory' && state.annexTargetCountryId === state.selected.id) cancelActiveMode();
      else enterAnnexTerritoryMode(state.selected.id);
    });
    $('editCoastBtn')?.addEventListener('click', () => {
      if (state.selected?.type !== 'country') return;
      if (state.tool === 'country-coast' && state.coastEditCountryId === state.selected.id) finishCountryCoastEdit();
      else enterCountryCoastEdit(state.selected.id);
    });
    $('deleteCountryBtn')?.addEventListener('click', deleteSelectedCountry);
    $('mergeCountryBtn')?.addEventListener('click', () => {
      if (state.selected?.type === 'country') enterMergeCountryMode(state.selected.id);
    });
    $('resetViewBtn').addEventListener('click', resetView);

    $('countryNameInput').addEventListener('change', e => commitCountryEdit('name', e.target.value.trim()));
    $('countryColorInput').addEventListener('change', e => commitCountryEdit('color', e.target.value));
    $('capitalInput').addEventListener('change', e => commitCountryEdit('capital', e.target.value.trim()));
    $('notesInput').addEventListener('change', e => commitCountryEdit('notes', e.target.value));
    $('flagUploadBtn').addEventListener('click', () => $('flagFileInput').click());
    $('flagFileInput').addEventListener('change', e => {
      const file = e.target.files?.[0];
      if (!file || state.selected?.type !== 'country') return;
      const reader = new FileReader();
      reader.onload = () => commitCountryEdit('flagDataUrl', reader.result);
      reader.readAsDataURL(file);
      e.target.value = '';
    });
    $('flagRemoveBtn').addEventListener('click', () => commitCountryEdit('flagDataUrl', null));

    $('drawingNameInput').addEventListener('change', e => commitDrawingMeta('name', e.target.value.trim()));
    $('drawingColorInput').addEventListener('change', e => commitDrawingMeta('editorColor', e.target.value));
    $('drawingCategoryInput').addEventListener('change', e => commitDrawingMeta('category', e.target.value));
    $('drawingNotesInput').addEventListener('change', e => commitDrawingMeta('notes', e.target.value));

    $('labelNameInput').addEventListener('change', e => commitLabelEdit('name', e.target.value.trim()));
    $('labelKindInput').addEventListener('change', e => commitLabelEdit('kind', e.target.value));
    $('labelNotesInput').addEventListener('change', e => commitLabelEdit('notes', e.target.value));
    $('deleteLabelBtn').addEventListener('click', deleteSelected);
    $('copyHydroBtn').addEventListener('click', copySelectedHydroForEditing);
    $('deleteDrawingInlineBtn')?.addEventListener('click', deleteSelected);

    $('undoBtn').addEventListener('click', undo);
    $('redoBtn').addEventListener('click', redo);
    $('zoomOutBtn')?.addEventListener('click', () => zoomBy(0.8));
    $('zoomInBtn')?.addEventListener('click', () => zoomBy(1.25));

    $('togglePanelBtn').addEventListener('click', () => {
      if (usesOverlayEditor()) {
        toggleMobileSheet('right');
        return;
      }
      $('rightPanel').classList.toggle('collapsed');
      document.querySelector('.workspace').classList.toggle('panel-collapsed');
      setTimeout(resizeMap, 60);
    });

    $('saveProjectBtn').addEventListener('click', saveGeoPackageFile);
    $('openGisBtn').addEventListener('click', () => {
      $('gisFileInput').click();
    });
    $('gisFileInput').addEventListener('change', async e => {
      const files = [...(e.target.files || [])];
      e.target.value = '';
      await openGisFiles(files);
    });

    $('newProjectBtn').addEventListener('click', requestNewProject);
    $('confirmModalCancelBtn')?.addEventListener('click', closeConfirmModal);
    $('confirmModal')?.querySelector('.confirm-modal-dim')?.addEventListener('click', closeConfirmModal);
    $('confirmModalOkBtn')?.addEventListener('click', () => {
      const action = confirmModalAction;
      closeConfirmModal();
      if (action) action();
    });

    $('importGeoJsonBtn').addEventListener('click', () => {
      $('geoJsonFileInput').click();
    });
    $('geoJsonFileInput').addEventListener('change', async e => {
      const file = e.target.files?.[0];
      if (!file) return;
      try { await importGeoJson(file); }
      catch (error) {
        setActionStatus(`GeoJSON을 가져올 수 없습니다. ${error.message}`, 'error', 4500);
      }
      e.target.value = '';
    });
    $('exportGeoJsonBtn').addEventListener('click', exportDrawingsGeoJson);
    document.querySelector('.top-actions')?.addEventListener('click', e => {
      const button = e.target.closest('button');
      if (!button) return;
      setTimeout(() => {
        document.querySelector('.top-actions')?.classList.remove('mobile-open');
        syncMobileBackdrop();
      }, 80);
    });

    document.addEventListener('keydown', e => {
      const tag = document.activeElement?.tagName;
      const editingText = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag);
      if (e.key === 'Escape') {
        if (!$('gisImportModal')?.classList.contains('hidden')) { $('gisImportCancelBtn')?.click(); return; }
        if (!$('confirmModal')?.classList.contains('hidden')) { closeConfirmModal(); return; }
        if (isCreateMenuOpen()) { closeCreateMenu({ restoreFocus: true }); return; }
        if (state.labelPlacementMode) exitLabelMode();
        else if (isDrawingDraftTool(state.tool)) cancelDraft(true);
        else if (['new-country', 'annex-territory', 'merge-country', 'country-coast'].includes(state.tool)) cancelActiveMode();
        else if (state.draftCoords.length) cancelDraft(true);
        else if (document.body.classList.contains('responsive-overlay-open')) closeMobileSheets(null, { restoreFocus: true });
        else if (!$('actionStatus')?.classList.contains('hidden')) clearNotification();
        else clearSelection();
      }
      const newCountryLineMode = state.tool === 'new-country' && state.newCountryPhase === 'line';
      const newCountrySideMode = state.tool === 'new-country' && state.newCountryPhase === 'side';
      const newCountryComponentsMode = state.tool === 'new-country' && state.newCountryPhase === 'components';
      const annexSideMode = state.tool === 'annex-territory' && state.annexPhase === 'side';
      const annexComponentsMode = state.tool === 'annex-territory' && state.annexPhase === 'components';
      if (e.key === 'Enter' && !editingText && (newCountrySideMode || annexSideMode || newCountryComponentsMode || annexComponentsMode)) {
        e.preventDefault();
        if (newCountrySideMode) completeNewCountryCreation(state.newCountrySelectedCandidateIndex);
        else if (newCountryComponentsMode) completeNewCountryCreation(null);
        else if (annexSideMode) completeLinearAnnexation(state.annexSelectedCandidateIndex);
        else completeLinearAnnexation(null);
        return;
      }
      if (e.key === 'Enter' && !editingText && (isDrawingDraftTool(state.tool) || newCountryLineMode || (state.tool === 'annex-territory' && state.annexPhase === 'line')) && state.draftCoords.length) {
        e.preventDefault(); finishDraft();
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
        if (state.selected) {
          e.preventDefault(); deleteSelected();
        }
      }
    });

    window.addEventListener('resize', () => {
      const layoutChanged = applyLayoutMode();
      if (!layoutChanged) queueMapResize();
    });
    const onSystemThemeChange = event => applySystemTheme(!!event.matches);
    if (typeof systemThemeQuery.addEventListener === 'function') systemThemeQuery.addEventListener('change', onSystemThemeChange);
    else if (typeof systemThemeQuery.addListener === 'function') systemThemeQuery.addListener(onSystemThemeChange);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') queueAutosave(0);
    });
    window.addEventListener('beforeunload', () => {
      try { writeIndexedDbProject(buildAutosaveData()).catch(() => {}); } catch (_) {}
    });
  }

  async function init() {
    assertRuntimeCompatibility();
    if (!window.d3) {
      $('engineStatus').textContent = '엔진 오류';
      setActionStatus('내장 지도 엔진을 불러올 수 없습니다. 페이지를 새로고침하세요.', 'error', 0);
      return;
    }
    if (!window.ATLASWRIGHT_COUNTRIES?.features?.length) {
      $('countryStatus').textContent = '내장 데이터 오류';
      setActionStatus('내장 국가 데이터를 불러올 수 없습니다. 페이지를 새로고침하세요.', 'error', 0);
      return;
    }

    const autosaveRestore = await restoreAutosavedProject();
    const restored = autosaveRestore.project;
    if (restored) {
      state.countryOverrides = deepClone(restored.countryOverrides || {});
      state.sourceInfo = deepClone(restored.sourceInfo || null);
      state.labels = deepClone(restored.labels || []);
      state.drawings = deepClone(restored.drawings || []);
      state.physicalSettings = normalizePhysicalSettings(restored.physicalSettings);
      state.projection = restored.projection || 'globe';
      state.layerVisibility = { ...state.layerVisibility, ...(restored.layerVisibility || {}) };
      state.itemVisibility = normalizeLayerItemState(restored.itemVisibility);
      state.layerFolders = normalizeLayerFolderState(restored.layerFolders);
      state.countriesLocked = !!restored.countriesLocked;
      state.view = clampViewZooms({ ...state.view, ...(restored.view || {}) });
    }

    const restoredDelta = restored?.format === 'atlaswright-autosave-delta';
    state.countriesData = restoredDelta
      ? countriesFromAutosaveDelta(restored)
      : restored?.countriesData
        ? reindexCountries(deepClone(restored.countriesData), true)
        : freshPristineCountries(true);
    pruneLayerItemVisibility();
    scheduleCountryLabelAnchors(null, 10);
    markLayerTreeDirty();
    configureDatasetSession(restored);
    const externalGeometry = !!restored?.countriesData && restored.baseDataset !== BASE_DATASET;
    $('countryStatus').textContent = `${restored ? (externalGeometry ? '외부 형상' : '프로젝트') : '1:10m 내장'} ${state.countriesData.features.length}개`;
    $('engineStatus').textContent = 'Natural Earth 5.1.1 · GPU 렌더러를 준비하는 중입니다.';
    state.boundaryTopology = { edges: new Map(), nodes: new Map() };

    applyLayoutMode({ initial: true });
    bindUI();
    initSvg();
    resizeMap();
    await new Promise(resolve => requestAnimationFrame(resolve));
    const gpuReady = await gpuMapRenderer.initialize();
    startMapResizeObserver();
    if (restored && gpuReady) scheduleGpuMeshRebuild(0);

    $('countriesVisible').checked = state.layerVisibility.countries;
    $('drawingsVisible').checked = state.layerVisibility.drawings;
    $('labelsVisible').checked = state.layerVisibility.labels;
    $('basemapLabelsVisible').checked = state.layerVisibility.basemapLabels;
    $('countriesLocked').checked = state.countriesLocked;
    syncPhysicalControls();
    if ($('layerSearchInput')) $('layerSearchInput').value = state.layerSearch;
    renderLayerTree(true);
    $('globeBtn').classList.toggle('active', state.projection === 'globe');
    $('flatBtn').classList.toggle('active', state.projection !== 'globe');

    resizeMap();
    updateHistoryButtons();
    setTool('select');
    loadPhysicalData();

    $('startupProbe')?.remove();
    scheduleMapContextCollapse();

    if (restored) {
      if (restored.countriesData && restored.baseDataset === BASE_DATASET) queueAutosave(0);
      setAutosaveStatus(autosaveRestore.source === 'localstorage' ? '기존 저장 이전됨' : '복원됨');
      if (gpuReady) {
        const restoredLabel = externalGeometry ? '외부 GIS 자동저장' : '자동저장 프로젝트';
        setActionStatus(`${restoredLabel}을 복원했습니다. 국가 ${state.countriesData.features.length}개를 불러왔습니다.`, 'success', 3200);
      } else {
        const renderer = gpuMapRenderer.getStats();
        setActionStatus(`자동저장을 복원했습니다. ${renderer.renderer === 'canvas-worker' ? 'Canvas Worker' : 'Canvas'} 무손실 렌더러를 사용합니다.`, 'success', 4200);
      }
    } else {
      setAutosaveStatus('준비');
      if (gpuReady) {
        setActionStatus(`고해상도 지도를 준비했습니다. 국가 ${state.countriesData.features.length}개를 불러왔습니다.`, 'success');
      } else {
        const renderer = gpuMapRenderer.getStats();
        setActionStatus(`${renderer.renderer === 'canvas-worker' ? 'Canvas Worker' : 'Canvas'} 무손실 렌더러를 준비했습니다.`, 'success', 4200);
      }
    }
  }

  try {
    init()
      .then(() => window.dispatchEvent(new CustomEvent('atlaswright:ready')))
      .catch(error => {
        window.dispatchEvent(new CustomEvent('atlaswright:error', { detail: error?.message || String(error) }));
        showFatalError(error);
      });
  } catch (error) {
    window.dispatchEvent(new CustomEvent('atlaswright:error', { detail: error?.message || String(error) }));
    showFatalError(error);
  }
})();
