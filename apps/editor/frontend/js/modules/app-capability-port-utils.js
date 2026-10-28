import {MAP_OWNER_PORTS,connectMapOwner} from '../../../../../shared/frontend/js/modules/map-owner-ports.js';

export function connectCapabilityOwners(contracts, owners, ports) {
  for (const [ownerName, portNames] of Object.entries(contracts)) {
    if(Object.hasOwn(MAP_OWNER_PORTS,ownerName)){
      connectMapOwner(ownerName,owners[ownerName],ports);
      continue;
    }
    owners[ownerName].connect(Object.freeze(Object.fromEntries(portNames.map(portName => [portName, ports[portName]]))));
  }
}
