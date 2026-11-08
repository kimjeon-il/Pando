import { gzipSync, gunzipSync } from 'node:zlib';

// Rebuilding a catalog must not rewrite unrelated, already-valid compressed
// assets. Gzip bytes can vary across Node/zlib versions while decoding to the
// identical authoritative source; retain those bytes and their index hashes.
export function selectTerritorialChunkBytes(decoded, previous = null) {
  if (!Buffer.isBuffer(decoded) || (previous !== null && !Buffer.isBuffer(previous))) {
    throw new TypeError('Territorial chunks require Buffer payloads');
  }
  if (previous !== null && gunzipSync(previous).equals(decoded)) {
    return { stored: previous, changed: false };
  }
  return { stored: gzipSync(decoded, { level: 9, mtime: 0 }), changed: true };
}
