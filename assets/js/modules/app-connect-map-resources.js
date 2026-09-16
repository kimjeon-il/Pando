import { MAP_RESOURCE_OWNER_PORTS } from './app-capability-ports.js';

/** Explicit dependency wiring; no state ownership or event registration. */
export function connectMapResources({
  ports,
  cutGeometry,
  mapProjection,
  objectPresentation,
  hydroSettings,
  layerList,
  countryLabels,
  physicalResources,
  interactionPackets,
}) {
  const owners = {
    cutGeometry,
    mapProjection,
    objectPresentation,
    hydroSettings,
    layerList,
    countryLabels,
    physicalResources,
    interactionPackets,
  };

  for (const [ownerName, ownerPorts] of Object.entries(MAP_RESOURCE_OWNER_PORTS)) {
    owners[ownerName].connect(Object.freeze(Object.fromEntries(
      ownerPorts.map(portName => [portName, ports[portName]]),
    )));
  }
}
