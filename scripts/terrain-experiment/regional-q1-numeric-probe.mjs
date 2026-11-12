// Read four immutable representative WebPs and check current land-color arithmetic.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {chromium} from '@playwright/test';
import {createLandPalette} from './quality.mjs';

const [chinaDir,regionsDir,output]=process.argv.slice(2);
if(!chinaDir||!regionsDir||!output)throw Error('Two fixture directories and a new report path are required');
const sha=data=>createHash('sha256').update(data).digest('hex');
const source='8630abc401cc6bdd30b507a68d3eb9eda5b65f5636f7199e4b1eefd476b5a9e2';
const china=JSON.parse(await readFile(join(chinaDir,'manifest.json'),'utf8'));
const regional=JSON.parse(await readFile(join(regionsDir,'manifest.json'),'utf8'));
if(china.sourceSha256!==source||regional.sourceSha256!==source)throw Error('Unexpected fixture source');
const selected=[];
for(const [region,manifest,dir] of [['southwest-china',china,chinaDir],['thai-lowland',regional,regionsDir],['himalaya',regional,regionsDir],['netherlands-coast',regional,regionsDir]]){
  const record=manifest.records.find(row=>row.region===region&&row.tileSize===1024);
  if(!record)throw Error('Missing representative tile: '+region);
  const webp=await readFile(join(dir,record.file));if(sha(webp)!==record.webpSha256||webp.length!==record.webpBytes)throw Error('WebP identity differs: '+region);
  selected.push({record,webp:webp.toString('base64')});
}
const core=await readFile(new URL('../../src/rendering/workers/canvas-terrain-dem-core.js',import.meta.url),'utf8');
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
  const page=await browser.newPage();
  const result=await page.evaluate(async({core,selected})=>{
    (0,eval)(core);const api=globalThis.PandoLabCanvasTerrainDem,rows=[];
    for(const {record,webp} of selected){
      const raw=Uint8Array.from(atob(webp),c=>c.charCodeAt(0));
      const bitmap=await createImageBitmap(new Blob([raw],{type:'image/webp'}),{premultiplyAlpha:'none',colorSpaceConversion:'none'});
      const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(bitmap,0,0);bitmap.close();
      const dem=context.getImageData(0,0,canvas.width,canvas.height).data;
      let decoded='';for(let i=0;i<dem.length;i+=32768)decoded+=String.fromCharCode(...dem.subarray(i,i+32768));
      const samplers=Object.fromEntries(['light','dark'].map(theme=>[theme,api.createInterpolatedSampler({dem,width:canvas.width,height:canvas.height,theme,channel:'land'})])),items=[];
      let seed=0x156ce7;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/0x100000000;};
      const positions=[[100.25,100.75],[400.5,400.5],[512.25,512.75],[800.6,200.3]];
      for(let i=0;i<256;i++)positions.push([1+random()*(canvas.width-3),1+random()*(canvas.height-3)]);
      for(const [x,y] of positions){
        const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;let height=0,shade=0;
        for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){const i=((iy+dy)*canvas.width+ix+dx)*4,weight=(dx?fx:1-fx)*(dy?fy:1-fy);
          height+=Math.max(0,dem[i]*256+dem[i+1]-12000)*weight;shade+=dem[i+2]*weight;}
        for(const [theme,sample] of Object.entries(samplers)){const color=new Uint8ClampedArray(4);sample(x,y,color);items.push({x,y,height,shade,theme,rgb:Array.from(color.slice(0,3))});}
      }
      rows.push({region:record.region,file:record.file,webpSha256:record.webpSha256,expectedRawSha256:record.rawSha256,decoded:btoa(decoded),items});
    }return {userAgent:navigator.userAgent,rows};
  },{core,selected});
  const palettes={light:createLandPalette(),dark:createLandPalette(['#477B60','#629260','#87A76B','#ABA476','#C0AA86','#AF9486','#9F8C8A','#CEC9C3'])},flat=.27+.73*Math.SQRT1_2;
  for(const row of result.rows){row.rawSha256=sha(Buffer.from(row.decoded,'base64'));delete row.decoded;
    if(row.rawSha256!==row.expectedRawSha256)throw Error('Decoded pixels differ: '+row.region);}
  for(const row of result.rows)for(const sample of row.items){
    const illumination=Math.max(0,(sample.shade/255-.42)/.58),relief=Math.max(.16,Math.min(1,flat+((.27+.73*illumination)-flat)*1.3));
    const factor=Math.max(.38,Math.min(1.3,relief/flat)),expected=palettes[sample.theme](sample.height).map(value=>Math.round(Math.max(0,Math.min(255,value*factor))));
    sample.expectedRgb=expected;sample.maxDifference=Math.max(...expected.map((value,index)=>Math.abs(value-sample.rgb[index])));
    if(sample.maxDifference>2)throw Error('Numerical color differs: '+row.region);
  }
  await writeFile(resolve(output),JSON.stringify({schema:'regional-q1-numeric-probe-v1',sourceSha256:source,scope:'four immutable representative tiles; CPU synthetic sample only, no Viewer, land mask or GPU',...result},null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(result.rows.map(({region,items})=>({region,samples:items.length,maxDifference:Math.max(...items.map(item=>item.maxDifference))}))));
}finally{await browser.close();}
