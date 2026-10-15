import { polygonGeometryDigest } from './prepared-polygon-mesh.js';

// The mesh Worker owns prepared geometry. Returned arrays never share its cache.
export function createCountryMeshPreparation({ engine, byteBudget = 128 * 1024 * 1024,
  yieldTask = () => new Promise(resolve => setTimeout(resolve, 0)) }) {
  const cache = new Map();
  let cacheBytes = 0;
  async function build(features, context, progress = () => {}) {
    const parts = [], started = performance.now();
    const preparation = { featureCount: features.length, builtCount: 0, reusedCount: 0,
      hashMs: 0, triangulationMs: 0, assemblyMs: 0, slowestFeature: null };
    let lastYield = started;
    for (let index = 0; index < features.length; index++) {
      context.throwIfCancelled();
      const feature = features[index];
      const hashing = performance.now();
      const key = `${engine.MESH_ALGORITHM_REVISION}:${engine.MAX_RENDER_EDGE_DEGREES}:${feature.geometry ? await polygonGeometryDigest(feature.geometry) : 'empty'}`;
      preparation.hashMs += performance.now() - hashing;
      context.throwIfCancelled();
      let part = cache.get(key);
      if (part) {
        cache.delete(key); cache.set(key, part); preparation.reusedCount++;
      } else {
        const begin = performance.now();
        part = engine.buildGpuMeshFeatures([feature], { validate: false,
          throwIfCancelled: () => context.throwIfCancelled() });
        const duration = performance.now() - begin;
        preparation.triangulationMs += duration; preparation.builtCount++;
        if (!preparation.slowestFeature || duration > preparation.slowestFeature.ms)
          preparation.slowestFeature = { id: String(feature.id || index), ms: duration };
        const bytes = Object.values(part).filter(ArrayBuffer.isView).reduce((sum, value) => sum + value.byteLength, 0);
        if (bytes <= byteBudget) {
          cache.set(key, part); cacheBytes += bytes;
          while (cacheBytes > byteBudget) {
            const oldest = cache.keys().next().value;
            cacheBytes -= Object.values(cache.get(oldest)).filter(ArrayBuffer.isView).reduce((sum, value) => sum + value.byteLength, 0);
            cache.delete(oldest);
          }
        }
      }
      parts.push(part);
      progress(index + 1, 'geometry');
      // A real task boundary lets cancellation arrive during long rebuilds.
      if (performance.now() - lastYield >= 16 || index === features.length - 1) {
        await yieldTask(); lastYield = performance.now();
        context.throwIfCancelled();
      }
    }
    const assembly = performance.now();
    const mesh = { countryIds: features.map((feature, index) => String(feature.id || index)),
      strokeOwnerRanges: {}, stats: { algorithmRevision: engine.MESH_ALGORITHM_REVISION,
        polygonCount: 0, polarPolygonCount: 0, maxEdgeDegrees: 0, removedDegenerateTriangleCount: 0 } };
    const fields = ['positions', 'countryIndices', 'triangleIndices', 'lineIndices', 'strokeStartsEnds',
      'countryTriangleRanges', 'countryBoundaryRanges', 'countryBounds', 'countryBoundsFlags'];
    const types = [Int32Array, Uint16Array, Uint32Array, Uint32Array, Float32Array,
      Uint32Array, Uint32Array, Int32Array, Uint32Array];
    fields.forEach((field, index) => { mesh[field] = new types[index](parts.reduce((sum, part) => sum + part[field].length, 0)); });
    let vertices = 0, triangles = 0, lines = 0, strokes = 0;
    parts.forEach((part, index) => {
      mesh.positions.set(part.positions, vertices * 2);
      mesh.countryIndices.fill(index, vertices, vertices + part.countryIndices.length);
      for (let item = 0; item < part.triangleIndices.length; item++) mesh.triangleIndices[triangles + item] = vertices + part.triangleIndices[item];
      for (let item = 0; item < part.lineIndices.length; item++) mesh.lineIndices[lines + item] = vertices + part.lineIndices[item];
      mesh.strokeStartsEnds.set(part.strokeStartsEnds, strokes);
      mesh.countryTriangleRanges.set([triangles, part.triangleIndices.length], index * 2);
      mesh.countryBoundaryRanges.set([lines, part.lineIndices.length], index * 2);
      mesh.countryBounds.set(part.countryBounds, index * 4); mesh.countryBoundsFlags.set(part.countryBoundsFlags, index);
      mesh.strokeOwnerRanges[mesh.countryIds[index]] = { first: strokes / 4, count: part.strokeStartsEnds.length / 4 };
      for (const field of ['polygonCount', 'polarPolygonCount', 'removedDegenerateTriangleCount']) mesh.stats[field] += part.stats[field];
      mesh.stats.maxEdgeDegrees = Math.max(mesh.stats.maxEdgeDegrees, part.stats.maxEdgeDegrees);
      vertices += part.countryIndices.length; triangles += part.triangleIndices.length; lines += part.lineIndices.length; strokes += part.strokeStartsEnds.length;
    });
    preparation.assemblyMs = performance.now() - assembly; preparation.cacheBytes = cacheBytes;
    mesh.preparation = preparation;
    progress(features.length + 1, 'assembly');
    return mesh;
  }
  return { build };
}
