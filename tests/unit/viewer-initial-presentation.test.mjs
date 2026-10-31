import test from 'node:test';
import assert from 'node:assert/strict';
import {createViewerInitialPresentation} from '../../apps/viewer/js/modules/viewer-initial-presentation.js';

function fixture() {
  let notifications = 0;
  const state = createViewerInitialPresentation({onPresented: () => notifications++});
  return {state, notifications: () => notifications};
}

test('first page stays initial until an accepted project has a ready map frame', () => {
  const {state, notifications} = fixture(), request = state.track(() => true);
  assert.equal(state.hasPresented(), false);
  request.accept(1);
  for (const status of ['loading', 'error']) state.observe({status}, 1);
  assert.equal(state.hasPresented(), false);
  state.observe({status: 'ready'}, 1);
  assert.equal(state.hasPresented(), true);
  assert.equal(notifications(), 1);
});

test('a frame displayed before project acceptance is remembered without accepting an empty substrate', () => {
  const {state} = fixture();
  state.observe({status: 'ready'}, 0);
  const request = state.track(() => true);
  state.observe({status: 'ready'}, 0);
  request.accept(1);
  assert.equal(state.hasPresented(), false);
  state.observe({status: 'ready'}, 1);
  assert.equal(state.hasPresented(), true);
});

test('accepted frame ends initial mode before search hydration settles', () => {
  const {state, notifications} = fixture(), request = state.track(() => true);
  state.observe({status: 'ready'}, 4);
  assert.equal(state.hasPresented(), false);
  request.accept(4);
  assert.equal(state.hasPresented(), true);
  request.cancel(); // A later search error must not restore initial mode.
  assert.equal(state.hasPresented(), true);
  assert.equal(notifications(), 1);
});

test('failed first request and its rollback stay initial; a retry can complete', () => {
  const {state} = fixture(), first = state.track(() => true);
  state.observe({status: 'ready'}, 1);
  first.cancel();
  state.observe({status: 'ready'}, 2); // Rollback may display the empty document.
  first.accept(1);
  assert.equal(state.hasPresented(), false);
  const retry = state.track(() => true);
  retry.accept(3);
  state.observe({status: 'ready'}, 3);
  assert.equal(state.hasPresented(), true);
});

test('superseded request and stale generation cannot finish initial mode', () => {
  const {state} = fixture();
  let current = true;
  const first = state.track(() => current);
  current = false;
  state.observe({status: 'ready'}, 1);
  first.accept(1);
  assert.equal(state.hasPresented(), false);
  const next = state.track(() => true);
  next.accept(3);
  state.observe({status: 'ready'}, 1);
  assert.equal(state.hasPresented(), false);
  first.cancel();
  state.observe({status: 'ready'}, 3);
  assert.equal(state.hasPresented(), true);
});

test('a newer tracked request invalidates an older handle even before the next open begins', () => {
  const {state} = fixture(), first = state.track(() => true), second = state.track(() => true);
  state.observe({status: 'ready'}, 1);
  first.accept(1);
  assert.equal(state.hasPresented(), false);
  second.accept(2);
  state.observe({status: 'ready'}, 2);
  assert.equal(state.hasPresented(), true);
});

test('losing readiness before acceptance does not count as a successful first presentation', () => {
  const {state} = fixture(), request = state.track(() => true);
  state.observe({status: 'ready'}, 1);
  state.observe({status: 'loading'}, 1);
  request.accept(1);
  assert.equal(state.hasPresented(), false);
  state.observe({status: 'ready'}, 1);
  assert.equal(state.hasPresented(), true);
});

test('year changes, search delays and foreground retries never reset first presentation', () => {
  const {state, notifications} = fixture(), first = state.track(() => true);
  first.accept(1); state.observe({status: 'ready'}, 1);
  for (let generation = 2; generation <= 5; generation++) {
    const request = state.track(() => true);
    state.observe({status: 'loading'}, generation);
    state.observe({status: 'error'}, generation);
    assert.equal(state.hasPresented(), true);
    request.accept(generation);
    state.observe({status: 'ready'}, generation);
    request.cancel();
  }
  assert.equal(notifications(), 1);
});

test('a new page instance starts initial without resetting the existing page', () => {
  const {state} = fixture(), request = state.track(() => true);
  request.accept(1); state.observe({status: 'ready'}, 1);
  assert.equal(fixture().state.hasPresented(), false);
  assert.equal(state.hasPresented(), true);
});

test('disposal makes late ready signals and late acceptance inert', () => {
  const {state, notifications} = fixture(), request = state.track(() => true);
  state.dispose(); state.dispose();
  request.accept(1); state.observe({status: 'ready'}, 1);
  state.track(() => true).accept(2); state.observe({status: 'ready'}, 2);
  assert.equal(state.hasPresented(), false);
  assert.equal(notifications(), 0);
});

test('invalid request predicates and generations fail visibly', () => {
  const {state} = fixture();
  assert.throws(() => state.track(null), TypeError);
  for (const generation of [0, -1, null, undefined, NaN, 1.5]) {
    assert.throws(() => state.track(() => true).accept(generation), TypeError);
  }
});
