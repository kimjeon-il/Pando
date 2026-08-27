import assert from 'node:assert/strict';
import test from 'node:test';

import { createCountryGeometryRevisionTracker } from '../../assets/js/modules/gpu-map-renderer.js';

test('a stale geometry result cannot clear a newer pending country revision', () => {
  const tracker = createCountryGeometryRevisionTracker();
  const first = tracker.beginCommit(['A', 'B']);
  const second = tracker.beginCommit(['A']);

  assert.equal(tracker.isCurrent(first.token, first.revision), false);
  assert.equal(tracker.isCurrent(second.token, second.revision), true);
  assert.deepEqual(tracker.markDisplayed(first.ids, first.revision), []);
  assert.deepEqual(new Set(tracker.pendingIds()), new Set(['A', 'B']));

  assert.deepEqual(tracker.markDisplayed(second.ids, second.revision), ['A']);
  assert.deepEqual(tracker.pendingIds(), ['B']);
  assert.equal(tracker.displayedRevision(), second.revision);
});

test('a full rebuild task atomically settles every pending country at its current revision', () => {
  const tracker = createCountryGeometryRevisionTracker();
  const commit = tracker.beginCommit(['SOURCE', 'TARGET']);
  const rebuild = tracker.beginTask(commit.revision);

  assert.equal(tracker.isCurrent(commit.token, commit.revision), false);
  assert.equal(tracker.isCurrent(rebuild.token, rebuild.revision), true);
  assert.deepEqual(
    new Set(tracker.markDisplayed(tracker.pendingIds(), rebuild.revision)),
    new Set(['SOURCE', 'TARGET']),
  );
  assert.deepEqual(tracker.pendingIds(), []);
  assert.equal(tracker.displayedRevision(), tracker.committedRevision());
});

test('reset invalidates outstanding render tasks and preserves monotonic revisions', () => {
  const tracker = createCountryGeometryRevisionTracker();
  const commit = tracker.beginCommit(['A']);
  const resetRevision = tracker.reset();

  assert.ok(resetRevision > commit.revision);
  assert.equal(tracker.isCurrent(commit.token, commit.revision), false);
  assert.deepEqual(tracker.pendingIds(), []);
});
