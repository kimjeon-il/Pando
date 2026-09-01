import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { resolveRenderPixelRatioValue } from '../../assets/js/modules/gpu-map-renderer.js';
import {
  DATA_READINESS,
  READINESS_EVENTS,
  canMutateProject,
  resolveStartupLoadPolicy,
  transitionDataReadiness,
} from '../../assets/js/modules/startup-readiness.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/data/world-preview-v0.30.0.json'), 'utf8'));
const preview = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, 'assets/data/countries-preview-v0.30.0.geojson.gz'))));
const canonicalSource = fs.readFileSync(path.join(root, 'assets/data/countries-ne-5.1.1.geojson'), 'utf8').replaceAll('\r\n', '\n');
const canonical = JSON.parse(canonicalSource);
const canonicalGzip = fs.readFileSync(path.join(root, 'assets/data/countries-ne-5.1.1.geojson.gz'));
const previewMeshBytes = zlib.gunzipSync(fs.readFileSync(path.join(root, 'assets/data/world-mesh-preview-v0.30.0.bin.gz')));
const previewMeshHeader = new Uint32Array(previewMeshBytes.buffer, previewMeshBytes.byteOffset, 8);
const canonicalMeshBytes = zlib.gunzipSync(fs.readFileSync(path.join(root, 'assets/data/world-mesh-v0.12.6.bin.gz')));
const canonicalMeshHeader = new Uint32Array(canonicalMeshBytes.buffer, canonicalMeshBytes.byteOffset, 8);
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

test('adaptive load policy uses hardware and network signals instead of viewport alone', () => {
  assert.equal(resolveStartupLoadPolicy({ layout: 'mobile', deviceMemory: 8, hardwareConcurrency: 8, effectiveType: '4g' }).mode, 'parallel');
  assert.equal(resolveStartupLoadPolicy({ layout: 'wide', deviceMemory: 4, hardwareConcurrency: 12, effectiveType: '4g' }).mode, 'sequential');
  assert.equal(resolveStartupLoadPolicy({ layout: 'wide', deviceMemory: 16, hardwareConcurrency: 16, effectiveType: '3g' }).mode, 'sequential');
  assert.equal(resolveStartupLoadPolicy({ layout: 'wide', deviceMemory: 16, hardwareConcurrency: 16, effectiveType: '4g', saveData: true }).mode, 'sequential');
  assert.equal(resolveStartupLoadPolicy({ layout: 'mobile', hardwareConcurrency: 8, effectiveType: '4g' }).mode, 'sequential');
  assert.equal(resolveStartupLoadPolicy({ layout: 'wide', hardwareConcurrency: 8, effectiveType: '4g' }).mode, 'parallel');
});

test('preview assets preserve country identity within the fixed size and geometry budgets', () => {
  assert.equal(preview.type, 'FeatureCollection');
  assert.equal(preview.features.length, 258);
  assert.equal(new Set(preview.features.map(feature => feature.properties.editor_id)).size, 258);
  assert.deepEqual(
    preview.features.map(feature => String(feature.properties.editor_id)),
    canonical.features.map(feature => String(feature.properties.editor_id)),
  );
  assert.equal(countCoordinates(preview.features.map(feature => feature.geometry.coordinates)), manifest.coordinateCount);
  assert.ok(manifest.coordinateCount <= 60_000);
  assert.ok(manifest.combinedCompressedBytes <= 2 * 1024 * 1024);
  assert.ok(manifest.globalAreaError <= 0.005);
  assert.equal(previewMeshHeader[2], 258);
  assert.equal(previewMeshHeader[3], manifest.meshVertices);
  assert.equal(previewMeshHeader[6], manifest.coordinateCount);
  assert.equal(canonicalMeshHeader[2], 258);
  assert.equal(canonicalMeshHeader[3], 1_028_628);
  assert.equal(canonicalMeshHeader[6], 548_464);
  for (const feature of preview.features) {
    assert.ok(['Polygon', 'MultiPolygon'].includes(feature.geometry?.type));
    assert.ok(feature.geometry.coordinates.length > 0);
  }
  assert.deepEqual(JSON.parse(zlib.gunzipSync(canonicalGzip)), canonical);
  assert.equal(manifest.assets.canonicalCountries.compressedBytes, canonicalGzip.length);
  assert.equal(manifest.assets.canonicalCountries.decodedBytes, Buffer.byteLength(canonicalSource));
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
  assert.match(appSource, /reindexCountries\(geometry\.countries, true\)/);
  assert.match(appSource, /READINESS_EVENTS\.GEOMETRY_READY/);
  assert.match(appSource, /READINESS_EVENTS\.MESH_READY/);
  assert.doesNotMatch(appSource.slice(appSource.indexOf('async function initProgressive'), appSource.indexOf('async function init()')), /deepClone\(geometry\.countries\)/);
});
