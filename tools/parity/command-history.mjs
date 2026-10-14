import { createTerritorialFeature } from '../../assets/js/modules/territorial-units.js';
import { createTerritorialEntityStore } from '../../assets/js/modules/territorial-entity-store.js';
import { createTerritorialEntityRepository } from '../../assets/js/modules/territorial-entity-repository.js';
import { createTerritorialApplicationService } from '../../assets/js/modules/territorial-service.js';
import { createSaveStateController } from '../../assets/js/modules/save-state-controller.js';
import { createNodeCoreProject } from '../../tests/helpers/core-project.mjs';
import { startupDocument } from '../../tests/helpers/core-startup.mjs';

// Current results use the production Worker/DocumentSession and application
// service. Scenario Features are detached input; C++ allocates their records.
export async function createCommandFixture(initial = { id: 'A',name: 'Alpha' }) {
  const owner=await createNodeCoreProject(startupDocument(),{ replaceSnapshot: () => true });
  let store;
  try {
    const features=(initial.entities??[initial]).map(row => createTerritorialFeature({ id: row.id,entityKind: row.kind??'general',name: row.name,
      parentId: row.parent??'',locked: row.locked??false,
      geometry: { type: 'Polygon',coordinates: [[[0,0],[8,0],[8,8],[0,8],[0,0]]] } }));
    await owner.project.admit(owner.project.snapshot(),{ features,preserveCursor: true });
    store=createTerritorialEntityStore({ documentModel: owner.documentModel,commandOwner: owner.client });
    const repository=createTerritorialEntityRepository({ entityStore: store });
    const service=createTerritorialApplicationService({ entityRepository: repository,commandOwner: owner.project,
      createId: () => { throw new Error('This scenario must not generate object IDs.'); } });
    const saveState=createSaveStateController({ getDocumentState: owner.client.state,now: () => new Date('2000-01-01T00:00:00Z') });
    return { state: Object.freeze({ get stateRevision() { return owner.client.state().stateRevision; } }),store,repository,service,
      domain: owner.project,saveState,snapshot: owner.project.snapshot,
      async markSaved() { await owner.client.markSaved(owner.client.state().epoch);saveState.markFileSaved(); },
      dispose() { store.dispose();owner.dispose(); } };
  } catch(error) { store?.dispose();owner.dispose();throw error; }
}

export async function commandHistoryTrace(corpus) {
  const fixture=await createCommandFixture(corpus.initial),{ repository,service,domain,saveState }=fixture;
  try {
    const trace=[];
    for(const operation of corpus.operations) {
      switch(operation.op) {
        case 'observe': break;
        case 'rename': await service.updateMetadata(operation.target,'name',operation.value);break;
        case 'markSaved': await fixture.markSaved();break;
        case 'undo': await domain.undo();break;
        case 'redo': await domain.redo();break;
        default: throw new Error('Unknown operation: '+operation.op);
      }
      trace.push({ name: repository.get(corpus.initial.id).properties.name,undo: domain.canUndo(),redo: domain.canRedo(),dirty: saveState.snapshot().documentDirty });
    }
    return trace;
  } finally { fixture.dispose(); }
}
