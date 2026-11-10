import {writeLibraryOutput} from "../data/library-runtime.mjs";
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { readProjectWorldGenerationContext } from './project-generation-context.mjs';

import { inspectCanonicalCountryPacket } from "../../src/rendering/canonical-country-packet.js";
import { encodeCanonicalCountryPacket } from "./canonical-country-packet-encoder.mjs";
import { classifyBuiltinCountries } from "../gis/builtin-country-classification.mjs";
import { loadBuiltinDisplayPolicy } from "../gis/builtin-display-policy.mjs";
import { verifyGzipAssetBytes } from "../../scripts/lib/gzip-asset-verification.mjs";
import "./load-spherical-core.mjs";

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(toolDirectory, '..', '..');
const projectId = process.argv.find(value=>value.startsWith('--project='))?.slice('--project='.length) || 'default-world';
const context = readProjectWorldGenerationContext({root:projectRoot,projectId});
const bundleSeed = context.worldRecipe;
const legacyTag = /(?:^|\/)(?:world-)?preview-v(\d+\.\d+\.\d+)\.json$/.exec(bundleSeed.legacyPreviewManifest || '');
if (!legacyTag) throw new Error('Invalid pinned world dataset output revision');
const LEGACY_DATA_VERSION = legacyTag[1];
const dataDirectory = path.join(projectRoot, 'assets', 'data');
const legacySourceManifest = JSON.parse(fs.readFileSync(path.join(dataDirectory, bundleSeed.legacyPreviewManifest), 'utf8'));
if (legacySourceManifest.version !== LEGACY_DATA_VERSION) throw new Error('Inconsistent pinned legacy world data revision');
const sourcePath = path.resolve(projectRoot,context.source('territorialCurrentWorld'));
const canonicalCountryPacketPath = path.join(dataDirectory, legacySourceManifest.assets.canonicalCountryPacket.url);
const canonicalMeshPath = path.join(dataDirectory, legacySourceManifest.assets.canonicalMesh.url);
const labelAnchorsPath = path.join(dataDirectory, legacySourceManifest.assets.labelAnchors.url);
const sourceManifestPath = path.join(dataDirectory, bundleSeed.legacyPreviewManifest);
if(projectId!=='default-world'&&Object.values(legacySourceManifest.assets)
  .some(asset=>typeof asset?.url!=='string'
    ||!/^[-a-zA-Z0-9_./]+$/.test(asset.url)
    ||asset.url.split('/').some(part=>!part||part==='.'||part==='..')
    ||!asset.url.startsWith(projectId+'/')))
  throw new TypeError('Nondefault project world assets must use a project-owned immutable output namespace');
const checkOnly = process.argv.includes('--check');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function meshHeader(value) {
  const prefix = new Uint32Array(value.buffer, value.byteOffset, 8);
  const words = prefix[1] >= 2 ? 12 : 8;
  return Array.from(new Uint32Array(value.buffer, value.byteOffset, words));
}

function geometryFingerprint(geometry) {
  const source = JSON.stringify(geometry ?? null);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${source.length.toString(36)}:${(hash >>> 0).toString(36)}`;
}

function countryId(value, fallback = '') {
  const id = value?.id ?? value?.properties?.editor_id ?? value?.properties?.iso_a3 ?? fallback;
  return String(id || '').trim();
}

function minimalFeature(featureValue, index) {
  const properties = featureValue.properties || {};
  return {
    type: 'Feature',
    id: countryId(featureValue, String(index)),
    properties: { name: properties.name || properties.NAME || '이름 없는 국가' },
    geometry: featureValue.geometry,
  };
}

function compareOrWrite(filePath, bytes) {
  if (checkOnly) {
    const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
    const comparableExisting = existing && path.extname(filePath) === '.json' ? Buffer.from(existing.toString('utf8').replaceAll('\r\n', '\n')) : existing;
    const comparableBytes = path.extname(filePath) === '.json' ? Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n')) : bytes;
    if (!comparableExisting?.equals(comparableBytes)) throw new Error(`${path.relative(projectRoot, filePath)} 국가 packet 자산이 최신 빌드와 다릅니다.`);
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  writeLibraryOutput(filePath, bytes);
}

function checkedGzip(filePath, generated) {
  if (!checkOnly) return generated;
  return verifyGzipAssetBytes(fs.existsSync(filePath) ? fs.readFileSync(filePath) : null,
    generated, path.relative(projectRoot, filePath));
}

const canonicalBytes = Buffer.from(fs.readFileSync(sourcePath, 'utf8').replaceAll('\r\n', '\n'));
const canonicalMeshBytes = fs.readFileSync(canonicalMeshPath);
const canonicalMeshDecoded = zlib.gunzipSync(canonicalMeshBytes);
const labelAnchorBytes = Buffer.from(fs.readFileSync(labelAnchorsPath, 'utf8').replaceAll('\r\n', '\n'));
const canonicalSource = JSON.parse(canonicalBytes.toString('utf8'));
if (canonicalSource?.type !== 'FeatureCollection' || !canonicalSource.features?.length) throw new Error('현재 세계지도 국가 데이터가 비어 있거나 올바르지 않습니다.');

const startedAt = performance.now();

const classified = classifyBuiltinCountries({ ...canonicalSource, features: canonicalSource.features.map(minimalFeature) }, { displayPolicy: loadBuiltinDisplayPolicy(context.source('displayPolicy')) });
const canonicalById = new Map(canonicalSource.features.map((feature, index) => [countryId(feature, String(index)), feature]));
const classifiedById = new Map(classified.countries.features.map(feature => [String(feature.id), feature]));
const defaultClassification = {
  countries: Object.fromEntries(classified.countries.features.map(feature => [String(feature.id), geometryFingerprint(feature.geometry)])),
  changed: Object.fromEntries(classified.countries.features
    .filter(feature => geometryFingerprint(feature.geometry) !== geometryFingerprint(canonicalById.get(String(feature.id))?.geometry))
    .map(feature => [String(feature.id), geometryFingerprint(feature.geometry)])),
  removedIds: [...canonicalById.keys()].filter(id => !classifiedById.has(id)),
  units: Object.fromEntries(classified.subunits.map(unit => [String(unit.id), {
    parentId: String(unit.properties.parentId), geometry: geometryFingerprint(unit.geometry),
    revision: unit.properties.metadata.builtinSubunit.revision,
  }])),
};
const canonicalCountryPacketBuffer = encodeCanonicalCountryPacket(canonicalSource);
const canonicalCountryPacketHeader = inspectCanonicalCountryPacket(canonicalCountryPacketBuffer);
const canonicalCountryPacket = checkedGzip(canonicalCountryPacketPath, zlib.gzipSync(Buffer.from(canonicalCountryPacketBuffer), { level: 9, mtime: 0 }));
// LSIB detail increases source vertices; these are data budgets, not wire limits.
if (canonicalCountryPacketBuffer.byteLength > 24 * 1024 * 1024) throw new Error(`canonical 국가 packet이 24MiB를 초과했습니다: ${canonicalCountryPacketBuffer.byteLength}`);
if (canonicalCountryPacket.length > 13 * 1024 * 1024) throw new Error(`canonical 국가 packet gzip이 13MiB를 초과했습니다: ${canonicalCountryPacket.length}`);
const manifest = {
  version: LEGACY_DATA_VERSION,
  source: bundleSeed.canonicalSource,
  sourceSha256: sha256(canonicalBytes),
  defaultClassification,
  canonicalSourceSha256: sha256(canonicalBytes),
  countries: canonicalSource.features.length,
  coordinateCount: canonicalCountryPacketHeader.positionCount,
  meshAlgorithmRevision: meshHeader(canonicalMeshDecoded)[7],
  assets: {
    labelAnchors: { url: legacySourceManifest.assets.labelAnchors.url, encoding: 'identity', compressedBytes: labelAnchorBytes.length, decodedBytes: labelAnchorBytes.length, sha256: sha256(labelAnchorBytes) },
    canonicalCountryPacket: {
      url: legacySourceManifest.assets.canonicalCountryPacket.url,
      encoding: 'gzip',
      compressedBytes: canonicalCountryPacket.length,
      decodedBytes: canonicalCountryPacketBuffer.byteLength,
      sha256: sha256(canonicalCountryPacket),
      header: canonicalCountryPacketHeader.words,
    },
    canonicalMesh: { url: legacySourceManifest.assets.canonicalMesh.url, encoding: 'gzip', compressedBytes: canonicalMeshBytes.length, decodedBytes: canonicalMeshDecoded.length, sha256: sha256(canonicalMeshBytes), header: meshHeader(canonicalMeshDecoded) },
  },
};
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);

compareOrWrite(canonicalCountryPacketPath, canonicalCountryPacket);
compareOrWrite(sourceManifestPath, manifestBytes);

console.log(JSON.stringify({ mode: checkOnly ? 'check' : 'build', ...manifest, milliseconds: Math.round(performance.now() - startedAt) }, null, 2));
