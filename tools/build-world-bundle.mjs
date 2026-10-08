import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { resolve, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

export const WORLD_BUNDLE_SCHEMA = 'pandolab-world-bundle';
export const WORLD_BUNDLE_FORMAT = 1;
export const ROLES = Object.freeze({
  previewCountries: ['countries-preview', '.geojson.gz'],
  previewMesh: ['world-mesh-preview', '.bin.gz'],
  canonicalCountryPacket: ['countries-canonical', '.pcg.gz'],
  canonicalMesh: ['world-mesh', '.bin.gz'],
  labelAnchors: ['country-label-anchors', '.json'],
});

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function assertDataPath(value) {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.includes('\\')
    || value.includes('?') || value.includes('#') || value.includes('\0')
    || posix.normalize(value) !== value || value.split('/').some(part => part === '.' || part === '..' || !part)) {
    throw new Error(`Unsafe world asset path: ${value}`);
  }
  return value;
}

export function contentAddress(role, digest) {
  const parts = ROLES[role];
  if (!parts || !/^[a-f0-9]{64}$/.test(String(digest))) throw new Error(`Invalid world asset identity: ${role}`);
  return `world/objects/${parts[0]}-sha256-${digest}${parts[1]}`;
}

export function bundleDescriptor({ seed, legacy, assets, sourceBytes }) {
  if (seed?.schema !== 'pandolab-world-build-input' || seed?.schemaVersion !== 1) throw new Error('Invalid world build input');
  if (legacy?.countries !== 258 || legacy?.source !== seed.canonicalSource || !legacy.defaultClassification
      || legacy.previewDerivation !== 'canonical-topology-simplified') throw new Error('Incompatible legacy world manifest');
  const sourceDigest = sha256(sourceBytes);
  if (sourceDigest !== legacy.sourceSha256 || sourceDigest !== legacy.canonicalSourceSha256
      || sourceDigest !== legacy.previewSourceSha256) throw new Error('Stale canonical world source');
  const outAssets = {};
  for (const role of Object.keys(ROLES)) {
    const old = legacy.assets?.[role];
    const bytes = assets?.[role];
    if (!old || !bytes || !old.url || !['gzip', 'identity'].includes(old.encoding)) throw new Error(`Missing world asset: ${role}`);
    assertDataPath(old.url);
    const currentDigest = sha256(bytes);
    if (old.sha256 !== currentDigest || old.compressedBytes !== bytes.length) throw new Error(`World asset digest/size mismatch: ${role}`);
    const decoded = old.encoding === 'gzip' ? gunzipSync(bytes) : bytes;
    if (old.decodedBytes !== decoded.length) throw new Error(`World decoded size mismatch: ${role}`);
    if (old.header) {
      if (!Array.isArray(old.header) || decoded.length < old.header.length * 4) throw new Error(`World packet header truncated: ${role}`);
      const view = new DataView(decoded.buffer, decoded.byteOffset, decoded.byteLength);
      if (old.header.some((n, i) => n !== view.getUint32(i * 4, true))) throw new Error(`World packet header mismatch: ${role}`);
    }
    outAssets[role] = {
      url: contentAddress(role, currentDigest), encoding: old.encoding,
      compressedBytes: bytes.length, decodedBytes: decoded.length, sha256: currentDigest,
      ...(old.header ? { header: old.header } : {}),
    };
  }
  // Shared-boundary caches keep legacy URLs until the renderer migrates in phase 3.
  const boundaries = {};
  for (const role of ['preview', 'canonical']) boundaries[role] = assertDataPath(seed.sharedBoundaries?.[role]);
  return {
    schema: WORLD_BUNDLE_SCHEMA, schemaVersion: WORLD_BUNDLE_FORMAT,
    source: { url: seed.canonicalSource, sha256: sourceDigest, countryCount: 258 },
    derivation: { preview: legacy.previewDerivation, previewSourceScale: legacy.previewSourceScale,
      simplificationQuantile: legacy.simplificationQuantile, coordinateCount: legacy.coordinateCount,
      meshAlgorithmRevision: legacy.meshAlgorithmRevision },
    defaultClassification: legacy.defaultClassification,
    assets: outAssets,
    compatibility: { sharedBoundaries: boundaries },
  };
}

export function publishWorldBundle({ root, check = false, manifestOverride = null } = {}) {
  if (!root) throw new Error('Repository root required');
  const data = resolve(root, 'assets/data');
  const readData = name => readFileSync(resolve(data, assertDataPath(name)));
  const seedPath = resolve(data, 'world/build-input.json');
  const seed = JSON.parse(readFileSync(seedPath, 'utf8'));
  if (manifestOverride && check) throw new Error('Cannot override build input in --check mode');
  if (manifestOverride) seed.legacyPreviewManifest = assertDataPath(manifestOverride);
  const legacy = JSON.parse(readData(seed.legacyPreviewManifest));
  const sourceBytes = Buffer.from(readData(seed.canonicalSource).toString('utf8').replaceAll('\r\n', '\n'));
  const source = JSON.parse(sourceBytes);
  if (source?.type !== 'FeatureCollection' || source.features?.length !== 258) throw new Error('Invalid world canonical source');
  const original = {};
  for (const role of Object.keys(ROLES)) original[role] = readData(legacy.assets?.[role]?.url);
  const bundle = bundleDescriptor({ seed, legacy, assets: original, sourceBytes });
  const expected = `${JSON.stringify(bundle, null, 2)}\n`;
  const currentPath = resolve(data, 'world/current.json');
  if (check) {
    if (!existsSync(currentPath) || readFileSync(currentPath, 'utf8') !== expected) throw new Error('Stale world/current.json');
  }
  for (const role of Object.keys(ROLES)) {
    const target = resolve(data, bundle.assets[role].url);
    const bytes = original[role];
    if (existsSync(target)) {
      if (sha256(readFileSync(target)) !== sha256(bytes)) throw new Error(`Immutable world asset corrupted: ${role}`);
    } else if (check) throw new Error(`Missing immutable world asset: ${role}`);
    else {
      mkdirSync(dirname(target), { recursive: true });
      const temp = `${target}.tmp-${process.pid}`;
      try { writeFileSync(temp, bytes, { flag: 'wx' }); renameSync(temp, target); }
      finally { if (existsSync(temp)) unlinkSync(temp); }
    }
  }
  if (!check) {
    mkdirSync(dirname(currentPath), { recursive: true });
    const temp = `${currentPath}.tmp-${process.pid}`;
    try { writeFileSync(temp, expected, { flag: 'wx' }); renameSync(temp, currentPath); }
    finally { if (existsSync(temp)) unlinkSync(temp); }
    if (manifestOverride) writeFileSync(seedPath, `${JSON.stringify(seed, null, 2)}\n`);
  }
  return { bundle, validatedAssets: Object.keys(ROLES).length, check };
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const check = process.argv.includes('--check');
  const arg = process.argv.find(value => value.startsWith('--source-manifest='));
  try {
    const result = publishWorldBundle({ root, check, manifestOverride: arg?.slice('--source-manifest='.length) || null });
    console.log(JSON.stringify({ mode: check ? 'check' : 'build', worldDataVersion: result.bundle.source.sha256,
      assets: result.validatedAssets, programVersionDependency: false }));
  } catch (error) {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  }
}
