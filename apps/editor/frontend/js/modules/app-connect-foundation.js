import { FOUNDATION_OWNER_PORTS } from './app-capability-ports-foundation.js';
import { connectCapabilityOwners } from './app-capability-port-utils.js';

/** Explicit capability wiring; no state ownership or event registration. */
export function connectFoundation({
  ports,
  environment,
  builtinSession,
  workspaceSurfaces,
  projectSession,
  objectCommands,
  serviceAssembly,
  renderQuality,
  pointerTargets,
}) {
  connectCapabilityOwners(FOUNDATION_OWNER_PORTS, {
    environment,
    builtinSession,
    workspaceSurfaces,
    projectSession,
    objectCommands,
    serviceAssembly,
    renderQuality,
    pointerTargets,
  }, ports);
}
