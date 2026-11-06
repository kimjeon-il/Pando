// Screen scale is CSS pixels per radian, shared by flat and globe frames.
// Resource availability and admission of display derivatives belong to the renderer.
export const MAP_SURFACE_LOW_SCALE = 504;
export const MAP_SURFACE_HIGH_SCALE = 642;
export const MAP_SURFACE_MAX_ERROR_PX = 0.5;
export function resolveCountryMeshQuality({ cssScale, previous = null, focus = false, selected = false }) {
  if (focus || selected || !Number.isFinite(cssScale) || cssScale <= 0) return 'canonical';
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

/** Source-matched initial Canvas land preview is a background only.
 * It cannot certify country geometry or a temporal replacement. */
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

export function selectCanvasPhysicalSource({ actual, state, preview, sourceRevision, temporalPending = false } = {}) {
  const unavailable = {source:null,context:{ready:false},preview:false};
  if (state?.ready) {
    if (actual?.geometry && actual.revision === state.landRevision
      && (state.waterRevision == null ? !actual.water
        : !!actual.water && actual.waterRevision === state.waterRevision))
      return {source:actual,context:state,preview:false};
    return unavailable;
  }
  if (!temporalPending && preview?.certified === true && preview?.geometry
    && typeof sourceRevision === 'string' && /^[a-f0-9]{64}$/.test(sourceRevision)
    && preview.sourceRevision === sourceRevision
    && typeof preview.revision === 'string' && /^[a-f0-9]{64}$/.test(preview.revision))
    return {source:preview,
      context:{ready:true,landRevision:preview.revision,waterRevision:null,preview:true},preview:true};
  return unavailable;
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

/** An actually submitted WebGL base pass can publish land/ocean and country
 * geometry before optional detail tiles finish. This is not terrain readiness.
 * Never admit temporal replacements or merely scheduled frames. */
export function canAdmitWebGlPartialBackground({ rendererMode, submittedBaseFrame, physicalSceneMatched, temporalPending } = {}) {
  return (rendererMode === 'webgl1' || rendererMode === 'webgl2')
    && submittedBaseFrame === true && physicalSceneMatched === true && temporalPending === false;
}
