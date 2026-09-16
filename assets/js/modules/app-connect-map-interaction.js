import { MAP_INTERACTION_OWNER_PORTS } from './app-capability-ports-map-interaction.js';
import { connectCapabilityOwners } from './app-capability-port-utils.js';

/** Explicit capability wiring; no state ownership or event registration. */
export function connectMapInteraction({
  ports,
  territoryComponentUi,
  gpuScene,
  mapAudit,
  mapHost,
  taskPresentation,
  countryModes,
  objectPicking,
  riverCandidates,
}) {
  connectCapabilityOwners(MAP_INTERACTION_OWNER_PORTS, {
    territoryComponentUi,
    gpuScene,
    mapAudit,
    mapHost,
    taskPresentation,
    countryModes,
    objectPicking,
    riverCandidates,
  }, ports);
}
