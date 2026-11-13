// Experimental Float16 Canvas numerical interpolation and color composition.
import {readFile,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import {createHeightShadeLookup} from './canvas-numeric-raster.mjs';
const output=process.argv[2],frequent=!process.argv.includes('--gpu-canvas');if(!output)throw Error('An explicit new report path is required');
const core=await readFile(new URL('../../src/rendering/workers/canvas-terrain-dem-core.js',import.meta.url),'utf8');
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
  const page=await browser.newPage({viewport:{width:1280,height:800},deviceScaleFactor:1});
  const data=await page.evaluate(({core,lookupSource,frequent})=>{
    (0,eval)(core);const createLookup=(0,eval)(`(${lookupSource})`),api=globalThis.PandoLabCanvasTerrainDem,width=1280,height=800,side=1026;
    const source=new OffscreenCanvas(side,side),sc=source.getContext('2d',{colorType:'float16',colorSpace:'srgb'});
    const input=sc.createImageData(side,side,{pixelFormat:'rgba-float16'});
    if(!(input.data instanceof Float16Array))throw Error('Float16 Canvas unavailable');
    for(let i=0;i<input.data.length;i+=4){input.data[i]=0;input.data[i+2]=212/255;input.data[i+3]=1;}sc.putImageData(input,0,0);
    const target=new OffscreenCanvas(width,height),tc=target.getContext('2d',{colorType:'float16',colorSpace:'srgb',willReadFrequently:frequent});
    const outputImage=new ImageData(new Uint8ClampedArray(width*height*4),width,height),out=outputImage.data;
    const paletteDem=new Uint8ClampedArray(6501*4);
    for(let h=0;h<=6500;h++){const encoded=h+12000,at=h*4;paletteDem[at]=encoded>>8;paletteDem[at+1]=encoded&255;paletteDem[at+2]=212;paletteDem[at+3]=255;}
    const palette=api.convertTile({dem:paletteDem,width:6501,height:1,includePolitical:false}).land;
    const flat=.27+.73*Math.SQRT1_2;
    const factor=shade=>{const illumination=Math.max(0,(shade-.42)/.58);return Math.max(.38,Math.min(1.3,Math.max(.16,Math.min(1,flat+((.27+.73*illumination)-flat)*1.3))/flat));};
    const base=factor(212/255),rows=[];
    if(new Uint8Array(new Uint32Array([1]).buffer)[0]!==1)throw Error('Lookup probe requires little-endian output');
    const initStart=performance.now(),lookup=createLookup(api,'light'),lookupInitMs=performance.now()-initStart;
    const packedOut=new Uint32Array(outputImage.data.buffer);
    function colorOne(decoded,index,out,at){
      const h=Math.max(0,Math.min(6500,decoded[index]*16384)),lo=Math.floor(h),hi=Math.min(6500,lo+1),f=h-lo,m=factor(decoded[index+2])/base;
      for(let c=0;c<3;c++)out[at+c]=Math.round((palette[lo*4+c]*(1-f)+palette[hi*4+c]*f)*m);out[at+3]=255;
    }
    for(let run=0;run<3;run++){
      let start=performance.now();tc.drawImage(source,0,0,width,height);const drawMs=performance.now()-start;
      start=performance.now();const decoded=tc.getImageData(0,0,width,height,{pixelFormat:'rgba-float16'}).data;const readMs=performance.now()-start;
      start=performance.now();for(let i=0;i<out.length;i+=4)colorOne(decoded,i,out,i);const colorMs=performance.now()-start;
      start=performance.now();for(let i=0,pixel=0;i<out.length;i+=4,pixel++){
        const h=Math.max(0,Math.min(6500,Math.round(decoded[i]*16384))),shade=Math.max(0,Math.min(255,Math.round(decoded[i+2]*255)));
        packedOut[pixel]=lookup[h*256+shade];
      }const lookupMs=performance.now()-start;
      start=performance.now();tc.putImageData(outputImage,0,0);const putMs=performance.now()-start;
      rows.push({drawMs,readMs,colorMs,lookupMs,putMs,pixels:width*height});
    }
    const small=new OffscreenCanvas(2,1),a=small.getContext('2d',{colorType:'float16',colorSpace:'srgb'});
    const values=a.createImageData(2,1,{pixelFormat:'rgba-float16'});values.data.set([8/16384,0,212/255,1,520/16384,0,180/255,1]);a.putImageData(values,0,0);
    const scaled=new OffscreenCanvas(4,1),b=scaled.getContext('2d',{colorType:'float16',colorSpace:'srgb'});b.drawImage(small,0,0,4,1);
    const observed=Array.from(b.getImageData(0,0,4,1,{pixelFormat:'rgba-float16'}).data);
    const expected=[8,136,392,520];const heightErrors=expected.map((h,i)=>Math.abs(observed[i*4]*16384-h));
    const ground=new OffscreenCanvas(2,2),g=ground.getContext('2d',{colorType:'float16',colorSpace:'srgb'}),grid=g.createImageData(2,2,{pixelFormat:'rgba-float16'}),raw=new Uint8ClampedArray(16),heights=[-1000,256,2500,6500];
    heights.forEach((h,i)=>{const n=h+12000;raw.set([n>>8,n&255,140+i*30,255],i*4);grid.data.set([Math.max(0,h)/16384,0,(140+i*30)/255,1],i*4);});g.putImageData(grid,0,0);
    const picture=new OffscreenCanvas(4,4),p=picture.getContext('2d',{colorType:'float16',colorSpace:'srgb'});p.drawImage(ground,0,0,4,4);
    const floats=p.getImageData(0,0,4,4,{pixelFormat:'rgba-float16'}).data,reference=api.createInterpolatedSampler({dem:raw,width:2,height:2,channel:'land'}),actual=new Uint8ClampedArray(4),exact=new Uint8ClampedArray(4);
    let maxRgbError=0,maxLookupError=0;const lookupPixel=new Uint8Array(4),packed=new Uint32Array(lookupPixel.buffer);
    for(let y=0;y<4;y++)for(let x=0;x<4;x++){const i=(y*4+x)*4;colorOne(floats,i,actual,0);reference((x+.5)/2-.5,(y+.5)/2-.5,exact);
      const h=Math.max(0,Math.min(6500,Math.round(floats[i]*16384))),shade=Math.max(0,Math.min(255,Math.round(floats[i+2]*255)));packed[0]=lookup[h*256+shade];
      for(let c=0;c<3;c++){maxRgbError=Math.max(maxRgbError,Math.abs(actual[c]-exact[c]));maxLookupError=Math.max(maxLookupError,Math.abs(lookupPixel[c]-exact[c]));}}
    if(maxRgbError>2)throw Error('Float16 gradient differs from CPU reference: '+maxRgbError);
    if(maxLookupError>2)throw Error('Float16 lookup gradient differs from CPU reference: '+maxLookupError);
    return {userAgent:navigator.userAgent,width,height,attributes:tc.getContextAttributes(),observed,heightErrors,maxRgbError,maxLookupError,lookupInitMs,lookupBytes:lookup.byteLength,rows};
  },{core,lookupSource:createHeightShadeLookup.toString(),frequent});
  await writeFile(output,JSON.stringify({schema:'canvas-float16-cost-v1',scope:'synthetic one land plane; no Viewer, mask, globe, network or GPU timing',...data},null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({heightErrors:data.heightErrors,rows:data.rows}));
}finally{await browser.close();}
