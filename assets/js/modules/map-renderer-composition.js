import {createGpuMapRenderer} from './gpu-map-renderer.js';
import {createTerritorialFillResolver} from './territorial-fill-style.js';
export function createMapRenderer(dependencies) {
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
    return gpuMapRenderer;
  }
