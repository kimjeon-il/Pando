import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  createMapLayoutMetricsSnapshot,
  equirectangularCenterForAnchor,
} from '../../assets/js/modules/map-layout-metrics.js';

const appSource = await readFile(new URL('../../assets/js/app.js', import.meta.url), 'utf8');

function functionSource(name, nextName) {
  const start = appSource.indexOf(`function ${name}`);
  const end = appSource.indexOf(`function ${nextName}`, start);
  assert.ok(start >= 0 && end > start, `${name} source must exist`);
  return appSource.slice(start, end);
}

test('layout snapshot derives stable projection metrics without accessors', () => {
  const snapshot = createMapLayoutMetricsSnapshot({
    width: 1200,
    height: 800,
    dpr: 2,
    safeInsets: { left: 120, right: 80, top: 20, bottom: 40 },
    fitInsets: { left: 120, right: 260, top: 20, bottom: 40 },
    revision: 7,
    reason: 'panel-layout',
  });

  assert.equal(Object.getPrototypeOf(snapshot), Object.prototype);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.safe), true);
  assert.deepEqual(snapshot.safe, { left: 120, right: 80, top: 20, bottom: 40 });
  assert.deepEqual(snapshot.fitInsets, { left: 120, right: 260, top: 20, bottom: 40 });
  assert.equal(snapshot.contentWidth, 1000);
  assert.equal(snapshot.contentHeight, 740);
  assert.equal(snapshot.centerX, 620);
  assert.equal(snapshot.centerY, 390);
  assert.equal(snapshot.revision, 7);
  assert.equal(snapshot.reason, 'panel-layout');
});

test('flat equirectangular anchor center is solved exactly in one step', () => {
  const coordinate = [37.75, 64.5];
  const screenPoint = [815, 215];
  const translate = [600, 400];
  const scale = 420;
  const center = equirectangularCenterForAnchor({ coordinate, screenPoint, translate, scale });

  assert.ok(center);
  const projectedX = translate[0] + scale * (coordinate[0] - center[0]) * Math.PI / 180;
  const projectedY = translate[1] - scale * (coordinate[1] - center[1]) * Math.PI / 180;
  assert.ok(Math.abs(projectedX - screenPoint[0]) < 1e-9);
  assert.ok(Math.abs(projectedY - screenPoint[1]) < 1e-9);
});

test('flat anchor keeps periodic longitude and latitude safety bounds', () => {
  const center = equirectangularCenterForAnchor({
    coordinate: [-179.5, 89.8],
    screenPoint: [780, 800],
    translate: [600, 400],
    scale: 300,
    latitudeLimit: 89.999,
  });

  assert.ok(center[0] >= -180 && center[0] < 180);
  assert.equal(center[1], 89.999);
});

test('render and anchor paths consume cached layout while event paths refresh it', () => {
  const safeInsets = functionSource('currentMapSafeInsets', 'updateProjection');
  assert.doesNotMatch(safeInsets, /getComputedStyle|querySelector|getBoundingClientRect/);
  assert.match(safeInsets, /projectionLayoutMetrics\(\)\.safe/);
  const projectionLayout = functionSource('projectionLayoutMetrics', 'currentMapSafeInsets');
  assert.doesNotMatch(projectionLayout, /getComputedStyle|querySelector|getBoundingClientRect/);

  const anchor = functionSource('alignGeographicAnchor', 'transformMapView');
  assert.match(anchor, /equirectangularCenterForAnchor/);
  assert.match(anchor, /attempt < 4/);
  assert.doesNotMatch(anchor, /attempt < 12/);

  const resizeQueue = functionSource('queueMapResize', 'watchDevicePixelRatio');
  assert.match(resizeQueue, /refreshMapLayoutMetrics/);
  assert.match(appSource, /queueMapResize\('resize-observer'\)/);
  assert.match(appSource, /queueMapResize\('visual-viewport-resize'\)/);
  assert.match(appSource, /queueMapResize\('panel-layout'\)/);
  assert.match(appSource, /queueMapResize\('orientation-change'\)/);
  assert.match(appSource, /queueMapResize\('dpr-change'\)/);
  assert.equal((appSource.match(/refreshMapLayoutMetrics\(/g) || []).length, 3);
});
