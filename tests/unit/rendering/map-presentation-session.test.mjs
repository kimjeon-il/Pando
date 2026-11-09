import assert from 'node:assert/strict';
import test from 'node:test';
import { createMapPresentationSession } from '../../../src/rendering/map-presentation-session.js';

function harness() {
  let generation = 1, context = 1, ready = true, blocked = false;
  let retired = 0, canonicalWaits = 0;
  const invalidations = [], failures = [];
  const session = createMapPresentationSession({
    getGeneration: () => generation, getContextRevision: () => context,
    isDisposed: () => false, getReadiness: () => ({ mapReady: ready }),
    invalidateFrame: value => invalidations.push(value),
    prepareContentKey: async features => features[0]?.content || null,
    isProjectBlocked: () => blocked, isRecoveryFrameAdmissible: () => true,
    onTemporalFailure: error => failures.push(error),
    onTemporalRetired: () => { retired++; },
    waitForCanonicalFrame: () => { canonicalWaits++; return Promise.resolve(true); },
  });
  return { session, invalidations, failures, get retired() { return retired; },
    get canonicalWaits() { return canonicalWaits; },
    setGeneration(value) { generation = value; },
    setContext(value) { context = value; },
    setBlocked(value) { blocked = value; },
    setReady(value) { ready = value; } };
}

test('a real accepted map frame settles generation-scoped waiters once', async () => {
  const h = harness(), frame = { projectGeneration: 1, frameId: 7 };
  const pending = h.session.waitForMapPresentation(1);
  assert.equal(h.session.pendingMapWaiterCount, 1);
  assert.deepEqual(h.invalidations, ['await-current-map-frame']);
  assert.equal(h.session.commitVisualFrame(frame), true);
  assert.equal(await pending, true);
  assert.equal(h.session.pendingMapWaiterCount, 0);
  assert.equal(await h.session.waitForMapPresentation(1), true);
  h.setReady(false);
  assert.equal(h.session.commitVisualFrame(frame), true);
});

test('dated frames require source admission, content and matching frame identity', async () => {
  const h = harness();
  const token = h.session.beginTemporalViewTransition();
  const frame = { projectGeneration: 1, frameId: 11 };
  assert.equal(h.session.canPresentVisualFrame(frame), false);
  assert.equal(h.session.admitTemporalViewTransition(token), true);
  assert.equal(await h.session.prepareTemporalCountrySource([{ content: 'mesh-A' }]), true);
  assert.equal(h.session.ticket.countryContent, 'mesh-A');
  assert.equal(h.session.canPresentVisualFrame(frame), false);
  h.session.markTemporalFrame(frame);
  assert.equal(h.session.canPresentVisualFrame({ ...frame, frameId: 12 }), false);
  assert.equal(h.session.canPresentVisualFrame(frame, { deferred: true }), false);
  assert.equal(h.session.canPresentVisualFrame(frame, { deferred: true }, { canvasPresented: true }), true);
  assert.equal(await h.session.waitForTemporalPresentation(), true);
  assert.equal(h.canonicalWaits, 1);
  assert.equal(h.session.commitVisualFrame(frame), true);
  assert.equal(h.session.temporalPending(), false);
  assert.equal(h.retired, 1);
});

test('project replacement rejects old waiters and cannot admit superseded work', async () => {
  const h = harness();
  const old = h.session.waitForMapPresentation(1);
  const rejected = assert.rejects(old, error => error.name === 'AbortError');
  h.setGeneration(2);
  h.session.resetForProject({ presentation: 'temporal', isCurrent: () => true });
  await rejected;
  assert.equal(h.session.ticket.kind, 'replacement');
  assert.equal(h.session.ticket.generation, 2);
  assert.equal(h.session.canPresentVisualFrame({ projectGeneration: 1, frameId: 1 }), false);
  h.session.markTemporalFrame({ frameId: 2 });
  assert.equal(h.session.commitVisualFrame({ projectGeneration: 2, frameId: 2 }), true);
  h.session.dispose();
  assert.equal(h.session.ticket, null);
  await assert.rejects(h.session.waitForMapPresentation(1), { name: 'AbortError' });
});

test('failed or stale temporal tickets never publish', () => {
  const h = harness();
  const token = h.session.beginTemporalViewTransition();
  h.session.admitTemporalViewTransition(token);
  const error = new Error('failed terrain');
  h.session.failTemporalPresentation(error);
  assert.equal(h.session.ticket.error, error);
  assert.equal(h.failures.length, 1);
  assert.equal(h.session.canPresentVisualFrame({ projectGeneration: 1, frameId: 1 }), false);
  assert.equal(h.session.finishTemporalViewTransition(token), true);
  assert.equal(h.retired, 1);
});
