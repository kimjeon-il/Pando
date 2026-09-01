'use strict';

importScripts('../vendor/earcut.min.js', './geographic-boundary-core.js', './gpu-mesh-core.js?v=0.30.0-r47');

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
