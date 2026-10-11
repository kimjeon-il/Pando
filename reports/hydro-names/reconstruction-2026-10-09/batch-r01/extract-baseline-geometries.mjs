// Offline extraction only. Uses the immutable baseline production decoder.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { TextDecoder } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node extract-baseline-geometries.mjs INPUT_CACHE OUTPUT_JSON');
const manifest = JSON.parse(fs.readFileSync(path.join(input, 'baseline-manifest.json')));
function verified(name, sha256, expectedBytes) {
  const bytes = fs.readFileSync(path.join(input, name));
  if (createHash('sha256').update(bytes).digest('hex') !== sha256 ||
      (expectedBytes !== undefined && bytes.length !== expectedBytes)) throw new Error(`Verification failed: ${name}`);
  return bytes;
}
verified('baseline-manifest.json', 'c10eaffd375d5f0d90955fa253b02ec73d9daeff261fa5cfde1f73ca89d2bd80');
const context = vm.createContext({ TextDecoder, URL, performance, structuredClone, inputManifest: manifest });
context.self = context;
context.onmessage = null;
context.importScripts = () => {};
for (const [name, sha256] of [
  ['earcut.js', '1444195270d4358ef8dd1a448074f555d7ac3c83c850f5648b611ea1d2090ff3'],
  ['boundary.js', 'b9017382fcc828924608c8a32ddbf2831800475a725b432cad9e6445d33bc8ea'],
  ['worker.js', '14399a8454fb980fb2adc78b7c52bcd32ea5e1b1f313dcfba301886a6b9ddfec'],
]) vm.runInContext(verified(name, sha256).toString('utf8'), context);
vm.runInContext('manifest = inputManifest', context);
const decoder = vm.runInContext('({ readGlobalIndex, readFeatureMetadata, readPack, packSpecs, featureMetadata, logicalPacks })', context);
decoder.readGlobalIndex(gunzipSync(verified('index.bin.gz', manifest.index.sha256, manifest.index.bytes)));
decoder.readFeatureMetadata(gunzipSync(verified('metadata-core.json.gz', manifest.metadata.core.sha256, manifest.metadata.core.bytes)));
for (const row of JSON.parse(gunzipSync(verified('metadata-detail.json.gz', manifest.metadata.detail.sha256, manifest.metadata.detail.bytes))).features) {
  Object.assign(decoder.featureMetadata.get(row.fid), row);
}
const targets = new Map([[15421, '1159109497'], [15218, '1159106899'], [15236, '1159107065']]);
const shard = verified('shard-s0.bin', manifest.shards[0].sha256, manifest.shards[0].bytes);
const packs = new Set([...targets.keys()].flatMap(fid => decoder.logicalPacks.get(decoder.featureMetadata.get(fid).logicalFid)));
const features = [];
const packReceipts = [];
for (const packId of [...packs].sort((a,b) => a-b)) {
  const spec = decoder.packSpecs.get(packId);
  if (spec.shard !== 0 || spec.offset + spec.length > shard.length) throw new Error(`Unexpected pack: ${packId}`);
  const bytes = shard.subarray(spec.offset, spec.offset + spec.length);
  packReceipts.push({ ...spec, sha256: createHash('sha256').update(bytes).digest('hex') });
  for (const feature of decoder.readPack(gunzipSync(bytes), packId).features) {
    const fid = feature.properties.__fid;
    if (!targets.has(fid)) continue;
    const metadata = decoder.featureMetadata.get(fid);
    if (metadata.sourceId !== targets.get(fid) || metadata.awId !== `lakes_base:${targets.get(fid)}`) throw new Error(`Wrong source join: ${fid}`);
    features.push({ type: 'Feature', id: metadata.awId, properties: metadata, geometry: feature.geometry });
  }
}
if (features.length !== targets.size || new Set(features.map(f => f.properties.fid)).size !== targets.size) throw new Error('Missing/duplicate selected feature');
features.sort((a,b) => [...targets.keys()].indexOf(a.properties.fid)-[...targets.keys()].indexOf(b.properties.fid));
fs.writeFileSync(output, JSON.stringify({ type: 'FeatureCollection', features })+'\n');
fs.writeFileSync(path.join(path.dirname(output), 'selected-pack-receipts.json'), JSON.stringify(packReceipts,null,2)+'\n');
console.log(`Validated immutable baseline manifest, metadata, index, shard and decoder: ${features.length} selected features / ${packs.size} packs / 1 shard.`);
