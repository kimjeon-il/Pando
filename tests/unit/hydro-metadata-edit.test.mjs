import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createNodeCoreProject } from '../helpers/core-project.mjs';
import { createObjectMetadata } from "../../apps/editor/frontend/js/modules/app-object-metadata.js";
import { createGpuMapRenderer } from "../../shared/frontend/js/modules/gpu-map-renderer.js";

const seed = () => JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json', import.meta.url), 'utf8'));

async function setup(t, { locked = false } = {}) {
  const initial = seed(), hydro = initial.hydroEdits[0], events = [];
  hydro.properties.locked = locked;
  const core = await createNodeCoreProject(initial);
  t.after(() => core.dispose());
  const current = () => core.documentModel.get({ domain: 'hydro', id: hydro.id });
  const state = { selected: { domain: 'hydro', type: 'river', id: hydro.id },
    get hydroEdits() { return core.documentModel.list('hydro'); },
    get stateRevision() { return core.client.state().stateRevision; } };
  const owner = createObjectMetadata();
  owner.connect({
    projectState: { state },
    hydroPresentation: { hydroEditById: id => core.documentModel.get({ domain: 'hydro', id }), hydroCategoryLabel: () => '강' },
    domains: { projectDomain: core.project,
      renderingDomain: { invalidateHydroPatch(reason) { events.push(['render', reason, state.stateRevision, current().properties.editorColor]); } } },
    objectDisplay: { invalidateObjectPresentation() { events.push('tree'); } },
    propertyEditingA: { async applyHydroSelectionIntent(id, refreshOnly) { events.push(['present', id, refreshOnly]); } },
    feedback: { setActionStatus(_message, kind) { events.push(['status', kind]); } },
  });
  return { core, hydro, state, current, owner, events };
}

function gpuRenderer(t, state) {
  const previousWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 };
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });
  const renderer = createGpuMapRenderer({ state, runtimeAssetUrl: path => path, isMobile: () => false, scheduleGpuFrame() {},
    renderCountryBoundaryFeatures: () => [], countryBoundaryStyleById: () => null });
  t.after(() => renderer.dispose());
  return renderer;
}

test('normalized color change advances Core revision before invalidating and refreshing', async t => {
  const { core, hydro, state, current, owner, events } = await setup(t);
  assert.equal(await owner.commitHydroEdit('editorColor', '#ABCDEF'), true);
  assert.equal(current().properties.editorColor, '#abcdef');
  assert.equal(state.stateRevision, 1);
  assert.equal(core.client.state().canUndo, true);
  assert.deepEqual(events, [['render', 'hydro-color-edited', 1, '#abcdef'],
    ['present', hydro.id, true], ['status', 'success']]);
  await core.project.undo();
  assert.equal(current().properties.editorColor, hydro.properties.editorColor);
});

test('name change dirties the tree without a hydro patch', async t => {
  const { core, hydro, state, current, owner, events } = await setup(t);
  assert.equal(await owner.commitHydroEdit('name', 'New river'), true);
  assert.equal(current().properties.name, 'New river');
  assert.equal(state.stateRevision, 1);
  assert.deepEqual(events, ['tree', ['present', hydro.id, true], ['status', 'success']]);
  await core.project.undo();
  assert.equal(current().properties.name, hydro.properties.name);
});

test('notes change preserves Core history without dirtying tree or hydro rendering', async t => {
  const { core, hydro, current, owner, events } = await setup(t);
  assert.equal(await owner.commitHydroEdit('notes', 'New notes'), true);
  assert.equal(current().properties.notes, 'New notes');
  assert.equal(core.client.state().canUndo, true);
  assert.deepEqual(events, [['present', hydro.id, true], ['status', 'success']]);
  await core.project.undo();
  assert.equal(current().properties.notes, hydro.properties.notes);
});

test('unchanged metadata has no Core history or presentation side effects', async t => {
  const { core, hydro, current, owner, events } = await setup(t);
  for (const [field, value] of [['editorColor', '#654321'], ['name', hydro.properties.name], ['notes', hydro.properties.notes]]) {
    assert.equal(await owner.commitHydroEdit(field, value), false);
  }
  assert.deepEqual(current(), hydro);
  assert.equal(core.client.state().canUndo, false);
  assert.deepEqual(events, []);
});

test('locked hydro metadata is not changed or submitted to Core', async t => {
  const { core, hydro, current, owner, events } = await setup(t, { locked: true });
  await owner.commitHydroEdit('editorColor', '#abcdef');
  assert.deepEqual(current(), hydro);
  assert.equal(core.client.state().canUndo, false);
  assert.deepEqual(events, [['status', 'error']]);
});

test('the GPU hydro revision gate accepts an edited color and skips an unchanged color', async t => {
  const { owner, state } = await setup(t);
  const renderer = gpuRenderer(t, state);
  assert.equal(renderer.setHydroEdits(state.hydroEdits, state.stateRevision), true);
  assert.equal(renderer.getStats().hydroEditBatchCount, 1);
  assert.equal(renderer.setHydroEdits(state.hydroEdits, state.stateRevision), false);
  assert.equal(await owner.commitHydroEdit('editorColor', '#abcdef'), true);
  assert.equal(renderer.setHydroEdits(state.hydroEdits, state.stateRevision), true);
  assert.equal(renderer.getStats().hydroEditRevision, 1);
  assert.equal(await owner.commitHydroEdit('editorColor', '#ABCDEF'), false);
  assert.equal(renderer.setHydroEdits(state.hydroEdits, state.stateRevision), false);
});

test('replacing restored hydro collection refreshes paint batches at the same revision', t => {
  const state = { hydroEdits: seed().hydroEdits, stateRevision: 7 };
  state.hydroEdits.push({ ...structuredClone(state.hydroEdits[0]), id: 'river-2' });
  const original = structuredClone(state.hydroEdits);
  const renderer = gpuRenderer(t, state);
  renderer.setHydroEdits(state.hydroEdits, state.stateRevision);
  state.hydroEdits[0].properties.editorColor = '#abcdef';
  state.stateRevision += 1;
  renderer.setHydroEdits(state.hydroEdits, state.stateRevision);
  assert.equal(renderer.getStats().hydroEditBatchCount, 2);
  const edited = structuredClone(state.hydroEdits);
  state.hydroEdits = original;
  assert.equal(renderer.setHydroEdits(state.hydroEdits, state.stateRevision), true);
  assert.equal(renderer.getStats().hydroEditBatchCount, 1);
  assert.equal(renderer.getStats().hydroEditRevision, 8);
  assert.equal(renderer.setHydroEdits(state.hydroEdits, state.stateRevision), false);
  state.hydroEdits = edited;
  assert.equal(renderer.setHydroEdits(state.hydroEdits, state.stateRevision), true);
  assert.equal(renderer.getStats().hydroEditBatchCount, 2);
  state.hydroEdits = [];
  assert.equal(renderer.setHydroEdits(state.hydroEdits, state.stateRevision), true);
  assert.equal(renderer.getStats().hydroEditBatchCount, 0);
});
