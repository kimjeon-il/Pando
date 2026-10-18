import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadWebOracle } from '../helpers/web-oracle.mjs';
import { historySnapshotFixture } from '../helpers/editable-history-fixture.mjs';
import { originalHydroCreate, originalHydroToolConfig } from '../helpers/web-hydro-create-oracle.mjs';
import { createNodeCoreProject } from '../helpers/core-project.mjs';
import { createPropertySelection } from '../../assets/js/modules/app-property-selection.js';

async function loadOriginalPropertySelection() {
  const root = new URL('../fixtures/portability/web-9300609-hydro-copy/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
  assert.equal(manifest.baseline, '930060923889d17134e36e152c29f4adbb2e60a9');
  for (const row of manifest.files) {
    const bytes = readFileSync(new URL(row.path, root));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), row.sha256);
    assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), row.blob);
  }
  return import(new URL('assets/js/modules/app-property-selection.js', root));
}
const original = Object.assign({}, ...await Promise.all([
  'tests/helpers/timeline-project.mjs', 'assets/js/modules/app-project-snapshots.js',
  'assets/js/modules/territorial-entity-store.js', 'assets/js/modules/territorial-entity-repository.js',
  'assets/js/modules/project-state.js', 'assets/js/modules/save-state-controller.js',
  'assets/js/modules/history-service.js',
].map(loadWebOracle)), await loadOriginalPropertySelection());
const id = '33000000-0000-4000-8000-000000000037', sourceId = 'river:original';
function input() {
  const seed = JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json', import.meta.url), 'utf8'));
  seed.physicalSettings = { ...seed.physicalSettings, terrainVisible: true, terrainStyle: 'political',
    hydroLayers: { rivers: false }, hiddenHydroIds: { 'river:unrelated': true } };
  return seed;
}
function source(seed) {
  return { type: 'Feature', id: sourceId, geometry: { type: 'LineString', coordinates: [[1.125, 2.25], [3.5, 4.75]] },
    properties: { pandolab_id: sourceId, category: 'river', name: 'Source river',
      source: structuredClone(seed.genericFeatures[0].properties.source) } };
}
const observe = (body, state, history) => ({ hydroEdits: structuredClone(body.hydroEdits),
  physicalSettings: structuredClone(body.physicalSettings), stateRevision: state.stateRevision,
  documentDirty: state.documentDirty, presentationDirty: state.presentationDirty,
  canUndo: history.canUndo(), canRedo: history.canRedo() });
function ports(state, seed, project, builtin) {
  return { projectState: { state }, platform: { deepClone: structuredClone }, surfaces: { uid: () => id },
    hydroModel: { builtInHydroFeatureById: () => builtin,
      hydroFeatureById: key => state.hydroEdits.find(row => row.id === key) || (key === builtin.id ? builtin : null), normalizeHydroEdit: value => {
      const normalized = originalHydroCreate(value, seed).normalized; Object.assign(value, normalized); return value;
    } }, hydroPresentation: { HYDRO_TOOL_CONFIG: originalHydroToolConfig,
      hydroCategoryLabel: () => '강', hydroCategoryKey: category => category,
      hydroEditById: key => state.hydroEdits.find(row => row.id === key) || null },
    rendering: { gpuMapRenderer: { invalidateHydroVisibility() {} } }, objectDisplay: { invalidateObjectPresentation() {} },
    selectionServices: { normalizeObjectRef: value => value }, feedback: { setActionStatus() {} },
    domains: { projectDomain: project, selectionUiController: { applyIntent: async () => {} },
      renderingDomain: { invalidateHydroPatch() {} } } };
}
async function originalTrace(seed) {
  const f = historySnapshotFixture({ implementation: original }), admitted = original.prepareProjectForStorage(seed);
  f.entityStore.restoreProject(admitted);
  for (const field of original.PROJECT_STATE_FIELDS.filter(row => ['document', 'presentation'].includes(row.scope)
    && !['geometries', 'timelineRecords'].includes(row.name))) f.state[field.name] = structuredClone(admitted[field.name]);
  f.state.stateRevision = 0; f.state.selected = { domain: 'hydro', type: 'river', id: sourceId };
  const history = original.createHistoryService({ store: { history: [], historyMeta: [], future: [], futureMeta: [] },
    snapshot: f.owner.snapshotEditable, restore: f.owner.restoreEditable, normalizeMetadata: value => value,
    onRecord: () => f.saveState.markContentChanged() });
  const command = original.createPropertySelection();
  command.connect(ports(f.state, seed, { recordHistory: history.record, queueAutosave() {} }, source(seed)));
  const capture = () => observe(f.state, { ...f.saveState.snapshot(), stateRevision: f.state.stateRevision }, history), rows = [capture()];
  await command.copySelectedHydroForEditing(); rows.push(capture());
  // Existing independent presentation state is deliberately installed after
  // the content checkpoint; the original history owner decides its lifetime.
  f.state.physicalSettings.terrainVisible = true; f.state.physicalSettings.terrainStyle = 'physical';
  f.saveState.markPresentationChanged(); rows.push(capture());
  assert.equal(history.undo(), true); rows.push(capture()); assert.equal(history.redo(), true); rows.push(capture());
  return rows;
}
test('frozen original hydro copy history keeps both its hidden source and later independent terrain controls', async () => {
  const rows = await originalTrace(input());
  assert.equal(rows[1].physicalSettings.hiddenHydroIds[sourceId], true);
  assert.equal(rows[3].hydroEdits.some(row => row.id === id), false);
  assert.equal(rows[3].physicalSettings.hiddenHydroIds[sourceId], true);
  assert.equal(rows[3].physicalSettings.terrainStyle, 'physical');
  assert.deepEqual(rows[3].physicalSettings, rows[2].physicalSettings);
  assert.deepEqual(rows[4].physicalSettings, rows[2].physicalSettings);
  assert.ok(rows.every(row => row.stateRevision === 0));
});
test('actual hydro copy, independent terrain command and whole Core history preserve original Web physical fields', async t => {
  const seed = input(), expected = await originalTrace(seed), owner = await createNodeCoreProject(seed);
  t.after(() => owner.dispose());
  const state = { selected: { domain: 'hydro', type: 'river', id: sourceId }, projectReplacing: false,
    get hydroEdits() { return owner.documentModel.list('hydro'); } };
  const command = createPropertySelection(), runtime = ports(state, seed, owner.project, source(seed));
  delete runtime.hydroModel.normalizeHydroEdit;
  command.connect(runtime);
  const capture = () => observe(owner.documentModel.snapshot(), owner.client.state(), owner.project), rows = [capture()];
  await command.copySelectedHydroForEditing(); rows.push(capture());
  const changed = await owner.project.executeCommand({ commandId: 'presentation.apply', targets: [], payload: { action: 'terrainMode', mode: 'physical' } });
  assert.equal(changed.ok, true); rows.push(capture());
  assert.equal(await owner.project.undo(), true); rows.push(capture()); assert.equal(owner.project.canUndo(), false);
  assert.equal(await owner.project.redo(), true); rows.push(capture());
  assert.deepEqual(rows, expected);
  assert.deepEqual(owner.documentModel.snapshot().genericFeatures, seed.genericFeatures);
  assert.deepEqual(owner.documentModel.snapshot().distributionEntries, seed.distributionEntries);
});
