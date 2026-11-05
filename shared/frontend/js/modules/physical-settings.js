import {projectResourceOverlay} from './project-resource-overlay.js';
export function hydroLineParts(geometry) {
    if (geometry?.type === 'LineString') return [geometry.coordinates || []];
    if (geometry?.type === 'MultiLineString') return geometry.coordinates || [];
    return [];
  }
/** HydroSettings: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createHydroSettings() {
  let dependencies;
  let authoredHydroRows=null,authoredHydroIndex=null;
  // Accepted C++ hydro views are immutable. Rebuild the derived source
  // reference index only on a new effective historical-document projection.
  function projectHydroResources() {
    const rows=dependencies.projectState.state.hydroEdits||[];
    if(rows!==authoredHydroRows){
      authoredHydroRows=rows;
      authoredHydroIndex=projectResourceOverlay('hydro',rows);
    }
    return authoredHydroIndex;
  }

  function connect(ports) {
    if (dependencies) throw new Error('hydro-settings already connected');
    dependencies = ports;
  }

  function currentMapDevicePixelRatio() {
    const devicePixelRatio = dependencies.mapLayout.mapLayoutMetricsSnapshot?.dpr ?? Math.max(1, Number(window.devicePixelRatio || 1));
    return Math.min((0, dependencies.surfaces.isMobile)() ? 2 : 3, devicePixelRatio);
  }


  function syncRangeProgress(input) {
    if (!input) return;
    const min = Number(input.min || 0);
    const max = Number(input.max || 100);
    const value = Number(input.value || min);
    const progress = max > min ? (0, dependencies.platform.clamp)(((value - min) / (max - min)) * 100, 0, 100) : 0;
    input.style.setProperty('--ui-range-progress', `${progress}%`);
  }

  function terrainModeSettings(mode) {
    if (!['none', 'physical', 'political'].includes(mode)) throw new TypeError(`Unknown terrain mode: ${mode}`);
    const settings = dependencies.projectState.state.physicalSettings;
    return { ...settings, terrainVisible: mode !== 'none', ...(mode === 'none' ? {} : { terrainStyle: mode }) };
  }

  function syncPhysicalControls() {
    const terrainVisible = dependencies.projectState.state.physicalSettings.terrainVisible !== false;
    if ((0, dependencies.platform.$)('terrainNoneRadio')) (0, dependencies.platform.$)('terrainNoneRadio').checked = !terrainVisible;
    if ((0, dependencies.platform.$)('terrainPoliticalRadio')) (0, dependencies.platform.$)('terrainPoliticalRadio').checked = terrainVisible && dependencies.projectState.state.physicalSettings.terrainStyle === 'political';
    if ((0, dependencies.platform.$)('terrainPhysicalRadio')) (0, dependencies.platform.$)('terrainPhysicalRadio').checked = terrainVisible && dependencies.projectState.state.physicalSettings.terrainStyle === 'physical';
  }

  function hydroDisplayColor(_category, gpu = false) {
    const theme = (0, dependencies.preferences.mapTheme)();
    return gpu ? theme.oceanGpu : theme.ocean;
  }

  function hydroEditById(id) {
    const key = String(id);
    return dependencies.projectState.state.hydroEdits.find(feature => String(feature.id) === key) || null;
  }

  function isHydroEditFeature(feature) {
    return !!feature && (feature.properties?.pandolab_domain === 'hydro' || dependencies.projectState.state.hydroEdits.includes(feature));
  }

  function hydroLayerVisible(layerId) {
    const category = (0, dependencies.hydroPresentation.hydroCategoryKey)(dependencies.hydroPresentation.HYDRO_LAYER_META[layerId]?.category);
    return dependencies.projectState.state.layerVisibility[category === 'lake' ? 'lakes' : 'rivers'] !== false
      && dependencies.projectState.state.physicalSettings.hydroLayers?.[layerId] !== false;
  }

  function isHydroFeatureVisible(feature) {
    const id = String(feature?.properties?.pandolab_id || feature?.id || '');
    if(!dependencies.physicalResources.isHydroObjectActive(feature))return false;
    if (isHydroEditFeature(feature)) {
      const category = (0, dependencies.hydroPresentation.hydroCategoryKey)(feature.properties?.category);
      return dependencies.projectState.state.layerVisibility[category === 'lake' ? 'lakes' : 'rivers'] !== false && (0, dependencies.layerPresentation.isLayerItemVisible)('hydro', id);
    }
    if(projectHydroResources().isSourceReplaced(id))
      return false;
    return hydroLayerVisible(feature?.properties?.layer_id) && dependencies.projectState.state.itemVisibility.hydro?.[id]!==false;
  }

  function allBuiltInHydroFeatures() {
    return dependencies.projectState.state.hydroFeatureCache instanceof Map ? [...dependencies.projectState.state.hydroFeatureCache.values()] : [];
  }

  function builtInHydroFeatureById(id) {
    const key = String(id);
    if (dependencies.projectState.state.hydroFeatureCache instanceof Map && dependencies.projectState.state.hydroFeatureCache.has(key)) return dependencies.projectState.state.hydroFeatureCache.get(key);
    for (const feature of allBuiltInHydroFeatures()) {
      if (String(feature.properties?.pandolab_id || feature.id || '') === key) return feature;
    }
    return null;
  }

  function hydroFeatureById(id) {
    const resources=projectHydroResources(),edited=resources.findById(id);
    if(edited)return edited;
    // Retain the source via builtInHydroFeatureById; only the effective
    // presentation/selection is replaced, including raw fragment-key aliases.
    const builtin=builtInHydroFeatureById(id);
    const logicalId=String(builtin?.properties?.pandolab_id||builtin?.id||id);
    return resources.isSourceReplaced(logicalId)?null:builtin;
  }



  return Object.freeze({
    connect,
    hydroLineParts,

    get allBuiltInHydroFeatures() { return allBuiltInHydroFeatures; },
    get builtInHydroFeatureById() { return builtInHydroFeatureById; },
    get currentMapDevicePixelRatio() { return currentMapDevicePixelRatio; },
    get hydroDisplayColor() { return hydroDisplayColor; },
    get hydroEditById() { return hydroEditById; },
    get hydroFeatureById() { return hydroFeatureById; },
    get hydroLayerVisible() { return hydroLayerVisible; },
    get isHydroEditFeature() { return isHydroEditFeature; },
    get isHydroFeatureVisible() { return isHydroFeatureVisible; },
    get syncPhysicalControls() { return syncPhysicalControls; },
    terrainModeSettings,
    get syncRangeProgress() { return syncRangeProgress; },
  });
}
