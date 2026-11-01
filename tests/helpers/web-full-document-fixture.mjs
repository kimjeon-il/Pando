import { createNodeCoreProject } from './core-project.mjs';
import { createTerritorialEntityStore } from '../../shared/frontend/js/modules/territorial-entity-store.js';
import { createTerritorialEntityRepository } from '../../shared/frontend/js/modules/territorial-entity-repository.js';
import { createTerritorialApplicationService } from '../../apps/editor/frontend/js/modules/territorial-service.js';

/** Current Web service graph backed by the actual C++ document Worker. */
export async function createCurrentFullDocumentFixture(input) {
  const owner = await createNodeCoreProject(input);
  const store = createTerritorialEntityStore({ documentModel: owner.documentModel, commandOwner: owner.client });
  const repository = createTerritorialEntityRepository({ entityStore: store });
  const service = createTerritorialApplicationService({ entityRepository: repository, commandOwner: owner.project,
    createId: () => { throw new Error('This scenario must not generate IDs'); } });
  return { ...owner, store, repository, service,
    fullSnapshot: () => structuredClone(owner.documentModel.snapshot()),
    dispose() { try { store.dispose(); } finally { owner.dispose(); } } };
}
