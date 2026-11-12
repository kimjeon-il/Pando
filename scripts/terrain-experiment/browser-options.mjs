export function terrainBrowserArgs(mode){
  if(mode==='swiftshader')return ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'];
  if(mode==='d3d11')return ['--use-gl=angle','--use-angle=d3d11','--enable-gpu'];
  throw Error('Unknown terrain GPU mode');
}
