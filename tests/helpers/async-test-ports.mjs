// Shared Node-test scheduling ports. Each call owns its own promise.
export const nextEventTurn = () => new Promise(resolve => setImmediate(resolve));

export function deferredResult() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
