const revision = new URL(self.location.href).searchParams.get('v') || '';
const partitionModuleUrl = new URL('../modules/river-territory-partition.js', self.location.href);
const rpcHostUrl = new URL('./worker-rpc-host.js', self.location.href);
if (revision) {
  partitionModuleUrl.searchParams.set('v', revision);
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
  import("../../../../../shared/frontend/js/modules/core-wasm-loader.js").then(({ loadVerifiedCore }) => loadVerifiedCore({
    baseUrl: new URL('../../wasm/', self.location.href),
  })).then(core => { self.PandoLabSphericalCore = core; }),
]).then(([partitionModule]) => ({
  partitionModule,
}));

async function compute(payload, context = null) {
  const { partitionModule } = await dependencies;
  context?.throwIfCancelled?.();
  const result = partitionModule.buildRiverTerritoryPartitions(payload || {});
  context?.throwIfCancelled?.();
  return result;
}

await dependencies;
self.PandoLabWorkerRpc.install({
  handlers: {
    'river.partition': (payload, context) => compute(payload, context),
  },
});

self.removeEventListener('message', retainStartupMessage);
for (const message of startupMessages.splice(0)) self.dispatchEvent(new MessageEvent('message', message));
