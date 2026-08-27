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
  transitionDataReadiness,
} from '../../assets/js/modules/startup-readiness.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/data/world-preview-v0.29.0.json'), 'utf8'));
const preview = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, 'assets/data/countries-preview-v0.29.0.geojson.gz'))));
const canonical = JSON.parse(fs.readFileSync(path.join(root, 'assets/data/countries-ne-5.1.1.geojson'), 'utf8'));
const previewMeshBytes = zlib.gunzipSync(fs.readFileSync(path.join(root, 'assets/data/world-mesh-preview-v0.29.0.bin.gz')));
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
});

test('readiness transitions keep mutations canonical-only through error and retry', () => {
  let readiness = transitionDataReadiness('', READINESS_EVENTS.PREVIEW_READY);
  assert.equal(readiness, DATA_READINESS.PREVIEW);
  assert.equal(canMutateProject(readiness), false);
  readiness = transitionDataReadiness(readiness, READINESS_EVENTS.CANONICAL_ERROR);
  assert.equal(readiness, DATA_READINESS.ERROR);
  assert.equal(canMutateProject(readiness), false);
  readiness = transitionDataReadiness(readiness, READINESS_EVENTS.RETRY);
  assert.equal(readiness, DATA_READINESS.PREVIEW);
  readiness = transitionDataReadiness(readiness, READINESS_EVENTS.CANONICAL_READY);
  assert.equal(readiness, DATA_READINESS.CANONICAL);
  assert.equal(canMutateProject(readiness), true);
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
  assert.equal(canonicalMeshHeader[6], 548_466);
  for (const feature of preview.features) {
    assert.ok(['Polygon', 'MultiPolygon'].includes(feature.geometry?.type));
    assert.ok(feature.geometry.coordinates.length > 0);
  }
});

test('staged loader emits preview before canonical and transfers the pristine source buffer', () => {
  assert.ok(workerSource.indexOf("type: 'preview-ready'") < workerSource.indexOf("type: 'canonical-ready'"));
  assert.match(workerSource, /countriesSourceBuffer, meshBuffer/);
  assert.match(workerSource, /\[countriesSourceBuffer, meshBuffer\]/);
  assert.match(workerSource, /PROFILE === 'constrained'/);
  assert.match(appSource, /reindexCountries\(canonical\.countries, true\)/);
  assert.doesNotMatch(appSource.slice(appSource.indexOf('async function initProgressive'), appSource.indexOf('async function init()')), /deepClone\(canonical\.countries\)/);
});
