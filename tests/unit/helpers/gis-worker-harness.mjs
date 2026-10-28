import { Worker } from 'node:worker_threads';
import { createGisGeometryValidator } from "../../../apps/editor/frontend/js/modules/import-service.js";

export function createGisWorkerHarness(t) {
  const script = new URL("../../../apps/editor/frontend/js/workers/gis-geometry-worker.js", import.meta.url).href;
  const clipping = new URL("../../../shared/frontend/js/modules/polygon-clipping-core.js", import.meta.url).href;
  const rpcHost = new URL("../../../shared/frontend/js/workers/worker-rpc-host.js", import.meta.url).href;
  const worker = new Worker(`
    const { parentPort } = require('node:worker_threads');
    const fs = require('node:fs'), vm = require('node:vm');
    global.self = global;
    self.location = new URL(${JSON.stringify(script)});
    global.importScripts = (...urls) => urls.forEach(url => {
      const input = new URL(url, self.location);
      const source = input.pathname.endsWith('/polygon-clipping-core.js') ? ${JSON.stringify(clipping)}
        : input.pathname.endsWith('/worker-rpc-host.js') ? ${JSON.stringify(rpcHost)} : input.href;
      vm.runInThisContext('(function(module,exports){' + fs.readFileSync(new URL(source), 'utf8') + '\\n}).call(globalThis,undefined,undefined)', { filename: source });
    });
    self.postMessage = data => parentPort.postMessage(data);
    vm.runInThisContext(fs.readFileSync(self.location, 'utf8'), {
      filename: self.location.href,
      importModuleDynamically: specifier => import(new URL(specifier, self.location).href),
    });
    parentPort.on('message', data => self.onmessage({ data }));
  `, { eval: true, execArgv: ['--experimental-vm-modules'] });
  const port = { postMessage: message => worker.postMessage(message), terminate: () => worker.terminate() };
  worker.on('message', data => port.onmessage?.({ data }));
  worker.on('error', error => port.onerror?.(error));
  const validator = createGisGeometryValidator({ createWorker: () => port, timeoutMs: 5000 });
  t.after(() => validator.dispose());
  return { async validate(collection, affectedIds = null) {
    try { return { ok: true, ...await validator.validate(collection, affectedIds) }; }
    catch(error) { return { ok: false, error: error.message, code: error.code }; }
  } };
}
