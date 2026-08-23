'use strict';

importScripts('../vendor/earcut.min.js', './gpu-mesh-core.js?v=0.16.1');

self.onmessage = event => {
  const token = event.data?.token;
  try {
    const mesh = self.AtlasWrightGpuMeshCore.buildGpuMeshFeatures(
      event.data?.features || [],
      self.earcut,
      { validate: false },
    );
    self.postMessage({ token, ok: true, mesh }, [
      mesh.positions.buffer,
      mesh.countryIndices.buffer,
      mesh.triangleIndices.buffer,
      mesh.lineIndices.buffer,
    ]);
  } catch (error) {
    self.postMessage({ token, ok: false, message: error?.message || String(error) });
  }
};
