export function terrainBrowserArgs(mode){
  if(mode==='swiftshader')return ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'];
  if(mode==='d3d11')return ['--use-gl=angle','--use-angle=d3d11','--enable-gpu'];
  throw Error('Unknown terrain GPU mode');
}
export function verifyTerrainRenderer(mode,renderer){
  terrainBrowserArgs(mode);
  if(mode==='d3d11'&&(typeof renderer!=='string'||!/direct3d11/i.test(renderer)||/swiftshader|software/i.test(renderer)))
    throw Error('Requested hardware Direct3D11 renderer was not obtained');
}
