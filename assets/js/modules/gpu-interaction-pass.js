import { resetGpuNormalBlend } from './gpu-blend-utils.js';

// Draw accepts already classified packets and country ranges. It never starts
// geometry work, queues uploads, or scans country buffers.
export function drawGpuInteractionPass({ gl, frame, viewState, viewport, fillTarget, fillTargetReady, prepared },
  { fillCache, polygonOverlayPass, strokeRenderer, selectionPass, drawHydro, drawCountryRanges }) {
  if (fillTargetReady) { gl.colorMask(true, true, true, true); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
  gl.stencilMask(0xff); gl.clearStencil(0); gl.clear(gl.STENCIL_BUFFER_BIT); gl.enable(gl.STENCIL_TEST);
  let fillReady = fillTargetReady && prepared.fillReady;
  const fillResults = [], previewFillResults = [], draftFillResults = [];
  if (!fillReady) {
    for (const [keys, results] of [[prepared.genericKeys, fillResults], [prepared.previewFillKeys, previewFillResults], [prepared.draftFillKeys, draftFillResults]]) {
      results.push({ succeeded: false, renderedKeys: [], missingKeys: keys });
    }
  }
  try {
    // Reserve water before claiming land, then one winner per sample.
    gl.stencilFunc(gl.ALWAYS, 1, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE); gl.colorMask(false, false, false, false);
    drawHydro('lake'); drawHydro('river'); drawHydro('border-river');
    gl.colorMask(true, true, true, true); gl.stencilFunc(gl.EQUAL, 0, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
    for (const group of fillReady ? prepared.priorities : []) {
      for (const packet of group.preview) previewFillResults.push(polygonOverlayPass.drawPackets([packet], frame, { preparedOnly: true }));
      for (const packet of group.draft) draftFillResults.push(polygonOverlayPass.drawPackets([packet], frame, { preparedOnly: true }));
      drawCountryRanges(group.country);
      fillResults.push(polygonOverlayPass.drawResourceItems(group.generic, frame));
    }
  } finally {
    gl.colorMask(true, true, true, true); gl.disable(gl.STENCIL_TEST); gl.stencilMask(0xff);
  }
  if (fillTargetReady) {
    fillCache.finishScene(fillTarget);
    if (fillReady) fillReady = fillCache.composite(viewport.pixelWidth, viewport.pixelHeight, { targetFramebuffer: fillTarget, clearTarget: false, blendOver: true });
  } else gl.bindFramebuffer(gl.FRAMEBUFFER, fillTarget);
  resetGpuNormalBlend(gl);
  const genericFillResult = { succeeded: fillReady && fillResults.every(result => result.succeeded),
    renderedKeys: fillReady ? fillResults.flatMap(result => result.renderedKeys || []) : [], missingKeys: fillResults.flatMap(result => result.missingKeys || []) };
  const selection = selectionPass?.draw?.(viewState, viewport, { clear: false, frameContext: frame, preparedOnly: true }) || null;
  const strokes = packets => packets.map(packet => strokeRenderer.drawBatches([packet], frame, { preparedOnly: true }));
  const coverage = results => fillReady ? results : results.map(result => ({ ...result, succeeded: false,
    missingKeys: [...(result.missingKeys || []), ...(result.renderedKeys || [])], renderedKeys: [] }));
  return { fillOwner: fillReady ? 'gpu' : 'svg', genericFillResult, selection,
    previewResults: [...coverage(previewFillResults), ...strokes(prepared.previewStrokes)],
    draftResults: [...coverage(draftFillResults), ...strokes(prepared.draftStrokes)] };
}
