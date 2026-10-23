import assert from 'node:assert/strict';
import test from 'node:test';
import { createReferenceAnalysisClient } from '../../assets/js/modules/reference-image-analysis-client.js';

test('analysis client awaits the scheduled RPC and returns its domain result', async () => {
  const worker = { terminate() {}, postMessage(message) {
    if (message.type !== 'request') return;
    globalThis.queueMicrotask(() => this.onmessage({ data: { ...message, type: 'result', ok: true, result: { ok: true, detections: ['map'] } } }));
  } };
  const client = createReferenceAnalysisClient({ getGeneration: () => 3, createWorker: () => worker });
  try { assert.deepEqual(await client.run('reference.ocr', { blob: 'image' }), { ok: true, detections: ['map'] }); }
  finally { client.dispose(); }
});
