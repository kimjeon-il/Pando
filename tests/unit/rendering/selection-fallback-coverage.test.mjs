import { describe as contractSuite } from 'node:test';
import {createRenderDeviceFixture} from '../../helpers/render-device-fixture.mjs';
import * as __contract_dep0 from "node:test";
import * as __contract_dep1 from "node:assert/strict";
import * as __contract_dep2 from "../../../src/ui/selection-fallback-coverage.js";
import * as __contract_dep3 from "../../../src/rendering/selection-pass.js";
import * as __contract_dep4 from "../../../src/rendering/map-render-coordinator.js";
import * as __contract_dep5 from "node:test";
import * as __contract_dep6 from "node:assert/strict";
import * as __contract_dep7 from "../../../src/rendering/selection-packet.js";
import * as __contract_dep8 from "../../../src/rendering/selection-pass.js";
import * as __contract_dep9 from "../../../src/map/map-interaction-style.js";
contractSuite("selection-fallback-coverage", () => {
const test = __contract_dep0.default;
const assert = __contract_dep1.default;
const { commitSelectionFallbackCoverage } = __contract_dep2;
const { createSelectionPass } = __contract_dep3;
const { createMapRenderCoordinator, MAP_RENDER_DIRTY } = __contract_dep4;

function fixture() {
  const nodes = [];
  const add = (key, channel) => nodes.push({
    getAttribute: name => name === 'data-selection-channel' ? channel : key,
    remove() { nodes.splice(nodes.indexOf(this), 1); },
  });
  add('territorial:entity:state%3Asoviet-union', 'primary');
  add('territorial:entity:state%3Asoviet-union', 'primary');
  add('territorial:entity:FRA', 'secondary');
  add('territorial:entity:DEU', 'hover');
  return { nodes, root: { querySelectorAll: () => [...nodes] } };
}

test('library country upload completion retires both SVG strokes without touching other selections', () => {
  const { nodes, root } = fixture();
  const result = { succeeded: true, channels: { primary: { renderedKeys: ['territorial:entity:state%3Asoviet-union'] } } };
  assert.equal(commitSelectionFallbackCoverage([root], result), 2);
  assert.equal(nodes.length, 2);
  assert.equal(commitSelectionFallbackCoverage([root], result), 0);
});

test('pending, failed, empty and other-channel coverage retain fallback outlines', () => {
  for (const result of [null, { channels: {} }, { channels: { primary: { renderedKeys: [] } } },
    { succeeded: false, gpuHealth: 'unhealthy', channels: { primary: { renderedKeys: ['territorial:entity:state%3Asoviet-union'] } } },
    { error: new Error('draw failed'), channels: { primary: { renderedKeys: ['territorial:entity:state%3Asoviet-union'] } } },
    { contextLost: true }, { channels: { hover: { renderedKeys: ['territorial:entity:state%3Asoviet-union'] } } }]) {
    const { root, nodes } = fixture();
    assert.equal(commitSelectionFallbackCoverage([root], result), 0);
    assert.equal(nodes.length, 4);
  }
});

test('partial selection frame retires covered outlines and retains missing objects', () => {
  const pass = createSelectionPass();
  pass.initialize(createRenderDeviceFixture().device, { strokeRenderer: {
    isAvailable: () => true, stats: () => ({ gpuHealth: 'healthy' }),
    drawBatches: batches => ({ succeeded: true, renderedKeys: batches.map(batch => batch.key), drawCallCount: 1 }),
  } });
  const id = 'state:soviet-union';
  pass.setCountryBoundaryResources({ revision: 'mixed', visibleIds: [id, 'FRA'], pendingIds: ['FRA'],
    strokeResources: { selectionBase: { ownerIds: [id], packet: { key: 'base', preparedGeometry: {} } } } });
  pass.updateData({ channels: { primary: [{ key: `territorial:entity:${encodeURIComponent(id)}`, boundaryOwnerId: id }], secondary: [{ key: 'territorial:entity:FRA', boundaryOwnerId: 'FRA' }] }, countryBoundaryRevision: 'mixed' });
  const result = pass.draw({}, {}, { frameContext: { frameId: 1 } });
  assert.equal(result.succeeded, false);
  const { root, nodes } = fixture();
  assert.equal(commitSelectionFallbackCoverage([root], result), 2);
  assert.deepEqual(nodes.map(node => node.getAttribute('data-selection-fallback-key')), ['territorial:entity:FRA', 'territorial:entity:DEU']);
});

test('prepared library-country GPU resource transitions from upload pending to covered on interaction-only frame', () => {
  const id = 'state:soviet-union';
  const key = `territorial:entity:${encodeURIComponent(id)}`;
  const preparedGeometry = { marker: 'worker-prepared' };
  let ready = false, draws = 0;
  const pass = createSelectionPass();
  pass.initialize(createRenderDeviceFixture().device, { strokeRenderer: {
    isAvailable: () => true,
    stats: () => ({}),
    drawBatches: batches => {
      draws += 1;
      assert.equal(batches[0].preparedGeometry, preparedGeometry);
      assert.deepEqual(batches[0].ownerIds, [id]);
      return { succeeded: ready, renderedKeys: ready ? [batches[0].key] : [], drawCallCount: ready ? 1 : 0 };
    },
  } });
  pass.setCountryBoundaryResources({ revision: 'new-country', visibleIds: [id], overriddenIds: [id],
    strokeResources: { override: { ownerIds: [id], packet: { key: 'country-boundary:override', preparedGeometry } } } });
  pass.updateData({ channels: { primary: [{ key: `territorial:entity:${encodeURIComponent(id)}`, boundaryOwnerId: id }] }, countryBoundaryRevision: 'new-country' });
  const { root, nodes } = fixture();
  const initial = pass.draw({}, {}, { frameContext: { frameId: 1 } });
  assert.equal(commitSelectionFallbackCoverage([root], initial), 0);
  ready = true;
  const frames = [], events = [];
  const coordinator = createMapRenderCoordinator({ requestFrame: callback => frames.push(callback), prepareView: () => ({ frameId: 2 }),
    renderers: {
      gpuInteraction: frame => { events.push('gpu'); return { selection: pass.draw({}, {}, { frameContext: frame }) }; },
      selectionView: (frame, result) => { events.push('svg'); assert.deepEqual(result.selection.channels.primary.renderedKeys, [key]); commitSelectionFallbackCoverage([root], result.selection); },
      selectionData: () => assert.fail('must not rebuild selection data'),
      countries: () => assert.fail('must not rebuild world geometry'),
    },
  });
  coordinator.invalidate(MAP_RENDER_DIRTY.GPU_INTERACTION, 'interaction-resource-ready');
  frames.shift()();
  assert.deepEqual(events, ['gpu', 'svg']);
  // SelectionPass submits one grouped stroke batch per frame; the stroke renderer
  // owns casing + inner-stroke expansion inside that batch.
  assert.equal(draws, 2);
  assert.equal(nodes.length, 2);
});
});
contractSuite("selection-entity-channels", () => {
const test = __contract_dep5.default;
const assert = __contract_dep6.default;
const { createSelectionPacket } = __contract_dep7;
const { createSelectionPass } = __contract_dep8;
const { resolveMapInteractionStyle } = __contract_dep9;

test('common entity keys survive the static boundary optimization and geometry replacement', () => {
  const key = 'territorial:entity:A';
  const pass = createSelectionPass();
  pass.initialize(createRenderDeviceFixture().device, { strokeRenderer: {
    isAvailable: () => true, stats: () => ({ gpuHealth: 'healthy' }),
    drawBatches: batches => ({ succeeded: true, renderedKeys: batches.map(batch => batch.key), drawCallCount: 1 }),
  } });
  pass.setCountryBoundaryResources({ revision: 'r1', visibleIds: ['asset-A'], strokeResources: {
    selectionBase: { ownerIds: ['asset-A'], packet: { key: 'base', preparedGeometry: {} } },
  } });
  const packet = createSelectionPacket({ channels: { primary: [{ key, boundaryOwnerId: 'asset-A', geometryRevision: 'r1' }] } });
  assert.equal(packet.channels.primary[0].key, key);
  assert.equal(Object.hasOwn(packet, 'country'), false);
  assert.equal(Object.hasOwn(packet, 'generic'), false);
  pass.updateData(packet);
  assert.deepEqual(pass.draw({}, {}, { frameContext: {} }).channels.primary.renderedKeys, [key]);
  const geometry = { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0,0],[1,1]] } };
  pass.updateData(createSelectionPacket({ channels: { primary: [{ key, geometryRevision: 'r2', geometry }] } }));
  assert.deepEqual(pass.draw({}, {}, { frameContext: {} }).channels.primary.renderedKeys, [key]);
  pass.updateData(createSelectionPacket());
  assert.deepEqual(pass.draw({}, {}, { frameContext: {} }).channels.primary.renderedKeys, []);
});

test('selection pass forwards union coverage for hover and both selection channels in paint order', () => {
  const draws = [];
  const pass = createSelectionPass();
  pass.initialize(createRenderDeviceFixture().device, { strokeRenderer: {
    isAvailable: () => true, stats: () => ({ gpuHealth: 'healthy' }),
    drawBatches: batches => {
      draws.push(...batches);
      return { succeeded: true, renderedKeys: batches.map(batch => batch.key), drawCallCount: 1 };
    },
  } });
  const source = { ownerIds: ['asset-A'], packet: { key: 'base', preparedGeometry: {} } };
  pass.setCountryBoundaryResources({ revision: 'r1', visibleIds: ['asset-A'], strokeResources: { base: source, selectionBase: source } });
  pass.updateData(createSelectionPacket({
    style: resolveMapInteractionStyle({ selectionColor: '#315e9d', antiAlias: true }),
    channels: Object.fromEntries(['hover', 'secondary', 'primary'].map(role => [role, [{ key: `${role}:A`, boundaryOwnerId: 'asset-A' }]])),
  }));
  const result = pass.draw({}, {}, { frameContext: {} });
  assert.equal(result.succeeded, true);
  assert.deepEqual(draws.map(batch => [batch.style.width, batch.style.alpha, batch.style.coverage, batch.style.antiAlias]),
    [[1.5, 0.85, 'union', true], [1.5, 0.72, 'union', true], [2.5, 1, 'union', true]]);
  assert.ok(draws.every(batch => batch.style.color === '#315e9d'));
});
});
