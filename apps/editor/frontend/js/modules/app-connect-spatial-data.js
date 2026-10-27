/** Explicit spatial-data dependency wiring; no state ownership or event registration. */
import { SPATIAL_DATA_OWNER_PORTS } from './app-capability-ports.js';
import {connectCapabilityOwners} from './app-capability-port-utils.js';

export function connectSpatialData({ ports, ...providers }) {
  connectCapabilityOwners(SPATIAL_DATA_OWNER_PORTS,providers,ports);
}
