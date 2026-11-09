import "../../runtime/workers/worker-rpc-host.js";
import { createCoreWorkerRuntime } from "../../runtime/core-worker-runtime.js";
import { loadVerifiedCore } from "../../runtime/core-wasm-loader.js";
import { validateWebFlagDataUrl } from "../../ui/country-flags.js";

const runtime = createCoreWorkerRuntime({
  productMode: 'viewer',
  loadModule: () => loadVerifiedCore({ baseUrl: new URL('../../wasm/', import.meta.url) }),
  validateFlagDataUrl: validateWebFlagDataUrl,
});

self.PandoLabWorkerRpc.install({ handlers: Object.fromEntries(runtime.operations.map(operation =>
  [operation, (payload, context) => runtime.dispatch(operation, payload, context)])) });
