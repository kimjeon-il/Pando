import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createRenderDevice, isRenderDevice } from '../../assets/js/modules/render-device.js';
import { createSelectionPacket } from '../../assets/js/modules/selection-packet.js';

test('RenderDevice exposes the shared WebGL1 capability contract', () => {
  const extensions = new Map([
    ['OES_element_index_uint', {}],
    ['ANGLE_instanced_arrays', {}],
  ]);
  const gl = {
    MAX_TEXTURE_SIZE: 0x0d33,
    getContextAttributes: () => ({ stencil: true }),
    getExtension: name => extensions.get(name) || null,
    getParameter: parameter => parameter === 0x0d33 ? 8192 : 0,
  };
  const canvas = {};
  const device = createRenderDevice({ gl, canvas, version: 1, contextRevision: 7 });
  assert.equal(isRenderDevice(device), true);
  assert.equal(device.gl, gl);
  assert.equal(device.canvas, canvas);
  assert.equal(device.version, 1);
  assert.equal(device.contextRevision, 7);
  assert.deepEqual(device.capabilities, {
    uintIndices: true,
    instancing: true,
    stencil: true,
    maxTextureSize: 8192,
  });
});

test('SelectionPacket separates state, geometry, style, and boundary revisions', () => {
  const geometry = { type: 'LineString', coordinates: [[0, 0], [1, 1]] };
  const packet = createSelectionPacket({
    revision: 12,
    geometryRevision: 'geometry-4',
    styleRevision: 'style-2',
    countryBoundaryRevision: 'country-8',
    territorialBoundaryRevision: 'territorial-3',
    country: { hoverId: 'DEU', primaryId: 'RUS', secondaryIds: ['FRA', 'POL'] },
    generic: { primary: [{ key: 'region:one', geometry, geometryRevision: 'region-5' }] },
  });
  assert.equal(packet.revision, 12);
  assert.equal(packet.geometryRevision, 'geometry-4');
  assert.equal(packet.styleRevision, 'style-2');
  assert.equal(packet.country.primaryId, 'RUS');
  assert.deepEqual(packet.country.secondaryIds, ['FRA', 'POL']);
  assert.equal(packet.generic.primary[0].geometryRevision, 'region-5');
});

test('selection layer architecture uses one z1 MapLibre host with a legacy GPU fallback and z4 controls', async () => {
  const css = await readFile(new URL('../../assets/css/app.css', import.meta.url), 'utf8');
  const app = await readFile(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
  assert.match(css, /\.map-base-svg\s*\{\s*z-index:\s*0/);
  assert.match(css, /\.maplibre-host\s*\{\s*z-index:\s*1/);
  assert.match(css, /\.gpu-map-canvas\s*\{\s*z-index:\s*1/);
  assert.match(css, /\.map-interaction-svg\s*\{\s*z-index:\s*4/);
  assert.match(css, /\.map-svg,\s*\.map-overlay-svg\s*\{[\s\S]*?z-index:\s*2/);
  assert.doesNotMatch(css, /gpu-selection-canvas/);
  const mapHost = app.indexOf('mapHost = createPreferredMapHost(mapEl)');
  const projectedSvg = app.indexOf("svg = map.append('svg').attr('class', 'map-svg map-overlay-svg')", mapHost);
  const interactionSvg = app.indexOf("map.append('svg').attr('class', 'map-interaction-svg')", projectedSvg);
  assert.ok(mapHost > 0 && mapHost < projectedSvg && projectedSvg < interactionSvg);
  assert.match(app, /gpuMapRenderer\.attachExternalDevice\(device, \{ owner: 'maplibre' \}\)/);
  assert.doesNotMatch(app, /selectionCanvasHost|gpu-selection-canvas/);
});

test('main renderer owns the only RenderDevice and all shared GPU passes', async () => {
  const main = await readFile(new URL('../../assets/js/modules/gpu-map-renderer.js', import.meta.url), 'utf8');
  const selection = await readFile(new URL('../../assets/js/modules/selection-pass.js', import.meta.url), 'utf8');
  assert.match(main, /createRenderDevice\(\{/);
  assert.match(main, /getRenderDevice:\s*\(\)\s*=>\s*renderDevice/);
  assert.match(main, /createSceneColorCache\(\)/);
  assert.match(main, /createGpuPolygonOverlayPass\(\{/);
  assert.match(main, /createGpuStrokeRenderer\(\{/);
  assert.match(main, /selectionPass\.initialize\?\.\(renderDevice, \{ strokeRenderer, polygonPass: polygonOverlayPass \}\)/);
  assert.doesNotMatch(selection, /createRenderDevice|getContext\s*\(|\bdocument\b/);
});
