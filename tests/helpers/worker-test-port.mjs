// Capturing Worker port for protocol tests. Each port has isolated handlers,
// transfer records and lifecycle state. No simulated production protocol logic.
export function createWorkerTestPort({ onPostMessage = null, onTerminate = null } = {}) {
  const worker = {
    messages: [], transfers: [], terminated: false,
    onmessage: null, onerror: null,
    postMessage(message, transfer = []) {
      this.messages.push(message);
      this.transfers.push(transfer);
      onPostMessage?.(message, this);
    },
    terminate() {
      this.terminated = true;
      onTerminate?.(this);
    },
    emitMessage(data) { this.onmessage?.({ data }); },
    emitError(message) {
      const event = { message, defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; } };
      this.onerror?.(event);
      return event;
    },
  };
  return worker;
}
