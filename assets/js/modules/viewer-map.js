import {createMapInputPresentation} from './map-input-presentation.js';
import {workerAssetUrl} from './worker-asset-url.js';
import {createMapInteractionGate} from './map-interaction-gate.js';
import {createAtomicMapStateController} from './map-state-transition.js';
import {createTerritorialEntityStore} from './territorial-entity-store.js';
import {DATA_READINESS} from './startup-readiness.js';
import {createMapRenderer} from './map-renderer-composition.js';
import {createPhysicalSourceConfiguration,HYDRO_LAYER_META,HYDRO_TOOL_CONFIG,TERRAIN_OCEAN_REPRESENTATIVE,PHYSICAL_DATASET} from './physical-source-configuration.js';
import {createMapOverlayLayers} from './map-workspace-host.js';
import {createMapSurfaceHost} from './map-surface-host.js';
import {createSelectionPass} from './selection-pass.js';
import {setInteractionStyle as setSelectionInteractionStyle} from './selection-style.js';
import {buildGraticuleStrokeGeometryPacket} from './graticule-geometry.js';
import './polygon-geometry.js';
import './polygon-clipping-core.js';
import {MAP_OBJECT_CATEGORIES,MAP_OBJECT_TYPES} from './map-object-categories.js';
import {DISTRIBUTION_MODES,DISTRIBUTION_RENDER_MODES,distributionEntriesForLayer} from './distribution-model.js';
import {buildSelectionBoundarySegments} from './selection-stroke-geometry.js';
import {BASE_DATASET} from './initial-document.js';
import {createMapObjectSpatialIndex} from './map-object-spatial-index.js';
import { createObjectQuery } from './object-query.js';
import { normalizeObjectRef } from './object-selection-controller.js';
import { COLOR_DOMAINS,readDomainColor,countryDefaultColor,DEFAULT_GENERIC_FEATURE_COLOR } from './color-adapter.js';
import {createRenderingDomain} from './rendering-domain.js';
import {createAdaptiveRenderQualityController} from './adaptive-render-quality.js';
import {createMapDisplayClient} from './map-display-client.js';
import {geometryRevisionKey} from './geometry-versions.js';
import {OVERLAY_GROUPS} from './layer-presentation.js';
import {createTerritorialScopeResolver} from './territorial-scope.js';
import {builtinSubunitSourceId} from './builtin-subunits.js';
import {buildRenderableStrokeFeature} from './geographic-boundary.js';
import { ZOOM_LIMITS,FLAT_LATITUDE_LIMIT } from './camera-navigation.js';
import { createMapLayoutMetricsSnapshot, equirectangularCenterForAnchor, DEFAULT_SAFE_INSETS } from './map-layout-metrics.js';
import { normalizeMapSurfaceDragDelta,MAP_HOST_KINDS } from './map-host.js';
import { createMapInputController } from './map-input-controller.js';
import { createMapVisualFrame } from './map-visual-frame.js';
import { createRenderSceneBuilder } from './render-scene.js';
import { resolveMapTheme } from './map-theme.js';
import { createTerritorialEntityRepository } from './territorial-entity-repository.js';
import { normalizeLayerPresentation } from './layer-presentation.js';
import { createHydroService, createTerrainService, HYDRO_DATA_VERSION } from './physical-layer-service.js';
import { fetchWithRetry } from './reliability-core.js';
import { layoutLabels, automaticLabelSettings, labelKey, LABEL_PRIORITIES } from './label-layout.js';
import { layerStyle } from './layer-presentation.js';
import { coordinateBounds } from './coordinate-bounds.js';
import { createRingHitTester } from './ring-hit-test.js';
import { layoutTerritorialFlags } from './territorial-label-flags.js';

/** Viewer presentation adapter to the same GPU/Canvas renderer used by the editor. */
export function createViewerMap({ owners,element, canvas, labelLayer, meta, projectDomain, documentSession, getPreferences, onError, onPlacesSettled, onStatus,isSafeKoreanErrorMessage,isMobile,diagnostics,getInteractionStyle }) {
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
  mapHost.initializeResolutionQuery();mapHost.initializeMapResizeObserver();
  projectSession.connect({readiness:{DATA_READINESS},applicationConstantsA:{DISTRIBUTION_RENDER_MODES},
    modelValidation:{normalizeLayerPresentation},physicalConfig:{PHYSICAL_DATASET},domains:{selectionDomain:documentSession.selectionDomain},
    uiFactoriesA:{createAtomicMapStateController},mapNavigation:{get clampViewZooms(){return navigation.clampViewZooms;},get reprojectView(){return navigation.reprojectView;}}});
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



  renderQuality.connect({projectState:{state,mapWorkScheduler},surfaces:{isMobile},uiFactoriesA:{createAdaptiveRenderQualityController},
    rendering:{get gpuMapRenderer(){return renderer;}},gpuRenderingA:{get renderSceneBuilder(){return gpuScene.renderSceneBuilder;},get selectionPass(){return gpuScene.selectionPass;}},
    mapView:{get mapHost(){return mapHost.mapHost;}},hydroModel:{currentMapDevicePixelRatio:physicalSettings.currentMapDevicePixelRatio},
    preferences:{get resolvedInteractionStyle(){return getInteractionStyle();}},selectionServices:{setSelectionInteractionStyle},
    countries:builtinSession,domains:{get renderingDomain(){return renderingDomain;}},feedback:{reportOperationError:onError}});
  renderQuality.initializeRenderQualityController();renderQuality.initializeGpuRebuildTimer();

  const theme = () => resolveMapTheme({state,theme:document.documentElement.dataset.theme || 'dark'});
  const schedule = () => { if(!disposed&&session&&renderingDomain)renderingDomain.invalidateView('map-view'); };
  Object.defineProperty(state,'projectReplacing',{get:()=>projectDomain.isReplacing()});
  const hydroEditById=physicalSettings.hydroEditById,hydroById=physicalSettings.hydroFeatureById;
  const labelById=id=>labelOwner.labelById(id);

  const readPorts={preferences:{get userPreferences(){return getPreferences();}},projectSession,domains:{projectDomain,get selectionDomain(){return documentSession.selectionDomain;}},projectState:{state},territorialModel:{entityRepository:repository,DISTRIBUTION_MODES},
    colorModel:{COLOR_DOMAINS,readDomainColor,countryDefaultColor,DEFAULT_GENERIC_FEATURE_COLOR,defaultCountryColor:feature=>countryDefaultColor(feature)||theme().defaultLand},
    objectDefinitions:{MAP_OBJECT_CATEGORIES,MAP_OBJECT_TYPES},
    objectPresentation,hydroModel:{hydroFeatureById:hydroById},labelPresentation:{labelById,pendingCountryLabelAnchors:new Set(),countryLabelAnchors:new Map()},
    hydroPresentation:{HYDRO_LAYER_META,HYDRO_TOOL_CONFIG,hydroEditById,hydroCategoryKey:value=>objectPresentation.hydroCategoryKey(value),hydroDisplayColor:physicalSettings.hydroDisplayColor,
      hydroEditorName:objectPresentation.hydroEditorName,hydroFallbackName:value=>objectPresentation.hydroFallbackName(value),hydroCategoryLabel:value=>objectPresentation.hydroCategoryLabel(value),
},
    distributionPresentation:{distributionColor:layer=>objectPresentation.distributionColor(layer)},
    distributionServices:{distributionEntriesForLayer},
    selectionServices:{normalizeObjectRef},objectLookup:{distributionLayerById:id=>state.distributionLayers.find(layer=>String(layer.id)===String(id))},
    layerPresentation:{ASSET_REVISION:meta.assetRevision,isLayerItemVisible:objectCatalog.isLayerItemVisible,layerGroupNames:{distributions:'분포'}}};
  objectPresentation.connect(readPorts);objectPresentation.initializeObjectPresentationModel();
  Object.assign(readPorts.colorModel,{territorialEntityColor:objectPresentation.territorialEntityColor,genericFeatureColor:objectPresentation.genericFeatureColor});
  const objectQuery=createObjectQuery(readPorts);
  objectCatalog.connect(readPorts);
  const runtimeAssetUrl = path => {const url=new URL(`../${path}`,import.meta.url);url.searchParams.set('v',meta.assetRevision);return /\/workers\/[\w-]+-worker\.js$/.test(url.pathname)?workerAssetUrl(url,meta):url;};
  const physicalConfig={...createPhysicalSourceConfiguration({assetBaseUrl:new URL('../',import.meta.url),dataRevision:meta.dataRevision,resourceProfile:meta.resourceProfile}),
    DATA_REVISION:meta.dataRevision,HYDRO_DATA_VERSION,TERRAIN_OCEAN_REPRESENTATIVE,PHYSICAL_DATASET};
  const territorialScope=createTerritorialScopeResolver({entityRepository:repository,clipper:()=>globalThis.polygonClipping,getState:()=>state});
  builtinSession.connect({projectState:{state},territorialModel:{entityRepository:repository},objectModelB:{territorialScope},
    objectDefinitions:{builtinSubunitSourceId},applicationServicesB:{layerStyle},platformConfigurationA:{BASE_DATASET},domains:{projectDomain},
    rendering:{get gpuMapRenderer(){return renderer;}},layerPresentation:objectCatalog});
  builtinSession.initializePristineCountriesFallback();
  physicalSettings.connect({projectState:{state},physicalConfig,mapLayout:{get mapLayoutMetricsSnapshot(){return mapProjection.mapLayoutMetricsSnapshot;}},preferences:{mapTheme:theme},platform:{$:id=>document.getElementById(id),clamp},
    hydroPresentation:readPorts.hydroPresentation,objectPresentation,layerPresentation:objectCatalog});
  Object.assign(readPorts.hydroPresentation,{allBuiltInHydroFeatures:physicalSettings.allBuiltInHydroFeatures,
    hydroLayerVisible:physicalSettings.hydroLayerVisible,hydroLineParts:physicalSettings.hydroLineParts});
  physicalResources.connect({projectState:{state},physicalConfig,physicalServices:{createHydroService,createTerrainService,fetchWithRetry,isHydroFeatureVisible:physicalSettings.isHydroFeatureVisible},
    hydroPresentation:readPorts.hydroPresentation,platform:{d3},cutGeometry:{coordinateBounds},
    labelPresentation:{currentMapZoom:currentZoom},mapView:{get flatProjection(){return mapProjection.flatProjection;},get globeProjection(){return mapProjection.globeProjection;}},
    layerPresentation:objectCatalog,domains:{projectDomain,get renderingDomain(){return renderingDomain;},objectSearchController:{render:()=>onPlacesSettled('render')}},
    operationFeedback:{reliabilityDiagnostic:diagnostics},
    rendering:{get gpuMapRenderer(){return renderer;}},feedback:{reportOperationError:onError}});
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

  mapProjection.connect({projectState:{state},platform:{d3,clamp,$:id=>document.getElementById(id)},surfaces:{isMobile,get layoutMode(){return owners.workspaceSurfaces.layoutMode;}},
    mapLayout:{createMapLayoutMetricsSnapshot,DEFAULT_SAFE_INSETS},mapLayers:{}});
  mapProjection.initializeMapLayoutMetricsSnapshot();mapProjection.initializeProjections();

  mapHost.connect({projectState:{state},platform:{d3,$:id=>document.getElementById(id),deepClone:structuredClone},mapView:mapProjection,projectionView:mapProjection,
    navigation,workspaceUiB:owners.workspaceSurfaces,mapLayers:{},mapHostCommands:{installSelectionPass:pass=>{gpuScene.selectionPass=pass;}},gpuRenderingA:gpuScene,
    readiness:{reliabilityDiagnostic:diagnostics},preferences:{syncResolvedInteractionStyle:renderQuality.syncResolvedInteractionStyle},
    applicationConstantsA:{MAP_HOST_KINDS},
    platformConfigurationA:{FLAT_PROJECTION_KIND:'equirectangular'},rendering:{gpuMapRenderer:renderer},surfaces:{isMobile},
    mapLayout:{DEFAULT_SAFE_INSETS,get mapLayoutMetricsSnapshot(){return mapProjection.mapLayoutMetricsSnapshot;}},
    domains:{projectDomain,get renderingDomain(){return renderingDomain;}},renderQuality,renderFactories:{createMapVisualFrame,createMapSurfaceHost,createSelectionPass}});


  navigation.connect({projectState:{state},platform:{d3,clamp},surfaces:{isMobile},countries:{validLabelAnchor:countryIndex.validLabelAnchor},
    mapNavigation:{normalizeMapSurfaceDragDelta,equirectangularCenterForAnchor,FLAT_LATITUDE_LIMIT,ZOOM_LIMITS},
    mapView:{get flatProjection(){return mapProjection.flatProjection;},get path(){return mapProjection.path;},updateProjection:()=>mapProjection.updateProjection(),
      activeProjection:()=>mapProjection.activeProjection(),screenToGeo:point=>mapProjection.screenToGeo(point),projectionLayoutMetrics:()=>mapProjection.projectionLayoutMetrics(),syncMapHostFromState:schedule},
    rendering:{gpuMapRenderer:renderer},objectLookup:objectQuery,physicalData:{HYDRO_LAYER_META:readPorts.hydroPresentation.HYDRO_LAYER_META},
    domains:{get selectionUiController(){return documentSession.selectionUiController;},renderingDomain:{beginInteraction:()=>inputPresentation.beginMovement(),endInteraction:()=>inputPresentation.finishMovement(),invalidateView:schedule}}});

  spatialIndex.connect({projectState:{state,mapWorkScheduler},territorialModel:{entityRepository:repository},cutGeometry:{coordinateBounds},
    mapView:mapProjection,spatialFactories:{createMapObjectSpatialIndex},domains:{get renderingDomain(){return renderingDomain;}},surfaces:{isMobile},rendering:{get selectionPerformanceMetrics(){return selectionPerformanceMetrics;}}});
  spatialIndex.initializeGeometryBoundsCache();spatialIndex.initializeMapObjectSpatialIndex();spatialIndex.initializeViewportCullingMetrics();
  Object.assign(readPorts,{navigation,objectModelB:{territorialScope},countries:{validLabelAnchor:countryIndex.validLabelAnchor,builtinTerritorialScene:builtinSession.builtinTerritorialScene},surfaces:{isMobile},feedback:{setActionStatus:onStatus}});
  const countryPorts={projectState:{state,mapWorkScheduler},platform:{d3,deepClone:structuredClone,runtimeAssetUrl},
    countries:{builtinTerritorialScene:builtinSession.builtinTerritorialScene,territorialLabelFeatureById:builtinSession.territorialLabelFeatureById,
      PRISTINE_LABEL_ANCHORS:builtinSession.PRISTINE_LABEL_ANCHORS},
    objectDisplay:{invalidateObjectPresentation:objectCatalog.invalidateObjectPresentation},mapView:{ringRepresentativePoint:mapProjection.ringRepresentativePoint},
    domains:{get projectDomain(){return projectDomain;},get renderingDomain(){return renderingDomain;}}};
  countryIndex.connect(countryPorts);countryIndex.initializeCountryLandRevision();countryIndex.initializeCountryLabelAnchorWorker();countryIndex.initializeLabelFallbackQueue();
  readPorts.labelPresentation.pendingCountryLabelAnchors=countryIndex.pendingCountryLabelAnchors;readPorts.labelPresentation.countryLabelAnchors=countryIndex.countryLabelAnchors;
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
  labelOwner.connect(labelPorts);labelOwner.initializeCountryOutlineCache();labelOwner.initializeLabelLayoutMetrics();labelOwner.initializeTerritorialLabelScreenAreas();
  const places=labelOwner.builtinPlaces;
  const svg=d3.select(labelLayer).attr('class','map-svg map-overlay-svg');
  const {interactionSvg,territorialLabelLayer,labelLayer:userLabelLayer,hydroLakeLayer,hydroRiverLayer,hydroEditLayer,territorialUnitLayer,territorialBoundaryLayer,genericFeatureLayer,distributionLayer,hoverLayer,selectionLayer}=createMapOverlayLayers({map:d3.select(element),svg,productMode:'viewer'});

  const packets={currentGpuInteractionFillItems:[],currentGpuPreviewPackets:[],currentGpuEditPreviewPackets:[],currentGpuDraftPackets:[]};

  gpuScene.connect({projectState:{state},renderScene:{createRenderSceneBuilder,OVERLAY_GROUPS,get currentRenderQuality(){return renderQuality.currentRenderQuality;}},
    platform:{runtimeAssetUrl},countries:{get countryLandRevision(){return countryIndex.countryLandRevision;}},mapLayout:{get viewRevision(){return mapHost.viewRevision;}},
    rendering:{gpuMapRenderer:renderer},mapLayers:{svg:d3.select(labelLayer)},mapHostViewB:{interactionSvg},interactionPresentation:packets,
    interactionStateCommands:{replaceGpuInteractionFillItems:items=>{packets.currentGpuInteractionFillItems=items;},replaceGpuEditPreviewPackets:items=>{packets.currentGpuEditPreviewPackets=items;},setHoverHit:hit=>{state.hoverHit=hit;}},
    domains:{projectDomain,get selectionDomain(){return documentSession.selectionDomain;},get renderingDomain(){return renderingDomain;}},surfaces:{isMobile},feedback:{reportOperationError:onError},
    selectionServices:{normalizeObjectRef},objectModelB:{territorialScope},presentation:objectPresentation,
    hydroModel:{hydroFeatureById:hydroById},territorialModel:{DISTRIBUTION_MODES},distributionServices:readPorts.distributionServices});
  gpuScene.initializeSelectionPass();gpuScene.initializeRenderSceneBuilder();gpuScene.initializeGpuSceneDomains();gpuScene.initializeGpuSceneResourceObjectKeys();
  mapHost.attachMapOutput({overlaySvg:svg,gpuCanvas:canvas});
  initialized=Promise.all([renderer.initialize({allowPreview:false}),mapHost.initializeMapHost()]);
  initialized.then(()=>renderingDomain.invalidateProject('map-initialized'))
    .catch(error=>onError(error,'지도 표시를 준비하지 못했습니다.','PL-MAP-INITIALIZE-001'));
  const selectionProxy={snapshot:()=>documentSession.selectionDomain.snapshot(),has:ref=>documentSession.selectionDomain.has(ref),createPacket:options=>documentSession.selectionDomain.createPacket(options),setHover:(...args)=>documentSession.selectionDomain.setHover(...args)};
  const selectAt=(point,options={})=>objectPicking.handleObjectSelectionAt(point,{...options,sourceEvent:d3.event}).catch(onError);
  const commonResources={getState:()=>state,d3,svg:svg.node(),layerStyle,normalizeObjectRef,
    isLayerItemVisible:objectCatalog.isLayerItemVisible,selectionHas:selectionProxy.has,selectionSnapshot:()=>selectionProxy.snapshot().selection,
    visibleMapObjectCandidates:spatialIndex.visibleMapObjectCandidates,geometryMayIntersectViewport:spatialIndex.geometryMayIntersectViewport,
    viewportCullingMetrics:spatialIndex.viewportCullingMetrics,mapClickBlocked:pointerTargets.mapClickBlocked,
    handleObjectSelectionAt:selectAt,setMapHover:gpuScene.setMapHover,
    selectionGeometryRevision:gpuScene.selectionGeometryRevision,gpuSceneOrder:gpuScene.gpuSceneOrder,replaceGpuSceneDomain:gpuScene.replaceGpuSceneDomain,buildRenderableStrokeFeature};
  const mapDisplay=createMapDisplayClient({getEntities:territorialScope.displayEntities,getRevision:()=>spatialIndex.mapObjectGeometryRevisions.territorial});
  renderingDomain=createRenderingDomain({gpuMapRenderer:renderer,sceneBuilder:gpuScene.renderSceneBuilder,projectDomain,selectionDomain:selectionProxy,
    mapHost:()=>mapHost.mapHost,
    domLayers:()=>({svg:labelLayer,interactionSvg,gpuCanvas:canvas}),prepareMapDisplay:mapDisplay.prepare,disposeMapDisplay:mapDisplay.dispose,
    labelResources:{...commonResources,svg,territorialLabelLayer,labelLayer:userLabelLayer,isMobile,
      automaticLabelSettings,labelSettings:(state,domain,id)=>state.labelSettings[labelKey(domain,id)]||{},
      countryName:objectPresentation.territorialEntityName,getTerritorialLabelRef:objectPicking.getTerritorialLabelRef,
      countryLabelAnchors:()=>countryIndex.countryLabelAnchors,labelKey,labelById,
      preparePlaces:()=>{labelOwner.preparePlaces().catch(onError);},beginPlaceInteraction:()=>{places.beginInteraction();onPlacesSettled('cancel');},
      handleMapClick:(point,options)=>objectPicking.handleMapClick(point,options)},
    countryResources:{...commonResources,mapTheme:theme,getEntity:repository.get,countryOutlineFeature:labelOwner.countryOutlineFeature,
      gpuMapRenderer:renderer,syncGpuRenderScene:gpuScene.syncGpuRenderScene},
    hydroResources:{...commonResources,hydroLakeLayer,hydroRiverLayer,hydroEditLayer,gpuMapRenderer:renderer,
      isHydroFeatureVisible:physicalSettings.isHydroFeatureVisible,hydroDisplayColor:physicalSettings.hydroDisplayColor,hydroEditColor:physicalResources.hydroEditColor,hydroRenderGroups:physicalResources.hydroRenderGroups},
    territorialResources:{...commonResources,territorialUnitLayer,displayEntities:territorialScope.displayEntities,entityRepository:repository,isNativeBuiltinSubunit:builtinSession.isNativeBuiltinSubunit,syncBuiltinPalette:builtinSession.syncBuiltinPalette},
    genericResources:{...commonResources,genericFeatureLayer,genericFeatureDisplayFeature:objectPresentation.genericFeatureDisplayFeature,genericFeatureColor:objectPresentation.genericFeatureColor},
    distributionResources:{...commonResources,distributionLayer,territorialEntityRepository:repository,featureFromGeometry:gpuScene.featureFromGeometry,
      geometryBounds:spatialIndex.geometryBounds,distributionColor:objectPresentation.distributionColor,DISTRIBUTION_MODES,DISTRIBUTION_RENDER_MODES,
      getCountryGeometryRevision:()=>countryIndex.countryLandRevision,getDistributionVisibilityRevision:()=>objectPresentation.distributionVisibilityRevision},
    territorialBoundaryResources:{...commonResources,territorialBoundaryLayer,getCountryLandRevision:()=>countryIndex.countryLandRevision,getTerritorialGeometryRevision:()=>spatialIndex.mapObjectGeometryRevisions.territorial,
      geometryToken:geometryRevisionKey,territorialEntityColor:objectPresentation.territorialEntityColor,mapTheme:theme},
    baseResources:{getState:()=>state,graticule:mapProjection.graticule,gpuMapRenderer:renderer,
      updatePandoGlobeShell:mapProjection.updatePandoGlobeShell,replaceGpuSceneDomain:gpuScene.replaceGpuSceneDomain,
      buildGraticuleStrokeGeometryPacket,isLightTheme:()=>document.documentElement.dataset.theme==='light'},
    selectionResources:{...commonResources,selectionLayer,hoverLayer,document,isMobile,gpuMapRenderer:renderer,selectionPass:gpuScene.selectionPass,
      resolvedInteractionStyle:getInteractionStyle,territorialEntityById:repository.get,
      territorialDisplayFeature:territorialScope.displayFeature,countryOutlineFeature:labelOwner.countryOutlineFeature,
      mapFeatureForObjectRef:gpuScene.mapFeatureForObjectRef,objectRefVisible:objectQuery.objectRefVisible,buildSelectionBoundarySegments,
      buildGpuInteractionFillItems:gpuScene.buildGpuInteractionFillItems,syncGpuInteractionState:gpuScene.syncGpuInteractionState,
      setCurrentSelectionPacket:packet=>{gpuScene.currentSelectionPacket=packet;},getCurrentSelectionPacket:()=>gpuScene.currentSelectionPacket,
      getCountryLandRevision:()=>countryIndex.countryLandRevision,getStateRevision:()=>state.objectPresentationRevision,getTerritorialBoundaryRevision:()=>renderingDomain.getTerritorialBoundaryStats().revision,getViewRevision:()=>mapHost.viewRevision,getProjection:()=>state.projection},
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
    if(rootGeometryDirty){
      rootGeometryDirty=false;
      try {
        const built=await renderQuality.prepareCanonicalMesh({features:rootFeatures,reason:'document-mesh'});
        if(generation===updateGeneration&&built===false)throw new Error('지도 형상을 표시하지 못했습니다.');
      } catch(error){rootGeometryDirty=true;throw error;}
    }
    if(generation===updateGeneration)schedule();
  }
  const selectionPerformanceMetrics={};

  objectPicking.connect({projectState:{state},objectModelB:objectPresentation,platform:{d3,$:id=>document.getElementById(id),clamp},
    selectionServices:{normalizeObjectRef},objectLookup:objectQuery,objectOperationsA:objectQuery,territorialModel:{entityRepository:repository},
    layerPresentation:{isLayerItemVisible:objectCatalog.isLayerItemVisible},renderScene:{OVERLAY_GROUPS},mapView:mapProjection,
    labelPresentation:{currentMapZoom:currentZoom},cutGeometry:{coordinateBounds},landRelations:{pointInCountryFeature:(coord,feature)=>hitTester.containsGeometry(coord,feature.geometry)},
    spatialRecords:spatialIndex,hydroModel:{hydroFeatureById:hydroById},rendering:{selectionPerformanceMetrics},hydroPresentation:{hydroEditById},surfaces:{isMobile},
    physicalServices:{isHydroFeatureVisible:physicalSettings.isHydroFeatureVisible},
    pointerInteractionA:{get hydroAtScreenPoint(){return pointerTargets.hydroAtScreenPoint;}},
    domains:{projectDomain,selectionDomain:selectionProxy,get selectionUiController(){return documentSession.selectionUiController;}},
    mapLayout:{get viewRevision(){return mapHost.viewRevision;}},countries:{builtinTerritorialScene:builtinSession.builtinTerritorialScene},
    feedback:{reportOperationError:onError}});
  objectPicking.bindChooser();

  pointerTargets.connect({projectState:{state},mapView:mapProjection,objectPicking,physicalResources,
    physicalServices:{isHydroFeatureVisible:physicalSettings.isHydroFeatureVisible},hydroPresentation:readPorts.hydroPresentation,
    mapLayout:{get viewRevision(){return mapHost.viewRevision;}},domains:{projectDomain,selectionDomain:selectionProxy},
    layerPresentation:objectCatalog,landRelations:{pointInCountryFeature:(coord,feature)=>hitTester.containsGeometry(coord,feature.geometry)},
    platform:{d3,clamp},surfaces:{isMobile},rendering:{gpuMapRenderer:renderer},feedback:{reportOperationError:onError}});
  pointerTargets.initializeHoverPickFrame();
  const inputPresentation=createMapInputPresentation({productMode:'viewer',getElement:id=>document.getElementById(id),window,d3,navigator,
    createMapInputController,getInputSnapshot:()=>({moving:state.mapMoving,projectReplacing:state.projectReplacing,tool:state.tool,projection:state.projection,globeZoom:state.view.globeZoom,flatZoom:state.view.flatZoom}),
    setMoving:value=>{state.mapMoving=value;},clearHoverHit:()=>{state.hoverHit=null;},getQualityTier:()=>renderQuality.currentRenderQuality.tier,
    getRevision:()=>updateGeneration,renderQualityController:renderQuality.renderQualityController,mapWorkScheduler,gpuMapRenderer:renderer,
    renderingDomain,selectionDomain:selectionProxy,projectDomain,mapInteractionGate:createMapInteractionGate(),
    applyAdaptiveRenderQuality:renderQuality.applyAdaptiveRenderQuality,queueAdaptiveRenderQualityRefresh:renderQuality.queueAdaptiveRenderQualityRefresh,
    cancelCountryHoverPick:pointerTargets.cancelCountryHoverPick,suppressNextMapClick:pointerTargets.suppressNextMapClick,
    mapNavigationEnabled:()=>!!session&&!state.projectReplacing,dragMapBy:navigation.dragMapBy,transformMapView:navigation.transformMapView,
    zoomBy:navigation.zoomBy,isMobile,handleMapClick:objectPicking.handleMapClick,mapClickBlocked:pointerTargets.mapClickBlocked,
    screenToGeo:mapProjection.screenToGeo,queueCountryHoverPick:pointerTargets.queueCountryHoverPick,getTerritorialLabelRef:objectPicking.getTerritorialLabelRef,reportOperationError:onError});
  inputPresentation.bindSvg(d3.select(element));
  mapHost.startMapResizeObserver();
  return Object.freeze({
    async setSession(next,{view=null,prepareView=null}={}){
      if(next!==documentSession)throw new Error('Map output requires its single document session.');
      session=next;rootGeometryDirty=true;projectSession.setViewingPresentation(view||{},{reset:true});if(prepareView)await prepareView();await update();
    },
    cancelSearch:()=>places.cancelSearch(),update,features:entityStore.snapshot,searchPlaces:query=>places.search(query),renderer,
    loadPhysicalResources:physicalResources.loadPhysicalData,loadPhysicalLandMask:physicalResources.loadPhysicalLandMask,viewState:state,objectPresentation,searchActive:()=>places.isSearchOpen(),
    prepareBuiltinProject:async(month,options)=>{const baseline=await builtinSession.prepareProjectBaseline(month,options);return {...baseline,setup:{initialMonth:baseline.sourceMonth,timelineRange:null,initialMapBounds:null,sourceMode:'builtin'}};},
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
    dispose(){disposed=true;entityStore.dispose();renderQuality.cancelGpuMeshRebuild();inputPresentation.dispose();pointerTargets.cancelCountryHoverPick();places.dispose();countryIndex.resetCountryLabelAnchorRuntime();mapHost.stopMapResizeObserver();renderingDomain.dispose();renderer.dispose();gpuScene.renderSceneBuilder.clear();},
  });
}
