import {connectMapOwner,createMapReadPorts,mergeCapabilityPorts} from "../../../../shared/frontend/js/modules/map-owner-ports.js";
import {createMapInputPresentation} from "../../../../shared/frontend/js/modules/map-input-presentation.js";
import {workerAssetUrl} from "../../../../shared/frontend/js/modules/worker-asset-url.js";
import {createMapInteractionGate} from "../../../../shared/frontend/js/modules/map-interaction-gate.js";
import {createAtomicMapStateController} from "../../../../shared/frontend/js/modules/map-state-transition.js";
import {createTerritorialEntityStore} from "../../../../shared/frontend/js/modules/territorial-entity-store.js";
import {DATA_READINESS} from "../../../../shared/frontend/js/modules/startup-readiness.js";
import {createMapRenderer,createMapRenderingResources} from "../../../../shared/frontend/js/modules/map-renderer-composition.js";
import {createPhysicalSourceConfiguration,HYDRO_LAYER_META,HYDRO_TOOL_CONFIG,TERRAIN_OCEAN_REPRESENTATIVE,PHYSICAL_DATASET} from "../../../../shared/frontend/js/modules/physical-source-configuration.js";
import {createMapOverlayLayers} from "../../../../shared/frontend/js/modules/map-workspace-host.js";
import {createMapSurfaceHost} from "../../../../shared/frontend/js/modules/map-surface-host.js";
import {createSelectionPass} from "../../../../shared/frontend/js/modules/selection-pass.js";
import {setInteractionStyle as setSelectionInteractionStyle} from "../../../../shared/frontend/js/modules/selection-style.js";
import "../../../../shared/frontend/js/modules/polygon-geometry.js";
import "../../../../shared/frontend/js/modules/polygon-clipping-core.js";
import {MAP_OBJECT_CATEGORIES,MAP_OBJECT_TYPES} from "../../../../shared/frontend/js/modules/map-object-categories.js";
import {DISTRIBUTION_MODES,DISTRIBUTION_RENDER_MODES,distributionEntriesForLayer} from "../../../../shared/frontend/js/modules/distribution-model.js";
import {BASE_DATASET} from "../../../../shared/frontend/js/modules/initial-document.js";
import {createMapObjectSpatialIndex} from "../../../../shared/frontend/js/modules/map-object-spatial-index.js";
import { createObjectQuery } from "../../../../shared/frontend/js/modules/object-query.js";
import { normalizeObjectRef } from "../../../../shared/frontend/js/modules/object-selection-controller.js";
import { COLOR_DOMAINS,readDomainColor,countryDefaultColor,DEFAULT_GENERIC_FEATURE_COLOR } from "../../../../shared/frontend/js/modules/color-adapter.js";
import {createRenderingDomain} from "../../../../shared/frontend/js/modules/rendering-domain.js";
import {createAdaptiveRenderQualityController} from "../../../../shared/frontend/js/modules/adaptive-render-quality.js";
import {createMapDisplayClient} from "../../../../shared/frontend/js/modules/map-display-client.js";
import {OVERLAY_GROUPS} from "../../../../shared/frontend/js/modules/layer-presentation.js";
import {initializeMapReadOwners} from "../../../../shared/frontend/js/modules/map-owner-composition.js";
import {builtinSubunitSourceId} from "../../../../shared/frontend/js/modules/builtin-subunits.js";
import {buildRenderableStrokeFeature} from "../../../../shared/frontend/js/modules/geographic-boundary.js";
import { ZOOM_LIMITS,FLAT_LATITUDE_LIMIT } from "../../../../shared/frontend/js/modules/camera-navigation.js";
import { createMapLayoutMetricsSnapshot, equirectangularCenterForAnchor, DEFAULT_SAFE_INSETS } from "../../../../shared/frontend/js/modules/map-layout-metrics.js";
import { normalizeMapSurfaceDragDelta,MAP_HOST_KINDS } from "../../../../shared/frontend/js/modules/map-host.js";
import { createMapInputController } from "../../../../shared/frontend/js/modules/map-input-controller.js";
import { createMapVisualFrame } from "../../../../shared/frontend/js/modules/map-visual-frame.js";
import { createRenderSceneBuilder } from "../../../../shared/frontend/js/modules/render-scene.js";
import { resolveMapTheme } from "../../../../shared/frontend/js/modules/map-theme.js";
import { createTerritorialEntityRepository } from "../../../../shared/frontend/js/modules/territorial-entity-repository.js";
import { normalizeLayerPresentation } from "../../../../shared/frontend/js/modules/layer-presentation.js";
import { createHydroService, createTerrainService, HYDRO_DATA_VERSION } from "../../../../shared/frontend/js/modules/physical-layer-service.js";
import { fetchWithRetry } from "../../../../shared/frontend/js/modules/reliability-core.js";
import { layoutLabels, automaticLabelSettings, labelKey, LABEL_PRIORITIES } from "../../../../shared/frontend/js/modules/label-layout.js";
import { layerStyle } from "../../../../shared/frontend/js/modules/layer-presentation.js";
import { coordinateBounds } from "../../../../shared/frontend/js/modules/coordinate-bounds.js";
import { createRingHitTester } from "../../../../shared/frontend/js/modules/ring-hit-test.js";
import { layoutTerritorialFlags } from "../../../../shared/frontend/js/modules/territorial-label-flags.js";

/** Viewer presentation adapter to the same GPU/Canvas renderer used by the editor. */
export function createViewerMap({ runtimeContext,owners,element, canvas, labelLayer, projectDomain, documentSession, getPreferences, onError, onPlacesSettled, onStatus,isSafeKoreanErrorMessage,isMobile,diagnostics,getInteractionStyle }) {
  const meta=runtimeContext.meta;
  const d3 = globalThis.d3;
  if (!d3) throw new Error('지도 투영 라이브러리를 불러오지 못했습니다.');
  let renderingDomain=null;
  // The admitted empty document can already display the physical substrate.
  // Historical country data replaces it only after Core accepts that source.
  let session = documentSession, disposed = false;

  const currentZoom=()=>state.projection==='globe'?state.view.globeZoom:state.view.flatZoom;
  let updateGeneration = 0;
  const hitTester=createRingHitTester(globalThis.PandoLabPolygonGeometry.ensureClosedRing);
  let rootGeometryDirty=true;
  let lastFrame=null;

  const {builtinSession,projectSession,renderQuality,pointerTargets,cameraNavigation:navigation,countryIndex,spatialIndex,mapProjection,objectPresentation,hydroSettings:physicalSettings,objectCatalog,territorialLabels:labelOwner,physicalResources,gpuScene,mapHost,objectPicking}=owners;
  const commonPorts=createMapReadPorts(owners);
  mapHost.initializeResolutionQuery();mapHost.initializeMapResizeObserver();
  connectMapOwner('projectSession',projectSession,mergeCapabilityPorts(commonPorts,{readiness:{DATA_READINESS},applicationConstantsA:{DISTRIBUTION_RENDER_MODES},
    modelValidation:{normalizeLayerPresentation},physicalConfig:{PHYSICAL_DATASET},domains:{selectionDomain:documentSession.selectionDomain},
    uiFactoriesA:{createAtomicMapStateController},}));
  projectSession.initializeMapWorkScheduler();
  const state=projectSession.state,mapWorkScheduler=projectSession.mapWorkScheduler;
  const entityStore=createTerritorialEntityStore({documentModel:documentSession.documentModel,commandOwner:documentSession.commandOwner,
    onEntitiesReplaced:(_entities,{rootGeometryChanged})=>{
      spatialIndex.mapObjectGeometryRevisions.territorial++;
      if(rootGeometryChanged){rootGeometryDirty=true;countryIndex.countryLandRevision++;}
    }});
  projectSession.installDocumentProjection({documentModel:documentSession.documentModel,commandOwner:documentSession.commandOwner,entityStore});
  state.countryVisualPhase='canonical';
  const repository=createTerritorialEntityRepository({entityStore});
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

  connectMapOwner('renderQuality',renderQuality,mergeCapabilityPorts(commonPorts,{projectState:{mapWorkScheduler},surfaces:{isMobile},uiFactoriesA:{createAdaptiveRenderQualityController},
    rendering:{get gpuMapRenderer(){return renderer;}},gpuRenderingA:{get renderSceneBuilder(){return gpuScene.renderSceneBuilder;},get selectionPass(){return gpuScene.selectionPass;}},
    hydroModel:{currentMapDevicePixelRatio:physicalSettings.currentMapDevicePixelRatio},
    preferences:{get resolvedInteractionStyle(){return getInteractionStyle();}},selectionServices:{setSelectionInteractionStyle},
    countries:builtinSession,domains:{get renderingDomain(){return renderingDomain;}},feedback:{reportOperationError:onError}}));
  renderQuality.initializeRenderQualityController();renderQuality.initializeGpuRebuildTimer();

  const theme = () => resolveMapTheme({state,theme:document.documentElement.dataset.theme || 'dark'});
  const schedule = () => { if(!disposed&&session&&renderingDomain)renderingDomain.invalidateView('map-view'); };
  Object.defineProperty(state,'projectReplacing',{get:()=>projectDomain.isReplacing()});
  const hydroEditById=physicalSettings.hydroEditById,hydroById=physicalSettings.hydroFeatureById;

  const readPorts={platform:{get polygonClipping(){return globalThis.polygonClipping;}},preferences:{get userPreferences(){return getPreferences();}},projectSession,domains:{projectDomain,get selectionDomain(){return documentSession.selectionDomain;}},projectState:{state},territorialModel:{entityRepository:repository,DISTRIBUTION_MODES},
    colorModel:{COLOR_DOMAINS,readDomainColor,countryDefaultColor,DEFAULT_GENERIC_FEATURE_COLOR,defaultCountryColor:feature=>countryDefaultColor(feature)||theme().defaultLand},
    objectDefinitions:{MAP_OBJECT_CATEGORIES,MAP_OBJECT_TYPES},
    objectPresentation,hydroModel:{hydroFeatureById:hydroById},labelPresentation:commonPorts.labelPresentation,
    hydroPresentation:{HYDRO_LAYER_META,HYDRO_TOOL_CONFIG,hydroEditById,hydroCategoryKey:value=>objectPresentation.hydroCategoryKey(value),hydroDisplayColor:physicalSettings.hydroDisplayColor,
      hydroEditorName:objectPresentation.hydroEditorName,hydroFallbackName:value=>objectPresentation.hydroFallbackName(value),hydroCategoryLabel:value=>objectPresentation.hydroCategoryLabel(value),
},
    distributionPresentation:{distributionColor:layer=>objectPresentation.distributionColor(layer)},
    distributionServices:{distributionEntriesForLayer},
    selectionServices:{normalizeObjectRef},objectLookup:{distributionLayerById:id=>state.distributionLayers.find(layer=>String(layer.id)===String(id))},
    layerPresentation:{ASSET_REVISION:meta.assetRevision,isLayerItemVisible:objectCatalog.isLayerItemVisible,layerGroupNames:{distributions:'분포'}}};
  connectMapOwner('objectPresentation',objectPresentation,mergeCapabilityPorts(commonPorts,readPorts));initializeMapReadOwners(owners,'queries');
  Object.assign(readPorts.colorModel,{territorialEntityColor:objectPresentation.territorialEntityColor,genericFeatureColor:objectPresentation.genericFeatureColor});
  const objectQuery=createObjectQuery(readPorts);
  connectMapOwner('objectCatalog',objectCatalog,mergeCapabilityPorts(commonPorts,readPorts));
  const runtimeAssetUrl = path => {const url=runtimeContext.assetUrl(path);return /\/workers\/[\w-]+-worker\.js$/.test(url.pathname)?workerAssetUrl(url,meta):url;};
  const physicalConfig={...createPhysicalSourceConfiguration({assetBaseUrl:runtimeContext.assetBaseUrl,dataRevision:meta.dataRevision,resourceProfile:meta.resourceProfile}),
    DATA_REVISION:meta.dataRevision,HYDRO_DATA_VERSION,TERRAIN_OCEAN_REPRESENTATIVE,PHYSICAL_DATASET};
  const territorialScope=objectPresentation.territorialScope;
  connectMapOwner('builtinSession',builtinSession,mergeCapabilityPorts(commonPorts,{territorialModel:{entityRepository:repository},objectModelB:{territorialScope},
    objectDefinitions:{builtinSubunitSourceId},applicationServicesB:{layerStyle},platformConfigurationA:{BASE_DATASET},domains:{projectDomain},
    rendering:{get gpuMapRenderer(){return renderer;}},layerPresentation:objectCatalog}));
  builtinSession.initializePristineCountriesFallback();
  connectMapOwner('hydroSettings',physicalSettings,mergeCapabilityPorts(commonPorts,{physicalResources,physicalConfig,preferences:{mapTheme:theme},platform:{$:id=>document.getElementById(id),clamp},
    hydroPresentation:readPorts.hydroPresentation,objectPresentation,layerPresentation:objectCatalog}));
  Object.assign(readPorts.hydroPresentation,{allBuiltInHydroFeatures:physicalSettings.allBuiltInHydroFeatures,
    hydroLayerVisible:physicalSettings.hydroLayerVisible,hydroLineParts:physicalSettings.hydroLineParts});
  connectMapOwner('physicalResources',physicalResources,mergeCapabilityPorts(commonPorts,{physicalConfig,physicalServices:{createHydroService,createTerrainService,fetchWithRetry,},
    hydroPresentation:readPorts.hydroPresentation,platform:{d3},cutGeometry:{coordinateBounds},
    labelPresentation:{currentMapZoom:currentZoom},
    layerPresentation:objectCatalog,domains:{projectDomain,get renderingDomain(){return renderingDomain;},objectSearchController:{render:()=>onPlacesSettled('render')}},
    operationFeedback:{reliabilityDiagnostic:diagnostics},
    rendering:{get gpuMapRenderer(){return renderer;}},feedback:{reportOperationError:onError}}));
  const renderer=createMapRenderer({projectState:{state,mapWorkScheduler},physicalConfig,
    platformConfigurationA:{APP_VERSION:meta.appVersion},layerPresentation:{ASSET_REVISION:meta.assetRevision,isLayerItemVisible:objectCatalog.isLayerItemVisible},
    preferences:{mapTheme:theme,get systemTheme(){return document.documentElement.dataset.theme;}},colorModel:readPorts.colorModel,
    platform:{d3,deepClone:structuredClone,$:id=>document.getElementById(id),runtimeAssetUrl},
    countries:builtinSession,builtinCountries:builtinSession,countryLabelModel:labelOwner,
    territorialModel:{entityRepository:repository},hydroPresentation:readPorts.hydroPresentation,hydroModel:{hydroFeatureById:hydroById},
    physicalResources,physicalServices:{isHydroFeatureVisible:physicalSettings.isHydroFeatureVisible},surfaces:{isMobile},
    readinessUi:{isSafeKoreanErrorMessage},mapHostViewB:{queueMapResize:()=>mapHost.queueMapResize()},
    mapView:{get mapHost(){return mapHost.mapHost;}},domains:{get renderingDomain(){return renderingDomain;}},
    renderQuality,renderScene:{get currentRenderQuality(){return renderQuality.currentRenderQuality;}},
    feedback:{reportOperationError:onError,setActionStatus:onStatus}},{productMode:'viewer'});
  let initialized;
  physicalResources.initializeTerrainService();

  connectMapOwner('mapProjection',mapProjection,mergeCapabilityPorts(commonPorts,{platform:{d3,clamp,$:id=>document.getElementById(id)},surfaces:{isMobile,},
    mapLayout:{createMapLayoutMetricsSnapshot,DEFAULT_SAFE_INSETS},mapLayers:{}}));
  initializeMapReadOwners(owners,'projection');

  connectMapOwner('mapHost',mapHost,mergeCapabilityPorts(commonPorts,{platform:{d3,$:id=>document.getElementById(id),deepClone:structuredClone},mapView:mapProjection,projectionView:mapProjection,
    navigation,workspaceUiB:owners.workspaceSurfaces,mapLayers:{},mapHostCommands:{installSelectionPass:pass=>{gpuScene.selectionPass=pass;}},gpuRenderingA:gpuScene,
    readiness:{reliabilityDiagnostic:diagnostics},preferences:{syncResolvedInteractionStyle:renderQuality.syncResolvedInteractionStyle},
    applicationConstantsA:{MAP_HOST_KINDS},
    platformConfigurationA:{FLAT_PROJECTION_KIND:'equirectangular'},rendering:{gpuMapRenderer:renderer},surfaces:{isMobile},
    mapLayout:{DEFAULT_SAFE_INSETS,},
    domains:{projectDomain,get renderingDomain(){return renderingDomain;}},renderQuality,renderFactories:{createMapVisualFrame,createMapSurfaceHost,createSelectionPass}}));

  connectMapOwner('cameraNavigation',navigation,mergeCapabilityPorts(commonPorts,{platform:{d3,clamp},surfaces:{isMobile},
    mapNavigation:{normalizeMapSurfaceDragDelta,equirectangularCenterForAnchor,FLAT_LATITUDE_LIMIT,ZOOM_LIMITS},
    mapView:{updateProjection:()=>mapProjection.updateProjection(),
      activeProjection:()=>mapProjection.activeProjection(),screenToGeo:point=>mapProjection.screenToGeo(point),projectionLayoutMetrics:()=>mapProjection.projectionLayoutMetrics(),syncMapHostFromState:schedule},
    rendering:{gpuMapRenderer:renderer},objectLookup:objectQuery,physicalData:{HYDRO_LAYER_META:readPorts.hydroPresentation.HYDRO_LAYER_META},
    domains:{get selectionUiController(){return documentSession.selectionUiController;},renderingDomain:{beginInteraction:()=>inputPresentation.beginMovement(),endInteraction:()=>inputPresentation.finishMovement(),invalidateView:schedule}}}));

  connectMapOwner('spatialIndex',spatialIndex,mergeCapabilityPorts(commonPorts,{projectState:{mapWorkScheduler},territorialModel:{entityRepository:repository},cutGeometry:{coordinateBounds},
    mapView:mapProjection,spatialFactories:{createMapObjectSpatialIndex},domains:{get renderingDomain(){return renderingDomain;}},surfaces:{isMobile},rendering:{get selectionPerformanceMetrics(){return selectionPerformanceMetrics;}}}));
  initializeMapReadOwners(owners,'spatial');
  Object.assign(readPorts,{navigation,objectModelB:{territorialScope},countries:{validLabelAnchor:countryIndex.validLabelAnchor,builtinTerritorialScene:builtinSession.builtinTerritorialScene},surfaces:{isMobile},feedback:{setActionStatus:onStatus}});
  const countryPorts={projectState:{state,mapWorkScheduler},platform:{d3,deepClone:structuredClone,runtimeAssetUrl},
    countries:{builtinTerritorialScene:builtinSession.builtinTerritorialScene,territorialLabelFeatureById:builtinSession.territorialLabelFeatureById,
      PRISTINE_LABEL_ANCHORS:builtinSession.PRISTINE_LABEL_ANCHORS},
    objectDisplay:{invalidateObjectPresentation:objectCatalog.invalidateObjectPresentation},mapView:{ringRepresentativePoint:mapProjection.ringRepresentativePoint},
    domains:{get projectDomain(){return projectDomain;},get renderingDomain(){return renderingDomain;}}};
  connectMapOwner('countryIndex',countryIndex,mergeCapabilityPorts(commonPorts,countryPorts));initializeMapReadOwners(owners,'anchors');
  const labelPorts={...countryPorts,territorialModel:{entityRepository:repository},objectModelB:{territorialScope},objectPresentation,
    countries:{...countryPorts.countries,scheduleCountryLabelAnchors:countryIndex.scheduleCountryLabelAnchors},
    mapView:mapProjection,mapHostViewB:{projectionViewSnapshot:mapHost.projectionViewSnapshot},
    layerPresentation:{...readPorts.layerPresentation,isLayerItemVisible:objectCatalog.isLayerItemVisible,isCountryVisibleById:objectCatalog.isCountryVisibleById},
    labelPresentation:{automaticLabelSettings,labelKey,layoutLabels,LABEL_PRIORITIES,layoutTerritorialFlags,buildRenderableStrokeFeature,
      get pendingCountryLabelAnchors(){return countryIndex.pendingCountryLabelAnchors;},get countryLabelAnchors(){return countryIndex.countryLabelAnchors;}},
    preferences:{get userPreferences(){return getPreferences();}},surfaces:{isMobile},renderScene:{get currentRenderQuality(){return renderQuality.currentRenderQuality;}},
    spatialQuery:{geometryBounds:spatialIndex.geometryBounds,visibleMapObjectCandidates:spatialIndex.visibleMapObjectCandidates,viewportCullingMetrics:spatialIndex.viewportCullingMetrics},
    feedback:{reportOperationError:onError},domains:{get renderingDomain(){return renderingDomain;},get projectDomain(){return projectDomain;},
      get selectionDomain(){return documentSession.selectionDomain;},objectSearchController:{cancelSearch:()=>onPlacesSettled('cancel'),render:()=>onPlacesSettled('render')}}};
  connectMapOwner('territorialLabels',labelOwner,mergeCapabilityPorts(commonPorts,labelPorts));initializeMapReadOwners(owners,'labels');
  const places=labelOwner.builtinPlaces;
  const svg=d3.select(labelLayer).attr('class','map-svg map-overlay-svg');
  const {interactionSvg,territorialLabelLayer,labelLayer:userLabelLayer,hydroLakeLayer,hydroRiverLayer,hydroEditLayer,territorialUnitLayer,territorialBoundaryLayer,genericFeatureLayer,distributionLayer,hoverLayer,selectionLayer}=createMapOverlayLayers({map:d3.select(element),svg,productMode:'viewer'});

  const packets={currentGpuInteractionFillItems:[],currentGpuPreviewPackets:[],currentGpuEditPreviewPackets:[],currentGpuDraftPackets:[]};

  connectMapOwner('gpuScene',gpuScene,mergeCapabilityPorts(commonPorts,{renderScene:{createRenderSceneBuilder,OVERLAY_GROUPS,},
    platform:{runtimeAssetUrl},
    rendering:{gpuMapRenderer:renderer},mapLayers:{svg:d3.select(labelLayer)},mapHostViewB:{interactionSvg},interactionPresentation:packets,
    interactionStateCommands:{replaceGpuInteractionFillItems:items=>{packets.currentGpuInteractionFillItems=items;},replaceGpuEditPreviewPackets:items=>{packets.currentGpuEditPreviewPackets=items;},setHoverHit:hit=>{state.hoverHit=hit;}},
    domains:{projectDomain,get selectionDomain(){return documentSession.selectionDomain;},get renderingDomain(){return renderingDomain;}},surfaces:{isMobile},feedback:{reportOperationError:onError},
    selectionServices:{normalizeObjectRef},objectModelB:{territorialScope},presentation:objectPresentation,
    hydroModel:{hydroFeatureById:hydroById},territorialModel:{DISTRIBUTION_MODES},distributionServices:readPorts.distributionServices}));
  gpuScene.initializeSelectionPass();gpuScene.initializeRenderSceneBuilder();gpuScene.initializeGpuSceneDomains();gpuScene.initializeGpuSceneResourceObjectKeys();
  mapHost.attachMapOutput({overlaySvg:svg,gpuCanvas:canvas});
  initialized=Promise.all([renderer.initialize({allowPreview:false}),mapHost.initializeMapHost()]);
  initialized.then(()=>renderingDomain.invalidateProject('map-initialized'))
    .catch(error=>onError(error,'지도 표시를 준비하지 못했습니다.','PL-MAP-INITIALIZE-001'));
  const selectionDomain=documentSession.selectionDomain;
  const selectAt=(point,options={})=>objectPicking.handleObjectSelectionAt(point,{...options,sourceEvent:d3.event}).catch(onError);

  const mapDisplay=createMapDisplayClient({getEntities:territorialScope.displayEntities,getRevision:()=>spatialIndex.mapObjectGeometryRevisions.territorial});
  renderingDomain=createRenderingDomain({gpuMapRenderer:renderer,sceneBuilder:gpuScene.renderSceneBuilder,projectDomain,selectionDomain:selectionDomain,
    mapHost:()=>mapHost.mapHost,
    domLayers:()=>({svg:labelLayer,interactionSvg,gpuCanvas:canvas}),prepareMapDisplay:mapDisplay.prepare,disposeMapDisplay:mapDisplay.dispose,
    ...createMapRenderingResources({session:{selectionDomain,get renderingDomain(){return renderingDomain;},objectSearchController:{cancelSearch:()=>onPlacesSettled('cancel')}},ports:mergeCapabilityPorts(commonPorts,readPorts,{
    domains:{projectDomain,selectionDomain,get renderingDomain(){return renderingDomain;},objectSearchController:{cancelSearch:()=>onPlacesSettled('cancel')}},
    platform:{d3},pointerInteractionA:pointerTargets,objectPicking:{...objectPicking,handleObjectSelectionAt:selectAt},
    gpuRenderingA:gpuScene,gpuRenderingB:gpuScene,spatialRecords:spatialIndex,objectOperationsA:objectQuery,
    preferences:{mapTheme:theme,get resolvedInteractionStyle(){return getInteractionStyle();}},
    objectModelA:{get distributionVisibilityRevision(){return objectPresentation.distributionVisibilityRevision;}},
    rendering:{gpuMapRenderer:renderer},presentation:objectPresentation,
    interactionStateCommands:{setSelectionPacket:packet=>{gpuScene.currentSelectionPacket=packet;}}
  }),layers:{svg,territorialLabelLayer,labelLayer:userLabelLayer,hydroLakeLayer,hydroRiverLayer,hydroEditLayer,territorialUnitLayer,genericFeatureLayer,distributionLayer,territorialBoundaryLayer,selectionLayer,hoverLayer},readStateRevision:()=>state.objectPresentationRevision}),

    interactionResources:{applyGpuInteractionCoverage:gpuScene.applyGpuInteractionCoverage},
    prepareView:options=>{
      state.size={width:Math.max(1,element.clientWidth),height:Math.max(1,element.clientHeight)};
      lastFrame=mapHost.prepareVisualFrame(options);
      renderer.resize(lastFrame);return lastFrame;
    },
    onFrameComplete:mapHost.handleRenderFrameComplete,
    renderers:{view:frame=>renderer.renderFrame(frame),labelLayout:frame=>labelOwner.visibleLabelLayout(frame),objectSearch:()=>onPlacesSettled('render')},
    reportDiagnostic:entry=>diagnostics.push({category:'rendering-domain',...entry}),
  });
  renderQuality.applyAdaptiveRenderQuality();
  function buildScene(){if(!session)return;state.objectPresentationRevision++;objectCatalog.invalidateObjectPresentation();renderingDomain.invalidateProject('document-presentation');}
  async function update() {
    if(!session)return;
    const generation=++updateGeneration;
    state.countryIndex=new Map(entityStore.snapshot().map(feature=>[String(feature.id),feature]));
    const rootFeatures=builtinSession.builtinTerritorialScene().collection.features;
    state.objectPresentationRevision++;
    await initialized;if(generation!==updateGeneration)return;
    buildScene();
    if(rootGeometryDirty||renderer.getRuntimeState().projectRenderBlocked){
      rootGeometryDirty=false;
      try {
        const built=await renderQuality.prepareCanonicalMesh({features:rootFeatures,reason:'document-mesh'});
        if(generation===updateGeneration&&built===false)throw new Error('지도 형상을 표시하지 못했습니다.');
      } catch(error){rootGeometryDirty=true;throw error;}
    }
    if(generation===updateGeneration)schedule();
  }
  const selectionPerformanceMetrics={};

  connectMapOwner('objectPicking',objectPicking,mergeCapabilityPorts(commonPorts,{objectModelB:{territorialScope},platform:{d3,$:id=>document.getElementById(id),clamp},
    selectionServices:{normalizeObjectRef},objectLookup:objectQuery,objectOperationsA:objectQuery,territorialModel:{entityRepository:repository},
    renderScene:{OVERLAY_GROUPS},mapView:mapProjection,
    labelPresentation:{currentMapZoom:currentZoom},cutGeometry:{coordinateBounds},landRelations:{pointInCountryFeature:(coord,feature)=>hitTester.containsGeometry(coord,feature.geometry)},
    spatialRecords:spatialIndex,hydroModel:{hydroFeatureById:hydroById},rendering:{selectionPerformanceMetrics},hydroPresentation:{hydroEditById},surfaces:{isMobile},

    pointerInteractionA:{get hydroAtScreenPoint(){return pointerTargets.hydroAtScreenPoint;}},
    domains:{projectDomain,selectionDomain:selectionDomain,get selectionUiController(){return documentSession.selectionUiController;}},

    feedback:{reportOperationError:onError}}));
  objectPicking.bindChooser();

  connectMapOwner('pointerTargets',pointerTargets,mergeCapabilityPorts(commonPorts,{mapView:mapProjection,objectPicking,physicalResources,
    hydroPresentation:readPorts.hydroPresentation,
    domains:{projectDomain,selectionDomain:selectionDomain},
    layerPresentation:objectCatalog,landRelations:{pointInCountryFeature:(coord,feature)=>hitTester.containsGeometry(coord,feature.geometry)},
    platform:{d3,clamp},surfaces:{isMobile},rendering:{gpuMapRenderer:renderer},feedback:{reportOperationError:onError}}));
  pointerTargets.initializeHoverPickFrame();
  const inputPresentation=createMapInputPresentation({productMode:'viewer',window,navigator,createMapInputController,getRevision:()=>updateGeneration,mapInteractionGate:createMapInteractionGate(),
    ports:mergeCapabilityPorts(commonPorts,{
      platform:{$:id=>document.getElementById(id),d3},rendering:{gpuMapRenderer:renderer},
      domains:{renderingDomain,selectionDomain,projectDomain},navigation,mapView:mapProjection,
      objectPicking,surfaces:{isMobile},feedback:{reportOperationError:onError},
      pointerInteractionA:{cancelCountryHoverPick:pointerTargets.cancelCountryHoverPick,mapNavigationEnabled:()=>!!session&&!state.projectReplacing,
        mapClickBlocked:pointerTargets.mapClickBlocked,queueCountryHoverPick:pointerTargets.queueCountryHoverPick},
      pointerInteractionB:{suppressNextMapClick:pointerTargets.suppressNextMapClick},
      interactionStateCommands:{setHoverHit:hit=>{state.hoverHit=hit;}}
    })});
  inputPresentation.bindSvg(d3.select(element));
  mapHost.startMapResizeObserver();
  return Object.freeze({
    async setSession(next,{view=null,prepareView=null}={}){
      if(next!==documentSession)throw new Error('Map output requires its single document session.');
      session=next;projectSession.setViewingPresentation(view||{},{reset:true});if(prepareView)await prepareView();await update();
    },
    cancelSearch:()=>places.cancelSearch(),update,features:entityStore.snapshot,searchPlaces:query=>places.search(query),renderer,
    loadPhysicalResources:physicalResources.loadPhysicalData,loadPhysicalLandMask:physicalResources.loadPhysicalLandMask,viewState:state,objectPresentation,searchActive:()=>places.isSearchOpen(),
    prepareBuiltinProject:async(month,options)=>{
      const [baseline]=await Promise.all([builtinSession.prepareProjectBaseline(month,options),physicalResources.preparePhysicalContext(month,options)]);
      return {...baseline,setup:{initialMonth:baseline.sourceMonth,timelineRange:null,initialMapBounds:null,sourceMode:'builtin'}};
    },
    placeSelectionReferences:labelOwner.builtinPlaceSelectionReferences,hydroSelectionReferences:physicalResources.builtinHydroSelectionReferences,
    objectPicking,closeObjectChooser:objectPicking.closeObjectChooser,objectCatalog,objectQuery,refreshSelection:()=>renderingDomain.invalidateSelection(),
    capturePresentation:projectSession.captureViewingPresentation,
    physicalSettings:()=>state.physicalSettings,
    entityRepository:repository,
    displayState:()=>({...session?.documentModel.snapshot(),...state,projection:state.projection}),

    applyPresentation:projectSession.applyViewingPresentation,
    distributionPresentation:{bumpVisibilityRevision:()=>{objectPresentation.distributionVisibilityRevision++;}},
    refreshAppearance(options){renderQuality.applyMapAppearanceChange(options);objectCatalog.invalidateObjectPresentation();onPlacesSettled('render');},

    navigation,mapProjection,projectSession,renderingDomain,
    dispose(){disposed=true;entityStore.dispose();renderQuality.cancelGpuMeshRebuild();inputPresentation.dispose();pointerTargets.cancelCountryHoverPick();countryIndex.resetCountryLabelAnchorRuntime();mapHost.stopMapResizeObserver();renderingDomain.dispose();renderer.dispose();gpuScene.renderSceneBuilder.clear();},
  });
}
