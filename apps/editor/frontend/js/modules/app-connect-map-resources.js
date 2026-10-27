import { MAP_RESOURCE_OWNER_PORTS } from './app-capability-ports.js';
import {connectCapabilityOwners} from './app-capability-port-utils.js';

/** Explicit dependency wiring; no state ownership or event registration. */
export function connectMapResources({
  ports,
  cutGeometry,
  mapProjection,
  objectPresentation,
  hydroSettings,
  objectCatalog,
  territorialLabels,
  physicalResources,
  interactionPackets,
}) {
  const owners = {
    cutGeometry,
    mapProjection,
    objectPresentation,
    hydroSettings,
    objectCatalog,
    territorialLabels,
    physicalResources,
    interactionPackets,
  };

  connectCapabilityOwners(MAP_RESOURCE_OWNER_PORTS,owners,ports);
}
