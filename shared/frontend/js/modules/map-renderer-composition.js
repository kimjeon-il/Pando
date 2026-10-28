import {layerStyle} from './layer-presentation.js';
import {normalizeObjectRef} from './object-selection-controller.js';
import {automaticLabelSettings,labelKey} from './label-layout.js';
import {buildRenderableStrokeFeature} from './geographic-boundary.js';
import {buildSelectionBoundarySegments} from './selection-stroke-geometry.js';
import {DISTRIBUTION_MODES,DISTRIBUTION_RENDER_MODES} from './distribution-model.js';
import {geometryRevisionKey} from './geometry-versions.js';
import {buildGraticuleStrokeGeometryPacket} from './graticule-geometry.js';
import {createGpuMapRenderer} from './gpu-map-renderer.js';
import {createTerritorialFillResolver} from './territorial-fill-style.js';
export function createMapRenderer(dependencies, { productMode }) {
    if (!['viewer', 'editor'].includes(productMode)) throw new TypeError('Renderer presentation product mode is required.');
    const gpuMapRenderer=createGpuMapRenderer({
      APP_VERSION: dependencies.platformConfigurationA.APP_VERSION,
      ASSET_REVISION: dependencies.layerPresentation.ASSET_REVISION,
      DATA_REVISION: dependencies.physicalConfig.DATA_REVISION,
      sharedBoundaryCacheUrls: globalThis.PANDOLAB_WORLD_SHARED_BOUNDARY_CACHE_URLS || null,
      PHYSICAL_DATA_BASE_URL: dependencies.physicalConfig.PHYSICAL_DATA_BASE_URL,
      TERRAIN_RASTER_MANIFEST_URL: dependencies.physicalConfig.TERRAIN_RASTER_MANIFEST_URL,
      TERRAIN_PRIMARY_MANIFEST_URL: dependencies.physicalConfig.TERRAIN_PRIMARY_MANIFEST_URL,
      onTerrainSourceChanged: manifest => { dependencies.projectState.state.terrainManifest = manifest; },
      createCountryFillResolver: () => {
        const resolve = createTerritorialFillResolver({ state: dependencies.projectState.state,
          entityRepository: dependencies.territorialModel.entityRepository,
          terrainAlpha: dependencies.preferences.mapTheme().countryColorAlpha });
        const nativeUnits = dependencies.countries.builtinTerritorialScene().nativeUnits;
        return feature => resolve((feature.properties?.entityKind === 'general' && !!feature.properties?.parentId)
          ? nativeUnits.get(String(feature.id)) || feature : feature);
      },
      baseSceneFeatureById: dependencies.builtinCountries.baseSceneFeatureById,
      countryOutlineFeature: dependencies.countryLabelModel.countryOutlineFeature,
      d3: dependencies.platform.d3,
      deepClone: dependencies.platform.deepClone,
      defaultCountryColor: dependencies.colorModel.defaultCountryColor,
      getSystemTheme: () => document.documentElement.dataset.theme || window.__PANDOLAB_THEME__ || dependencies.preferences.systemTheme,
      hydroDisplayColor: dependencies.hydroPresentation.hydroDisplayColor,
      hydroFeatureById: dependencies.hydroModel.hydroFeatureById,
      hydroVisibilityThreshold: dependencies.physicalResources.hydroVisibilityThreshold,
      isCountryVisibleById: dependencies.builtinCountries.isRenderCountryVisible,
      renderCountryFeatures: () => dependencies.countries.builtinTerritorialScene().collection.features,
      renderCountryBoundaryFeatures: () => dependencies.countries.builtinTerritorialScene().boundaryCollection.features,
      countryBoundaryStyleById: dependencies.builtinCountries.renderCountryBoundaryStyle,
      canonicalCountryFeatures: () => dependencies.countries.builtinTerritorialScene({ canonical: true }).collection.features,
      isHydroFeatureVisible: dependencies.physicalServices.isHydroFeatureVisible,
      isLayerItemVisible: dependencies.layerPresentation.isLayerItemVisible,
      isMobile: dependencies.surfaces.isMobile,
      isSafeKoreanErrorMessage: dependencies.readinessUi.isSafeKoreanErrorMessage,
      mapTheme: dependencies.preferences.mapTheme,
      mapWorkScheduler: dependencies.projectState.mapWorkScheduler,
      prepareHydroFeature: dependencies.physicalResources.prepareHydroFeature,
      queueMapResize: dependencies.mapHostViewB.queueMapResize,
      renderViewFrame: () => dependencies.domains.renderingDomain?.invalidateView?.('render-view') || false,
      reportOperationError: dependencies.feedback.reportOperationError,
      rendererUi: {
        createCanvas: () => document.createElement('canvas'),
        getMapElement: () => (0, dependencies.platform.$)('map'),
        setEngineStatus: text => {
          (window.__PANDOLAB_STARTUP_METRICS__ ||= {}).rendererStatus = text;
        },
        setMapPreparationStatus: presentation => {
          const label = dependencies.platform.$('mapPreparationStatus');
          const retry = dependencies.platform.$('mapPreparationRetry');
          const text = productMode === 'viewer' ? presentation.label.replace('현재 화면 ', '').replace('준비 실패', '불러오기 실패') : presentation.label;
          if (label && label.textContent !== text) label.textContent = text;
          if (productMode === 'viewer') dependencies.platform.$('mapPreparationNotice').hidden = presentation.status !== 'error';
          if (retry) retry.hidden = !presentation.retry;
        },
        onContextStateChange: phase => dependencies.domains.renderingDomain?.invalidateGpuContext?.(phase) || false,
        requestHostRepaint: reason => dependencies.mapView.mapHost?.requestRepaint?.(reason) || false,
      },
      runtimeAssetUrl: dependencies.platform.runtimeAssetUrl,
      scheduleGpuFrame: reason => dependencies.domains.renderingDomain?.invalidateGpuFrame?.(reason) || false,
      scheduleGpuInteractionFrame: reason => dependencies.domains.renderingDomain?.invalidateGpuInteraction?.(reason) || false,
      scheduleGpuMeshRebuild: dependencies.renderQuality.scheduleGpuMeshRebuild,
      setActionStatus: dependencies.feedback.setActionStatus,
      state: dependencies.projectState.state,
    });

    gpuMapRenderer.setRenderQuality?.(dependencies.renderScene.currentRenderQuality);
    const retry = dependencies.platform.$('mapPreparationRetry');
    if (retry) retry.onclick = () => gpuMapRenderer.retryMapPreparation();
    return gpuMapRenderer;
  }

/** Shared frame resource wiring. Document and geometry ownership stay in their existing domains. */
export function createMapRenderingResources({ports,layers,session,editing=null,readStateRevision=()=>ports.projectState.state.stateRevision,document=globalThis.document}){
  if(!session?.selectionDomain)throw new TypeError('Map rendering resources require the canonical selection session.');
  const resources=Object.create(null);let lastFrame;
  function snapshot(name,values,live){
    const resource={...values},extension=editing?.[name];
    const refresh=()=>{for(const [key,read]of Object.entries(live))resource[key]=read();if(extension)Object.assign(resource,extension);};
    resources[name]={resource,refresh};refresh();return resource;
  }
  const common={
    getState: () => ports.projectState.state,
    layerStyle: layerStyle,
    visibleMapObjectCandidates: ports.spatialQuery.visibleMapObjectCandidates,
    geometryMayIntersectViewport: ports.spatialRecords.geometryMayIntersectViewport,
    normalizeObjectRef: normalizeObjectRef,
    selectionHas: ref => session.selectionDomain.has(ref),
    viewportCullingMetrics: ports.spatialQuery.viewportCullingMetrics,
    setMapHover: ports.gpuRenderingA.setMapHover,
    mapClickBlocked: ports.pointerInteractionA.mapClickBlocked,
    d3: ports.platform.d3,
    handleObjectSelectionAt: ports.objectPicking.handleObjectSelectionAt,
    buildRenderableStrokeFeature: buildRenderableStrokeFeature
  };
  const result={
    labelResources:snapshot("labelResources", {
      d3: ports.platform.d3,
      getState: () => ports.projectState.state,
      preparePlaces: ports.countryLabelModel.preparePlaces,
      beginPlaceInteraction: () => { ports.countryLabelModel.builtinPlaces.beginInteraction(); session.objectSearchController.cancelSearch(); },
      disposePlaces: () => ports.countryLabelModel.builtinPlaces.dispose(),
      mapClickBlocked: ports.pointerInteractionA.mapClickBlocked,
      handleObjectSelectionAt: ports.objectPicking.handleObjectSelectionAt,
      handleMapClick: ports.objectPicking.handleMapClick,
      getTerritorialLabelRef: ports.objectPicking.getTerritorialLabelRef,
      countryName: ports.objectPresentation.territorialEntityName,
      layerStyle,
      isMobile: ports.surfaces.isMobile,
      automaticLabelSettings,
      labelSettings: (currentState, domain, id) => currentState.labelSettings?.[(0, labelKey)(domain, id)] || {},
      labelById: ports.countryLabelModel.labelById,
      labelKey,
      countryLabelAnchors: () => ports.labelPresentation.countryLabelAnchors,
      normalizeObjectRef,
      selectionSnapshot: () => session.selectionDomain.snapshot().selection,
      selectionHas: ref => session.selectionDomain.has(ref)
    }, {
      territorialLabelLayer: () => layers.territorialLabelLayer,
      labelLayer: () => layers.labelLayer,
      svg: () => layers.svg
    }),
    countryResources:snapshot("countryResources", {
      getState: () => ports.projectState.state,
      getViewRevision: () => ports.mapLayout.viewRevision,
      countryOutlineFeature: ports.countryLabelModel.countryOutlineFeature,
      getEntity: ports.territorialModel.entityRepository.get,
      isLayerItemVisible: ports.layerPresentation.isLayerItemVisible,
      selectionGeometryRevision: ports.renderScene.selectionGeometryRevision,
      mapTheme: ports.preferences.mapTheme,
      resolvedInteractionStyle: () => ports.preferences.resolvedInteractionStyle,
      replaceGpuSceneDomain: ports.gpuRenderingA.replaceGpuSceneDomain,
      syncGpuRenderScene: ports.gpuRenderingB.syncGpuRenderScene,
      gpuMapRenderer: ports.rendering.gpuMapRenderer,
      applyGpuSceneCoverage: ports.gpuRenderingA.applyGpuSceneCoverage,
      applyGpuInteractionCoverage: ports.gpuRenderingA.applyGpuInteractionCoverage
    }, {
      countryLayer: () => layers.countryLayer
    }),
    hydroResources:snapshot("hydroResources", {
      ...common,
      getStateRevision: readStateRevision,
      gpuMapRenderer: ports.rendering.gpuMapRenderer,
      hydroRenderGroups: ports.physicalResources.hydroRenderGroups,
      hydroDisplayColor: ports.hydroPresentation.hydroDisplayColor,
      hydroEditColor: ports.physicalResources.hydroEditColor,
      isHydroFeatureVisible: ports.physicalServices.isHydroFeatureVisible
    }, {
      hydroLakeLayer: () => layers.hydroLakeLayer,
      hydroRiverLayer: () => layers.hydroRiverLayer,
      hydroEditLayer: () => layers.hydroEditLayer,
      svg: () => layers.svg?.node?.() || layers.svg
    }),
    territorialResources:snapshot("territorialResources", {
      ...common,
      displayEntities: () => ports.objectModelB.territorialScope.displayEntities(),
      entityRepository: ports.territorialModel.entityRepository,
      isNativeBuiltinSubunit: ports.builtinCountries.isNativeBuiltinSubunit,
      syncBuiltinPalette: ports.builtinCountries.syncBuiltinPalette,
      isLayerItemVisible: ports.layerPresentation.isLayerItemVisible,
      territorialStyleColor: ports.objectModelB.territorialStyleColor,
      territorialEntityColor: ports.colorModel.territorialEntityColor,
      selectionGeometryRevision: ports.renderScene.selectionGeometryRevision,
      gpuSceneOrder: ports.gpuRenderingA.gpuSceneOrder,
      resolvedInteractionStyle: () => ports.preferences.resolvedInteractionStyle,
      replaceGpuSceneDomain: ports.gpuRenderingA.replaceGpuSceneDomain
    }, {
      territorialUnitLayer: () => layers.territorialUnitLayer,
      svg: () => layers.svg?.node?.() || layers.svg
    }),
    genericResources:snapshot("genericResources", {
      ...common,
      genericFeatureDisplayFeature: ports.presentation.genericFeatureDisplayFeature,
      genericFeatureColor: ports.colorModel.genericFeatureColor,
      isLayerItemVisible: ports.layerPresentation.isLayerItemVisible,
      selectionSnapshot: () => session.selectionDomain.snapshot().selection,
      selectionGeometryRevision: ports.renderScene.selectionGeometryRevision,
      gpuSceneOrder: ports.gpuRenderingA.gpuSceneOrder,
      resolvedInteractionStyle: () => ports.preferences.resolvedInteractionStyle,
      replaceGpuSceneDomain: ports.gpuRenderingA.replaceGpuSceneDomain
    }, {
      genericFeatureLayer: () => layers.genericFeatureLayer,
      svg: () => layers.svg?.node?.() || layers.svg
    }),
    distributionResources:snapshot("distributionResources", {
      ...common,
      distributionEntriesForLayer: ports.distributionServices.distributionEntriesForLayer,
      territorialEntityRepository: ports.territorialModel.entityRepository,
      featureFromGeometry: ports.renderScene.featureFromGeometry,
      geometryBounds: ports.spatialQuery.geometryBounds,
      distributionColor: ports.distributionPresentation.distributionColor,
      DISTRIBUTION_MODES,
      DISTRIBUTION_RENDER_MODES,
      isLayerItemVisible: ports.layerPresentation.isLayerItemVisible,
      selectionGeometryRevision: ports.renderScene.selectionGeometryRevision,
      gpuSceneOrder: ports.gpuRenderingA.gpuSceneOrder,
      replaceGpuSceneDomain: ports.gpuRenderingA.replaceGpuSceneDomain,
      getCountryGeometryRevision: () => ports.countries.countryLandRevision,
      getDistributionVisibilityRevision: () => ports.objectModelA.distributionVisibilityRevision
    }, {
      distributionLayer: () => layers.distributionLayer,
      svg: () => layers.svg?.node?.() || layers.svg
    }),
    territorialBoundaryResources:snapshot("territorialBoundaryResources", {
      getState: () => ports.projectState.state,
      getCountryLandRevision: () => ports.countries.countryLandRevision,
      getTerritorialGeometryRevision: () => ports.spatialQuery.mapObjectGeometryRevisions.territorial,
      geometryToken: geometry => geometryRevisionKey(geometry),
      territorialEntityColor: ports.colorModel.territorialEntityColor,
      layerStyle,
      mapTheme: ports.preferences.mapTheme,
      replaceGpuSceneDomain: ports.gpuRenderingA.replaceGpuSceneDomain,
      gpuSceneOrder: ports.gpuRenderingA.gpuSceneOrder
    }, {
      territorialBoundaryLayer: () => layers.territorialBoundaryLayer
    }),
    baseResources:snapshot("baseResources", {
      getState: () => ports.projectState.state,
      updatePandoGlobeShell: ports.projectionView.updatePandoGlobeShell,
      graticule: ports.projectionView.graticule,
      gpuMapRenderer: ports.rendering.gpuMapRenderer,
      replaceGpuSceneDomain: ports.gpuRenderingA.replaceGpuSceneDomain,
      buildGraticuleStrokeGeometryPacket,
      isLightTheme: () => (document.documentElement.dataset.theme || window.__PANDOLAB_THEME__ || ports.preferences.systemTheme) === 'light'
    }, {

    }),
    selectionResources:snapshot("selectionResources", {
      getState: () => ports.projectState.state,
      d3: ports.platform.d3,
      document,
      resolvedInteractionStyle: () => ports.preferences.resolvedInteractionStyle,
      territorialDisplayFeature: value => ports.objectModelB.territorialScope.displayFeature(value),
      countryOutlineFeature: ports.countryLabelModel.countryOutlineFeature,
      mapFeatureForObjectRef: ports.gpuRenderingA.mapFeatureForObjectRef,
      objectRefVisible: ports.objectOperationsA.objectRefVisible,
      territorialEntityById: id => ports.territorialModel.entityRepository.get(id),
      selectionGeometryRevision: ports.renderScene.selectionGeometryRevision,
      buildRenderableStrokeFeature,
      buildSelectionBoundarySegments,
      getCountryLandRevision: () => ports.countries.countryLandRevision,
      getStateRevision: readStateRevision,
      getTerritorialBoundaryRevision: () => session.renderingDomain?.getTerritorialBoundaryStats?.().revision || '',
      getViewRevision: () => ports.mapLayout.viewRevision,
      getProjection: () => ports.projectState.state.projection,
      isMobile: ports.surfaces.isMobile,
      gpuMapRenderer: ports.rendering.gpuMapRenderer,
      buildGpuInteractionFillItems: ports.gpuRenderingA.buildGpuInteractionFillItems,
      syncGpuInteractionState: ports.renderScene.syncGpuInteractionState,
      setCurrentSelectionPacket: packet => { ports.interactionStateCommands.setSelectionPacket(packet || null); },
      getCurrentSelectionPacket: () => ports.gpuRenderingA.currentSelectionPacket
    }, {
      selectionLayer: () => layers.selectionLayer,
      hoverLayer: () => layers.hoverLayer,
      selectionPass: () => ports.gpuRenderingA.selectionPass
    })
  };
  for(const name of Object.keys(editing||{}))if(!Object.hasOwn(result,name))result[name]=snapshot(name,{},{});
  return {...result,refreshRenderResources(frameId){
      if(frameId!=null&&frameId===lastFrame)return lastFrame;
      for(const {refresh}of Object.values(resources))refresh();lastFrame=frameId;return lastFrame;
    }};
}
