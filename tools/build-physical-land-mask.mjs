import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
/** Same unchanged source used by terrain preview generation; no political fields. */
export function buildPhysicalLandMask(sourceBytes) {
  const coordinates = [];
  for (const feature of JSON.parse(sourceBytes).features) {
    if (feature.geometry.type === 'Polygon') coordinates.push(feature.geometry.coordinates);
    else if (feature.geometry.type === 'MultiPolygon') coordinates.push(...feature.geometry.coordinates);
    else throw new TypeError('Physical land requires polygon source geometry.');
  }
  const decoded = Buffer.from(JSON.stringify({ type: 'MultiPolygon', coordinates })), bytes = gzipSync(decoded, { level: 9 });
  return { bytes, manifest: { schema: 'pando-physical-land-v1', sourceSha256: createHash('sha256').update(sourceBytes).digest('hex'),
    asset: { url: 'assets/data/physical-land/v1/geometry.json.gz', encoding: 'gzip', compressedBytes: bytes.length,
      decodedBytes: decoded.length, sha256: createHash('sha256').update(bytes).digest('hex') } } };
}
