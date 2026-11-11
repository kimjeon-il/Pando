/** Optional immutable polygon accelerators are a derived cache, not geometry truth.
 * Ship only small packets within the Pages static-data budget; omitted packets
 * are built from the same canonical geometry by the Worker on cache miss. */
export const MAX_PUBLISHED_PREPARED_MESH_BYTES = 64 * 1024;

export function publishedPreparedMeshBytes(spec) {
  if (!spec || typeof spec !== 'object') return Infinity;
  const components = spec.storageLayout === undefined ? [spec] : [spec.base, spec.replacement];
  if (components.some(row => !row || !Number.isSafeInteger(row.compressedBytes)
    || row.compressedBytes <= 0)) return Infinity;
  return components.reduce((sum, row) => sum + row.compressedBytes, 0);
}

export function isPublishedPreparedMeshSpec(spec) {
  return publishedPreparedMeshBytes(spec) <= MAX_PUBLISHED_PREPARED_MESH_BYTES;
}

export function publishedPreparedMeshManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || !manifest.meshes
    || typeof manifest.meshes !== 'object' || Array.isArray(manifest.meshes))
    throw new TypeError('Invalid prepared polygon catalog');
  return { ...manifest, meshes: Object.fromEntries(
    Object.entries(manifest.meshes).filter(([, spec]) => isPublishedPreparedMeshSpec(spec))) };
}
