import { gunzipSync } from 'node:zlib';

/** Validate exact decoded bytes while retaining the checked-in transport encoding. */
export function verifyGzipAssetBytes(existing, generated, label) {
  if (!existing) throw new Error(`${label}: missing generated gzip asset`);
  if (!gunzipSync(existing).equals(gunzipSync(generated))) {
    throw new Error(`${label}: decoded generated asset differs`);
  }
  return existing;
}
