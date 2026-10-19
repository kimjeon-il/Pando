import { historySnapshotFixture } from './editable-history-fixture.mjs';
import { loadWebOracle } from './web-oracle.mjs';
const { createSelectionDomain } = await loadWebOracle('assets/js/modules/selection-domain.js');
const { createHistoryService } = await loadWebOracle('assets/js/modules/history-service.js');
const { createProjectDomain } = await loadWebOracle('assets/js/modules/project-domain.js');
const { createProjectCommandPipeline } = await loadWebOracle('assets/js/modules/project-command-pipeline.js');
const { createTerritorialApplicationService } = await loadWebOracle('assets/js/modules/territorial-service.js');
const { createTerritorialFeature } = await loadWebOracle('assets/js/modules/territorial-units.js');
const implementation = Object.assign({}, ...await Promise.all(['tests/helpers/timeline-project.mjs',
  'assets/js/modules/app-project-snapshots.js','assets/js/modules/territorial-entity-store.js',
  'assets/js/modules/territorial-entity-repository.js','assets/js/modules/project-state.js',
  'assets/js/modules/save-state-controller.js'].map(loadWebOracle)));

/** Real app restoreEditable, not a test-authored clear/prune history policy. */
export function captureWebHistorySelectionContract() {
  const selection = createSelectionDomain({ refExists: () => true });
  const { owner, state, entityStore, entityRepository, saveState } = historySnapshotFixture({ selectionDomain: selection, implementation });
  state.stateRevision = 0;
  entityStore.appendEntities([createTerritorialFeature({ id: 'A', entityKind: 'general', name: 'Alpha',
    geometry: { type: 'Polygon', coordinates: [[[0,0],[2,0],[2,2],[0,2],[0,0]]] } })]);
  const history = createHistoryService({ store: { history: [], historyMeta: [], future: [], futureMeta: [] },
    snapshot: owner.snapshotEditable, restore: owner.restoreEditable, normalizeMetadata: value => value,
    onRecord: () => saveState.markContentChanged() });
  const pipeline = createProjectCommandPipeline({ captureSnapshot: owner.snapshotEditable, restoreSnapshot: owner.restoreEditable,
    recordHistory: (meta, before) => history.commitSnapshot(before, meta), discardHistory: history.discardLast,
    advanceRevision: () => { state.stateRevision += 1; } });
  const service = createTerritorialApplicationService({ entityStore, entityRepository, commandPipeline: pipeline,
    createId: () => { throw new Error('This small fixture must not create IDs'); } });
  const project = createProjectDomain({ productMode:'editor', history, saveState, getSnapshot: owner.snapshotEditable,
    prepareRestore: async value => value, replaceSnapshot: value => entityStore.restoreProject(value) });
  const entity = { domain: 'territorial', type: 'entity', id: 'A' };
  const builtin = { domain: 'label', type: 'city', id: 'builtin:place:fixture:1' };
  const hydro = { domain: 'hydro', type: 'river', id: 'builtin-hydro' };
  const rows = [];
  const capture = (operation, action) => {
    const result = action();
    rows.push({ operation, result: result === undefined ? null : structuredClone(result),
      name: entityRepository.get('A').properties.name, stateRevision: state.stateRevision,
      undo: project.canUndo(), redo: project.canRedo(), selection: structuredClone(selection.snapshot()),
      documentDirty: saveState.snapshot().documentDirty });
  };
  capture('select territorial object and builtin hover', () => { selection.replace(entity); selection.setHover(hydro, { source: 'map' }); });
  capture('rename keeps the current selection and hover', () => service.updateMetadata('A','name','Beta'));
  capture('Undo clears selected objects but keeps unrelated hover', () => project.undo());
  capture('select builtin objects before Redo', () => selection.setMany([builtin, hydro], { primary: builtin }));
  capture('Redo clears builtin selection too and keeps unrelated hover', () => project.redo());
  capture('no-op history does not clear a newly selected builtin', () => { selection.replace(builtin); return project.redo(); });
  capture('Undo clears builtin selection with unchanged project object identities', () => project.undo());
  selection.dispose();
  return rows;
}
