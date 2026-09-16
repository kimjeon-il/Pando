import { Worker } from 'node:worker_threads';

export function createGisWorkerHarness(t, { failFirstIntersection = false } = {}) {
  const script = new URL('../../../assets/js/workers/gis-geometry-worker.js', import.meta.url).href;
  const worker = new Worker(`
    const { parentPort } = require('node:worker_threads');
    const fs = require('node:fs'), vm = require('node:vm');
    global.self = global;
    self.location = new URL(${JSON.stringify(script)});
    let intersectionAttempts = 0;
    global.importScripts = (...urls) => urls.forEach(url => vm.runInThisContext(
      '(function(module,exports){' + fs.readFileSync(new URL(url, self.location), 'utf8') + '\\n}).call(globalThis,undefined,undefined)',
      { filename: new URL(url, self.location).href },
    ));
    self.postMessage = data => parentPort.postMessage(${JSON.stringify(failFirstIntersection)}
      ? { ...data, intersectionAttempts }
      : data);
    vm.runInThisContext(fs.readFileSync(self.location, 'utf8'), {
      filename: self.location.href,
      importModuleDynamically: specifier => import(new URL(specifier, self.location).href),
    });
    if (${JSON.stringify(failFirstIntersection)}) {
      const intersection = self.polygonClipping.intersection.bind(self.polygonClipping);
      self.polygonClipping.intersection = (...args) => {
        intersectionAttempts += 1;
        if (intersectionAttempts === 1) throw new Error('Unable to find segment in SweepLine tree');
        return intersection(...args);
      };
    }
    parentPort.on('message', data => self.onmessage({ data }));
  `, { eval: true, execArgv: ['--experimental-vm-modules'] });
  t.after(() => worker.terminate());
  const pending = new Map();
  worker.on('message', message => {
    const resolve = pending.get(message.id);
    if (!resolve) return;
    pending.delete(message.id);
    resolve(message);
  });
  let sequence = 0;
  return {
    validate(collection, affectedIds = null) {
      const id = ++sequence;
      return new Promise(resolve => {
        pending.set(id, resolve);
        worker.postMessage({ id, action: 'validate', collection, affectedIds });
      });
    },
  };
}
