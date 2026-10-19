import { createCoreDocumentClient } from './core-document-client.js';
import { createCoreDocumentReadModel } from './core-document-read-model.js';

/** One C++ owner and its accepted immutable projection, for either product. */
export function createDocumentSession({ productMode, initialProject, onTransition = () => {}, createWorker } = {}) {
  const documentModel = createCoreDocumentReadModel(initialProject);
  const commandOwner = createCoreDocumentClient({ productMode, ...(createWorker ? { createWorker } : {}),
    onTransition(result, operation, payload) {
      documentModel.acceptTransition(result, operation);
      onTransition(result, operation, payload);
    } });
  return Object.freeze({ productMode, documentModel, commandOwner });
}
