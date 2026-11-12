// Synthetic Canvas cost probe; this does not execute the Viewer or a denied check.
import {readFile,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import {rasterizeTerrainTriangle,rasterizeTerrainTriangleScanline,createTerrainLookupSampler} from './canvas-numeric-raster.mjs';

const output=process.argv[2];
if(!output)throw Error('An explicit new report path is required');
const core=await readFile(new URL('../../src/rendering/workers/canvas-terrain-dem-core.js',import.meta.url),'utf8');
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
  const page=await browser.newPage({viewport:{width:1280,height:800},deviceScaleFactor:1});
  const data=await page.evaluate(({core,raster,scanline,lookup})=>{
    (0,eval)(core);const rasterize=(0,eval)(`(${raster})`),scan=(0,eval)(`(${scanline})`),createLookup=(0,eval)(`(${lookup})`),api=globalThis.PandoLabCanvasTerrainDem;
    const width=1280,height=800,side=1026,raw=new Uint8ClampedArray(side*side*4),pixels=new Uint8ClampedArray(width*height*4);
    for(let i=0;i<raw.length;i+=4)raw.set([46,224,212,255],i);
    const sampler=api.createInterpolatedSampler({dem:raw,width:side,height:side});
    let startLookup=performance.now();const fast=createLookup({api,dem:raw,width:side,height:side}),lookupInitMs=performance.now()-startLookup;
    const canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d');
    const image=new OffscreenCanvas(side,side),ic=image.getContext('2d'),converted=api.convertTile({dem:raw,width:side,height:side});
    ic.putImageData(new ImageData(converted.land,side,side),0,0);
    const rows=[];
    for(let i=0;i<3;i++){
      let start=performance.now();ctx.drawImage(image,0,0,width,height);ctx.getImageData(0,0,1,1);const baseline=performance.now()-start;
      start=performance.now();let count=rasterize({sampler,pixels,width,height,destination:[[0,0],[width,0],[0,height]],source:[[0,0],[side-1,0],[0,side-1]]});
      count+=rasterize({sampler,pixels,width,height,destination:[[width,0],[width,height],[0,height]],source:[[side-1,0],[side-1,side-1],[0,side-1]]});
      const rasterMs=performance.now()-start;start=performance.now();ctx.putImageData(new ImageData(pixels,width,height),0,0);const putMs=performance.now()-start;
      start=performance.now();rasterize({sampler:fast,pixels,width,height,destination:[[0,0],[width,0],[0,height]],source:[[0,0],[side-1,0],[0,side-1]]});
      rasterize({sampler:fast,pixels,width,height,destination:[[width,0],[width,height],[0,height]],source:[[side-1,0],[side-1,side-1],[0,side-1]]});
      const lookupRasterMs=performance.now()-start;
      start=performance.now();scan({sampler:fast,pixels,width,height,destination:[[0,0],[width,0],[0,height]],source:[[0,0],[side-1,0],[0,side-1]]});
      scan({sampler:fast,pixels,width,height,destination:[[width,0],[width,height],[0,height]],source:[[side-1,0],[side-1,side-1],[0,side-1]]});
      rows.push({baselineDrawMs:baseline,rasterMs,putMs,lookupRasterMs,scanlineMs:performance.now()-start,pixels:count});
    }
    return {userAgent:navigator.userAgent,width,height,lookupInitMs,rows};
  },{core,raster:rasterizeTerrainTriangle.toString(),scanline:rasterizeTerrainTriangleScanline.toString(),lookup:createTerrainLookupSampler.toString()});
  await writeFile(output,JSON.stringify({schema:'canvas-numeric-raster-cost-v1',scope:'synthetic single tile, one plane; no Viewer, mask, globe, network or GPU timing',...data},null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(data.rows));
}finally{await browser.close();}
