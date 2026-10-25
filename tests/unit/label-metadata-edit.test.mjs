import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createNodeCoreProject } from '../helpers/core-project.mjs';
import { createTerritorialConversion } from "../../apps/editor/frontend/js/modules/app-territorial-conversion.js";

const seed = () => JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json', import.meta.url), 'utf8'));

async function setup(t) {
  const initial = seed(), label = initial.labels[0], core = await createNodeCoreProject(initial), events = [];
  t.after(() => core.dispose());
  const current = () => core.documentModel.get({ domain: 'label', id: label.id });
  const state = { selected: { domain: 'label', type: label.kind, id: label.id },
    get labels() { return core.documentModel.list('label'); } };
  const owner = createTerritorialConversion();
  owner.connect({
    projectState: { state },
    domains: { projectDomain: core.project,
      renderingDomain: { invalidateLabels(reason) { events.push(['render', reason, current()]); } } },
    objectDisplay: { invalidateObjectPresentation() { events.push(['tree', current()]); } },
    propertyEditingA: { async applyLabelSelectionIntent(id, refreshOnly) { events.push(['present', id, refreshOnly, current()]); } },
    feedback: { setActionStatus() { events.push('status'); } },
  });
  return { core, label, current, owner, events };
}

for (const [field, value] of [['name', 'New name'], ['kind', 'capital']]) {
  test(`${field} edit updates the Core model and invalidates labels after presenter refresh`, async t => {
    const { core, label, current, owner, events } = await setup(t);
    assert.equal(await owner.commitLabelEdit(field, value), true);
    assert.equal(current()[field], value);
    assert.equal(core.client.state().canUndo, true);
    assert.deepEqual(events, [
      ['tree', current()], ['present', label.id, true, current()],
      ['render', 'label-metadata-edited', current()], 'status',
    ]);
    await core.project.undo();
    assert.equal(current()[field], label[field]);
  });
}

test('notes edit preserves Core history without invalidating map labels or the tree', async t => {
  const { core, label, current, owner, events } = await setup(t);
  assert.equal(await owner.commitLabelEdit('notes', 'New notes'), true);
  assert.equal(current().notes, 'New notes');
  assert.equal(core.client.state().canUndo, true);
  assert.deepEqual(events, [['present', label.id, true, current()], 'status']);
  await core.project.undo();
  assert.equal(current().notes, label.notes);
});

test('unchanged metadata returns false without Core history or presentation updates', async t => {
  const { core, label, current, owner, events } = await setup(t);
  for (const field of ['name', 'kind', 'notes']) assert.equal(await owner.commitLabelEdit(field, label[field]), false);
  assert.deepEqual(current(), label);
  assert.equal(core.client.state().canUndo, false);
  assert.deepEqual(events, []);
});
