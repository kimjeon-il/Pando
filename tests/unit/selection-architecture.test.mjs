import {repositoryFrontendUrl} from '../helpers/frontend-source.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { collectCssRules } from '../../scripts/lib/css-analysis.mjs';
import { parseJavaScript, walkJavaScript } from '../../scripts/lib/source-analysis.mjs';

import { createRenderDevice, isRenderDevice } from "../../shared/frontend/js/modules/render-device.js";
import { createSelectionPacket } from "../../shared/frontend/js/modules/selection-packet.js";

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
    hoverRevision: 7,
    geometryRevision: 'geometry-4',
    styleRevision: 'style-2',
    countryBoundaryRevision: 'country-8',
    territorialBoundaryRevision: 'territorial-3',
    channels: { primary: [{ key: 'territorial:entity:RUS', boundaryOwnerId: 'RUS' },
      { key: 'territorial:entity:region', geometry, geometryRevision: 'region-5' }],
      secondary: ['FRA', 'POL'].map(id => ({ key: `territorial:entity:${id}`, boundaryOwnerId: id })) },
  });
  assert.equal(packet.revision, 12);
  assert.equal(packet.hoverRevision, 7);
  assert.equal(packet.geometryRevision, 'geometry-4');
  assert.equal(packet.styleRevision, 'style-2');
  assert.equal(packet.channels.primary[0].boundaryOwnerId, 'RUS');
  assert.deepEqual(packet.channels.secondary.map(item => item.boundaryOwnerId), ['FRA', 'POL']);
  assert.equal(packet.channels.primary[1].geometryRevision, 'region-5');
});

test('map CSS keeps base, GPU, overlay and interaction layers in painting order', async () => {
  const css = await readFile(new URL('../../shared/frontend/css/components/map-viewport.css', import.meta.url), 'utf8');
  const rules = collectCssRules(css);
  const zIndex = selector => {
    const values = rules.filter(rule => !rule.context && rule.selectors.includes(selector))
      .flatMap(rule => rule.declarations.filter(item => item.property === 'z-index').map(item => Number(item.value)));
    assert.equal(values.length, 1, `missing or conflicting layer ownership: ${selector}`);
    assert.ok(Number.isFinite(values[0]), selector);
    return values[0];
  };
  assert.ok(zIndex('.map-base-svg') < zIndex('.gpu-map-canvas'));
  assert.ok(zIndex('.gpu-map-canvas') < zIndex('.map-overlay-svg'));
  assert.equal(zIndex('.map-svg'), zIndex('.map-overlay-svg'));
  assert.ok(zIndex('.map-overlay-svg') < zIndex('.map-interaction-svg'));
  assert.ok(!rules.some(rule => rule.selectors.some(selector => selector.includes('gpu-selection-canvas'))));
});

test('main renderer creates the RenderDevice while selection consumes an injected device', async () => {
  for (const [file, ownsDevice] of [['gpu-map-renderer.js', true], ['selection-pass.js', false]]) {
    const code = parseJavaScript(await readFile(repositoryFrontendUrl(`assets/js/modules/${file}`), 'utf8'), { filePath: file });
    const factories = new Set(code.ast.body.filter(node => node.type === 'ImportDeclaration'
      && node.source.value.endsWith('/render-device.js')).flatMap(node => node.specifiers
      .filter(item => item.imported?.name === 'createRenderDevice').map(item => item.local.name)));
    let createsDevice = false, createsContext = false;
    walkJavaScript(code, node => {
      if (node.type !== 'CallExpression') return;
      if (node.callee.type === 'Identifier' && factories.has(node.callee.name)) createsDevice = true;
      if (node.callee.type === 'MemberExpression'
        && (node.callee.computed ? node.callee.property.value : node.callee.property.name) === 'getContext') createsContext = true;
    });
    assert.equal(createsDevice, ownsDevice, file);
    if (!ownsDevice) assert.equal(createsContext, false, file);
  }
});
