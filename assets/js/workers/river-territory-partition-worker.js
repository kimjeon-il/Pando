const revision = new URL(self.location.href).searchParams.get('v') || '';
const partitionModuleUrl = new URL('../modules/river-territory-partition.js', self.location.href);
const polygonClippingUrl = new URL('../vendor/polygon-clipping.min.js', self.location.href);
if (revision) partitionModuleUrl.searchParams.set('v', revision);
if (revision) polygonClippingUrl.searchParams.set('v', revision);

const dependencies = Promise.all([
  import(partitionModuleUrl.href),
  import(polygonClippingUrl.href),
]).then(([partitionModule]) => ({
  partitionModule,
  clipper: self.polygonClipping || globalThis.polygonClipping || null,
}));

self.onmessage = async event => {
  const message = event.data || {};
  if (message.type !== 'compute') return;
  try {
    const { partitionModule, clipper } = await dependencies;
    const result = partitionModule.buildRiverTerritoryPartitions({ ...(message.payload || {}), clipper });
    self.postMessage({ type: 'result', requestId: message.requestId, result });
  } catch (error) {
    self.postMessage({
      type: 'error',
      requestId: message.requestId,
      message: error?.message || String(error),
      stack: error?.stack || '',
    });
  }
};
