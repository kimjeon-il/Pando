import { PROJECT_IO_OWNER_PORTS } from './app-capability-ports-project-io.js';
import { connectCapabilityOwners } from './app-capability-port-utils.js';

/** Explicit capability wiring; no state ownership or event registration. */
export function connectProjectIo({
  ports,
  mapSettings,
  historyAssembly,
  projectRestore,
  objectDeletion,
  gisAssembly,
  libraryAssembly,
  navigationBindings,
  toolBindings,
}) {
  connectCapabilityOwners(PROJECT_IO_OWNER_PORTS, {
    mapSettings,
    historyAssembly,
    projectRestore,
    objectDeletion,
    gisAssembly,
    libraryAssembly,
    navigationBindings,
    toolBindings,
  }, ports);
}
