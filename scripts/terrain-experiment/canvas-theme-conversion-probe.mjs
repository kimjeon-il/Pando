// Local bounded conversion cost; no Viewer or GPU result is implied.
import {writeFile} from 'node:fs/promises';
import os from 'node:os';
import '../../src/rendering/workers/canvas-terrain-dem-core.js';
const output=process.argv[2];if(!output)throw Error('A new report path is required');
const api=globalThis.PandoLabCanvasTerrainDem,width=1026,height=1026,dem=new Uint8ClampedArray(width*height*4);
for(let i=0;i<dem.length;i+=4){const height=(i/4*31)%8000-1000,n=height+12000;dem[i]=n>>8;dem[i+1]=n&255;dem[i+2]=128+(i/4)%128;dem[i+3]=255;}
const rows=[];
for(let run=0;run<3;run++){
  const start=performance.now(),dark=api.convertTile({dem,width,height,theme:'dark',includePolitical:false}),darkMs=performance.now()-start;
  const second=performance.now(),light=api.convertTile({dem,width,height,theme:'light',includePolitical:false}),lightMs=performance.now()-second;
  rows.push({darkMs,lightMs,colorBytes:dark.land.byteLength+dark.ocean.byteLength,checksum:dark.land[100]+light.ocean[400]});
}
await writeFile(output,JSON.stringify({schema:'canvas-theme-conversion-probe-v1',scope:'one synthetic 1026px tile, two conversions, no Viewer or GPU',node:process.version,cpu:os.cpus()[0]?.model,rows},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(rows));
