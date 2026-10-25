import {createPreferencePresentation} from "../../../../../shared/frontend/js/modules/preference-presentation.js";
import {workerAssetUrl} from "../../../../../shared/frontend/js/modules/worker-asset-url.js";
import {ZOOM_LIMITS,FLAT_LATITUDE_LIMIT} from "../../../../../shared/frontend/js/modules/camera-navigation.js";
import {syncSearchClearButton} from "../../../../../shared/frontend/js/modules/object-search-controller.js";
import { HYDRO_DATASET as hydroDataset } from "../../../../../shared/frontend/js/modules/physical-layer-service.js";
import { createEmptyState as renderEmptyState } from "../../../../../shared/frontend/js/modules/empty-state.js";
import { resolveMapTheme } from "../../../../../shared/frontend/js/modules/map-theme.js";
import { HYDRO_DATA_VERSION } from "../../../../../shared/frontend/js/modules/physical-layer-service.js";
import { DEFAULT_GENERIC_FEATURE_COLOR,countryDefaultColor } from "../../../../../shared/frontend/js/modules/color-adapter.js";
import {TERRAIN_RASTER_DATASET} from "../../../../../shared/frontend/js/modules/terrain-manifest.js";
import {createPhysicalSourceConfiguration,HYDRO_TOOL_CONFIG,HYDRO_LAYER_META,TERRAIN_OCEAN_REPRESENTATIVE,PHYSICAL_DATASET} from "../../../../../shared/frontend/js/modules/physical-source-configuration.js";
/** Environment: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createEnvironment() {
  let dependencies;
  let preferencePresentation;
  let d3;
  let APP_VERSION;
  let FLAT_PROJECTION_KIND;
  let ASSET_REVISION;
  let DATA_REVISION;
  let PANDOLAB_ASSET_BASE_URL;
  let PHYSICAL_DATA_BASE_URL;
  let TERRAIN_RASTER_MANIFEST_URL;
  let TERRAIN_DEV_DEM_MANIFEST_URL;
  let TERRAIN_PRIMARY_MANIFEST_URL;
  let TERRAIN_FALLBACK_MANIFEST_URL;
  let TERRAIN_SOURCE_CHOICE;
  let TERRITORIAL_LIBRARY_INDEX_URL;
  let TERRAIN_DATASET;
  let HYDRO_DATASET;
  let STORAGE_KEY;
  let AUTOSAVE_DB_NAME;
  let AUTOSAVE_STORE_NAME;
  let AUTOSAVE_RECORD_KEY;
  let AUTOSAVE_VIEW_KEY;
  let BASE_DATASET;
  let COLOR_PRESETS;
  let COLOR_PALETTE_TONES;
  let COLOR_PALETTE_NEUTRALS;
  let COLOR_PALETTE_HUES;
  let COLOR_PALETTE_COLORS;
  let MAX_HISTORY;
  let CUT_ENDPOINT_SNAP_DISTANCE;
  let runtimeReady;
  let $;
  let selectController;
  let tooltipController;
  let REQUIRED_UI_IDS;
  let CACHE_MISMATCH_MESSAGE;
  let deepClone;
  let reliabilityDiagnostic;
  let clamp;
  function connect(ports) {
    if (dependencies) throw new Error('environment already connected');
    dependencies = ports;
  }

  function enableKeyboardNavigation(event) {
    if (event.key === 'Tab') document.documentElement.classList.add('keyboard-navigation');
  }

  function disableKeyboardNavigation() {
    document.documentElement.classList.remove('keyboard-navigation');
  }

  function mapTheme() {
    return resolveMapTheme({ state: dependencies.projectState.state,
      theme: document.documentElement.dataset.theme || window.__PANDOLAB_THEME__ || preferencePresentation.systemTheme });
  }

  function defaultCountryColor(feature) {
    // Unpainted objects still need a valid color input swatch, not stored paint.
    return countryDefaultColor(feature) || mapTheme().defaultLand;
  }

  function onPreferenceChange({reason,rerender}){
    if(!dependencies.mapLayers.svg)return;
    dependencies.preferences.applyMapAppearanceChange({reason,rerender});
    if (dependencies.projectState.state?.selected?.domain === 'territorial' && (dependencies.territorialModel.entityRepository.get(dependencies.projectState.state.selected?.id)?.properties.entityKind === 'general' && !dependencies.territorialModel.entityRepository.get(dependencies.projectState.state.selected?.id)?.properties.parentId)) {
      const id = String(dependencies.projectState.state.selected.id);
      const feature = dependencies.territorialModel.entityRepository.get(id);
      const color = (0, dependencies.colorModel.readDomainColor)(dependencies.colorModel.COLOR_DOMAINS.TERRITORIAL, { feature }, { fallback: defaultCountryColor(feature) });
      if (color.isDefault && $('entityColorInput')) $('entityColorInput').value = color.value;
      (0, dependencies.colorPicker.syncColorPicker)('entity', {
        value: color.value,
        defaultColor: defaultCountryColor(feature),
        isDefault: color.isDefault,
      });
    }
    dependencies.objectDisplay.invalidateObjectPresentation();
    dependencies.domains.objectSearchController?.render();
  }

  function runtimeAssetUrl(relativePath) {
    const url = new URL(relativePath, PANDOLAB_ASSET_BASE_URL);
    url.searchParams.set('v', ASSET_REVISION);
    return /\/workers\/[\w-]+-worker\.js$/.test(url.pathname) ? workerAssetUrl(url) : url;
  }

  function assertRuntimeCompatibility() {
    const htmlVersion = $('app')?.dataset.appVersion;
    const bootstrapVersion = window.PANDOLAB_APP_VERSION;
    if (htmlVersion !== APP_VERSION || bootstrapVersion !== APP_VERSION) throw new Error(CACHE_MISMATCH_MESSAGE);
    const missingIds = REQUIRED_UI_IDS.filter(id => !$(id));
    const missingSelectors = ['.workspace'].filter(selector => !document.querySelector(selector));
    if (missingIds.length || missingSelectors.length) throw new Error(CACHE_MISMATCH_MESSAGE);
  }

  function initializeD3() {
    (d3 = window.d3);
  }

  function initializeTerritorialGeometry() {
    (APP_VERSION = String(globalThis.PANDOLAB_BUILD_META?.appVersion || ''));

    (FLAT_PROJECTION_KIND = 'equirectangular');


    (ASSET_REVISION = String(window.PANDOLAB_ASSET_REVISION || globalThis.PANDOLAB_BUILD_META?.assetRevision || ''));

    (DATA_REVISION = String(window.PANDOLAB_DATA_REVISION || globalThis.PANDOLAB_BUILD_META?.dataRevision || ''));

    if (!APP_VERSION || !ASSET_REVISION) throw new Error('빌드 메타데이터가 불완전합니다.');

    (PANDOLAB_ASSET_BASE_URL = window.PANDOLAB_ASSET_BASE_URL || new URL('./assets/js/', location.href).href);

    ({PHYSICAL_DATA_BASE_URL,TERRAIN_RASTER_MANIFEST_URL,TERRAIN_DEV_DEM_MANIFEST_URL,
      TERRAIN_PRIMARY_MANIFEST_URL,TERRAIN_FALLBACK_MANIFEST_URL,TERRAIN_SOURCE_CHOICE}=createPhysicalSourceConfiguration({
      assetBaseUrl:PANDOLAB_ASSET_BASE_URL,dataRevision:DATA_REVISION,resourceProfile:globalThis.PANDOLAB_BUILD_META?.resourceProfile}));

    (TERRITORIAL_LIBRARY_INDEX_URL = new URL('territorial-entities/generated/v2/index.json', PHYSICAL_DATA_BASE_URL));

    TERRITORIAL_LIBRARY_INDEX_URL.searchParams.set('v', ASSET_REVISION);


    (TERRAIN_DATASET = TERRAIN_RASTER_DATASET);

    (HYDRO_DATASET = hydroDataset);

    (STORAGE_KEY = 'pandolab-editor-project');

    (AUTOSAVE_DB_NAME = 'pandolab-editor');

    (AUTOSAVE_STORE_NAME = 'projects');

    (AUTOSAVE_RECORD_KEY = 'active-project');

    (AUTOSAVE_VIEW_KEY = 'active-view');

    (BASE_DATASET = 'Natural Earth 5.1.1 · Admin 0 Countries · 1:10m · de facto');



    (COLOR_PRESETS = Object.freeze([
      '#000000', '#4b5563', '#9ca3af', '#ffffff', '#7f1d1d', '#dc2626',
      '#f97316', '#f59e0b', '#facc15', '#166534', '#22c55e', '#14b8a6',
      '#0ea5e9', '#2563eb', '#4338ca', '#7c3aed', '#a855f7', '#db2777',
      '#f43f5e', '#8b5e3c', '#cda95d', '#63758a', '#cccccc', '#8c68d8',
    ]));

    (COLOR_PALETTE_TONES = Object.freeze(['아주 밝음', '밝음', '기본', '어두움', '아주 어두움']));

    (COLOR_PALETTE_NEUTRALS = Object.freeze([
      Object.freeze({ color: '#f3f4f6', label: '회색 아주 밝음' }),
      Object.freeze({ color: '#d1d5db', label: '회색 밝음' }),
      Object.freeze({ color: '#9ca3af', label: '회색 기본' }),
      Object.freeze({ color: '#4b5563', label: '회색 어두움' }),
      Object.freeze({ color: '#1f2937', label: '회색 아주 어두움' }),
    ]));

    (COLOR_PALETTE_HUES = Object.freeze([
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
    ]));

    (COLOR_PALETTE_COLORS = Object.freeze(COLOR_PALETTE_TONES.flatMap((tone, toneIndex) => (
      COLOR_PALETTE_HUES.map(hue => Object.freeze({
        color: hue.colors[toneIndex],
        label: `${hue.name} ${tone}`,
        family: hue.name,
        tone,
      }))
    ))));



    (MAX_HISTORY = 30);

    (CUT_ENDPOINT_SNAP_DISTANCE = Object.freeze({ mouse: 10, touch: 18 }));


    preferencePresentation=createPreferencePresentation({document,window,productMode:'editor',onChange:onPreferenceChange});
    runtimeReady=false;
    dependencies.selectionServices.setSelectionColor(preferencePresentation.interactionStyle.selection.color);
    dependencies.selectionServices.setSelectionInteractionStyle(preferencePresentation.interactionStyle);

    document.addEventListener('keydown', enableKeyboardNavigation, true);

    if ('PointerEvent' in window) document.addEventListener('pointerdown', disableKeyboardNavigation, true);
    else {
      document.addEventListener('mousedown', disableKeyboardNavigation, true);
      document.addEventListener('touchstart', disableKeyboardNavigation, { capture: true, passive: true });
    }

    ($ = (id) => document.getElementById(id));

    (selectController = (0, dependencies.uiFactoriesB.createSelectController)({ document, window }));

    selectController.enhanceAll();

    (tooltipController = (0, dependencies.uiFactoriesB.createTooltipController)({
      document,
      window,
      tooltip: $('uiTooltip'),
      clamp: (value, minimum, maximum) => clamp(value, minimum, maximum),
    }));

    (REQUIRED_UI_IDS = Object.freeze([
      'app', 'map', 'mapBottomStatus', 'statusView', 'projectionStatus', 'statusSelection', 'projectSaveStatus', 'projectSaveStatusText', 'uiTooltip',
      'editorTimelineContext',
      'objectSearchSurface', 'objectSearchSection', 'mapDisplaySurface', 'mapViewSection',
      'objectsVisible', 'distributionsVisible', 'riversVisible', 'lakesVisible', 'genericFeaturesVisible', 'labelsVisible', 'objectNamesVisible', 'objectFlagsVisible', 'distributionActiveLayerInput', 'distributionLegend', 'distributionBoundaryVisibleInput',
      'createMenuBtn', 'mobileCreateBtn', 'mobileMenuBtn', 'mobileGlobalMenu', 'mobileMenuFileBtn', 'mobileFileBackBtn', 'mobilePreferencesBtn', 'mobileHelpBtn', 'mobileUndoBtn', 'mobileRedoBtn', 'objectSearchBtn', 'mapDisplayBtn', 'mobileSearchBtn', 'mobileDisplayBtn', 'resetViewBtn', 'flagMenuBtn', 'flagMenu', 'flagPreview', 'entityNameInput', 'entityColorInput', 'entityNotesInput',
      'debugMapPanel', 'entityAreaValue',
      'flagUploadBtn', 'flagFileInput', 'flagRemoveBtn',
      'genericFeatureConversionSection', 'genericFeatureConvertType', 'genericFeatureConvertParentField', 'genericFeatureConvertParentInput', 'genericFeatureConvertDistributionField', 'genericFeatureConvertDistributionInput', 'genericFeatureConvertDistributionValueField', 'genericFeatureConvertDistributionValueInput', 'convertGenericFeatureBtn',
      'labelNameInput', 'labelKindInput', 'labelNotesInput', 'labelPositionValue',
      'labelBuiltinInfo', 'labelBuiltinSource', 'labelBuiltinId', 'copyPlaceSection', 'copyPlaceBtn',
      'editorScrollBody', 'editorObjectHeader', 'editorObjectStatus', 'emptyProperties', 'propertyTitle', 'propertyTypeLabel', 'editorTabBtn', 'actionsTabBtn', 'relationTabBtn', 'objectVisibilityBtn', 'objectVisibilityIcon', 'objectLockBtn', 'objectDeleteBtn', 'editorDeleteSection', 'objectActionsMenu',
      'entityProperties', 'entityPeriodInput', 'entityRelations', 'entityParentRows', 'entityChildRows', 'entityChildInput', 'entityChildRow', 'entityAddChildBtn', 'entityChangeParentBtn', 'entityParentInput', 'entityRegionalStatus', 'entityParentRow', 'copyEntityRegionBtn', 'redrawEntityBtn', 'distributionProperties', 'distributionNameInput', 'distributionUnitInput', 'distributionValueScaleInput', 'distributionValueMinInput', 'distributionValueMaxInput', 'distributionColorInput', 'distributionParentInput', 'distributionRenderModeInput', 'distributionEntryList', 'distributionTerritorialUnitInput', 'distributionValueInput', 'addTerritorialDistributionBtn', 'addGeometryDistributionBtn', 'genericFeatureProperties', 'labelProperties', 'hydroProperties',
      'editEntityBorderBtn', 'editEntityCoastBtn', 'reconcileEntityCoastBtn', 'genericFeatureIdInput', 'hydroCategoryValue', 'hydroIdLabel', 'hydroIdValue', 'hydroSystemRow', 'hydroSystemValue', 'hydroTributaryValue', 'hydroSourceValue', 'hydroBuiltinHelp', 'hydroBuiltinNotes', 'hydroBuiltinNotesInput', 'hydroEditFields', 'hydroNameInput', 'hydroColorInput', 'hydroNotesInput', 'copyHydroBtn',
      'undoBtn', 'redoBtn', 'editorSurface',
      'modeMapSummary', 'mapTopContextSlot', 'modeEditingContext', 'modeEditingHud', 'modeTaskWindowContent', 'modeTaskMinimizeBtn', 'modeActionBar', 'modeTaskName', 'modeTaskStage', 'modeTaskStatus', 'modeCancelIcon', 'modePrimaryIcon', 'modeTaskInstruction', 'modeTaskObjects', 'modeTaskDisabledReason', 'modeTaskFeedback', 'modeTaskCandidateFeedback',
      'modeTaskTargetSummary', 'modeTaskEditingStage', 'modeTaskViewTime', 'modeTaskPeriod', 'modeTaskInput', 'modeTaskAffectedSummary', 'modeTaskAffectedList', 'modeReturnBtn', 'modeMethodSwitch', 'modeDirectLineMethodInput', 'modePolygonMethodOption', 'modePolygonMethodInput', 'modeComponentsMethodInput', 'modeRiverBoundaryOption', 'modeRiverBoundaryInput', 'modeDraftActions', 'modeDraftInsertBtn', 'modeDraftDoneBtn', 'modeDraftRedrawBtn', 'modeDraftDeleteBtn', 'geometryPreviewSummary', 'modePrimaryBtn', 'modeCancelBtn',
      'modeTaskResults', 'modeTaskResultsSummary', 'modeTaskResultsList', 'multiDrawnActions', 'multiDrawnAddBtn', 'multiDrawnUndoBtn',
      'multiCountryActions', 'multiBorderEditBtn', 'multiBorderEditHelp',
      'saveProjectBtn', 'openProjectBtn', 'projectFileInput', 'openGisBtn', 'gisFileInput', 'newProjectBtn', 'dataExportBtn', 'preferencesBtn', 'preferencesModal', 'preferencesThemeInput', 'preferencesStatusBarVisibleInput', 'preferencesApplyBtn', 'preferencesResetBtn', 'preferencesCancelBtn', 'helpBtn', 'helpModal', 'helpCloseBtn', 'helpDoneBtn',
      'addEntityBtn', 'createBuildPanel', 'territorialCreateSetup', 'territorialCreateNameLabel', 'territorialCreateNameInput', 'territorialCreateRegionalInput', 'territorialCreateParentInput', 'territorialCreateSourceInput', 'territorialCreateReference', 'territorialCreateReferenceLabel', 'territorialCreateReferenceCount', 'territorialCreateReferenceList',
      'gisCoastReference', 'gisParentUnit', 'gisExportModal', 'gisExportConfirmBtn', 'confirmModalChoiceRow', 'confirmModalChoice',
      'coastReconciliationModal', 'coastReconciliationTitle', 'coastReconciliationMessage', 'coastReconciliationImpact', 'coastReconciliationImpactList', 'coastReconciliationCountryBtn', 'coastReconciliationAdminBtn', 'coastReconciliationIndependentBtn', 'coastReconciliationCancelBtn',
      'objectSearchInput', 'objectSearchClearBtn', 'addFromLibraryBtn', 'territorialLibraryModal', 'territorialLibraryCloseBtn', 'territorialLibrarySearchInput', 'territorialLibrarySearchClearBtn', 'territorialLibraryReferenceDateInput', 'territorialLibraryTimeSuggestBtn', 'territorialLibraryTimePopover', 'territorialLibraryResults', 'territorialLibraryPreview', 'territorialLibraryChildDepthInput', 'territorialLibraryAddBtn',
    ]));

    (CACHE_MISMATCH_MESSAGE = '화면 파일과 스크립트 버전이 다릅니다. 페이지를 강력 새로고침하세요. PC에서는 Ctrl+F5를 사용할 수 있습니다.');

    (deepClone = (obj) => JSON.parse(JSON.stringify(obj)));

    (reliabilityDiagnostic = (0, dependencies.applicationFactories.createDiagnosticLog)({ limit: 250 }));

    window.__PANDOLAB_RELIABILITY_LOG__ = reliabilityDiagnostic;
  }

  function initializeClamp() {
    (clamp = (v, min, max) => Math.max(min, Math.min(max, v)));
  }

  return Object.freeze({
    connect,
    dispose(){
      if(preferencePresentation)preferencePresentation.dispose();
      document.removeEventListener('keydown',enableKeyboardNavigation,true);
      document.removeEventListener('pointerdown',disableKeyboardNavigation,true);
      document.removeEventListener('mousedown',disableKeyboardNavigation,true);
      document.removeEventListener('touchstart',disableKeyboardNavigation,true);
      if(selectController)selectController.closeAll();
      if(tooltipController)tooltipController.hide();
    },
    initializeD3,
    initializeTerritorialGeometry,
    initializeClamp,
    get $() { return $; },
    get APP_VERSION() { return APP_VERSION; },
    get ASSET_REVISION() { return ASSET_REVISION; },
    get AUTOSAVE_DB_NAME() { return AUTOSAVE_DB_NAME; },
    get AUTOSAVE_RECORD_KEY() { return AUTOSAVE_RECORD_KEY; },
    get AUTOSAVE_STORE_NAME() { return AUTOSAVE_STORE_NAME; },
    get AUTOSAVE_VIEW_KEY() { return AUTOSAVE_VIEW_KEY; },
    get BASE_DATASET() { return BASE_DATASET; },
    get COLOR_PALETTE_COLORS() { return COLOR_PALETTE_COLORS; },
    get COLOR_PALETTE_NEUTRALS() { return COLOR_PALETTE_NEUTRALS; },
    get COLOR_PRESETS() { return COLOR_PRESETS; },
    get CUT_ENDPOINT_SNAP_DISTANCE() { return CUT_ENDPOINT_SNAP_DISTANCE; },
    get DATA_REVISION() { return DATA_REVISION; },
    get DEFAULT_GENERIC_FEATURE_COLOR() { return DEFAULT_GENERIC_FEATURE_COLOR; },
    get FLAT_LATITUDE_LIMIT() { return FLAT_LATITUDE_LIMIT; },
    get FLAT_PROJECTION_KIND() { return FLAT_PROJECTION_KIND; },
    get TERRITORIAL_LIBRARY_INDEX_URL() { return TERRITORIAL_LIBRARY_INDEX_URL; },
    get HYDRO_DATASET() { return HYDRO_DATASET; },
    get HYDRO_DATA_VERSION() { return HYDRO_DATA_VERSION; },
    get HYDRO_LAYER_META() { return HYDRO_LAYER_META; },
    get HYDRO_TOOL_CONFIG() { return HYDRO_TOOL_CONFIG; },
    get MAX_HISTORY() { return MAX_HISTORY; },
    get PHYSICAL_DATASET() { return PHYSICAL_DATASET; },
    get PHYSICAL_DATA_BASE_URL() { return PHYSICAL_DATA_BASE_URL; },
    get TERRAIN_RASTER_MANIFEST_URL() { return TERRAIN_RASTER_MANIFEST_URL; },
    get TERRAIN_DEV_DEM_MANIFEST_URL() { return TERRAIN_DEV_DEM_MANIFEST_URL; },
    get TERRAIN_PRIMARY_MANIFEST_URL() { return TERRAIN_PRIMARY_MANIFEST_URL; },
    get TERRAIN_FALLBACK_MANIFEST_URL() { return TERRAIN_FALLBACK_MANIFEST_URL; },
    get TERRAIN_SOURCE_CHOICE() { return TERRAIN_SOURCE_CHOICE; },
    get STORAGE_KEY() { return STORAGE_KEY; },
    get TERRAIN_DATASET() { return TERRAIN_DATASET; },
    get TERRAIN_OCEAN_REPRESENTATIVE() { return TERRAIN_OCEAN_REPRESENTATIVE; },
    get ZOOM_LIMITS() { return ZOOM_LIMITS; },
    get applyUserPreferences() { return preferencePresentation.apply; },
    get assertRuntimeCompatibility() { return assertRuntimeCompatibility; },
    get tooltipController() { return tooltipController; },
    get clamp() { return clamp; },
    get coarsePointer() { return globalThis.matchMedia?.('(pointer: coarse)')?.matches === true; },
    get createEmptyState() { return (...args)=>renderEmptyState(document,...args); },
    get d3() { return d3; },
    get deepClone() { return deepClone; },
    get defaultCountryColor() { return defaultCountryColor; },
    get mapTheme() { return mapTheme; },
    get polygonClipping() { return globalThis.polygonClipping; },
    get reliabilityDiagnostic() { return reliabilityDiagnostic; },
    get resolvedAccentColor() { return preferencePresentation.accent; },
    get resolvedInteractionStyle() { return preferencePresentation.interactionStyle; },
    get runtimeAssetUrl() { return runtimeAssetUrl; },
    get runtimeReady() { return runtimeReady; },
    set runtimeReady(value) { runtimeReady = value; },
    get selectController() { return selectController; },
    get syncSearchClearButton() { return syncSearchClearButton; },
    get systemTheme() { return preferencePresentation.systemTheme; },
    get userPreferences() { return preferencePresentation.current; },
    set userPreferences(value) { preferencePresentation.current = value; },
  });
}
