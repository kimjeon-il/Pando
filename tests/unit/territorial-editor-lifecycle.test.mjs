import assert from 'node:assert/strict';
import test from 'node:test';
import { createApplicationLifecycle } from "../../shared/frontend/js/modules/application-lifecycle.js";
import { createLifecycleAssembly } from "../../apps/editor/frontend/js/modules/app-lifecycle-assembly.js";
import { createGlobalInputBindings } from "../../apps/editor/frontend/js/modules/app-global-input-bindings.js";
import { createTaskPresentation } from "../../apps/editor/frontend/js/modules/app-task-presentation.js";
import { createTerritorialPropertyController } from "../../apps/editor/frontend/js/modules/territorial-property-controller.js";
import { createFoundationPorts } from "../../apps/editor/frontend/js/modules/app-capability-ports-foundation.js";
import { createProjectUiBridge } from "../../apps/editor/frontend/js/modules/project-ui-bridge.js";
import { createPropertyEditorBindings } from "../../apps/editor/frontend/js/modules/property-editor-bindings.js";
import { createGisWorkflowController } from "../../apps/editor/frontend/js/modules/gis-workflow-controller.js";
import { createMapDebugController } from "../../apps/editor/frontend/js/modules/map-debug-controller.js";
import { createMapInputPresentation } from "../../shared/frontend/js/modules/map-input-presentation.js";
import { LIFECYCLE_UI_OWNER_PORTS, MAP_INTERACTION_OWNER_PORTS } from "../../apps/editor/frontend/js/modules/app-capability-ports.js";
import { capabilityPortsForFixture } from './helpers/capability-port-fixture.mjs';
import { editorNode } from './helpers/editor-dom-fixture.mjs';

const { EventTarget, Event, CustomEvent } = globalThis;

function environment(t) {
  const listeners = new Map();
  const window = Object.assign(new EventTarget(), { CustomEvent });
  const document = { activeElement: null, querySelectorAll: () => [],
    addEventListener: (type, listener) => listeners.set(type, listener) };
  for (const [name, value] of Object.entries({ window, document, location: { hostname: 'localhost', search: '' },
    localStorage: {}, requestAnimationFrame: () => 1 })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    });
  }
  return { window, listeners };
}

function taskFixture(domainControllers) {
  const owner = createTaskPresentation();
  owner.connect({
    ...capabilityPortsForFixture(MAP_INTERACTION_OWNER_PORTS.taskPresentation, {
      state: { tool: 'select', geometryPreview: { session: null } },
      $: () => null, hydroToolConfig: () => null, isSpecialTool: () => false,
      setMapModeContextActive() {}, editorWorkspacePresentation: { sync() {} },
    }),
    domainControllers,
  });
  return owner;
}

test('task surface synchronization rejects a missing required editor command', t => {
  environment(t);
  const task = taskFixture({});
  assert.throws(() => task.syncMapContextSurfaces(), TypeError);
});

test('global Escape rejects a missing required editor command instead of falling through', async t => {
  const { listeners } = environment(t);
  const owner = createGlobalInputBindings();
  owner.connect({
    ...capabilityPortsForFixture(LIFECYCLE_UI_OWNER_PORTS.globalInputBindings, {
      state: { tool: 'select', projectReplacing: false, modeProcessing: false },
      $: () => null, systemThemeQuery: { addEventListener() {} },
    }),
    domainControllers: {},
  });
  owner.bindGlobalInputUI();
  const escape = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' });
  await assert.rejects(listeners.get('keydown')(escape), TypeError);
});

for (const operation of ['delete','save','draft-delete','draft-move']) {
  test(`global keyboard ${operation} awaits its command and reports the underlying Worker failure`, async t => {
    const { listeners } = environment(t), errors = [];
    let reject;
    const pending = new Promise((resolve, fail) => { reject = fail; });
    const owner = createGlobalInputBindings();
    owner.connect(capabilityPortsForFixture(LIFECYCLE_UI_OWNER_PORTS.globalInputBindings, {
      state: { tool: 'select', selected: { domain: 'generic', type: 'feature', id: 'G' }, projectReplacing: false },
      $: () => null, systemThemeQuery: { addEventListener() {} },
      editingDraftSnapshot: () => ({ selectedVertexIndex: operation === 'draft-move' ? 0 : null }),
      editingDomain: { draftInputActive: () => operation.startsWith('draft-'),
        deleteSelectedDraftPoint: () => pending, moveSelectedDraftPointByPixels: () => pending }, selectionDomain: { size: () => 1 },
      deleteSelected: () => pending,
      getGisFileController: async () => ({ saveProject: () => pending }),
      reportOperationError: (...args) => errors.push(args),
    }));
    owner.bindGlobalInputUI();
    const event = Object.assign(new Event('keydown', { cancelable: true }),
      { key: operation === 'draft-move' ? 'ArrowLeft' : operation.includes('delete') ? 'Delete' : 's', ctrlKey: operation === 'save' });
    const completion = listeners.get('keydown')(event);
    assert.equal(event.defaultPrevented, true); assert.deepEqual(errors, []);
    const error = Object.assign(new Error('Worker unavailable'), { code: 'PL-CORE-LOAD' });
    reject(error); await completion;
    assert.equal(errors.length, 1); assert.equal(errors[0][0], error);
    assert.equal(errors[0][2], { delete: 'PL-OBJECT-DELETE-001', save: 'PL-PROJECT-SAVE-001',
      'draft-delete': 'PL-DRAFT-DELETE-001', 'draft-move': 'PL-DRAFT-MOVE-001' }[operation]);
  });
}

test('global blur contains a rejected asynchronous draft cancellation and retains its technical error', async t => {
  const { window }=environment(t),errors=[];
  let reject,reported;
  const pending=new Promise((resolve,fail) => { reject=fail; });
  const reportDone=new Promise(resolve => { reported=resolve; });
  const owner=createGlobalInputBindings();
  owner.connect(capabilityPortsForFixture(LIFECYCLE_UI_OWNER_PORTS.globalInputBindings,{
    state: { tool: 'select',projectReplacing: false,spacePanActive: true },syncEditingContext() {},
    $: () => null,systemThemeQuery: { addEventListener() {} },
    mapInteractionGate: { setForcedPan() {} },
    editingDomain: { cancelActiveGesture: () => pending },
    reportOperationError: (...args) => { errors.push(args);reported(); },
  }));
  owner.bindGlobalInputUI();
  window.dispatchEvent(new Event('blur'));
  assert.deepEqual(errors,[]);
  const error=Object.assign(new Error('Core cancel rejected'),{ code: 'STALE_REVISION' });
  reject(error);await reportDone;
  assert.equal(errors.length,1);assert.equal(errors[0][0],error);assert.equal(errors[0][2],'PL-DRAFT-CANCEL-001');
});

test('real lifecycle assembly creates editor capabilities before startup task synchronization and Escape', async t => {
  const { window, listeners } = environment(t);
  let flagOpen = true;
  const flagMenu = { matches: () => flagOpen, hidePopover: () => { flagOpen = false; } };
  const relationElements = new Map(['entityParentRow', 'entityChildRow', 'entityChangeParentBtn', 'entityAddChildBtn'].map(id => [id, editorNode()]));
  const getElement = id => id === 'flagMenu' ? flagMenu : relationElements.get(id) || null;
  const domainAssembly = {
    territorialPropertyController: null,
    initializeDomainBoundaries() {
      domainAssembly.territorialPropertyController = createTerritorialPropertyController({ window, getElement });
    },
  };
  const foundation = createFoundationPorts({ domainAssembly });
  const task = taskFixture(foundation.domainControllers);
  const globalInput = createGlobalInputBindings();
  globalInput.connect({
    ...capabilityPortsForFixture(LIFECYCLE_UI_OWNER_PORTS.globalInputBindings, {
      state: { tool: 'select', projectReplacing: false, modeProcessing: false }, $: getElement,
      systemThemeQuery: { addEventListener() {} },
    }),
    domainControllers: foundation.domainControllers,
  });
  let startupCalls = 0;
  const owner = createLifecycleAssembly();
  owner.connect({
    ...capabilityPortsForFixture(LIFECYCLE_UI_OWNER_PORTS.lifecycleAssembly, {
      $: getElement,
      createApplicationLifecycle,
      createProjectUiBridge,
      createPropertyEditorBindings,
      createGisWorkflowController,
      createMapDebugController,
      createMapInputPresentation,
      installWorkflow() {}, markRuntimeReady() {},
      showFatalError: error => assert.fail(error.stack),
      init: () => {
        startupCalls += 1;
        task.syncMapContextSurfaces();
        globalInput.bindGlobalInputUI();
      },
    }),
    domainControllers: foundation.domainControllers,
  });
  owner.initializeLifecycle();
  const start = owner.lifecycle.start();
  assert.equal(owner.lifecycle.start(), start);
  assert.equal(await start, true);
  assert.equal(startupCalls, 1);
  assert.equal(typeof foundation.domainControllers.syncTerritorialEditorInteraction, 'function');
  const escape = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' });
  listeners.get('keydown')(escape);
  assert.equal(flagOpen, false);
  assert.equal(escape.defaultPrevented, true);
  owner.lifecycle.dispose();
});
