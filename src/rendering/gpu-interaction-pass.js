import { mapVisualOrder } from "../ui/layer-presentation.js";
import { resetGpuNormalBlend } from "./gpu-blend-utils.js";

// Draw accepts already classified packets and country ranges. It never starts
// geometry work, queues uploads, or scans country buffers.
export function drawGpuInteractionPass({ gl, frame, viewState, viewport, fillTarget, fillTargetReady, prepared },
  { fillCache, strokeCache = null, polygonOverlayPass, selectionPass, drawHydro, drawPhysicalWaterMask, drawCountryBoundaryMask = () => {}, drawCountryRanges }) {
  const hasFillItems = prepared.hasFillItems === true;
  let fillReady = !hasFillItems || (fillTargetReady && prepared.fillReady);
  const fillResults = [];
  if (hasFillItems) {
    if (fillTargetReady) { gl.colorMask(true, true, true, true); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
    gl.stencilMask(0xff); gl.clearStencil(0); gl.clear(gl.STENCIL_BUFFER_BIT); gl.enable(gl.STENCIL_TEST);
    if (!fillReady) {
      fillResults.push({ succeeded: false, renderedKeys: [], missingKeys: prepared.genericKeys });
    }
    try {
      // Reserve water before claiming land, then one winner per sample.
      gl.stencilFunc(gl.ALWAYS, 1, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE); gl.colorMask(false, false, false, false);
      // Interaction fills must not tint the base water or territorial-border pixels below them.
      for (const role of mapVisualOrder('hydro')) drawHydro(role, false, true);
      drawPhysicalWaterMask(); drawCountryBoundaryMask();
      gl.colorMask(true, true, true, true); gl.stencilFunc(gl.EQUAL, 0, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
      for (const group of fillReady ? prepared.priorities : []) {
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
  } else {
    // No fill pixels to protect or composite: retain selection stroke
    // coverage without redundantly drawing the entire world mask.
    gl.disable(gl.STENCIL_TEST);
    gl.colorMask(true, true, true, true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fillTarget);
  }
  resetGpuNormalBlend(gl);
  const genericFillResult = { succeeded: fillReady && fillResults.every(result => result.succeeded),
    renderedKeys: fillReady ? fillResults.flatMap(result => result.renderedKeys || []) : [], missingKeys: fillResults.flatMap(result => result.missingKeys || []) };
  const drawInteractionStrokes = () => selectionPass?.draw?.(viewState, viewport, { clear: false, frameContext: frame, preparedOnly: true }) || null;
  let interactionStrokes;
  const strokeCacheReady = strokeCache?.beginScene?.(viewport.pixelWidth, viewport.pixelHeight, '', 0) === true;
  if (strokeCacheReady) {
    gl.colorMask(true, true, true, true); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    resetGpuNormalBlend(gl);
    interactionStrokes = drawInteractionStrokes();
    const composited = strokeCache.finishScene(fillTarget)
      && strokeCache.composite(viewport.pixelWidth, viewport.pixelHeight, { targetFramebuffer: fillTarget, clearTarget: false, blendOver: true });
    if (!composited) {
      resetGpuNormalBlend(gl);
      interactionStrokes = drawInteractionStrokes();
    }
  } else interactionStrokes = drawInteractionStrokes();
  return { fillOwner: fillReady ? 'gpu' : 'svg', genericFillResult, selection: interactionStrokes };
}
