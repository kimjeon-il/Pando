import {createStoredAssetLoader} from './stored-asset-loader.js';

// Raw, project-pinned physical asset bytes are owned outside the renderer.
// This service has no map, GPU, C++ timeline or object-selection dependencies.
export function createPhysicalAssetReader({
  buildMeta,resolveBaseUrl,onLandReady=()=>{},createLoader=createStoredAssetLoader,
}={}){
  if(!buildMeta||typeof resolveBaseUrl!=='function')
    throw new TypeError('Physical asset reader requires build metadata and a source base URL');
  let loader=null,physicalLand=null,landLoading=null,initialPreview=null,initialPreviewLoading=null;
  const storedPhysicalAssets=()=>{
    if(!loader)loader=createLoader({dataRevision:buildMeta.dataRevision,
      resolveUrl:spec=>new URL(spec.url.replace(/^assets\/data\//,''),resolveBaseUrl()).href});
    return loader;
  };
  const decodeGeometry=(buffer,label)=>{
    const geometry=JSON.parse(new TextDecoder().decode(buffer));
    if(geometry?.type!=='MultiPolygon'||!Array.isArray(geometry.coordinates))
      throw new TypeError('Invalid '+label+' geometry.');
    return geometry;
  };
  function loadPhysicalLandMask({notify=true}={}){
    if(physicalLand)return Promise.resolve(physicalLand);
    if(!landLoading)landLoading=(async()=>{
      const spec=buildMeta.physicalLand;
      if(!spec)throw new Error('Missing pinned physical land asset.');
      const response=await storedPhysicalAssets().loadAsset(spec,'background','physical-land','육지 배경',
        buffer=>decodeGeometry(buffer,'physical land'));
      physicalLand=Object.freeze({geometry:response.value,revision:spec.sha256});
      if(notify)onLandReady();
      return physicalLand;
    })().catch(error=>{landLoading=null;throw error;});
    return landLoading;
  }
  function loadInitialLandPreview(){
    if(!initialPreviewLoading){
      const source=buildMeta.physicalLand,spec=buildMeta.initialLandPreview;
      if(!spec?.url||spec.sourceSha256!==source?.sha256)
        return Promise.reject(new Error('Initial land preview does not match the pinned physical source.'));
      initialPreviewLoading=storedPhysicalAssets().loadAsset(spec,'background','initial-land-preview','초기 지도 윤곽',
        buffer=>{
          const geometry=decodeGeometry(buffer,'initial land preview');
          if(geometry.coordinates.length!==spec.polygonCount)
            throw new Error('Invalid initial land preview geometry.');
          return geometry;
        }).then(result=>{
          initialPreview=Object.freeze({geometry:result.value,revision:spec.sha256,
            sourceRevision:spec.sourceSha256,certified:true});
          return initialPreview;
        });
      initialPreviewLoading=initialPreviewLoading.catch(error=>{initialPreviewLoading=null;throw error;});
    }
    return initialPreviewLoading;
  }
  return Object.freeze({storedPhysicalAssets,loadPhysicalLandMask,loadInitialLandPreview,
    get physicalLand(){return physicalLand;},get initialLandPreview(){return initialPreview;}});
}
