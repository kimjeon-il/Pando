'use strict';

importScripts('../vendor/polygon-clipping.min.js');

let validationModulePromise = null;
const validationModule = () => validationModulePromise ||= import('../modules/geometry-validation.js');
const cancelled = new Set();

self.onmessage = async event => {
  const message = event.data || {};
  const requestId = Number(message.requestId || 0);
  if (message.type === 'cancel') {
    cancelled.add(requestId);
    return;
  }
  if (message.type !== 'audit') return;
  try {
    const module = await validationModule();
    if (cancelled.has(requestId)) return;
    const report = module.runMapAudit({ ...(message.payload || {}), clipper: self.polygonClipping });
    report.revision = Number(message.revision || 0);
    if (!cancelled.has(requestId)) self.postMessage({ type: 'result', requestId, ok: true, report });
  } catch (error) {
    self.postMessage({ type: 'result', requestId, ok: false, message: error?.message || String(error) });
  } finally {
    cancelled.delete(requestId);
  }
};
