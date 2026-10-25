import { readApplicationOwners } from '../../scripts/lib/application-source.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createMapInteractionGate } from "../../shared/frontend/js/modules/map-interaction-gate.js";
import {
  normalizeMapSurfaceDragDelta,
} from "../../shared/frontend/js/modules/map-host.js";

test('MapHost surface drag contract preserves the user input direction', () => {
  assert.deepEqual(normalizeMapSurfaceDragDelta(40, 15), [40, 15]);
  assert.deepEqual(normalizeMapSurfaceDragDelta(-40, -15), [-40, -15]);
  assert.deepEqual(normalizeMapSurfaceDragDelta(Number.NaN, Number.POSITIVE_INFINITY), [0, 0]);
});

test('flat projection remains equirectangular and is not constrained by Mercator latitude', async () => {
  const app = readApplicationOwners('environment', 'map-projection');
  const gpuRenderer = await readFile(new URL("../../shared/frontend/js/modules/gpu-map-renderer.js", import.meta.url), 'utf8');
  const polygonPass = await readFile(new URL("../../shared/frontend/js/modules/gpu-polygon-overlay-pass.js", import.meta.url), 'utf8');
  const strokeRenderer = await readFile(new URL("../../shared/frontend/js/modules/gpu-stroke-renderer.js", import.meta.url), 'utf8');
  assert.match(app, /FLAT_PROJECTION_KIND = 'equirectangular'/);
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
