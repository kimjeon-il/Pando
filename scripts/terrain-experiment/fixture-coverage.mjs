// Use the actual Viewer visibility and admission policy, including its margin.
import '../../src/rendering/workers/terrain-tile-selection-core.js';

const selection=globalThis.PandoLabTerrainTileSelection;
export function scaleAtZoom(scale,currentZoom,targetZoom){
  if(![scale,currentZoom,targetZoom].every(value=>Number.isFinite(value)&&value>0))throw new RangeError('Positive scale and zoom required');
  return scale*targetZoom/currentZoom;
}
export function withNormalizedAdmissionBudget(source){
  const marker='byteBudget: 96 * 1024 * 1024, bytesPerPixel: 12';
  if(typeof source!=='string'||source.split(marker).length!==2)throw Error('Viewer DEM admission policy contract changed');
  return source.replace(marker,'byteBudget: 192 * 1024 * 1024, bytesPerPixel: 12');
}
export function withExperimentViewInvalidation(source){
  const marker="requestRepaint: reason => dependencies.domains.renderingDomain?.invalidateGpuFrame?.(reason || 'legacy-host-repaint'),";
  if(typeof source!=='string'||source.split(marker).length!==2)throw Error('Viewer host contract changed');
  return source.replace(marker,"requestRepaint: reason => dependencies.domains.renderingDomain?.requestRender?.({kind:'view-settle',reason:reason || 'legacy-host-repaint'}),");
}
export function withExperimentFlatStartup(source){
  const marker="const projection='globe';";
  if(typeof source!=='string'||source.split(marker).length!==2)throw Error('Viewer startup projection contract changed');
  return source.replace(marker,"const projection='flat';");
}
export function withPlaceSnapshotTrace(source){
  const marker="onSnapshot: () => dependencies.domains.renderingDomain.invalidateLabels('builtin-places-ready'),";
  if(typeof source!=='string'||source.split(marker).length!==2)throw Error('Viewer label contract changed');
  return source.replace(marker,"onSnapshot: snapshot => { globalThis.__pandoPlaceSnapshots.push({revision:snapshot.revision,count:snapshot.records.length,signature:snapshot.signature}); return dependencies.domains.renderingDomain.invalidateLabels('builtin-places-ready'); },");
}
export function withTerrainOnlyCapture(source){
  const marker="\n        },\n        'territorial-fill': () => {";
  if(typeof source!=='string'||source.split(marker).length!==2)throw Error('Viewer terrain scene contract changed');
  const capture=`\n        if(globalThis.__pandoTerrainCapture?.requested){\n          const width=gl.drawingBufferWidth,height=gl.drawingBufferHeight,pixels=new Uint8Array(width*height*4);\n          gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);\n          globalThis.__pandoTerrainCapture.result={pixels,width,height,frameId:activeFrameContext.frameId};\n        }`;
  return source.replace(marker,capture+marker);
}
const radians=value=>value*Math.PI/180;
function distance(a,b){
  const [lonA,latA]=a.map(radians),[lonB,latB]=b.map(radians);
  return Math.acos(Math.max(-1,Math.min(1,Math.sin(latA)*Math.sin(latB)+
    Math.cos(latA)*Math.cos(latB)*Math.cos(lonA-lonB))));
}
export function inspectFixtureCoverage({manifest,availableKeys,center,viewport,scale,projection='globe',policy=selection.demVisiblePolicy}){
  if(!(availableKeys instanceof Set)||!Array.isArray(center)||!Array.isArray(viewport)||!(scale>0))
    throw new TypeError('Fixture coverage requires a camera and available tile keys');
  if(projection!=='globe'&&projection!=='flat')throw new TypeError('Unknown fixture projection');
  const level=manifest.levels.find(item=>item.id===5);
  if(!level)throw new Error('Fixture has no LOD 5');
  const visible=item=>selection.visible(item,{viewport,scale,projection,flatCenter:center,globeCenter:center,distance});
  const requested=visible(level),missingKeys=requested.map(item=>item.key).filter(key=>!availableKeys.has(key));
  const admitted=selection.admitVisibleTiles(manifest,level.width,visible,policy);
  return {requestedTiles:requested.length,admittedLevel:admitted.level.id,admittedBytes:admitted.bytes,
    missingKeys,valid:admitted.level.id===level.id&&missingKeys.length===0};
}
