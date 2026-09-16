export function capabilityPortsForFixture(portNames, flatDependencies) {
  return Object.freeze(Object.fromEntries(portNames.map(portName => [
    portName,
    Object.freeze(new Proxy({}, {
      get(_target, property) {
        return flatDependencies[property];
      },
    })),
  ])));
}
