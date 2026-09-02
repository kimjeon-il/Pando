const revision = new URL(self.location.href).searchParams.get('v') || '';
const partitionModuleUrl = new URL('../modules/river-territory-partition.js', self.location.href);
const polygonClippingUrl = new URL('../vendor/polygon-clipping.min.js', self.location.href);
const rpcHostUrl = new URL('./worker-rpc-host.js', self.location.href);
if (revision) {
  partitionModuleUrl.searchParams.set('v', revision);
  polygonClippingUrl.searchParams.set('v', revision);
  rpcHostUrl.searchParams.set('v', revision);
}

importScripts(rpcHostUrl.href);
const dependencies = Promise.all([
  import(partitionModuleUrl.href),
  import(polygonClippingUrl.href),
]).then(([partitionModule]) => ({
  partitionModule,
  clipper: self.polygonClipping || globalThis.polygonClipping || null,
}));

async function compute(payload, context = null) {
  const { partitionModule, clipper } = await dependencies;
  context?.throwIfCancelled?.();
  const result = partitionModule.buildRiverTerritoryPartitions({ ...(payload || {}), clipper });
  context?.throwIfCancelled?.();
  return result;
}

self.PandoLabWorkerRpc.install({
  handlers: {
    'river.partition': (payload, context) => compute(payload, context),
  },
});

// Compatibility bridge for the current annex controller.
self.addEventListener('message', async event => {
  const message = event.data || {};
  if (message.rpc === self.PandoLabWorkerRpc.PROTOCOL || message.type !== 'compute') return;
  try {
    const result = await compute(message.payload || {});
    self.postMessage({ type: 'result', requestId: message.requestId, result });
  } catch (error) {
    self.postMessage({
      type: 'error',
      requestId: message.requestId,
      message: error?.message || String(error),
      stack: error?.stack || '',
    });
  }
});
