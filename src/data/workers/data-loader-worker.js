import { runtimeDataRoot, workerBuildMeta } from "../../runtime/worker-asset-url.js";
const workerAssetRevision = new URL(self.location.href).searchParams.get('v') || '';
await import(`../../../assets/js/build-meta.js?v=${encodeURIComponent(workerAssetRevision)}`);
const buildMeta = workerBuildMeta(self.location.href, globalThis.PANDOLAB_BUILD_META);
if (!buildMeta) throw new Error('빌드 메타데이터를 불러오지 못했습니다.');
const ASSET_REVISION = String(buildMeta.assetRevision || workerAssetRevision);
const DATA_REVISION = String(buildMeta.dataRevision || '');
if (!DATA_REVISION) throw new Error('데이터 빌드 메타데이터가 없습니다.');
const { decodePreparedCountryScene, preparedCountrySceneKey } = await import(`../../rendering/country-mesh-codec.js?v=${encodeURIComponent(ASSET_REVISION)}`);
let manifest = null;
const { createStoredAssetLoader } = await import(`../stored-asset-loader.js?v=${encodeURIComponent(ASSET_REVISION)}`);
const { parseVerifiedWorldBundle, worldAssetUrl } = await import(`../world-bundle-manifest.js?v=${encodeURIComponent(ASSET_REVISION)}`);
const {mapProjectCatalogSpec}=await import(`../map-project-runtime.js?v=${encodeURIComponent(ASSET_REVISION)}`);
const worldDataRoot = new URL('assets/data/', runtimeDataRoot(self.location.href));
const worldSpec=mapProjectCatalogSpec(buildMeta,'world');
const manifestLoader = createStoredAssetLoader({ dataRevision: DATA_REVISION,
  resolveUrl: spec => new URL(spec.url, runtimeDataRoot(self.location.href)) });
const { loadAsset } = createStoredAssetLoader({
  dataRevision: DATA_REVISION,
  cachePolicy: 'immutable',
  resolveUrl: spec => worldAssetUrl(spec, worldDataRoot),
});

async function loadPreparedScene(sceneIdentity) {
  const key=preparedCountrySceneKey(sceneIdentity),spec=manifest.assets.preparedCountryScene;
  if(!spec){
    // A prepared scene is optional. Missing or obsolete immutable packets are
    // recomputed from the already accepted C++ country geometries. Required
    // world/catalog integrity remains enforced by loadManifest().
    self.postMessage({type:'builtin-mesh-miss'});
    return;
  }
  if(key!==preparedCountrySceneKey(spec.identity)){self.postMessage({type:'builtin-mesh-miss'});return;}
  let result;
  try {
    result=await loadAsset(spec,'mesh','builtin-scene','사전 계산 지도',
      buffer=>decodePreparedCountryScene(buffer,sceneIdentity));
  } catch(error) {
    // Only a source-verified but obsolete *descriptor* may miss the cache.
    // Load-time hash failures and other invalid assets still fail closed.
    if(error?.message==='Invalid prepared country scene descriptor'){
      self.postMessage({type:'builtin-mesh-miss',reason:'incompatible-prepared-descriptor'});
      return;
    }
    throw error;
  }
  const scene=result.value, buffers=new Set();
  const collect=value=>{
    if(value instanceof ArrayBuffer)buffers.add(value);
    else if(ArrayBuffer.isView(value))buffers.add(value.buffer);
    else if(value&&typeof value==='object')for(const item of Object.values(value))collect(item);
  };
  collect(scene);
  self.postMessage({type:'builtin-mesh-ready',meshBuffer:scene.meshBuffer,
    preparedStroke:scene.preparedStroke,spatialBlocks:scene.spatialBlocks,boundaryPacket:scene.boundaryPacket,
    identity:{hash:spec.sha256,sceneKey:key,dataRevision:DATA_REVISION,
      countryIds:scene.countryIds,header:[...new Uint32Array(scene.meshBuffer,0,12)]}},[...buffers]);
}

self.onmessage = event => {
  if (event.data?.type !== 'load-builtin-mesh') return;
  loadPreparedScene(event.data.sceneIdentity).catch(error => {
    self.postMessage({ type: 'builtin-mesh-error', message: error?.message || String(error) });
  });
};
try {
  const result = await manifestLoader.loadAsset(worldSpec,
    'mesh', 'world-manifest', '세계지도 목록', bytes => parseVerifiedWorldBundle(bytes, worldSpec));
  manifest = result.value;
  self.postMessage({ type: 'builtin-mesh-loader-ready' });
} catch (error) {
  self.postMessage({ type: 'builtin-mesh-error', message: error?.message || String(error) });
}
