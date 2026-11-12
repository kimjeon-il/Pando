// Experiments use the same terrain contract as the production renderer.
import {terrainDemFragmentSource} from '../../src/rendering/terrain-dem-shaders.js';

export function experimentColorGlsl(){
  return globalThis.PandoLabCanvasTerrainDem.colorGlsl();
}
export function a1TerrainFragmentSource(version){
  if(version!==1&&version!==2)throw new TypeError('WebGL version must be 1 or 2');
  return terrainDemFragmentSource(version);
}
