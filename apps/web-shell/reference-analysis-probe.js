import { finishDiagnostics } from './probe-storage.js';
import { inspectFullWorldRuntime } from './full-world-probe.js';
import { createReferenceAnalysisClient } from '../assets/js/modules/reference-image-analysis-client.js';
import { createPlaceRuntime } from '../assets/js/modules/place-runtime.js';
import { workerAssetUrl } from '../assets/js/modules/worker-asset-url.js';
import { packReferenceImages, unpackReferenceImages } from '../assets/js/modules/reference-image-package.js';

/** Runtime proof only: neither OCR accuracy nor learned boundary quality is certified here. */
export function installReferenceRuntimeProbe() {
  if (!globalThis.__PANDOLAB_SHELL_REFERENCE_ANALYSIS__) return false;
  window.addEventListener('pandolab:ready', () => {
    run().then(finishDiagnostics).catch(error => finishDiagnostics({ schema: 'pandolab-reference-runtime-probe', ok: false, releaseReady: false,
      error: { message: error.message, code: error.code || '', operation: error.operation || '', stack: error.stack },
      network: globalThis.__PANDOLAB_SHELL_NETWORK__ })).catch(error => console.error('[PL-REFERENCE-PROBE]', error));
  }, { once: true });
  return true;
}
async function run() {
  const started = performance.now(), world = inspectFullWorldRuntime();
  if (!world.ok) throw new Error('Full-world native runtime did not become ready.');
  const client = createReferenceAnalysisClient({ getGeneration: () => 1 });
  const places = createPlaceRuntime({ getPresentation: () => ({ month: '-0044-03', languages: { ko: false, en: false, native: true } }),
    admitReferences: () => { throw new Error('Reference search must not publish project identities.'); },
    createWorker: () => new Worker(workerAssetUrl(new URL('../assets/js/workers/place-worker.js', import.meta.url)), { type: 'module', name: 'reference-probe-places' }) });
  try {
    const spec = await fetch(new URL('./reference-probe.json', import.meta.url)).then(response => { if (!response.ok) throw new Error('Native reference probe source was not staged.');return response.json(); });
    const blob = await fetch(new URL('./reference-probe.jpg', import.meta.url)).then(response => response.blob());
    const ocr = await client.run('reference.ocr', { blob, languages: ['eng'] });
    if (!ocr.ok || !ocr.detections.length) throw new Error('Actual local OCR returned no source-map text.');
    places.beginInteraction();
    const matches = await places.search('Seoul', { scope: 'reference' });
    if (!matches.records.length || places.snapshot().records.length) throw new Error('Offline reference search failed or changed published labels.');
    const packed = await packReferenceImages([{ id: 'native-original', blob, mapQuad: [[0, 10], [20, 10], [20, 0], [0, 0]] },
      { id: 'native-inset', blob, mapQuad: [[0, 10], [20, 10], [20, 0], [0, 0]], sourceRect: { x: 0, y: 0, width: 32, height: 32 } }]);
    const records = await unpackReferenceImages(packed);
    if (packed.sources.length !== 1 || packed.sources[0].sha256 !== spec.sha256 || packed.sources[0].bytes !== spec.bytes || records[0].blob !== records[1].blob) throw new Error('Shared source package proof failed.');
    let modelStatus;
    try { await client.run('reference.segment', { blob });modelStatus = 'available-not-quality-certified'; }
    catch (error) { if (!['PL-REF-MODEL-MISSING', 'PL-REF-MODEL-UNVALIDATED'].includes(error.code)) throw error;modelStatus = error.code; }
    const network = globalThis.__PANDOLAB_SHELL_NETWORK__;
    if (network.blocked.length) throw new Error('Native reference runtime attempted a blocked request.');
    return { schema: 'pandolab-reference-runtime-probe', version: 1, ok: true, releaseReady: false, elapsedMs: performance.now() - started,
      sourceSha256: spec.sha256, ocrDetections: ocr.detections.length, sourceSize: [ocr.width, ocr.height], offlinePlaceMatches: matches.records.length,
      sharedSourceCount: packed.sources.length, imageRecords: records.length, modelStatus, blockedRequests: network.blocked.length,
      qualityEvaluation: 'not-run', androidDeviceEvaluation: 'not-run', world };
  } finally { client.dispose();places.dispose(); }
}
