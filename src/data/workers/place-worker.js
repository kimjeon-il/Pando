import "../../runtime/workers/worker-rpc-host.js";
import { createExternalRuntimeDataFetch } from '../external-runtime-data.js';
import { workerBuildMeta } from '../../runtime/worker-asset-url.js';
const storeModuleUrl=new URL("../place-worker-store.js",import.meta.url);
const revision=new URL(import.meta.url).searchParams.get('v');
if (!revision) throw new TypeError('Place Worker requires its deployment revision');
// Register RPC handlers synchronously before the first asynchronous import.
// Worker messages can be dispatched while a module's top-level await is
// suspended; the first viewport/search request must never be lost.
storeModuleUrl.searchParams.set('v',revision);
let metadataTask=null;
function loadMetadata() {
  if (!metadataTask) metadataTask=(async()=>{
    if (!globalThis.PANDOLAB_BUILD_META)
      await import(`../../../assets/js/build-meta.js?v=${encodeURIComponent(revision)}`);
    const meta=workerBuildMeta(self.location.href,globalThis.PANDOLAB_BUILD_META);
    return {runtimeFetch:createExternalRuntimeDataFetch({meta}),
      externalRuntimeData:!!meta.externalRuntimeData};
  })().catch(error=>{metadataTask=null;throw error;});
  return metadataTask;
}
let store=null, manifestUrl=null, loading=null;
async function getStore(url,context) {
  if (store && manifestUrl === url) return store;
  if (!loading || manifestUrl !== url) {
    manifestUrl=url;
    loading=(async () => {
      const {runtimeFetch,externalRuntimeData}=await loadMetadata();
      const { createPlaceWorkerStore, readPlaceResponse }=await import(storeModuleUrl.href);
      const requestUrl=new URL(url);
      requestUrl.searchParams.set('v',revision);
      const response=await runtimeFetch(requestUrl, {signal:context.signal});
      if (!response.ok) throw new Error(`Place manifest HTTP ${response.status}`);
      const bytes=await readPlaceResponse(response,8*1024*1024);
      const fetchBytes=externalRuntimeData ? async (spec,{signal}={}) => {
        const response=await runtimeFetch(new URL(spec.url,url),{signal});
        if(!response.ok)throw new Error('Place shard HTTP '+response.status);
        return readPlaceResponse(response,spec.bytes);
      } : null;
      return createPlaceWorkerStore({ manifest: JSON.parse(new TextDecoder().decode(bytes)), baseUrl: url,fetchBytes });
    })();
  }
  const pending=loading;
  try { store=await pending; return store; } catch (error) {
    if (loading === pending) loading=null;
    context.throwIfCancelled();
    if (error.name === 'AbortError') return getStore(url,context);
    throw error;
  }
}
self.PandoLabWorkerRpc.install({ handlers: {
  'place.viewport': async (payload,context) => (await getStore(payload.manifestUrl,context)).queryViewport(payload.view,context),
  'place.search': async (payload,context) => (await getStore(payload.manifestUrl,context)).search(payload.query,context,payload.presentation),
} });
