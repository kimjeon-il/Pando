import assert from 'node:assert/strict';
import test from 'node:test';
import { createPropertySelection } from '../../assets/js/modules/app-property-selection.js';
import { OBJECT_EDITING_OWNER_PORTS } from '../../assets/js/modules/app-capability-ports.js';
import { capabilityPortsForFixture } from './helpers/capability-port-fixture.mjs';
import { createTerritorialPropertyController } from '../../assets/js/modules/territorial-property-controller.js';
import { createFoundationPorts } from '../../assets/js/modules/app-capability-ports-foundation.js';

test('foundation transient capability closes the actual editor flag popover and restores focus', () => {
  let flagOpen = true;
  const focusCalls = [];
  const elements = {
    editorSurface: { querySelector: () => null },
    flagMenu: {
      matches: selector => selector === ':popover-open' && flagOpen,
      hidePopover: () => { flagOpen = false; },
    },
    flagMenuBtn: { disabled: false, focus: options => focusCalls.push(options) },
  };
  const territorialPropertyController = createTerritorialPropertyController({ getElement: id => elements[id] });
  const ports = createFoundationPorts({ domainAssembly: { territorialPropertyController } });
  assert.equal(ports.domainControllers.closeTerritorialEditorTransient({ restoreFocus: true }), true);
  assert.equal(flagOpen, false);
  assert.deepEqual(focusCalls, [{ preventScroll: true }]);
  assert.equal(ports.domainControllers.closeTerritorialEditorTransient({ restoreFocus: true }), false);
  assert.equal(focusCalls.length, 1);
  assert.equal(Object.hasOwn(territorialPropertyController, 'syncOcclusion'), false);
});

test('territorial selection enters the editor through the common controller, while refresh does not reopen it', t => {
  const previousWindow = globalThis.window;
  globalThis.window = {};
  t.after(() => { globalThis.window = previousWindow; });
  const intents = [];
  const propertySelection = createPropertySelection();
  propertySelection.connect(capabilityPortsForFixture(OBJECT_EDITING_OWNER_PORTS.propertySelection, {
    normalizeObjectRef: ref => ({ ...ref, key: `${ref.domain}:${ref.type}:${ref.id}` }),
    entityRepository: { get: id => ({ id, properties: { entityKind: 'general', parentId: id === 'DEU' ? '' : 'DEU' } }) },
    selectionUiController: {
      applyIntent: (ref, options) => {
        intents.push({ ref, options });
        return true;
      },
    },
  }));

  propertySelection.initializePropertySelection();
  assert.equal(globalThis.window.PANDOLAB_TERRITORIAL.select('DEU'), true);
  assert.equal(globalThis.window.PANDOLAB_TERRITORIAL.select('subunit-1'), true);
  assert.deepEqual(intents.map(intent => intent.options.openEditor), [true, true]);
  assert.deepEqual(intents.map(intent => intent.ref.type), ['entity', 'entity']);
  globalThis.window.PANDOLAB_TERRITORIAL.select('DEU', true);
  assert.equal(intents.at(-1).options.openEditor, false);
});
