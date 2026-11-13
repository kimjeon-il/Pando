import {createStoredAssetLoader} from './stored-asset-loader.js';

// Raw, project-pinned physical asset bytes are owned outside the renderer.
// This service has no map, GPU, C++ timeline or object-selection dependencies.
export function createPhysicalAssetReader({
  buildMeta,resolveBaseUrl,onLandReady=()=>{},createLoader=createStoredAssetLoader,
}={}){
  if(typeof resolveBaseUrl!=='function')
    throw new TypeError('Physical asset reader requires build metadata and a source base URL');
  let loader=null,physicalLand=null,landLoading=null;
  const storedPhysicalAssets=()=>{
    if(!loader)loader=createLoader({dataRevision:buildMeta?.dataRevision,
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
      const spec=buildMeta?.physicalLand;
      if(!spec)throw new Error('Missing pinned physical land asset.');
      const response=await storedPhysicalAssets().loadAsset(spec,'background','physical-land','육지 배경',
        buffer=>decodeGeometry(buffer,'physical land'));
      physicalLand=Object.freeze({geometry:response.value,revision:spec.sha256});
      if(notify)onLandReady();
      return physicalLand;
    })().catch(error=>{landLoading=null;throw error;});
    return landLoading;
  }
  return Object.freeze({storedPhysicalAssets,loadPhysicalLandMask,
    get physicalLand(){return physicalLand;}});
}
