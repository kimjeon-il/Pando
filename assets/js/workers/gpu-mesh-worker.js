'use strict';

const buildMetaUrl = new URL('../build-meta.js', self.location.href);
buildMetaUrl.searchParams.set('v', new URL(self.location.href).searchParams.get('v') || '');
importScripts(buildMetaUrl.href);
const assetRevision = globalThis.PANDOLAB_BUILD_META?.assetRevision || '';
const meshCoreUrl = new URL('./gpu-mesh-core.js', self.location.href);
const rpcHostUrl = new URL('./worker-rpc-host.js', self.location.href);
if (assetRevision) {
  meshCoreUrl.searchParams.set('v', assetRevision);
  rpcHostUrl.searchParams.set('v', assetRevision);
}
importScripts('../vendor/earcut.min.js', './geographic-boundary-core.js', meshCoreUrl.href, rpcHostUrl.href);

const strokePreparation = import(`../modules/country-stroke-preparation.js?v=${encodeURIComponent(assetRevision)}`);
async function buildMesh(features) {
  const mesh = self.PandoLabGpuMeshCore.buildGpuMeshFeatures(
    features || [],
    self.earcut,
    { validate: false },
  );
  const { prepareCountryStroke } = await strokePreparation;
  mesh.preparedStroke = prepareCountryStroke(mesh, (features || []).map((feature, index) => String(feature.id || index)));
  return mesh;
}

function meshTransferables(mesh) {
  return [
    mesh.positions.buffer,
    mesh.countryIndices.buffer,
    mesh.triangleIndices.buffer,
    mesh.lineIndices.buffer,
    mesh.strokeStartsEnds.buffer,
    mesh.countryTriangleRanges.buffer,
    mesh.countryBoundaryRanges.buffer,
    mesh.countryBounds.buffer,
    mesh.countryBoundsFlags.buffer,
    mesh.preparedStroke.instances.buffer,
    mesh.preparedStroke.nodes.buffer,
  ];
}

const rpcHost = self.PandoLabWorkerRpc.install({
  handlers: {
    'geometry.mesh': async (payload, context) => {
      context.throwIfCancelled();
      const mesh = await buildMesh(payload?.features || []);
      context.throwIfCancelled();
      return self.PandoLabWorkerRpc.transferResult(mesh, meshTransferables(mesh));
    },
  },
});
void rpcHost;

// Compatibility bridge for the current renderer. New CPU geometry clients use
// Worker RPC; the renderer-v2 migration removes this token-based transport.
self.addEventListener('message', async event => {
  if (event.data?.rpc === self.PandoLabWorkerRpc.PROTOCOL) return;
  const token = event.data?.token;
  const projectGeneration = event.data?.projectGeneration;
  try {
    const mesh = await buildMesh(event.data?.features || []);
    self.postMessage({ token, projectGeneration, ok: true, mesh }, meshTransferables(mesh));
  } catch (error) {
    self.postMessage({ token, projectGeneration, ok: false, message: error?.message || String(error) });
  }
});
