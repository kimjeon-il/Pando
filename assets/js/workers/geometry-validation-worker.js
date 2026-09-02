'use strict';

const rpcHostUrl = new URL('./worker-rpc-host.js', self.location.href);
const revision = new URL(self.location.href).searchParams.get('v');
if (revision) rpcHostUrl.searchParams.set('v', revision);
importScripts('../vendor/polygon-clipping.min.js', rpcHostUrl.href);

let validationModulePromise = null;
const validationModule = () => validationModulePromise ||= import('../modules/geometry-validation.js');

self.PandoLabWorkerRpc.install({
  handlers: {
    'geometry.audit': async (payload, context) => {
      const module = await validationModule();
      context.throwIfCancelled();
      const report = module.runMapAudit({ ...(payload || {}), clipper: self.polygonClipping });
      report.revision = Number(context.projectRevision || payload?.revision || 0);
      context.throwIfCancelled();
      return report;
    },
  },
});

// Compatibility bridge for the existing debug audit controller. It can be
// removed after its caller migrates to createWorkerRpcClient().
const legacyCancelled = new Set();
self.addEventListener('message', async event => {
  const message = event.data || {};
  if (message.rpc === self.PandoLabWorkerRpc.PROTOCOL) return;
  const requestId = Number(message.requestId || 0);
  if (message.type === 'cancel') {
    legacyCancelled.add(requestId);
    return;
  }
  if (message.type !== 'audit') return;
  try {
    const module = await validationModule();
    if (legacyCancelled.has(requestId)) return;
    const report = module.runMapAudit({ ...(message.payload || {}), clipper: self.polygonClipping });
    report.revision = Number(message.revision || 0);
    if (!legacyCancelled.has(requestId)) self.postMessage({ type: 'result', requestId, ok: true, report });
  } catch (error) {
    self.postMessage({ type: 'result', requestId, ok: false, message: error?.message || String(error) });
  } finally {
    legacyCancelled.delete(requestId);
  }
});
