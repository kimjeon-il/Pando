import "../../runtime/workers/worker-rpc-host.js";
import { createExternalRuntimeDataFetch } from '../external-runtime-data.js';
import { workerBuildMeta } from '../../runtime/worker-asset-url.js';
const storeModuleUrl=new URL("../place-worker-store.js",import.meta.url);
const revision=new URL(import.meta.url).searchParams.get('v');
if (!revision) throw new TypeError('Place Worker requires its deployment revision');
// Install the RPC listener synchronously. A module Worker can otherwise
// receive and drop its first message while top-level metadata import awaits.
const ensureBuildMeta=()=>globalThis.PANDOLAB_BUILD_META?Promise.resolve():import(`../../../assets/js/build-meta.js?v=${encodeURIComponent(revision)}`);
storeModuleUrl.searchParams.set('v',revision);
let store=null, manifestUrl=null, loading=null;
async function getStore(url,context) {
  if (store && manifestUrl === url) return store;
  if (!loading || manifestUrl !== url) {
    manifestUrl=url;
    loading=(async () => {
      await ensureBuildMeta();
      const buildMeta=workerBuildMeta(self.location.href,globalThis.PANDOLAB_BUILD_META);
      const runtimeFetch=createExternalRuntimeDataFetch({meta:buildMeta});
      const { createPlaceWorkerStore, readPlaceResponse }=await import(storeModuleUrl.href);
      const requestUrl=new URL(url);
      requestUrl.searchParams.set('v',revision);
      const response=await runtimeFetch(requestUrl, {signal:context.signal});
      if (!response.ok) throw new Error(`Place manifest HTTP ${response.status}`);
      const bytes=await readPlaceResponse(response,8*1024*1024);
      const fetchBytes=buildMeta.externalRuntimeData ? async (spec,{signal}={}) => {
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
