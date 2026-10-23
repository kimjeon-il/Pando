'use strict';
const rpcHostUrl = new URL('./worker-rpc-host.js', self.location.href);
importScripts(rpcHostUrl.href);
let enginePromise, corePromise;
const engine = () => enginePromise ||= import('../modules/reference-image-analysis-engine.js');
const core = resources => corePromise ||= import('../modules/core-wasm-loader.js').then(({ loadVerifiedCore }) => loadVerifiedCore({ baseUrl: resources.coreBase }));
self.PandoLabWorkerRpc.install({ handlers: {
  'reference.layout': async (payload, context) => (await engine()).analyzeReferenceMapLayout(payload, context),
  'reference.ocr': async (payload, context) => (await engine()).recognizeReferenceMap(payload, context),
  'reference.segment': async (payload, context) => (await engine()).extractReferenceMapBoundaries(payload, context, await core(payload.resources)),
  'reference.editGraph': async (payload, context) => {
    const runtime = await core(payload.resources);context.throwIfCancelled();
    const graph = JSON.parse(runtime.referenceImageCalculate('editBoundaryGraph', JSON.stringify(payload)));
    context.throwIfCancelled();return graph;
  },
  'reference.georef': async (payload, context) => {
    const runtime = await core(payload.resources);context.throwIfCancelled();
    const calculate = (operation, input) => JSON.parse(runtime.referenceImageCalculate(operation, JSON.stringify(input)));
    const solved = calculate('autoGeoref', payload.options);
    if (!solved.ok) return solved;
    const points = [...(payload.manualControlPoints || []), ...solved.controlPoints.filter(point => !point.pinned)];
    const warp = calculate('calibrationWarp', { ...payload.calibration, controlPoints: points, mode: solved.mode });
    if (!warp.ok) return { ok: false, reason: warp.reason };
    const quality = calculate('georefQuality', { points: warp.controlPoints, mode: warp.mode, sourceWidth: payload.width, sourceHeight: payload.height });
    context.throwIfCancelled();
    return { ...solved, mode: warp.mode, warp, controlPoints: points, diagnostics: { ...warp.diagnostics, quality } };
  },
} });
