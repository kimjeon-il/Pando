// One dependency contract for the common owners; no project state is stored here.
export const MAP_OWNER_PORTS=Object.freeze({
  builtinSession:Object.freeze(["domains","platformConfigurationA","objectModelB","applicationServicesA","applicationServicesB","countries","countryRecords","geometryMutation","layerPresentation","objectDefinitions","platform","projectState","rendering","territorialModel"]),
  workspaceSurfaces:Object.freeze(["colorPicker","countryEditingA","domainControllers","mapHostViewB","mapNavigation","platform","platformConfigurationB","projectServices","projectState","taskPresentation","uiFactoriesA","uiFactoriesB","domains"]),
  projectSession:Object.freeze(["domains","applicationConstantsA","applicationFactories","lifecycleUi","modelValidation","physicalConfig","platformConfigurationA","platformConfigurationB","readiness","uiFactoriesA","uiFactoriesB","mapNavigation"]),
  renderQuality:Object.freeze(["feedback","countries","domains","gpuRenderingA","hydroModel","mapView","platformConfigurationB","preferences","projectState","rendering","selectionServices","spatialQuery","surfaces","uiFactoriesA"]),
  pointerTargets:Object.freeze(["countries","domains","draftPresentation","feedback","hydroPresentation","landRelations","layerPresentation","lifecycleUi","mapLayout","mapView","objectOperationsA","objectPicking","physicalResources","physicalServices","platform","projectState","rendering","spatialQuery","surfaces","territorialModel","selectionServices"]),
  cameraNavigation:Object.freeze(["countries","domains","feedback","mapNavigation","mapView","objectLookup","physicalData","platform","projectState","rendering","surfaces"]),
  countryIndex:Object.freeze(["countries","domains","geometryModel","objectDisplay","mapView","platform","projectState","spatialQuery"]),
  spatialIndex:Object.freeze(["objectModelB","countries","countryCommands","cutGeometry","domains","geometryPreview","labels","mapView","platform","presentation","projectState","rendering","spatialFactories","surfaces","territorialModel","territoryGeometry"]),
  mapProjection:Object.freeze(["mapLayers","mapLayout","platform","projectState","surfaces"]),
  objectPresentation:Object.freeze(["colorModel","countries","cutGeometry","domains","objectDefinitions","objectPresentation","platform","projectState","spatialQuery","territorialModel","preferences","projectSession","hydroModel","labelPresentation","hydroPresentation","distributionPresentation","distributionServices","selectionServices","objectLookup","layerPresentation"]),
  hydroSettings:Object.freeze(["physicalResources","colorModel","hydroPresentation","layerPresentation","mapLayout","objectPresentation","physicalConfig","platform","preferences","projectState","surfaces"]),
  objectCatalog:Object.freeze(["projectSession","colorModel","countries","distributionPresentation","domains","hydroPresentation","labelPresentation","layerPresentation","objectDefinitions","objectPresentation","platform","projectState","rendering","territorialModel","preferences","hydroModel","distributionServices","selectionServices","objectLookup"]),
  territorialLabels:Object.freeze(["objectModelB","colorModel","countries","domains","feedback","labelPresentation","layerPresentation","mapLayers","mapLayout","mapView","mapHostViewB","objectDefinitions","objectPresentation","platform","preferences","projectState","renderScene","rendering","spatialQuery","surfaces","territorialModel","objectDisplay"]),
  physicalResources:Object.freeze(["cutGeometry","domains","feedback","hydroPresentation","labelPresentation","layerPresentation","mapView","operationFeedback","physicalConfig","physicalServices","platform","projectState","rendering"]),
  gpuScene:Object.freeze(["feedback","objectModelB","applicationServicesB","countries","distributionServices","domains","geometryOperations","hydroModel","interactionPresentation","interactionStateCommands","mapHostViewB","mapLayers","mapLayout","objectPresentation","platform","presentation","projectState","renderScene","rendering","selectionServices","surfaces","territorialModel"]),
  mapHost:Object.freeze(["applicationConstantsA","domains","gpuRenderingA","hydroModel","lifecycleUi","mapHostCommands","mapLayers","mapLayout","mapView","navigation","platform","platformConfigurationA","preferences","projectState","projectionView","readiness","renderFactories","renderQuality","rendering","surfaces","taskPresentation","workspaceUiB"]),
  objectPicking:Object.freeze(["countries","objectModelB","applicationConstantsA","applicationServicesB","colorModel","countryEditingC","cutGeometry","distributionPresentation","domains","draftPresentation","feedback","genericEditingA","hydroModel","hydroPresentation","labelPresentation","landRelations","layerPresentation","mapLayout","mapView","objectLookup","objectModelA","objectOperationsA","objectPresentation","physicalServices","platform","pointerInteractionA","projectSession","projectState","propertyEditingA","renderScene","renderServices","rendering","selectionServices","spatialRecords","surfaceCommands","surfaces","territorialModel","territorySelectionB","territorySelectionC","workspaceUiA","workspaceUiB"]),
});

export const MAP_OWNER_REQUIRED_PORTS=Object.freeze({
  builtinSession:Object.freeze(["domains","platformConfigurationA","objectModelB","applicationServicesB","layerPresentation","objectDefinitions","projectState","rendering","territorialModel"]),
  workspaceSurfaces:Object.freeze(["mapHostViewB","mapNavigation","platform","platformConfigurationB","projectState","uiFactoriesB","domains"]),
  projectSession:Object.freeze(["domains","applicationConstantsA","modelValidation","physicalConfig","readiness","uiFactoriesA","mapNavigation"]),
  renderQuality:Object.freeze(["feedback","countries","domains","gpuRenderingA","hydroModel","mapView","preferences","projectState","rendering","selectionServices","surfaces","uiFactoriesA"]),
  pointerTargets:Object.freeze(["domains","feedback","hydroPresentation","landRelations","layerPresentation","mapLayout","mapView","objectPicking","physicalResources","physicalServices","platform","projectState","rendering","surfaces"]),
  cameraNavigation:Object.freeze(["countries","domains","mapNavigation","mapView","objectLookup","physicalData","platform","projectState","rendering","surfaces"]),
  countryIndex:Object.freeze(["countries","domains","objectDisplay","mapView","platform","projectState"]),
  spatialIndex:Object.freeze(["cutGeometry","domains","mapView","projectState","rendering","spatialFactories","surfaces","territorialModel"]),
  mapProjection:Object.freeze(["mapLayers","mapLayout","platform","projectState","surfaces"]),
  objectPresentation:Object.freeze(["colorModel","domains","objectDefinitions","objectPresentation","projectState","territorialModel"]),
  hydroSettings:Object.freeze(["physicalResources","hydroPresentation","layerPresentation","mapLayout","objectPresentation","physicalConfig","platform","preferences","projectState"]),
  objectCatalog:Object.freeze(["projectSession","colorModel","distributionPresentation","domains","hydroPresentation","labelPresentation","layerPresentation","objectDefinitions","objectPresentation","projectState","territorialModel"]),
  territorialLabels:Object.freeze(["objectModelB","countries","domains","feedback","labelPresentation","layerPresentation","mapView","mapHostViewB","objectPresentation","platform","preferences","projectState","renderScene","spatialQuery","surfaces","territorialModel"]),
  physicalResources:Object.freeze(["cutGeometry","domains","feedback","hydroPresentation","labelPresentation","layerPresentation","mapView","operationFeedback","physicalConfig","physicalServices","platform","projectState","rendering"]),
  gpuScene:Object.freeze(["feedback","objectModelB","countries","distributionServices","domains","hydroModel","interactionPresentation","interactionStateCommands","mapHostViewB","mapLayers","mapLayout","platform","presentation","projectState","renderScene","rendering","selectionServices","surfaces","territorialModel"]),
  mapHost:Object.freeze(["applicationConstantsA","domains","gpuRenderingA","mapHostCommands","mapLayers","mapLayout","mapView","navigation","platform","platformConfigurationA","preferences","projectState","projectionView","readiness","renderFactories","renderQuality","rendering","surfaces","workspaceUiB"]),
  objectPicking:Object.freeze(["countries","objectModelB","cutGeometry","domains","feedback","hydroModel","hydroPresentation","labelPresentation","landRelations","layerPresentation","mapLayout","mapView","objectLookup","objectOperationsA","physicalServices","platform","pointerInteractionA","projectState","renderScene","rendering","selectionServices","spatialRecords","surfaces","territorialModel"]),
});

export function connectMapOwner(name,owner,ports){
  const allowed=MAP_OWNER_PORTS[name];
  if(!allowed||typeof owner?.connect!=='function')throw new TypeError('Unknown map owner: '+name);
  for(const port of MAP_OWNER_REQUIRED_PORTS[name]){
    const descriptor=Object.getOwnPropertyDescriptor(ports,port);
    if(!descriptor||(!descriptor.get&&descriptor.value==null))throw new TypeError(name+' requires '+port);
  }
  if(name==='objectPicking'){
    const scope=Object.getOwnPropertyDescriptor(ports.objectModelB,'territorialScope');
    if(!scope||(!scope.get&&typeof scope.value?.displayFeature!=='function'))throw new TypeError('objectPicking requires the canonical territorialScope');
  }
  const selected=Object.freeze(Object.defineProperties({},Object.fromEntries(allowed.map(key=>[key,{enumerable:true,get:()=>ports[key]}]))));
  owner.connect(selected);
  return owner;
}

// One explicit source mapping for shared map owners; getters stay live.
const MAP_READ_PORT_SPECS=Object.freeze({
  builtinCountries:Object.freeze([["canonicalCountryStore","builtinSession","canonicalCountryStore"],["freshPristineCountries","builtinSession","freshPristineCountries"],["installCanonicalCountryStore","builtinSession","installCanonicalCountryStore"],["isNativeBuiltinSubunit","builtinSession","isNativeBuiltinSubunit"],["isRenderCountryVisible","builtinSession","isRenderCountryVisible"],["renderCountryBoundaryStyle","builtinSession","renderCountryBoundaryStyle"],["materializePristineCountries","builtinSession","materializePristineCountries"],["materializePristineCountriesSync","builtinSession","materializePristineCountriesSync"],["pristineCountriesFallback","builtinSession","pristineCountriesFallback"],["baseSceneFeatureById","builtinSession","baseSceneFeatureById"],["syncBuiltinPalette","builtinSession","syncBuiltinPalette"]]),
  colorModel:Object.freeze([["genericFeatureColor","objectPresentation","genericFeatureColor"],["territorialEntityColor","objectPresentation","territorialEntityColor"]]),
  countries:Object.freeze([["builtinTerritorialScene","builtinSession","builtinTerritorialScene"],["territorialLabelFeatureById","builtinSession","territorialLabelFeatureById"],["countryLandRevision","countryIndex","countryLandRevision"],["PRISTINE_LABEL_ANCHORS","builtinSession","PRISTINE_LABEL_ANCHORS"],["scheduleCountryLabelAnchors","countryIndex","scheduleCountryLabelAnchors"],["validLabelAnchor","countryIndex","validLabelAnchor"]]),
  countryLabelModel:Object.freeze([["builtinPlaces","territorialLabels","builtinPlaces"],["builtinPlaceSelectionReferences","territorialLabels","builtinPlaceSelectionReferences"],["preparePlaces","territorialLabels","preparePlaces"],["labelById","territorialLabels","labelById"],["countryOutlineFeature","territorialLabels","countryOutlineFeature"],["labelLayoutMetrics","territorialLabels","labelLayoutMetrics"],["renderPendingCountryOverlays","territorialLabels","renderPendingCountryOverlays"],["visibleLabelLayout","territorialLabels","visibleLabelLayout"]]),
  distributionPresentation:Object.freeze([["distributionColor","objectPresentation","distributionColor"]]),
  hydroPresentation:Object.freeze([["allBuiltInHydroFeatures","hydroSettings","allBuiltInHydroFeatures"],["hydroCategoryKey","objectPresentation","hydroCategoryKey"],["hydroCategoryLabel","objectPresentation","hydroCategoryLabel"],["hydroDisplayColor","hydroSettings","hydroDisplayColor"],["hydroEditById","hydroSettings","hydroEditById"],["hydroEditorName","objectPresentation","hydroEditorName"],["hydroFallbackName","objectPresentation","hydroFallbackName"],["hydroLayerVisible","hydroSettings","hydroLayerVisible"],["hydroLineParts","hydroSettings","hydroLineParts"]]),
  labelPresentation:Object.freeze([["labelById","territorialLabels","labelById"],["builtinPlaces","territorialLabels","builtinPlaces"],["countryLabelAnchors","countryIndex","countryLabelAnchors"],["currentMapZoom","territorialLabels","currentMapZoom"],["pendingCountryLabelAnchors","countryIndex","pendingCountryLabelAnchors"]]),
  layerPresentation:Object.freeze([["isCountryVisibleById","objectCatalog","isCountryVisibleById"],["isLayerItemVisible","objectCatalog","isLayerItemVisible"],["LAYER_GROUP_KEYS","objectPresentation","LAYER_GROUP_KEYS"],["layerGroupNames","objectPresentation","layerGroupNames"],["invalidateObjectPresentation","objectCatalog","invalidateObjectPresentation"]]),
  layerResources:Object.freeze([["loadHydroData","physicalResources","loadHydroData"],["preparePlaces","territorialLabels","preparePlaces"]]),
  mapLayout:Object.freeze([["mapLayoutMetricsSnapshot","mapProjection","mapLayoutMetricsSnapshot"],["projectVisibleCoordinate","mapProjection","projectVisibleCoordinate"],["viewRevision","mapHost","viewRevision"]]),
  mapNavigation:Object.freeze([["clampViewZooms","cameraNavigation","clampViewZooms"],["reprojectView","cameraNavigation","reprojectView"]]),
  mapView:Object.freeze([["activeProjection","mapProjection","activeProjection"],["flatProjection","mapProjection","flatProjection"],["globeProjection","mapProjection","globeProjection"],["isCoordVisible","mapProjection","isCoordVisible"],["mapHost","mapHost","mapHost"],["path","mapProjection","path"],["projectionLayoutMetrics","mapProjection","projectionLayoutMetrics"],["ringRepresentativePoint","mapProjection","ringRepresentativePoint"],["screenToGeo","mapProjection","screenToGeo"],["syncMapHostFromState","mapHost","syncMapHostFromState"],["updateProjection","mapProjection","updateProjection"]]),
  objectDisplay:Object.freeze([["invalidateObjectPresentation","objectCatalog","invalidateObjectPresentation"]]),
  objectModelB:Object.freeze([["syncMapObjectCategoryLabels","objectPresentation","syncMapObjectCategoryLabels"],["territorialApplicationService","objectPresentation","territorialApplicationService"],["territorialScope","objectPresentation","territorialScope"],["territorialStyleColor","objectPresentation","territorialStyleColor"]]),
  objectPresentation:Object.freeze([["genericFeatureName","objectPresentation","genericFeatureName"],["genericFeatureRoleLabel","objectPresentation","genericFeatureRoleLabel"],["territorialRootName","objectPresentation","territorialRootName"],["territorialEntityName","objectPresentation","territorialEntityName"]]),
  physicalResources:Object.freeze([["physicalContextState","physicalResources","physicalContextState"],["isHydroObjectActive","physicalResources","isHydroObjectActive"],["loadPhysicalLandMask","physicalResources","loadPhysicalLandMask"],["admitHydroFeatures","physicalResources","admitHydroFeatures"],["builtinHydroSelectionReferences","physicalResources","builtinHydroSelectionReferences"],["hydroEditColor","physicalResources","hydroEditColor"],["hydroFeatureInView","physicalResources","hydroFeatureInView"],["hydroRenderGroups","physicalResources","hydroRenderGroups"],["hydroVisibilityThreshold","physicalResources","hydroVisibilityThreshold"],["loadPhysicalData","physicalResources","loadPhysicalData"],["loadTerrainManifest","physicalResources","loadTerrainManifest"],["prepareHydroFeature","physicalResources","prepareHydroFeature"]]),
  physicalServices:Object.freeze([["isHydroFeatureVisible","hydroSettings","isHydroFeatureVisible"]]),
  presentation:Object.freeze([["genericFeatureDisplayFeature","objectPresentation","genericFeatureDisplayFeature"]]),
  projectState:Object.freeze([["mapWorkScheduler","projectSession","mapWorkScheduler"],["state","projectSession","state"]]),
  projectionView:Object.freeze([["currentMapSafeInsets","mapProjection","currentMapSafeInsets"],["graticule","mapProjection","graticule"],["mapLayoutMetricsRefreshCount","mapProjection","mapLayoutMetricsRefreshCount"],["refreshMapLayoutMetrics","mapProjection","refreshMapLayoutMetrics"],["updatePandoGlobeShell","mapProjection","updatePandoGlobeShell"]]),
  renderQuality:Object.freeze([["prepareCanonicalMesh","renderQuality","prepareCanonicalMesh"],["applyAdaptiveRenderQuality","renderQuality","applyAdaptiveRenderQuality"],["cancelGpuMeshRebuild","renderQuality","cancelGpuMeshRebuild"],["queueAdaptiveRenderQualityRefresh","renderQuality","queueAdaptiveRenderQualityRefresh"],["renderQualityController","renderQuality","renderQualityController"],["scheduleGpuMeshRebuild","renderQuality","scheduleGpuMeshRebuild"]]),
  renderScene:Object.freeze([["currentRenderQuality","renderQuality","currentRenderQuality"],["featureFromGeometry","gpuScene","featureFromGeometry"],["selectionGeometryRevision","gpuScene","selectionGeometryRevision"],["syncGpuInteractionState","gpuScene","syncGpuInteractionState"]]),
  spatialQuery:Object.freeze([["geometryBounds","spatialIndex","geometryBounds"],["mapEditClient","spatialIndex","mapEditClient"],["markCountryGeometriesChanged","spatialIndex","markCountryGeometriesChanged"],["mapObjectGeometryRevisions","spatialIndex","mapObjectGeometryRevisions"],["rebuildSpatialIndex","spatialIndex","rebuildSpatialIndex"],["spatialFeatures","spatialIndex","spatialFeatures"],["viewportCullingMetrics","spatialIndex","viewportCullingMetrics"],["visibleMapObjectCandidates","spatialIndex","visibleMapObjectCandidates"]]),
  surfaces:Object.freeze([["isGenericFeatureDraftTool","workspaceSurfaces","isGenericFeatureDraftTool"],["isMobile","workspaceSurfaces","isMobile"],["isPolygonDraftTool","workspaceSurfaces","isPolygonDraftTool"],["layoutMode","workspaceSurfaces","layoutMode"],["uid","workspaceSurfaces","uid"]]),
});

export function createMapReadPorts(owners){return createReadPorts(owners,MAP_READ_PORT_SPECS);}

export function createReadPorts(providers, specs) {
  return Object.freeze(Object.fromEntries(Object.entries(specs).map(([name, entries]) => {
    const descriptors = Object.fromEntries(entries.map(([alias, provider, field]) => [alias, { enumerable: true, get: () => providers[provider][field] }]));
    return [name, Object.freeze(Object.defineProperties({}, descriptors))];
  })));
}

export function mergeCapabilityPorts(...registries) {
  const descriptorsByPort = new Map();
  for (const registry of registries) {
    for (const [portName, port] of Object.entries(registry)) {
      const descriptors = descriptorsByPort.get(portName) || {};
      Object.assign(descriptors, Object.getOwnPropertyDescriptors(port));
      descriptorsByPort.set(portName, descriptors);
    }
  }
  return Object.freeze(Object.fromEntries([...descriptorsByPort].map(([portName, descriptors]) => [
    portName,
    Object.freeze(Object.defineProperties({}, descriptors)),
  ])));
}
