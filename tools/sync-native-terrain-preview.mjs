import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const version = 'v0.13.3-p1';
const sourceCommit = 'e07ca47faa2c586751a7bebdf5f6eba479102976';
const source = `assets/data/terrain-preview/${version}/manifest.json`;
const native = `native/assets/world/terrain-preview/${version}/manifest.json`;
const inventoryPath = 'native/assets/world/physical-inventory-c0bd31d1.json';
const worldPath = 'native/assets/world/manifest.json';
const bytes = path => readFileSync(resolve(root, path));
const sha256 = data => createHash('sha256').update(data).digest('hex');
const blobSha = data => createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
const preview = JSON.parse(bytes(source));
if (preview.version !== '0.13.3-p1' || preview.representation !== 'raster-rgba-v1'
    || Object.keys(preview.tiles).length !== 8) throw new Error('Unexpected preview corpus');
const manifestBytes = bytes(source);
const inventory = JSON.parse(bytes(inventoryPath));
inventory.assets = inventory.assets.filter(asset => asset.path.startsWith('hydro/'));
for (const [suffix, identity] of Object.entries({ 'manifest.json': { bytes: manifestBytes.length, sha256: sha256(manifestBytes) }, ...preview.tiles })) {
  const path = `terrain-preview/${version}/${suffix}`;
  const local = `assets/data/${path}`;
  if (bytes(local).length !== identity.bytes || sha256(bytes(local)) !== identity.sha256)
    throw new Error(`Preview identity mismatch: ${local}`);
  inventory.assets.push({ path, bytes: identity.bytes, sha256: identity.sha256,
    sourceUrl: `https://raw.githubusercontent.com/kimjeon-il/Pando/${sourceCommit}/${local}` });
}
const world = JSON.parse(bytes(worldPath));
world.terrain = { path: `terrain-preview/${version}/manifest.json`, version: preview.version,
  gitBlobSha: blobSha(manifestBytes), sha256: sha256(manifestBytes), required: false,
  bytes: manifestBytes.length, source: { ref: sourceCommit, path: source } };
const expected = new Map([[native, manifestBytes], [inventoryPath, Buffer.from(`${JSON.stringify(inventory)}\n`)],
  [worldPath, Buffer.from(`${JSON.stringify(world, null, 2)}\n`)]]);
for (const [path, data] of expected) {
  const target = resolve(root, path);
  if (process.argv.includes('--check')) {
    if (!bytes(path).equals(data)) throw new Error(`Native preview differs: ${path}`);
  } else {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
  }
}
console.log(JSON.stringify({ previewSha256: sha256(manifestBytes), tileCount: Object.keys(preview.tiles).length,
  nativeManifest: native, checked: process.argv.includes('--check') }));
