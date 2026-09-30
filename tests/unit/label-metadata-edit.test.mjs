import assert from 'node:assert/strict';
import test from 'node:test';
import { createTerritorialConversion } from '../../assets/js/modules/app-territorial-conversion.js';

function setup() {
  const label = { id: 'label-1', name: 'Old name', kind: 'city', notes: 'Old notes' };
  const events = [];
  const snapshots = [];
  const owner = createTerritorialConversion();
  owner.connect({
    projectState: { state: { selected: { domain: 'label', id: label.id }, labels: [label] } },
    domains: {
      projectDomain: {
        recordHistory() { snapshots.push({ ...label }); events.push('history'); },
        queueAutosave() { events.push('autosave'); },
      },
      renderingDomain: { invalidateLabels(reason) { events.push(['render', reason, { ...label }]); } },
    },
    layers: { markLayerTreeDirty() { events.push(['tree', { ...label }]); } },
    propertyEditingA: { applyLabelSelectionIntent(id, refreshOnly) { events.push(['present', id, refreshOnly, { ...label }]); } },
    feedback: { setActionStatus() { events.push('status'); } },
  });
  return { label, owner, events, snapshots };
}

for (const [field, value] of [['name', 'New name'], ['kind', 'capital']]) {
  test(`${field} edit updates the model and invalidates labels after presenter refresh`, () => {
    const { label, owner, events, snapshots } = setup();
    const before = { ...label };
    owner.commitLabelEdit(field, value);
    assert.equal(label[field], value);
    assert.deepEqual(snapshots, [before]);
    assert.deepEqual(events, [
      'history', ['tree', { ...label }], ['present', label.id, true, { ...label }],
      ['render', 'label-metadata-edited', { ...label }], 'autosave', 'status',
    ]);
  });
}

test('notes edit preserves history and autosave without invalidating map labels or the tree', () => {
  const { label, owner, events, snapshots } = setup();
  const before = { ...label };
  owner.commitLabelEdit('notes', 'New notes');
  assert.equal(label.notes, 'New notes');
  assert.deepEqual(snapshots, [before]);
  assert.deepEqual(events, ['history', ['present', label.id, true, { ...label }], 'autosave', 'status']);
});

test('unchanged metadata returns false without history, presentation, rendering or autosave', () => {
  const { label, owner, events, snapshots } = setup();
  const before = { ...label };
  for (const field of ['name', 'kind', 'notes']) assert.equal(owner.commitLabelEdit(field, label[field]), false);
  assert.deepEqual(label, before);
  assert.deepEqual(events, []);
  assert.deepEqual(snapshots, []);
});
