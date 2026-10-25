import assert from 'node:assert/strict';
import test from 'node:test';
import { createPropertyEditorBindings } from "../../apps/editor/frontend/js/modules/property-editor-bindings.js";
import { editorNode } from './helpers/editor-dom-fixture.mjs';

test('property field and entry event boundaries await failures with operation and technical error context', async () => {
  const fields = new Map(['hydroNameInput','distributionEntryList','convertGenericFeatureBtn'].map(id => [id, Object.assign(editorNode(), { id })]));
  const errors = [], failure = Object.assign(new Error('C++ command rejected transport'), { code: 'PL-CORE-COMMAND' });
  const bindings = createPropertyEditorBindings({ getElement: id => fields.get(id), bindColorPickers() {},
    getPrimary: () => ({ domain: 'generic', id: 'G' }),
    commitHydroEdit: async () => { throw failure; }, updateDistributionEntryValue: async () => { throw failure; },
    reportOperationError: (error, context) => errors.push({ error, context }),
  });
  bindings.bind();
  await fields.get('hydroNameInput').dispatch('change');
  await fields.get('distributionEntryList').dispatch('change', { target: { closest: () => ({ dataset: { distributionEntryValue: 'entry' }, value: '4' }) } });
  assert.deepEqual(errors.map(row => row.error), [failure, failure]);
  assert.deepEqual(errors.map(row => row.context), [
    { elementId: 'hydroNameInput', eventType: 'change' }, { elementId: 'distributionEntryList', eventType: 'change' },
  ]);
  bindings.dispose();
});

test('generic conversion event awaits its command without an unhandled promise rejection', async () => {
  const values = { genericFeatureConvertType: 'general', genericFeatureConvertParentInput: 'P', genericFeatureConvertDistributionInput: '', genericFeatureConvertDistributionValueInput: '' };
  const fields = new Map(Object.keys(values).concat('convertGenericFeatureBtn').map(id => [id, Object.assign(editorNode(), { id, value: values[id] || '' })]));
  const failure = new Error('atomic conversion failed'), errors = [];
  const bindings = createPropertyEditorBindings({ getElement: id => fields.get(id), bindColorPickers() {},
    getPrimary: () => ({ domain: 'generic', id: 'G' }), convertSelectedGenericFeature: async () => { throw failure; },
    reportOperationError: error => errors.push(error),
  });
  bindings.bind();
  await fields.get('convertGenericFeatureBtn').click();
  assert.deepEqual(errors, [failure]);
  bindings.dispose();
});
