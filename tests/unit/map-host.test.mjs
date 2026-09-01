import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createMapInteractionGate } from '../../assets/js/modules/map-interaction-gate.js';
import {
  isMapHost,
  normalizeMapSurfaceDragDelta,
} from '../../assets/js/modules/map-host.js';

test('MapHost surface drag contract preserves the user input direction', () => {
  assert.deepEqual(normalizeMapSurfaceDragDelta(40, 15), [40, 15]);
  assert.deepEqual(normalizeMapSurfaceDragDelta(-40, -15), [-40, -15]);
  assert.deepEqual(normalizeMapSurfaceDragDelta(Number.NaN, Number.POSITIVE_INFINITY), [0, 0]);
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

test('flat projection remains equirectangular and is not constrained by Mercator latitude', async () => {
  const app = await readFile(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
  const gpuRenderer = await readFile(new URL('../../assets/js/modules/gpu-map-renderer.js', import.meta.url), 'utf8');
  const polygonPass = await readFile(new URL('../../assets/js/modules/gpu-polygon-overlay-pass.js', import.meta.url), 'utf8');
  const strokeRenderer = await readFile(new URL('../../assets/js/modules/gpu-stroke-renderer.js', import.meta.url), 'utf8');
  assert.match(app, /const FLAT_PROJECTION_KIND = 'equirectangular'/);
  assert.match(app, /d3\.geo\.equirectangular\(\)/);
  assert.doesNotMatch(app, /clamp\([^\n]*-85,\s*85\)/);
  for (const source of [gpuRenderer, polygonPass, strokeRenderer]) {
    assert.doesNotMatch(source, /log\(tan\(/);
    assert.match(source, /lat\s*-\s*uFlatCenter\.y/);
  }
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
