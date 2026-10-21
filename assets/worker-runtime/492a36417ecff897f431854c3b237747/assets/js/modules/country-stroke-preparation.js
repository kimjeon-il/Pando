import { buildGpuStrokeInstances } from './gpu-stroke-geometry.js';

// CPU-only preparation. Call in a Worker, never in a render/selection callback.
export function prepareCountryStroke(mesh, countryIds) {
  const started = performance.now();
  let startsEnds = mesh.strokeStartsEnds;
  let ownerRanges = mesh.strokeOwnerRanges;
  if (!(startsEnds instanceof Float32Array) || !ownerRanges) {
    const counts = new Uint32Array(countryIds.length);
    for (let i = 0; i < mesh.lineIndices.length; i += 2) counts[mesh.countryIndices[mesh.lineIndices[i]]] += 1;
    ownerRanges = {};
    const cursors = new Uint32Array(countryIds.length);
    let count = 0;
    countryIds.forEach((id, index) => {
      ownerRanges[id] = { first: count, count: counts[index] };
      cursors[index] = count;
      count += counts[index];
    });
    startsEnds = new Float32Array(count * 4);
    const scale = mesh.positions instanceof Int32Array ? 1e-6 : 1;
    for (let i = 0; i < mesh.lineIndices.length; i += 2) {
      const a = mesh.lineIndices[i], b = mesh.lineIndices[i + 1];
      const target = cursors[mesh.countryIndices[a]]++ * 4;
      startsEnds[target] = mesh.positions[a * 2] * scale;
      startsEnds[target + 1] = mesh.positions[a * 2 + 1] * scale;
      startsEnds[target + 2] = mesh.positions[b * 2] * scale;
      startsEnds[target + 3] = mesh.positions[b * 2 + 1] * scale;
    }
  }
  const geometry = buildGpuStrokeInstances(startsEnds, null, ownerRanges);
  return { ...geometry, startsEnds, inputOwnerRanges: ownerRanges, preparationMs: performance.now() - started };
}

export function countryStrokeTransferables(prepared) {
  return [prepared.startsEnds.buffer, prepared.instances.buffer, prepared.nodes.buffer];
}
