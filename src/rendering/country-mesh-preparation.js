import { polygonGeometryDigest } from "./prepared-polygon-mesh.js";

// Display-only tile parts share the existing source-aware LRU with canonical
// country parts. The renderer still receives one ordered country slot per ID.
// Changing a viewport rebuilds only newly entered tiles, not a whole country.
export function createCountryMeshPreparation({ engine, loadPreparedPart = null, byteBudget = 128 * 1024 * 1024,
  yieldTask = () => new Promise(resolve => setTimeout(resolve, 0)) }) {
  const cache = new Map();
  let cacheBytes = 0;
  const fields = ['positions', 'countryIndices', 'triangleIndices', 'lineIndices',
    'strokeStartsEnds', 'countryTriangleRanges', 'countryBoundaryRanges',
    'countryBounds', 'countryBoundsFlags'];
  const types = [Int32Array, Uint16Array, Uint32Array, Uint32Array,
    Float32Array, Uint32Array, Uint32Array, Int32Array, Uint32Array];

  const bytesOf = part => fields.reduce((sum, field) => sum + (part[field]?.byteLength || 0), 0);
  async function build(features, context, progress = () => {}, {
    validate = false, maxEdgeDegrees = engine.MAX_RENDER_EDGE_DEGREES,
  } = {}) {
    if (!Number.isFinite(maxEdgeDegrees) || maxEdgeDegrees < engine.MAX_RENDER_EDGE_DEGREES)
      throw new TypeError('Invalid country mesh edge subdivision budget.');
    const started = performance.now(), groups = [];
    const preparation = { featureCount: features.length, builtCount: 0, reusedCount: 0,
      maxEdgeDegrees, tileCount: 0,
      hashMs: 0, triangulationMs: 0, assemblyMs: 0, slowestFeature: null };
    let lastYield = started;
    for (let index = 0; index < features.length; index++) {
      context.throwIfCancelled();
      const feature = features[index], parts = [];
      const jobs = Array.isArray(feature.lodParts) && feature.lodParts.length
        ? feature.lodParts.map(part => ({ id: feature.id, geometry: part.geometry }))
        : [feature];
      if (jobs.length > 1 || feature.lodParts?.length) preparation.tileCount += jobs.length;
      for (const job of jobs) {
        context.throwIfCancelled();
        const hashing = performance.now();
        const digest = job.geometry ? await polygonGeometryDigest(job.geometry) : 'empty';
        const key = `${engine.MESH_ALGORITHM_REVISION}:${maxEdgeDegrees}:${validate ? 'validated' : 'canonical'}:${digest}`;
        preparation.hashMs += performance.now() - hashing;
        context.throwIfCancelled();
        let part = cache.get(key);
        if (part) {
          cache.delete(key); cache.set(key, part);
          preparation.reusedCount++;
        } else {
          const begin = performance.now();
          part = loadPreparedPart ? await loadPreparedPart(key, job) : null;
          context.throwIfCancelled();
          if (part) preparation.reusedCount++;
          else {
            part = engine.buildGpuMeshFeatures([job], { validate, maxEdgeDegrees,
              throwIfCancelled: () => context.throwIfCancelled() });
            preparation.triangulationMs += performance.now() - begin;
            preparation.builtCount++;
          }
          const duration = performance.now() - begin;
          if (!preparation.slowestFeature || duration > preparation.slowestFeature.ms)
            preparation.slowestFeature = { id: String(job.id ?? index), ms: duration };
          const bytes = bytesOf(part);
          if (bytes <= byteBudget) {
            cache.set(key, part); cacheBytes += bytes;
            while (cacheBytes > byteBudget) {
              const oldest = cache.keys().next().value, replaced = cache.get(oldest);
              cacheBytes -= bytesOf(replaced);
              cache.delete(oldest);
            }
          }
        }
        parts.push(part);
        if (performance.now() - lastYield >= 16) {
          await yieldTask(); lastYield = performance.now();
          context.throwIfCancelled();
        }
      }
      groups.push(parts);
      progress(index + 1, 'geometry');
      if (index === features.length - 1) {
        await yieldTask(); lastYield = performance.now();
        context.throwIfCancelled();
      }
    }
    const assembly = performance.now();
    const parts = groups.flat();
    const mesh = { countryIds: features.map((feature, index) => String(feature.id ?? index)),
      strokeOwnerRanges: {},
      stats: { algorithmRevision: engine.MESH_ALGORITHM_REVISION,
        polygonCount: 0, polarPolygonCount: 0, maxEdgeDegrees: 0,
        removedDegenerateTriangleCount: 0 } };
    const concatenated = ['positions', 'countryIndices', 'triangleIndices', 'lineIndices', 'strokeStartsEnds'];
    for (const [index, field] of fields.entries()) {
      const count = concatenated.includes(field)
        ? parts.reduce((sum, part) => sum + part[field].length, 0)
        : field === 'countryBounds' ? features.length * 4
        : field === 'countryBoundsFlags' ? features.length : features.length * 2;
      mesh[field] = new types[index](count);
    }
    let vertices = 0, triangles = 0, lines = 0, strokes = 0;
    groups.forEach((countryParts, countryIndex) => {
      const id = mesh.countryIds[countryIndex], startTriangle = triangles;
      const startBoundary = lines, startStroke = strokes;
      const bounds = [Infinity, Infinity, -Infinity, -Infinity];
      let flags = 0;
      for (const part of countryParts) {
        mesh.positions.set(part.positions, vertices * 2);
        mesh.countryIndices.fill(countryIndex, vertices, vertices + part.countryIndices.length);
        for (let item = 0; item < part.triangleIndices.length; item++)
          mesh.triangleIndices[triangles + item] = vertices + part.triangleIndices[item];
        for (let item = 0; item < part.lineIndices.length; item++)
          mesh.lineIndices[lines + item] = vertices + part.lineIndices[item];
        mesh.strokeStartsEnds.set(part.strokeStartsEnds, strokes);
        flags |= Number(part.countryBoundsFlags[0] || 0);
        for (let axis = 0; axis < 2; axis++) {
          bounds[axis] = Math.min(bounds[axis], part.countryBounds[axis]);
          bounds[axis + 2] = Math.max(bounds[axis + 2], part.countryBounds[axis + 2]);
        }
        for (const field of ['polygonCount', 'polarPolygonCount', 'removedDegenerateTriangleCount'])
          mesh.stats[field] += part.stats[field];
        mesh.stats.maxEdgeDegrees = Math.max(mesh.stats.maxEdgeDegrees, part.stats.maxEdgeDegrees);
        vertices += part.countryIndices.length;
        triangles += part.triangleIndices.length;
        lines += part.lineIndices.length;
        strokes += part.strokeStartsEnds.length;
      }
      // One source part must be byte-for-byte equivalent to the canonical
      // engine. Only a multi-tile union needs conservative bound promotion.
      if (countryParts.length === 1) {
        mesh.countryBounds.set(countryParts[0].countryBounds, countryIndex * 4);
        mesh.countryBoundsFlags[countryIndex] = countryParts[0].countryBoundsFlags[0];
      } else if (flags || !Number.isFinite(bounds[0])) {
        mesh.countryBounds.set([-180e6, -90e6, 180e6, 90e6], countryIndex * 4);
        mesh.countryBoundsFlags[countryIndex] = 2;
      } else {
        mesh.countryBounds.set(bounds, countryIndex * 4);
        mesh.countryBoundsFlags[countryIndex] = 0;
      }
      mesh.countryTriangleRanges.set([startTriangle, triangles - startTriangle], countryIndex * 2);
      mesh.countryBoundaryRanges.set([startBoundary, lines - startBoundary], countryIndex * 2);
      mesh.strokeOwnerRanges[id] = { first: startStroke / 4, count: (strokes - startStroke) / 4 };
    });
    preparation.assemblyMs = performance.now() - assembly;
    preparation.cacheBytes = cacheBytes;
    mesh.preparation = preparation;
    progress(features.length + 1, 'assembly');
    return mesh;
  }
  return { build };
}
