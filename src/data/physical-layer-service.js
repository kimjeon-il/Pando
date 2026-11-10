const terrainAssetRevision = new URL(import.meta.url).searchParams.get('v') || '';
const { validateTerrainManifest } = await import(`./terrain-manifest.js?v=${encodeURIComponent(terrainAssetRevision)}`);
export const HYDRO_DATA_VERSION = '0.13.4';
export const HYDRO_DATASET = 'HydroRIVERS 1.0 · Natural Earth 5.0.0 1:10m lakes';

async function fetchManifest({ fetchWithRetry, url, operation, onRetry }) {
  const response = await fetchWithRetry(url, {}, {
    maxAttempts: 3,
    baseDelay: 400,
    maxDelay: 2400,
    timeoutMs: 15000,
    onRetry: ({ attempt }) => onRetry(operation, attempt),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export function createTerrainService({
  fetchWithRetry,
  manifestUrl,
  getLoadState,
  onLoading,
  onRetry,
  acceptManifest,
  onFailure,
}) {
  async function load(force = false) {
    if (!force && ['loading', 'ready'].includes(getLoadState())) return false;
    onLoading();
    try {
      const selectedUrl = manifestUrl();
      const manifest = validateTerrainManifest(await fetchManifest({ fetchWithRetry, url: selectedUrl, operation: 'terrain-manifest', onRetry }));
      await acceptManifest(manifest, selectedUrl);
      return true;
    } catch (error) {
      onFailure(error);
      return false;
    }
  }

  return Object.freeze({ load });
}

export function createHydroService({
  fetchWithRetry,
  dataVersion,
  manifestUrl,
  getLoadState,
  onLoading,
  onRetry,
  acceptManifest,
  onFailure,
  // Generation-specific requests can replace a pending older project load.
  loadKey=()=>null,
  isLoadCurrent=()=>true,
}) {
  let pendingLoad=null,pendingKey=null,readyKey=null;

  function load(force=false) {
    const key=loadKey();
    if(pendingLoad&&Object.is(pendingKey,key))return pendingLoad;
    if(!force&&getLoadState()==='ready'&&Object.is(readyKey,key))
      return Promise.resolve(true);
    const task=Promise.resolve().then(()=>loadManifest(key)).finally(()=>{
      if(pendingLoad===task){pendingLoad=null;pendingKey=null;}
    });
    pendingKey=key;pendingLoad=task;
    return task;
  }

  async function loadManifest(key) {
    if(!isLoadCurrent(key))return false;
    onLoading();
    try {
      const url=manifestUrl();
      const manifest=await fetchManifest({fetchWithRetry,url,operation:'hydro-manifest',onRetry});
      if(!isLoadCurrent(key))return false;
      if(manifest.version!==dataVersion||manifest.schema!=='pandolab-water-shards-v5')
        throw new Error('수계 타일 버전이 맞지 않습니다.');
      const accepted=await acceptManifest(manifest,url,{key,isCurrent:()=>isLoadCurrent(key)});
      if(!isLoadCurrent(key))return false;
      if(!accepted)throw new Error('수계 Worker 초기화에 실패했습니다.');
      readyKey=key;
      return true;
    } catch(error) {
      // A previous project's rejected network/Worker reply must never
      // alter the active project's load status or surface an obsolete error.
      if(isLoadCurrent(key))onFailure(error);
      return false;
    }
  }

  return Object.freeze({load});
}
