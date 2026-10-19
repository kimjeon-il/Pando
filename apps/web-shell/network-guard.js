/** Also serialized into real Worker entrypoints by the shell-only staging step. */
export function installNetworkGuard(scope = globalThis, { allowBundledData = false } = {}) {
  if (scope.__PANDOLAB_SHELL_NETWORK__) return scope.__PANDOLAB_SHELL_NETWORK__;
  const state = { requests: [], blocked: [], workers: [] };
  scope.__PANDOLAB_SHELL_NETWORK__ = state;
  const origin = scope.location.origin;
  const channel = typeof scope.BroadcastChannel === 'function'
    ? new scope.BroadcastChannel('pandolab-shell-network-v1') : null;
  const append = (key, row) => { if (state[key].length < 1000) state[key].push(row); };
  if (channel && scope.document) channel.onmessage = event => {
    if (['requests', 'blocked'].includes(event.data?.key)) append(event.data.key, event.data.row);
  };
  const record = (key, row) => {
    append(key, row);
    if (channel && !scope.document) channel.postMessage({ key, row });
  };
  const check = input => {
    const url = new URL(typeof input === 'object' && input?.url ? input.url : String(input), scope.location.href);
    const row = { url: url.href, context: scope.document ? 'window' : 'worker' };
    record('requests', row);
    const command = /^\/(write_probe_file|read_probe_file|write_diagnostic_report|finish_probe|begin_document_write|append_document_chunk|finish_document_write|begin_document_read|read_document_chunk|abort_document_transfer)$/.test(url.pathname);
    const ipc = command && (['http://ipc.localhost', 'https://ipc.localhost'].includes(url.origin)
      || (url.protocol === 'ipc:' && url.hostname === 'localhost'));
    const dataPath = decodeURIComponent(url.pathname);
    const bundledData = dataPath.startsWith('/assets/data/');
    const physicalLand = /^\/assets\/data\/physical-land\/v1\/(?:geometry\.json\.gz|manifest\.json)$/.test(dataPath);
    if ((!ipc && url.origin !== origin) || (bundledData && !allowBundledData && !physicalLand)) {
      record('blocked', row);
      throw new Error(`Prototype resource request blocked: ${url.href}`);
    }
    return url;
  };
  const fetch = scope.fetch.bind(scope);
  scope.fetch = async (input, options) => { check(input); return fetch(input, options); };
  if (typeof scope.Worker === 'function') {
    const NativeWorker = scope.Worker;
    scope.Worker = class extends NativeWorker {
      constructor(input, options) {
        const url = check(input);
        super(url, options);
        state.workers.push({ url: url.href, type: options?.type || 'classic', name: options?.name || '' });
      }
    };
  }
  return state;
}
