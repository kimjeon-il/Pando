/** Explicit spatial-data dependency wiring; no state ownership or event registration. */
import { SPATIAL_DATA_OWNER_PORTS } from './app-capability-ports.js';

export function connectSpatialData({ ports, ...providers }) {
  for (const [ownerName, portNames] of Object.entries(SPATIAL_DATA_OWNER_PORTS)) {
    const ownerPorts = Object.fromEntries(portNames.map(portName => [portName, ports[portName]]));
    providers[ownerName].connect(Object.freeze(ownerPorts));
  }
}
