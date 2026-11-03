// Summarize the one Viewer asset closure. This module does not enumerate resources.
export function summarizeViewerWorldData({world,paths,bytes=0,dataRevision}){
  if(world?.schema!=='pandolab-world-bundle'||world.schemaVersion!==1||world.source?.countryCount!==258
    ||!Array.isArray(paths)||new Set(paths).size!==paths.length
    ||paths.some(path=>!path.startsWith('assets/data/')))
    throw Error('Invalid Viewer world data');
  const classification=world.defaultClassification;
  const rootCount=Object.keys(classification?.countries||{}).length;
  const unitCount=Object.keys(classification?.units||{}).length;
  const removedCount=Array.isArray(classification?.removedIds)?classification.removedIds.length:-1;
  if(rootCount<=0||rootCount+removedCount!==world.source.countryCount||unitCount>removedCount)
    throw Error('Invalid current world classification');
  const worldFileCount=paths.filter(path=>/^assets\/data\/(?:world\/|countries-(?:preview|canonical)-shared|builtin-world\/|prepared-polygons\/)/.test(path)).length;
  return Object.freeze({countryCount:world.source.countryCount,worldFileCount,
    physicalFileCount:paths.length-worldFileCount,rootCount,unitCount,
    modelEntityCount:rootCount+unitCount,mergedSourceCount:removedCount-unitCount,
    sourceSha256:world.source.sha256,fileCount:paths.length,bytes,dataRevision});
}
