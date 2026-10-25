import "../../../../../shared/frontend/js/workers/worker-rpc-host.js";
import { createCoreWorkerRuntime } from "../../../../../shared/frontend/js/modules/core-worker-runtime.js";
import { loadVerifiedCore } from "../../../../../shared/frontend/js/modules/core-wasm-loader.js";
import { validateWebFlagDataUrl } from "../../../../../shared/frontend/js/modules/country-flags.js";

const runtime = createCoreWorkerRuntime({
  productMode: 'editor',
  loadModule: () => loadVerifiedCore({ baseUrl: new URL('../../wasm/', import.meta.url) }),
  validateFlagDataUrl: validateWebFlagDataUrl,
});

self.PandoLabWorkerRpc.install({ handlers: Object.fromEntries(runtime.operations.map(operation =>
  [operation, (payload, context) => runtime.dispatch(operation, payload, context)])) });
