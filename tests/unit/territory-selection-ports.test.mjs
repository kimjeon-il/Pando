import assert from 'node:assert/strict';
import test from 'node:test';
import { createMapInteractionPorts } from "../../apps/editor/frontend/js/modules/app-capability-ports-map-interaction.js";
import { createToolBindings } from "../../apps/editor/frontend/js/modules/app-tool-bindings.js";
import { createTaskPresentation } from "../../apps/editor/frontend/js/modules/app-task-presentation.js";
const { EventTarget, Event } = globalThis;

const selectionPortNames = ['territorySelectionA', 'territorySelectionB', 'territorySelectionC'];

test('territory selection ports stay frozen and within the twelve-member limit', () => {
  const ports = createMapInteractionPorts({});
  assert.equal(Object.isFrozen(ports), true);
  for (const name of selectionPortNames) {
    assert.equal(Object.isFrozen(ports[name]), true, name);
    assert.ok(Object.keys(ports[name]).length <= 12, `${name} exceeds the twelve-member port limit`);
  }
});

test('territory selection exposes back only through its canonical capability', () => {
  const workflow = new Proxy({}, { get: (_target, field) => field });
  const ports = createMapInteractionPorts({ territorySelectionWorkflow: workflow });
  const backCapabilities = selectionPortNames.flatMap(name => Object.entries(ports[name])
    .filter(([, field]) => field === 'back')
    .map(([member]) => `${name}.${member}`));
  assert.deepEqual(backCapabilities, ['territorySelectionB.territorySelectionBack']);
  assert.equal(Object.hasOwn(ports.territorySelectionA, 'backToTerritorialSelection'), false);
});

test('the canonical back capability resolves the live workflow and fails when its owner is missing', () => {
  const first = { back: () => 'first' };
  const providers = { territorySelectionWorkflow: first };
  const ports = createMapInteractionPorts(providers);
  const backPort = ports.territorySelectionB;
  assert.strictEqual(backPort.territorySelectionBack, first.back);
  assert.equal(backPort.territorySelectionBack(), 'first');
  providers.territorySelectionWorkflow = null;
  assert.throws(() => backPort.territorySelectionBack, TypeError);
  const replacement = { back: () => 'replacement' };
  providers.territorySelectionWorkflow = replacement;
  assert.strictEqual(ports.territorySelectionB, backPort);
  assert.strictEqual(backPort.territorySelectionBack, replacement.back);
  assert.equal(backPort.territorySelectionBack(), 'replacement');
});

function createToolbarFixture() {
  const state = { territorySelectionSession: { stage: 'review' }, geometryPreview: { session: null },
    modeProcessing: false, labelPlacementMode: false, tool: 'territory-selection' };
  const providers = {
    territorySelectionWorkflow: { back: () => { state.territorySelectionSession.stage = 'selection'; } },
  };
  const ports = createMapInteractionPorts(providers);
  const cancelButton = new EventTarget();
  const returnButton = new EventTarget();
  const resetButton = new EventTarget();
  const addEntityButton = new EventTarget();
  const regionalInput = new EventTarget();
  const errors = [];
  let action = null, discardRequests = 0;
  const presentation = createTaskPresentation();
  presentation.connect({
    projectState: { state },
    genericEditingB: { requestDraftDiscard: async callback => { discardRequests += 1; await callback(); return true; } },
    surfaces: { isGenericFeatureDraftTool: () => false },
    countryEditingA: { cancelActiveMode: () => { state.territorySelectionSession = null; } },
    territorySelectionB: ports.territorySelectionB,
  });
  const bindings = createToolBindings();
  bindings.connect(Object.freeze({
    platform: { $: id => ({ modeCancelBtn: cancelButton, modeReturnBtn: returnButton, resetViewBtn: resetButton, addEntityBtn: addEntityButton, territorialCreateRegionalInput: regionalInput })[id] || null },
    projectState: { state },
    countryCommitFlow: { addMultiDraftPart() {}, undoMultiDraftPart() {} },
    taskPresentation: { toggleMapTaskWindow() {},
      returnToEditing: () => (action = presentation.returnToEditing()),
      cancelCurrentEditing: () => (action = presentation.cancelCurrentEditing()) },
    feedback: { reportOperationError: error => errors.push(error) },
    navigation: { resetView() {} },
  }));
  bindings.bindToolUI();
  return { state, providers, discardRequests: () => discardRequests,
    async click(kind = 'return') {
      action = null;
      (kind === 'cancel' ? cancelButton : returnButton).dispatchEvent(new Event('click'));
      assert.ok(action instanceof Promise, 'the button must invoke its canonical async task operation');
      await action;
      assert.deepEqual(errors, []);
    } };
}

test('the review return button dispatches back through the canonical task presentation', async () => {
  const fixture = createToolbarFixture();
  await fixture.click();
  assert.equal(fixture.state.territorySelectionSession.stage, 'selection');
  assert.equal(fixture.discardRequests(), 0);
});

test('the bound review return button reads the live replacement workflow', async () => {
  const fixture = createToolbarFixture();
  fixture.providers.territorySelectionWorkflow = {
    back: () => { fixture.state.territorySelectionSession.stage = 'reference'; },
  };
  await fixture.click();
  assert.equal(fixture.state.territorySelectionSession.stage, 'reference');
});

for (const stage of ['setup', 'selection', 'review']) test(`the cancel button in ${stage} discards through the task owner and exits the mode`, async () => {
  const fixture = createToolbarFixture();
  fixture.state.territorySelectionSession.stage = stage;
  fixture.providers.territorySelectionWorkflow = null;
  await fixture.click('cancel');
  assert.equal(fixture.state.territorySelectionSession, null);
  assert.equal(fixture.discardRequests(), 1);
});
