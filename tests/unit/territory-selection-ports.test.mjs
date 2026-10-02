import assert from 'node:assert/strict';
import test from 'node:test';
import { createMapInteractionPorts } from '../../assets/js/modules/app-capability-ports-map-interaction.js';
import { createToolBindings } from '../../assets/js/modules/app-tool-bindings.js';

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
  const state = { territorySelectionSession: { stage: 'selection' } };
  const providers = {
    territorySelectionWorkflow: { back: () => { state.territorySelectionSession.stage = 'setup'; } },
  };
  const ports = createMapInteractionPorts(providers);
  const cancelButton = new EventTarget();
  const resetButton = new EventTarget();
  const bindings = createToolBindings();
  bindings.connect(Object.freeze({
    platform: { $: id => ({ modeCancelBtn: cancelButton, resetViewBtn: resetButton })[id] || null },
    projectState: { state },
    countryCommitFlow: { addMultiDraftPart() {}, undoMultiDraftPart() {} },
    navigation: { resetView() {} },
    countryEditingA: { cancelActiveMode: () => { state.territorySelectionSession = null; } },
    territorySelectionB: ports.territorySelectionB,
  }));
  bindings.bindToolUI();
  return { state, providers, click: () => cancelButton.dispatchEvent(new Event('click')) };
}

test('the existing cancel button dispatches back without the removed alias port', () => {
  const fixture = createToolbarFixture();
  fixture.click();
  assert.equal(fixture.state.territorySelectionSession.stage, 'setup');
});

test('the bound cancel button reads a replacement workflow rather than a captured back function', () => {
  const fixture = createToolbarFixture();
  fixture.providers.territorySelectionWorkflow = {
    back: () => { fixture.state.territorySelectionSession.stage = 'reference'; },
  };
  fixture.click();
  assert.equal(fixture.state.territorySelectionSession.stage, 'reference');
});

test('the cancel button in setup exits the mode instead of navigating back', () => {
  const fixture = createToolbarFixture();
  fixture.state.territorySelectionSession.stage = 'setup';
  fixture.providers.territorySelectionWorkflow = null;
  fixture.click();
  assert.equal(fixture.state.territorySelectionSession, null);
});
