// Stateless identity/readiness calculations shared by all renderer backends.
// A canvas/DEM tile completion cannot change the accepted base picture key
// unless a frame, geometry source, device or dependent presentation changed.
export function physicalSceneMatchesContext(scene,context) {
  if (!context?.ready) return false;
  const land=(scene?.polygons||[]).filter(packet=>packet.role==='physical-land');
  const water=(scene?.polygons||[]).filter(packet=>packet.role==='physical-water');
  return land.length===1&&land[0].geometryRevision===context.landRevision
    && (context.waterRevision==null?water.length===0:water.length===1&&water[0].geometryRevision===context.waterRevision);
}

// This key deliberately excludes optional DEM tile arrival, scene frameId
// and uncommitted frames. Context loss and project replacement remain distinct.
export function mapPresentationTargetKey(frame,{
  projectGeneration,contextRevision,geometryRevision,paletteRevision,
  physicalStyleRevision,terrainVisible,surfaceQuality,surfaceGeometryQuality,
}={}) {
  if (!frame) return '';
  return JSON.stringify([projectGeneration,contextRevision,geometryRevision,
    frame.cssViewport,frame.cssScale,frame.cssTranslate,frame.dpr,
    frame.viewState?.projection||frame.projection,
    frame.viewState?.rotation||null,frame.viewState?.projectionCenter||null,
    frame.viewState?.safeInset||frame.safeInset||null,
    paletteRevision,physicalStyleRevision,!!terrainVisible,surfaceQuality,surfaceGeometryQuality]);
}

export function mapBackgroundTargetKey(frame,{
  scene,projectGeneration,contextRevision,physicalStyleRevision,terrainVisible,
}={}) {
  if (!frame || !scene) return '';
  return JSON.stringify([projectGeneration,contextRevision,
    (scene.polygons||[]).filter(packet=>packet.role==='physical-land').map(packet=>packet.sourceKey),
    frame.cssViewport,frame.cssScale,frame.cssTranslate,frame.viewState?.rotation,frame.viewState?.projection,
    physicalStyleRevision,!!terrainVisible]);
}

/** Ready, non-empty terrain resources are the only drawable GPU terrain. */
export function canDrawTerrainTiles(tiles,representation,style,tintReady,demFormat) {
  return tiles.length>0&&(representation!==demFormat||style!=='physical'||tintReady===true);
}
