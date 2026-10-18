import { renderLabelText } from './label-text-presentation.js';
import { panCameraView } from './camera-pan.js';
import { createGpuMapRenderer } from './gpu-map-renderer.js';
import { createMapVisualFrame } from './map-visual-frame.js';
import { createRenderSceneBuilder } from './render-scene.js';
import { resolveMapTheme } from './map-theme.js';
import { createTerritorialFillResolver } from './territorial-fill-style.js';
import { createTerritorialEntityRepository } from './territorial-entity-repository.js';
import { normalizeLayerPresentation } from './layer-presentation.js';
import { terrainRasterManifestUrl, selectTerrainManifestUrls, TERRAIN_DEM_VERSION } from './terrain-manifest.js';
import { createHydroService, createTerrainService, HYDRO_DATA_VERSION } from './physical-layer-service.js';
import { fetchWithRetry } from './reliability-core.js';
import { createGpuUploadScheduler } from './gpu-upload-scheduler.js';
import { layoutLabels, placeLabelDimensions, automaticLabelSettings, labelKey } from './label-layout.js';
import { layerStyle, territorialSymbolGroup, territorialSymbolVisibility } from './layer-presentation.js';
import { buildViewerSceneItems } from './viewer-scene-items.js';
import { createViewerPlaces } from './viewer-places.js';
import { geometryHitsScreenPoint } from './geometry-screen-hit.js';
import { coordinateBounds } from './coordinate-bounds.js';
import { createRingHitTester } from './ring-hit-test.js';
import { effectiveTerritorialFlagUrl } from './country-flags.js';
import { layoutTerritorialFlags, territorialLabelFlag } from './territorial-label-flags.js';

/** Viewer presentation adapter to the same GPU/Canvas renderer used by the editor. */
export function createViewerMap({ element, canvas, labelLayer, meta, languages, onSelect, onError }) {
  const d3 = globalThis.d3;
  if (!d3) throw new Error('지도 투영 라이브러리를 불러오지 못했습니다.');
  let session = null, entities = [], rootFeatures=[], featureIndex = new Map(), frameId = 0, scheduled = 0, disposed = false;
  let projectionKind = 'globe', zoom = 1, rotation = [-125, -20, 0], center = [0, 0], selected = null;
  let sceneRevision = 0, updateGeneration = 0;
  let sceneItems={polygons:[],strokes:[],points:[],labels:[],searchItems:[],visibleRootIds:[]};
  let visibleRootIds=new Set();
  const boundsCache=new WeakMap(),centroidCache=new WeakMap(),hitTester=createRingHitTester(ring=>ring);
  let lastFrame=null,lastLabels=[],moving=false,settleTimer=0;
  const centroid=feature=>{
    if(!centroidCache.has(feature.geometry))centroidCache.set(feature.geometry,d3.geo.centroid(feature));
    return centroidCache.get(feature.geometry);
  };
  const visibility = { countries:true,subunits:true,regions:true,rivers:true,lakes:true,genericFeatures:true,labels:true,distributions:true };
  const state = { size:{width:1,height:1}, layerVisibility:visibility, physicalSettings:{terrainVisible:false,terrainStyle:'political'},
    layerPresentation:normalizeLayerPresentation(),itemVisibility:{}, pendingCountryRenderIds:new Set(), hydroEdits:[],
    hydroFeatureCache:new Map(), hydroFeatureByFid:new Map(), hydroFeatureById:new Map(),physicalLoadState:{},
    countryIndex:new Map(), objectPresentationRevision:0, countryVisualPhase:'canonical',
    selectedCountries:new Set(), tool:'select', geometryPreview:{session:null} };
  const repository = createTerritorialEntityRepository({ getEntities:()=>entities });
  const sceneBuilder = createRenderSceneBuilder();
  const theme = () => resolveMapTheme({state,theme:document.documentElement.dataset.theme || 'dark'});
  const roots = () => rootFeatures;
  const visible = feature => {
    const group=feature.properties.entityKind==='regional'?'regions':feature.properties.parentId?'subunits':'countries';
    return visibility[group] && session?.documentModel.snapshot().itemVisibility?.[group]?.[feature.id] !== false;
  };
  const schedule = () => { if (!disposed && !scheduled) scheduled=requestAnimationFrame(draw); };
  const places=createViewerPlaces({getSession:()=>session,assetRevision:meta.assetRevision,onChange:schedule,onError});
  const runtimeAssetUrl = path => new URL(`../${path}`,import.meta.url);
  const dataBase = new URL('../../data/',import.meta.url);
  const rasterManifest = terrainRasterManifestUrl(dataBase,meta.dataRevision);
  const terrainSource = selectTerrainManifestUrls({
    official:new URL(`https://kimjeon-il.github.io/world-map-terrain-v0.13.0/terrain/v${TERRAIN_DEM_VERSION}/manifest.json`),
    raster:rasterManifest,defaultDem:true,
  });
  const renderer = createGpuMapRenderer({
    APP_VERSION:meta.appVersion,ASSET_REVISION:meta.assetRevision,DATA_REVISION:meta.dataRevision,
    PHYSICAL_DATA_BASE_URL:dataBase,TERRAIN_RASTER_MANIFEST_URL:rasterManifest,TERRAIN_PRIMARY_MANIFEST_URL:terrainSource.primary,
    onTerrainSourceChanged:manifest=>{state.terrainManifest=manifest;},d3,deepClone:structuredClone,
    createCountryFillResolver:()=>createTerritorialFillResolver({state,entityRepository:repository,terrainAlpha:theme().countryColorAlpha,
      mapSubstrate:{color:theme().defaultLand,fillAlpha:theme().baseLandAlpha}}),
    baseSceneFeatureById:id=>featureIndex.get(String(id)),countryOutlineFeature:feature=>feature,
    defaultCountryColor:feature=>feature?.properties.style?.color || theme().defaultLand,
    getSystemTheme:()=>document.documentElement.dataset.theme || 'dark',mapTheme:theme,
    hydroDisplayColor:(_category,gpu=false)=>gpu?theme().oceanGpu:theme().ocean,hydroFeatureById:id=>state.hydroFeatureCache.get(String(id)),
    hydroVisibilityThreshold:()=>2.4+Math.log2(Math.max(1,zoom))*2.05,isCountryVisibleById:id=>visibleRootIds.has(String(id)),
    countryBoundaryStyleById:id=>{
      const feature=featureIndex.get(String(id));if(!feature||!visible(feature))return null;
      const style=layerStyle(state.layerPresentation,territorialSymbolGroup(feature),`territorial:entity:${id}`);
      return style.boundaryVisible&&style.opacity>0?style:null;
    },
    renderCountryFeatures:roots,renderCountryBoundaryFeatures:roots,canonicalCountryFeatures:roots,
    isHydroFeatureVisible:feature=>{
      const props=feature.properties,id=String(props.pandolab_id||feature.id);
      const layer=state.hydroManifest?.layers?.find(layer=>layer.id===props.layer_id);
      return visibility[(props.category||layer?.category)==='lake'?'lakes':'rivers']!==false
        &&state.physicalSettings.hydroLayers?.[props.layer_id]!==false&&state.physicalSettings.hiddenHydroIds?.[id]!==true;
    },
    isLayerItemVisible:(group,id)=>state.itemVisibility[group]?.[String(id)]!==false,isMobile:()=>element.clientWidth<800,isSafeKoreanErrorMessage:()=>false,
    mapWorkScheduler:{isInteractionActive:()=>moving},prepareHydroFeature:feature=>feature,
    queueMapResize:schedule,renderViewFrame:schedule,reportOperationError:onError,
    rendererUi:{createCanvas:()=>document.createElement('canvas'),getMapElement:()=>element,
      setEngineStatus:()=>{},onContextStateChange:schedule,requestHostRepaint:schedule},
    runtimeAssetUrl,scheduleGpuFrame:schedule,scheduleGpuInteractionFrame:schedule,
    scheduleGpuMeshRebuild:()=>{update().catch(onError);},setActionStatus:()=>{},state,
  });
  const uploadScheduler=createGpuUploadScheduler({getByteBudget:()=>renderer.getUploadByteBudget()});
  renderer.setUploadScheduler(uploadScheduler);
  renderer.attach(canvas);
  const initialized=renderer.initialize({allowPreview:false});
  const terrain=createTerrainService({fetchWithRetry,manifestUrl:()=>terrainSource.primary,
    fallbackManifestUrl:()=>terrainSource.fallback||rasterManifest,getLoadState:()=>state.physicalLoadState.terrain,
    onLoading:()=>{state.physicalLoadState.terrain='loading';},onRetry:()=>{},
    acceptManifest:(manifest,url,context)=>{state.physicalLoadState.terrain='ready';state.terrainManifest=manifest;
      renderer.setTerrainManifest(manifest,url,{source:context.usedFallback?'fallback':terrainSource.source});schedule();},
    onFailure:error=>{state.physicalLoadState.terrain='error';onError(error);},
  });
  const hydro=createHydroService({fetchWithRetry,dataVersion:HYDRO_DATA_VERSION,
    manifestUrl:()=>new URL(`hydro/v${HYDRO_DATA_VERSION}/manifest.json?v=${meta.dataRevision}`,dataBase),
    getLoadState:()=>state.physicalLoadState.hydro,onLoading:()=>{state.physicalLoadState.hydro='loading';},onRetry:()=>{},
    acceptManifest:async(manifest,url)=>{state.hydroManifest=manifest;const accepted=await renderer.setHydroManifest(manifest,url);
      state.physicalLoadState.hydro=accepted?'ready':'error';schedule();return accepted;},
    onFailure:error=>{state.physicalLoadState.hydro='error';onError(error);},
  });
  let projection=d3.geo.orthographic();
  function draw() {
    scheduled=0;if(disposed)return;
    try {
      const width=Math.max(1,element.clientWidth),height=Math.max(1,element.clientHeight);
      state.size={width,height};
      const scale=(projectionKind==='globe'?Math.min(width,height)*.46:width/(2*Math.PI))*zoom;
      projection=(projectionKind==='globe'?d3.geo.orthographic().rotate(rotation).clipAngle(90):d3.geo.equirectangular().center(center))
        .scale(scale).translate([width/2,height/2]);
      const frame=createMapVisualFrame({frameId:++frameId,viewRevision:frameId,
        viewState:{projection:projectionKind,size:state.size,dpr:renderer.getRenderPixelRatio(),scale,
          translate:[width/2,height/2],rotation,projectionCenter:center},projectCoordinate:coord=>projection(coord),
        projectPath:d3.geo.path().projection(projection),createCanvasPath:context=>d3.geo.path().projection(projection).context(context)});
      renderer.resize(frame);renderer.renderFrame(frame);
      lastFrame=frame;
      const labels=[];
      const project=session?.documentModel.snapshot();
      if(session&&visibility.labels)places.prepare(frame,{zoom,month:session.commandOwner.state().timelineCursor}).catch(onError);
      const flagOptions={zoom,enabled:true,isVisible:feature=>territorialSymbolVisibility(state,territorialSymbolGroup(feature)).flag,
        flagUrl:feature=>effectiveTerritorialFlagUrl(feature,{assetRevision:meta.assetRevision})};
      for(const feature of entities){
        const group=territorialSymbolGroup(feature),objectKey=`territorial:entity:${feature.id}`;
        const style=layerStyle(state.layerPresentation,group,objectKey);
        const nameVisible=style.labelsVisible&&territorialSymbolVisibility(state,group).name;
        const flag=territorialLabelFlag(feature,flagOptions);
        if(!visible(feature)||!feature.geometry||(!nameVisible&&!flag)||project.itemVisibility?.countryLabels?.[feature.id]===false)continue;
        const settings=automaticLabelSettings('country',project.labelSettings[labelKey('territorial',feature.id)]);
        const coordinate=settings.manualPosition||centroid(feature),point=frame.projectVisibleCoordinate(coordinate);
        if(point)labels.push({...settings,id:feature.id,point,text:nameVisible?feature.properties.name||feature.id:'',style,sourceType:'territorial',source:feature,nameVisible,
          ...(!nameVisible?{width:flag.width,height:flag.height}:{})});
      }
      const placeLabels=project?places.labels({state:{...project,layerVisibility:visibility},month:session.commandOwner.state().timelineCursor,languages}):[];
      for(const label of [...sceneItems.labels,...placeLabels]){
        if(zoom<label.minZoom)continue;
        const point=frame.projectVisibleCoordinate(label.coordinate);
        if(point)labels.push({...label,id:label.key,point});
      }
      const placed=layoutLabels(labels.map(row=>({...placeLabelDimensions(row.rows||row.text),...row,key:row.id})),{zoom,bounds:{left:0,top:0,right:width,bottom:height}});
      lastLabels=placed;
      const text=d3.select(labelLayer).selectAll('text').data(placed,row=>row.id);
      text.exit().remove();text.enter().append('text');
      d3.select(labelLayer).selectAll('text')
        .attr('x',row=>row.point[0]).attr('y',row=>row.point[1]).style('opacity',row=>row.style?.opacity??1)
        .each(function(row){renderLabelText(d3.select(this),row.rows||[{text:row.text}],{x:row.point[0]});});
      const flags=layoutTerritorialFlags(placed,flagOptions);
      const flagRows=placed.filter(row=>flags.has(row.id)).map(row=>({...row,flag:flags.get(row.id)}));
      const images=d3.select(labelLayer).selectAll('image').data(flagRows,row=>row.id);
      images.exit().remove();images.enter().append('image');
      d3.select(labelLayer).selectAll('image').attr('href',row=>row.flag.url)
        .attr('x',row=>row.nameVisible?row.point[0]-row.width/2-row.flag.gap-row.flag.width:row.point[0]-row.flag.width/2)
        .attr('y',row=>row.point[1]-row.flag.height/2).attr('width',row=>row.flag.width).attr('height',row=>row.flag.height);
      const points=sceneItems.points.map(row=>({...row,point:frame.projectVisibleCoordinate(row.coordinate)})).filter(row=>row.point);
      const circles=d3.select(labelLayer).selectAll('circle').data(points,row=>row.key);
      circles.exit().remove();circles.enter().append('circle');
      d3.select(labelLayer).selectAll('circle').attr('cx',row=>row.point[0]).attr('cy',row=>row.point[1])
        .attr('r',row=>row.radius).attr('fill','none').attr('stroke',row=>row.style.color)
        .attr('stroke-width',row=>row.style.width).attr('opacity',row=>row.style.alpha??1);
    } catch(error){onError(error);}
  }
  function buildScene() {
    if(!session)return;
    sceneItems=buildViewerSceneItems({documentModel:session.documentModel,state,entityRepository:repository,theme:theme(),selected,
      month:session.commandOwner.state().timelineCursor});
    visibleRootIds=new Set(sceneItems.visibleRootIds);
    const {polygons,strokes}=sceneItems;
    renderer.setRenderScene(sceneBuilder.build({revision:++sceneRevision,revisions:{geometry:sceneRevision,style:sceneRevision},polygons,strokes}));
    renderer.invalidateCountryPalette({base:true,emphasis:true},'viewer-presentation');renderer.invalidateHydroVisibility();schedule();
  }
  async function update() {
    if(!session)return;
    const generation=++updateGeneration;
    entities=session.documentModel.territorialViews();featureIndex=new Map(entities.map(feature=>[String(feature.id),feature]));
    rootFeatures=entities.filter(feature=>feature.properties.entityKind==='general'&&!feature.properties.parentId);
    state.countryIndex=featureIndex;state.objectPresentationRevision++;
    await initialized;if(generation!==updateGeneration)return;
    buildScene();
    const built=await renderer.rebuildFromCountries(roots(),{reason:'viewer-document'});
    if(generation===updateGeneration&&built===false)throw new Error('지도 형상을 표시하지 못했습니다.');
    if(generation===updateGeneration)schedule();
  }
  const beginMotion=()=>{clearTimeout(settleTimer);if(!moving){moving=true;places.beginInteraction();renderer.setHydroInteractionActive(true);}};
  const settleMotion=()=>{clearTimeout(settleTimer);settleTimer=setTimeout(()=>{if(pointers.size)return;moving=false;renderer.setHydroInteractionActive(false);places.settle().catch(onError);schedule();},120);};
  const zoomBy=factor=>{beginMotion();settleMotion();zoom=Math.max(1,Math.min(64,zoom*factor));schedule();};
  const pointers=new Map();let dragDistance=0,pinchDistance=0;
  element.addEventListener('pointerdown',event=>{beginMotion();pointers.set(event.pointerId,[event.clientX,event.clientY]);dragDistance=0;element.setPointerCapture(event.pointerId);});
  element.addEventListener('pointermove',event=>{
    const previous=pointers.get(event.pointerId);if(!previous)return;
    const dx=event.clientX-previous[0],dy=event.clientY-previous[1];pointers.set(event.pointerId,[event.clientX,event.clientY]);dragDistance+=Math.hypot(dx,dy);
    if(pointers.size===2){const [a,b]=[...pointers.values()],distance=Math.hypot(a[0]-b[0],a[1]-b[1]);if(pinchDistance)zoomBy(distance/pinchDistance);pinchDistance=distance;return;}
    panCameraView({globeRotation:rotation,globeZoom:zoom,flatCenter:center},projectionKind,dx,dy,{scale:projection.scale()});schedule();
  });
  element.addEventListener('pointerup',event=>{
    pointers.delete(event.pointerId);pinchDistance=0;settleMotion();
    if(dragDistance>5)return;
    const bounds=element.getBoundingClientRect(),point=[event.clientX-bounds.left,event.clientY-bounds.top];
    const label=lastLabels.find(row=>Math.abs(row.point[0]-point[0])<=row.width/2&&Math.abs(row.point[1]-point[1])<=row.height/2);
    if(label){const feature=label.feature||sceneItems.searchItems.find(feature=>feature.id===(label.source?.id||label.id));if(feature){onSelect(feature);return;}}
    const coord=projection.invert(point);if(!coord||!lastFrame)return;
    const options={project:lastFrame.projectVisibleCoordinate,contains:(coord,feature)=>hitTester.containsGeometry(coord,feature.geometry),coordinateBounds,zoom,boundsCache};
    const overlay=[...sceneItems.searchItems].reverse().find(feature=>feature.group!=='countries'&&geometryHitsScreenPoint(feature.geometry,coord,point,8,options));
    if(overlay){onSelect(overlay);return;}
    const owner=session;
    const selectHydro=async hydro=>{
      if(!hydro||owner!==session)return false;
      const feature=await renderer.loadHydroLogicalFeature(Number(hydro.properties.__logicalFid));
      if(feature&&owner===session)onSelect({...feature,selectionRef:{domain:'hydroBuiltin',type:feature.properties.category,id:feature.properties.pandolab_id}});
      return true;
    };
    if(renderer.getRuntimeState().renderer.startsWith('canvas')){
      renderer.pickHydroAsync(point).then(async hydro=>{
        if(await selectHydro(hydro)||owner!==session)return;
        const country=rootFeatures.find(feature=>visible(feature)&&geometryHitsScreenPoint(feature.geometry,coord,point,8,options));
        if(country)onSelect(country);
      }).catch(onError);return;
    }
    const hydro=renderer.pickHydro(point);
    if(hydro){selectHydro(hydro).catch(onError);return;}
    const id=renderer.pick(point);
    if(id&&featureIndex.has(String(id)))onSelect(featureIndex.get(String(id)));
  });
  element.addEventListener('pointercancel',event=>{pointers.delete(event.pointerId);pinchDistance=0;settleMotion();});
  element.addEventListener('wheel',event=>{event.preventDefault();zoomBy(Math.exp(-event.deltaY*.001));},{passive:false});
  const observer=new ResizeObserver(schedule);observer.observe(element);
  return Object.freeze({
    async setSession(next,{view=null}={}){session=next;selected=view?.selected||null;const project=session.documentModel.snapshot();
      state.layerPresentation=view?.layerPresentation||project.layerPresentation;state.itemVisibility=project.itemVisibility;state.distributionSettings=view?.distributionSettings||project.distributionSettings;
      state.physicalSettings=view?.physicalSettings||{terrainVisible:false,terrainStyle:'political',...project.physicalSettings};
      Object.assign(visibility,view?.visibility||project.layerVisibility);await update();
      await Promise.all([hydro.load(),state.physicalSettings.terrainVisible?terrain.load():Promise.resolve()]);},
    resolvePlace:id=>places.resolve(id,languages),cancelSearch:()=>places.cancelSearch(),update,visibility,features:()=>entities,searchItems:()=>sceneItems.searchItems,searchPlaces:query=>places.search(query,{languages}),renderer,
    selectedFeature:()=>selected,
    capturePresentation:()=>({layerPresentation:structuredClone(state.layerPresentation),distributionSettings:structuredClone(state.distributionSettings),visibility:{...visibility},physicalSettings:structuredClone(state.physicalSettings),selected}),
    clear(){session=null;entities=[];rootFeatures=[];featureIndex=new Map();visibleRootIds=new Set();sceneItems={polygons:[],strokes:[],points:[],labels:[],searchItems:[],visibleRootIds:[]};
      renderer.resetProjectRenderState();schedule();},
    async setTerrain(value){state.physicalSettings={...state.physicalSettings,terrainVisible:value!=='none',terrainStyle:value==='physical'?'physical':'political'};
      buildScene();renderer.invalidatePhysicalStyle('viewer-terrain');if(value!=='none')await terrain.load();},
    physicalSettings:()=>state.physicalSettings,
    entityRepository:repository,
    displayState:()=>({...session?.documentModel.snapshot(),...state,projection:projectionKind}),
    setLanguages(next){languages=next;schedule();},
    async applyPresentation(payload){
      if(payload.action==='visibility')visibility[payload.key]=payload.visible;
      else if(payload.action==='groupStyle')state.layerPresentation=normalizeLayerPresentation({...state.layerPresentation,styles:{...state.layerPresentation.styles,[payload.group]:{...state.layerPresentation.styles[payload.group],...payload.patch}}});
      else {
        const key={distributionRenderMode:'renderMode',distributionActiveLayer:'activeLayerId',distributionBoundaryVisible:'boundaryVisible'}[payload.action];
        if(!key)throw new Error(`Unknown viewing action: ${payload.action}`);
        state.distributionSettings={...state.distributionSettings,[key]:payload.value};
      }
      buildScene();renderer.invalidatePhysicalStyle('view-presentation');
    },
    refreshAppearance(interactionStyle){state.interactionStyle=interactionStyle;buildScene();renderer.invalidatePhysicalStyle('user-preferences');},
    setProjection(value){projectionKind=value;schedule();},zoomBy,
    fit(){zoom=1;center=[0,0];rotation=[-125,-20,0];schedule();},
    async select(feature,{focus=false}={}){
      const owner=session;if(!owner)return false;
      let ref=feature.selectionRef;
      if(!ref){
        const [domain,type,id]=feature.objectKey?feature.objectKey.split(':'):['territorial','entity',feature.id];
        ref={domain,type,id};
      }
      if(ref.domain==='hydroBuiltin')await owner.commandOwner.selectionCatalogLoad('hydroBuiltin',[ref]);
      const result=await owner.commandOwner.selectionApply({action:'replace',ref});
      if(owner!==session)return false;
      selected=result.selection.primary?feature:null;
      if(focus&&feature.geometry){const coord=centroid(feature);rotation=[-coord[0],-coord[1],0];center=coord;zoom=Math.max(zoom,3);}buildScene();return true;
    },
    dispose(){disposed=true;clearTimeout(settleTimer);places.dispose();observer.disconnect();cancelAnimationFrame(scheduled);renderer.dispose();uploadScheduler.dispose();},
  });
}
