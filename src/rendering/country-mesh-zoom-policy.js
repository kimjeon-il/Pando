// Screen scale is CSS pixels per radian, shared by flat and globe frames.
// Resource availability and admission of display derivatives belong to the renderer.
export function resolveMapSurfacePresentation({ canonicalReady = false,
  backgroundPresented = true, recoveryDrawing = false } = {}) {
  const geometryQuality = canonicalReady ? 'canonical' : 'pending';
  return Object.freeze({targetQuality:'canonical',geometryQuality,
    quality:backgroundPresented || recoveryDrawing ? geometryQuality : 'pending'});
}

/** An actually submitted WebGL base pass can publish land/ocean and country
 * geometry before optional detail tiles finish. This is not terrain readiness.
 * Never admit temporal replacements or merely scheduled frames. */
export function canAdmitWebGlPartialBackground({ rendererMode, submittedBaseFrame, physicalSceneMatched, temporalPending } = {}) {
  return rendererMode === 'webgl2'
    && submittedBaseFrame === true && physicalSceneMatched === true && temporalPending === false;
}
