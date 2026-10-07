import { createTerritorialFeature } from '../../assets/js/modules/territorial-units.js';
import { createEmptyTerritorialState, createTerritorialEntityStore } from '../../assets/js/modules/territorial-entity-store.js';
import { createTerritorialEntityRepository } from '../../assets/js/modules/territorial-entity-repository.js';
import { createTerritorialApplicationService } from '../../assets/js/modules/territorial-service.js';
import { createProjectCommandPipeline } from '../../assets/js/modules/project-command-pipeline.js';
import { createHistoryService } from '../../assets/js/modules/history-service.js';
import { createProjectDomain } from '../../assets/js/modules/project-domain.js';
import { createSaveStateController } from '../../assets/js/modules/save-state-controller.js';

// Test composition uses the real store, command pipeline, history and domain.
// The common shape observes history availability, not a fabricated native depth.
export function createCommandFixture(initial = {id:'A',name:'Alpha'}) {
  const state = createEmptyTerritorialState();
  state.stateRevision = 0;
  const store = createTerritorialEntityStore({ getState: () => state });
  store.replaceEntities((initial.entities??[initial]).map(row=>createTerritorialFeature({ id: row.id, entityKind: row.kind??'general', name: row.name,
    parentId:row.parent??'',locked:row.locked??false,
    geometry: { type: 'Polygon', coordinates: [[[0,0],[8,0],[8,8],[0,8],[0,0]]] } })));
  const saveState = createSaveStateController({ now: () => new Date('2000-01-01T00:00:00Z') });
  const snapshot = () => ({ territorialEntities: store.identities(), timelineRecords: structuredClone(state.timelineRecords), geometries: state.geometries.snapshot(),
    historyContentToken: saveState.snapshot().currentContentToken });
  const restore = value => { store.restoreProject(value); saveState.setContentToken(value.historyContentToken); };
  const history = createHistoryService({ store: { history: [], historyMeta: [], future: [], futureMeta: [] }, maxEntries: 100,
    snapshot, restore, normalizeMetadata: value => value,
    onRecord: () => saveState.markContentChanged() });
  const pipeline = createProjectCommandPipeline({ captureSnapshot: snapshot, restoreSnapshot: restore,
    recordHistory: (meta, before) => history.commitSnapshot(before, meta), discardHistory: history.discardLast,
    advanceRevision: () => { state.stateRevision += 1; } });
  const repository = createTerritorialEntityRepository({ entityStore: store });
  const service = createTerritorialApplicationService({ entityStore: store, entityRepository: repository, commandPipeline: pipeline,
    createId: () => { throw new Error('This scenario must not generate IDs'); } });
  const domain = createProjectDomain({ history, saveState, getSnapshot: snapshot,
    prepareRestore: async value => value, replaceSnapshot: value => store.restoreProject(value) });
  return {state,store,repository,service,domain,saveState,snapshot};
}

export function commandHistoryTrace(corpus) {
  const {repository,service,domain,saveState} = createCommandFixture(corpus.initial);
  return corpus.operations.map(operation => {
    switch (operation.op) {
      case 'observe': break;
      case 'rename': service.updateMetadata(operation.target, 'name', operation.value); break;
      case 'markSaved': saveState.markFileSaved(); break;
      case 'undo': domain.undo(); break;
      case 'redo': domain.redo(); break;
      default: throw new Error('Unknown operation: ' + operation.op);
    }
    return { name: repository.get(corpus.initial.id).properties.name, undo: domain.canUndo(), redo: domain.canRedo(), dirty: saveState.snapshot().documentDirty };
  });
}
