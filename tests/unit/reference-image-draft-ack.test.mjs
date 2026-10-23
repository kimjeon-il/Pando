import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// Execute the controller's actual operation boundary without installing its DOM,
// image decoder, map, timers or application. This is not a Qt/browser UI check.
async function operation(mode) {
  const source = await readFile(new URL(`../../assets/js/modules/reference-image-${mode}-controller.js`, import.meta.url), 'utf8');
  const match = source.match(/ {2}((?:async )?function applyPreview\(\) \{[\s\S]+?)\r?\n\r?\n {2}function intercept/);
  assert.ok(match, `${mode} apply operation must be present`);
  const calls = { applied: [], messages: [], cancelled: [], errors: [] };
  let acknowledge;
  const acknowledgement = new Promise(resolve => { acknowledge = resolve; });
  const context = {
    state: { phase: 'preview', previewCoordinates: [[0, 0], [1, 1]] },
    disposed: false,
    __PANDOLAB_REFERENCE_IMAGE_EDITING__: {
      isDraftActive: () => true,
      applyDraftCoordinates(coordinates, options) {
        calls.applied.push({ coordinates, options });
        return acknowledgement;
      },
    },
    setMessage: (...args) => calls.messages.push(args),
    scheduleSync() {},
    cancelRefine: (...args) => { calls.cancelled.push(args); context.state = null; },
    cancelLiveWire: (...args) => { calls.cancelled.push(args); context.state = null; },
    console: { error: (...args) => calls.errors.push(args) },
  };
  const apply = vm.runInNewContext(`(${match[1].trim()})`, context);
  return { apply, context, calls, acknowledge };
}

for (const mode of ['line-refine', 'live-wire']) {
  test(`${mode} finishes its preview only after the actual draft ACK`, async () => {
    const { apply, context, calls, acknowledge } = await operation(mode);
    const result = apply();
    assert.equal(calls.applied.length, 1);
    assert.equal(calls.cancelled.length, 0);
    assert.equal(context.state.phase, 'preview');
    assert.equal(await apply(), false, 'a pending apply cannot enqueue a second command');
    acknowledge(true);
    assert.equal(await result, true);
    assert.equal(calls.cancelled.length, 1);
    assert.equal(context.state, null);
  });

  test(`${mode} preserves a declined preview and lets the user retry`, async () => {
    const { apply, context, calls, acknowledge } = await operation(mode);
    const state = context.state;
    const result = apply();
    acknowledge(false);
    assert.equal(await result, false);
    assert.equal(context.state, state);
    assert.equal(state.applying, false);
    assert.equal(calls.cancelled.length, 0);
    assert.equal(calls.messages.at(-1)[1], 'error');
  });

  test(`${mode} does not publish a late ACK into a cancelled or replaced preview`, async () => {
    const { apply, context, calls, acknowledge } = await operation(mode);
    const result = apply();
    context.state = { phase: 'preview', previewCoordinates: [[2, 2], [3, 3]] };
    const current = context.state;
    acknowledge(true);
    assert.equal(await result, false);
    assert.equal(context.state, current);
    assert.equal(calls.cancelled.length, 0);
    assert.equal(calls.messages.length, 0);
  });

  test(`${mode} does not close a preview redrawn while its old apply is pending`, async () => {
    const { apply, context, calls, acknowledge } = await operation(mode);
    const result = apply();
    context.state.phase = 'armed';
    context.state.previewCoordinates = [];
    acknowledge(true);
    assert.equal(await result, false);
    assert.equal(context.state.phase, 'armed');
    assert.equal(calls.cancelled.length, 0);
  });

  test(`${mode} contains an unexpected bridge rejection with its original cause`, async () => {
    const { apply, context, calls } = await operation(mode);
    const failure = new Error('worker disposed');
    context.__PANDOLAB_REFERENCE_IMAGE_EDITING__.applyDraftCoordinates = async () => { throw failure; };
    assert.equal(await apply(), false);
    assert.equal(context.state.phase, 'preview');
    assert.equal(context.state.applying, false);
    assert.equal(calls.errors.length, 1);
    assert.equal(calls.errors[0][0], '[PL-REFERENCE-DRAFT-001]');
    assert.equal(calls.errors[0][1], failure);
    assert.equal(calls.messages.at(-1)[0], failure.message);
  });
}

test('Live-Wire can apply source pixels to a boundary-review target without an active object draft', async () => {
  const { apply, context, calls } = await operation('live-wire');
  const pixels = [[2, 3], [5, 8]];
  let received;
  context.__PANDOLAB_REFERENCE_IMAGE_EDITING__.isDraftActive = () => false;
  context.state.previewSourcePixels = pixels;
  context.state.target = { onApply: async value => { received = value;return true; } };
  assert.equal(await apply(), true);
  assert.equal(received, pixels);
  assert.equal(calls.applied.length, 0);
  assert.equal(calls.cancelled.length, 1);
});

for (const mode of ['line-refine', 'live-wire']) test(`${mode} stops publishing its previous message after another workflow takes ownership`, async () => {
  const source = await readFile(new URL(`../../assets/js/modules/reference-image-${mode}-controller.js`, import.meta.url), 'utf8');
  const match = source.match(/ {2}(function syncUi\(\) \{[\s\S]*?\r?\n {2}\})/);
  assert.ok(match);
  const writes = [];
  const context = { syncScheduled: false, disposed: false, editor: { hidden: false, querySelector: () => null }, panel: {},
    state: null, selectedRecordId: () => 'map-a', publicRecordMeta: () => ({ locked: false, mappingReady: true }),
    mapElement: { classList: { contains: () => false } }, setReferenceImageSurfaceActions() {},
    lastMessage: 'previous trace result', lastTone: 'success', setMessage: (...args) => writes.push(args) };
  const sync = vm.runInNewContext(`(${match[1]})`, context);
  sync();
  assert.equal(writes.length, 0, 'idle tracing cannot overwrite the next boundary analysis/apply message');
  context.state = { recordId: 'map-a', phase: 'tracking', anchors: [], segments: [], previewPoints: [] };
  sync();
  assert.equal(writes.length, 1, 'the active tool still restores its current instruction after a panel render');
});
