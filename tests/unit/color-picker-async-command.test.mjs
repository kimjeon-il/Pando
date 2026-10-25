import assert from 'node:assert/strict';
import test from 'node:test';
import { createColorPicker } from "../../apps/editor/frontend/js/modules/app-color-picker.js";
import { editorNode } from './helpers/editor-dom-fixture.mjs';

test('territorial color picker waits for the command and contains a rejected Worker acknowledgement', async t => {
  const beforeDocument = globalThis.document, beforeWindow = globalThis.window;
  t.after(() => { globalThis.document = beforeDocument; globalThis.window = beforeWindow; });
  const picker = Object.assign(editorNode(), { dataset: { colorPicker: 'entity' }, hasAttribute: () => false });
  const button = editorNode(), popover = editorNode(), trigger = editorNode();
  picker.querySelector = selector => selector === '[data-color-default]' ? button : selector === '.ui-color-popover' ? popover : selector === '.ui-color-trigger' ? trigger : null;
  globalThis.document = { querySelectorAll: () => [picker], addEventListener() {} };
  globalThis.window = { addEventListener() {} };
  let release;
  const command = new Promise(resolve => { release = resolve; });
  const errors = [], statuses = [], failure = Object.assign(new Error('Worker lost document'), { code: 'PL-CORE-DOCUMENT' });
  let reject = false;
  const owner = createColorPicker();
  owner.connect({ projectState: { state: { selected: { domain: 'territorial', type: 'entity', id: 'A' } } },
    objectMetadata: { commitTerritorialMetadata: async () => { await command; if (reject) throw failure; return { ok: true }; } },
    readiness: { reliabilityDiagnostic: { push: value => errors.push(value) } }, feedback: { setActionStatus: (...args) => statuses.push(args) },
  });
  owner.bindColorPickers();
  const pending = button.click();
  assert.equal(popover.classList.contains('hidden'), false);
  release(); await pending;
  assert.equal(popover.classList.contains('hidden'), true);
  popover.classList.remove('hidden'); reject = true;
  await button.click();
  assert.equal(popover.classList.contains('hidden'), false);
  assert.equal(errors[0].code, failure.code); assert.equal(errors[0].message, failure.message);
  assert.equal(statuses[0][1], 'error');
});
