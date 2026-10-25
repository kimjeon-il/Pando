import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  createHydroTileWindow,
  hydroTileSpecsForWindow,
  hydroViewportSizeClass,
} from "../../shared/frontend/js/modules/hydro-tile-window.js";
import { hydroVisibilityThresholdForMapZoom } from "../../shared/frontend/js/modules/physical-resources.js";

const manifest = Object.freeze({
  stages: Object.freeze([
    Object.freeze({ id: 0, minZoom: 6, columns: 8, rows: 4 }),
    Object.freeze({ id: 1, minZoom: 7, columns: 16, rows: 8 }),
  ]),
});

function flatWindow(overrides = {}) {
  return createHydroTileWindow({
    manifest,
    projection: 'flat',
    threshold: 6.5,
    width: 200,
    height: 160,
    scale: 10_000,
    flatCenter: [10, 20],
    ...overrides,
  });
}

test('published four hydro stages open only at map zoom 3.5, 7, 14, and 28', () => {
  const fourStageManifest = { stages: [
    { id: 0, minZoom: 6.0, columns: 8, rows: 4 },
    { id: 1, minZoom: 6.7, columns: 16, rows: 8 },
    { id: 2, minZoom: 7.0, columns: 32, rows: 16 },
    { id: 3, minZoom: 7.5, columns: 64, rows: 32 },
  ] };
  const cases = [
    [1, []], [3.4999, []],
    [3.5, [0]], [6.9999, [0]],
    [7, [0, 1]], [13.9999, [0, 1]],
    [14, [0, 1, 2]], [27.9999, [0, 1, 2]],
    [28, [0, 1, 2, 3]], [32, [0, 1, 2, 3]], [64, [0, 1, 2, 3]],
  ];
  for (const [zoom, expected] of cases) {
    const window = createHydroTileWindow({
      manifest: fourStageManifest,
      projection: 'flat',
      threshold: hydroVisibilityThresholdForMapZoom(zoom),
      width: 900, height: 700, scale: 1600, flatCenter: [0, 0],
    });
    assert.deepEqual(window.windows.map(stage => stage.stage), expected, `map zoom ${zoom}`);
  }
  assert.equal(hydroVisibilityThresholdForMapZoom(Number.NaN), Number.NEGATIVE_INFINITY);
});

test('hydro tile window ignores raw view revision inside the same quantized window', () => {
  const first = flatWindow({ flatCenter: [10, 20], viewRevision: 1 });
  const second = flatWindow({ flatCenter: [11, 20], viewRevision: 999 });
  assert.equal(second.signature, first.signature);
  assert.deepEqual(hydroTileSpecsForWindow(second), hydroTileSpecsForWindow(first));
});

test('hydro tile window changes only after a geographic tile boundary is crossed', () => {
  const before = flatWindow({ flatCenter: [44, 20] });
  const after = flatWindow({ flatCenter: [50, 20] });
  assert.notEqual(after.signature, before.signature);
  assert.notDeepEqual(hydroTileSpecsForWindow(after), hydroTileSpecsForWindow(before));
});

test('hydro threshold is quantized to the active stage set', () => {
  const withinStage = flatWindow({ threshold: 6.1 });
  const sameStage = flatWindow({ threshold: 6.9 });
  const nextStage = flatWindow({ threshold: 7 });
  assert.equal(sameStage.signature, withinStage.signature);
  assert.notEqual(nextStage.signature, withinStage.signature);
  assert.deepEqual([...new Set(hydroTileSpecsForWindow(nextStage).map(spec => spec.stage))], [0, 1]);
});

test('projection and viewport size class participate in the cache key', () => {
  const flat = flatWindow({ width: 255, height: 200 });
  const resized = flatWindow({ width: 257, height: 200 });
  const globe = createHydroTileWindow({
    manifest,
    projection: 'globe',
    threshold: 6.5,
    width: 255,
    height: 200,
    scale: 10_000,
    rotation: [-10, -20, 0],
  });
  assert.equal(hydroViewportSizeClass(255, 200), '1x1');
  assert.equal(hydroViewportSizeClass(257, 200), '2x1');
  assert.notEqual(resized.signature, flat.signature);
  assert.notEqual(globe.signature, flat.signature);
});

test('date-line equivalent centers share one wrapped tile window', () => {
  const east = flatWindow({ flatCenter: [179, 0] });
  const west = flatWindow({ flatCenter: [-179, 0] });
  assert.equal(west.signature, east.signature);
  assert.deepEqual(hydroTileSpecsForWindow(west), hydroTileSpecsForWindow(east));
});

test('quantized globe windows conservatively retain every legacy visible tile', () => {
  const distance = ([leftLongitude, leftLatitude], [rightLongitude, rightLatitude]) => {
    const radians = Math.PI / 180;
    const leftPhi = leftLatitude * radians;
    const rightPhi = rightLatitude * radians;
    const deltaPhi = (rightLatitude - leftLatitude) * radians;
    const deltaLambda = (rightLongitude - leftLongitude) * radians;
    const haversine = Math.sin(deltaPhi / 2) ** 2
      + Math.cos(leftPhi) * Math.cos(rightPhi) * Math.sin(deltaLambda / 2) ** 2;
    return 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(Math.max(0, 1 - haversine)));
  };
  for (const rotation of [[0, 0, 0], [-170, -65, 0], [175, 72, 0]]) {
    const width = 900;
    const height = 700;
    const scale = 520;
    const tileWindow = createHydroTileWindow({
      manifest,
      projection: 'globe',
      threshold: 7,
      width,
      height,
      scale,
      rotation,
    });
    const quantizedKeys = new Set(hydroTileSpecsForWindow(tileWindow).map(spec => `${spec.stage}/${spec.x}-${spec.y}`));
    const center = [-rotation[0], -rotation[1]];
    const radius = Math.asin(Math.min(1, Math.hypot(width, height) * 0.5 / scale));
    for (const stage of manifest.stages) {
      const tileLongitude = 360 / stage.columns;
      const tileLatitude = 180 / stage.rows;
      const tileRadius = Math.hypot(tileLongitude, tileLatitude) * Math.PI / 360;
      for (let y = 0; y < stage.rows; y += 1) {
        for (let x = 0; x < stage.columns; x += 1) {
          const tileCenter = [-180 + (x + 0.5) * tileLongitude, 90 - (y + 0.5) * tileLatitude];
          if (distance(center, tileCenter) <= radius + tileRadius + 0.04) {
            assert.ok(quantizedKeys.has(`${stage.id}/${x}-${y}`), `missing conservative tile ${stage.id}/${x}-${y}`);
          }
        }
      }
    }
  }
});

test('gpu hydro request cache no longer includes raw view revision', () => {
  const source = fs.readFileSync(new URL("../../shared/frontend/js/modules/gpu-hydro-preparation.js", import.meta.url), 'utf8');
  const start = source.indexOf('function requestHydroView');
  const end = source.indexOf('function loadHydroLogicalFeature', start);
  const requestSource = source.slice(start, end);
  assert.ok(requestSource.includes('createHydroTileWindow'));
  assert.doesNotMatch(requestSource, /viewState\?\.revision|currentRenderRevision/);
});
