import test from 'node:test';
import assert from 'node:assert/strict';
import { planSelectionEntry, planHoverEntry, selectionCoverage, selectionFrameOwnership } from '../../assets/js/modules/selection-overlay-plan.js';
import * as plans from '../../assets/js/modules/selection-overlay-plan.js';
import { resolveMapInteractionStyle } from '../../assets/js/modules/map-interaction-style.js';
import { createSelectionPass } from '../../assets/js/modules/selection-pass.js';
import { createGpuPolygonOverlayPass } from '../../assets/js/modules/gpu-polygon-overlay-pass.js';

const feature = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [] } };
const base = { ref: { domain: 'territorial', type: 'entity', id: 'DEU', key: 'territorial:entity:DEU' },
  channel: 'primary', baseBoundaryOwnerId: 'DEU', feature, boundary: { feature, revision: 'r1' },
  outlineVisible: true, selectionStyle: { color: 'blue', primary: { fillAlpha: 0.2 }, secondary: { fillAlpha: 0.1 } } };
test('hover keeps pending country fill and generic polygon fill ownership distinct', () => {
  const pending = planHoverEntry({ ...base, pendingCountry: true, hoverStyle: { color: 'blue', fillAlpha: 0.1 } });
  assert.equal(pending.stroke, null);
  assert.equal(pending.fill.fillAlpha, 0.1);
  assert.equal(pending.fillRequest, null);
  const generic = planHoverEntry({ ...base, ref: { domain: 'hydro', key: 'river:1' }, baseBoundaryOwnerId: '', hoverStyle: { color: 'blue', fillAlpha: 0.1 } });
  assert.equal(generic.fillRequest.singleResourceOnly, true);
  assert.equal(generic.stroke.geometry, feature);
});
test('pending country uses a temporary fill and fallback without submitting stale country geometry', () => {
  const input = { ...base, pendingCountry: true }; const before = structuredClone(input);
  const plan = planSelectionEntry(input);
  assert.equal(plan.stroke, null);
  assert.deepEqual(plan.fill, { color: 'blue', fillAlpha: 0.2 });
  assert.equal(plan.fallback.kind, 'base');
  assert.deepEqual(input, before);
});
test('owned country boundary and candidate use prepared generic geometry, not canonical country stroke', () => {
  for (const input of [{ ...base, boundary: { ...base.boundary, owned: true } }, { ...base, channel: 'candidate' }]) {
    const plan = planSelectionEntry(input);
    assert.equal(plan.stroke.boundaryOwnerId, undefined);
    assert.equal(plan.stroke.geometry, feature);
    assert.equal(plan.fallback.kind, 'geometry');
  }
  assert.equal(planSelectionEntry({ ...base, channel: 'candidate', pendingCountry: true }).fill, null);
});
test('generic polygons request fill; interaction paths and disabled outlines do not invent a stroke', () => {
  base.baseBoundaryOwnerId = 'DEU';
  const ref = { domain: 'generic', key: 'lake:a', id: 'a' };
  const plan = planSelectionEntry({ ...base, ref, baseBoundaryOwnerId: '', outlineVisible: false });
  assert.equal(plan.fillRequest.objectKey, 'lake:a');
  assert.equal(plan.stroke, null);
  assert.equal(plan.fallback, null);
  assert.equal(planSelectionEntry({ ...base, baseBoundaryOwnerId: '', ref: { ...ref, domain: 'interaction' } }).fillRequest, null);
});
test('hard GPU failures never retire SVG coverage even if stale rendered keys remain', () => {
  const channels = { primary: { renderedKeys: ['territorial:entity:DEU'] } };
  for (const succeeded of [true, false]) for (const failure of [{ contextLost: true }, { error: new Error('draw failed') }, { gpuHealth: 'unhealthy' }, { gpuHealth: 'unavailable' }]) {
    const coverage = selectionCoverage({ succeeded, channels, ...failure },
      { succeeded, renderedKeys: ['fill'], ...failure }, new Map([['DEU', ['fill']]]));
    assert.equal(coverage.renderedKeys.primary.size, 0);
    assert.equal(coverage.gpuFilledObjectKeys.size, 0);
  }
  assert.equal(selectionCoverage({ succeeded: true, channels }, null, new Map()).renderedKeys.primary.has('territorial:entity:DEU'), true);
});

test('real selection pass preserves ready stroke coverage alongside a missing country', () => {
  const pass = createSelectionPass();
  pass.initialize({ gl: {}, version: 2, capabilities: {} }, { strokeRenderer: {
    isAvailable: () => true, stats: () => ({ gpuHealth: 'healthy', selfTestPassed: true }),
    drawBatches: batches => ({ succeeded: true, renderedKeys: batches.map(batch => batch.key), drawCallCount: 1 }),
  } });
  pass.setCountryBoundaryResources({ revision: 'r1', visibleIds: ['DEU', 'FRA'], pendingIds: ['FRA'],
    strokeResources: { selectionBase: { ownerIds: ['DEU'], packet: { key: 'base', preparedGeometry: {} } } } });
  pass.updateData({ channels: { secondary: ['DEU', 'FRA'].map(id => ({ key: `territorial:entity:${id}`, boundaryOwnerId: id })) }, countryBoundaryRevision: 'r1' });
  const result = pass.draw({}, {}, { frameContext: { frameId: 1 } });
  assert.equal(result.succeeded, false);
  assert.deepEqual(result.channels.secondary.missingKeys, ['territorial:entity:FRA']);
  const coverage = selectionCoverage(result, null, new Map());
  assert.deepEqual([...coverage.renderedKeys.secondary], ['territorial:entity:DEU']);
});

test('real polygon pass retires fills only for objects whose every resource was drawn', () => {
  // Only the WebGL API is replaced; resource installation and coverage use the real pass.
  const gl = { createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}),
    getShaderParameter: () => true, getProgramParameter: () => true, getAttribLocation: () => 0,
    getUniformLocation: (_program, name) => name, isContextLost: () => false };
  for (const method of ['shaderSource', 'compileShader', 'deleteShader', 'attachShader', 'linkProgram', 'deleteProgram',
    'bindBuffer', 'bufferData', 'deleteBuffer', 'useProgram', 'disable', 'enable', 'blendFuncSeparate', 'uniform4f',
    'enableVertexAttribArray', 'vertexAttribPointer', 'uniform2f', 'uniform1f', 'uniform3fv', 'uniform1i',
    'drawElements', 'disableVertexAttribArray']) gl[method] = () => {};
  const pass = createGpuPolygonOverlayPass();
  assert.equal(pass.initialize({ gl, version: 2, capabilities: { uintIndices: true } }), true);
  pass.ensureResource({ key: 'ready', positions: new Float32Array([0, 0, 1, 0, 0, 1]), indices: new Uint32Array([0, 1, 2]) });
  const result = pass.drawResourceItems([{ key: 'ready' }, { key: 'pending' }],
    { viewport: [100, 100], translate: [0, 0], flatCenter: [0, 0], scale: 1, mode: 1 });
  assert.equal(result.succeeded, false);
  assert.deepEqual(result.missingKeys, ['pending']);
  assert.deepEqual(result.renderedKeys, ['ready']);
  const resources = new Map([['complete', ['ready']], ['partial', ['ready', 'pending']], ['missing', ['pending']], ['empty', []]]);
  assert.deepEqual([...selectionCoverage(null, result, resources).gpuFilledObjectKeys], ['complete']);
});

test('display planning orders country, subunit and region ownership without changing inputs', () => {
  assert.equal(typeof plans.selectionDisplayPlan, 'function');
  const country = { domain: 'territorial', type: 'entity', id: 'DEU', key: 'territorial:entity:DEU' };
  const subunit = { domain: 'territorial', type: 'entity', id: 'a', key: 'territorial:entity:a' };
  const region = { domain: 'territorial', type: 'entity', id: 'b', key: 'territorial:entity:b' };
  const snapshot = { selection: { items: [region, subunit, country], primaryKey: '' }, hover: null };
  const state = { territorialEntities: [{ id: 'a', properties: { entityKind: 'general', parentId: 'DEU' } },
    { id: 'b', properties: { entityKind: 'regional', parentId: '' } }] };
  const entries = plans.selectionEntries(snapshot, state, {
    territorialEntityById: id => state.territorialEntities.find(entity => entity.id === id),
  });
  const before = structuredClone({ snapshot, state, entries });
  const style = resolveMapInteractionStyle();
  const plan = plans.selectionDisplayPlan({ entries, style });
  assert.deepEqual(plan.items.map(item => item.entry.key), [country.key, subunit.key, region.key]);
  assert.deepEqual(plan.boundaryOwnersByKey.get(country.key), []);
  assert.deepEqual(plan.boundaryOwnersByKey.get(subunit.key).map(entry => entry.key), [country.key]);
  assert.deepEqual(plan.boundaryOwnersByKey.get(region.key).map(entry => entry.key), [country.key, subunit.key]);
  assert.deepEqual(plan.fillMasks.map(item => [item.key, item.priority, item.depth, item.fillAlpha]),
    [[country.key, 3, 0, 0.063], [subunit.key, 3, 1, 0.063], [region.key, 3, 0, 0.063]]);
  assert.deepEqual({ snapshot, state, entries }, before);
});

test('hover suppression and disabled outlines remove ineligible hierarchy owners while retaining tool guides', () => {
  assert.equal(typeof plans.selectionDisplayPlan, 'function');
  const entries = [
    { key: 'selected', role: 'primary', priority: 4, ref: { domain: 'territorial' } },
    { key: 'label', role: 'secondary', priority: 3, ref: { domain: 'label' } },
    { key: 'hover', role: 'hover', priority: 2, ref: { domain: 'hydro' } },
    { key: 'tool', role: 'hover', priority: 2, ref: { domain: 'interaction' } },
    { key: 'candidate', role: 'candidate', priority: 1, ref: { domain: 'generic' } },
  ];
  const options = { entries, hoverKey: 'hover', hoverHasGeometry: true, style: resolveMapInteractionStyle() };
  const active = plans.selectionDisplayPlan(options);
  assert.equal(active.hoverActive, true);
  assert.deepEqual(active.boundaryOwnersByKey.get('candidate').map(entry => entry.key), ['selected', 'hover', 'tool']);
  for (const suppress of [{ mobile: true }, { mapMoving: true }, { draftDragging: true }, { hoverHasGeometry: false }, { hoverKey: 'selected' }]) {
    const plan = plans.selectionDisplayPlan({ ...options, ...suppress, outlineVisible: false });
    assert.equal(plan.hoverActive, false);
    assert.deepEqual([...plan.boundaryOwnersByKey.keys()], ['tool', 'candidate']);
    assert.deepEqual(plan.items.map(item => [item.entry.key, item.outlineVisible]),
      [['selected', false], ['label', false], ['tool', true], ['candidate', true]]);
  }
});

test('fill masks order tool roles before selection, parent depth before descendants and stable peer keys', () => {
  const entries = [
    { key: 'region', role: 'secondary', priority: 3, depth: 2, ref: { domain: 'territorial' } },
    { key: 'z-country', role: 'selected-provider', priority: 3, depth: 0, ref: { domain: 'territorial' } },
    { key: 'a-country', role: 'secondary', priority: 3, depth: 0, ref: { domain: 'territorial' } },
    { key: 'draft', role: 'edit-target', priority: 5, ref: { domain: 'interaction' } },
    { key: 'reference', role: 'reference', priority: 1, ref: { domain: 'generic' } },
  ];
  const before = structuredClone(entries);
  const plan = plans.selectionDisplayPlan({ entries, style: resolveMapInteractionStyle() });
  const masks = plans.orderSelectionFillMasks(plan.fillMasks);
  assert.deepEqual(masks.map(item => item.key), ['draft', 'a-country', 'z-country', 'region', 'reference']);
  assert.equal(masks[0].fillAlpha, 0.105);
  assert.equal(masks[4].fillAlpha, 0);
  assert.deepEqual(plan.fillMasks.map(item => item.key), ['region', 'z-country', 'a-country', 'draft', 'reference']);
  assert.deepEqual(entries, before);
});
test('view-only reuse requires a successful frame with unchanged fill ownership', () => {
  assert.equal(selectionFrameOwnership({ gpuFrameResult: { succeeded: false }, renderer: 'webgl', lastFillOwner: 'svg' }).reuseView, false);
  assert.equal(selectionFrameOwnership({ gpuFrameResult: { interactionResult: { fillOwner: 'gpu' } }, renderer: 'webgl', lastFillOwner: 'svg' }).reuseView, false);
  assert.equal(selectionFrameOwnership({ gpuFrameResult: { succeeded: true }, renderer: 'webgl', lastFillOwner: 'svg' }).reuseView, true);
});

test('Canvas scene ownership replaces stale SVG ownership even without an interaction result', () => {
  for (const renderer of ['canvas-worker', 'canvas2d']) {
    for (const gpuFrameResult of [null, { deferred: true }, { renderer }, { interactionResult: { fillOwner: 'svg' } }]) {
      const ownership = selectionFrameOwnership({ renderer, gpuFrameResult, lastFillOwner: 'svg' });
      assert.equal(ownership.fillOwner, 'canvas');
      assert.equal(ownership.reuseView, false);
      assert.equal(selectionFrameOwnership({ renderer, gpuFrameResult, lastFillOwner: 'canvas' }).reuseView, true);
    }
  }
});

test('recovery and stable GPU frames keep their current fill owner without inventing coverage', () => {
  assert.equal(selectionFrameOwnership({ renderer: 'webgl-recovering', gpuFrameResult: null, lastFillOwner: 'svg' }).fillOwner, 'svg');
  for (const renderer of ['webgl1', 'webgl2']) {
    const stable = selectionFrameOwnership({ renderer, gpuFrameResult: { succeeded: true }, lastFillOwner: 'gpu' });
    assert.equal(stable.fillOwner, 'gpu');
    assert.equal(stable.reuseView, true);
    assert.equal(selectionFrameOwnership({ renderer, gpuFrameResult: { selection: { contextLost: true } }, lastFillOwner: 'gpu' }).reuseView, false);
  }
});
