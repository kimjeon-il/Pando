import assert from 'node:assert/strict';
import test from 'node:test';
import { createGenericCommands } from "../../apps/editor/frontend/js/modules/app-generic-commands.js";
import { createCountryModes } from "../../apps/editor/frontend/js/modules/app-country-modes.js";
import { createEditingDomain } from "../../apps/editor/frontend/js/modules/editing-domain.js";

const held = () => {
  let resolve, reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
};
const entity = { id: 'A', properties: { entityKind: 'general', parentId: '', name: 'Alpha' } };
function fixture(factory) {
  const calls = [], state = { tool: 'redraw-territorial-unit', territorialUnitRedrawSourceId: 'A',
    genericFeatures: [], selected: null, distributionDraft: null, geometryPreview: {} };
  let generation = 1;
  const domain = factory();
  const ports = {
    projectState: { state },
    countryEditingA: { editingDraftCoordinates: () => [], cancelActiveMode: async () => calls.push('cancel-mode') },
    surfaces: { isGenericFeatureDraftTool: () => true },
    draftPresentation: { hydroToolConfig: () => null },
    feedback: { setActionStatus: (...args) => calls.push(['status', ...args]) },
    readinessUi: { clearNotification() {}, setCurrentTool() {} },
    projectRestore: { openConfirmModal: options => { ports.confirmation = options; } },
    territorialModel: { entityRepository: { get: id => id === 'A' ? entity : null } },
    propertyEditingA: { distributionLayerById: () => null },
    objectOperationsB: { requireObjectsUnlocked: () => true },
    objectPresentation: { territorialEntityName: feature => feature.properties.name },
    spatialQuery: { mapEditClient: { cancel() {} } },
    geometryPreview: { rebuildBoundaryTopology: () => calls.push('topology') },
    taskUi: { setModeBanner() {}, updateModeButtons() {} },
    taskPresentation: { syncCountryActionButtons() {} },
    domains: {
      projectDomain: { getGeneration: () => generation, queueAutosave: () => calls.push('save') },
      editingDomain: { snapshot: () => ({boundaryDraft:null}), draftInputActive: () => true, clearDraft: async () => calls.push('clear'),
        setTool: async tool => { calls.push(['tool', tool]); return true; } },
      selectionUiController: { applyIntent: async ref => calls.push(['select', ref.id]),
        restore: async () => calls.push('restore'), clear: async () => calls.push('selection-clear') },
      renderingDomain: { invalidateGpuInteraction: () => calls.push('render'),
        invalidateCountryPatch: () => calls.push('render'), invalidateEditingOverlays: () => calls.push('render') },
    },
  };
  domain.connect(ports);
  return { domain, ports, state, calls, replace: () => generation++ };
}

test('draft cancellation awaits Core clear and tool before restoring selected object or announcing success', async () => {
  const f = fixture(createGenericCommands), clear = held(), tool = held();
  f.ports.domains.editingDomain.clearDraft = options => { assert.deepEqual(options, { render: true }); return clear.promise; };
  f.ports.domains.editingDomain.setTool = () => { f.calls.push('tool-start'); return tool.promise; };
  const operation = f.domain.cancelDraft();
  assert.deepEqual(f.calls, []);
  clear.resolve(true); await Promise.resolve();
  assert.deepEqual(f.calls, ['tool-start']);
  tool.resolve(true); await operation;
  assert.equal(f.calls[1][0], 'select');
  assert.equal(f.calls.at(-1)[0], 'status');
});

test('rejected draft cancellation preserves the underlying failure and does not restore or announce', async () => {
  const f = fixture(createGenericCommands), clear = held();
  f.ports.domains.editingDomain.clearDraft = () => clear.promise;
  const operation = f.domain.cancelDraft(), error = new Error('Core cancellation failed');
  const rejection = assert.rejects(operation, failure => failure === error);
  clear.reject(error); await rejection;
  assert.deepEqual(f.calls, []);
});

test('draft discard action completion and modal confirmation retain their asynchronous result', async () => {
  const f = fixture(createGenericCommands), action = held();
  let complete = false;
  const operation = f.domain.requestDraftDiscard(() => action.promise).then(result => { complete = true; return result; });
  await Promise.resolve(); assert.equal(complete, false);
  action.resolve(); assert.equal(await operation, true);
  f.ports.countryEditingA.editingDraftCoordinates = () => [[0, 0], [1, 1], [2, 2]];
  assert.equal(await f.domain.requestDraftDiscard(async () => { throw new Error('Core rejected confirmed cancel'); }), false);
  await assert.rejects(f.ports.confirmation.onConfirm(), /Core rejected confirmed cancel/);
});

test('coast mode awaits Core tool acceptance before installing topology and mode state', async () => {
  const f = fixture(createCountryModes), tool = held();
  f.ports.domains.editingDomain.setTool = () => tool.promise;
  const operation = f.domain.enterCountryCoastEdit('A');
  assert.equal(f.state.coastEditCountryId, undefined); assert.deepEqual(f.calls, []);
  tool.resolve(true); assert.equal(await operation, true);
  assert.equal(f.state.coastEditCountryId, 'A'); assert.deepEqual(f.calls, ['topology']);
});

test('coast mode suppresses delayed topology and selection on project replacement', async () => {
  const f = fixture(createCountryModes), tool = held();
  f.ports.domains.editingDomain.setTool = () => tool.promise;
  const operation = f.domain.enterCountryCoastEdit('A');
  f.replace(); tool.resolve(true); assert.equal(await operation, false);
  assert.equal(f.state.coastEditCountryId, undefined); assert.deepEqual(f.calls, []);
});

test('cancel mode awaits Core tool and selection acknowledgement before success presentation', async () => {
  const f = fixture(createCountryModes), tool = held(), selection = held();
  f.state.tool = 'country-coast'; f.state.coastEditCountryId = 'A';
  f.ports.domains.editingDomain.setTool = () => tool.promise;
  f.ports.domains.selectionUiController.applyIntent = () => selection.promise;
  const operation = f.domain.cancelActiveMode();
  await Promise.resolve(); assert.equal(f.calls.some(call => call[0] === 'status'), false);
  tool.resolve(true); await Promise.resolve();
  assert.equal(f.calls.some(call => call[0] === 'status'), false);
  selection.resolve(); await operation;
  assert.equal(f.calls.at(-1)[0], 'status');
});

test('a newer tool request supersedes a held earlier Core transition without restarting its old draft', async () => {
  const barrier = held(), entered = held(), calls = [], presentation = [];
  const snapshot = { active: false, coords: [], revision: 0, inputPhase: 'draw', insertMode: false,
    selectedVertexIndex: null, insertTarget: null, dragging: false, historyCount: 0, futureCount: 0 };
  let queue = Promise.resolve();
  const owner = { state: () => ({ epoch: 1 }), subscribeTransitions: () => () => {}, draftApply(payload) {
    const operation = queue.then(async () => {
      calls.push(payload);
      if (calls.length === 1) { entered.resolve(); await barrier.promise; }
      return { result: true, snapshot };
    });
    queue = operation; return operation;
  } };
  const editing = createEditingDomain({ commandOwner: owner, projectDomain: { getGeneration: () => 1 },
    draftServices: { requestFrame() {}, cancelFrame() {}, reportOperationError: error => assert.fail(error.stack),
      getToolConfig: tool => ({ shape: tool === 'lake' ? 'polygon' : 'line' }) },
    toolController: { applyToolPresentation: tool => presentation.push(tool) } });
  const river = editing.setTool('river'); await entered.promise;
  const lake = editing.setTool('lake'); barrier.resolve();
  assert.equal(await river, false); assert.equal(await lake, true);
  assert.deepEqual(presentation, ['lake']);
  assert.deepEqual(calls.filter(row => row.action === 'start').map(row => row.shape), ['polygon']);
  editing.dispose();
});
