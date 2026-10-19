import './worker-rpc-host.js';
const storeModuleUrl=new URL('../modules/place-worker-store.js',import.meta.url);
const revision=new URL(import.meta.url).searchParams.get('v');
if (!revision) throw new TypeError('Place Worker requires its deployment revision');
storeModuleUrl.searchParams.set('v',revision);
let store=null, manifestUrl=null, loading=null;
async function getStore(url,context) {
  if (store && manifestUrl === url) return store;
  if (!loading || manifestUrl !== url) {
    manifestUrl=url;
    loading=(async () => {
      const { createPlaceWorkerStore, readPlaceResponse }=await import(storeModuleUrl.href);
      const requestUrl=new URL(url);
      requestUrl.searchParams.set('v',revision);
      const response=await fetch(requestUrl, {signal:context.signal});
      if (!response.ok) throw new Error(`Place manifest HTTP ${response.status}`);
      const bytes=await readPlaceResponse(response,8*1024*1024);
      return createPlaceWorkerStore({ manifest: JSON.parse(new TextDecoder().decode(bytes)), baseUrl: url });
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
