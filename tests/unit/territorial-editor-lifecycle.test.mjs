import assert from 'node:assert/strict';
import test from 'node:test';
import { createApplicationLifecycle } from '../../assets/js/modules/application-lifecycle.js';
import { createLifecycleAssembly } from '../../assets/js/modules/app-lifecycle-assembly.js';
import { createGlobalInputBindings } from '../../assets/js/modules/app-global-input-bindings.js';
import { createTaskPresentation } from '../../assets/js/modules/app-task-presentation.js';
import { createTerritorialPropertyController } from '../../assets/js/modules/territorial-property-controller.js';
import { createFoundationPorts } from '../../assets/js/modules/app-capability-ports-foundation.js';
import { createProjectUiBridge } from '../../assets/js/modules/project-ui-bridge.js';
import { createPropertyEditorBindings } from '../../assets/js/modules/property-editor-bindings.js';
import { createGisWorkflowController } from '../../assets/js/modules/gis-workflow-controller.js';
import { createMapDebugController } from '../../assets/js/modules/map-debug-controller.js';
import { createMapInputPresentation } from '../../assets/js/modules/map-input-presentation.js';
import { LIFECYCLE_UI_OWNER_PORTS, MAP_INTERACTION_OWNER_PORTS } from '../../assets/js/modules/app-capability-ports.js';
import { capabilityPortsForFixture } from './helpers/capability-port-fixture.mjs';

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

test('global Escape rejects a missing required editor command instead of falling through', t => {
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
  assert.throws(() => listeners.get('keydown')(escape), TypeError);
});

test('real lifecycle assembly creates editor capabilities before startup task synchronization and Escape', async t => {
  const { window, listeners } = environment(t);
  let flagOpen = true;
  const flagMenu = { matches: () => flagOpen, hidePopover: () => { flagOpen = false; } };
  const getElement = id => id === 'flagMenu' ? flagMenu : null;
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
