import './worker-rpc-host.js';
import { createCoreWorkerRuntime } from '../modules/core-worker-runtime.js';
import { loadVerifiedCore } from '../modules/core-wasm-loader.js';
import { validateWebFlagDataUrl } from '../modules/country-flags.js';

const runtime = createCoreWorkerRuntime({
  productMode: 'viewer',
  loadModule: () => loadVerifiedCore({ baseUrl: new URL('../../wasm/', import.meta.url) }),
  validateFlagDataUrl: validateWebFlagDataUrl,
});

self.PandoLabWorkerRpc.install({ handlers: Object.fromEntries(runtime.operations.map(operation =>
  [operation, (payload, context) => runtime.dispatch(operation, payload, context)])) });
