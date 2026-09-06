const revision = new URL(self.location.href).searchParams.get('v') || '';
const partitionModuleUrl = new URL('../modules/river-territory-partition.js', self.location.href);
const polygonClippingUrl = new URL('../vendor/polygon-clipping.min.js', self.location.href);
const rpcHostUrl = new URL('./worker-rpc-host.js', self.location.href);
if (revision) {
  partitionModuleUrl.searchParams.set('v', revision);
  polygonClippingUrl.searchParams.set('v', revision);
  rpcHostUrl.searchParams.set('v', revision);
}

// Module evaluation can yield before message handlers exist. Retain the first
// request (and RPC cancellation events) until initialization has completed.
const startupMessages = [];
const retainStartupMessage = event => startupMessages.push({ data: event.data, ports: event.ports });
self.addEventListener('message', retainStartupMessage);
await import(rpcHostUrl.href);
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

await dependencies;
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

self.removeEventListener('message', retainStartupMessage);
for (const message of startupMessages.splice(0)) self.dispatchEvent(new MessageEvent('message', message));
