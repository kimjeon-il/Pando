'use strict';

const buildMetaUrl = new URL('../build-meta.js', self.location.href);
buildMetaUrl.searchParams.set('v', new URL(self.location.href).searchParams.get('v') || '');
importScripts(buildMetaUrl.href);
const assetRevision = globalThis.PANDOLAB_BUILD_META?.assetRevision || '';
const meshCoreUrl = new URL('./gpu-mesh-core.js', self.location.href);
if (assetRevision) meshCoreUrl.searchParams.set('v', assetRevision);
importScripts('../vendor/earcut.min.js', './geographic-boundary-core.js', meshCoreUrl.href);

self.onmessage = event => {
  const token = event.data?.token;
  const projectGeneration = event.data?.projectGeneration;
  try {
    const mesh = self.PandoLabGpuMeshCore.buildGpuMeshFeatures(
      event.data?.features || [],
      self.earcut,
      { validate: false },
    );
    self.postMessage({ token, projectGeneration, ok: true, mesh }, [
      mesh.positions.buffer,
      mesh.countryIndices.buffer,
      mesh.triangleIndices.buffer,
      mesh.lineIndices.buffer,
      mesh.strokeStartsEnds.buffer,
    ]);
  } catch (error) {
    self.postMessage({ token, projectGeneration, ok: false, message: error?.message || String(error) });
  }
};
