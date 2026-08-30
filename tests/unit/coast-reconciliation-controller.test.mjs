import assert from 'node:assert/strict';
import test from 'node:test';

import { createCoastReconciliationController } from '../../assets/js/modules/coast-reconciliation-controller.js';

function createController() {
  const hidden = new Set(['hidden']);
  const createButton = () => {
    const listeners = new Map();
    return {
      textContent: '',
      addEventListener: (type, listener) => listeners.set(type, listener),
      click: () => listeners.get('click')?.(),
      focus() {},
    };
  };
  const elements = {
    modal: {
      classList: { add: value => hidden.add(value), remove: value => hidden.delete(value), contains: value => hidden.has(value) },
      addEventListener() {},
    },
    title: { textContent: '' },
    message: { textContent: '' },
    subject: createButton(),
    country: createButton(),
    impact: null,
    impactList: null,
    cancel: createButton(),
  };
  return {
    elements,
    controller: createCoastReconciliationController({
      document: {},
      window: { requestAnimationFrame: callback => callback() },
      elements,
    }),
  };
}

test('coast reconciliation labels its subject for the active workflow', async () => {
  const { controller, elements } = createController();
  controller.bind();

  const manual = controller.open({ subjectName: '슐레스비히', subjectActionLabel: '행정구역', countryName: '독일' });
  assert.equal(elements.subject.textContent, '행정구역 기준');
  assert.match(elements.message.textContent, /슐레스비히.*독일/u);
  elements.subject.click();
  assert.deepEqual(await manual, { direction: 'admin-to-country' });

  const imported = controller.open({ subjectName: '가져온 지방', subjectActionLabel: '가져온 영역', countryName: '독일' });
  assert.equal(elements.subject.textContent, '가져온 영역 기준');
  elements.cancel.click();
  assert.deepEqual(await imported, { direction: 'cancel' });
});
