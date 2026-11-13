import { createNodeCoreProject } from './core-project.mjs';
import { createTerritorialEntityStore } from "../../src/document/territorial-entity-store.js";
import { createTerritorialEntityRepository } from "../../src/document/territorial-entity-repository.js";

/** Current Web service graph backed by the actual C++ document Worker. */
export async function createCurrentFullDocumentFixture(input) {
  const owner = await createNodeCoreProject(input);
  const store = createTerritorialEntityStore({ documentModel: owner.documentModel, commandOwner: owner.client });
  const repository = createTerritorialEntityRepository({ entityStore: store });
  return { ...owner, store, repository,
    fullSnapshot: () => structuredClone(owner.documentModel.snapshot()),
    dispose() { try { store.dispose(); } finally { owner.dispose(); } } };
}
