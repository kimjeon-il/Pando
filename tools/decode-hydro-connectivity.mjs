// Offline audit adapter: use the production decoder, never a second binary codec.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { TextDecoder } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node tools/decode-hydro-connectivity.mjs INPUT_DIR OUTPUT_JSON');
const manifest = JSON.parse(fs.readFileSync(path.join(input, 'manifest.json')));
function verified(spec) {
  const bytes = fs.readFileSync(path.join(input, spec.url));
  if (bytes.length !== spec.bytes || createHash('sha256').update(bytes).digest('hex') !== spec.sha256) {
    throw new Error(`Asset verification failed: ${spec.url}`);
  }
  return bytes;
}
const context = vm.createContext({ TextDecoder, URL, performance, structuredClone, inputManifest: manifest });
context.self = context;
context.onmessage = null;
context.importScripts = () => {};
for (const file of ['vendor/earcut.min.js', 'workers/geographic-boundary-core.js', 'workers/hydro-tile-worker.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'assets/js', file), 'utf8'), context);
}
vm.runInContext('manifest = inputManifest', context);
const decoder = vm.runInContext('({ readGlobalIndex, readFeatureMetadata, readPack, packSpecs, featureMetadata })', context);
decoder.readGlobalIndex(gunzipSync(verified(manifest.index)));
decoder.readFeatureMetadata(gunzipSync(verified(manifest.metadata.core)));
for (const row of JSON.parse(gunzipSync(verified(manifest.metadata.detail))).features) {
  Object.assign(decoder.featureMetadata.get(row.fid), row);
}
const shards = new Map(manifest.shards.map(spec => [spec.id, verified(spec)]));
const features = [];
const seen = new Set();
for (const spec of decoder.packSpecs.values()) {
  const shard = shards.get(spec.shard);
  if (!shard || spec.offset + spec.length > shard.length) throw new Error(`Invalid range: ${spec.id}`);
  for (const feature of decoder.readPack(gunzipSync(shard.subarray(spec.offset, spec.offset + spec.length)), spec.id).features) {
    const fid = feature.properties.__fid;
    if (seen.has(fid)) throw new Error(`Duplicate feature: ${fid}`);
    seen.add(fid);
    features.push({ metadata: decoder.featureMetadata.get(fid), geometry: feature.geometry, widths: feature.properties.stroke_widths });
  }
}
if (seen.size !== manifest.metadata.featureCount) throw new Error('Missing features');
features.sort((a, b) => a.metadata.fid - b.metadata.fid);
fs.writeFileSync(output, JSON.stringify({ manifest, features }));
console.log(`Validated ${features.length} features / ${decoder.packSpecs.size} packs / ${shards.size} shards`);
