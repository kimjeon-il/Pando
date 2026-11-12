// Bounded synthetic readback probe. It does not install a Viewer renderer.
import {writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
const output=process.argv[2];if(!output)throw Error('A new report path is required');
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
  const page=await browser.newPage({viewport:{width:1280,height:800},deviceScaleFactor:1});
  const result=await page.evaluate(()=>{
    const width=1280,height=800,canvas=new OffscreenCanvas(width,height);
    const context=canvas.getContext('2d',{colorType:'float16',colorSpace:'srgb',willReadFrequently:true});
    const image=context.createImageData(width,height,{pixelFormat:'rgba-float16'});
    if(!(image.data instanceof Float16Array))throw Error('Float16 Canvas unavailable');
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const at=(y*width+x)*4;image.data[at]=(x%1024)/16384;image.data[at+1]=(y%800)/16384;
      image.data[at+2]=((x+y)%256)/255;image.data[at+3]=1;
    }
    context.putImageData(image,0,0);
    const regions=[{name:'quarter',x:320,y:200,width:640,height:400},
      {name:'right-strip',x:1120,y:0,width:160,height:800},
      {name:'tile-corner',x:960,y:600,width:320,height:200}];
    const trials=[];
    for(let run=0;run<3;run++){
      let start=performance.now();const full=context.getImageData(0,0,width,height,{pixelFormat:'rgba-float16'}).data;
      const fullMs=performance.now()-start,items=[];
      for(const region of regions){
        start=performance.now();const part=context.getImageData(region.x,region.y,region.width,region.height,{pixelFormat:'rgba-float16'}).data;
        const readMs=performance.now()-start;let mismatched=0;
        for(let y=0;y<region.height;y++)for(let x=0;x<region.width;x++)for(let c=0;c<4;c++){
          if(part[(y*region.width+x)*4+c]!==full[((region.y+y)*width+region.x+x)*4+c])mismatched++;
        }
        if(mismatched)throw Error('Partial read differs: '+region.name);
        items.push({...region,readMs,bytes:part.byteLength,mismatched});
      }
      trials.push({fullMs,fullBytes:full.byteLength,regions:items});
    }
    // Independent surfaces receive the same changed strip before either read.
    // This includes pending draw synchronization but remains a synthetic test.
    const other=new OffscreenCanvas(width,height),otherContext=other.getContext('2d',{colorType:'float16',colorSpace:'srgb',willReadFrequently:true});
    otherContext.putImageData(image,0,0);
    const patch=new OffscreenCanvas(160,height),patchContext=patch.getContext('2d',{colorType:'float16',colorSpace:'srgb'});
    const patchImage=patchContext.createImageData(160,height,{pixelFormat:'rgba-float16'});
    for(let i=0;i<patchImage.data.length;i+=4){patchImage.data[i]=.25;patchImage.data[i+1]=.125;patchImage.data[i+2]=.75;patchImage.data[i+3]=1;}
    patchContext.putImageData(patchImage,0,0);
    const incrementalTrials=[];
    for(let run=0;run<3;run++){
      context.drawImage(patch,1120,0);otherContext.drawImage(patch,1120,0);
      let start=performance.now();const full=context.getImageData(0,0,width,height,{pixelFormat:'rgba-float16'}).data;const fullMs=performance.now()-start;
      start=performance.now();const partial=otherContext.getImageData(1120,0,160,height,{pixelFormat:'rgba-float16'}).data;const partialMs=performance.now()-start;
      let mismatched=0;for(let y=0;y<height;y++)for(let x=0;x<160;x++)for(let c=0;c<4;c++)if(partial[(y*160+x)*4+c]!==full[(y*width+1120+x)*4+c])mismatched++;
      if(mismatched)throw Error('Changed strip differs from full read');
      incrementalTrials.push({fullMs,partialMs,fullBytes:full.byteLength,partialBytes:partial.byteLength,mismatched});
    }
    return {userAgent:navigator.userAgent,width,height,attributes:context.getContextAttributes(),trials,incrementalTrials};
  });
  await writeFile(output,JSON.stringify({schema:'canvas-float16-dirty-read-v1',scope:'synthetic cached image; no Viewer, animation or GPU performance',...result},null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(result.trials));
}finally{await browser.close();}
