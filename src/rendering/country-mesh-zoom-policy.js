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

// Retain only an admitted derivative of the same source/time whose country and
// tile coverage contains the new view. Never revive another date or omit entrants.
export function canRetainDisplayLod(accepted, requested) {
  if(!accepted || !requested || accepted.sourceIdentity!==requested.sourceIdentity)return false;
  if(accepted.visibleIds && (!requested.visibleIds || requested.visibleIds.some(id=>!accepted.visibleIds.includes(id))))return false;
  const before=new Map((accepted.visibleTiles||[]).map(row=>[row.id,new Set(row.tiles.map(tile=>tile.join(':')))]));
  const after=new Map((requested.visibleTiles||[]).map(row=>[row.id,row.tiles]));
  for(const [id,tiles] of before){
    if(requested.visibleIds && !requested.visibleIds.includes(id))continue;
    if(!after.has(id) || after.get(id).some(tile=>!tiles.has(tile.join(':'))))return false;
  }
  return true;
}
