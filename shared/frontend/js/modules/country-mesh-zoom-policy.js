// Screen scale is CSS pixels per radian, shared by flat and globe frames.
// Resource availability and admission of display derivatives belong to the renderer.
export const MAP_SURFACE_LOW_SCALE = 504;
export const MAP_SURFACE_HIGH_SCALE = 642;
export const MAP_SURFACE_MAX_ERROR_PX = 0.5;
export function resolveCountryMeshQuality({ cssScale, previous = null, focus = false, editing = false, selected = false }) {
  if (focus || editing || selected || !Number.isFinite(cssScale) || cssScale <= 0) return 'canonical';
  if (cssScale <= MAP_SURFACE_LOW_SCALE) return 'preview';
  if (cssScale >= MAP_SURFACE_HIGH_SCALE) return 'canonical';
  return previous === 'preview' ? 'preview' : 'canonical';
}

/** Country paint, land, borders and picking consume this same decision. */
export function resolveMapSurfacePresentation({ canonicalReady = false, previewReady = false,
  previewVerified = false, backgroundPresented = true, ...view }) {
  const targetQuality = resolveCountryMeshQuality(view);
  const geometryQuality = targetQuality === 'preview' && previewReady && previewVerified
    ? 'preview' : canonicalReady ? 'canonical' : 'pending';
  return Object.freeze({ targetQuality, geometryQuality, quality: backgroundPresented ? geometryQuality : 'pending' });
}

/** Only a transferred, current Worker bitmap may unblock initial country paint
 * before optional terrain data completes. Temporal replacement remains strict. */
export function canAdmitCanvasWorkerPartialBackground({ rendererMode, committedBitmap, physicalSceneMatched, temporalPending } = {}) {
  return rendererMode === 'canvas-worker' && committedBitmap === true
    && physicalSceneMatched === true && temporalPending === false;
}

/** Certifies the physical geometry inside the *bitmap actually drawn* by the
 * Canvas Worker. The renderer's latest scene alone does not prove that an old
 * Worker bitmap contains that scene. */
export function canvasWorkerFrameMatchesPhysical(frame, context) {
  if (!context?.ready || !frame || Number(frame.physicalLandCount) !== 1
    || frame.physicalLandRevision !== context.landRevision) return false;
  return context.waterRevision == null
    ? Number(frame.physicalWaterCount) === 0
    : Number(frame.physicalWaterCount) === 1 && frame.physicalWaterRevision === context.waterRevision;
}
