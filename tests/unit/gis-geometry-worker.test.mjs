import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workerSource = fs.readFileSync(path.join(root, 'assets/js/workers/gis-geometry-worker.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'assets/js/app.js'), 'utf8');

function feature(id, coordinates) {
  return {
    type: 'Feature',
    properties: { editor_id: id, editor_name: id },
    geometry: { type: 'MultiPolygon', coordinates: [coordinates] },
  };
}

function runWorker(collection, affectedIds = null) {
  const messages = [];
  let intersectionCalls = 0;
  const self = {
    polygonClipping: {
      intersection() {
        intersectionCalls += 1;
        return [];
      },
    },
    d3: { geo: { area: () => 0 } },
    postMessage(message) { messages.push(message); },
  };
  vm.runInNewContext(workerSource, { self, importScripts() {} });
  self.onmessage({ data: { id: 1, action: 'validate', collection, affectedIds } });
  return { message: messages[0], intersectionCalls };
}

const square = [[[0, 0], [0, 2], [2, 2], [2, 0], [0, 0]]];
const degenerate = [[[0, 0], [0, 0], [0, 0], [0, 0]]];

test('scoped GIS validation trusts unchanged canonical geometry and validates affected countries', () => {
  const collection = { type: 'FeatureCollection', features: [feature('affected', square), feature('trusted', degenerate)] };
  assert.equal(runWorker(collection, ['affected']).message.ok, true);
  assert.equal(runWorker(collection).message.ok, false);
});

test('scoped GIS overlap checks only compare pairs that contain an affected country', () => {
  const collection = {
    type: 'FeatureCollection',
    features: [feature('affected', square), feature('trusted-a', square), feature('trusted-b', square)],
  };
  assert.equal(runWorker(collection, ['affected']).intersectionCalls, 2);
  assert.equal(runWorker(collection).intersectionCalls, 3);
});

test('an empty scope falls back to full validation instead of silently trusting every country', () => {
  const collection = { type: 'FeatureCollection', features: [feature('invalid', degenerate)] };
  assert.equal(runWorker(collection, []).message.ok, false);
});

test('country import validation has a timeout and validates imported IDs before a scoped merge', () => {
  assert.match(appSource, /const GIS_GEOMETRY_TIMEOUT_MS = 60_000/);
  assert.match(appSource, /affectedIds: scopedIds\?\.length \? scopedIds : null/);
  assert.match(appSource, /affectedIds\.add\(id\)/);
  assert.match(appSource, /affectedIds: \[\.\.\.affectedIds\]/);
  assert.match(appSource, /markCountryGeometriesChanged\(plan\.affectedIds \|\| importedIds\)/);
  assert.match(appSource, /importedFeatures\.map\(featureCountryId\)/);
  assert.doesNotMatch(appSource, /importedFeatures\.length > 1/);
});
