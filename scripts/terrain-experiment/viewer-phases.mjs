import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {mapSummary,chromiumProcessMemory} from '../p7-browser-ab-measure.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function performanceCounters(cdp){return Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(item=>[item.name,item.value]));}
export function performanceDelta(before,after){
  const ms=Object.fromEntries(['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration']
    .map(key=>[key,Number.isFinite(before[key])&&Number.isFinite(after[key])?(after[key]-before[key])*1000:null]));
  return {cpuMs:ms,jsHeapUsedBytes:after.JSHeapUsedSize??null,jsHeapTotalBytes:after.JSHeapTotalSize??null};
}
export async function captureAcceptedFrame(page,path,{screen=false}={}){
  const before=screen?await page.evaluate(()=>globalThis.__pandoScreen.stats.draws):null;
  await page.evaluate(()=>{globalThis.__pandoCaptureFrame.result=null;globalThis.__pandoCaptureFrame.requested=true;
    globalThis.__pandoCaptureFrame.forceBase=true;globalThis.__PANDOLAB_MAP_HOST__.requestRepaint('terrain-capture-accepted-frame');});
  await page.waitForFunction(()=>globalThis.__pandoCaptureFrame?.result,null,{timeout:60000,polling:100});
  const frame=await page.evaluate(async()=>{
    const {pixels,width,height,frameId,scale}=globalThis.__pandoCaptureFrame.result,flipped=new Uint8ClampedArray(pixels.length);
    for(let y=0;y<height;y++)flipped.set(pixels.subarray((height-1-y)*width*4,(height-y)*width*4),y*width*4);
    const surface=new OffscreenCanvas(width,height),context=surface.getContext('2d');
    context.putImageData(new ImageData(flipped,width,height),0,0);
    const png=await surface.convertToBlob({type:'image/png'});
    const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(png);});
    return {data,width,height,frameId,scale};
  });
  const bytes=Buffer.from(frame.data.split(',')[1],'base64');
  if(bytes.length<1024||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Invalid framebuffer capture');
  await writeFile(path,bytes);
  const result={width:frame.width,height:frame.height,frameId:frame.frameId,scale:frame.scale,bytes:bytes.length,sha256:digest(bytes)};
  if(screen){
    const draws=await page.evaluate(()=>globalThis.__pandoScreen.stats.draws);
    if(draws<=before)throw Error('Captured frame did not invoke the screen-space pass');
    result.screenDraws=draws;
  }
  return result;
}
export async function runViewerPhases({page,pageCdp,processCdp,out,prefix,screen,center,phases,onPhase,onStart,
  minimumFrames=300,capture=captureAcceptedFrame,expectedLevel=5}){
  if(!Number.isSafeInteger(minimumFrames)||minimumFrames<1)throw TypeError('Positive frame count required');
  async function phase(name,action,{month,theme}={}){
    const row={name,status:'running',frameGapsMs:[]};phases.push(row);onStart(name);await onPhase();
    const countersBefore=await performanceCounters(pageCdp);
    await page.evaluate(()=>globalThis.__terrainFixtureFrames.start());const started=Date.now();
    try{
      await action();
      await page.waitForFunction(({month,theme,expectedLevel})=>{
        const api=globalThis.__PANDOLAB_VIEWER__,s=api?.rendererStats();
        return s?.mapReadiness?.mapReady===true&&s.terrainReady===true&&s.terrainTargetLevel>=0&&s.terrainRenderedLevel===s.terrainTargetLevel
          &&(expectedLevel===null||s.terrainTargetLevel===expectedLevel)
          &&s.terrainTargetTileCount>0&&s.terrainTargetTilesLoaded===s.terrainTargetTileCount&&!s.screenLodPreparingKey
          &&(!month||(api.builtinMonth().month===month&&api.documentState()?.timelineCursor===month))
          &&(!theme||document.documentElement.dataset.theme===theme);
      },{month:month||null,theme:theme||null,expectedLevel},{timeout:180000,polling:250});
      row.readyMs=Date.now()-started;
      await page.waitForFunction(minimum=>globalThis.__terrainFixtureFrames.gaps.length>=minimum,minimumFrames,{timeout:180000,polling:250});
      row.frameGapsMs=await page.evaluate(()=>globalThis.__terrainFixtureFrames.stop());
      const sorted=[...row.frameGapsMs].sort((a,b)=>a-b),at=q=>sorted[Math.floor((sorted.length-1)*q)];
      row.frames={count:sorted.length,p50Ms:at(.5),p95Ms:at(.95),p99Ms:at(.99)};
      row.renderer=mapSummary(await page.evaluate(()=>globalThis.__PANDOLAB_VIEWER__.rendererStats()));
      row.performance=performanceDelta(countersBefore,await performanceCounters(pageCdp));
      row.chromiumProcessMemory=await chromiumProcessMemory(processCdp);
      row.frameCapture=await capture(page,`${out}/${prefix}-${name}-framebuffer.png`,{screen});
      row.status='passed';
    }catch(error){
      row.status='failed';row.error=String(error?.stack||error).slice(0,5000);
      if(!row.frameGapsMs.length)row.frameGapsMs=await page.evaluate(()=>globalThis.__terrainFixtureFrames.stop()).catch(()=>[]);
      await onPhase();throw error;
    }
    await onPhase();
  }
  await phase('drag',async()=>{
    const before=await page.evaluate(()=>globalThis.__PANDOLAB_MAP_HOST__.getViewState().globeRotation);
    const box=await page.locator('#viewerCanvas').boundingBox();if(!box)throw Error('Viewer map canvas is unavailable');
    const x=box.x+box.width/2,y=box.y+box.height/2;
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+18,y+10,{steps:6});await page.mouse.up();
    await page.waitForFunction(previous=>{
      const current=globalThis.__PANDOLAB_MAP_HOST__?.getViewState()?.globeRotation;
      return Array.isArray(current)&&current.some((value,i)=>Math.abs(value-previous[i])>1e-5);
    },before,{timeout:15000,polling:100});
  });
  await phase('rotate',()=>page.evaluate(()=>{
    const host=globalThis.__PANDOLAB_MAP_HOST__,view=host.getViewState(),r=view.globeRotation;
    host.setViewState({projection:'globe',view:{...view,globeRotation:[r[0]+.12,r[1]-.08,r[2]]}});
    host.requestRepaint('terrain-experiment-rotate');
  }));
  await phase('previous-year',()=>page.locator('#timelinePreviousYear').click({timeout:10000}),{month:'2025-12'});
  await phase('date-return',()=>page.locator('#timelineNextYear').click({timeout:10000}),{month:'2026-11'});
  await phase('dark',()=>page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'}),{theme:'dark'});
  await phase('light',()=>page.emulateMedia({colorScheme:'light',reducedMotion:'reduce'}),{theme:'light'});
  await phase('warm-return',()=>page.evaluate(target=>{
    const host=globalThis.__PANDOLAB_MAP_HOST__,view=host.getViewState();
    host.setViewState({projection:'globe',view:{...view,globeRotation:[-target[0],-target[1],0],globeZoom:32}});
    host.requestRepaint('terrain-experiment-warm-return');
  },center));
}
