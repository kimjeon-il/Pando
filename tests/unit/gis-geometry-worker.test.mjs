import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workerSource = fs.readFileSync(path.join(root, 'assets/js/workers/gis-geometry-worker.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'assets/js/app.js'), 'utf8');
const importServiceSource = fs.readFileSync(path.join(root, 'assets/js/modules/import-service.js'), 'utf8');

function feature(id, coordinates) {
  return {
    type: 'Feature',
    properties: { editor_id: id, editor_name: id },
    geometry: { type: 'MultiPolygon', coordinates: [coordinates] },
  };
}

function runWorker(collection, affectedIds = null, { intersection = null } = {}) {
  const messages = [];
  let intersectionCalls = 0;
  const self = {
    polygonClipping: {
      intersection(...args) {
        intersectionCalls += 1;
        return intersection ? intersection(...args) : [];
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

test('GIS overlap validation isolates component pairs and retries polygon-clipping sweep failures', () => {
  const secondSquare = [[[10, 10], [10, 12], [12, 12], [12, 10], [10, 10]]];
  const left = feature('left', square);
  left.geometry.coordinates.push(secondSquare);
  const right = feature('right', square);
  let attempts = 0;
  const result = runWorker({ type: 'FeatureCollection', features: [left, right] }, ['left'], {
    intersection(first, second) {
      attempts += 1;
      assert.equal(first.length, 1);
      assert.equal(second.length, 1);
      if (attempts === 1) throw new Error('Unable to find segment #1 in SweepLine tree.');
      return [];
    },
  });
  assert.equal(result.message.ok, true);
  assert.equal(attempts, 2);
});

test('country import validation has a timeout and validates imported IDs before a scoped merge', () => {
  assert.match(importServiceSource, /GIS_GEOMETRY_TIMEOUT_MS = 60_000/);
  assert.match(importServiceSource, /affectedIds: scopedIds\?\.length \? scopedIds : null/);
  assert.match(importServiceSource, /affectedIds\.add\(id\)/);
  assert.match(importServiceSource, /affectedIds: \[\.\.\.affectedIds\]/);
  assert.match(appSource, /markCountryGeometriesChanged\(plan\.affectedIds \|\| importedIds\)/);
  assert.match(importServiceSource, /importedFeatures\.map\(featureCountryId\)/);
  assert.doesNotMatch(importServiceSource, /importedFeatures\.length > 1/);
});
