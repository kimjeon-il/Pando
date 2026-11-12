// Use the actual Viewer visibility and admission policy, including its margin.
import '../../src/rendering/workers/terrain-tile-selection-core.js';

const selection=globalThis.PandoLabTerrainTileSelection;
const radians=value=>value*Math.PI/180;
function distance(a,b){
  const [lonA,latA]=a.map(radians),[lonB,latB]=b.map(radians);
  return Math.acos(Math.max(-1,Math.min(1,Math.sin(latA)*Math.sin(latB)+
    Math.cos(latA)*Math.cos(latB)*Math.cos(lonA-lonB))));
}
export function inspectFixtureCoverage({manifest,availableKeys,center,viewport,scale,policy=selection.demVisiblePolicy}){
  if(!(availableKeys instanceof Set)||!Array.isArray(center)||!Array.isArray(viewport)||!(scale>0))
    throw new TypeError('Fixture coverage requires a camera and available tile keys');
  const level=manifest.levels.find(item=>item.id===5);
  if(!level)throw new Error('Fixture has no LOD 5');
  const visible=item=>selection.visible(item,{viewport,scale,projection:'globe',globeCenter:center,distance});
  const requested=visible(level),missingKeys=requested.map(item=>item.key).filter(key=>!availableKeys.has(key));
  const admitted=selection.admitVisibleTiles(manifest,level.width,visible,policy);
  return {requestedTiles:requested.length,admittedLevel:admitted.level.id,admittedBytes:admitted.bytes,
    missingKeys,valid:admitted.level.id===level.id&&missingKeys.length===0};
}
