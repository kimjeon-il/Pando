import test from 'node:test';
import assert from 'node:assert/strict';
import { createGpuPolygonOverlayPass } from '../../assets/js/modules/gpu-polygon-overlay-pass.js';
import { createGpuStrokeRenderer } from '../../assets/js/modules/gpu-stroke-renderer.js';
import { createSelectionPass } from '../../assets/js/modules/selection-pass.js';
import { drawGpuBaseScene } from '../../assets/js/modules/gpu-base-scene-pass.js';
import { drawGpuInteractionPass } from '../../assets/js/modules/gpu-interaction-pass.js';
import { prepareGpuBaseScene, prepareGpuInteractionPlan } from '../../assets/js/modules/gpu-scene-preparation.js';

function glFixture() {
  const gl = { createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}),
    getShaderParameter: () => true, getProgramParameter: () => true, getAttribLocation: () => 0,
    getUniformLocation: (_program, name) => name, isContextLost: () => false };
  for (const name of ['shaderSource', 'compileShader', 'deleteShader', 'attachShader', 'linkProgram', 'deleteProgram',
    'bindBuffer', 'bufferData', 'deleteBuffer', 'useProgram', 'disable', 'enable', 'blendFuncSeparate', 'uniform4f',
    'enableVertexAttribArray', 'vertexAttribPointer', 'uniform2f', 'uniform1f', 'uniform3fv', 'uniform1i',
    'drawElements', 'disableVertexAttribArray']) gl[name] = () => {};
  return gl;
}

const frame = { viewport: [100, 100], translate: [50, 50], flatCenter: [0, 0], rowX: [1, 0, 0], rowY: [0, 1, 0], rowZ: [0, 0, 1], scale: 1, mode: 1 };
test('prepared-only polygon submission reports a missing resource without allocating or enqueueing', () => {
  const gl = glFixture();
  const pass = createGpuPolygonOverlayPass();
  pass.initialize({ gl, version: 2, capabilities: { uintIndices: true } });
  let allocations = 0;
  gl.createBuffer = () => { allocations++; return {}; };
  const packet = { key: 'pending', positions: new Float32Array([0, 0, 1, 0, 0, 1]), indices: new Uint32Array([0, 1, 2]) };
  const result = pass.drawPackets([packet], { viewport: [100, 100], mode: 1 }, { preparedOnly: true });
  assert.equal(allocations, 0);
  assert.deepEqual(result.missingKeys, ['pending']);
  assert.deepEqual(result.renderedKeys, []);
  pass.dispose();
});

test('selection prepares each shared country packet once and forwards prepared-only drawing', () => {
  const pass = createSelectionPass();
  const prepared = [], optionsSeen = [];
  pass.initialize({ gl: {}, version: 2, capabilities: {} }, { strokeRenderer: {
    isAvailable: () => true, stats: () => ({ gpuHealth: 'healthy', selfTestPassed: true }),
    ensureResource: packet => prepared.push(packet.key),
    drawBatches: (batches, _frame, options) => { optionsSeen.push(options); return { succeeded: true, renderedKeys: batches.map(batch => batch.key) }; },
  } });
  pass.setCountryBoundaryResources({ revision: '1', visibleIds: ['A', 'B'], pendingIds: [],
    strokeResources: { selectionBase: { ownerIds: ['A', 'B'], packet: { key: 'shared' } } } });
  pass.updateData({ country: { primaryId: 'A', secondaryIds: ['B'] }, countryBoundaryRevision: '1' });
  assert.equal(typeof pass.prepare, 'function');
  pass.prepare();
  assert.deepEqual(prepared, ['shared']);
  pass.draw({}, {}, { frameContext: { frameId: 1 }, preparedOnly: true });
  assert.ok(optionsSeen.length > 0);
  assert.ok(optionsSeen.every(options => options?.preparedOnly === true));
  assert.deepEqual(prepared, ['shared']);
});

test('base pass preserves terrain, front-to-back territory, country, water and stroke order without preparing resources', () => {
  const calls = [];
  const gl = glFixture();
  for (const name of ['viewport', 'colorMask', 'clearColor', 'clearStencil', 'clear', 'stencilMask', 'stencilFunc', 'stencilOp']) gl[name] = () => {};
  const polygonOverlayPass = {
    hasResource: () => true,
    ensureResource: () => assert.fail('draw initiated polygon preparation'),
    drawPackets: (packets, _frame, options) => {
      assert.equal(options.preparedOnly, true);
      const keys = packets.map(packet => packet.key); calls.push(...keys);
      return { renderedKeys: keys, missingKeys: [] };
    },
  };
  const strokeRenderer = { hasResource: () => true, ensureResource: () => assert.fail('draw initiated stroke preparation'),
    drawBatches: (packets, _frame, options) => {
      assert.equal(options.preparedOnly, true); calls.push('stroke');
      return { renderedKeys: packets.map(packet => packet.key), missingKeys: [] };
    } };
  const range = { ranges: [{ first: 0, count: 3 }] };
  const result = drawGpuBaseScene({ gl, frame: {}, width: 10, height: 10,
    terrainVisible: true, terrainStyle: 'neutral', countriesVisible: true,
    countries: { mesh: { triangleIndices: { length: 3 } }, landMaskProgram: 'mask', fillProgram: 'country' },
    prepared: { baseTriangleDraw: range, baseBoundaryDraw: range, overrideTriangleDraw: range, overrideBoundaryDraw: range,
      deferredOverlayKeys: new Set(), failedOverlayKeys: new Set(), territoryItems: [
        { kind: 'polygon', packet: { key: 'parent', role: 'territorial-fill', territoryDepth: 1, order: 1 } },
        { kind: 'polygon', packet: { key: 'child', role: 'territorial-fill', territoryDepth: 2, order: 2 } },
      ].reverse(), polygonItems: [{ kind: 'polygon', packet: { key: 'generic' } }], strokeItems: [{ kind: 'stroke', packet: { key: 'line' } }] },
  }, { polygonOverlayPass, strokeRenderer, drawProgram: program => calls.push(program),
    renderTerrain: () => calls.push('terrain'), drawHydro: category => calls.push(category),
    drawCountryBoundaryStrokes: () => { calls.push('boundary'); return { succeeded: true }; } });
  assert.deepEqual(calls, ['mask', 'terrain', 'child', 'parent', 'country', 'generic', 'lake', 'lake-boundary', 'river', 'border-river', 'boundary', 'stroke']);
  assert.deepEqual(result.overlayMissingKeys, []);
});

test('overlay preparation defers excess work and keeps protected uploads within the existing budget policy', () => {
  const uploaded = [];
  const pass = { hasResource: () => false, ensureResource: packet => { uploaded.push(packet.key); return { resource: { byteLength: packet.byteLength } }; } };
  const result = prepareGpuBaseScene({ mesh: null, frame: {}, budgetBytes: 65536,
    scene: { polygons: [{ key: 'protected', protected: true, byteLength: 40000 },
      { key: 'deferred', byteLength: 40000 }, { key: 'small', byteLength: 10000 }], strokes: [] } },
  { polygonOverlayPass: pass, strokeRenderer: pass });
  assert.deepEqual(uploaded, ['protected', 'small']);
  assert.deepEqual([...result.deferredOverlayKeys], ['deferred']);
  assert.equal(result.overlayUploadBytes, 50000);
});

test('same-key polygon revision and LOD replacements are prepared before draw', () => {
  const pass = createGpuPolygonOverlayPass();
  pass.initialize({ gl: glFixture(), version: 2, capabilities: { uintIndices: true } });
  const original = { key: 'edited', geometryRevision: 1, lod: 'low', positions: new Float32Array([0, 0, 1, 0, 0, 1]), indices: new Uint32Array([0, 1, 2]) };
  for (const packet of [original, { ...original, geometryRevision: 2 }, { ...original, geometryRevision: 2, lod: 'high' }]) {
    prepareGpuBaseScene({ frame: {}, scene: { polygons: [packet] } }, { polygonOverlayPass: pass });
    const result = pass.drawPackets([packet], frame, { preparedOnly: true });
    assert.deepEqual(result.renderedKeys, ['edited']);
    assert.deepEqual(result.missingKeys, []);
  }
  pass.dispose();
});

test('same-key stroke revision and LOD replacements are prepared before draw', () => {
  const gl = new Proxy(glFixture(), { get(target, name) {
    if (name in target) return target[name];
    if (/^[A-Z0-9_]+$/.test(name)) return name;
    if (name.startsWith('create')) return () => ({});
    if (name === 'getParameter') return () => [0, 0, 16, 16];
    if (name === 'checkFramebufferStatus') return () => 'FRAMEBUFFER_COMPLETE';
    if (name === 'readPixels') return (...args) => args.at(-1).fill(255);
    if (name === 'isEnabled') return () => false;
    return () => {};
  } });
  const pass = createGpuStrokeRenderer();
  assert.equal(pass.initialize({ gl, version: 2, capabilities: { instancing: true } }), true);
  const original = { key: 'edited-stroke', geometryRevision: 1, lod: 'low', style: { width: 2 }, startsEnds: new Float32Array([0, 0, 1, 1]) };
  for (const packet of [original, { ...original, geometryRevision: 2 }, { ...original, geometryRevision: 2, lod: 'high' }]) {
    prepareGpuBaseScene({ frame, scene: { strokes: [packet] } }, { strokeRenderer: pass });
    const result = pass.drawBatches([packet], frame, { preparedOnly: true });
    assert.deepEqual(result.renderedKeys, ['edited-stroke']);
    assert.deepEqual(result.missingKeys, []);
  }
  pass.dispose();
});

test('same-key polygon replacements obey the frame budget and resume next frame', () => {
  const pass = createGpuPolygonOverlayPass();
  pass.initialize({ gl: glFixture(), version: 2, capabilities: { uintIndices: true } });
  const packets = ['one', 'two'].map(key => ({ key, geometryRevision: 1, positions: new Float32Array(12000), indices: new Uint32Array(6000) }));
  for (const packet of packets) pass.ensureResource(packet);
  const updated = packets.map(packet => ({ ...packet, geometryRevision: 2 }));
  const input = { frame, scene: { polygons: updated }, budgetBytes: 65536 };
  const first = prepareGpuBaseScene(input, { polygonOverlayPass: pass });
  assert.deepEqual([...first.deferredOverlayKeys], ['two']);
  assert.equal(pass.hasPreparedResource(updated[0]), true);
  assert.equal(pass.hasPreparedResource(updated[1]), false);
  prepareGpuBaseScene(input, { polygonOverlayPass: pass });
  assert.equal(pass.hasPreparedResource(updated[1]), true);
  pass.dispose();
});

test('selection preparation attributes resource build and upload metrics without double counting draw', () => {
  const pass = createSelectionPass();
  let built = false;
  pass.initialize({ gl: {}, version: 2, capabilities: {} }, { strokeRenderer: {
    isAvailable: () => true,
    stats: () => ({ buildCount: Number(built), buildMs: built ? 7 : 0, uploadBytes: built ? 128 : 0 }),
    ensureResource: () => { built = true; },
    drawBatches: batches => ({ succeeded: true, renderedKeys: batches.map(batch => batch.key) }),
  } });
  pass.setCountryBoundaryResources({ revision: '1', visibleIds: ['A'], pendingIds: [], strokeResources: { selectionBase: { ownerIds: ['A'], packet: { key: 'shared' } } } });
  pass.updateData({ country: { primaryId: 'A' }, countryBoundaryRevision: '1' });
  pass.prepare();
  pass.prepare();
  pass.draw({}, {}, { frameContext: {}, preparedOnly: true });
  assert.equal(pass.stats().bufferBuildCount, 1);
  assert.equal(pass.stats().bufferBuildMs, 7);
  assert.equal(pass.stats().bufferUploadBytes, 128);
});

test('interaction pass submits prepared priorities and ranges then composites before selection and strokes', () => {
  const calls = [];
  const gl = new Proxy(glFixture(), { get: (target, key) => key in target ? target[key] : () => {} });
  const polygonOverlayPass = { hasResource: () => true, hasPreparedResource: () => true,
    ensureResource: () => assert.fail('draw started preparation'),
    drawPackets: (packets, _frame, options) => { assert.equal(options.preparedOnly, true); calls.push(...packets.map(packet => packet.key)); return { succeeded: true, renderedKeys: packets.map(packet => packet.key) }; },
    drawResourceItems: items => { calls.push(...items.map(item => item.key)); return { succeeded: true, renderedKeys: items.map(item => item.key) }; } };
  const plan = prepareGpuInteractionPlan({
    interaction: { previewPackets: [{ kind: 'polygon', packet: { key: 'preview' } }, { kind: 'stroke', packet: { key: 'preview-outline' } }], draftPackets: [],
      genericFillItems: [{ key: 'hover', priority: 2 }, { key: 'primary', priority: 4 }] },
    emphasis: { selectedIds: new Set(['A']), primaryId: 'A', primaryIds: new Set(['A']), hoverId: '', priorities: {} },
    mesh: { triangleRangesByCountryId: new Map([['A', [{ first: 2, count: 3 }]]]) }, overrideIds: new Set(), countriesVisible: true, isPending: () => false, isVisible: () => true,
  }, polygonOverlayPass);
  const dependencies = { polygonOverlayPass,
    strokeRenderer: { drawBatches: packets => { calls.push(...packets.map(packet => packet.key)); return { succeeded: true }; } },
    selectionPass: { draw: () => { calls.push('selection'); return {}; } },
    drawHydro: category => calls.push(category), drawCountryRanges: ranges => { if (ranges.base.length) { assert.deepEqual(ranges.base, [{ first: 2, count: 3 }]); calls.push('country'); } },
    fillCache: { finishScene: () => calls.push('finish'), composite: () => { calls.push('composite'); return true; } } };
  const result = drawGpuInteractionPass({ gl, frame, viewport: {}, fillTargetReady: true, prepared: plan }, dependencies);
  assert.equal(result.fillOwner, 'gpu');
  assert.deepEqual(calls, ['lake', 'river', 'border-river', 'preview', 'country', 'primary', 'hover', 'finish', 'composite', 'selection', 'preview-outline']);
  calls.length = 0;
  const fallback = drawGpuInteractionPass({ gl, frame, viewport: {}, fillTargetReady: true, prepared: { ...plan, fillReady: false } }, dependencies);
  assert.equal(fallback.fillOwner, 'svg');
  assert.deepEqual(fallback.genericFillResult.renderedKeys, []);
  assert.deepEqual(fallback.previewResults[0].missingKeys, ['preview']);
  assert.deepEqual(calls, ['lake', 'river', 'border-river', 'finish', 'selection', 'preview-outline']);
});
