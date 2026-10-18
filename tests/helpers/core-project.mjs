import { createNodeCoreDocument } from './core-session.mjs';
import { createCoreDocumentReadModel } from '../../assets/js/modules/core-document-read-model.js';
import { createProjectDomain } from '../../assets/js/modules/project-domain.js';

/** Actual C++ Worker + production application command boundary, no domain reducer mock. */
export async function createNodeCoreProject(seed,platformPorts = {}) {
  const {productMode='editor',...domainPorts}=platformPorts;
  const documentModel=createCoreDocumentReadModel(seed);
  const client=createNodeCoreDocument({ productMode,onTransition: (result,operation) => {
    documentModel.acceptTransition(result,operation);
  } });
  try {
    await client.load(JSON.stringify(seed));
    const project=createProjectDomain({ ...domainPorts,commandOwner: client,documentModel,publishCommand() {},
      readBuiltinSelectionCatalogs: platformPorts.readBuiltinSelectionCatalogs || (() => []) });
    return { client,project,documentModel,dispose() { project.dispose();client.dispose(); } };
  } catch (error) { client.dispose();throw error; }
}
