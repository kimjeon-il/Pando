import { decodePolygonMesh, encodePolygonMesh } from './polygon-mesh-codec.js';

export async function polygonGeometryDigest(geometry) {
  const bytes = new TextEncoder().encode(JSON.stringify([geometry.type, geometry.coordinates]));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Worker owns reusable encoded geometry; transferred packets are detached views of a copy. */
export function createPreparedPolygonMeshStore({ engine, loadManifest = null, loadAsset = null,
  byteBudget = 64 * 1024 * 1024 } = {}) {
  const packets = new Map(), digests = new Map();
  let bytes = 0, manifestPromise, hits = 0, builds = 0, assetHits = 0;
  async function prepare(item, context) {
    context.throwIfCancelled();
    let encoded = digests.get(packets.get(item.cacheKey));
    // A cache-key mapping may survive eviction of its encoded payload.
    if (!encoded) {
      // Polygon rings must retain their topology at every display quality.
      const geometry = item.geometry;
      const digest = await polygonGeometryDigest(geometry);
      context.throwIfCancelled();
      encoded = digests.get(digest);
      if (!encoded) {
        const manifest = loadManifest ? await (manifestPromise ||= loadManifest()) : null;
        const spec = manifest?.meshes?.[digest];
        if (spec) { encoded = await loadAsset(spec); assetHits++; }
        else { encoded = encodePolygonMesh(engine.buildPolygonGeometryPacket(geometry, { ownerId: item.cacheKey, throwIfCancelled: () => context.throwIfCancelled() })); builds++; }
        context.throwIfCancelled();
        // Admit only the current algorithm and precision contract.
        decodePolygonMesh(encoded, { algorithmVersion: engine.MESH_ALGORITHM_REVISION });
        if (encoded.byteLength <= byteBudget) { digests.set(digest, encoded); bytes += encoded.byteLength; }
      } else hits++;
      if (digests.has(digest)) { digests.delete(digest); digests.set(digest, encoded); packets.set(item.cacheKey, digest); }
      while (packets.size > 4096) packets.delete(packets.keys().next().value);
      while (bytes > byteBudget) {
        const oldest = digests.keys().next().value;
        bytes -= digests.get(oldest).byteLength; digests.delete(oldest);
        for (const [key, value] of packets) if (value === oldest) packets.delete(key);
      }
    } else { hits++; const digest = packets.get(item.cacheKey); digests.delete(digest); digests.set(digest, encoded); }
    context.throwIfCancelled();
    return { cacheKey: item.cacheKey, packet: decodePolygonMesh(encoded.slice(0), { algorithmVersion: engine.MESH_ALGORITHM_REVISION }) };
  }
  return Object.freeze({ prepare, stats: () => ({ hits, builds, assetHits, bytes }) });
}
