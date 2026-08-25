/* AtlasWright v0.24.0
 * GitHub Pages-ready static map editor.
 * Rendering: bundled D3 v3 + Natural Earth 5.1.1 Admin 0 Countries 1:10m.
 * The full 1:10m geometry remains canonical; rendering and editing use lossless source data.
 * Source: naturalearthdata.com (public domain), default de facto boundary viewpoint.
 */

const moduleRevision = new URL(import.meta.url).searchParams.get('v') || '0.24.0';
const versionedModuleUrl = relativePath => {
  const url = new URL(relativePath, import.meta.url);
  url.searchParams.set('v', moduleRevision);
  return url.href;
};
const [projectStateModule, countryEditTransactionModule, surfaceControllerModule, toolControllerModule, mapInputControllerModule, gpuMapRendererModule] = await Promise.all([
  import(versionedModuleUrl('./modules/project-state.js')),
  import(versionedModuleUrl('./modules/country-edit-transaction.js')),
  import(versionedModuleUrl('./modules/surface-controller.js')),
  import(versionedModuleUrl('./modules/tool-controller.js')),
  import(versionedModuleUrl('./modules/map-input-controller.js')),
  import(versionedModuleUrl('./modules/gpu-map-renderer.js')),
  import(versionedModuleUrl('./modules/country-geometry.js')),
]);
const { applyProjectFields, pickProjectFields } = projectStateModule;
const { runCountryEditTransaction } = countryEditTransactionModule;
const { createSurfaceController } = surfaceControllerModule;
const { describeTool, dispatchTool, isSpecialTool, toolCursorMode, toolLabel } = toolControllerModule;
const { createMapInputController } = mapInputControllerModule;
const { createGpuMapRenderer } = gpuMapRendererModule;
const countryGeometry = globalThis.AtlasWrightCountryGeometry;
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

  const APP_VERSION = '0.24.0';
  const HYDRO_DATA_VERSION = '0.13.0';
  const ASSET_REVISION = window.ATLASWRIGHT_ASSET_REVISION || APP_VERSION;
  const ATLASWRIGHT_ASSET_BASE_URL = window.ATLASWRIGHT_ASSET_BASE_URL || new URL('./assets/js/', location.href).href;
  const PHYSICAL_DATA_BASE_URL = new URL('../data/', ATLASWRIGHT_ASSET_BASE_URL);
  const PHYSICAL_DATASET = 'HydroRIVERS 1.0 · Natural Earth 5.0.0 호수 · raster 3.2.0';
  const TERRAIN_DATASET = 'Natural Earth raster 3.2.0 1:10m';
  const HYDRO_DATASET = 'HydroRIVERS 1.0 · Natural Earth 5.0.0 1:10m lakes';

  const STORAGE_KEY = 'atlaswright-editor-v010-project';
  const AUTOSAVE_DB_NAME = 'atlaswright-editor-v010';
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
  const ZOOM_LIMITS = Object.freeze({
    globe: Object.freeze({ min: 0.72, max: 32 }),
    flat: Object.freeze({ min: 0.75, max: 64 }),
  });
  const TERRAIN_TOOL_CONFIG = Object.freeze({
    river: Object.freeze({ geometry: 'LineString', category: 'river', label: '강', color: '#3b82c4', prefix: 'river' }),
    lake: Object.freeze({ geometry: 'Polygon', category: 'lake', label: '호수', color: '#5aa9d6', prefix: 'lake' }),
  });
  const DRAWING_SCHEMA_VERSION = 1;
  const DRAWING_CATEGORY_RULES = Object.freeze({
    river: Object.freeze({ role: 'hydro', geometry: 'line', binding: 'none', label: '강' }),
    lake: Object.freeze({ role: 'hydro', geometry: 'polygon', binding: 'none', label: '호수' }),
    territory: Object.freeze({ role: 'territory', geometry: 'polygon', binding: 'hard', label: '영토' }),
    administrative: Object.freeze({ role: 'administrative', geometry: 'polygon', binding: 'hard', label: '행정구역' }),
    ethnicity: Object.freeze({ role: 'thematic', geometry: 'polygon', binding: 'clip', label: '민족' }),
    religion: Object.freeze({ role: 'thematic', geometry: 'polygon', binding: 'clip', label: '종교' }),
    language: Object.freeze({ role: 'thematic', geometry: 'polygon', binding: 'clip', label: '언어' }),
    custom: Object.freeze({ role: 'custom', geometry: 'any', binding: 'none', label: '사용자 정의' }),
  });
  const DRAWING_ROLE_LABELS = Object.freeze({
    hydro: '수계', territory: '영토', administrative: '행정구역', thematic: '주제 영역', custom: '사용자 정의',
  });
  const HYDRO_LAYER_META = Object.freeze({
    rivers_hydro: Object.freeze({ label: '강', shortLabel: '강', sourceLabel: 'HydroRIVERS', category: 'river', color: '#3b82c4' }),
    lakes_natural_earth: Object.freeze({ label: '호수', shortLabel: '호수', sourceLabel: 'Natural Earth', category: 'lake', color: '#5aa9d6' }),
  });
  const TERRAIN_OCEAN_REPRESENTATIVE = '#6aa8d2';
  const MAX_HISTORY = 30;
  const LAYOUT_QUERIES = {
    mobile: window.matchMedia('(max-width: 799px)'),
    compact: window.matchMedia('(min-width: 800px) and (max-width: 1359px)'),
  };

  const systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  let systemTheme = systemThemeQuery.matches ? 'dark' : 'light';
  let runtimeReady = false;
  document.documentElement.dataset.systemTheme = systemTheme;
  window.__ATLASWRIGHT_THEME__ = systemTheme;

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
    return systemTheme === 'light'
      ? { defaultLand: LIGHT_DEFAULT_COLOR, fillAlpha: terrainFillAlpha ?? 1, fillAlphaByte: Math.round((terrainFillAlpha ?? 1) * 255), border: '#ffffff', borderGpu: [1, 1, 1], borderAlpha: 1, ocean: '#ffffff', oceanGpu: [1, 1, 1] }
      : { defaultLand: DARK_DEFAULT_COLOR, fillAlpha: terrainFillAlpha ?? 0.74, fillAlphaByte: Math.round((terrainFillAlpha ?? 0.74) * 255), border: '#323c46', borderGpu: [0.196, 0.235, 0.275], borderAlpha: 0.92, ocean: '#0d2837', oceanGpu: [0.051, 0.157, 0.216] };
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
      syncColorPicker('country', {
        value: state.countryOverrides[id]?.color || feature?.properties?.editor_color || defaultCountryColor(),
        defaultColor: defaultCountryColor(),
        isDefault: !hasExplicitColor,
      });
    }
    if (svg) {
      markLayerTreeDirty();
      renderLayerTree();
      renderAll();
    }
  }

  const $ = (id) => document.getElementById(id);
  function runtimeAssetUrl(relativePath) {
    const url = new URL(relativePath, ATLASWRIGHT_ASSET_BASE_URL);
    url.searchParams.set('v', ASSET_REVISION);
    return url;
  }
  const REQUIRED_UI_IDS = Object.freeze([
    'app', 'map', 'engineStatus', 'statusView', 'statusPrimary', 'statusSelection',
    'globeBtn', 'flatBtn', 'countriesVisible', 'drawingsVisible', 'labelsVisible', 'basemapLabelsVisible', 'countriesLocked',
    'resetViewBtn', 'terrainVisible', 'terrainPoliticalRadio', 'terrainPhysicalRadio', 'terrainStrengthControl', 'terrainStrengthInput', 'terrainStrengthValue', 'countryNameInput', 'countryColorInput', 'capitalInput', 'notesInput',
    'flagUploadBtn', 'flagFileInput', 'flagRemoveBtn',
    'drawingNameInput', 'drawingFolderInput', 'drawingColorInput', 'drawingCategoryInput', 'drawingNotesInput',
    'drawingLandRelationSection', 'drawingOwnerField', 'drawingOwnerInput', 'drawingParentField', 'drawingParentInput', 'drawingLandBindingField', 'drawingLandBindingInput', 'drawingRoleHelp',
    'drawingLandActionsSection', 'splitDrawingBtn', 'mergeDrawingBtn', 'syncDrawingCoastBtn', 'editDrawingCoastBtn', 'applyDrawingToCountryBtn', 'promoteDrawingToCountryBtn', 'drawingRoleValue', 'drawingTopologyValue',
    'labelNameInput', 'labelKindInput', 'labelNotesInput', 'deleteLabelBtn',
    'editorScrollBody', 'editorObjectHeader', 'emptyProperties', 'propertyTitle',
    'countryProperties', 'drawingProperties', 'labelProperties', 'hydroProperties',
    'countryCodeInput', 'drawingIdInput', 'hydroCategoryValue', 'hydroIdValue', 'hydroSystemRow', 'hydroSystemValue', 'hydroTributaryValue', 'hydroSourceValue', 'copyHydroBtn',
    'undoBtn', 'redoBtn', 'togglePanelBtn', 'rightPanel',
    'modeActionBar', 'modeTaskName', 'modeTaskStage', 'modeTaskInstruction',
    'modeMethodSwitch', 'modeLineMethodBtn', 'modeComponentsMethodBtn', 'modePrimaryBtn', 'modeCancelBtn',
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
  const isLineDraftTool = tool => tool === 'line' || tool === 'river' || tool === 'split-drawing';
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
  let lastOverlayTrigger = null;
  let fileMenuTrigger = null;
  let createMenuTrigger = null;
  const surfaceController = createSurfaceController({ getElement: $, getLayout: () => layoutMode, document });
  const surfaceState = surfaceController.state;
  const SHEET_SNAP_RATIOS = Object.freeze([0.35, 0.6, 0.9]);
  const SHEET_SNAP_LABELS = Object.freeze(['기본 높이', '중간 높이', '최대 높이']);
  const MOBILE_SHEET_DEFAULT_SNAP = 1;
  const MOBILE_SHEET_IDS = Object.freeze({ map: 'leftPanel', create: 'createMenu', edit: 'rightPanel' });
  const sheetSnapIndex = new Map(Object.values(MOBILE_SHEET_IDS).map(id => [id, MOBILE_SHEET_DEFAULT_SNAP]));
  const sheetSnapTouched = new Set();
  let activeSheetDrag = null;

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

  function placeProjectionControl() {
    const control = $('projectionControl');
    const host = isMobile() ? $('mobileProjectionSlot') : $('projectionToolbarSlot');
    if (control && host && control.parentElement !== host) host.appendChild(control);
  }


  function syncEditorPanelControls() {
    const edge = $('togglePanelBtn');
    edge?.classList.toggle('active', surfaceState.editorOpen);
    edge?.setAttribute('aria-expanded', String(surfaceState.editorOpen));
    const edgeLabel = surfaceState.editorOpen ? '편집창 닫기' : '편집창 열기';
    edge?.setAttribute('aria-label', edgeLabel);
    edge?.setAttribute('title', edgeLabel);
    const headerToggle = $('mobileCloseRightBtn');
    if (!headerToggle) return;
    const label = layoutMode === 'wide' ? '편집창 접기' : '편집창 닫기';
    headerToggle.setAttribute('aria-label', label);
    headerToggle.setAttribute('title', label);
  }

  function applyLayoutMode({ initial = false } = {}) {
    const previous = layoutMode;
    layoutMode = detectLayoutMode();
    const app = $('app');
    if (app) app.dataset.layout = layoutMode;
    document.body.dataset.layout = layoutMode;
    placeProjectionControl();
    surfaceController.syncLayout(previous);
    surfaceController.render({ fileOpen: document.querySelector('.top-actions')?.classList.contains('mobile-open') });
    refreshMapSheetMetrics();
    syncEditorPanelControls();
    syncMobileNavigation();
    if (!initial && previous !== layoutMode) queueMapResize();
    return previous !== layoutMode;
  }

  function syncOverlayState() {
    const fileOpen = !!document.querySelector('.top-actions')?.classList.contains('mobile-open');
    const view = surfaceController.render({ fileOpen });
    syncEditorPanelControls();
    refreshMapSheetMetrics();
    syncMobileNavigation();
    return view;
  }

  function closeFileMenu({ restoreFocus = false } = {}) {
    const menu = document.querySelector('.top-actions');
    if (!menu?.classList.contains('mobile-open')) return;
    menu.classList.remove('mobile-open');
    syncOverlayState();
    if (restoreFocus && fileMenuTrigger?.isConnected) fileMenuTrigger.focus({ preventScroll: true });
    if (restoreFocus) fileMenuTrigger = null;
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

  function closeActiveMobileSheet({ restoreFocus = false } = {}) {
    if (!isMobile() || !surfaceController.activeMobileSheet) return;
    const kind = surfaceController.activeMobileSheet;
    const surface = { map: 'layers', create: 'create', edit: 'editor' }[kind];
    const panel = mobileSheetPanel(kind);
    surfaceController.close(surface);
    resetMobileSheetSession(panel);
    syncOverlayState();
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
    if (willOpen) requestAnimationFrame(() => menu.querySelector('button:not(:disabled)')?.focus({ preventScroll: true }));
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
      const target = current === SHEET_SNAP_RATIOS.length - 1 ? 1 : current + 1;
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
      const currentHeight = Number.parseFloat(getComputedStyle(panel).height) || setMobileSheetHeight(panel, sheetSnapIndex.get(panel.id) ?? MOBILE_SHEET_DEFAULT_SNAP);
      activeSheetDrag = {
        panel,
        handle,
        pointerId: event.pointerId,
        startY: event.clientY,
        startHeight: currentHeight,
        startIndex: sheetSnapIndex.get(panel.id) ?? MOBILE_SHEET_DEFAULT_SNAP,
        startTime: performance.now(),
        moved: false,
      };
      handle.setPointerCapture?.(event.pointerId);
      document.body.classList.add('map-sheet-dragging');
      event.preventDefault();
    });
    handle.addEventListener('pointermove', event => {
      const drag = activeSheetDrag;
      if (!drag || drag.handle !== handle || drag.pointerId !== event.pointerId) return;
      const deltaY = event.clientY - drag.startY;
      if (Math.abs(deltaY) > 4) drag.moved = true;
      setMobileSheetHeight(panel, drag.startIndex, drag.startHeight - deltaY);
      refreshMapSheetMetrics();
      event.preventDefault();
    });
    const finish = (event, cancelled = false) => {
      const drag = activeSheetDrag;
      if (!drag || drag.handle !== handle || drag.pointerId !== event.pointerId) return;
      const deltaY = event.clientY - drag.startY;
      const currentHeight = Number.parseFloat(getComputedStyle(panel).height) || drag.startHeight;
      const elapsed = Math.max(1, performance.now() - drag.startTime);
      const velocity = deltaY / elapsed;
      activeSheetDrag = null;
      document.body.classList.remove('map-sheet-dragging');
      handle.dataset.dragged = String(drag.moved);
      const dismissDistance = Math.min(180, drag.startHeight * 0.3);
      if (!cancelled && deltaY > 64 && (deltaY >= dismissDistance || velocity > 0.65)) {
        closeActiveMobileSheet({ restoreFocus: true });
      } else {
        const targetIndex = cancelled ? drag.startIndex : nearestSheetSnapIndex(currentHeight);
        if (!cancelled) sheetSnapTouched.add(panel.id);
        setMobileSheetHeight(panel, targetIndex);
        syncOverlayState();
      }
      try { handle.releasePointerCapture?.(event.pointerId); } catch (_) {}
    };
    handle.addEventListener('pointerup', event => finish(event));
    handle.addEventListener('pointercancel', event => finish(event, true));
  }

  function openSelectionEditor() {
    const panel = $('rightPanel');
    if (!panel) return;
    if (layoutMode === 'wide' && !surfaceState.editorManuallyCollapsed) openSurface('editor', { automatic: true });
    if (panel.classList.contains('mobile-open')) $('editorScrollBody')?.scrollTo?.({ top: 0, behavior: 'instant' });
    syncMobileNavigation();
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
    }
    syncOverlayState();
    if (surface === 'create' && layoutMode === 'wide') {
      requestAnimationFrame(() => $('createMenu')?.querySelector('[role="menuitem"]')?.focus({ preventScroll: true }));
    }
  }

  function closeSurface(surface, { manual = false, restoreFocus = false } = {}) {
    const mobileKind = isMobile() ? { layers: 'map', create: 'create', editor: 'edit' }[surface] : null;
    const mobilePanel = mobileKind ? mobileSheetPanel(mobileKind) : null;
    if (!surfaceController.close(surface, { manual, selected: !!state?.selected })) return;
    if (mobilePanel) resetMobileSheetSession(mobilePanel);
    if (surface === 'editor') closeAllColorPickers();
    syncOverlayState();
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
    const adding = state?.tool === 'new-country' || !!terrainToolConfig(state?.tool) || state?.labelPlacementMode || state?.tool === 'label';
    $('mobileCreateBtn')?.classList.toggle('active', !!adding || isCreateMenuOpen());
    $('createMenuBtn')?.classList.toggle('active', !!adding);
    $('addCountryBtn')?.classList.toggle('active', state?.tool === 'new-country');
    $('addLabelBtn')?.classList.toggle('active', !!state?.labelPlacementMode || state?.tool === 'label');
    $('addRiverBtn')?.classList.toggle('active', state?.tool === 'river');
    $('addLakeBtn')?.classList.toggle('active', state?.tool === 'lake');
    $('mobileEditBtn')?.classList.toggle('needs-attention', !!state?.selected && !surfaceState.editorOpen);
  }

  let renderQueued = false;
  let viewRenderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      renderAll();
    });
  }

  function scheduleViewRender() {
    if (viewRenderQueued) return;
    viewRenderQueued = true;
    requestAnimationFrame(() => {
      viewRenderQueued = false;
      renderViewFrame();
    });
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

  const state = {
    countriesData: null,
    countryIndex: new Map(),
    countryOverrides: {},
    sourceInfo: null,
    labels: [],
    drawings: [],
    drawingFolders: [],
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
      drawings: {},
      labels: {},
      countryLabels: {},
    },
    removedLayerItems: {
      countries: {},
      drawings: {},
      labels: {},
      countryLabels: {},
    },
    layerFolders: {
      countries: false,
      terrain: false,
      drawings: false,
      labels: false,
      countryLabels: false,
    },
    layerSearch: '',
    countriesLocked: false,
    tool: 'select',
    labelPlacementMode: false,
    coastEditCountryId: null,
    coastEditScopeDrawingId: null,
    coastEditReturnSelection: null,
    mergeSourceCountryId: null,
    mergeTargetCountryIds: [],
    drawingMergeSourceId: null,
    drawingMergeTargetIds: [],
    drawingSplitSourceId: null,
    annexTargetCountryId: null,
    annexDonorCountryIds: [],
    annexPhase: null,
    annexComponentIndex: null,
    annexCandidates: [],
    annexSelectedCandidateIndex: null,
    annexSelectedComponentKeys: [],
    annexSelectionMethod: 'line',
    newCountryPhase: null,
    newCountrySourceIds: [],
    newCountryCandidates: [],
    newCountrySelectedCandidateIndex: null,
    newCountrySelectedComponentKeys: [],
    newCountrySelectionMethod: 'line',
    boundaryTopology: { edges: new Map(), nodes: new Map() },
    spatialIndex: [],
    mapMoving: false,
    historyDirtyCountryIds: new Set(),
    pendingCountryRenderIds: new Set(),
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
  let mapInputController = null;
  let geometryBoundsCache = new WeakMap();
  let countryOutlineCache = new WeakMap();
  let drawingLandClipCache = new WeakMap();
  let countryLandRevision = 0;
  const pendingCountryLabelAnchors = new Set();
  const countryLabelAnchorVersions = new Map();
  let countryLabelAnchorWorker = null;
  let countryLabelAnchorTimer = 0;
  let countryLabelAnchorRequestId = 0;

  const globeProjection = d3.geo.orthographic().clipAngle(90).precision(isMobile() ? 0.9 : 0.35);
  const flatProjection = d3.geo.equirectangular().precision(isMobile() ? 0.7 : 0.25);
  const path = d3.geo.path().pointRadius(5);
  const graticule = d3.geo.graticule();



  const gpuMapRenderer = createGpuMapRenderer({
    $,
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
    getSystemTheme: () => systemTheme,
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
    renderViewFrame,
    reportOperationError,
    runtimeAssetUrl,
    scheduleGpuMeshRebuild,
    scheduleViewRender,
    setActionStatus,
    state,
  });

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

  async function hydroAtScreenPoint(screenPoint, coord) {
    if (!state.layerVisibility.drawings || state.tool !== 'select') return null;
    const picked = gpuMapRenderer.pickHydro(screenPoint) || await gpuMapRenderer.pickHydroAsync(screenPoint);
    if (picked && isHydroFeatureVisible(picked) && hydroFeatureInView(picked)) return picked;
    const projection = activeProjection();
    const toleranceDegrees = 9 / Math.max(1, projection.scale()) * 180 / Math.PI;
    let nearest = null;
    for (const feature of allHydroFeatures()) {
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
      && ['select', 'country-coast', 'merge-country', 'merge-drawing', 'split-drawing', 'new-country', 'annex-territory', 'river', 'lake'].includes(state.tool);
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

  function setCurrentTool(name) {
    const currentName = name || '선택·편집';
    if ($('currentToolStatus')) $('currentToolStatus').textContent = currentName;
    syncStatusBar();
  }

  function shouldShowCoordinates() {
    if (state.labelPlacementMode || state.tool === 'label' || state.tool === 'point') return true;
    if (state.tool === 'country-coast' || isDrawingDraftTool(state.tool)) return true;
    if (state.tool === 'new-country') return state.newCountryPhase === 'line';
    if (state.tool === 'annex-territory') return state.annexPhase === 'line';
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
    clearTimeout(setActionStatus._timer);
    notice.classList.remove('hidden');
    notice.classList.remove('ready', 'working', 'success', 'error');
    notice.classList.add(tone);
    notice.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    const strong = notice.querySelector('strong');
    if (strong) strong.textContent = message;
    document.body.classList.add('notification-visible');
    if (tone === 'error' || timeout <= 0) return;
    setActionStatus._timer = setTimeout(clearNotification, timeout);
  }

  function isSafeKoreanErrorMessage(error) {
    const message = String(error?.message || '');
    if (!/[가-힣]/.test(message)) return false;
    return !/(Cannot read|undefined|null is not|is not a function|TypeError|ReferenceError|SyntaxError|RangeError|failed\b|\bat\s+\S+\s*\()/i.test(message);
  }

  function reportOperationError(error, fallbackMessage, code, timeout = 4400) {
    console.error(`[${code}]`, error);
    const detail = isSafeKoreanErrorMessage(error) ? String(error.message).trim() : '';
    const hasRecoveryAction = /(선택|확인|입력|이동|조정|해제|새로고침|다시 시도|다시 그리)하세요\.$/.test(detail);
    const message = detail
      ? (hasRecoveryAction ? detail : `${detail} ${fallbackMessage}`)
      : `${fallbackMessage} 다시 시도해도 문제가 계속되면 오류 코드 ${code}를 확인하세요.`;
    setActionStatus(message, 'error', timeout);
  }

  function showFatalError(error) {
    console.error('[AW-RUNTIME-001]', error);
    const message = isSafeKoreanErrorMessage(error)
      ? String(error.message).trim()
      : '내부 오류로 AtlasWright를 시작할 수 없습니다. 오류 코드 AW-RUNTIME-001을 확인하세요.';
    let box = document.getElementById('fatalErrorBox');
    if (!box) {
      box = document.createElement('div');
      box.id = 'fatalErrorBox';
      box.style.cssText = 'position:fixed;z-index:99999;left:10px;right:10px;top:70px;padding:14px;border:1px solid #8a4f4f;border-radius:10px;background:#3b2525;color:#ffd1d1;font:500 13px/1.55 var(--ui-font-family);white-space:pre-wrap;';
      document.body.appendChild(box);
    }
    box.textContent = `AtlasWright를 시작할 수 없습니다.\n${message}\n\n페이지를 새로고침하세요. 문제가 계속되면 오류 코드를 확인하세요.`;
    try { $('engineStatus').textContent = '실행 오류'; } catch (_) {}
  }

  function handleUnexpectedRuntimeError(error) {
    if (!runtimeReady) {
      showFatalError(error);
      return;
    }
    console.error('[AW-RUNTIME-001]', error);
    setActionStatus('작업 중 오류가 발생했습니다. 다시 시도하세요. 문제가 계속되면 오류 코드 AW-RUNTIME-001을 확인하세요.', 'error', 0);
  }

  window.addEventListener('error', event => handleUnexpectedRuntimeError(event.error || event.message));
  window.addEventListener('unhandledrejection', event => handleUnexpectedRuntimeError(event.reason));

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
      if (!wanted.size || wanted.has(String(feature.properties?.editor_id || ''))) {
        geometryBoundsCache.delete(feature.geometry);
        countryOutlineCache.delete(feature.geometry);
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
    invalidateGeometryCaches(ids);
    countryLandRevision += 1;
    drawingLandClipCache = new WeakMap();
    state.boundaryTopology = { edges: new Map(), nodes: new Map() };
    gpuMapRenderer.applyCountryPatch(changed);
    if (!applyingMapEditWorkerResult) mapEditClient.syncPatch(changed);
  }

  let applyingMapEditWorkerResult = false;

  const mapEditClient = (() => {
    let worker = null;
    let sequence = 0;
    let dataRevision = 0;
    let ready = false;
    let activeRequestId = 0;
    const pending = new Map();

    function stopWorker(error = null) {
      if (error) for (const request of pending.values()) request.reject(error);
      pending.clear();
      worker?.terminate();
      worker = null;
      ready = false;
      activeRequestId = 0;
    }

    function ensureWorker() {
      if (worker) return worker;
      worker = new Worker(runtimeAssetUrl('workers/map-edit-worker.js'), { name: 'atlaswright-map-edit' });
      worker.onmessage = event => {
        const message = event.data || {};
        if (message.type === 'ready') {
          ready = true;
          return;
        }
        if (message.type !== 'result') return;
        const request = pending.get(Number(message.requestId));
        if (!request) return;
        pending.delete(Number(message.requestId));
        if (activeRequestId === Number(message.requestId)) activeRequestId = 0;
        if (Number(message.dataRevision) !== dataRevision) {
          request.reject(Object.assign(new Error('지도 상태가 바뀌어 오래된 계산 결과를 폐기했습니다.'), { cancelled: true }));
          return;
        }
        if (message.ok) request.resolve(message.result);
        else if (message.cancelled) request.reject(Object.assign(new Error('작업을 취소했습니다.'), { cancelled: true }));
        else request.reject(new Error(message.message || '지도 편집 계산에 실패했습니다.'));
      };
      worker.onerror = event => {
        const error = new Error(event.message || '지도 편집 Worker를 사용할 수 없습니다.');
        stopWorker(error);
      };
      return worker;
    }

    function rebase(features = state.countriesData?.features || []) {
      if (activeRequestId || pending.size) {
        stopWorker(Object.assign(new Error('지도 상태가 바뀌어 이전 계산을 취소했습니다.'), { cancelled: true }));
      }
      dataRevision += 1;
      ready = false;
      ensureWorker().postMessage({ type: 'rebase', dataRevision, features });
    }

    function syncPatch(rawIds) {
      if (!worker || !ready) return;
      const ids = [...new Set([...rawIds].map(String).filter(Boolean))];
      const features = ids.map(countryFeatureById).filter(Boolean).map(deepClone);
      const removedIds = ids.filter(id => !countryFeatureById(id));
      dataRevision += 1;
      worker.postMessage({ type: 'sync-patch', dataRevision, features, removedIds });
    }

    async function execute(operation, payload) {
      if (!worker || !ready) {
        rebase();
        await new Promise(resolve => {
          const started = performance.now();
          const poll = () => ready || performance.now() - started > 3000 ? resolve() : setTimeout(poll, 16);
          poll();
        });
      }
      if (!ready) throw new Error('지도 편집 Worker를 준비하지 못했습니다. 잠시 후 다시 시도하세요.');
      if (activeRequestId) {
        stopWorker(Object.assign(new Error('새 작업을 시작해 이전 계산을 취소했습니다.'), { cancelled: true }));
        rebase();
        await new Promise(resolve => {
          const started = performance.now();
          const poll = () => ready || performance.now() - started > 3000 ? resolve() : setTimeout(poll, 16);
          poll();
        });
        if (!ready) throw new Error('지도 편집 Worker를 다시 준비하지 못했습니다. 잠시 후 다시 시도하세요.');
      }
      const requestId = ++sequence;
      activeRequestId = requestId;
      const promise = new Promise((resolve, reject) => pending.set(requestId, { resolve, reject }));
      worker.postMessage({ type: 'execute', operation, requestId, dataRevision, ...payload });
      const result = await promise;
      return { requestId, result };
    }

    function commit(requestId) {
      worker?.postMessage({ type: 'commit', requestId });
      dataRevision += 1;
    }

    function discard(requestId) {
      worker?.postMessage({ type: 'discard', requestId });
    }

    function cancel() {
      if (!activeRequestId && !pending.size) return;
      stopWorker(Object.assign(new Error('작업을 취소했습니다.'), { cancelled: true }));
      rebase();
    }

    return { rebase, syncPatch, execute, commit, discard, cancel };
  })();

  function transactCountryEdit({ operation, payload, snapshot, applyResult, onSuccess, onError }) {
    return runCountryEditTransaction({
      client: mapEditClient,
      operation,
      payload,
      snapshot,
      applyResult,
      commitHistory: commitHistorySnapshot,
      restore: (editableSnapshot, { rebaseWorker }) => {
        restoreCountryEditSnapshot(editableSnapshot);
        if (rebaseWorker) mapEditClient.rebase(state.countriesData?.features || []);
      },
      queueAutosave,
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
    const scope = state.coastEditScopeDrawingId
      ? state.drawings.find(item => String(item.id) === String(state.coastEditScopeDrawingId))
      : null;
    const handles = [];
    for (const node of state.boundaryTopology?.nodes?.values?.() || []) {
      const ownRefs = node.refs.filter(ref => String(ref.countryId) === countryId);
      // 육상국경을 보존하기 위해 양쪽 선분이 모두 해안선인 꼭짓점만 편집한다.
      const ref = ownRefs.find(r => r.prevKind === 'coast' && r.nextKind === 'coast');
      if (!ref) continue;
      if (scope && !pointInDrawingFeature(ref.vertex.coord, drawingDisplayFeature(scope))) continue;
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

  function restoreCountryEditSnapshot(snapshot) {
    const changedIds = new Set(state.historyDirtyCountryIds);
    applySharedProjectFields(snapshot, 'history');
    restoreCountriesFromSnapshot(snapshot);
    normalizeProjectDrawings();
    const restoredDirtyIds = new Set(state.historyDirtyCountryIds);
    for (const id of state.historyDirtyCountryIds) changedIds.add(String(id));
    markCountryGeometriesChanged(changedIds);
    state.historyDirtyCountryIds = restoredDirtyIds;
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

  function hardLandDependents(ownerId) {
    return state.drawings.filter(feature => drawingGeometryKind(feature) === 'polygon'
      && drawingLandBinding(feature) === 'hard'
      && String(feature.properties?.aw_owner_id || '') === String(ownerId));
  }

  function syncHardLandDependents(ownerId, ownerBeforeGeometry, ownerAfterGeometry, changedAnchor = null) {
    const clipper = window.polygonClipping;
    if (!clipper?.intersection || !clipper?.difference || !clipper?.union) return [];
    const gained = ownerBeforeGeometry && ownerAfterGeometry
      ? clipper.difference(ownerAfterGeometry.coordinates, ownerBeforeGeometry.coordinates)
      : [];
    const changedIds = [];
    for (const feature of hardLandDependents(ownerId)) {
      const touchedChangedCoast = changedAnchor ? pointInDrawingFeature(changedAnchor, feature) : false;
      let next = clipper.intersection(feature.geometry.coordinates, ownerAfterGeometry.coordinates);
      if (touchedChangedCoast && gained?.length) next = next?.length ? clipper.union(next, gained) : gained;
      const normalized = normalizeClippedLandGeometry(next);
      if (!normalized) continue;
      feature.geometry = normalized;
      feature.properties.aw_coast_sync_revision = Number(feature.properties.aw_coast_sync_revision || 0) + 1;
      drawingLandClipCache.delete(feature);
      changedIds.push(String(feature.id));
    }
    if (changedIds.length) markLayerTreeDirty();
    return changedIds;
  }

  function transferLandDependents(regionGeometry, sourceOwnerIds, targetOwnerId, excludeDrawingIds = []) {
    const clipper = window.polygonClipping;
    if (!regionGeometry || !clipper?.intersection || !clipper?.difference) return [];
    const sources = new Set(sourceOwnerIds.map(String));
    const excludedDrawings = new Set(excludeDrawingIds.map(String));
    const added = [];
    const changedIds = [];
    for (const feature of [...state.drawings]) {
      if (excludedDrawings.has(String(feature.id))) continue;
      if (drawingGeometryKind(feature) !== 'polygon' || drawingLandBinding(feature) !== 'hard') continue;
      if (!sources.has(String(feature.properties?.aw_owner_id || ''))) continue;
      const transferred = normalizeClippedLandGeometry(clipper.intersection(feature.geometry.coordinates, regionGeometry.coordinates));
      if (!transferred) continue;
      const remainder = normalizeClippedLandGeometry(clipper.difference(feature.geometry.coordinates, regionGeometry.coordinates));
      if (remainder) {
        feature.geometry = remainder;
        const moved = normalizeDrawingSemantics({
          type: 'Feature', id: uid('land'), geometry: transferred,
          properties: { ...deepClone(feature.properties), name: `${drawingName(feature)} · 이전 영역`, aw_owner_id: String(targetOwnerId) },
        }, { inferOwner: false });
        added.push(moved);
      } else {
        feature.geometry = transferred;
        feature.properties.aw_owner_id = String(targetOwnerId);
        normalizeDrawingSemantics(feature, { inferOwner: false });
      }
      drawingLandClipCache.delete(feature);
      changedIds.push(String(feature.id));
    }
    if (added.length) state.drawings.push(...added);
    if (changedIds.length || added.length) markLayerTreeDirty();
    return [...changedIds, ...added.map(item => String(item.id))];
  }

  function reassignLandDependents(removedOwnerIds, targetOwnerId) {
    const removed = new Set(removedOwnerIds.map(String));
    for (const feature of state.drawings) {
      if (!removed.has(String(feature.properties?.aw_owner_id || ''))) continue;
      feature.properties.aw_owner_id = String(targetOwnerId);
      normalizeDrawingSemantics(feature, { inferOwner: false });
      drawingLandClipCache.delete(feature);
    }
    markLayerTreeDirty();
  }

  function reassignDrawingParents(removedDrawingIds, replacementId = '') {
    const removed = new Set(removedDrawingIds.map(String));
    for (const feature of state.drawings) {
      if (!removed.has(String(feature.properties?.aw_parent_id || ''))) continue;
      feature.properties.aw_parent_id = String(replacementId || '');
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
    if (overlapArea > tolerance || missingArea > tolerance) throw new Error('새 국경선이 영토를 가져올 국가를 정확히 두 영역으로 나누지 못했습니다.');

    return {
      componentIndex,
      cutLine,
      candidates: candidates.map((geometry, index) => ({ geometry, area: areas[index] })),
    };
  }

  function buildAnnexSplitCandidates(donorIds, rawLine) {
    return buildCutSplitCandidates(selectedCountryUnionGeometry(donorIds), rawLine);
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

  function updateProjection() {
    const { width, height } = state.size;
    const safe = currentMapSafeInsets();
    const contentWidth = Math.max(1, width - safe.left - safe.right);
    const contentHeight = Math.max(1, height - safe.top - safe.bottom);
    const scaleContentHeight = isMobile()
      ? Math.max(1, height - safe.top - 96)
      : contentHeight;
    const centerX = safe.left + contentWidth / 2;
    const centerY = safe.top + contentHeight / 2;
    if (state.projection === 'globe') {
      const base = Math.max(60, Math.min(contentWidth, scaleContentHeight) * 0.455);
      globeProjection
        .translate([centerX, centerY])
        .scale(base * state.view.globeZoom)
        .rotate(state.view.globeRotation)
        .clipAngle(90);
      path.projection(globeProjection);
    } else {
      const base = Math.max(30, contentWidth / (2 * Math.PI));
      flatProjection
        .translate([centerX, centerY])
        .scale(base * state.view.flatZoom)
        .center(state.view.flatCenter)
        .rotate([0, 0, 0])
        .clipExtent([[safe.left, safe.top], [width - safe.right, height - safe.bottom]]);
      path.projection(flatProjection);
    }
    updateZoomStatus();
  }

  function updateZoomStatus() {
    const zoom = state.projection === 'globe' ? state.view.globeZoom : state.view.flatZoom;
    $('zoomStatus').textContent = `×${zoom.toFixed(1)}`;
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
    return TERRAIN_TOOL_CONFIG[feature?.properties?.category]?.color || DEFAULT_DRAWING_COLOR;
  }

  function drawingColor(feature) {
    return feature.properties?.editorColor || defaultDrawingColor(feature);
  }

  function drawingCategoryLabel(feature) {
    return DRAWING_CATEGORY_RULES[feature?.properties?.category]?.label || '지형지물';
  }

  function drawingGeometryKind(feature) {
    const type = feature?.geometry?.type || '';
    if (type === 'Polygon' || type === 'MultiPolygon') return 'polygon';
    if (type === 'LineString' || type === 'MultiLineString') return 'line';
    if (type === 'Point' || type === 'MultiPoint') return 'point';
    return 'unknown';
  }

  function drawingCategoryRule(category) {
    return DRAWING_CATEGORY_RULES[category] || DRAWING_CATEGORY_RULES.custom;
  }

  function drawingCategoryCompatible(feature, category) {
    const expected = drawingCategoryRule(category).geometry;
    return expected === 'any' || expected === drawingGeometryKind(feature);
  }

  function drawingRole(feature) {
    return feature?.properties?.aw_role || drawingCategoryRule(feature?.properties?.category).role;
  }

  function drawingLandBinding(feature) {
    return feature?.properties?.aw_land_binding || drawingCategoryRule(feature?.properties?.category).binding;
  }

  function inferDrawingOwnerId(feature) {
    if (drawingGeometryKind(feature) !== 'polygon') return '';
    const clipper = window.polygonClipping;
    const bounds = geometryBounds(feature.geometry);
    if (clipper?.intersection) {
      let bestId = '';
      let bestArea = 0;
      for (const country of spatialFeatures(bounds)) {
        const area = multiPolygonPlanarArea(clipper.intersection(feature.geometry.coordinates, country.geometry.coordinates));
        if (area > bestArea) {
          bestArea = area;
          bestId = String(country.properties?.editor_id || '');
        }
      }
      if (bestId) return bestId;
    }
    const polygon = [...geometryPolygonSets(feature.geometry)]
      .sort((a, b) => Math.abs(ringSignedArea(b[0] || [])) - Math.abs(ringSignedArea(a[0] || [])))[0];
    const point = polygon?.[0] ? ringRepresentativePoint(polygon[0]) : null;
    const containing = point && (state.countriesData?.features || []).find(country => pointInCountryFeature(point, country));
    return String(containing?.properties?.editor_id || '');
  }

  function normalizeDrawingSemantics(feature, { inferOwner = true } = {}) {
    if (!feature) return feature;
    feature.properties ||= {};
    const properties = feature.properties;
    let category = DRAWING_CATEGORY_RULES[properties.category] ? properties.category : 'custom';
    if (!drawingCategoryCompatible(feature, category)) category = 'custom';
    const rule = drawingCategoryRule(category);
    properties.category = category;
    properties.aw_schema_version = DRAWING_SCHEMA_VERSION;
    properties.aw_role = rule.role;
    const allowedBindings = rule.role === 'custom' ? new Set(['none', 'clip', 'hard'])
      : rule.role === 'thematic' ? new Set(['clip', 'none'])
        : rule.role === 'territory' || rule.role === 'administrative' ? new Set(['hard', 'clip'])
          : new Set(['none']);
    const requestedBinding = String(properties.aw_land_binding || rule.binding);
    properties.aw_land_binding = allowedBindings.has(requestedBinding) ? requestedBinding : rule.binding;
    if (rule.role === 'territory' || rule.role === 'administrative') {
      const existingOwner = String(properties.aw_owner_id || '');
      properties.aw_owner_id = countryFeatureById(existingOwner)
        ? existingOwner
        : (inferOwner ? inferDrawingOwnerId(feature) : '');
      if (rule.role === 'administrative') {
        const parentId = String(properties.aw_parent_id || '');
        const parent = state.drawings.find(item => String(item.id) === parentId && String(item.id) !== String(feature.id));
        properties.aw_parent_id = parent && ['territory', 'administrative'].includes(drawingRole(parent))
          && (!properties.aw_owner_id || String(parent.properties?.aw_owner_id || '') === properties.aw_owner_id)
          ? parentId
          : '';
      } else properties.aw_parent_id = '';
      properties.aw_topology_group = properties.aw_owner_id ? `land:${properties.aw_owner_id}` : `land:unassigned`;
    } else {
      if (rule.role !== 'custom') properties.aw_owner_id = '';
      if (rule.role !== 'administrative') properties.aw_parent_id = '';
      properties.aw_topology_group = rule.role === 'thematic' ? 'land-mask:world' : `${rule.role}:${category}`;
    }
    return feature;
  }

  function normalizeDrawingCollection(drawings, options = {}) {
    return (Array.isArray(drawings) ? drawings : []).map(feature => normalizeDrawingSemantics(feature, options));
  }

  function drawingRoleHelp(feature) {
    const role = drawingRole(feature);
    if (role === 'territory') return '소유 국가의 영토 단위입니다. 국가 해안선 변경을 함께 반영하고 국가 영토로 확정하거나 독립 국가로 전환할 수 있습니다.';
    if (role === 'administrative') return '소유 국가 안의 행정 단위입니다. 상위 영역을 지정하고 같은 역할의 영역과 나누거나 합칠 수 있습니다.';
    if (role === 'thematic') return '민족·종교·언어 분포는 국가 소유권과 분리하며 육지 안에서만 표시합니다.';
    if (role === 'hydro') return '강과 호수는 수계 형상으로 관리하며 영토 작업에는 사용하지 않습니다.';
    return '사용자 정의 객체는 육지 결합 방식을 직접 선택할 수 있습니다.';
  }

  function drawingDisplayFeature(feature) {
    if (drawingGeometryKind(feature) !== 'polygon' || drawingLandBinding(feature) === 'none') return feature;
    const cached = drawingLandClipCache.get(feature);
    const ownerId = String(feature.properties?.aw_owner_id || '');
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

  function countryColor(feature) {
    return feature.properties?.editor_color || defaultCountryColor();
  }

  function countryName(feature) {
    return feature.properties?.editor_name || feature.properties?.editor_original_name || feature.properties?.name || '국가';
  }

  const DEFAULT_DRAWING_FOLDER_ID = 'drawings-default';
  const DRAWING_FOLDER_STATE_PREFIX = 'drawing-folder:';
  const LAYER_GROUP_KEYS = ['countries', 'drawings', 'labels', 'countryLabels'];
  const layerGroupNames = { countries: '국가', drawings: '지형지물', labels: '도시·지명', countryLabels: '국가명 라벨' };
  const layerGroupTargetIds = {
    countries: 'countriesLayerChildren',
    drawings: 'drawingsLayerChildren',
    labels: 'labelsLayerChildren',
    countryLabels: 'countryLabelsLayerChildren',
  };
  const layerNameCollator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
  let renderedLayerTreeRevision = -1;
  let renderedLayerSearch = '';
  let layerSearchScrollTop = 0;
  const layerGroupScrollTop = new Map();

  function drawingFolderStateKey(id) {
    return `${DRAWING_FOLDER_STATE_PREFIX}${String(id)}`;
  }

  function normalizeDrawingFolders(value) {
    const folders = [];
    const seen = new Set();
    for (const raw of Array.isArray(value) ? value : []) {
      const id = String(raw?.id || '').trim();
      if (!id || id === DEFAULT_DRAWING_FOLDER_ID || seen.has(id)) continue;
      seen.add(id);
      folders.push({
        id,
        name: String(raw?.name || '가져온 지형지물').trim() || '가져온 지형지물',
        origin: raw?.origin === 'user' ? 'user' : 'geojson',
        autoPrune: raw?.autoPrune !== false,
      });
    }
    return folders;
  }

  function drawingFolderById(id) {
    return state.drawingFolders.find(folder => folder.id === String(id)) || null;
  }

  function drawingFolderId(feature) {
    const id = String(feature?.properties?.aw_folder_id || '');
    return drawingFolderById(id) ? id : DEFAULT_DRAWING_FOLDER_ID;
  }

  function drawingFolderName(id) {
    return id === DEFAULT_DRAWING_FOLDER_ID ? '지형지물' : drawingFolderById(id)?.name || '지형지물';
  }

  function activeLayerFolderKeys() {
    return [
      'countries',
      'terrain',
      'drawings',
      ...state.drawingFolders.map(folder => drawingFolderStateKey(folder.id)),
      'labels',
      'countryLabels',
    ];
  }

  function uniqueDrawingFolderName(value) {
    const base = String(value || '가져온 지형지물').trim() || '가져온 지형지물';
    const used = new Set(state.drawingFolders.map(folder => folder.name.toLocaleLowerCase('ko')));
    if (!used.has(base.toLocaleLowerCase('ko'))) return base;
    let suffix = 2;
    while (used.has(`${base} (${suffix})`.toLocaleLowerCase('ko'))) suffix += 1;
    return `${base} (${suffix})`;
  }

  function createImportedDrawingFolder(fileName) {
    const baseName = String(fileName || '').replace(/\.(?:geo)?json$/i, '').trim();
    return {
      id: uid('drawing_folder'),
      name: uniqueDrawingFolderName(baseName || '가져온 지형지물'),
      origin: 'geojson',
      autoPrune: true,
    };
  }

  function pruneAutoDrawingFolders() {
    const occupied = new Set(state.drawings.map(feature => String(feature.properties?.aw_folder_id || '')));
    const removed = state.drawingFolders.filter(folder => folder.autoPrune && !occupied.has(folder.id));
    if (!removed.length) return false;
    const removedIds = new Set(removed.map(folder => folder.id));
    state.drawingFolders = state.drawingFolders.filter(folder => !removedIds.has(folder.id));
    for (const id of removedIds) {
      const key = drawingFolderStateKey(id);
      delete state.layerFolders[key];
      layerGroupScrollTop.delete(key);
      layerVirtualItems.delete(key);
    }
    return true;
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

  function syncPhysicalControls() {
    if ($('terrainVisible')) $('terrainVisible').checked = state.physicalSettings.terrainVisible;
    if ($('terrainPoliticalRadio')) $('terrainPoliticalRadio').checked = state.physicalSettings.terrainStyle === 'political';
    if ($('terrainPhysicalRadio')) $('terrainPhysicalRadio').checked = state.physicalSettings.terrainStyle === 'physical';
    if ($('terrainStrengthInput')) $('terrainStrengthInput').value = String(Math.round(state.physicalSettings.terrainStrength * 100));
    if ($('terrainStrengthValue')) $('terrainStrengthValue').textContent = `${Math.round(state.physicalSettings.terrainStrength * 100)}%`;
    if ($('terrainStrengthControl')) $('terrainStrengthControl').hidden = state.physicalSettings.terrainStyle !== 'political';
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
      if (systemTheme === 'dark') rgb = rgb.map((value, index) => value * [0.808, 0.8464, 0.8848][index]);
      return gpu ? rgb.map(value => value / 255) : formatHexRgb(rgb);
    }
    const theme = mapTheme();
    return gpu ? theme.oceanGpu : theme.ocean;
  }

  function hydroDisplayColor(_category, gpu = false) {
    return automaticWaterColor(gpu);
  }

  function hydroLayerVisible(layerId) {
    return !!state.layerVisibility.drawings &&
      !isLayerItemRemoved('drawings', `hydro-layer:${layerId}`) &&
      state.physicalSettings.hydroLayers?.[layerId] !== false;
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

  function normalizeRemovedLayerItems(value) {
    const output = {};
    for (const group of LAYER_GROUP_KEYS) {
      const source = value?.[group];
      output[group] = source && typeof source === 'object' && !Array.isArray(source)
        ? Object.fromEntries(Object.entries(source).filter(([, removed]) => removed === true))
        : {};
    }
    return output;
  }

  function normalizeLayerFolderState(value) {
    let expandedFound = false;
    return Object.fromEntries(activeLayerFolderKeys().map(key => {
      const expanded = !expandedFound && !!value?.[key];
      if (expanded) expandedFound = true;
      return [key, expanded];
    }));
  }

  function markLayerTreeDirty() {
    state.layerTreeRevision += 1;
  }

  function isLayerItemRemoved(group, id) {
    return state.removedLayerItems?.[group]?.[String(id)] === true;
  }

  function isLayerItemVisible(group, id) {
    if (isLayerItemRemoved(group, id)) return false;
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
    if (group === 'drawings' && key.startsWith('hydro-layer:')) {
      state.physicalSettings.hydroLayers[key.slice('hydro-layer:'.length)] = !!visible;
      gpuMapRenderer.invalidateHydroVisibility();
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

  function setDrawingFolderVisibility(folderId, visible) {
    const itemIds = state.drawings
      .filter(feature => drawingFolderId(feature) === String(folderId))
      .map(feature => String(feature.id));
    if (!itemIds.length) return;
    state.itemVisibility.drawings ||= {};
    for (const id of itemIds) {
      if (visible) delete state.itemVisibility.drawings[id];
      else state.itemVisibility.drawings[id] = false;
    }
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
          searchText: id,
          meta: group === 'countryLabels' && pendingCountryLabelAnchors.has(id) ? '계산 중' : '',
          selected: state.selected?.type === 'country' && state.selected.id === id,
        };
      }).filter(item => !isLayerItemRemoved(group, item.id));
    }
    if (group === 'drawings') {
      const builtIns = Object.entries(HYDRO_LAYER_META).map(([id, meta]) => ({
          id: `hydro-layer:${id}`,
          name: meta.shortLabel,
          searchText: meta.label,
          title: `${meta.label} 상태 보기`,
          color: hydroDisplayColor(meta.category),
          count: state.hydroManifest?.stats?.layerCounts?.[id] ?? null,
          folderId: DEFAULT_DRAWING_FOLDER_ID,
          folderName: drawingFolderName(DEFAULT_DRAWING_FOLDER_ID),
          selected: false,
        })).filter(item => !isLayerItemRemoved(group, item.id));
      const userItems = state.drawings.map(feature => {
        const folderId = drawingFolderId(feature);
        return {
          id: String(feature.id),
          name: drawingName(feature),
          color: drawingColor(feature),
          meta: `${drawingCategoryLabel(feature)} · 사용자`,
          folderId,
          folderName: drawingFolderName(folderId),
          selected: state.selected?.type === 'drawing' && state.selected.id === String(feature.id),
        };
      }).filter(item => !isLayerItemRemoved(group, item.id));
      return [...builtIns, ...userItems];
    }
    return state.labels.map(label => ({
      id: String(label.id),
      name: label.name || '이름 없는 지명',
      color: '#d6b969',
      meta: label.kind || '지명',
      selected: state.selected?.type === 'label' && state.selected.id === String(label.id),
    })).filter(item => !isLayerItemRemoved(group, item.id));
  }

  function pruneLayerItemVisibility() {
    const valid = {
      countries: new Set((state.countriesData?.features || []).map(feature => String(feature.properties?.editor_id || ''))),
      countryLabels: new Set((state.countriesData?.features || []).map(feature => String(feature.properties?.editor_id || ''))),
      drawings: new Set([...Object.keys(HYDRO_LAYER_META).map(id => `hydro-layer:${id}`), ...state.drawings.map(feature => String(feature.id))]),
      labels: new Set(state.labels.map(label => String(label.id))),
    };
    state.removedLayerItems = normalizeRemovedLayerItems(state.removedLayerItems);
    for (const group of LAYER_GROUP_KEYS) {
      state.itemVisibility[group] ||= {};
      for (const id of Object.keys(state.itemVisibility[group])) if (!valid[group].has(id)) delete state.itemVisibility[group][id];
      for (const id of Object.keys(state.removedLayerItems[group])) if (!valid[group].has(id)) delete state.removedLayerItems[group][id];
    }
  }

  const LAYER_VIRTUAL_ROW_HEIGHT = 48;
  const LAYER_VIRTUAL_OVERSCAN = 5;
  const layerVirtualItems = new Map();

  function isLayerTreeItemSelected(group, id) {
    const key = String(id);
    if (group === 'countries' || group === 'countryLabels') return state.selected?.type === 'country' && state.selected.id === key;
    if (group === 'drawings') return state.selected?.type === 'drawing' && state.selected.id === key;
    if (group === 'labels') return state.selected?.type === 'label' && state.selected.id === key;
    return false;
  }

  function syncLayerSelectionRows() {
    document.querySelectorAll('[data-layer-group][data-item-id]').forEach(row => {
      const selected = isLayerTreeItemSelected(row.dataset.layerGroup, row.dataset.itemId);
      row.classList.toggle('is-selected', selected);
      if (row.matches('.layer-search-result')) row.setAttribute('aria-selected', String(selected));
    });
  }

  function createLayerItemRow(group, item, { searchResult = false } = {}) {
    const row = document.createElement(searchResult ? 'button' : 'div');
    const selected = isLayerTreeItemSelected(group, item.id);
    row.className = `ui-row ${searchResult ? 'ui-selectable-row layer-search-result' : 'layer-child'}${selected ? ' is-selected' : ''}`;
    row.dataset.layerGroup = group;
    row.dataset.itemId = item.id;
    if (searchResult) {
      row.type = 'button';
      row.dataset.layerItemSelect = group;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(selected));
      row.innerHTML = `<span></span><strong></strong>`;
      row.querySelector('span').textContent = item.folderName || layerGroupNames[group] || '지형 음영';
      row.querySelector('strong').textContent = item.name;
      return row;
    }
    const visibility = document.createElement('input');
    visibility.type = 'checkbox';
    visibility.checked = isLayerItemVisible(group, item.id);
    visibility.dataset.layerItemVisibility = group;
    visibility.dataset.itemId = item.id;
    visibility.setAttribute('aria-label', `${item.name} 표시`);
    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'ui-button layer-child-name';
    name.dataset.layerItemSelect = group;
    name.dataset.itemId = item.id;
    name.textContent = item.name;
    name.title = item.title || `${item.name} 선택하고 이동`;
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'ui-button layer-child-delete';
    deleteButton.dataset.layerItemDelete = group;
    deleteButton.dataset.itemId = item.id;
    deleteButton.setAttribute('aria-label', `${item.name} 삭제`);
    deleteButton.title = group === 'countries' && state.countriesLocked ? '국가 레이어 잠금을 해제한 뒤 삭제할 수 있습니다.' : `${item.name} 삭제`;
    deleteButton.disabled = group === 'countries' && state.countriesLocked;
    deleteButton.innerHTML = '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-trash"/></svg>';
    row.append(visibility, name);
    if (item.meta) {
      const detail = document.createElement('span');
      detail.className = 'layer-child-meta';
      detail.textContent = item.meta;
      row.append(detail);
    }
    row.append(deleteButton);
    return row;
  }

  function renderVirtualizedLayerGroup(group, container, items, { scrollTop = container.scrollTop, folderKey = group } = {}) {
    layerVirtualItems.set(folderKey, items);
    const desiredScrollTop = Math.max(0, Number(scrollTop) || 0);
    const viewportHeight = Math.max(144, container.clientHeight || 235);
    const start = Math.max(0, Math.floor(desiredScrollTop / LAYER_VIRTUAL_ROW_HEIGHT) - LAYER_VIRTUAL_OVERSCAN);
    const count = Math.ceil(viewportHeight / LAYER_VIRTUAL_ROW_HEIGHT) + LAYER_VIRTUAL_OVERSCAN * 2;
    const end = Math.min(items.length, start + count);
    const fragment = document.createDocumentFragment();
    const top = document.createElement('div');
    top.className = 'layer-virtual-spacer';
    top.style.height = `${start * LAYER_VIRTUAL_ROW_HEIGHT}px`;
    fragment.appendChild(top);
    for (let index = start; index < end; index += 1) fragment.appendChild(createLayerItemRow(group, items[index]));
    const bottom = document.createElement('div');
    bottom.className = 'layer-virtual-spacer';
    bottom.style.height = `${Math.max(0, items.length - end) * LAYER_VIRTUAL_ROW_HEIGHT}px`;
    fragment.appendChild(bottom);
    container.replaceChildren(fragment);
    container.dataset.virtualized = 'true';
    const restoredScrollTop = Math.min(desiredScrollTop, Math.max(0, container.scrollHeight - container.clientHeight));
    container.scrollTop = restoredScrollTop;
    layerGroupScrollTop.set(folderKey, restoredScrollTop);
  }

  function renderTerrainLayerFolder(search = '') {
    const folder = document.querySelector('.layer-folder[data-layer-group="terrain"]');
    const container = $('terrainLayerChildren');
    if (!folder || !container) return;
    const matchesSearch = !search || '지형 음영 국가색 지형색 강조'.includes(search);
    folder.hidden = !matchesSearch;
    const expanded = matchesSearch && !search && !!state.layerFolders.terrain;
    folder.classList.toggle('is-expanded', expanded);
    folder.querySelectorAll('[data-layer-folder-toggle="terrain"]').forEach(button => {
      button.setAttribute('aria-expanded', String(expanded));
      button.setAttribute('aria-label', `지형 음영 폴더 ${expanded ? '접기' : '펼치기'}`);
    });
    container.hidden = !expanded;
    syncPhysicalControls();
  }

  function createDynamicDrawingFolderElement(folder) {
    const folderKey = drawingFolderStateKey(folder.id);
    const element = document.createElement('div');
    element.className = 'layer-folder';
    element.dataset.layerGroup = 'drawings';
    element.dataset.drawingFolderId = folder.id;
    element.dataset.layerFolderKey = folderKey;

    const row = document.createElement('div');
    row.className = 'ui-row layer-folder-row';
    const toggle = document.createElement('button');
    toggle.className = 'ui-button layer-folder-toggle';
    toggle.type = 'button';
    toggle.dataset.layerFolderToggle = folderKey;
    toggle.innerHTML = '<svg class="ui-icon disclosure-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-chevron-down"/></svg>';
    const visibility = document.createElement('input');
    visibility.type = 'checkbox';
    visibility.dataset.drawingFolderVisibility = folder.id;
    visibility.setAttribute('aria-label', `${folder.name} 폴더 표시`);
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('class', 'ui-icon layer-folder-icon');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = '<use href="#icon-folder"/>';
    const name = document.createElement('button');
    name.className = 'ui-button layer-folder-name';
    name.type = 'button';
    name.dataset.layerFolderToggle = folderKey;
    name.textContent = folder.name;
    row.append(toggle, visibility, icon, name);

    const children = document.createElement('div');
    children.className = 'layer-children';
    children.dataset.layerFolderKey = folderKey;
    children.setAttribute('role', 'group');
    children.setAttribute('aria-label', `${folder.name} 항목`);
    children.hidden = true;
    element.append(row, children);
    return { folder: element, container: children, folderKey, folderId: folder.id, name: folder.name, visibility };
  }

  function renderDynamicDrawingFolderElements() {
    document.querySelectorAll('.layer-folder[data-drawing-folder-id]').forEach(folder => folder.remove());
    const labelsFolder = document.querySelector('.layer-folder[data-layer-group="labels"]');
    if (!labelsFolder?.parentElement) return [];
    return state.drawingFolders.map(folder => {
      const descriptor = createDynamicDrawingFolderElement(folder);
      labelsFolder.parentElement.insertBefore(descriptor.folder, labelsFolder);
      return descriptor;
    });
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
      container.replaceChildren();
      return;
    }
    if (!items.length) {
      container.replaceChildren();
      const empty = document.createElement('div');
      empty.className = 'layer-empty';
      empty.textContent = '항목 없음';
      container.appendChild(empty);
      return;
    }
    if (items.length > 80) renderVirtualizedLayerGroup(group, container, items, { scrollTop: savedScrollTop, folderKey });
    else {
      layerVirtualItems.delete(folderKey);
      container.removeAttribute('data-virtualized');
      const fragment = document.createDocumentFragment();
      for (const item of items) fragment.appendChild(createLayerItemRow(group, item));
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
      for (const group of LAYER_GROUP_KEYS) {
        for (const item of layerTreeItems(group)) {
          const haystack = `${item.name} ${item.searchText || ''} ${item.id} ${item.meta || ''}`.toLocaleLowerCase('ko');
          if (haystack.includes(search)) matches.push({ group, item });
        }
      }
      matches.sort((a, b) => layerNameCollator.compare(a.item.name, b.item.name));
      const fragment = document.createDocumentFragment();
      for (const { group, item } of matches.slice(0, 160)) fragment.appendChild(createLayerItemRow(group, item, { searchResult: true }));
      if (!matches.length) {
        const empty = document.createElement('div');
        empty.className = 'layer-empty';
        empty.textContent = '검색 결과가 없습니다.';
        fragment.appendChild(empty);
      }
      searchResults?.replaceChildren(fragment);
      if (searchResults) {
        const nextSearchScrollTop = searchChanged ? 0 : Math.min(layerSearchScrollTop, Math.max(0, searchResults.scrollHeight - searchResults.clientHeight));
        searchResults.scrollTop = nextSearchScrollTop;
        layerSearchScrollTop = nextSearchScrollTop;
      }
    } else {
      searchResults?.replaceChildren();
      layerSearchScrollTop = 0;
    }
    renderTerrainLayerFolder(search);
    const dynamicDrawingFolders = renderDynamicDrawingFolderElements();
    for (const group of LAYER_GROUP_KEYS) {
      const folder = document.querySelector(`.layer-folder[data-layer-group="${group}"]:not([data-drawing-folder-id])`);
      const container = $(layerGroupTargetIds[group]);
      if (!folder || !container) continue;
      const allItems = layerTreeItems(group).sort((a, b) => layerNameCollator.compare(a.name, b.name) || layerNameCollator.compare(a.id, b.id));
      const items = group === 'drawings'
        ? allItems.filter(item => item.folderId === DEFAULT_DRAWING_FOLDER_ID)
        : allItems;
      renderLayerFolderContents({ group, folderKey: group, name: layerGroupNames[group], folder, container, items, search });
    }
    const drawingItems = layerTreeItems('drawings').sort((a, b) => layerNameCollator.compare(a.name, b.name) || layerNameCollator.compare(a.id, b.id));
    for (const descriptor of dynamicDrawingFolders) {
      const items = drawingItems.filter(item => item.folderId === descriptor.folderId);
      const visibleCount = items.filter(item => isLayerItemVisible('drawings', item.id)).length;
      descriptor.visibility.checked = !!items.length && visibleCount === items.length;
      descriptor.visibility.indeterminate = visibleCount > 0 && visibleCount < items.length;
      renderLayerFolderContents({ group: 'drawings', ...descriptor, items, search });
    }
    renderedLayerTreeRevision = state.layerTreeRevision;
    renderedLayerSearch = search;
  }

  function currentMapZoom() {
    return state.projection === 'globe' ? state.view.globeZoom : state.view.flatZoom;
  }

  function isArtificialPolarClosureEdge(a, b) {
    if (!a || !b) return false;
    const atPole = point => Math.abs(Math.abs(Number(point[1])) - 90) <= 1e-7;
    const atDateLine = point => Math.abs(Math.abs(Number(point[0])) - 180) <= 1e-7;
    return atPole(a) || atPole(b) || (atDateLine(a) && atDateLine(b));
  }

  function countryOutlineFeature(feature) {
    const geometry = feature?.geometry;
    if (geometry && countryOutlineCache.has(geometry)) return countryOutlineCache.get(geometry);
    const polygons = feature?.geometry?.type === 'Polygon'
      ? [feature.geometry.coordinates]
      : feature?.geometry?.type === 'MultiPolygon' ? feature.geometry.coordinates : [];
    const lines = [];
    for (const polygon of polygons) {
      for (const ring of polygon || []) {
        for (let index = 0; index < ring.length - 1; index += 1) {
          const a = ring[index];
          const b = ring[index + 1];
          if (Math.abs(Number(a?.[0]) - Number(b?.[0])) > 180 || isArtificialPolarClosureEdge(a, b)) continue;
          lines.push([a, b]);
        }
      }
    }
    const outline = { type: 'Feature', properties: feature?.properties || {}, geometry: { type: 'MultiLineString', coordinates: lines } };
    if (geometry) countryOutlineCache.set(geometry, outline);
    return outline;
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
    const pending = state.layerVisibility.countries && state.pendingCountryRenderIds?.size
      ? [...state.pendingCountryRenderIds].map(countryFeatureById).filter(Boolean)
      : [];
    const patchPreview = countryLayer.selectAll('path.country-patch-preview')
      .data(pending, feature => feature.properties.editor_id);
    patchPreview.enter().append('path').attr('class', 'country-patch-preview');
    countryLayer.selectAll('path.country-patch-preview')
      .attr('d', feature => path(feature))
      .style('fill', countryColor)
      .style('fill-opacity', mapTheme().fillAlpha)
      .style('stroke', mapTheme().border)
      .style('stroke-opacity', mapTheme().borderAlpha);
    patchPreview.exit().remove();
    const highlighted = state.layerVisibility.countries && state.countriesData
      ? state.countriesData.features.filter(feature => {
          const id = String(feature.properties?.editor_id || '');
          if (!isLayerItemVisible('countries', id)) return false;
          return (state.selected?.type === 'country' && state.selected.id === id) ||
            (state.tool === 'country-coast' && state.coastEditCountryId === id) ||
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
      .classed('selected', feature => state.selected?.type === 'country' && state.selected.id === feature.properties.editor_id)
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
      .classed('selected', feature => state.selected?.type === 'country' && state.selected.id === feature.properties.editor_id)
      .classed('coast-editing', feature => state.tool === 'country-coast' && state.coastEditCountryId === feature.properties.editor_id)
      .classed('annex-editing', feature => state.tool === 'annex-territory' && state.annexTargetCountryId === feature.properties.editor_id)
      .classed('annex-donor', feature => state.tool === 'annex-territory' && state.annexDonorCountryIds.includes(String(feature.properties.editor_id)))
      .classed('merge-target', feature => state.tool === 'merge-country' && state.mergeTargetCountryIds.includes(String(feature.properties.editor_id)))
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
        const anchor = d.properties?.editor_label_anchor;
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

  async function loadTerrainManifest(force = false) {
    if (!force && ['loading', 'ready'].includes(state.physicalLoadState.terrain)) return;
    state.physicalLoadState.terrain = 'loading';
    markLayerTreeDirty();
    renderLayerTree();
    try {
      const url = new URL('terrain/v0.12.6/manifest.json', PHYSICAL_DATA_BASE_URL);
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
      reportOperationError(error, '지형 음영을 불러오지 못했습니다. 국가 지도는 계속 사용할 수 있습니다. 잠시 후 다시 시도하세요.', 'AW-TERRAIN-001', 0);
    }
  }

  async function loadHydroData(force = false) {
    if (!force && ['loading', 'ready'].includes(state.physicalLoadState.hydro)) return;
    state.physicalLoadState.hydro = 'loading';
    markLayerTreeDirty();
    renderLayerTree();
    try {
      const manifestUrl = new URL(`hydro/v${HYDRO_DATA_VERSION}/manifest.json`, PHYSICAL_DATA_BASE_URL);
      manifestUrl.searchParams.set('v', ASSET_REVISION);
      const response = await fetch(manifestUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const manifest = await response.json();
      if (manifest.version !== HYDRO_DATA_VERSION || manifest.schema !== 'atlaswright-water-shards-v5') throw new Error('수계 타일 버전이 맞지 않습니다.');
      state.hydroManifest = manifest;
      state.hydroCollections = {};
      state.hydroFeatureCache = new Map();
      state.hydroFeatureByFid = new Map();
      state.hydroFragmentsByLogicalId = new Map();
      state.physicalLoadState.hydroCache = 'idle';
      state.physicalLoadState.hydroCachePercent = 0;
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
      reportOperationError(error, '수계 목록을 불러오지 못했습니다. 국가 지도는 계속 사용할 수 있습니다. 페이지를 새로고침하거나 잠시 후 다시 시도하세요.', 'AW-WATER-001', 0);
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
    const addFeature = (layerId, width, feature) => {
      const widthBucket = category === 'river' ? Math.round(width * 10) / 10 : 1;
      const key = `${layerId}:${widthBucket}`;
      if (!groups.has(key)) groups.set(key, { key, layerId, width: widthBucket, features: [] });
      groups.get(key).features.push(feature);
    };
    for (const feature of allHydroFeatures()) {
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
    const renderer = gpuMapRenderer.getStats().renderer;
    const nativeHydro = renderer === 'webgl2' || renderer === 'webgl1' || renderer === 'canvas-worker';
    if (nativeHydro) {
      hydroLakeLayer.selectAll('*').remove();
      hydroRiverLayer.selectAll('*').remove();
    } else {
      const lakes = hydroRenderGroups('lake');
      const lakeSelection = hydroLakeLayer.selectAll('path.hydro-lake-group').data(lakes, item => item.key);
      lakeSelection.enter().append('path').attr('class', 'hydro-lake-group');
      lakeSelection.attr('d', item => path(item.collection)).style('fill', hydroDisplayColor('lake')).style('stroke', hydroDisplayColor('lake'));
      lakeSelection.exit().remove();

      const rivers = hydroRenderGroups('river');
      const riverSelection = hydroRiverLayer.selectAll('path.hydro-river-group').data(rivers, item => item.key);
      riverSelection.enter().append('path').attr('class', 'hydro-river-group');
      riverSelection.attr('d', item => path(item.collection)).style('stroke-width', item => `${item.width}px`).style('stroke', hydroDisplayColor('river'));
      riverSelection.exit().remove();
    }

    const selected = state.selected?.type === 'hydro' ? hydroFeatureById(state.selected.id) : null;
    const selection = hydroSelectionLayer.selectAll('path.hydro-selected').data(selected?.geometry && hydroFeatureInView(selected) ? [selected] : [], item => item.properties.aw_id);
    selection.enter().append('path').attr('class', 'hydro-selected');
    selection.attr('d', path).classed('is-lake', item => item.properties.category === 'lake');
    selection.exit().remove();
  }

  function renderDrawings() {
    const data = state.layerVisibility.drawings
      ? state.drawings.filter(feature => isLayerItemVisible('drawings', feature.id)).map(drawingDisplayFeature).filter(feature => feature.geometry)
      : [];
    const selection = drawingLayer.selectAll('path.drawing-shape')
      .data(data, d => String(d.id));

    selection.enter().append('path')
      .attr('class', 'drawing-shape')
      .on('click', function(d) {
        if (mapClickBlocked()) return;
        if (state.tool === 'merge-drawing') {
          d3.event.stopPropagation();
          toggleDrawingMergeTarget(String(d.id));
          return;
        }
        if (state.tool !== 'select' || state.labelPlacementMode) return;
        d3.event.stopPropagation();
        selectDrawing(String(d.id));
      });

    selection
      .attr('d', path)
      .style('fill', d => d.geometry?.type?.includes('Polygon') ? drawingColor(d) : 'none')
      .style('fill-opacity', d => d.geometry?.type?.includes('Polygon') ? 0.34 : 0)
      .style('stroke', drawingColor)
      .classed('selected', d => state.selected?.type === 'drawing' && state.selected.id === String(d.id))
      .classed('drawing-merge-source', d => state.tool === 'merge-drawing' && state.drawingMergeSourceId === String(d.id))
      .classed('drawing-merge-target', d => state.tool === 'merge-drawing' && state.drawingMergeTargetIds.includes(String(d.id)));

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

  function renderCountryLabelPositions() {
    countryLabelLayer.selectAll('text.country-label').attr('transform', feature => {
      const anchor = feature.properties?.editor_label_anchor;
      const point = Array.isArray(anchor) && anchor.length >= 2 && isCoordVisible(anchor) ? activeProjection()(anchor) : null;
      return point ? `translate(${point[0]},${point[1]})` : 'translate(-9999,-9999)';
    });
  }

  function renderUserLabelPositions() {
    labelLayer.selectAll('g.user-label').attr('transform', label => {
      const point = isCoordVisible(label.coordinates) ? activeProjection()(label.coordinates) : null;
      return point ? `translate(${point[0]},${point[1]})` : 'translate(-9999,-9999)';
    });
  }

  function renderHydroSelectionPosition() {
    hydroSelectionLayer.selectAll('path.hydro-selected').attr('d', path);
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

  function setDrawingVertexCoord(feature, vertex, coord) {
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
      setModeBanner('편입할 영역을 확인하세요. 반대쪽 영역을 선택해 변경할 수도 있습니다.', 'annex-mode');
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
    if (state.tool === 'annex-territory' && state.annexPhase === 'components') {
      setModeBanner('편입할 영토 조각을 선택하세요.');
    } else if (state.tool === 'new-country' && state.newCountryPhase === 'components') {
      setModeBanner('새 국가로 만들 영토 조각을 선택하세요.');
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

  function renderMapFrame({ viewOnly = false } = {}) {
    const revision = ++renderRevision;
    updateProjection();
    renderBase();
    renderCountries(revision);
    if (viewOnly) renderHydroSelectionPosition();
    else renderHydro();
    renderBoundaryEditOverlay();
    renderDrawings();
    if (viewOnly) {
      renderCountryLabelPositions();
      renderUserLabelPositions();
    } else {
      renderCountryLabels();
      renderUserLabels();
    }
    renderVertices();
    renderDraft();
    if (!viewOnly) renderLayerTree();
    window.__ATLASWRIGHT_VIEW_REVISION__ = revision;
  }

  function renderAll() {
    renderMapFrame();
  }

  function renderViewFrame() {
    renderMapFrame({ viewOnly: true });
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
    mapInteractionLayer = root.append('rect').attr('class', 'map-hit-area').attr('x', 0).attr('y', 0);
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

    const beginMapMovement = () => {
      state.mapMoving = true;
      mapWorkScheduler.setInteractionActive(true);
      gpuMapRenderer.setInteractionActive(true);
      mapEl.classList.add('dragging');
      if (state.draftHover) {
        state.draftHover = null;
        renderDraft();
      }
    };
    const finishMapMovement = point => {
      state.mapMoving = false;
      mapWorkScheduler.setInteractionActive(false);
      gpuMapRenderer.setInteractionActive(false);
      mapEl.classList.remove('dragging');
      if (point) suppressNextMapClick(point);
      renderAll();
      gpuMapRenderer.prioritizeLatest();
      queueViewAutosave();
    };

    mapInputController = createMapInputController({
      element: svg.node(),
      interactiveTarget: target => !!target?.closest?.('.vertex-handle, .user-label'),
      canNavigate: mapNavigationEnabled,
      getRevision: () => editInteractionRevision,
      beginMovement: beginMapMovement,
      finishMovement: finishMapMovement,
      panBy: panMapBy,
      scheduleViewRender,
      getZoom: () => state.projection === 'globe' ? state.view.globeZoom : state.view.flatZoom,
      setZoom: value => {
        if (state.projection === 'globe') state.view.globeZoom = clamp(value, ZOOM_LIMITS.globe.min, ZOOM_LIMITS.globe.max);
        else state.view.flatZoom = clamp(value, ZOOM_LIMITS.flat.min, ZOOM_LIMITS.flat.max);
      },
      zoomBy: factor => {
        zoomBy(factor, false);
        if (navigator.vibrate && isMobile()) navigator.vibrate(8);
      },
      canDirectTap: () => {
        const annexLine = state.tool === 'annex-territory' && state.annexPhase === 'line';
        const newCountryLine = state.tool === 'new-country' && state.newCountryPhase === 'line';
        return state.labelPlacementMode || isDrawingDraftTool(state.tool) || state.tool === 'point' || newCountryLine || annexLine;
      },
      directTap: handleMapClick,
      canDoubleTap: () => isMobile() && ['select', 'country-coast', 'merge-country'].includes(state.tool) && !state.labelPlacementMode,
      suppressClick: suppressNextMapClick,
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
      if (mapInputController?.isPanning()) {
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
  }

  function setModeBanner(text = '') {
    const instruction = $('modeTaskInstruction');
    if (!instruction) return;
    if (instruction.textContent !== text) instruction.textContent = text;
    instruction.classList.toggle('hidden', !text);
    syncStatusBar();
  }

  function activeModeTaskDescriptor() {
    return describeTool(state.tool, state, { labelPlacement: state.labelPlacementMode });
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
    const methodSwitchAvailable = annexLineMode || annexSideMode || annexComponentsMode
      || newCountryLineMode || newCountrySideMode || newCountryComponentsMode;
    const activeMethod = state.tool === 'annex-territory'
      ? state.annexSelectionMethod
      : state.newCountrySelectionMethod;
    const labelMode = state.labelPlacementMode || state.tool === 'label';
    const terrainMode = !!terrainToolConfig(state.tool);
    const specialMode = labelMode || terrainMode || isSpecialTool(state.tool);
    const task = activeModeTaskDescriptor();
    const bar = $('modeActionBar');
    const methodSwitch = $('modeMethodSwitch');
    const lineMethod = $('modeLineMethodBtn');
    const componentsMethod = $('modeComponentsMethodBtn');
    const primary = $('modePrimaryBtn');
    const cancel = $('modeCancelBtn');
    if ($('modeTaskName')) $('modeTaskName').textContent = task.name;
    if ($('modeTaskStage')) $('modeTaskStage').textContent = task.stage;
    if (bar) {
      bar.classList.toggle('hidden', !specialMode);
      bar.classList.toggle('single-action', labelMode);
      bar.classList.toggle('has-method-switch', methodSwitchAvailable);
    }
    methodSwitch?.classList.toggle('hidden', !methodSwitchAvailable);
    for (const [button, method] of [[lineMethod, 'line'], [componentsMethod, 'components']]) {
      if (!button) continue;
      const active = activeMethod === method;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    if (primary) {
      primary.classList.toggle('hidden', labelMode);
      primary.disabled = (terrainMode && state.draftCoords.length < (isPolygonDraftTool(state.tool) ? 3 : 2))
        || (newCountrySourceMode && !state.newCountrySourceIds.length)
        || (annexDonorMode && !state.annexDonorCountryIds.length)
        || (mergeTargetMode && !state.mergeTargetCountryIds.length)
        || (drawingMergeMode && !state.drawingMergeTargetIds.length)
        || (drawingSplitMode && state.draftCoords.length < 2)
        || ((annexLineMode || newCountryLineMode) && state.draftCoords.length < 2)
        || (annexSideMode && !state.annexCandidates[state.annexSelectedCandidateIndex]?.geometry)
        || (newCountrySideMode && !state.newCountryCandidates[state.newCountrySelectedCandidateIndex]?.geometry)
        || (annexComponentsMode && !state.annexSelectedComponentKeys.length)
        || (newCountryComponentsMode && !state.newCountrySelectedComponentKeys.length);
      let primaryLabel = '완료';
      if (state.tool === 'country-coast') primaryLabel = '수정 완료';
      else if (terrainMode) primaryLabel = '그리기 완료';
      else if (newCountrySourceMode) primaryLabel = `선택 완료 (${state.newCountrySourceIds.length})`;
      else if (annexDonorMode) primaryLabel = `선택 완료 (${state.annexDonorCountryIds.length})`;
      else if (mergeTargetMode) primaryLabel = `합병 (${state.mergeTargetCountryIds.length})`;
      else if (drawingMergeMode) primaryLabel = `영역 합치기 (${state.drawingMergeTargetIds.length})`;
      else if (drawingSplitMode) primaryLabel = '영역 나누기';
      else if (newCountryLineMode || annexLineMode) primaryLabel = '나누기';
      else if (newCountryComponentsMode) primaryLabel = `국가 만들기 (${state.newCountrySelectedComponentKeys.length})`;
      else if (newCountrySideMode) primaryLabel = '국가 만들기';
      else if (annexComponentsMode) primaryLabel = `편입 (${state.annexSelectedComponentKeys.length})`;
      else if (annexSideMode) primaryLabel = '편입';
      const primaryLabelNode = primary.querySelector('.mode-button-label');
      if (primaryLabelNode) primaryLabelNode.textContent = primaryLabel;
      else primary.textContent = primaryLabel;
      primary.setAttribute('aria-label', primaryLabel);
    }
    if (cancel) {
      const cancelLabelNode = cancel.querySelector('.mode-button-label');
      if (cancelLabelNode) cancelLabelNode.textContent = '취소';
      else cancel.textContent = '취소';
      cancel.setAttribute('aria-label', '작업 취소');
    }
    syncMapCursorMode();
    syncCountryActionButtons();
    syncStatusBar();
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
  }

  function resetMergeState() {
    state.mergeSourceCountryId = null;
    state.mergeTargetCountryIds = [];
  }

  function resetDrawingMergeState() {
    state.drawingMergeSourceId = null;
    state.drawingMergeTargetIds = [];
  }

  function resetNewCountryState() {
    state.newCountryPhase = null;
    state.newCountrySourceIds = [];
    state.newCountryCandidates = [];
    state.newCountrySelectedCandidateIndex = null;
    state.newCountrySelectedComponentKeys = [];
    state.newCountrySelectionMethod = 'line';
  }

  function switchTerritorySelectionMethod(method) {
    const useComponents = method === 'components';
    if (state.tool === 'annex-territory' && ['line', 'side', 'components'].includes(state.annexPhase)) {
      if (!state.annexDonorCountryIds.length) return;
      clearDraftInput(true);
      state.annexComponentIndex = null;
      state.annexCandidates = [];
      state.annexSelectedCandidateIndex = null;
      state.annexSelectedComponentKeys = [];
      state.annexSelectionMethod = useComponents ? 'components' : 'line';
      state.annexPhase = useComponents ? 'components' : 'line';
      if (useComponents) updateTerritoryComponentSelectionFeedback();
      else {
        setModeBanner('선택한 영토를 가로지르는 새 경계를 그리세요.');
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
        setModeBanner('선택한 영토를 가로지르는 새 경계를 그리세요. 시작점과 끝점은 영토 밖에 둘 수 있습니다.');
      }
    } else {
      return;
    }
    updateModeButtons();
    renderAll();
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
    if (tool !== 'country-coast') {
      state.coastEditCountryId = null;
      state.coastEditScopeDrawingId = null;
      state.coastEditReturnSelection = null;
    }
    if (tool !== 'merge-country') resetMergeState();
    if (tool !== 'merge-drawing') resetDrawingMergeState();
    if (tool !== 'split-drawing') state.drawingSplitSourceId = null;
    if (tool !== 'annex-territory') resetAnnexState();
    if (tool !== 'new-country') resetNewCountryState();
    state.tool = tool;
    setCurrentTool(toolLabel(tool));
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
    if (!config) return false;
    clearNotification();
    clearSelection(false);
    resetTerritoryEditingState(true);
    state.coastEditCountryId = null;
    resetMergeState();
    setTool(tool, false);
    setModeBanner(config.geometry === 'LineString'
      ? '강의 흐름을 따라 점을 연결하세요. 완료하면 하나의 선으로 저장합니다.'
      : '호수의 경계를 따라 점을 연결하세요. 완료하면 영역을 자동으로 닫습니다.');
    updateModeButtons();
    return true;
  }

  function enterNewCountryMode() {
    clearNotification();
    if (state.countriesLocked) {
      setActionStatus('국가를 편집할 수 없습니다. 국가 레이어 잠금을 해제하세요.', 'error', 3200);
      return false;
    }
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
    try {
      selectedCountryUnionGeometry(state.newCountrySourceIds);
    } catch (error) {
      reportOperationError(error, '선택한 국가의 영토를 합칠 수 없습니다. 서로 연결된 국가를 다시 선택하세요.', 'AW-COUNTRY-004', 3600);
      return;
    }
    state.newCountryPhase = 'line';
    state.newCountrySelectionMethod = 'line';
    state.newCountryCandidates = [];
    state.newCountrySelectedCandidateIndex = null;
    state.newCountrySelectedComponentKeys = [];
    state.draftCoords = [];
    state.draftHover = null;
    setModeBanner('선택한 영토를 가로지르는 새 경계를 그리세요. 시작점과 끝점은 영토 밖에 둘 수 있습니다.');
    updateModeButtons();
    renderAll();
  }

  function enterAnnexTerritoryMode(id) {
    clearNotification();
    const feature = countryFeatureById(id);
    if (!feature) return false;
    if (state.countriesLocked) {
      setActionStatus('국가를 편집할 수 없습니다. 국가 레이어 잠금을 해제하세요.', 'error', 3200);
      return false;
    }
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
    setTool('annex-territory', false);
    state.annexTargetCountryId = String(id);
    syncCountryActionButtons();
    renderCountries();
    setModeBanner(`${countryName(feature)}로 영토를 이전할 국가를 선택하세요.`);
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
    setModeBanner(`${countryName(countryFeatureById(targetId))}로 영토를 이전할 국가를 선택하세요.`);
    updateModeButtons();
  }

  function beginAnnexSelection() {
    if (state.tool !== 'annex-territory' || state.annexPhase !== 'donor') return;
    try {
      selectedCountryUnionGeometry(state.annexDonorCountryIds);
    } catch (error) {
      reportOperationError(error, '선택한 국가의 영토를 준비할 수 없습니다. 대상을 다시 선택하세요.', 'AW-ANNEX-004', 3600);
      return;
    }
    state.annexPhase = 'line';
    state.annexComponentIndex = null;
    state.annexCandidates = [];
    state.annexSelectedCandidateIndex = null;
    state.annexSelectedComponentKeys = [];
    state.annexSelectionMethod = 'line';
    state.draftCoords = [];
    state.draftHover = null;
    setModeBanner('선택한 영토를 가로지르는 새 경계를 그리세요.');
    updateModeButtons();
    renderAll();
  }

  function enterCountryCoastEdit(id, { scopeDrawingId = null, returnSelection = null } = {}) {
    clearNotification();
    const feature = countryFeatureById(id);
    if (!feature) return false;
    if (state.countriesLocked) {
      setActionStatus('국가를 편집할 수 없습니다. 국가 레이어 잠금을 해제하세요.', 'error', 3200);
      return false;
    }
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
      ? `${countryName(feature)}의 선택 영역과 맞닿은 해안선 꼭짓점을 드래그하세요. 국가 해안선과 연결된 영역이 함께 변경됩니다.`
      : `${countryName(feature)}의 해안선 꼭짓점을 드래그하세요. 연결된 영토·행정구역은 함께 변경되며 육상 국경은 유지됩니다.`, 'coast-mode');
    return true;
  }

  function finishCountryCoastEdit() {
    const id = state.coastEditCountryId;
    if (!id) return;
    const feature = countryFeatureById(id);
    const returnSelection = state.coastEditReturnSelection ? deepClone(state.coastEditReturnSelection) : null;
    setTool('select', false);
    state.boundaryTopology = { edges: new Map(), nodes: new Map() };
    state.coastEditScopeDrawingId = null;
    state.coastEditReturnSelection = null;
    if (returnSelection?.type === 'drawing' && state.drawings.some(item => String(item.id) === String(returnSelection.id))) selectDrawing(String(returnSelection.id), true);
    else if (feature) selectCountry(id, true);
    queueAutosave();
    setActionStatus(`${feature ? countryName(feature) : '국가'}의 해안선을 수정했습니다.`, 'success');
  }

  function enterMergeCountryMode(id) {
    clearNotification();
    const feature = countryFeatureById(id);
    if (!feature) return false;
    if (state.countriesLocked) {
      setActionStatus('국가를 편집할 수 없습니다. 국가 레이어 잠금을 해제하세요.', 'error', 3200);
      return false;
    }
    state.mergeSourceCountryId = String(id);
    state.mergeTargetCountryIds = [];
    setTool('merge-country', false);
    state.mergeSourceCountryId = String(id);
    state.mergeTargetCountryIds = [];
    setModeBanner(`${countryName(feature)}에 합병할 국가를 선택하세요.`);
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
    setModeBanner(`${countryName(countryFeatureById(sourceId))}에 합병할 국가를 선택하세요.`);
    updateModeButtons();
  }

  function cancelActiveMode() {
    const cancelledTool = state.tool;
    mapEditClient.cancel();
    const selectedDrawingId = state.drawingSplitSourceId || state.drawingMergeSourceId
      || (state.coastEditReturnSelection?.type === 'drawing' ? state.coastEditReturnSelection.id : null);
    const selectedId = state.annexTargetCountryId
      || state.coastEditCountryId
      || state.mergeSourceCountryId
      || (state.selected?.type === 'country' ? state.selected.id : null);
    resetTerritoryEditingState(true);
    state.coastEditCountryId = null;
    state.coastEditScopeDrawingId = null;
    state.coastEditReturnSelection = null;
    resetMergeState();
    resetDrawingMergeState();
    state.drawingSplitSourceId = null;
    setTool('select', false);
    if (selectedDrawingId && state.drawings.some(item => String(item.id) === String(selectedDrawingId))) selectDrawing(String(selectedDrawingId), true);
    else if (selectedId && countryFeatureById(selectedId)) selectCountry(selectedId, true);
    renderDraft();
    const labels = { 'new-country': '국가 추가', 'annex-territory': '영토 편입', 'merge-country': '국가 합병', 'merge-drawing': '영역 합치기', 'split-drawing': '영역 나누기', 'country-coast': '해안선 수정' };
    setActionStatus(`${labels[cancelledTool] || '지도 작업'}을 취소했습니다.`, 'success');
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
    setModeBanner('지도에서 지명을 배치할 위치를 선택하세요. Esc 키로 취소할 수 있습니다.');
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

  async function handleMapClick(screenPoint) {
    const coord = screenToGeo(screenPoint);
    if (!coord) return;
    if (state.labelPlacementMode) {
      addLabelAt(coord);
      return;
    }
    if (state.tool === 'select' && !state.labelPlacementMode) {
      const clickedHydro = await hydroAtScreenPoint(screenPoint, coord);
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
        setActionStatus('영토를 가져올 국가를 먼저 지도에서 선택하세요.', 'error', 3200);
        return;
      }
      if (state.annexPhase !== 'line') return;
      if (!state.annexDonorCountryIds.length) {
        setActionStatus('선택한 국가를 찾을 수 없습니다. 영토를 가져올 국가를 다시 선택하세요.', 'error', 3400);
        return;
      }
      const nextCoord = coord.slice();
      if (!state.draftCoords.length || !coordNear(state.draftCoords[state.draftCoords.length - 1], nextCoord, 1e-9)) {
        state.draftCoords.push(nextCoord);
      }
      state.draftHover = null;
      renderDraft();
      setModeBanner('선택한 영토를 가로지르는 새 경계를 그리세요.');
      updateModeButtons();
      return;
    }
    const newCountryLineMode = state.tool === 'new-country' && state.newCountryPhase === 'line';
    if (isDrawingDraftTool(state.tool) || newCountryLineMode) {
      state.draftCoords.push(coord);
      state.draftHover = null;
      renderDraft();
      const polygonMode = isPolygonDraftTool(state.tool);
      const terrain = terrainToolConfig(state.tool);
      if (terrain) {
        setModeBanner(`${terrain.label}의 ${polygonMode ? '경계를' : '흐름을'} 따라 점을 연결하세요.`);
      } else if (newCountryLineMode) {
        setModeBanner('선택한 영토를 가로지르는 새 경계를 그리세요. 시작점과 끝점은 영토 밖에 둘 수 있습니다.');
      } else if (state.tool === 'split-drawing') {
        const source = state.drawings.find(item => String(item.id) === String(state.drawingSplitSourceId));
        setModeBanner(`${source ? drawingName(source) : '선택한 영역'}을 가로지르는 새 경계를 그리세요.`);
      } else {
        setModeBanner(polygonMode ? '영역의 경계를 따라 점을 연결하세요.' : '선을 따라 점을 연결하세요.');
      }
      updateModeButtons();
      return;
    }
    if (state.tool === 'point') {
      recordHistory();
      const feature = {
        type: 'Feature', id: uid('point'),
        geometry: { type: 'Point', coordinates: coord },
        properties: { name: '', editorColor: DEFAULT_DRAWING_COLOR, category: 'custom', notes: '', aw_role: 'custom', aw_land_binding: 'none', aw_schema_version: DRAWING_SCHEMA_VERSION },
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
      recordHistory();
      const baseName = drawingName(source);
      source.geometry = retainedGeometry;
      source.properties.name = `${baseName} 1`;
      const sibling = normalizeDrawingSemantics({
        type: 'Feature',
        id: uid('area'),
        geometry: deepClone(split.candidates[1].geometry),
        properties: { ...deepClone(source.properties), name: `${baseName} 2` },
      }, { inferOwner: false });
      state.drawings.push(sibling);
      state.draftCoords = [];
      state.draftHover = null;
      setTool('select', false);
      selectDrawing(String(source.id), true);
      renderAll();
      queueAutosave();
      setActionStatus(`${baseName} 영역을 두 영역으로 나눴습니다.`, 'success', 3200);
    } catch (error) {
      reportOperationError(error, '영역을 나누지 못했습니다. 영역을 한 번만 관통하도록 경계를 다시 그리세요.', 'AW-LAND-003', 4200);
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
      const split = buildAnnexSplitCandidates(state.annexDonorCountryIds, state.draftCoords);
      state.annexComponentIndex = split.componentIndex;
      state.draftCoords = split.cutLine.map(coord => coord.slice());
      state.draftHover = null;
      state.annexCandidates = split.candidates;
      state.annexSelectedCandidateIndex = split.candidates[0].area <= split.candidates[1].area ? 0 : 1;
      state.annexPhase = 'side';
      setModeBanner('작은 영역을 자동으로 선택했습니다. 편입할 영역을 확인하거나 반대쪽 영역을 선택하세요.', 'annex-mode');
      updateModeButtons();
      renderAll();
    } catch (error) {
      reportOperationError(error, '새 경계를 사용할 수 없습니다. 영토를 가져올 국가를 한 번만 관통하도록 선을 다시 그리세요.', 'AW-ANNEX-003');
    }
  }

  function prepareNewCountryDraftCandidates() {
    if (state.newCountryPhase !== 'line') {
      setActionStatus('새 국가를 만들 수 없습니다. 영토를 가져올 국가 선택을 먼저 완료하세요.', 'error', 3600);
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
      reportOperationError(error, '신생국 국경선을 사용할 수 없습니다. 선택 영토를 한 번만 관통하도록 선을 다시 그리세요.', 'AW-COUNTRY-003');
    }
  }

  function finishDrawingFeatureDraft(polygonMode) {
    recordHistory();
    const terrain = terrainToolConfig(state.tool);
    const id = uid(terrain?.prefix || (polygonMode ? 'poly' : 'line'));
    const geometry = polygonMode
      ? { type: 'Polygon', coordinates: [orientRing(state.draftCoords, true)] }
      : { type: 'LineString', coordinates: state.draftCoords.map(coord => coord.slice()) };
    const feature = {
      type: 'Feature', id, geometry,
      properties: {
        name: '',
        editorColor: terrain?.color || DEFAULT_DRAWING_COLOR,
        category: terrain?.category || 'custom',
        notes: '',
      },
    };
    normalizeDrawingSemantics(feature);
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
    dispatchTool(state.tool, {
      'split-drawing': finishSplitDrawingDraft,
      'annex-territory': prepareAnnexDraftCandidates,
      'new-country': prepareNewCountryDraftCandidates,
    }, () => finishDrawingFeatureDraft(polygonMode));
  }

  async function completeLinearAnnexation(candidateIndex) {
    if (state.tool !== 'annex-territory' || !['side', 'components'].includes(state.annexPhase)) return;
    const targetId = String(state.annexTargetCountryId || '');
    const donorIds = state.annexDonorCountryIds.map(String);
    let candidate;
    if (state.annexPhase === 'components') {
      try { candidate = { geometry: selectedTerritoryComponentGeometry() }; }
      catch (error) {
        reportOperationError(error, '선택한 영토 조각을 확인하지 못했습니다. 영역을 다시 선택하세요.', 'AW-ANNEX-001', 3800);
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
    setActionStatus('선택한 영토를 편입하는 중입니다. 지도는 계속 조작할 수 있습니다.', 'working', 0);
    await transactCountryEdit({
      operation: 'annex',
      payload: { targetId, donorIds, transferredGeometry: candidate.geometry },
      snapshot,
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
        setActionStatus(`선택한 ${plan.affectedDonorIds.length}개국의 영토를 ${targetName}에 편입했습니다${removedText}.`, 'success', 4000);
      },
      onError: error => reportOperationError(error, '영토를 편입하지 못해 변경을 되돌렸습니다. 편입 범위를 조정한 뒤 다시 시도하세요.', 'AW-ANNEX-002'),
    });
  }

  async function completeNewCountryCreation(candidateIndex) {
    if (state.tool !== 'new-country' || !['side', 'components'].includes(state.newCountryPhase)) return;
    let candidate;
    if (state.newCountryPhase === 'components') {
      try { candidate = { geometry: selectedTerritoryComponentGeometry() }; }
      catch (error) {
        reportOperationError(error, '선택한 영토 조각을 확인하지 못했습니다. 영역을 다시 선택하세요.', 'AW-COUNTRY-001', 3800);
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
    setActionStatus('새 국가의 영토를 계산하는 중입니다. 지도는 계속 조작할 수 있습니다.', 'working', 0);
    await transactCountryEdit({
      operation: 'new-country',
      payload: { sourceIds, transferredGeometry: candidate.geometry, newFeature: feature },
      snapshot,
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
        setActionStatus(`${countryName(feature)} 국가를 추가했습니다. 선택한 ${transferPlan.affectedSourceIds.length}개국의 영토만 이전했습니다${removedText}.`, 'success', 4200);
      },
      onError: error => reportOperationError(error, '국가를 추가하지 못해 변경을 되돌렸습니다. 선택 범위를 조정한 뒤 다시 시도하세요.', 'AW-COUNTRY-002'),
    });
  }

  async function completeCountryMerge() {
    const sourceId = String(state.mergeSourceCountryId || '');
    const targetIds = [...new Set(state.mergeTargetCountryIds.map(String))].filter(id => id && id !== sourceId);
    if (!sourceId || !targetIds.length) {
      setActionStatus('합병할 국가를 하나 이상 선택하세요.', 'error', 3200);
      return;
    }
    const source = countryFeatureById(sourceId);
    const targets = targetIds.map(countryFeatureById).filter(Boolean);
    if (!source || targets.length !== targetIds.length) {
      setActionStatus('합병할 국가를 찾을 수 없습니다. 대상을 다시 선택하세요.', 'error');
      return;
    }
    const sourceName = countryName(source);
    const snapshot = snapshotEditable();
    setActionStatus('선택한 국가를 합병하는 중입니다. 지도는 계속 조작할 수 있습니다.', 'working', 0);
    await transactCountryEdit({
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
      onError: error => reportOperationError(error, '국가를 합병하지 못해 변경을 되돌렸습니다. 대상을 다시 확인하세요.', 'AW-MERGE-001'),
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
    if (state.selected?.type !== 'drawing') return;
    const feature = state.drawings.find(item => String(item.id) === String(state.selected.id));
    const ownerId = String(feature?.properties?.aw_owner_id || '');
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
      onError: error => reportOperationError(error, '영역을 국가 영토에 반영하지 못했습니다. 소유 국가와 겹치는 범위를 확인하세요.', 'AW-LAND-001', 4600),
    });
  }

  async function promoteSelectedDrawingToCountry() {
    if (state.selected?.type !== 'drawing') return;
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
      onError: error => reportOperationError(error, '영역을 국가로 전환하지 못했습니다. 다른 국가와의 중첩과 형상을 확인하세요.', 'AW-LAND-002', 4600),
    });
  }

  function alignSelectedDrawingToOwnerLand() {
    if (state.selected?.type !== 'drawing') return;
    const feature = state.drawings.find(item => String(item.id) === String(state.selected.id));
    const owner = countryFeatureById(feature?.properties?.aw_owner_id);
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
    feature.properties.aw_land_binding = 'hard';
    feature.properties.aw_topology_group = `land:${feature.properties.aw_owner_id}`;
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
    setModeBanner(`${drawingName(feature)} 영역을 가로지르는 새 경계를 그리세요.`);
    return true;
  }

  function enterDrawingMergeMode(id) {
    const feature = state.drawings.find(item => String(item.id) === String(id));
    if (!feature || drawingGeometryKind(feature) !== 'polygon') return false;
    state.drawingMergeSourceId = String(id);
    state.drawingMergeTargetIds = [];
    setTool('merge-drawing', false);
    state.drawingMergeSourceId = String(id);
    setModeBanner(`${drawingName(feature)}과 합칠 같은 역할의 영역을 선택하세요.`);
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
    if (['territory', 'administrative'].includes(drawingRole(source)) && String(source.properties?.aw_owner_id || '') !== String(target.properties?.aw_owner_id || '')) {
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
    recordHistory();
    source.geometry = merged;
    const removed = new Set(targets.map(item => String(item.id)));
    reassignDrawingParents([...removed], String(source.id));
    state.drawings = state.drawings.filter(item => !removed.has(String(item.id)));
    normalizeDrawingSemantics(source, { inferOwner: false });
    setTool('select', false);
    selectDrawing(String(source.id), true);
    renderAll();
    queueAutosave();
    setActionStatus(`${targets.length + 1}개 영역을 하나로 합쳤습니다.`, 'success', 3200);
  }

  function cancelDraft(showMessage = true) {
    const terrain = terrainToolConfig(state.tool);
    const splitSourceId = state.tool === 'split-drawing' ? state.drawingSplitSourceId : null;
    clearDraftInput(true);
    setTool('select', false);
    if (splitSourceId && state.drawings.some(item => String(item.id) === String(splitSourceId))) selectDrawing(String(splitSourceId), true);
    renderAll();
    if (showMessage) setActionStatus(splitSourceId ? '영역 나누기를 취소했습니다.' : `${terrain?.label || '지형지물'} 추가를 취소했습니다.`, 'success');
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
    let blockedByCanonicalCoast = false;
    return d3.behavior.drag()
      .on('dragstart', function(vertex) {
        if (!feature || state.tool !== 'select') return;
        const owner = countryFeatureById(feature.properties?.aw_owner_id);
        blockedByCanonicalCoast = drawingLandBinding(feature) === 'hard' && owner
          ? pointOnGeometryBoundary(vertex.coord, owner.geometry, 0.00012)
          : false;
        if (blockedByCanonicalCoast) {
          d3.event.sourceEvent?.stopPropagation?.();
          setActionStatus('국가 해안선과 연결된 점입니다. 편집창의 해안 구간 수정을 사용하세요.', 'error', 3800);
          return;
        }
        recordHistory();
        d3.event.sourceEvent?.stopPropagation?.();
      })
      .on('drag', function(vertex) {
        if (!feature || state.tool !== 'select' || blockedByCanonicalCoast) return;
        const coord = screenToGeo(d3.mouse(svg.node()));
        if (!coord) return;
        setDrawingVertexCoord(feature, vertex, coord);
        drawingLayer.selectAll('path.drawing-shape').attr('d', bound => {
          const source = state.drawings.find(item => String(item.id) === String(bound.id));
          return source ? path(drawingDisplayFeature(source)) : '';
        });
        vertexLayer.selectAll('circle.vertex-handle').attr('transform', d => {
          const f = state.drawings.find(x => String(x.id) === state.selected?.id);
          const verts = getEditableVertices(f);
          const fresh = verts.find(v => v.key === d.key) || d;
          const p = activeProjection()(fresh.coord);
          return p ? `translate(${p[0]},${p[1]})` : 'translate(-9999,-9999)';
        });
      })
      .on('dragend', function() {
        if (!feature || blockedByCanonicalCoast) return;
        const owner = countryFeatureById(feature.properties?.aw_owner_id);
        if (drawingLandBinding(feature) === 'hard' && owner && drawingGeometryKind(feature) === 'polygon') {
          const clipped = normalizeClippedLandGeometry(window.polygonClipping.intersection(feature.geometry.coordinates, owner.geometry.coordinates));
          if (clipped) feature.geometry = clipped;
        }
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
    let ownerBeforeGeometry = null;
    return d3.behavior.drag()
      .on('dragstart', function(vertex) {
        if (!feature || state.tool !== 'country-coast') return;
        dragEnabled = false;
        const node = state.boundaryTopology?.nodes?.get(vertex.nodeKey || coordKey(vertex.coord));
        if (!node) return;
        transactionSnapshot = snapshotEditable();
        startCoord = node.coord.slice();
        ownerBeforeGeometry = deepClone(feature.geometry);
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
          syncHardLandDependents(String(feature.properties?.editor_id || ''), ownerBeforeGeometry, feature.geometry, startCoord);
          markCountryGeometriesChanged(affectedIds);
          refreshCountryCentroids(affectedIds);
          rebuildBoundaryTopology(state.coastEditCountryId);
          const validation = validateCountryGeometryEdit(affectedIds);
          if (!validation.ok) throw new Error(validation.message);
          commitHistorySnapshot(snapshot);
          const editedFeature = countryFeatureById(state.coastEditCountryId);
          renderAll();
          queueAutosave();
          setModeBanner(state.coastEditScopeDrawingId
            ? `${editedFeature ? countryName(editedFeature) : '국가'}의 선택 영역과 맞닿은 해안선 꼭짓점을 드래그하세요. 연결된 영역이 함께 변경됩니다.`
            : `${editedFeature ? countryName(editedFeature) : '국가'}의 해안선 꼭짓점을 드래그하세요. 연결된 영토·행정구역은 함께 변경됩니다.`, 'coast-mode');
          setActionStatus('해안선을 수정했습니다.', 'success');
        } catch (error) {
          restoreCountryEditSnapshot(snapshot);
          reportOperationError(error, '해안선을 이동하지 못해 변경을 되돌렸습니다. 점을 해안선을 따라 다시 이동하세요.', 'AW-COAST-001', 4300);
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

  function showPropertyForm(type, title = '', { resetScroll = true } = {}) {
    $('emptyProperties').classList.toggle('hidden', !!type);
    $('editorObjectHeader').classList.toggle('hidden', !type);
    $('countryProperties').classList.toggle('hidden', type !== 'country');
    $('drawingProperties').classList.toggle('hidden', type !== 'drawing');
    $('labelProperties').classList.toggle('hidden', type !== 'label');
    $('hydroProperties').classList.toggle('hidden', type !== 'hydro');
    $('propertyTitle').textContent = type ? String(title || '') : '';
    if (resetScroll && $('editorScrollBody')) $('editorScrollBody').scrollTop = 0;
    syncStatusBar();
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

  function selectCountry(id, refreshOnly = false, shouldRender = true) {
    const idx = state.countryIndex.get(String(id));
    if (idx === undefined) return;
    const feature = state.countriesData.features[idx];
    const p = feature.properties || {};
    const override = state.countryOverrides[id] || {};
    const displayName = override.name || p.editor_name || p.editor_original_name || id;
    state.selected = { type: 'country', id: String(id) };
    showPropertyForm('country', displayName, { resetScroll: !refreshOnly });
    $('countryNameInput').value = override.name || p.editor_name || p.editor_original_name || '';
    $('countryCodeInput').textContent = id;
    const explicitColor = override.color || p.editor_color || '';
    $('countryColorInput').value = explicitColor || defaultCountryColor();
    syncColorPicker('country', { value: explicitColor || defaultCountryColor(), defaultColor: defaultCountryColor(), isDefault: !explicitColor });
    $('capitalInput').value = override.capital || p.capital || '';
    $('notesInput').value = override.notes || p.notes || '';
    $('originalNameValue').textContent = p.editor_original_name || p.editor_name || '—';
    renderFlag(override.flagDataUrl || p.flagDataUrl || null);
    $('selectionStatus').textContent = `국가 · ${displayName}`;
    syncStatusBar();
    syncCountryActionButtons();
    syncLayerSelectionRows();
    if (shouldRender) renderAll();
    if (!refreshOnly) openSelectionEditor();
  }

  function replaceSelectOptions(select, options, selectedValue = '') {
    if (!select) return;
    select.replaceChildren(...options.map(option => {
      const element = document.createElement('option');
      element.value = String(option.value ?? '');
      element.textContent = String(option.label ?? option.value ?? '');
      return element;
    }));
    select.value = String(selectedValue || '');
  }

  function syncDrawingFolderInput(feature) {
    const options = [
      { value: DEFAULT_DRAWING_FOLDER_ID, label: '지형지물' },
      ...state.drawingFolders.map(folder => ({ value: folder.id, label: folder.name })),
    ];
    replaceSelectOptions($('drawingFolderInput'), options, drawingFolderId(feature));
  }

  function syncDrawingSemanticEditor(feature) {
    const properties = feature.properties || {};
    const role = drawingRole(feature);
    const geometryKind = drawingGeometryKind(feature);
    const polygon = geometryKind === 'polygon';
    const landRole = polygon && ['territory', 'administrative', 'thematic', 'custom'].includes(role);
    const ownedLand = polygon && ['territory', 'administrative'].includes(role);
    const geometricLand = polygon && !['hydro'].includes(role);
    const countryLand = polygon && ['territory', 'administrative', 'custom'].includes(role);
    $('drawingLandRelationSection').classList.toggle('hidden', !landRole);
    $('drawingLandActionsSection').classList.toggle('hidden', !geometricLand);
    $('drawingOwnerField').classList.toggle('hidden', !ownedLand && role !== 'custom');
    $('drawingParentField').classList.toggle('hidden', role !== 'administrative');
    $('drawingLandBindingField').classList.toggle('hidden', role === 'territory' || role === 'administrative');
    $('splitDrawingBtn').classList.toggle('hidden', !geometricLand);
    $('mergeDrawingBtn').classList.toggle('hidden', !geometricLand);
    for (const id of ['syncDrawingCoastBtn', 'editDrawingCoastBtn', 'applyDrawingToCountryBtn', 'promoteDrawingToCountryBtn']) {
      $(id).classList.toggle('hidden', !countryLand);
    }
    const countryOptions = [{ value: '', label: '소유 국가 없음' }, ...(state.countriesData?.features || [])
      .map(country => ({ value: String(country.properties?.editor_id || ''), label: countryName(country) }))
      .sort((a, b) => layerNameCollator.compare(a.label, b.label))];
    replaceSelectOptions($('drawingOwnerInput'), countryOptions, properties.aw_owner_id);
    for (const option of $('drawingCategoryInput').options) {
      const expected = drawingCategoryRule(option.value).geometry;
      option.disabled = expected !== 'any' && expected !== geometryKind;
    }
    const ownerId = String(properties.aw_owner_id || '');
    const parentOptions = [{ value: '', label: '상위 영역 없음' }, ...state.drawings
      .filter(candidate => String(candidate.id) !== String(feature.id)
        && drawingGeometryKind(candidate) === 'polygon'
        && ['territory', 'administrative'].includes(drawingRole(candidate))
        && (!ownerId || String(candidate.properties?.aw_owner_id || '') === ownerId))
      .map(candidate => ({ value: String(candidate.id), label: drawingName(candidate) }))
      .sort((a, b) => layerNameCollator.compare(a.label, b.label))];
    replaceSelectOptions($('drawingParentInput'), parentOptions, properties.aw_parent_id);
    $('drawingLandBindingInput').value = drawingLandBinding(feature);
    $('drawingRoleHelp').textContent = drawingRoleHelp(feature);
    $('drawingRoleValue').textContent = DRAWING_ROLE_LABELS[role] || role;
    $('drawingTopologyValue').textContent = properties.aw_topology_group || '—';
    const hasOwner = !!countryFeatureById(properties.aw_owner_id);
    for (const id of ['syncDrawingCoastBtn', 'editDrawingCoastBtn', 'applyDrawingToCountryBtn']) $(id).disabled = !hasOwner;
    $('promoteDrawingToCountryBtn').disabled = !countryLand;
  }

  function selectDrawing(id, refreshOnly = false) {
    const feature = state.drawings.find(f => String(f.id) === String(id));
    if (!feature) return;
    normalizeDrawingSemantics(feature);
    const meta = feature.properties || (feature.properties = {});
    const typeLabel = drawingCategoryLabel(feature);
    const displayName = drawingName(feature);
    state.selected = { type: 'drawing', id: String(id) };
    showPropertyForm('drawing', displayName, { resetScroll: !refreshOnly });
    $('drawingNameInput').value = meta.name || '';
    $('drawingIdInput').textContent = String(id);
    syncDrawingFolderInput(feature);
    const defaultColor = defaultDrawingColor(feature);
    $('drawingColorInput').value = meta.editorColor || defaultColor;
    syncColorPicker('drawing', { value: meta.editorColor || defaultColor, defaultColor, isDefault: !meta.editorColor });
    $('drawingCategoryInput').value = meta.category || 'custom';
    $('drawingNotesInput').value = meta.notes || '';
    $('deleteDrawingInlineBtn').textContent = `${typeLabel} 삭제`;
    syncDrawingSemanticEditor(feature);
    $('selectionStatus').textContent = `${typeLabel} · ${meta.name || String(id).slice(0, 8)}`;
    syncStatusBar();
    syncLayerSelectionRows();
    renderAll();
    if (!refreshOnly) openSelectionEditor();
  }

  function selectLabel(id, refreshOnly = false) {
    const label = state.labels.find(item => item.id === id);
    if (!label) return;
    state.selected = { type: 'label', id };
    showPropertyForm('label', label.name, { resetScroll: !refreshOnly });
    $('labelNameInput').value = label.name;
    $('labelKindInput').value = label.kind;
    $('labelNotesInput').value = label.notes || '';
    $('selectionStatus').textContent = `지명 · ${label.name}`;
    syncStatusBar();
    syncLayerSelectionRows();
    renderAll();
    if (!refreshOnly) openSelectionEditor();
  }

  function hydroEditorName(value, fallback) {
    const name = String(value || '').trim();
    if (/^미명명 수계(?:\s+\d+)?$/.test(name)) return '미명명 수계';
    return name || fallback;
  }

  function selectHydro(id, refreshOnly = false) {
    const feature = hydroFeatureById(id);
    if (!feature || !isHydroFeatureVisible(feature)) return;
    const properties = feature.properties || {};
    const category = properties.category === 'lake' ? '호수' : '강';
    const displayName = hydroEditorName(properties.name, `이름 없는 ${category}`);
    state.selected = { type: 'hydro', id: String(properties.aw_id || feature.id) };
    showPropertyForm('hydro', displayName, { resetScroll: !refreshOnly });
    const systemName = hydroEditorName(properties.mainstem_name_ko || properties.name, '미명명 수계');
    const hydroId = String(properties.system_id || properties.aw_id || feature.id || '').replace(/^hydro-system:/, '');
    $('hydroCategoryValue').textContent = category;
    $('hydroIdValue').textContent = hydroId || '—';
    $('hydroSystemValue').textContent = systemName;
    $('hydroSystemRow').classList.toggle('hidden', systemName === displayName);
    $('hydroTributaryValue').textContent = category === '강' ? '본류·표시 지류' : '호수';
    $('hydroSourceValue').textContent = properties.source || 'AtlasWright 내장 수계';
    $('selectionStatus').textContent = `${category} · ${displayName}`;
    syncStatusBar();
    syncLayerSelectionRows();
    renderAll();
    if (!refreshOnly) openSelectionEditor();
    if (!feature.geometry && !feature.__geometryLoading) {
      feature.__geometryLoading = true;
      gpuMapRenderer.loadHydroLogicalFeature(Number(properties.__logicalFid)).then(full => {
        if (!full) return;
        prepareHydroFeature(full);
        const key = String(full.properties?.aw_id || full.id);
        state.hydroFeatureCache.set(key, full);
        for (const [fid, cached] of state.hydroFeatureByFid) {
          if (String(cached?.properties?.aw_id || cached?.id) === key) state.hydroFeatureByFid.set(fid, full);
        }
        if (state.selected?.type === 'hydro' && state.selected.id === key) selectHydro(key, true);
      }).catch(error => console.warn('수계 선택 형상을 불러오지 못했습니다.', error)).finally(() => { feature.__geometryLoading = false; });
    }
  }

  async function copySelectedHydroForEditing() {
    if (state.selected?.type !== 'hydro') return;
    let source = hydroFeatureById(state.selected.id);
    if (!source) {
      setActionStatus('복사할 수계 객체를 찾을 수 없습니다. 다시 선택하세요.', 'error', 3200);
      return;
    }
    if (!source.geometry || (source.properties?.category === 'river' && Number(source.properties?.fragment_count || 1) > 1)) {
      setActionStatus('수계 전체 형상을 준비하는 중입니다.', 'working', 0);
      try {
        source = await gpuMapRenderer.loadHydroLogicalFeature(Number(source.properties.__logicalFid));
      } catch (error) {
        reportOperationError(error, '수계 전체 형상을 불러오지 못했습니다. 잠시 후 다시 시도하세요.', 'AW-WATER-002', 0);
        return;
      }
      if (!source) {
        setActionStatus('수계 전체 형상을 찾을 수 없습니다. 다시 선택하세요.', 'error', 3200);
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
        editorColor: TERRAIN_TOOL_CONFIG[category].color,
        notes: `AtlasWright 내장 수계 편집용 복사본 · 원본 ${source.properties?.aw_id || source.id}`,
        source: source.properties?.source || 'AtlasWright 내장 수계',
        sourceFeatureId: source.properties?.aw_id || source.id,
      },
    };
    normalizeDrawingSemantics(copy, { inferOwner: false });
    state.drawings.push(copy);
    state.physicalSettings.hiddenHydroIds[String(source.properties?.aw_id || source.id)] = true;
    gpuMapRenderer.invalidateHydroVisibility();
    markLayerTreeDirty();
    selectDrawing(String(copy.id));
    renderAll();
    queueAutosave();
    setActionStatus(`${source.properties?.name || (category === 'lake' ? '호수' : '강')}의 편집용 복사본을 만들고 내장 원본을 숨겼습니다.`, 'success', 3600);
  }

  function clearSelection(announce = true) {
    state.selected = null;
    $('selectionStatus').textContent = '';
    showPropertyForm(null);
    syncCountryActionButtons();
    syncMobileNavigation();
    syncLayerSelectionRows();
    renderAll();
    if (layoutMode === 'wide') {
      surfaceState.editorManuallyCollapsed = false;
      if (surfaceState.editorOpen) closeSurface('editor');
    }
  }

  function normalizeEditorColor(value, fallback) {
    const color = String(value || '').trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(color) ? color : fallback;
  }

  function syncColorPicker(kind, { value, defaultColor, isDefault }) {
    const picker = document.querySelector(`[data-color-picker="${kind}"]`);
    if (!picker) return;
    const fallback = kind === 'country' ? defaultCountryColor() : DEFAULT_DRAWING_COLOR;
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
    if (valueLabel) valueLabel.textContent = isDefault ? '기본 색상' : resolvedValue.toUpperCase();
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
    if (opening) requestAnimationFrame(() => popover.querySelector('button:not(:disabled)')?.focus({ preventScroll: true }));
  }

  function resetCountryColor() {
    if (state.selected?.type !== 'country') return false;
    const id = state.selected.id;
    const idx = state.countryIndex.get(id);
    const feature = idx === undefined ? null : state.countriesData.features[idx];
    const override = state.countryOverrides[id] || {};
    if (!override.color && !feature?.properties?.editor_color) {
      syncColorPicker('country', { value: defaultCountryColor(), defaultColor: defaultCountryColor(), isDefault: true });
      return true;
    }
    recordHistory();
    delete override.color;
    state.countryOverrides[id] = override;
    if (feature?.properties) delete feature.properties.editor_color;
    selectCountry(id, true);
    queueAutosave();
    setActionStatus('국가 색상을 기본값으로 되돌렸습니다.', 'success');
    return true;
  }

  function resetDrawingColor() {
    if (state.selected?.type !== 'drawing') return false;
    const feature = state.drawings.find(item => String(item.id) === String(state.selected.id));
    if (!feature) return false;
    feature.properties ||= {};
    if (!feature.properties.editorColor) {
      const defaultColor = defaultDrawingColor(feature);
      syncColorPicker('drawing', { value: defaultColor, defaultColor, isDefault: true });
      return true;
    }
    recordHistory();
    delete feature.properties.editorColor;
    drawingLandClipCache.delete(feature);
    selectDrawing(String(feature.id), true);
    queueAutosave();
    setActionStatus('지형지물 색상을 기본값으로 되돌렸습니다.', 'success');
    return true;
  }

  function applyColorPickerSelection(kind, value, isDefault = false) {
    if (isDefault) return kind === 'country' ? resetCountryColor() : resetDrawingColor();
    const color = normalizeEditorColor(value, kind === 'country' ? defaultCountryColor() : DEFAULT_DRAWING_COLOR);
    if (kind === 'country') {
      if (state.selected?.type !== 'country') return false;
      commitCountryEdit('color', color);
      return true;
    }
    if (state.selected?.type !== 'drawing') return false;
    commitDrawingMeta('editorColor', color);
    return true;
  }

  function bindColorPickers() {
    document.querySelectorAll('[data-color-picker]').forEach(picker => {
      const kind = picker.dataset.colorPicker;
      const trigger = picker.querySelector('.ui-color-trigger');
      const input = picker.querySelector('.ui-native-color-input');
      const swatches = picker.querySelector('.ui-color-swatches');
      const defaultButton = picker.querySelector('[data-color-default]');
      const customButton = picker.querySelector('[data-color-custom]');
      if (swatches && !swatches.children.length) {
        for (const color of COLOR_PRESETS) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'ui-button ui-color-swatch';
          button.dataset.colorValue = color;
          button.setAttribute('aria-label', `${color.toUpperCase()} 색상`);
          button.setAttribute('aria-pressed', 'false');
          button.style.setProperty('--swatch-color', color);
          swatches.appendChild(button);
        }
      }
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
    if (field === 'name') markLayerTreeDirty();
    selectCountry(id, true);
    queueAutosave();
    setActionStatus('국가 정보를 변경했습니다.', 'success');
  }

  function commitDrawingMeta(field, value) {
    if (state.selected?.type !== 'drawing') return;
    const f = state.drawings.find(x => String(x.id) === state.selected.id);
    if (!f) return;
    f.properties = f.properties || {};
    if (field === 'category' && !drawingCategoryCompatible(f, value)) {
      $('drawingCategoryInput').value = f.properties.category || 'custom';
      setActionStatus('선택한 분류는 이 형상에 사용할 수 없습니다. 면 객체는 영토·행정구역·주제 영역으로, 선 객체는 강으로 분류하세요.', 'error', 4400);
      return;
    }
    if (field === 'aw_folder_id' && value !== DEFAULT_DRAWING_FOLDER_ID && !drawingFolderById(value)) {
      syncDrawingFolderInput(f);
      return;
    }
    recordHistory();
    if (field === 'aw_folder_id') {
      if (value === DEFAULT_DRAWING_FOLDER_ID) delete f.properties.aw_folder_id;
      else f.properties.aw_folder_id = value;
      pruneAutoDrawingFolders();
    } else f.properties[field] = value;
    if (field === 'category') normalizeDrawingSemantics(f);
    if (field === 'aw_owner_id' || field === 'aw_parent_id' || field === 'aw_land_binding') normalizeDrawingSemantics(f, { inferOwner: false });
    drawingLandClipCache.delete(f);
    if (field === 'name' || field === 'category' || field === 'aw_folder_id') markLayerTreeDirty();
    selectDrawing(state.selected.id, true);
    queueAutosave();
    setActionStatus(field === 'aw_folder_id' ? '지형지물을 다른 폴더로 이동했습니다.' : '지형지물 정보를 변경했습니다.', 'success');
  }

  function commitLabelEdit(field, value) {
    if (state.selected?.type !== 'label') return;
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
      ...pickProjectFields(state, { scope: 'history', clone: deepClone }),
    };
  }

  function applySharedProjectFields(source, scope = 'project') {
    return applyProjectFields(state, source, {
      scope,
      clone: deepClone,
      normalizers: {
        drawings: value => deepClone(value || []),
        drawingFolders: value => normalizeDrawingFolders(value),
        physicalSettings: (value, current) => normalizePhysicalSettings(value || current),
        projection: (value, current, project) => value || project.view?.projection || current || 'globe',
        layerVisibility: (value, current) => ({ ...(current || {}), ...(value || {}) }),
        itemVisibility: value => normalizeLayerItemState(value),
        removedLayerItems: value => normalizeRemovedLayerItems(value),
        layerFolders: value => normalizeLayerFolderState(value),
        countriesLocked: value => !!value,
        view: (value, current) => clampViewZooms({ ...(current || {}), ...(value || {}) }),
      },
    });
  }

  function normalizeProjectDrawings() {
    state.drawingFolders = normalizeDrawingFolders(state.drawingFolders);
    state.drawings = normalizeDrawingCollection(state.drawings || []);
    for (const feature of state.drawings) {
      const folderId = String(feature.properties?.aw_folder_id || '');
      if (folderId && !drawingFolderById(folderId)) delete feature.properties.aw_folder_id;
    }
    pruneAutoDrawingFolders();
    state.layerFolders = normalizeLayerFolderState(state.layerFolders);
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
    const changedCountryIds = new Set(state.historyDirtyCountryIds);
    applySharedProjectFields(snapshot, 'history');
    gpuMapRenderer.invalidateHydroVisibility();
    syncPhysicalControls();
    restoreCountriesFromSnapshot(snapshot);
    normalizeProjectDrawings();
    const restoredDirtyIds = new Set(state.historyDirtyCountryIds);
    for (const id of state.historyDirtyCountryIds) changedCountryIds.add(String(id));
    pruneLayerItemVisibility();
    scheduleCountryLabelAnchors(null, 10);
    markLayerTreeDirty();
    state.selected = null;
    state.coastEditCountryId = null;
    state.coastEditScopeDrawingId = null;
    state.coastEditReturnSelection = null;
    resetMergeState();
    resetDrawingMergeState();
    state.drawingSplitSourceId = null;
    resetTerritoryEditingState(true);
    state.tool = 'select';
    showPropertyForm(null);
    $('selectionStatus').textContent = '';
    state.boundaryTopology = { edges: new Map(), nodes: new Map() };
    updateModeButtons();
    if (changedCountryIds.size) markCountryGeometriesChanged(changedCountryIds);
    state.historyDirtyCountryIds = restoredDirtyIds;
    renderAll();
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
    $('mapCommandToolbar')?.classList.toggle('history-empty', !state.history.length && !state.future.length);
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
    state.projection = type === 'globe' ? 'globe' : 'flat';
    syncProjectionButtons();
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
      ...pickProjectFields(state, { clone: value => value }),
      baseDataset: BASE_DATASET,
      landObjectModel: {
        schemaVersion: DRAWING_SCHEMA_VERSION,
        coastlineAuthority: 'countries',
        roles: ['hydro', 'territory', 'administrative', 'thematic', 'custom'],
      },
    };
    project.physicalSourceInfo = {
      terrain: {
        dataset: state.terrainManifest?.dataset || TERRAIN_DATASET,
        version: state.terrainManifest?.version || '0.12.6',
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
      ...pickProjectFields(state, { clone: value => value }),
      baseDataset: BASE_DATASET,
      landObjectModel: {
        schemaVersion: DRAWING_SCHEMA_VERSION,
        coastlineAuthority: 'countries',
      },
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
    mapWorkScheduler.cancel('autosave');
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
    mapWorkScheduler.scheduleIdle('view-autosave', () => {
      writeIndexedDbView().catch(error => console.warn('View autosave failed', error));
    }, delay);
  }

  async function persistAutosave(project = buildAutosaveData()) {
    try {
      await writeIndexedDbProject(project);
      state.lastSavedAt = new Date();
    } catch (error) {
      try {
        saveLocalStorageFallback(project);
        state.lastSavedAt = new Date();
      } catch (fallbackError) {
        console.warn('Autosave failed', error, fallbackError);
        setActionStatus('자동저장 용량을 초과했습니다. GeoPackage 파일로 직접 저장하세요.', 'error', 5200);
      }
    }
  }

  function queueAutosave(delay = 650) {
    clearTimeout(state.autosaveTimer);
    mapWorkScheduler.scheduleIdle('autosave', () => persistAutosave(), delay);
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
    applySharedProjectFields(project);
    gpuMapRenderer.invalidateHydroVisibility();
    state.layerSearch = '';
    state.countriesData = project.countriesData
      ? reindexCountries(deepClone(project.countriesData), true)
      : freshPristineCountries(true);
    normalizeProjectDrawings();
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

    syncProjectionButtons();
    $('countriesVisible').checked = state.layerVisibility.countries;
    $('drawingsVisible').checked = state.layerVisibility.drawings;
    $('labelsVisible').checked = state.layerVisibility.labels;
    $('basemapLabelsVisible').checked = state.layerVisibility.basemapLabels;
    $('countriesLocked').checked = state.countriesLocked;
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
    if (manual) setActionStatus(externalGeometry
      ? '외부 GIS 형상을 저장 당시 상태로 불러왔습니다.'
      : '프로젝트를 불러왔습니다.', 'success', 3200);
  }

  let confirmModalAction = null;

  function openConfirmModal({ title = '확인', message = '', confirmText = '확인', danger = false, onConfirm = null } = {}) {
    const modal = $('confirmModal');
    if (!modal) return;
    clearNotification();
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
    state.drawingFolders = [];
    state.physicalSettings = normalizePhysicalSettings(null);
    state.projection = 'globe';
    state.layerVisibility = { countries: true, drawings: true, labels: true, basemapLabels: true };
    state.itemVisibility = normalizeLayerItemState(null);
    state.removedLayerItems = normalizeRemovedLayerItems(null);
    gpuMapRenderer.invalidateHydroVisibility();
    state.layerFolders = normalizeLayerFolderState(null);
    state.layerSearch = '';
    state.countriesLocked = false;
    state.tool = 'select';
    state.labelPlacementMode = false;
    state.coastEditCountryId = null;
    state.coastEditScopeDrawingId = null;
    state.coastEditReturnSelection = null;
    state.drawingMergeSourceId = null;
    state.drawingMergeTargetIds = [];
    state.drawingSplitSourceId = null;
    resetMergeState();
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
    syncProjectionButtons();
    showPropertyForm(null);
    $('selectionStatus').textContent = '';
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

    // 복원된 최초 geometry를 새 자동저장 기준으로 기록한다.
    queueAutosave();
    setActionStatus('새 프로젝트: 모든 국경을 최초 상태로 복원했습니다.', 'success', 3200);
  }

  function requestNewProject(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();

    closeFileMenu();
    openConfirmModal({
      title: '새 프로젝트',
      message: '현재 편집한 국경, 추가한 국가·지명·영역, 실행취소 기록과 자동저장을 모두 지우고\n내장된 최초 세계 국경으로 돌아갑니다.',
      confirmText: '초기 상태로 시작',
      danger: true,
      onConfirm: () => resetProjectInPlace(),
    });
  }

  function requestDeleteCountry(id) {
    const key = String(id);
    if (state.countriesLocked) {
      setActionStatus('국가 레이어 잠금을 해제한 뒤 삭제할 수 있습니다.', 'error', 3000);
      return;
    }
    const feature = countryFeatureById(key);
    if (!feature) return;
    const name = countryName(feature);
    openConfirmModal({
      title: '국가 삭제',
      message: `${name} 국가 객체를 지도에서 삭제합니다. 실행취소로 복구할 수 있습니다.`,
      confirmText: '국가 삭제',
      danger: true,
      onConfirm: () => {
        recordHistory();
        for (const drawing of state.drawings) {
          if (String(drawing.properties?.aw_owner_id || '') !== key) continue;
          drawing.properties.aw_owner_id = '';
          drawing.properties.aw_parent_id = '';
          drawing.properties.aw_land_binding = 'clip';
          normalizeDrawingSemantics(drawing, { inferOwner: false });
        }
        state.countriesData.features = state.countriesData.features.filter(f => String(f.properties?.editor_id) !== key);
        delete state.countryOverrides[key];
        markCountryGeometriesChanged([key]);
        reindexCountries(state.countriesData, true);
        state.boundaryTopology = { edges: new Map(), nodes: new Map() };
        if (state.selected?.type === 'country' && String(state.selected.id) === key) clearSelection(false);
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
    if (state.selected?.type !== 'country') return;
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
      reportOperationError(error, 'GeoPackage를 저장하지 못했습니다. 저장 공간을 확인한 뒤 다시 시도하세요.', 'AW-GPKG-001', 5200);
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
      reportOperationError(error, 'GIS 파일을 열지 못했습니다. 파일 형식과 함께 선택한 구성 파일을 확인하세요.', 'AW-GIS-001', 5600);
    }
  }

  async function importGeoJson(file) {
    const parsed = JSON.parse(await file.text());
    const features = parsed.type === 'FeatureCollection' ? parsed.features : parsed.type === 'Feature' ? [parsed] : [];
    const supported = [];
    const folder = createImportedDrawingFolder(file.name);
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
        aw_folder_id: folder.id,
      };
      supported.push(normalizeDrawingSemantics(f));
    }
    if (!supported.length) throw new Error('지원되는 점·선·면 지도 객체가 없습니다.');
    recordHistory();
    state.drawingFolders.push(folder);
    state.drawings.push(...supported);
    state.layerFolders = Object.fromEntries(activeLayerFolderKeys().map(key => [key, key === drawingFolderStateKey(folder.id)]));
    markLayerTreeDirty();
    renderAll();
    queueAutosave();
    setActionStatus(`GeoJSON ${supported.length}개 객체를 ${folder.name} 폴더로 가져왔습니다.`, 'success', 3200);
  }

  function exportDrawingsGeoJson() {
    const geojson = { type: 'FeatureCollection', features: deepClone(state.drawings) };
    downloadBlob('AtlasWright-지형지물.geojson', new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' }));
    setActionStatus(`지형지물 ${state.drawings.length}개를 GeoJSON으로 내보냈습니다.`, 'success', 3200);
  }

  function removeDrawingById(id, statusText = '') {
    const key = String(id);
    const feature = state.drawings.find(candidate => String(candidate.id) === key);
    if (!feature) return false;
    recordHistory();
    reassignDrawingParents([key]);
    state.drawings = state.drawings.filter(candidate => String(candidate.id) !== key);
    pruneAutoDrawingFolders();
    markLayerTreeDirty();
    if (state.selected?.type === 'drawing' && String(state.selected.id) === key) clearSelection(false);
    else renderAll();
    queueAutosave();
    setActionStatus(statusText || `${drawingName(feature)} 지형지물을 삭제했습니다.`, 'success');
    return true;
  }

  function removeLabelById(id, statusText = '') {
    const key = String(id);
    const label = state.labels.find(candidate => String(candidate.id) === key);
    if (!label) return false;
    recordHistory();
    state.labels = state.labels.filter(candidate => String(candidate.id) !== key);
    markLayerTreeDirty();
    if (state.selected?.type === 'label' && String(state.selected.id) === key) clearSelection(false);
    else renderAll();
    queueAutosave();
    setActionStatus(statusText || `${label.name || '지명'} 지명을 삭제했습니다.`, 'success');
    return true;
  }

  function deleteLayerTreeItem(group, id) {
    const key = String(id);
    const item = layerTreeItems(group).find(candidate => String(candidate.id) === key);
    if (!item) return;
    if (group === 'countries') {
      requestDeleteCountry(key);
      return;
    }

    if (group === 'drawings' && key.startsWith('hydro-layer:')) {
      const layerId = key.slice('hydro-layer:'.length);
      recordHistory();
      state.removedLayerItems.drawings[key] = true;
      const selectedHydro = state.selected?.type === 'hydro' ? hydroFeatureById(state.selected.id) : null;
      gpuMapRenderer.invalidateHydroVisibility();
      markLayerTreeDirty();
      if (selectedHydro?.properties?.layer_id === layerId) clearSelection(false);
      else renderAll();
      queueAutosave();
      setActionStatus(`${item.name} 레이어를 현재 프로젝트에서 제거했습니다.`, 'success', 3200);
      return;
    }

    if (group === 'countryLabels') {
      recordHistory();
      state.removedLayerItems.countryLabels[key] = true;
      markLayerTreeDirty();
      renderAll();
      queueAutosave();
      setActionStatus(`${item.name} 국가명 라벨을 현재 프로젝트에서 제거했습니다.`, 'success', 3200);
      return;
    }

    if (group === 'drawings') {
      removeDrawingById(key, `${item.name} 지형지물을 삭제했습니다.`);
      return;
    }

    if (group === 'labels') {
      removeLabelById(key, `${item.name} 지명을 삭제했습니다.`);
    }
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
    if (state.selected.type === 'drawing') {
      removeDrawingById(state.selected.id, '선택한 객체를 삭제했습니다.');
    } else if (state.selected.type === 'label') {
      removeLabelById(state.selected.id, '선택한 객체를 삭제했습니다.');
    }
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
      if (!feature) return false;
      if (!state.countriesLocked) selectCountry(key);
      const primary = largestCountryComponentFeature(feature) || feature;
      focusCountry(primary, { maxZoom: isMobile() ? 10 : 9 });
      if (state.countriesLocked) setActionStatus('국가 레이어가 잠겨 있어 위치만 이동했습니다.', 'error', 2600);
      return true;
    } else if (group === 'drawings') {
      if (key === 'user-terrain') {
        return false;
      }
      if (key.startsWith('hydro-layer:')) {
        if (!state.hydroManifest) loadHydroData(true);
        else {
          const cacheState = state.physicalLoadState.hydroCache;
          if (cacheState === 'error') {
            gpuMapRenderer.retryHydroCache?.();
            setActionStatus('전 세계 수계 자료의 오프라인 저장을 다시 시도합니다.', 'working', 0);
          } else {
            const suffix = cacheState === 'ready' ? '오프라인에서도 바로 사용할 수 있습니다.' : `전 세계 자료를 백그라운드에서 준비하고 있습니다. ${Math.round(state.physicalLoadState.hydroCachePercent || 0)}%`;
            setActionStatus(suffix, 'success', 3200);
          }
        }
        return false;
      }
      const feature = state.drawings.find(item => String(item.id) === key);
      if (!feature) return false;
      selectDrawing(key);
      focusCountry(feature, { maxZoom: isMobile() ? 12 : 10 });
      return true;
    } else if (group === 'labels') {
      const label = state.labels.find(item => String(item.id) === key);
      if (!label) return false;
      selectLabel(key);
      focusCoordinate(label.coordinates);
      return true;
    }
    return false;
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

  function bindNavigationUI() {
    document.addEventListener('pointerdown', event => {
      if (!event.target.closest('#notificationCloseBtn')) clearErrorNotification();
    }, true);
    document.addEventListener('click', e => {
      if (!e.target.closest('.top-actions') && !e.target.closest('#mobileFileBtn')) {
        closeFileMenu();
      }
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
    document.querySelectorAll('[data-sheet-handle]').forEach(bindSheetDragHandle);
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
    $('countriesVisible').addEventListener('change', e => setLayerVisibility('countries', e.target.checked));
    $('drawingsVisible').addEventListener('change', e => setLayerVisibility('drawings', e.target.checked));
    $('labelsVisible').addEventListener('change', e => setLayerVisibility('labels', e.target.checked));
    $('basemapLabelsVisible').addEventListener('change', e => setLayerVisibility('basemapLabels', e.target.checked));
    $('terrainVisible').addEventListener('change', event => {
      state.physicalSettings.terrainVisible = !!event.target.checked;
      markLayerTreeDirty();
      renderLayerTree();
      renderAll();
      queueAutosave();
    });
    for (const id of ['terrainPoliticalRadio', 'terrainPhysicalRadio']) $(id).addEventListener('change', event => {
      if (!event.target.checked) return;
      state.physicalSettings.terrainStyle = event.target.value === 'physical' ? 'physical' : 'political';
      markLayerTreeDirty();
      renderLayerTree();
      renderAll();
      queueAutosave();
      setActionStatus(`${state.physicalSettings.terrainStyle === 'physical' ? '지형색 강조' : '국가색 + 음영'} 모드로 전환했습니다.`, 'success', 2200);
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
      const deleteButton = event.target.closest('[data-layer-item-delete]');
      if (deleteButton) {
        deleteLayerTreeItem(deleteButton.dataset.layerItemDelete, deleteButton.dataset.itemId);
        return;
      }
      const folderButton = event.target.closest('[data-layer-folder-toggle]');
      if (folderButton) {
        const group = folderButton.dataset.layerFolderToggle;
        const folderKeys = activeLayerFolderKeys();
        if (!folderKeys.includes(group)) return;
        const willExpand = !state.layerFolders[group];
        for (const key of folderKeys) state.layerFolders[key] = false;
        state.layerFolders[group] = willExpand;
        markLayerTreeDirty();
        renderLayerTree();
        queueAutosave();
        return;
      }
      const itemButton = event.target.closest('[data-layer-item-select]');
      if (itemButton) {
        const focusedMap = selectLayerTreeItem(itemButton.dataset.layerItemSelect, itemButton.dataset.itemId);
        returnToMapAfterMobileAction(focusedMap);
      }
    });
    $('layerSection')?.addEventListener('scroll', event => {
      if (event.target === $('layerSearchResults')) {
        layerSearchScrollTop = event.target.scrollTop;
        return;
      }
      const container = event.target.closest?.('.layer-children');
      if (!container) return;
      const folder = container.closest('.layer-folder');
      const group = folder?.dataset.layerGroup;
      const folderKey = folder?.dataset.layerFolderKey || group;
      if (group && folderKey) {
        const scrollTop = container.scrollTop;
        layerGroupScrollTop.set(folderKey, scrollTop);
        const items = layerVirtualItems.get(folderKey);
        if (!items || container.dataset.virtualized !== 'true') return;
        renderVirtualizedLayerGroup(group, container, items, { scrollTop, folderKey });
      }
    }, true);
    $('layerSection')?.addEventListener('change', event => {
      const folderVisibility = event.target.closest('[data-drawing-folder-visibility]');
      if (folderVisibility) {
        setDrawingFolderVisibility(folderVisibility.dataset.drawingFolderVisibility, folderVisibility.checked);
        return;
      }
      const checkbox = event.target.closest('[data-layer-item-visibility]');
      if (!checkbox) return;
      setLayerItemVisibility(checkbox.dataset.layerItemVisibility, checkbox.dataset.itemId, checkbox.checked);
    });
    $('countriesLocked').addEventListener('change', e => {
      state.countriesLocked = e.target.checked;
      markLayerTreeDirty();
      renderLayerTree();
      renderCountries();
      queueAutosave();
    });

  }

  function bindToolUI() {
    $('addCountryBtn')?.addEventListener('click', () => {
      returnToMapAfterMobileAction(enterNewCountryMode(), { fromCreate: true });
    });
    $('addLabelBtn')?.addEventListener('click', () => {
      returnToMapAfterMobileAction(enterLabelMode(), { fromCreate: true });
    });
    $('addRiverBtn')?.addEventListener('click', () => {
      returnToMapAfterMobileAction(enterTerrainDrawingMode('river'), { fromCreate: true });
    });
    $('addLakeBtn')?.addEventListener('click', () => {
      returnToMapAfterMobileAction(enterTerrainDrawingMode('lake'), { fromCreate: true });
    });
    $('modePrimaryBtn')?.addEventListener('click', () => {
      if (state.tool === 'country-coast') finishCountryCoastEdit();
      else if (state.tool === 'merge-drawing') completeDrawingMerge();
      else if (state.tool === 'new-country' && state.newCountryPhase === 'sources') beginNewCountryLine();
      else if (state.tool === 'annex-territory' && state.annexPhase === 'donor') beginAnnexSelection();
      else if (state.tool === 'merge-country') completeCountryMerge();
      else if (state.tool === 'new-country' && state.newCountryPhase === 'side') completeNewCountryCreation(state.newCountrySelectedCandidateIndex);
      else if (state.tool === 'new-country' && state.newCountryPhase === 'components') completeNewCountryCreation(null);
      else if (state.tool === 'annex-territory' && state.annexPhase === 'side') completeLinearAnnexation(state.annexSelectedCandidateIndex);
      else if (state.tool === 'annex-territory' && state.annexPhase === 'components') completeLinearAnnexation(null);
      else if (isDrawingDraftTool(state.tool) || ['new-country', 'annex-territory'].includes(state.tool)) finishDraft();
    });
    $('modeLineMethodBtn')?.addEventListener('click', () => switchTerritorySelectionMethod('line'));
    $('modeComponentsMethodBtn')?.addEventListener('click', () => switchTerritorySelectionMethod('components'));
    $('modeCancelBtn')?.addEventListener('click', () => {
      if (state.labelPlacementMode || state.tool === 'label') exitLabelMode();
      else if (isDrawingDraftTool(state.tool)) cancelDraft(true);
      else cancelActiveMode();
    });
    $('annexTerritoryBtn')?.addEventListener('click', () => {
      if (state.selected?.type !== 'country') return;
      if (state.tool === 'annex-territory' && state.annexTargetCountryId === state.selected.id) cancelActiveMode();
      else returnToMapAfterMobileAction(enterAnnexTerritoryMode(state.selected.id));
    });
    $('editCoastBtn')?.addEventListener('click', () => {
      if (state.selected?.type !== 'country') return;
      if (state.tool === 'country-coast' && state.coastEditCountryId === state.selected.id) finishCountryCoastEdit();
      else returnToMapAfterMobileAction(enterCountryCoastEdit(state.selected.id));
    });
    $('deleteCountryBtn')?.addEventListener('click', deleteSelectedCountry);
    $('mergeCountryBtn')?.addEventListener('click', () => {
      if (state.selected?.type === 'country') returnToMapAfterMobileAction(enterMergeCountryMode(state.selected.id));
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
      { id: 'drawingFolderInput', field: 'aw_folder_id', commit: commitDrawingMeta },
      { id: 'drawingCategoryInput', field: 'category', commit: commitDrawingMeta },
      { id: 'drawingOwnerInput', field: 'aw_owner_id', commit: commitDrawingMeta },
      { id: 'drawingParentInput', field: 'aw_parent_id', commit: commitDrawingMeta },
      { id: 'drawingLandBindingInput', field: 'aw_land_binding', commit: commitDrawingMeta },
      { id: 'drawingNotesInput', field: 'notes', commit: commitDrawingMeta },
      { id: 'labelNameInput', field: 'name', commit: commitLabelEdit, transform: value => value.trim() },
      { id: 'labelKindInput', field: 'kind', commit: commitLabelEdit },
      { id: 'labelNotesInput', field: 'notes', commit: commitLabelEdit },
    ]);
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

    $('splitDrawingBtn').addEventListener('click', () => {
      if (state.selected?.type === 'drawing') returnToMapAfterMobileAction(enterDrawingSplitMode(state.selected.id));
    });
    $('mergeDrawingBtn').addEventListener('click', () => {
      if (state.selected?.type === 'drawing') returnToMapAfterMobileAction(enterDrawingMergeMode(state.selected.id));
    });
    $('syncDrawingCoastBtn').addEventListener('click', alignSelectedDrawingToOwnerLand);
    $('editDrawingCoastBtn').addEventListener('click', () => {
      if (state.selected?.type !== 'drawing') return;
      const feature = state.drawings.find(item => String(item.id) === String(state.selected.id));
      const ownerId = String(feature?.properties?.aw_owner_id || '');
      if (!countryFeatureById(ownerId)) return;
      returnToMapAfterMobileAction(enterCountryCoastEdit(ownerId, { scopeDrawingId: feature.id, returnSelection: { type: 'drawing', id: String(feature.id) } }));
    });
    $('applyDrawingToCountryBtn').addEventListener('click', () => openConfirmModal({
      title: '국가 영토에 반영',
      message: '선택한 영역과 겹치는 다른 국가의 영토를 소유 국가로 이전합니다. 한 번의 실행취소로 복구할 수 있습니다.',
      confirmText: '영토 반영',
      onConfirm: applySelectedDrawingToOwnerCountry,
    }));
    $('promoteDrawingToCountryBtn').addEventListener('click', () => openConfirmModal({
      title: '국가로 전환',
      message: '선택한 영역을 기존 국가들에서 분리해 새 국가로 전환합니다. 객체 이름을 새 국명으로 사용합니다.',
      confirmText: '국가로 전환',
      onConfirm: promoteSelectedDrawingToCountry,
    }));

    $('deleteLabelBtn').addEventListener('click', deleteSelected);
    $('copyHydroBtn').addEventListener('click', copySelectedHydroForEditing);
    $('deleteDrawingInlineBtn')?.addEventListener('click', deleteSelected);

    $('undoBtn').addEventListener('click', undo);
    $('redoBtn').addEventListener('click', redo);
    $('zoomOutBtn')?.addEventListener('click', () => zoomBy(0.8));
    $('zoomInBtn')?.addEventListener('click', () => zoomBy(1.25));

    $('togglePanelBtn').addEventListener('click', toggleEditorPanel);

  }

  function bindFileAndGisUI() {
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
        reportOperationError(error, 'GeoJSON을 가져오지 못했습니다. Polygon 또는 MultiPolygon 형식인지 확인하세요.', 'AW-GEOJSON-001', 4500);
      }
      e.target.value = '';
    });
    $('exportGeoJsonBtn').addEventListener('click', exportDrawingsGeoJson);
    document.querySelector('.top-actions')?.addEventListener('click', e => {
      const button = e.target.closest('button');
      if (!button) return;
      setTimeout(() => {
        closeFileMenu();
      }, 80);
    });

  }

  function bindGlobalInputUI() {
    document.addEventListener('keydown', e => {
      const tag = document.activeElement?.tagName;
      const editingText = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag);
      if (e.key === 'Tab' && document.body.classList.contains('file-menu-open')) {
        const fileMenu = document.querySelector('.top-actions.mobile-open');
        const focusable = fileMenu
          ? [...fileMenu.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')]
          : [];
        if (focusable.length) {
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
      if (e.key === 'Escape') {
        if (!$('gisImportModal')?.classList.contains('hidden')) { $('gisImportCancelBtn')?.click(); return; }
        if (!$('confirmModal')?.classList.contains('hidden')) { closeConfirmModal(); return; }
        if (document.body.classList.contains('file-menu-open')) { closeFileMenu({ restoreFocus: true }); return; }
        if (isCreateMenuOpen()) { closeCreateMenu({ restoreFocus: true }); return; }
        if (state.labelPlacementMode) exitLabelMode();
        else if (isDrawingDraftTool(state.tool)) cancelDraft(true);
        else if (['new-country', 'annex-territory', 'merge-country', 'merge-drawing', 'country-coast'].includes(state.tool)) cancelActiveMode();
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
      const annexComponentsMode = state.tool === 'annex-territory' && state.annexPhase === 'components';
      const mergeTargetMode = state.tool === 'merge-country' && !!state.mergeSourceCountryId;
      if (e.key === 'Enter' && !editingText && (newCountrySourceMode || annexDonorMode || mergeTargetMode)) {
        e.preventDefault();
        if (newCountrySourceMode) beginNewCountryLine();
        else if (annexDonorMode) beginAnnexSelection();
        else completeCountryMerge();
        return;
      }
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
      if (!layoutChanged) {
        refreshMapSheetMetrics();
        queueMapResize();
      }
    });
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
      try { writeIndexedDbProject(buildAutosaveData()).catch(() => {}); } catch (_) {}
    });
  }

  function bindUI() {
    bindNavigationUI();
    bindLayerUI();
    bindToolUI();
    bindEditorFields();
    bindFileAndGisUI();
    bindGlobalInputUI();
  }

  async function init() {
    assertRuntimeCompatibility();
    if (!window.d3) {
      $('engineStatus').textContent = '엔진 오류';
      setActionStatus('내장 지도 엔진을 불러올 수 없습니다. 페이지를 새로고침하세요.', 'error', 0);
      return;
    }
    if (!window.ATLASWRIGHT_COUNTRIES?.features?.length) {
      setActionStatus('내장 국가 데이터를 불러올 수 없습니다. 페이지를 새로고침하세요.', 'error', 0);
      return;
    }

    const autosaveRestore = await restoreAutosavedProject();
    const restored = autosaveRestore.project;
    if (restored) applySharedProjectFields(restored);

    const restoredDelta = restored?.format === 'atlaswright-autosave-delta';
    state.countriesData = restoredDelta
      ? countriesFromAutosaveDelta(restored)
      : restored?.countriesData
        ? reindexCountries(deepClone(restored.countriesData), true)
        : freshPristineCountries(true);
    normalizeProjectDrawings();
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
    startMapResizeObserver();
    if (restored && gpuReady) {
      if (externalGeometry || state.sessionBaseCountriesJson) scheduleGpuMeshRebuild(0);
      else if (state.historyDirtyCountryIds.size) {
        for (const id of state.historyDirtyCountryIds) state.pendingCountryRenderIds.add(String(id));
        gpuMapRenderer.applyCountryPatch(state.historyDirtyCountryIds);
      }
    }

    $('countriesVisible').checked = state.layerVisibility.countries;
    $('drawingsVisible').checked = state.layerVisibility.drawings;
    $('labelsVisible').checked = state.layerVisibility.labels;
    $('basemapLabelsVisible').checked = state.layerVisibility.basemapLabels;
    $('countriesLocked').checked = state.countriesLocked;
    syncPhysicalControls();
    if ($('layerSearchInput')) $('layerSearchInput').value = state.layerSearch;
    renderLayerTree(true);
    syncProjectionButtons();

    resizeMap();
    updateHistoryButtons();
    setTool('select');
    loadPhysicalData();

    $('startupProbe')?.remove();

    if (restored) {
      if (restored.countriesData && restored.baseDataset === BASE_DATASET) queueAutosave(0);
      if (gpuReady) {
        const restoredLabel = externalGeometry ? '외부 GIS 자동저장 데이터를' : '자동저장 프로젝트를';
        setActionStatus(`${restoredLabel} 복원했습니다.`, 'success', 3200);
      } else {
        const renderer = gpuMapRenderer.getStats();
        setActionStatus(`자동저장을 복원했습니다. ${renderer.renderer === 'canvas-worker' ? 'Canvas Worker' : 'Canvas'} 무손실 렌더러를 사용합니다.`, 'success', 4200);
      }
    } else {
      if (gpuReady) {
        setActionStatus('고해상도 지도를 준비했습니다.', 'success');
      } else {
        const renderer = gpuMapRenderer.getStats();
        setActionStatus(`${renderer.renderer === 'canvas-worker' ? 'Canvas Worker' : 'Canvas'} 무손실 렌더러를 준비했습니다.`, 'success', 4200);
      }
    }
  }

  try {
    init()
      .then(() => {
        runtimeReady = true;
        window.dispatchEvent(new CustomEvent('atlaswright:ready'));
      })
      .catch(error => {
        window.dispatchEvent(new CustomEvent('atlaswright:error', { detail: error?.message || String(error) }));
        showFatalError(error);
      });
  } catch (error) {
    window.dispatchEvent(new CustomEvent('atlaswright:error', { detail: error?.message || String(error) }));
    showFatalError(error);
  }
})();
