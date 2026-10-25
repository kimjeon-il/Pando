import { createNodeCoreDocument } from './core-session.mjs';
import { createCoreDocumentReadModel } from "../../shared/frontend/js/modules/core-document-read-model.js";
import { createProjectDomain } from "../../shared/frontend/js/modules/project-domain.js";

/** Actual C++ Worker + production application command boundary, no domain reducer mock. */
export async function createNodeCoreProject(seed,platformPorts = {}) {
  const {productMode='editor',...domainPorts}=platformPorts;
  const documentModel=createCoreDocumentReadModel(seed);
  const client=createNodeCoreDocument({ productMode,onTransition: (result,operation) => {
    documentModel.acceptTransition(result,operation);
  } });
  try {
    await client.load(JSON.stringify(seed));
    const project=createProjectDomain({ productMode,...domainPorts,commandOwner: client,documentModel,publishCommand() {},
      readBuiltinSelectionCatalogs: platformPorts.readBuiltinSelectionCatalogs || (() => []) });
    return { client,project,documentModel,dispose() { try { project.dispose(); } finally { client.dispose(); } } };
  } catch (error) { client.dispose();throw error; }
}
