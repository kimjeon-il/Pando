import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';

import { createMapInteractionGate } from '../../assets/js/modules/map-interaction-gate.js';
import {
  isMapHost,
  mapSurfaceDragDeltaToCameraOffset,
  normalizeMapSurfaceDragDelta,
} from '../../assets/js/modules/map-host.js';
import { canUseMapLibreHost } from '../../assets/js/modules/maplibre-runtime.js';
import {
  mapHostViewToPandoView,
  pandoViewToMapHostView,
} from '../../assets/js/modules/map-host-projection-adapter.js';

const size = { width: 1440, height: 900 };
const padding = { left: 240, right: 320, top: 24, bottom: 56 };

test('MapHost surface drag contract normalizes input and reverses only the camera offset', () => {
  assert.deepEqual(normalizeMapSurfaceDragDelta(40, 15), [40, 15]);
  assert.deepEqual(normalizeMapSurfaceDragDelta(-40, -15), [-40, -15]);
  assert.deepEqual(normalizeMapSurfaceDragDelta(Number.NaN, Number.POSITIVE_INFINITY), [0, 0]);
  assert.deepEqual(mapSurfaceDragDeltaToCameraOffset(40, 15), [-40, -15]);
  assert.deepEqual(mapSurfaceDragDeltaToCameraOffset(-40, -15), [40, 15]);
  assert.deepEqual(mapSurfaceDragDeltaToCameraOffset(0, 0), [0, 0]);
});

test('MapHost contract requires a surface-relative dragBy implementation', () => {
  const methodNames = [
    'initialize', 'destroy', 'getKind', 'getProjectionKind', 'setProjectionKind',
    'getViewState', 'setViewState', 'getViewportSize', 'project', 'unproject',
    'dragBy', 'requestRepaint', 'resize', 'on', 'off',
  ];
  const host = Object.fromEntries(methodNames.map(name => [name, () => {}]));
  assert.equal(isMapHost(host), true);
  delete host.dragBy;
  assert.equal(isMapHost(host), false);
});

test('MapHost projection adapter round-trips flat and globe camera state', () => {
  for (const projection of ['flat', 'globe']) {
    const original = {
      flatCenter: [127.25, 37.5],
      flatZoom: 3.75,
      globeRotation: [-22.5, -48.25, 0],
      globeZoom: 2.4,
    };
    const host = pandoViewToMapHostView({ projection, view: original, size, padding });
    const restored = mapHostViewToPandoView(host, original, { size, padding });
    if (projection === 'flat') {
      assert.ok(Math.abs(restored.flatCenter[0] - original.flatCenter[0]) < 1e-9);
      assert.ok(Math.abs(restored.flatCenter[1] - original.flatCenter[1]) < 1e-9);
      assert.ok(Math.abs(restored.flatZoom - original.flatZoom) < 1e-9);
    } else {
      assert.ok(Math.abs(restored.globeRotation[0] - original.globeRotation[0]) < 1e-9);
      assert.ok(Math.abs(restored.globeRotation[1] - original.globeRotation[1]) < 1e-9);
      assert.ok(Math.abs(restored.globeZoom - original.globeZoom) < 1e-9);
    }
  }
});

test('flat projection remains equirectangular and is not constrained by Mercator latitude', async () => {
  const app = await readFile(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
  const gpuRenderer = await readFile(new URL('../../assets/js/modules/gpu-map-renderer.js', import.meta.url), 'utf8');
  const polygonPass = await readFile(new URL('../../assets/js/modules/gpu-polygon-overlay-pass.js', import.meta.url), 'utf8');
  const strokeRenderer = await readFile(new URL('../../assets/js/modules/gpu-stroke-renderer.js', import.meta.url), 'utf8');
  const adapter = await readFile(new URL('../../assets/js/modules/map-host-projection-adapter.js', import.meta.url), 'utf8');
  assert.match(app, /const FLAT_PROJECTION_KIND = 'equirectangular'/);
  assert.match(app, /d3\.geo\.equirectangular\(\)/);
  assert.doesNotMatch(app, /clamp\([^\n]*-85,\s*85\)/);
  for (const source of [gpuRenderer, polygonPass, strokeRenderer]) {
    assert.doesNotMatch(source, /log\(tan\(/);
    assert.match(source, /lat\s*-\s*uFlatCenter\.y/);
  }
  assert.doesNotMatch(adapter, /MIN_MERCATOR_LATITUDE|MAX_MERCATOR_LATITUDE/);
  const original = {
    flatCenter: [12, 89.5],
    flatZoom: 2,
    globeRotation: [0, 0, 0],
    globeZoom: 1,
  };
  const host = pandoViewToMapHostView({ projection: 'flat', view: original, size, padding });
  const restored = mapHostViewToPandoView(host, original, { size, padding });
  assert.equal(restored.flatCenter[1], original.flatCenter[1]);
});

test('MapInteractionGate keeps edit handles in Pando and Space pan in the host', () => {
  const gate = createMapInteractionGate();
  const handle = { closest: selector => selector.includes('.vertex-handle') ? {} : null };
  const background = { closest: () => null };
  assert.equal(gate.ownerForEvent(handle), 'pando');
  assert.equal(gate.ownerForEvent(background), 'host');
  gate.setDraftInputActive(true);
  assert.equal(gate.ownerForEvent(background), 'pando');
  gate.setForcedPan(true);
  assert.equal(gate.ownerForEvent(handle), 'host');
});

test('MapLibre capability detection never creates a probe WebGL context', () => {
  let canvasCreated = false;
  const supported = canUseMapLibreHost({
    windowObject: {
      document: {
        createElement() {
          canvasCreated = true;
          throw new Error('a capability check must not allocate a context');
        },
      },
      Worker: function Worker() {},
      WebGL2RenderingContext: function WebGL2RenderingContext() {},
    },
  });
  assert.equal(supported, true);
  assert.equal(canvasCreated, false);
  assert.equal(canUseMapLibreHost({
    windowObject: { document: {}, Worker: function Worker() {} },
  }), false);
});

test('MapLibre host is local, custom-layer based, and never mirrors canonical GIS through setData', async () => {
  const app = await readFile(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
  const host = await readFile(new URL('../../assets/js/modules/maplibre-map-host.js', import.meta.url), 'utf8');
  const layers = await readFile(new URL('../../assets/js/modules/pando-maplibre-custom-layers.js', import.meta.url), 'utf8');
  const renderer = await readFile(new URL('../../assets/js/modules/gpu-map-renderer.js', import.meta.url), 'utf8');
  assert.match(app, /const MAPLIBRE_VERSION = '6\.6\.0'/);
  assert.match(layers, /type:\s*'custom'/);
  assert.match(host, /projection:\s*\{ type: projectionKind === 'globe' \? 'globe' : 'mercator' \}/);
  assert.match(layers, /createRenderDevice\(\{/);
  assert.match(layers, /withGpuStateScope/);
  assert.match(renderer, /attachExternalDevice/);
  assert.match(renderer, /renderExternalSceneLayer/);
  assert.match(host, /setRenderPixelRatio/);
  assert.match(host, /map\?\.setPixelRatio\?\./);
  assert.match(host, /restorePandoLayersAfterContext/);
  assert.match(host, /addPandoLayers\(\{ replace: true \}\)/);
  assert.match(host, /map\.removeLayer\(id\)/);
  assert.match(host, /stage === 'interaction'.*cancelContextRecoveryRepaint\(\)/s);
  assert.match(host, /dragBy\(dx, dy, options = \{\}\)/);
  assert.match(host, /normalizeMapSurfaceDragDelta\(dx, dy\)/);
  assert.match(host, /dragGlobeBy\(dragX, dragY, options\)/);
  assert.match(host, /map\.panBy\(mapSurfaceDragDeltaToCameraOffset\(dragX, dragY\)/);
  assert.doesNotMatch(app, /mapHost\.panBy\(|function panMapBy\(/);
  assert.doesNotMatch(host, /^\s+panBy\(dx, dy/m);
  assert.doesNotMatch(`${host}\n${layers}\n${renderer}`, /\.setData\s*\(/);
  for (const name of ['maplibre-gl.mjs', 'maplibre-gl-shared.mjs', 'maplibre-gl-worker.mjs', 'maplibre-gl.css', 'LICENSE.txt']) {
    const info = await stat(new URL(`../../assets/vendor/maplibre-gl/6.6.0/${name}`, import.meta.url));
    assert.ok(info.size > 0, `${name} should be vendored`);
  }
});
