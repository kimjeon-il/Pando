import assert from 'node:assert/strict';
import test from 'node:test';
import { createSelectionDomain } from "../../shared/frontend/js/modules/selection-domain.js";
import { coreSelectionRefToWeb, webSelectionRefToCore } from "../../shared/frontend/js/modules/core-object-ref.js";

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

test('disposing selection unsubscribes and suppresses a late acknowledgement', async () => {
  const { domain, complete, events } = fixture();
  const pending = domain.replace(B);domain.dispose();complete(0, snapshot(1, [B]));await pending;
  assert.deepEqual(events, []);assert.equal(domain.size(), 0);
});
