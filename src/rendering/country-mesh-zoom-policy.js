// Screen scale is CSS pixels per radian, shared by flat and globe frames.
// Resource availability and admission of display derivatives belong to the renderer.
export function resolveMapSurfacePresentation({ canonicalReady = false,
  backgroundPresented = true, recoveryDrawing = false } = {}) {
  const geometryQuality = canonicalReady ? 'canonical' : 'pending';
  return Object.freeze({targetQuality:'canonical',geometryQuality,
    quality:backgroundPresented || recoveryDrawing ? geometryQuality : 'pending'});
}

export function selectCanvasPhysicalSource({actual,state}={}) {
  if(state?.ready && actual?.geometry && actual.revision===state.landRevision
    && (state.waterRevision==null ? !actual.water : !!actual.water && actual.waterRevision===state.waterRevision))
    return {source:actual,context:state};
  return {source:null,context:{ready:false}};
}



/**
 * A Canvas resource-completion invalidation creates a new coordinator frameId
 * without necessarily changing what the Worker is painting. Bind the bitmap
 * to its full visual dependencies, not that transient scheduling number.
 * The caller also checks actual physical packet provenance and style revision.
 */
export function canvasWorkerPresentationKey(frame, {
  projectGeneration, contextRevision, geometryRevision, paletteRevision,
  physicalStyleRevision, terrainVisible, surfaceQuality,
  surfaceGeometryQuality, surfaceTargetQuality,
} = {}) {
  if (!frame) return '';
  const view = frame.viewState || {};
  return JSON.stringify([
    projectGeneration, contextRevision, geometryRevision,
    frame.viewRevision, frame.projectionRevision, frame.projection,
    frame.cssViewport, frame.dpr, frame.cssScale, frame.cssTranslate,
    view.rotation, view.projectionCenter, view.flatCenter,
    view.flatZoom, view.globeZoom, frame.safeInset,
    paletteRevision, physicalStyleRevision, !!terrainVisible,
    surfaceQuality, surfaceGeometryQuality, surfaceTargetQuality,
  ]);
}

/** Stable for the same physical pixels even if coordinator frameId and
 * country-only view/style revisions advance during asynchronous preparation. */
export function canvasWorkerBackgroundPresentationKey(frame, {
  projectGeneration,contextRevision,physicalStyleRevision,
  terrainVisible,terrainStyle,darkTheme,theme,
}={}) {
  if (!frame) return '';
  const view=frame.viewState||{};
  return JSON.stringify([
    projectGeneration,contextRevision,frame.projection,frame.cssViewport,frame.dpr,
    frame.cssScale,frame.cssTranslate,view.rotation,view.projectionCenter,
    view.flatCenter,view.flatZoom,view.globeZoom,frame.safeInset,
    physicalStyleRevision,!!terrainVisible,terrainStyle,!!darkTheme,
    theme?.baseLandAlpha,theme?.defaultLand,theme?.ocean,
  ]);
}

/** Only a transferred, current Worker bitmap may unblock initial country paint
 * before optional terrain data completes. Temporal replacement remains strict. */
export function canAdmitCanvasWorkerPartialBackground({ rendererMode, committedBitmap, physicalSceneMatched, temporalPending } = {}) {
  return (rendererMode === 'canvas-worker' || rendererMode === 'canvas2d') && committedBitmap === true
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

/** An actually submitted WebGL base pass can publish land/ocean and country
 * geometry before optional detail tiles finish. This is not terrain readiness.
 * Never admit temporal replacements or merely scheduled frames. */
export function canAdmitWebGlPartialBackground({ rendererMode, submittedBaseFrame, physicalSceneMatched, temporalPending } = {}) {
  return (rendererMode === 'webgl1' || rendererMode === 'webgl2')
    && submittedBaseFrame === true && physicalSceneMatched === true && temporalPending === false;
}
