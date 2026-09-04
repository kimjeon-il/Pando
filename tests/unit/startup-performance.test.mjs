import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import {
  resolveRenderPixelRatioValue,
  visibleFlatWorldOffsets,
} from '../../assets/js/modules/gpu-map-renderer.js';
import {
  DATA_READINESS,
  READINESS_EVENTS,
  canMutateProject,
  resolveStartupLoadPolicy,
  transitionDataReadiness,
} from '../../assets/js/modules/startup-readiness.js';
import { inspectCanonicalCountryPacket } from '../../assets/js/modules/canonical-country-packet.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const appVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const manifest = JSON.parse(fs.readFileSync(path.join(root, `assets/data/world-preview-v${appVersion}.json`), 'utf8'));
const preview = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, `assets/data/countries-preview-v${appVersion}.geojson.gz`))));
const canonicalSource = fs.readFileSync(path.join(root, 'assets/data/countries-ne-5.1.1.geojson'), 'utf8').replaceAll('\r\n', '\n');
const canonical = JSON.parse(canonicalSource);
const canonicalGzip = fs.readFileSync(path.join(root, 'assets/data/countries-ne-5.1.1.geojson.gz'));
const canonicalPacketGzip = fs.readFileSync(path.join(root, `assets/data/countries-canonical-v${appVersion}.pcg.gz`));
const canonicalPacketBytes = zlib.gunzipSync(canonicalPacketGzip);
const canonicalPacketBuffer = canonicalPacketBytes.buffer.slice(
  canonicalPacketBytes.byteOffset,
  canonicalPacketBytes.byteOffset + canonicalPacketBytes.byteLength,
);
const canonicalPacketHeader = inspectCanonicalCountryPacket(canonicalPacketBuffer);
const meshHeader = bytes => {
  const prefix = new Uint32Array(bytes.buffer, bytes.byteOffset, 8);
  return new Uint32Array(bytes.buffer, bytes.byteOffset, prefix[1] >= 2 ? 12 : 8);
};
const previewMeshBytes = zlib.gunzipSync(fs.readFileSync(path.join(root, `assets/data/world-mesh-preview-v${appVersion}.bin.gz`)));
const previewMeshHeader = meshHeader(previewMeshBytes);
const canonicalMeshBytes = zlib.gunzipSync(fs.readFileSync(path.join(root, 'assets/data/world-mesh-v0.12.6.bin.gz')));
const canonicalMeshHeader = meshHeader(canonicalMeshBytes);
const workerSource = fs.readFileSync(path.join(root, 'assets/js/workers/data-loader-worker.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'assets/js/app.js'), 'utf8');

function countCoordinates(value) {
  if (Array.isArray(value) && value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') return 1;
  if (!Array.isArray(value)) return 0;
  return value.reduce((sum, item) => sum + countCoordinates(item), 0);
}

test('mobile DPR is capped at two while desktop retains the existing cap', () => {
  assert.equal(resolveRenderPixelRatioValue(4, true), 2);
  assert.equal(resolveRenderPixelRatioValue(3, true), 2);
  assert.equal(resolveRenderPixelRatioValue(1.5, true), 1.5);
  assert.equal(resolveRenderPixelRatioValue(4, false), 3);
  assert.equal(resolveRenderPixelRatioValue(2.5, false), 2.5);
  assert.equal(resolveRenderPixelRatioValue(3, false, 1.25), 1.25);
});

test('flat world copies are limited to intervals intersecting the viewport', () => {
  assert.deepEqual(visibleFlatWorldOffsets({
    translateX: 500,
    scale: 500,
    flatCenterRadians: 0,
    viewportWidth: 1000,
  }), [0]);
  assert.deepEqual(visibleFlatWorldOffsets({
    translateX: 500,
    scale: 100,
    flatCenterRadians: 0,
    viewportWidth: 1000,
  }), [-2 * Math.PI, 0, 2 * Math.PI]);
  assert.deepEqual(visibleFlatWorldOffsets({
    translateX: 500,
    scale: 1000 / (2 * Math.PI),
    flatCenterRadians: 0,
    viewportWidth: 1000,
  }), [0]);
  assert.deepEqual(visibleFlatWorldOffsets({
    translateX: -6000,
    scale: 500,
    flatCenterRadians: 0,
    viewportWidth: 1000,
  }), [2 * Math.PI]);
  assert.deepEqual(visibleFlatWorldOffsets({ scale: 0, viewportWidth: 1000 }), [0]);
});

test('readiness transitions enable mutations at geometry-ready and preserve them through enhancement', () => {
  let readiness = transitionDataReadiness('', READINESS_EVENTS.PREVIEW_READY);
  assert.equal(readiness, DATA_READINESS.PREVIEW);
  assert.equal(canMutateProject(readiness), false);
  readiness = transitionDataReadiness(readiness, READINESS_EVENTS.GEOMETRY_ERROR);
  assert.equal(readiness, DATA_READINESS.ERROR);
  assert.equal(canMutateProject(readiness), false);
  readiness = transitionDataReadiness(readiness, READINESS_EVENTS.RETRY_GEOMETRY);
  assert.equal(readiness, DATA_READINESS.PREVIEW);
  readiness = transitionDataReadiness(readiness, READINESS_EVENTS.GEOMETRY_READY);
  assert.equal(readiness, DATA_READINESS.EDITABLE);
  assert.equal(canMutateProject(readiness), true);
  readiness = transitionDataReadiness(readiness, READINESS_EVENTS.MESH_READY);
  assert.equal(readiness, DATA_READINESS.ENHANCED);
  assert.equal(canMutateProject(readiness), true);
});

test('startup load policy is sequential on every device while preserving diagnostic signals', () => {
  assert.equal(resolveStartupLoadPolicy({ layout: 'mobile', deviceMemory: 8, hardwareConcurrency: 8, effectiveType: '4g' }).mode, 'sequential');
  assert.equal(resolveStartupLoadPolicy({ layout: 'wide', deviceMemory: 4, hardwareConcurrency: 12, effectiveType: '4g' }).mode, 'sequential');
  assert.equal(resolveStartupLoadPolicy({ layout: 'wide', deviceMemory: 16, hardwareConcurrency: 16, effectiveType: '3g' }).mode, 'sequential');
  assert.equal(resolveStartupLoadPolicy({ layout: 'wide', deviceMemory: 16, hardwareConcurrency: 16, effectiveType: '4g', saveData: true }).mode, 'sequential');
  assert.equal(resolveStartupLoadPolicy({ layout: 'mobile', hardwareConcurrency: 8, effectiveType: '4g' }).mode, 'sequential');
  assert.equal(resolveStartupLoadPolicy({ layout: 'wide', hardwareConcurrency: 8, effectiveType: '4g' }).mode, 'sequential');
  assert.equal(resolveStartupLoadPolicy({ layout: 'wide', deviceMemory: 32, hardwareConcurrency: 32, effectiveType: '4g' }).reason, 'interaction-first-v1');
});

test('preview assets preserve country identity within the fixed size and geometry budgets', () => {
  assert.equal(preview.type, 'FeatureCollection');
  assert.equal(preview.features.length, 258);
  assert.equal(new Set(preview.features.map(feature => feature.id)).size, 258);
  assert.deepEqual(
    preview.features.map(feature => String(feature.id)),
    canonical.features.map(feature => String(feature.id)),
  );
  assert.equal(countCoordinates(preview.features.map(feature => feature.geometry.coordinates)), manifest.coordinateCount);
  assert.ok(manifest.coordinateCount <= 120_000);
  assert.ok(manifest.combinedCompressedBytes <= 3 * 1024 * 1024);
  assert.equal(manifest.previewSourceScale, '50m');
  assert.equal(manifest.previewSourceVersion, '5.1.1');
  assert.equal(manifest.previewSourceSha256.length, 64);
  assert.equal(manifest.canonicalSourceSha256.length, 64);
  assert.equal(manifest.supplementedCountryIds.length, 16);
  const koreaCoordinateCounts = Object.fromEntries(['KOR', 'PRK'].map(id => [
    id,
    countCoordinates(preview.features.find(feature => feature.id === id)?.geometry?.coordinates),
  ]));
  assert.ok(koreaCoordinateCounts.KOR >= 200);
  assert.ok(koreaCoordinateCounts.PRK >= 200);
  assert.ok(Math.max(koreaCoordinateCounts.KOR, koreaCoordinateCounts.PRK)
    / Math.min(koreaCoordinateCounts.KOR, koreaCoordinateCounts.PRK) <= 2);
  assert.equal(previewMeshHeader[2], 258);
  assert.equal(previewMeshHeader[1], 2);
  assert.deepEqual(Array.from(previewMeshHeader.subarray(8)), [516, 516, 1032, 258]);
  assert.equal(previewMeshHeader[3], manifest.meshVertices);
  assert.equal(previewMeshHeader[6], manifest.coordinateCount);
  assert.equal(canonicalMeshHeader[2], 258);
  assert.equal(canonicalMeshHeader[1], 2);
  assert.deepEqual(Array.from(canonicalMeshHeader.subarray(8)), [516, 516, 1032, 258]);
  assert.equal(canonicalMeshHeader[3], 1_028_628);
  assert.equal(canonicalMeshHeader[6], 548_464);
  for (const feature of preview.features) {
    assert.ok(['Polygon', 'MultiPolygon'].includes(feature.geometry?.type));
    assert.ok(feature.geometry.coordinates.length > 0);
  }
  assert.deepEqual(JSON.parse(zlib.gunzipSync(canonicalGzip)), canonical);
  assert.equal(manifest.assets.canonicalCountries.compressedBytes, canonicalGzip.length);
  assert.equal(manifest.assets.canonicalCountries.decodedBytes, Buffer.byteLength(canonicalSource));
  assert.equal(manifest.assets.canonicalCountryPacket.compressedBytes, canonicalPacketGzip.length);
  assert.equal(manifest.assets.canonicalCountryPacket.decodedBytes, canonicalPacketBytes.length);
  assert.deepEqual(manifest.assets.canonicalCountryPacket.header, canonicalPacketHeader.words);
  assert.deepEqual(manifest.assets.previewMesh.header, [...previewMeshHeader]);
  assert.deepEqual(manifest.assets.canonicalMesh.header, [...canonicalMeshHeader]);
});

test('staged loader separates editable geometry from the high-quality mesh and streams gzip', () => {
  assert.ok(workerSource.indexOf("type: 'preview-ready'") < workerSource.indexOf("type: 'geometry-ready'"));
  assert.match(workerSource, /type: 'mesh-ready'/);
  assert.match(workerSource, /type === 'geometry-applied'/);
  assert.match(workerSource, /pipeThrough\(new DecompressionStream\('gzip'\)\)/);
  assert.match(workerSource, /spec\.encoding === 'identity'/);
  assert.match(workerSource, /replaceAll\('\\r\\n', '\\n'\)/);
  assert.doesNotMatch(workerSource, /const chunks = \[\]/);
  assert.doesNotMatch(workerSource, /const merged = new Uint8Array/);
  assert.doesNotMatch(workerSource, /response\.clone\(\)/);
  assert.doesNotMatch(workerSource, /manifest\.assets\.canonicalCountries/);
  assert.doesNotMatch(workerSource, /countriesSourceBuffer/);
  assert.match(workerSource, /countryPacketBuffer/);
  assert.match(workerSource, /canonicalCountryPacketTransferables\(countryPacketBuffer\)/);
  const networkLoadSource = workerSource.slice(
    workerSource.indexOf("const response = await fetch(url"),
    workerSource.indexOf('validateAssetLength(result', workerSource.indexOf("const response = await fetch(url")),
  );
  assert.ok(networkLoadSource.indexOf('validateStoredAsset') < networkLoadSource.indexOf('cacheStoredBuffer'));
  assert.ok(networkLoadSource.indexOf('cacheStoredBuffer') < networkLoadSource.indexOf('decodeStoredBuffer'));
  const cacheWriteSource = workerSource.slice(
    workerSource.indexOf('async function cacheStoredBuffer'),
    workerSource.indexOf('function countedStream'),
  );
  assert.doesNotMatch(cacheWriteSource, /fetch\(/);
  assert.match(appSource, /reindexCountries\(geometry\.countries, true, \{ assumeCanonical: true \}\)/);
  assert.doesNotMatch(appSource, /pristineCountriesSourceBuffer|parsePristineCountries/);
  const promotionSource = appSource.slice(
    appSource.indexOf('async function completeGeometryInitialization'),
    appSource.indexOf('async function completeMeshEnhancement'),
  );
  assert.doesNotMatch(promotionSource, /resetProjectRenderState/);
  assert.doesNotMatch(promotionSource, /mapEditClient\.rebase/);
  assert.match(appSource, /READINESS_EVENTS\.GEOMETRY_READY/);
  assert.match(appSource, /READINESS_EVENTS\.MESH_READY/);
  assert.doesNotMatch(appSource.slice(appSource.indexOf('async function initProgressive'), appSource.indexOf('async function init()')), /deepClone\(geometry\.countries\)/);
});
