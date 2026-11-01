import { gotoEditor } from './helpers/editor-entry.mjs';
import { expect, test } from '@playwright/test';

// CI screenshots document browser/viewport output, not physical GPU/mobile devices.
test.use({
  launchOptions: { args: [
    '--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox'
  ] },
  trace: 'off',
  screenshot: 'only-on-failure',
});
for(const config of [
  {label:'desktop',width:1280,height:800,mobile:false,renderer:'webgl2'},
  {label:'mobile-emulation',width:390,height:844,mobile:true,renderer:'canvas'},
]) {
  test(config.label+' loads real map and captures screenshot',async({browser},testInfo)=>{
    test.setTimeout(150_000);
    const ctx=await browser.newContext({
      viewport:{width:config.width,height:config.height},
      deviceScaleFactor:config.mobile?2:1,
      isMobile:config.mobile,
      hasTouch:config.mobile,
    });
    const page=await ctx.newPage(),runtimeErrors=[];
    const events={console:[],requestFailures:[],failedResponses:[]},eventCounts={console:0,requestFailures:0,failedResponses:0},consoleCaptures=[];
    const record=(kind,value)=>{
      eventCounts[kind]++;
      if(events[kind].length>=32)return false;
      events[kind].push(value);
      return true;
    };
    page.on('pageerror',err=>runtimeErrors.push(err.message));
    page.on('console',message=>{
      if(!['error','warning'].includes(message.type()))return;
      const location=message.location();
      const row={type:message.type(),text:message.text().slice(0,2048),
        location:{url:location.url.slice(0,1024),line:location.lineNumber,column:location.columnNumber}};
      if(!record('console',row))return;
      consoleCaptures.push(Promise.allSettled(message.args().slice(0,2).map(handle=>handle.evaluate(value=>
        value&&typeof value==='object'?{name:String(value.name||'').slice(0,200),message:String(value.message||value).slice(0,2048),
          code:String(value.code||'').slice(0,200),stack:String(value.stack||'').slice(0,4096)}:String(value).slice(0,2048))))
        .then(values=>{row.arguments=values.map(value=>value.status==='fulfilled'?value.value:{captureError:String(value.reason).slice(0,1024)});}));
    });
    ctx.on('requestfailed',request=>record('requestFailures',{
      url:request.url().slice(0,1024),type:request.resourceType(),error:request.failure()?.errorText?.slice(0,2048)||''}));
    ctx.on('response',response=>{
      if(response.status()>=400)record('failedResponses',{url:response.url().slice(0,1024),status:response.status()});
    });
    let ready=false,failure;
    try {
      await gotoEditor(page, '/?renderer='+config.renderer+'&demTerrain=raster',
        {waitUntil:'domcontentloaded',timeout:30_000});
      const app=page.locator('#app');
      await expect(app).toHaveAttribute('data-readiness',/^(preview|editable|enhanced)$/,
        {timeout:110_000});
      if(process.env.PANDO_P9_ACCEPTANCE==='true') {
        await page.waitForFunction(()=>/^(enhanced|error)$/.test(document.getElementById('app')?.dataset.readiness||''),undefined,{timeout:110_000});
        await testInfo.attach('p9-startup-errors.json',{
          body:Buffer.from(JSON.stringify({runtimeErrors,readiness:await app.getAttribute('data-readiness')},null,2)),contentType:'application/json'});
        await expect(app).toHaveAttribute('data-readiness','enhanced',{timeout:1000});
      }
      await expect(page.locator('#map')).toBeVisible();
      const mapBounds=await page.locator('#map').boundingBox();
      expect(mapBounds.width).toBeGreaterThan(80);
      expect(mapBounds.height).toBeGreaterThan(80);
      ready=true;
      const diagnostic=await page.evaluate(()=>({
        readiness:document.getElementById('app')?.dataset.readiness,
        renderer:globalThis.__PANDOLAB_GPU_METRICS__?.renderer??null,
        previewMs:globalThis.__PANDOLAB_STARTUP_METRICS__?.previewDisplayMs??null,
        mapCanvasCount:document.querySelectorAll('#map canvas').length,
        documentTitle:document.title
      }));
      await testInfo.attach('p3-'+config.label+'-runtime.json',{
        body:Buffer.from(JSON.stringify({branch:process.env.PANDO_P3_BRANCH||'unknown',
          sha:process.env.GITHUB_SHA||'local',viewport:config,diagnostic,
          runtimeErrors},null,2)),contentType:'application/json'});
      expect(diagnostic.documentTitle).toBeTruthy();
      expect(runtimeErrors).toEqual([]);
    } catch(error){failure=error;} finally {
      await Promise.allSettled(consoleCaptures);
      const startup={pageClosed:page.isClosed()};
      if(!startup.pageClosed) {
        try {
          startup.state=await page.evaluate(()=>{
            const scalars=(source,keys)=>Object.fromEntries(keys.map(key=>{
              const value=source?.[key];
              return [key,typeof value==='string'?value.slice(0,2048):['number','boolean'].includes(typeof value)?value:null];
            }));
            return {
              url:location.href.slice(0,2048),title:document.title.slice(0,512),readiness:document.getElementById('app')?.dataset.readiness??null,
              bootstrap:{error:document.getElementById('bootstrapLoading')?.classList.contains('error')??false,
                message:document.getElementById('bootstrapLoadingText')?.textContent?.slice(0,512)??null,
                probe:document.getElementById('startupProbe')?.textContent?.slice(0,512)??null},
              build:scalars(globalThis.PANDOLAB_BUILD_META,['appVersion','buildId','assetRevision','dataRevision']),
              metrics:scalars(globalThis.__PANDOLAB_STARTUP_METRICS__,['startupPhase','previewReceivedMs','interactiveMs',
                'editableMs','readyMs','geometryError','meshError','canonicalGeometryReceivedMs','canonicalMeshReceivedMs','rendererStatus']),
              entry:{geometryCore:!!globalThis.PandoLabSphericalCore,countries:!!globalThis.PANDOLAB_COUNTRIES,
                mesh:!!globalThis.PANDOLAB_GPU_MESH_BUFFER,mapHost:!!globalThis.__PANDOLAB_MAP_HOST__},
              wasmMemoryResizable:typeof globalThis.WebAssembly.Memory.prototype.toResizableBuffer==='function',
              scripts:[...document.scripts].map(script=>script.src.slice(0,1024)).filter(Boolean).slice(-24),
            };
          });
        }catch(error){startup.captureError=String(error?.message||error).slice(0,2048);}
      }
      try {
        await testInfo.attach('p3-'+config.label+'-startup.json',{
          body:Buffer.from(JSON.stringify({branch:process.env.PANDO_P3_BRANCH||'unknown',sha:process.env.GITHUB_SHA||'local',
            viewport:config,startup,eventCounts,events,pageErrorCount:runtimeErrors.length,
            runtimeErrors:runtimeErrors.slice(-32).map(message=>message.slice(0,2048))},null,2)),contentType:'application/json'});
      }catch(error){
        console.error('[P3-STARTUP-DIAGNOSTIC]',error);
        failure ||= error;
      }
      if(!page.isClosed()) {
        const file=testInfo.outputPath('p3-'+config.label+'-map.png');
        try{
          await page.screenshot({path:file,fullPage:false,animations:'disabled',timeout:20_000});
          await testInfo.attach('p3-'+config.label+'-screenshot',{
            path:file,contentType:'image/png'});
        }catch(e){
          // Never turn an earlier map failure into a false successful screenshot.
          if(ready)failure ||= e;
        }
      }
      try{await ctx.close();}catch(error){failure ||= error;}
    }
    if(failure)throw failure;
  });
}
