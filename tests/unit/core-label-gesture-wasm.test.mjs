import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { loadWebOracle } from '../helpers/web-oracle.mjs';
import { historySnapshotFixture } from '../helpers/editable-history-fixture.mjs';
import { createNodeCoreProject } from '../helpers/core-project.mjs';
import { createGenericCommands } from "../../apps/editor/frontend/js/modules/app-generic-commands.js";

const original = Object.assign({}, ...await Promise.all([
  'tests/helpers/timeline-project.mjs', 'assets/js/modules/app-project-snapshots.js',
  'assets/js/modules/territorial-entity-store.js', 'assets/js/modules/territorial-entity-repository.js',
  'assets/js/modules/project-state.js', 'assets/js/modules/save-state-controller.js',
  'assets/js/modules/history-service.js', 'assets/js/modules/app-generic-commands.js',
  'assets/js/modules/label-layout.js',
].map(loadWebOracle)));
const labelId = '22000000-0000-4000-8000-000000000029';
function input() {
  const seed = JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json', import.meta.url), 'utf8'));
  seed.labels = [{ id: labelId, name: 'Movable', kind: 'custom', coordinates: [1.125, 2.25],
    notes: 'Kept notes', metadata: { compatibilitySource: { detail: [null, 'opaque'] } } }];
  seed.labelSettings = { [`label:${labelId}`]: { fontSize: 15, minZoom: 2, maxZoom: 19, visible: true, pinned: false, manualPosition: null } };
  seed.itemVisibility = {};
  return seed;
}
function dragPlatform() {
  const handlers = {}, transforms = [], d3 = {
    behavior: { drag: () => ({ on(name, handler) { handlers[name] = handler; return this; } }) },
    event: { sourceEvent: { stopPropagation() {} } },
    mouse: () => [20, 30], select: () => ({ attr: (...args) => transforms.push(args) }),
  };
  return { d3, handlers, transforms, element: {} };
}
const observe = (label, settings, state, history) => ({
  label: structuredClone(label), settings: structuredClone(settings), stateRevision: state.stateRevision,
  documentDirty: state.documentDirty, presentationDirty: state.presentationDirty,
  canUndo: history.canUndo(), canRedo: history.canRedo(),
});
async function originalTrace(seed, coordinates) {
  const f = historySnapshotFixture({ implementation: original }), admitted = original.prepareProjectForStorage(seed);
  f.entityStore.restoreProject(admitted);
  for (const field of original.PROJECT_STATE_FIELDS.filter(row => ['document', 'presentation'].includes(row.scope)
    && !['geometries', 'timelineRecords'].includes(row.name))) f.state[field.name] = structuredClone(admitted[field.name]);
  f.state.tool = 'select'; f.state.stateRevision = 0;
  const history = original.createHistoryService({ store: { history: [], historyMeta: [], future: [], futureMeta: [] },
    snapshot: f.owner.snapshotEditable, restore: f.owner.restoreEditable, normalizeMetadata: value => value,
    onRecord: () => f.saveState.markContentChanged() });
  const platform = dragPlatform(), commands = original.createGenericCommands();
  commands.connect({ projectState: { state: f.state }, platform: { d3: platform.d3 },
    mapView: { screenToGeo: () => coordinates, activeProjection: () => value => value }, mapLayers: { svg: { node() {} } },
    labelPresentation: { labelKey: (domain, id) => `${domain}:${id}` }, labelServices: { normalizeLabelSettings: original.normalizeLabelSettings },
    spatialQuery: { mapObjectGeometryRevisions: { label: 0 } },
    domains: { projectDomain: { recordHistory: history.record, queueAutosave() {} }, renderingDomain: { invalidateLabels() {} } },
    feedback: { setActionStatus() {} } });
  commands.labelDragBehavior();
  const capture = () => observe(f.state.labels[0], f.state.labelSettings, { ...f.saveState.snapshot(), stateRevision: f.state.stateRevision }, history);
  const rows = [capture()], label = f.state.labels[0];
  platform.handlers.dragstart.call(platform.element, label); rows.push(capture());
  if (coordinates) { platform.handlers.drag.call(platform.element, label); rows.push(capture()); }
  platform.handlers.dragend.call(platform.element, label); rows.push(capture());
  assert.equal(history.undo(), true); rows.push(capture()); assert.equal(history.canUndo(), false);
  assert.equal(history.redo(), true); rows.push(capture());
  return { rows, transforms: platform.transforms };
}

test('frozen original label drag records an unmoved checkpoint and changes only content dirty state', async () => {
  for (const coordinates of [null, [15.125, 10.25]]) {
    const { rows } = await originalTrace(input(), coordinates);
    assert.equal(rows[0].documentDirty, false);
    assert.equal(rows[1].documentDirty, true);
    assert.equal(rows[1].canUndo, true);
    assert.deepEqual(rows[1].label.coordinates, [1.125, 2.25]);
    assert.ok(rows.every(row => row.presentationDirty === false && row.stateRevision === 0));
    const finished = rows.at(-3);
    assert.deepEqual(finished.label.coordinates, coordinates || [1.125, 2.25]);
    assert.equal(finished.settings[`label:${labelId}`].pinned, true);
    assert.deepEqual(finished.settings[`label:${labelId}`].manualPosition, coordinates || [1.125, 2.25]);
    assert.deepEqual(rows.at(-2).label, rows[0].label);
    assert.deepEqual(rows.at(-2).settings, coordinates ? rows[0].settings : finished.settings,
      'Original history restores settings only for labels whose coordinates changed; an unmoved checkpoint retains the live pin.');
  }
});

for (const [name, coordinates] of [['unmoved', null], ['moved', [15.125, 10.25]]]) {
  test(`actual label ${name} gesture retains one Core content history entry, settings and original Web dirty clocks`, async t => {
    const seed = input(), expected = await originalTrace(seed, coordinates), owner = await createNodeCoreProject(seed);
    t.after(() => owner.dispose());
    const platform = dragPlatform(), pending = [], errors = [], commands = createGenericCommands();
    const project = { getGeneration: owner.project.getGeneration, labelGestureApply(payload) {
      const operation = owner.project.labelGestureApply(payload); pending.push(operation); return operation;
    } };
    const state = { tool: 'select', projectReplacing: false };
    commands.connect({ projectState: { state }, platform: { d3: platform.d3 },
      mapView: { screenToGeo: () => coordinates, activeProjection: () => value => value }, mapLayers: { svg: { node() {} } },
      spatialQuery: { mapObjectGeometryRevisions: { label: 0 } },
      domains: { projectDomain: project, renderingDomain: { invalidateLabels() {} } },
      feedback: { setActionStatus() {}, reportOperationError: error => errors.push(error) } });
    commands.labelDragBehavior();
    const capture = () => observe(owner.documentModel.list('label')[0], owner.documentModel.snapshot().labelSettings, owner.client.state(), owner.project);
    const rows = [capture()], label = owner.documentModel.list('label')[0];
    async function event(name) {
      platform.handlers[name].call(platform.element, label);
      await Promise.all(pending); await Promise.resolve();
      assert.deepEqual(errors, []);
      rows.push(capture());
    }
    await event('dragstart'); if (coordinates) await event('drag'); await event('dragend');
    assert.equal(await owner.project.undo(), true); rows.push(capture()); assert.equal(owner.project.canUndo(), false);
    assert.equal(await owner.project.redo(), true); rows.push(capture());
    assert.deepEqual(rows, expected.rows); assert.deepEqual(platform.transforms, expected.transforms);
    assert.deepEqual(owner.documentModel.snapshot().genericFeatures, seed.genericFeatures);
    assert.deepEqual(owner.documentModel.snapshot().hydroEdits, seed.hydroEdits);
    assert.deepEqual(owner.documentModel.snapshot().distributionEntries, seed.distributionEntries);
  });
}
