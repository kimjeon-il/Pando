import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
test.use({viewport:{width:1280,height:900},trace:'off',launchOptions:{args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}});
test.setTimeout(130000);
test('diagnose actual first Canvas Worker frame gate without altering runtime behavior',async({page},info)=>{
 const out=resolve('gpu-canvas-first-frame-evidence');mkdirSync(out,{recursive:true});
 await page.addInitScript(()=>{globalThis.__workerGateProbe={messages:[],admissions:[],errors:[],sceneUpdates:[],stale:[],renderRequests:[]};});
 await page.route(/\/modules\/gpu-scene\.js(?:\?|$)/,async route=>{
   const response=await route.fetch();let source=await response.text();
   const anchor="    const land = getPhysicalLand();";
   expect(source.split(anchor).length).toBe(2);
   source=source.replace(anchor,anchor+`
     globalThis.__workerGateProbe.sceneUpdates.push({at:performance.now(),phase:'sync',hasLand:!!land,
       landRevision:land?.revision,waterRevision:land?.waterRevision,hasGeometry:!!land?.geometry,
       lastScene:(currentRenderScene?.polygons||[]).map(x=>x.role),
       dirty:[...gpuSceneDirtyDomains],pending:pendingPreparation?.signature?.slice(0,140)});
   `);
   const miss='    const missing = renderSceneBuilder.missingPolygons(requiredPolygons, sceneInput);';
   expect(source.split(miss).length).toBe(2);
   source=source.replace(miss,miss+`
     globalThis.__workerGateProbe.sceneUpdates.push({at:performance.now(),phase:'missing',missing:missing.length,
       required:requiredPolygons.length,landRevision:land?.revision,
       domains:[...gpuSceneDomains].map(([key,value])=>({key,polygons:value.polygons.length,strokes:value.strokes.length})),
       active:(currentRenderScene?.polygons||[]).map(x=>x.role),
       dirty:[...gpuSceneDirtyDomains],pending:pendingPreparation?.signature?.slice(0,140)});
   `);
   const done='          pendingPreparation = null;\n          syncGpuRenderScene();';
   expect(source.split(done).length).toBe(2);
   source=source.replace(done,`
          globalThis.__workerGateProbe.sceneUpdates.push({at:performance.now(),phase:'prepared',sign:pending.signature.slice(0,140)});
   `+done);
   const failed='          pending.failed = true;';
   expect(source.split(failed).length).toBe(2);
   source=source.replace(failed,failed+`
          globalThis.__workerGateProbe.sceneUpdates.push({at:performance.now(),phase:'prepare-failed',error:String(error),sign:pending.signature?.slice(0,140)});
   `);
   await route.fulfill({response,body:source});
 });
 await page.route(/\/modules\/gpu-map-renderer\.js(?:\?|$)/,async route=>{
  const response=await route.fetch();let s=await response.text();
  function replace(before,after){expect(s.split(before).length, 'Source instrumentation anchor').toBe(2);s=s.replace(before,after);}
  const entry='export function createGpuMapRenderer(';
  replace(entry,'function baseGpuMapRenderer(');
  const present='    function recordMapPresentation(frame, resourcesDrawn = true, { committedWorkerBitmap = false } = {}) {';
  replace(present,present+`
      const physical=getPhysicalContextState(),polygons=renderScene?.polygons||[];
      const p=globalThis.__workerGateProbe;
      if(p?.admissions?.length<80)p.admissions.push({at:performance.now(),frame:frame?.frameId,
       bitmap:committedWorkerBitmap,resourcesArg:resourcesDrawn,
       physicalMatched:physicalSceneMatchesContext(renderScene,physical),
       physical:{ready:physical.ready,landRevision:physical.landRevision,waterRevision:physical.waterRevision},
       land:polygons.filter(x=>x.role==='physical-land').map(x=>({revision:x.geometryRevision,key:x.key})),
       water:polygons.filter(x=>x.role==='physical-water').map(x=>({revision:x.geometryRevision,key:x.key})),
       rendererMode,temporalPending:temporalPending(),pending:geometryRevisionTracker.pendingIds(),
       surface:surfacePresentation,terrain:currentTerrainReadiness(),projectGeneration,countriesPublishedGeneration});
  `);
  const req='    function renderCanvasWorker(visualFrame) {';
  replace(req,req+`
      const p=globalThis.__workerGateProbe,physical=getPhysicalContextState();
      if(p?.renderRequests.length<120)p.renderRequests.push({at:performance.now(),frameId:visualFrame.frameId,
        styleRevision:canvasStyleRevision,physicalMatched:physicalSceneMatchesContext(renderScene,physical),
        scenePhysical:(renderScene?.polygons||[]).filter(x=>x.role?.startsWith('physical')).map(x=>({role:x.role,revision:x.geometryRevision})),
        projectGeneration,viewRevision:visualFrame.viewRevision});
  `);
  const stale='onStale: () => { performanceMetrics.canvasWorkerStaleFrameCount += 1; },';
  replace(stale,`             onStale: message => {
               globalThis.__workerGateProbe?.stale?.push({at:performance.now(),frameId:message.frameId,
                 styleRevision:message.styleRevision,currentStyleRevision:canvasStyleRevision,
                 geometryRevision:message.geometryRevision,currentGeometry:geometryRevisionTracker.committedRevision(),
                 requestId:message.renderRequestId,requestedRevision:message.revision,
                 messageGeneration:message.projectGeneration,projectGeneration,
                 currentFrameId:lastVisualFrame?.frameId,
                 expectedKeyMatches:message.presentationKey===mapTargetKey(lastVisualFrame,{terrainTargetKey:''})});
               performanceMetrics.canvasWorkerStaleFrameCount += 1; },`);
  const receive='    function receiveCanvasWorkerMessage(event) {\n      const message = event.data || {};';
  replace(receive,receive+`
      const physical=getPhysicalContextState(),p=globalThis.__workerGateProbe;
      if(message.type==='frame'&&p?.messages?.length<80)p.messages.push({at:performance.now(),
       hasBitmap:!!message.bitmap,frame:message.frameId,currentFrame:lastVisualFrame?.frameId,
       messageGeneration:message.projectGeneration,projectGeneration,
       messageKeyMatches:message.presentationKey===mapTargetKey(lastVisualFrame,{terrainTargetKey:''}),
       messageGeometry:message.geometryRevision,currentGeometry:geometryRevisionTracker.committedRevision(),
       terrainComplete:message.terrainComplete,styleRevision:message.styleRevision,currentStyleRevision:canvasStyleRevision,physicalMatched:physicalSceneMatchesContext(renderScene,physical),
       physicalReady:physical.ready,sceneRevision:lastRenderSceneRevision});
  `);
  s+='\nexport function createGpuMapRenderer(...args){const r=baseGpuMapRenderer(...args);globalThis.__workerGateProbe.renderer=r;return r;}\n';
  await route.fulfill({response,body:s});
 });
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto('/?renderer=canvas&debug=1',{waitUntil:'domcontentloaded'});
 const snapshots=[];
 for(let i=0;i<4;i++){
  await page.waitForTimeout(14000);
  snapshots.push(await page.evaluate(()=>{
   const p=globalThis.__workerGateProbe,r=p.renderer;
   return {seconds:Math.round(performance.now()/1000),runtime:r?.getRuntimeState(),
    stats:r?.getStats({detailed:false})};
  }));
 }
 const report=await page.evaluate(()=>{const p=globalThis.__workerGateProbe;return{admissions:p.admissions,messages:p.messages,sceneUpdates:p.sceneUpdates,stale:p.stale,renderRequests:p.renderRequests};});
 const result={source:info.project.name,admissions:report.admissions,messages:report.messages,sceneUpdates:report.sceneUpdates,stale:report.stale,renderRequests:report.renderRequests,snapshots:snapshots.map(s=>({seconds:s.seconds,
  mode:s.runtime?.renderer,meshReady:s.runtime?.canonicalMeshReady,quality:s.runtime?.surfacePresentation,
  physicalLand:s.runtime?.backgroundPresentedKey,firstCountry:s.runtime?.firstCountryPublishedMs,
  generation:s.runtime?.projectGeneration,publishedGeneration:s.runtime?.countriesPublishedGeneration,
  terrainReady:s.runtime?.terrainReady,workerBusy:s.stats?.canvasWorkerBusy,stale:s.stats?.canvasWorkerStaleFrameCount,
  workerMessages:s.stats?.canvasWorkerMessageCount,frameCount:s.stats?.canvasWorkerViewMessageCount,
  pending:s.stats?.canvasWorkerHasPendingFrame})) ,errors};
 writeFileSync(join(out,'diagnostic.json'),JSON.stringify(result,null,2));
 console.log('CANVAS_GATE_DIAGNOSTIC '+JSON.stringify({admissions:report.admissions.slice(-3),messages:report.messages.slice(-3),sceneUpdates:report.sceneUpdates.slice(-8),stale:report.stale.slice(-8),renderRequests:report.renderRequests.slice(-8),snapshots:result.snapshots,errors}));
 expect(report.messages.length,'Must observe actual Worker frames').toBeGreaterThan(0);
 await info.attach('canvas-gate-diagnostic',{path:join(out,'diagnostic.json'),contentType:'application/json'});
});
