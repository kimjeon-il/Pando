import { readApplicationOwners } from '../../scripts/lib/application-source.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateCollection } from '../../assets/js/modules/gis-geometry-validation.js';
import { createGisWorkerHarness } from './helpers/gis-worker-harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const appSource = readApplicationOwners('gis-assembly');
const importServiceSource = fs.readFileSync(path.join(root, 'assets/js/modules/import-service.js'), 'utf8');

function feature(id, coordinates) {
  return {
    type: 'Feature',
    id,
    properties: { name: id },
    geometry: { type: 'MultiPolygon', coordinates: [coordinates] },
  };
}

const square = [[[0, 0], [0, 2], [2, 2], [2, 0], [0, 0]]];
const degenerate = [[[0, 0], [0, 0], [0, 0], [0, 0]]];

test('scoped GIS validation trusts unchanged canonical geometry and validates affected countries', async t => {
  const worker = createGisWorkerHarness(t);
  const collection = { type: 'FeatureCollection', features: [feature('affected', square), feature('trusted', degenerate)] };
  assert.equal((await worker.validate(collection, ['affected'])).ok, true);
  assert.equal((await worker.validate(collection)).ok, false);
});

test('scoped GIS overlap checks only compare pairs that contain an affected country', () => {
  const collection = {
    type: 'FeatureCollection',
    features: [feature('affected', square), feature('trusted-a', square), feature('trusted-b', square)],
  };
  let intersectionCalls = 0;
  const clipper = { intersection() { intersectionCalls += 1; return []; } };
  validateCollection(collection, ['affected'], clipper);
  assert.equal(intersectionCalls, 2);
  intersectionCalls = 0;
  validateCollection(collection, null, clipper);
  assert.equal(intersectionCalls, 3);
});

test('an empty scope falls back to full validation instead of silently trusting every country', async t => {
  const worker = createGisWorkerHarness(t);
  const collection = { type: 'FeatureCollection', features: [feature('invalid', degenerate)] };
  assert.equal((await worker.validate(collection, [])).ok, false);
});

test('actual GIS Worker isolates component pairs and retries polygon-clipping sweep failures', async t => {
  const secondSquare = [[[10, 10], [10, 12], [12, 12], [12, 10], [10, 10]]];
  const left = feature('left', square);
  left.geometry.coordinates.push(secondSquare);
  const right = feature('right', square);
  const worker = createGisWorkerHarness(t, { failFirstIntersection: true });
  const result = await worker.validate({ type: 'FeatureCollection', features: [left, right] }, ['left']);
  assert.equal(result.ok, true);
  assert.ok(result.intersectionAttempts >= 2);
});

test('country import validation has a timeout and validates imported IDs before a scoped merge', () => {
  assert.match(importServiceSource, /GIS_GEOMETRY_TIMEOUT_MS = 60_000/);
  assert.match(importServiceSource, /affectedIds: scopedIds\?\.length \? scopedIds : null/);
  assert.match(importServiceSource, /affectedIds\.add\(id\)/);
  assert.match(importServiceSource, /affectedIds: \[\.\.\.affectedIds\]/);
  assert.match(appSource, /markCountryGeometriesChanged: markCountryGeometriesChanged/);
  const committer = fs.readFileSync(path.join(root, 'assets/js/modules/gis-import-transaction.js'), 'utf8');
  assert.match(committer, /markCountryGeometriesChanged\(plan\.affectedIds \|\| importedIds(?:\)|,\s*\{)/);
  assert.match(importServiceSource, /importedFeatures\.map\(featureCountryId\)/);
  assert.doesNotMatch(importServiceSource, /importedFeatures\.length > 1/);
});
