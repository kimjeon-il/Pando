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
