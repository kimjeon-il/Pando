import { describe as contractSuite } from 'node:test';
import * as __dep0 from "node:assert/strict";
import * as __dep1 from "node:test";
import * as __dep2 from "../../shared/frontend/js/modules/selection-domain.js";
import * as __dep3 from "../../shared/frontend/js/modules/core-object-ref.js";
import * as __dep4 from "node:fs";
import * as __dep5 from "../helpers/core-selection.mjs";
import * as __dep6 from "../helpers/frontend-source.mjs";
import * as __dep7 from "node:fs/promises";
import * as __dep8 from "../../scripts/lib/css-analysis.mjs";
import * as __dep9 from "../../scripts/lib/source-analysis.mjs";
import * as __dep10 from "../../shared/frontend/js/modules/render-device.js";
import * as __dep11 from "../../shared/frontend/js/modules/selection-packet.js";

// Original feature contract: selection-domain-core.test.mjs
contractSuite("selection-domain-core", () => {
const assert = __dep0.default;
const test = __dep1.default;
const { createSelectionDomain } = __dep2;
const { coreSelectionRefToWeb, webSelectionRefToCore } = __dep3;

const A = Object.freeze({ domain: 'territorial', type: 'entity', id: 'A' });
const B = Object.freeze({ domain: 'territorial', type: 'entity', id: 'B' });
const snapshot = (revision = 0, items = [], hoverRevision = 0, hover = null) => ({
  selectionRevision: revision, items, primary: items.at(-1) || null, hoverRevision, hover,
});
const refAdapter = { toCore: ref => webSelectionRefToCore(ref, { isStoredHydro: () => false }), fromCore: coreSelectionRefToWeb };
function fixture() {
  const calls = [], subscribers = new Set(), events = [];
  let current = snapshot(), projectGeneration = 1;
  const commandOwner = {
    state: () => ({ epoch: 9 }),
    subscribeTransitions(callback) { subscribers.add(callback); return () => subscribers.delete(callback); },
    selectionApply(payload, options) {
      return new Promise((resolve, reject) => { calls.push({ payload, options, resolve, reject }); });
    },
    selectionSnapshot: async () => current,
  };
  const domain = createSelectionDomain({ commandOwner, refAdapter,
    projectDomain: { getGeneration: () => projectGeneration },
    onSelectionChanged: (value, reason) => events.push(['selection', reason, value.selection.keys]),
    onHoverChanged: (value, reason) => events.push(['hover', reason, value.hover?.key || null]),
    requestRender: reason => events.push(['render', reason]) });
  function complete(index, native) {
    current = native;
    const ack = { selection: native, countNoOp: true };
    for (const listener of subscribers) listener(ack, 'core.document-selection-apply', calls[index].payload);
    calls[index].resolve(ack);
  }
  return { domain, calls, events, complete, setGeneration(value) { projectGeneration = value; }, emit(native, operation = 'core.document-execute') {
    current = native;for (const listener of subscribers) listener({ selection: native }, operation, {});
  } };
}

test('selection owner requires the Core transport and explicit ref conversion', () => {
  assert.throws(() => createSelectionDomain(), /Core selection owner/);
  assert.throws(() => createSelectionDomain({ commandOwner: { state() {}, selectionApply() {}, selectionSnapshot() {}, subscribeTransitions() {} } }), /reference adapter/);
});

test('selection dispatch is immediate but its public state changes only after the Core ACK', async () => {
  const { domain, calls, events, complete, setGeneration } = fixture();
  const changed = domain.replace(A, { scope: 'map', reason: 'clicked A' });
  assert.equal(calls.length, 1, 'a second UI queue must not reorder the intent after project load');
  assert.deepEqual(calls[0].payload, { action: 'replace', ref: A, scope: 'map' });
  assert.equal(calls[0].options.isCurrent(), true);
  setGeneration(2);
  assert.equal(calls[0].options.isCurrent(), false, 'a queued intent cannot cross a project replacement');
  setGeneration(1);
  assert.equal(domain.size(), 0);assert.deepEqual(events, []);
  complete(0, snapshot(1, [A]));
  const accepted = await changed;
  assert.equal(accepted.selection.items[0].id, 'A');
  assert.equal(domain.size(), 1);assert.equal(domain.has(A), true);
  assert.equal(events.length, 2, 'subscription and awaited response must publish once');
  assert.deepEqual(events.map(row => row.slice(0, 2)), [['selection', 'clicked A'], ['render', 'clicked A']]);
  assert.equal(domain.stats().selectionMutationCount, 1);
  assert.equal(domain.stats().selectionNoOpCount, 0);
  domain.dispose();
});

test('an accepted same-selection ACK is a no-op without client side revisions', async () => {
  const { domain, complete, events } = fixture();
  const first = domain.replace(A);complete(0, snapshot(1, [A]));await first;
  events.length = 0;
  const second = domain.replace(A);complete(1, snapshot(1, [A]));await second;
  assert.equal(domain.snapshot().revision, 1);assert.deepEqual(events, []);
  assert.equal(domain.stats().selectionNoOpCount, 1);domain.dispose();
});

test('document/history acknowledgements reconcile the same selection projection', async () => {
  const { domain, complete, emit, events } = fixture();
  const pending = domain.replace(A);complete(0, snapshot(1, [A]));await pending;
  events.length = 0;
  emit(snapshot(2), 'core.document-undo');
  assert.equal(domain.size(), 0);assert.equal(domain.snapshot().revision, 2);
  assert.equal(events.filter(row => row[0] === 'selection').length, 1);
  assert.equal(domain.stats().selectionMutationCount, 2);domain.dispose();
});

test('project generation reset publishes once even when the Core selection is already empty', async () => {
  const { domain, complete, events } = fixture();
  const reset = domain.resetProject(2);complete(0, snapshot());await reset;
  assert.equal(domain.snapshot().projectGeneration, 2);assert.equal(domain.snapshot().revision, 0);
  assert.deepEqual(events.map(row => row.slice(0, 2)), [['selection', 'project-reset'], ['render', 'project-reset-selection']]);
  events.length = 0;
  const again = domain.resetProject(2);complete(1, snapshot());await again;
  assert.deepEqual(events, []);assert.equal(domain.stats().selectionNoOpCount, 1);domain.dispose();
});

test('hover sources and expected keys are passed to Core without a second hover owner', async () => {
  const { domain, complete, events, calls } = fixture();
  const first = domain.setHover(A, { source: 'map' });complete(0, snapshot(0, [], 1, A));await first;
  assert.equal(domain.snapshot().hover.id, 'A');
  assert.equal(events.filter(row => row[0] === 'hover').length, 1);
  events.length = 0;
  const same = domain.setHover(A, { source: 'layer' });complete(1, snapshot(0, [], 1, A));await same;
  assert.deepEqual(events, []);assert.equal(calls[1].payload.source, 'layer');
  const cleared = domain.setHover(null, { source: 'layer', expectedKey: domain.snapshot().hover.key });
  assert.equal(calls[2].payload.expectedKey, 'territorial:entity:A');
  complete(2, snapshot(0, [], 2));await cleared;
  assert.equal(domain.snapshot().hover, null);domain.dispose();
});

test('queued hover checks the current pointer before entering Core', async () => {
  const { domain, calls } = fixture();
  let current = true;
  const pending = domain.setHover(A, { source: 'map', isCurrent: () => current });
  assert.equal(calls[0].options.isCurrent(), true);
  current = false;
  assert.equal(calls[0].options.isCurrent(), false);
  calls[0].reject(Object.assign(new Error('stale'), { code: 'PL-CORE-STALE' }));
  await assert.rejects(pending, { code: 'PL-CORE-STALE' });
  domain.dispose();
});

test('disposing selection unsubscribes and suppresses a late acknowledgement', async () => {
  const { domain, complete, events } = fixture();
  const pending = domain.replace(B);domain.dispose();complete(0, snapshot(1, [B]));await pending;
  assert.deepEqual(events, []);assert.equal(domain.size(), 0);
});
});

// Original feature contract: selection-domain-wasm.test.mjs
contractSuite("selection-domain-wasm", () => {
const assert = __dep0.default;
const { readFileSync } = __dep4;
const test = __dep1.default;
const { createNodeSelection } = __dep5;

test('public selection projection retains all 30 original literal-ID snapshots and notification metrics through actual C++', async () => {
  const owner = await createNodeSelection();
  const d = owner.domain,ref = (domain,type,id) => ({ domain,type,id });
  const A=ref('territorial','entity','A'),B=ref('territorial','entity','B'),G=ref('generic','feature','G');
  const capital=ref('label','capital','L'),city=ref('label','city','L'),place=ref('label','city','builtin:place:fixture:1'),hydro=ref('hydro','river','builtin-hydro');
  const actions=[() => {},() => d.replace(A,{ scope: 'countries' }),() => d.replace(A,{ scope: 'countries' }),
    () => d.toggle(B,{ scope: 'countries' }),() => d.remove(B),() => d.selectRange(G,[A,B,G],{ scope: 'countries' }),
    () => d.selectRange(A,[A,B,G],{ scope: 'countries',additive: true }),() => d.setMany([A,B,A]),
    () => d.setMany([capital,city,place,hydro],{ primary: capital }),
    () => d.prune(new Set(d.snapshot().selection.items.filter(row => row.id !== 'L').map(row => row.key))),
    () => d.setHover(hydro,{ source: 'map' }),() => d.setHover(null,{ source: 'layer' }),
    () => d.setHover(hydro,{ source: 'layer' }),() => d.setHover(null,{ source: 'map' }),
    () => d.setHover(null,{ source: 'layer',expectedKey: 'old-key' }),
    () => d.setHover(null,{ source: 'layer',expectedKey: d.snapshot().hover.key }),
    async () => { await d.replace(ref('territorial','entity','missing'));await d.setHover(ref('label','city','missing')); },
    () => d.remove(d.snapshot().selection.items[0].key),() => d.clear(),() => d.clear(),
    () => d.selectRange(B,[A,B,G],{ scope: 'countries' }),() => d.replace(capital),() => d.replace(city),
    () => d.setHover(place,{ source: 'map' }),() => { owner.setGeneration(2);return d.resetProject(2); },
    () => d.toggle(A,{ scope: 'empty-reset' }),() => d.toggle(A,{ scope: 'empty-reset' }),() => d.clear(),
    () => { owner.setGeneration(3);return d.resetProject(3); },() => d.selectRange(B,[A,B],{ scope: 'empty-reset' })];
  const expected=JSON.parse(readFileSync(new URL('../fixtures/portability/web-selection-contract.json',import.meta.url),'utf8'));
  const state=owner.client.state();
  try {
    for (const [index,action] of actions.entries()) {
      await action();assert.deepEqual(d.snapshot(),expected[index].snapshot,expected[index].operation);
      assert.deepEqual(d.stats(),expected[index].stats,expected[index].operation);
      assert.deepEqual(owner.client.state(),state,'selection never mutates document/history/dirty');
    }
  } finally { owner.dispose(); }
});

test('invalid non-null public hover cannot clear an accepted hover', async () => {
  const owner=await createNodeSelection({ genericIds: [],labelIds: [],distributionIds: [] });
  try {
    await owner.domain.setHover({ domain: 'territorial',type: 'entity',id: 'A' });
    const before=owner.domain.snapshot();
    await owner.domain.setHover({ displayName: 'invalid' });
    assert.deepEqual(owner.domain.snapshot(),before);
  } finally { owner.dispose(); }
});
});

// Original feature contract: selection-architecture.test.mjs
contractSuite("selection-architecture", () => {
const { repositoryFrontendUrl } = __dep6;
const assert = __dep0.default;
const { readFile } = __dep7;
const test = __dep1.default;
const { collectCssRules } = __dep8;
const { parseJavaScript, walkJavaScript } = __dep9;
const { createRenderDevice, isRenderDevice } = __dep10;
const { createSelectionPacket } = __dep11;


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
});
