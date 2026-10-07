import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createGpuCanvasWorker } from '../../assets/js/modules/gpu-canvas-worker.js';

test('Canvas owner coalesces busy frames and closes stale bitmaps before notifying the presenter', () => {
  const sent = [], presented = [], stale = [];
  const native = { postMessage: value => sent.push(value), terminate() {} };
  const channel = createGpuCanvasWorker({ worker: native, generation: 2,
    acceptFrame: () => true, onStale: value => stale.push(value) });
  channel.onmessage = event => { if (event.data.type === 'frame') presented.push(event.data.revision); };
  channel.queueFrame({ type: 'view', revision: 1, projectGeneration: 2 });
  native.onmessage({ data: { type: 'ready' } });
  channel.queueFrame({ type: 'view', revision: 2, projectGeneration: 2 });
  channel.queueFrame({ type: 'view', revision: 3, projectGeneration: 2 });
  let closed = 0;
  native.onmessage({ data: { type: 'frame', renderRequestId: sent[0].renderRequestId, revision: 1, projectGeneration: 2, bitmap: { close: () => closed++ } } });
  assert.deepEqual(sent.map(message => message.revision), [1, 3]);
  assert.deepEqual(presented, []);
  assert.equal(closed, 1);
  native.onmessage({ data: { type: 'frame', renderRequestId: sent[1].renderRequestId, revision: 3, projectGeneration: 2, bitmap: {} } });
  assert.deepEqual(presented, [3]);
  assert.equal(stale.length, 1);
  channel.terminate();
});

test('Canvas owner ignores delayed ready/error and settles picks on termination', async () => {
  let terminated = 0, delivered = 0, errors = 0, closed = 0;
  const native = { postMessage() {}, terminate() { terminated++; } };
  const channel = createGpuCanvasWorker({ worker: native, generation: 0, acceptFrame: () => true });
  channel.onmessage = () => delivered++;
  channel.onerror = () => errors++;
  native.onmessage({ data: { type: 'ready' } });
  const pending = channel.pick([1, 2]);
  channel.terminate(); channel.terminate();
  native.onmessage({ data: { type: 'ready' } });
  native.onerror({ message: 'late failure' });
  native.onmessage({ data: { type: 'frame', bitmap: { close: () => closed++ } } });
  assert.equal(await pending, null);
  assert.equal(terminated, 1);
  assert.equal(delivered, 1);
  assert.equal(errors, 0);
  assert.equal(closed, 1);
});

function transport({ generation = 2, acceptFrame = () => true } = {}) {
  const sent = [], presented = [], stale = [];
  const worker = { postMessage: message => sent.push(message), terminate() {} };
  const channel = createGpuCanvasWorker({ worker, generation, acceptFrame, onStale: message => stale.push(message) });
  channel.onmessage = event => { if (event.data.type === 'frame') presented.push(event.data); };
  const receive = message => worker.onmessage({ data: message });
  const view = (frameId, revision = 2) => ({ type: 'view', frameId, revision, viewRevision: revision, projectGeneration: generation });
  const complete = (request, extra = {}) => receive({ ...request, type: 'frame', bitmap: {}, ...extra });
  return { worker, channel, sent, presented, stale, receive, view, complete };
}

for (const sameView of [false, true]) {
  test(`unsolicited ${sameView ? 'same-view' : 'older-view'} bitmap does not release another view submission`, () => {
    const { channel, sent, presented, stale, receive, view, complete } = transport();
    receive({ type: 'ready' });
    channel.queueFrame(view(10));
    complete(sent[0]);
    channel.queueFrame(view(11, sameView ? 2 : 3));
    channel.queueFrame(view(12, sameView ? 2 : 4));
    let closed = 0;
    const unsolicitedBitmap = { close: () => closed++ };
    complete(sent[0], { renderRequestId: null, bitmap: unsolicitedBitmap });
    assert.deepEqual(sent.map(message => message.frameId), [10, 11]);
    assert.equal(channel.busy, true);
    assert.equal(channel.hasPendingFrame, true);
    assert.equal(presented.length, sameView ? 2 : 1);
    assert.equal(closed, sameView ? 0 : 1);
    assert.equal(stale.length, sameView ? 0 : 1);
    if (sameView) assert.equal(presented[1].bitmap, unsolicitedBitmap);

    // B's result is obsolete in the older-view case, but still completes B.
    complete(sent[1], { bitmap: { close: () => closed++ } });
    assert.deepEqual(sent.map(message => message.frameId), [10, 11, 12]);
    assert.equal(channel.hasPendingFrame, false);
    assert.equal(closed, sameView ? 0 : 2);
    complete(sent[2]);
    assert.equal(channel.busy, false);
    channel.terminate();
  });
}

test('each actual submission gets a distinct completion identity even when its visual frame is reused', () => {
  const { channel, sent, receive, view, complete } = transport();
  const message = view(10);
  channel.queueFrame(view(9));
  channel.queueFrame(message);
  assert.equal(sent.length, 0);
  receive({ type: 'ready' });
  assert.equal(sent[0].renderRequestId, 1);
  assert.equal(Object.hasOwn(message, 'renderRequestId'), false);
  complete(sent[0]);
  channel.queueFrame(message);
  channel.queueFrame(message);
  assert.equal(sent[1].renderRequestId, 2);
  complete(sent[0]); // Delayed duplicate acknowledgement cannot complete request 2.
  assert.equal(sent.length, 2);
  assert.equal(channel.hasPendingFrame, true);
  complete(sent[1]);
  assert.equal(sent[2].renderRequestId, 3);
  complete(sent[2]);
  assert.equal(channel.busy, false);
  channel.terminate();
});

test('a matching stale-style completion releases its slot independently of bitmap acceptance', () => {
  const { channel, sent, presented, stale, receive, view, complete } = transport({ acceptFrame: message => message.styleRevision === 2 });
  receive({ type: 'ready' });
  channel.queueFrame(view(10));
  channel.queueFrame(view(11));
  let closed = 0;
  complete(sent[0], { styleRevision: 1, bitmap: { close: () => closed++ } });
  assert.equal(sent.length, 2);
  assert.equal(closed, 1);
  assert.equal(stale.length, 1);
  assert.equal(presented.length, 0);
  complete(sent[1], { styleRevision: 2 });
  assert.equal(channel.busy, false);
  assert.equal(presented.length, 1);
  channel.terminate();
});

test('another project generation cannot acknowledge a matching request number', () => {
  const { channel, sent, receive, view, complete } = transport();
  receive({ type: 'ready' });
  channel.queueFrame(view(10));
  channel.queueFrame(view(11));
  let closed = 0;
  complete(sent[0], { projectGeneration: 1, bitmap: { close: () => closed++ } });
  assert.equal(sent.length, 1);
  assert.equal(channel.busy, true);
  assert.equal(channel.hasPendingFrame, true);
  assert.equal(closed, 1);
  complete(sent[0], { bitmap: null });
  assert.equal(sent.length, 2);
  complete(sent[1]);
  assert.equal(channel.busy, false);
  channel.terminate();
});

for (const readyFirst of [false, true]) {
  test(`a replacement channel rejects cached old-project views ${readyFirst ? 'after' : 'before'} readiness without poisoning revisions`, () => {
    const { channel, sent, presented, receive, view, complete } = transport({ generation: 3 });
    if (readyFirst) receive({ type: 'ready' });
    channel.queueFrame({ ...view(10, 100), projectGeneration: 2 });
    assert.equal(sent.length, 0);
    assert.equal(channel.busy, false);
    assert.equal(channel.hasPendingFrame, false);
    channel.queueFrame(view(20, 1));
    if (!readyFirst) receive({ type: 'ready' });
    assert.deepEqual(sent.map(message => message.frameId), [20]);
    assert.equal(sent[0].renderRequestId, 1);
    complete(sent[0]);
    assert.equal(channel.busy, false);
    assert.equal(channel.hasPendingFrame, false);
    assert.equal(presented.length, 1);
    assert.equal(presented[0].frameId, 20);

    // An obsolete high revision also cannot replace valid queued work.
    channel.queueFrame(view(21, 2));
    channel.queueFrame(view(22, 3));
    channel.queueFrame({ ...view(11, 101), projectGeneration: 2 });
    complete(sent[1]);
    assert.deepEqual(sent.map(message => message.frameId), [20, 21, 22]);
    complete(sent[2]);
    assert.equal(presented.at(-1).frameId, 22);
    assert.equal(channel.busy, false);
    channel.terminate();
  });
}

test('termination drops queued views and late completions cannot release a replacement channel', () => {
  const old = transport(), replacement = transport({ generation: 3 });
  old.receive({ type: 'ready' });
  old.channel.queueFrame(old.view(10));
  old.channel.queueFrame(old.view(11));
  old.channel.terminate();
  assert.equal(old.channel.busy, false);
  assert.equal(old.channel.hasPendingFrame, false);
  replacement.receive({ type: 'ready' });
  replacement.channel.queueFrame(replacement.view(20));
  replacement.channel.queueFrame(replacement.view(21));
  let closed = 0;
  old.complete(old.sent[0], { bitmap: { close: () => closed++ } });
  old.receive({ type: 'ready' });
  old.channel.queueFrame(old.view(12));
  assert.equal(closed, 1);
  assert.equal(old.sent.length, 1);
  assert.equal(replacement.sent.length, 1);
  assert.equal(replacement.channel.busy, true);
  replacement.complete(replacement.sent[0]);
  assert.equal(replacement.sent.length, 2);
  replacement.channel.terminate();
});

for (const nativeError of [false, true]) {
  test(`${nativeError ? 'native' : 'render'} errors reach the owner and termination clears its outstanding work`, async () => {
    const { channel, worker, sent, receive, view, complete } = transport();
    const errors = [];
    const fail = error => { errors.push(error); channel.terminate(); };
    channel.onerror = fail;
    channel.onmessage = event => { if (event.data.type === 'error') fail(event.data); };
    receive({ type: 'ready' });
    channel.queueFrame(view(10));
    channel.queueFrame(view(11));
    const pick = channel.pick([1, 2]);
    const error = { type: 'error', message: 'render failed' };
    if (nativeError) worker.onerror(error);
    else receive(error);
    assert.equal(errors[0], error);
    assert.equal(errors.length, 1);
    assert.equal(channel.ready, false);
    assert.equal(channel.busy, false);
    assert.equal(channel.hasPendingFrame, false);
    assert.equal(await pick, null);
    let closed = 0;
    complete(sent[0], { bitmap: { close: () => closed++ } });
    assert.equal(closed, 1);
    assert.deepEqual(sent.filter(message => message.type === 'view').map(message => message.frameId), [10]);
  });
}

// Execute the real classic Worker and imported rendering modules. Canvas pixels
// and timer delivery are the only browser facilities replaced for this protocol test.
function canvasRuntime({ renderError = null } = {}) {
  const replies = [], timers = [];
  const script = new URL('../../assets/js/workers/canvas-render-worker.js', import.meta.url);
  class Canvas {
    constructor(width, height) { this.width = width; this.height = height; }
    getContext() { return { canvas: this, setTransform() {}, clearRect() {}, drawImage() {} }; }
    transferToImageBitmap() {
      if (renderError) throw renderError;
      return { close() {} };
    }
  }
  const scope = vm.createContext({ URL, OffscreenCanvas: Canvas,
    setTimeout: callback => { timers.push(callback); return timers.length; },
    location: script, postMessage: (message, transfer) => replies.push({ message, transfer }) });
  scope.self = scope;
  scope.importScripts = (...urls) => urls.forEach(url => vm.runInContext(readFileSync(new URL(url), 'utf8'), scope));
  vm.runInContext(readFileSync(script, 'utf8'), scope);
  const send = message => scope.onmessage({ data: message });
  send({ type: 'init', projectGeneration: 2, revision: 2, viewRevision: 2, styleRevision: 1,
    width: 20, height: 20, theme: {}, visualOrder: { base: [], hydro: [] } });
  return { replies, send, runTimer: () => timers.shift()() };
}

test('the Worker echoes a submission identity only for its direct view result, never a hydro redraw', () => {
  const { replies, send, runTimer } = canvasRuntime();
  assert.equal(replies[0].message.type, 'ready');
  send({ type: 'view', renderRequestId: 7, frameId: 10, revision: 2, viewRevision: 2, projectGeneration: 2 });
  const first = replies.at(-1);
  assert.equal(first.message.type, 'frame');
  assert.equal(first.message.renderRequestId, 7);
  assert.equal(first.transfer[0], first.message.bitmap);
  send({ type: 'hydro-edits', revision: 1, features: [] });
  runTimer();
  const hydro = replies.at(-1).message;
  assert.equal(hydro.type, 'frame');
  assert.equal(hydro.frameId, 10);
  assert.equal(hydro.renderRequestId, null);
  assert.notEqual(hydro.bitmap, first.message.bitmap);
  send({ type: 'view', renderRequestId: 8, frameId: 10, revision: 2, viewRevision: 2, projectGeneration: 2 });
  assert.equal(replies.at(-1).message.renderRequestId, 8);
});

test('a Worker-skipped older view acknowledges completion without rendering a bitmap', () => {
  const { replies, send } = canvasRuntime();
  send({ type: 'view', renderRequestId: 7, frameId: 9, revision: 1, viewRevision: 1, projectGeneration: 2 });
  assert.equal(replies.length, 2);
  assert.equal(replies[1].message.type, 'frame');
  assert.equal(replies[1].message.renderRequestId, 7);
  assert.equal(replies[1].message.projectGeneration, 2);
  assert.equal(replies[1].message.bitmap, undefined);
  send({ type: 'view', renderRequestId: 8, frameId: 10, revision: 2, viewRevision: 2, projectGeneration: 2 });
  assert.equal(replies.at(-1).message.renderRequestId, 8);
  assert.ok(replies.at(-1).message.bitmap);
});

test('the Worker reports direct and spontaneous render failures through its existing error boundary', () => {
  const { replies, send, runTimer } = canvasRuntime({ renderError: new Error('bitmap transfer failed') });
  send({ type: 'view', renderRequestId: 7, frameId: 10, revision: 2, viewRevision: 2, projectGeneration: 2 });
  assert.equal(replies.at(-1).message.type, 'error');
  assert.equal(replies.at(-1).message.message, 'bitmap transfer failed');
  send({ type: 'hydro-edits', revision: 1, features: [] });
  runTimer();
  assert.equal(replies.at(-1).message.type, 'error');
  assert.equal(replies.at(-1).message.message, 'bitmap transfer failed');
  assert.equal(replies.filter(({ message }) => message.type === 'frame').length, 0);
});
