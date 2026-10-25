export function createReadPorts(providers, specs) {
  return Object.freeze(Object.fromEntries(Object.entries(specs).map(([name, entries]) => {
    const descriptors = Object.fromEntries(entries.map(([alias, provider, field]) => [alias, { enumerable: true, get: () => providers[provider][field] }]));
    return [name, Object.freeze(Object.defineProperties({}, descriptors))];
  })));
}

export function connectCapabilityOwners(contracts, owners, ports) {
  for (const [ownerName, portNames] of Object.entries(contracts)) {
    owners[ownerName].connect(Object.freeze(Object.fromEntries(portNames.map(portName => [portName, ports[portName]]))));
  }
}

export function mergeCapabilityPorts(...registries) {
  const descriptorsByPort = new Map();
  for (const registry of registries) {
    for (const [portName, port] of Object.entries(registry)) {
      const descriptors = descriptorsByPort.get(portName) || {};
      Object.assign(descriptors, Object.getOwnPropertyDescriptors(port));
      descriptorsByPort.set(portName, descriptors);
    }
  }
  return Object.freeze(Object.fromEntries([...descriptorsByPort].map(([portName, descriptors]) => [
    portName,
    Object.freeze(Object.defineProperties({}, descriptors)),
  ])));
}
