import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {mapSummary,chromiumProcessMemory} from '../p7-browser-ab-measure.mjs';
import {setTimeout as delay} from 'node:timers/promises';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function performanceCounters(cdp){return Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(item=>[item.name,item.value]));}
export function performanceDelta(before,after){
  const ms=Object.fromEntries(['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration']
    .map(key=>[key,Number.isFinite(before[key])&&Number.isFinite(after[key])?(after[key]-before[key])*1000:null]));
  return {cpuMs:ms,jsHeapUsedBytes:after.JSHeapUsedSize??null,jsHeapTotalBytes:after.JSHeapTotalSize??null};
}
export async function captureAcceptedFrame(page,path,{screen=false}={}){
  const before=screen?await page.evaluate(()=>globalThis.__pandoScreen.stats.draws):null;
  const started=Date.now();let captureWaitTimedOut=false;
  await page.evaluate(()=>{globalThis.__pandoCaptureFrame.result=null;globalThis.__pandoCaptureFrame.requested=true;
    globalThis.__pandoCaptureFrame.entries=0;globalThis.__pandoCaptureFrame.attempts=0;globalThis.__pandoCaptureFrame.lastAttempt=null;
    globalThis.__pandoTerrainCapture.result=null;globalThis.__pandoTerrainCapture.requested=true;
    globalThis.__pandoCaptureFrame.forceBase=true;globalThis.__PANDOLAB_MAP_HOST__.requestRepaint('terrain-capture-accepted-frame');});
  try{await page.waitForFunction(()=>globalThis.__pandoCaptureFrame?.result,null,{timeout:60000,polling:100});}
  catch(error){
    if(error?.name!=='TimeoutError'||!await page.evaluate(()=>!!globalThis.__pandoCaptureFrame?.result))throw error;
    captureWaitTimedOut=true;
  }
  const captureWaitMs=Date.now()-started;
  const frame=await page.evaluate(async()=>{
    const full=globalThis.__pandoCaptureFrame.result,terrain=globalThis.__pandoTerrainCapture.result;
    if(!terrain||terrain.frameId!==full.frameId||terrain.width!==full.width||terrain.height!==full.height)
      throw Error('Terrain capture does not match the accepted frame');
    async function encode({pixels,width,height}){
      const flipped=new Uint8ClampedArray(pixels.length);
      for(let y=0;y<height;y++)flipped.set(pixels.subarray((height-1-y)*width*4,(height-y)*width*4),y*width*4);
      const surface=new OffscreenCanvas(width,height),context=surface.getContext('2d');
      context.putImageData(new ImageData(flipped,width,height),0,0);
      const png=await surface.convertToBlob({type:'image/png'});
      return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(png);});
    }
    return {data:await encode(full),terrainData:await encode(terrain),width:full.width,height:full.height,frameId:full.frameId,scale:full.scale};
  });
  const bytes=Buffer.from(frame.data.split(',')[1],'base64');
  if(bytes.length<1024||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Invalid framebuffer capture');
  await writeFile(path,bytes);
  const result={width:frame.width,height:frame.height,frameId:frame.frameId,scale:frame.scale,bytes:bytes.length,sha256:digest(bytes),
    captureWaitMs,captureWaitTimedOut};
  const terrainBytes=Buffer.from(frame.terrainData.split(',')[1],'base64');
  if(terrainBytes.length<1024||terrainBytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Invalid terrain-only capture');
  const terrainPath=path.replace(/\.png$/,'-terrain.png');if(terrainPath===path)throw Error('Terrain capture requires a PNG path');
  await writeFile(terrainPath,terrainBytes);result.terrainOnly={bytes:terrainBytes.length,sha256:digest(terrainBytes),frameId:frame.frameId};
  if(screen){
    const draws=await page.evaluate(()=>globalThis.__pandoScreen.stats.draws);
    if(draws<=before)throw Error('Captured frame did not invoke the screen-space pass');
    result.screenDraws=draws;
  }
  return result;
}
export async function runViewerPhases({page,pageCdp,processCdp,out,prefix,screen,center,phases,onPhase,onStart,
  projection='globe',minimumFrames=300,capture=captureAcceptedFrame,expectedLevel=5,panDurationMs=10000,themeCycles=10,diagnostics=async()=>null}){
  if(!Number.isSafeInteger(minimumFrames)||minimumFrames<1)throw TypeError('Positive frame count required');
  if(projection!=='globe'&&projection!=='flat')throw TypeError('Unknown phase projection');
  if(!Number.isSafeInteger(panDurationMs)||panDurationMs<1||!Number.isSafeInteger(themeCycles)||themeCycles<1)
    throw TypeError('Positive interaction duration and theme cycle count required');
  async function phase(name,action,{month,theme,zoom,terrainRadio,level=expectedLevel,requireScreen=screen}={}){
    const row={name,status:'running',frameGapsMs:[]};phases.push(row);onStart(name);await onPhase();
    if(screen&&!requireScreen)row.screenSpaceCoverage=terrainRadio==='terrainNoneRadio'?'not-applicable':'not-verified';
    const countersBefore=await performanceCounters(pageCdp);
    await page.evaluate(()=>globalThis.__terrainFixtureFrames.start());const started=Date.now();
    try{
      await action();
      await page.waitForFunction(({month,theme,expectedLevel,zoom,terrainRadio,projection})=>{
        const api=globalThis.__PANDOLAB_VIEWER__,s=api?.rendererStats();
        const terrainOff=terrainRadio==='terrainNoneRadio';
        return s?.mapReadiness?.mapReady===true&&(terrainOff||s.terrainReady===true&&s.terrainTargetLevel>=0&&s.terrainRenderedLevel===s.terrainTargetLevel
          &&(expectedLevel===null||s.terrainTargetLevel===expectedLevel)
          &&s.terrainTargetTileCount>0&&s.terrainTargetTilesLoaded===s.terrainTargetTileCount)&&!s.screenLodPreparingKey
          &&(!zoom||Math.abs(globalThis.__PANDOLAB_MAP_HOST__.getViewState()[projection==='flat'?'flatZoom':'globeZoom']-zoom)<1e-6)
          &&(!terrainRadio||document.getElementById(terrainRadio)?.checked===true)
          &&(!month||(api.builtinMonth().month===month&&api.documentState()?.timelineCursor===month))
          &&(!theme||document.documentElement.dataset.theme===theme);
      },{month:month||null,theme:theme||null,expectedLevel:level,zoom:zoom||null,terrainRadio:terrainRadio||null,projection},{timeout:180000,polling:250});
      row.readyMs=Date.now()-started;
      await page.waitForFunction(minimum=>globalThis.__terrainFixtureFrames.gaps.length>=minimum,minimumFrames,{timeout:180000,polling:250});
      row.frameGapsMs=await page.evaluate(()=>globalThis.__terrainFixtureFrames.stop());
      const sorted=[...row.frameGapsMs].sort((a,b)=>a-b),at=q=>sorted[Math.floor((sorted.length-1)*q)];
      row.frames={count:sorted.length,p50Ms:at(.5),p95Ms:at(.95),p99Ms:at(.99)};
      row.renderer=mapSummary(await page.evaluate(()=>globalThis.__PANDOLAB_VIEWER__.rendererStats()));
      row.performance=performanceDelta(countersBefore,await performanceCounters(pageCdp));
      row.chromiumProcessMemory=await chromiumProcessMemory(processCdp);
      row.frameCapture=await capture(page,`${out}/${prefix}-${name}-framebuffer.png`,{screen:requireScreen});
      row.candidateDiagnostics=await diagnostics();
      row.status='passed';
    }catch(error){
      row.status='failed';row.error=String(error?.stack||error).slice(0,5000);
      if(!row.frameGapsMs.length)row.frameGapsMs=await page.evaluate(()=>globalThis.__terrainFixtureFrames.stop()).catch(()=>[]);
      await onPhase();throw error;
    }
    await onPhase();
  }
  await phase('drag',async()=>{
    const before=await page.evaluate(kind=>globalThis.__PANDOLAB_MAP_HOST__.getViewState()[kind==='flat'?'flatCenter':'globeRotation'],projection);
    const box=await page.locator('#viewerCanvas').boundingBox();if(!box)throw Error('Viewer map canvas is unavailable');
    const x=box.x+box.width/2,y=box.y+box.height/2;
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+18,y+10,{steps:6});await page.mouse.up();
    await page.waitForFunction(({previous,projection})=>{
      const current=globalThis.__PANDOLAB_MAP_HOST__?.getViewState()?.[projection==='flat'?'flatCenter':'globeRotation'];
      return Array.isArray(current)&&current.some((value,i)=>Math.abs(value-previous[i])>1e-5);
    },{previous:before,projection},{timeout:15000,polling:100});
  });
  await phase('continuous-pan',async()=>{
    const box=await page.locator('#viewerCanvas').boundingBox();if(!box)throw Error('Viewer map canvas is unavailable');
    const x=box.x+box.width/2,y=box.y+box.height/2,start=Date.now();let step=0;
    await page.mouse.move(x,y);await page.mouse.down();
    try{
      while(Date.now()-start<panDurationMs){
        step++;await page.mouse.move(x+Math.sin(step/3)*9,y+Math.cos(step/3)*5);
        await delay(Math.min(250,Math.max(1,panDurationMs-(Date.now()-start))));
      }
    }finally{await page.mouse.up();}
  });
  if(projection==='globe')await phase('rotate',()=>page.evaluate(()=>{
    const host=globalThis.__PANDOLAB_MAP_HOST__,view=host.getViewState(),r=view.globeRotation;
    host.setViewState({projection:'globe',view:{...view,globeRotation:[r[0]+.12,r[1]-.08,r[2]]}});
    host.requestRepaint('terrain-experiment-rotate');
  }));
  const setZoom=zoom=>page.evaluate(({value,projection})=>{
    const host=globalThis.__PANDOLAB_MAP_HOST__,view=host.getViewState();
    host.setViewState({projection,view:{...view,[projection==='flat'?'flatZoom':'globeZoom']:value}});
    host.requestRepaint('terrain-experiment-zoom');
  },{value:zoom,projection});
  await phase('zoom8',()=>setZoom(8),{zoom:8,level:null,requireScreen:false});
  await phase('zoom16',()=>setZoom(16),{zoom:16,level:null,requireScreen:false});
  await phase('zoom32-return',()=>setZoom(32),{zoom:32});
  await phase('previous-year',()=>page.locator('#timelinePreviousYear').click({timeout:10000}),{month:'2025-12'});
  await phase('date-return',()=>page.locator('#timelineNextYear').click({timeout:10000}),{month:'2026-11'});
  await phase('dark',()=>page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'}),{theme:'dark'});
  await phase('light',()=>page.emulateMedia({colorScheme:'light',reducedMotion:'reduce'}),{theme:'light'});
  await phase('theme-cycle',async()=>{
    for(let i=0;i<themeCycles;i++)for(const theme of ['dark','light']){
      await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});
      await page.waitForFunction(value=>document.documentElement.dataset.theme===value,theme,{timeout:15000});
    }
  },{theme:'light'});
  await phase('warm-return',()=>page.evaluate(({target,projection})=>{
    const host=globalThis.__PANDOLAB_MAP_HOST__,view=host.getViewState();
    const camera=projection==='flat'?{flatCenter:target,flatZoom:32}:{globeRotation:[-target[0],-target[1],0],globeZoom:32};
    host.setViewState({projection,view:{...view,...camera}});
    host.requestRepaint('terrain-experiment-warm-return');
  },{target:center,projection}));
  async function selectTerrain(radio){
    await page.locator('#mapDisplayBtn').click({timeout:10000});
    await page.locator('[data-map-display-row="terrain"]').click({timeout:10000});
    await page.locator(`label[for="${radio}"]`).click({timeout:10000});
    await page.locator('#mapDisplayBtn').click({timeout:10000});
  }
  await phase('terrain-political',()=>selectTerrain('terrainPoliticalRadio'),{terrainRadio:'terrainPoliticalRadio'});
  await phase('terrain-none',()=>selectTerrain('terrainNoneRadio'),{terrainRadio:'terrainNoneRadio',requireScreen:false});
  await phase('terrain-physical-return',()=>selectTerrain('terrainPhysicalRadio'),{terrainRadio:'terrainPhysicalRadio'});
  const political=phases.find(row=>row.name==='terrain-political')?.frameCapture?.terrainOnly?.sha256;
  const none=phases.find(row=>row.name==='terrain-none')?.frameCapture?.terrainOnly?.sha256;
  const physical=phases.find(row=>row.name==='terrain-physical-return')?.frameCapture?.terrainOnly?.sha256;
  if(!political||!none||!physical||new Set([political,none,physical]).size!==3)
    throw Error('Terrain modes did not produce distinct terrain pixels');
}
