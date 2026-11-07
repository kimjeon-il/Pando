import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

// Keep renderer-specific fixtures and failure evidence scoped to each contract family.


test.describe("Real context loss and repeated restoration", () => {
test.use({viewport:{width:1280,height:900},trace:'off',actionTimeout:10000,launchOptions:{args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}});
test.setTimeout(200000);
const hash=value=>createHash('sha256').update(value).digest('hex');
const observed={'gpu-map-renderer.js':['createGpuMapRenderer','renderer'],'document-session.js':['createDocumentSession','session'],'rendering-domain.js':['createRenderingDomain','rendering'],'map-visual-frame.js':['createMapVisualFrame','frame']};
async function observe(page){
 await page.addInitScript(()=>{globalThis.__viewerAcceptance={};});
 await page.route(/\/modules\/(gpu-map-renderer|document-session|rendering-domain|map-visual-frame)\.js(?:\?|$)/,async route=>{
  const file=new URL(route.request().url()).pathname.split('/').at(-1),[name,key]=observed[file];
  const response=await route.fetch();let source=await response.text();const anchor=`export function ${name}(`;
  expect(source.split(anchor).length).toBe(2);
  // Read-only factory observations: no changes inside drawing or approval code.
  source=source.replace(anchor,`function original${name}(`)+`\nexport function ${name}(...args){const value=original${name}(...args);globalThis.__viewerAcceptance.${key}=value;return value;}\n`;
  await route.fulfill({response,body:source});
 });
}
async function state(page){return page.evaluate(()=>{
 const o=globalThis.__viewerAcceptance||{},v=globalThis.__PANDOLAB_VIEWER__,f=o.frame,world=o.session?.documentModel.world(),status=document.getElementById('viewerStatus');
 return {boot:{url:location.href,readyState:document.readyState,viewerReady:status?.dataset.ready??null,statusText:status?.textContent?.slice(0,1200)||'',coreLoaded:!!globalThis.PandoLabSphericalCore,observerOwners:Object.keys(o),resizableMemorySupported:typeof globalThis.WebAssembly?.Memory?.prototype?.toResizableBuffer==='function'},
  runtime:o.renderer?.getRuntimeState(),stats:o.renderer?.getStats({detailed:false}),state:v?.documentState(),document:v?JSON.stringify(v.documentSnapshot()):null,
  world:world?{month:world.month,epoch:world.sourceEpoch,count:world.entities?.length}:null,selection:v?.selectionSnapshot(),rendering:o.rendering?.getStats(),
  camera:f?{projection:f.projection,scale:f.cssScale,translate:f.cssTranslate,rotation:f.viewState?.rotation,flatCenter:f.viewState?.flatCenter}:null};
});}
async function ready(page,backend){await expect.poll(async()=>{const s=await state(page),r=s.runtime;return !!(r?.canonicalMeshReady&&!r.projectRenderBlocked&&!r.temporalPresentationPending&&r.surfacePresentation?.quality==='canonical'&&r.countriesPublishedGeneration===r.projectGeneration&&s.rendering?.lastCommittedVisualFrameId>0&&r.renderer===backend);},{timeout:65000}).toBe(true);}
async function pixels(page,first,second){return page.evaluate(async({first,second})=>{
 async function decode(encoded){const image=new Image();image.src='data:image/png;base64,'+encoded;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const context=canvas.getContext('2d');context.drawImage(image,0,0);return {width:canvas.width,height:canvas.height,data:context.getImageData(0,0,canvas.width,canvas.height).data};}
 const a=await decode(first),b=await decode(second);if(a.width!==b.width||a.height!==b.height)return{sameSize:false};
 let changed=0,error=0;const colors=new Set();for(let i=0;i<a.data.length;i+=4){let max=0;for(let k=0;k<3;k++){const d=Math.abs(a.data[i+k]-b.data[i+k]);error+=d;max=Math.max(max,d);}if(max>20)changed++;if(i%400===0)colors.add((b.data[i]<<16)|(b.data[i+1]<<8)|b.data[i+2]);}
 return{sameSize:true,changedFraction:changed/(a.width*a.height),meanChannelError:error/(a.width*a.height*3),colors:colors.size};
},{first:first.toString('base64'),second:second.toString('base64')});}
async function selectCountry(page){
 const box=await page.locator('#map').boundingBox();
 const points=await page.evaluate(()=>[[2,46],[68,48],[103,46],[-50,-10],[135,-25],[-100,40],[30,0]].map(p=>globalThis.__viewerAcceptance.frame.projectVisibleCoordinate(p)).filter(p=>p&&p.every(Number.isFinite)));
 for(const p of points){if(p[0]<4||p[1]<4||p[0]>box.width-4||p[1]>box.height-4)continue;await page.mouse.click(box.x+p[0],box.y+p[1]);await page.waitForTimeout(250);if((await state(page)).selection?.items?.length){await page.mouse.move(3,3);return;}}
 throw Error('Visible map selection failed');
}
for(const backend of ['webgl2','webgl1'])test(`viewer acceptance ${backend}: repeated real recovery preserves displayed map`,async({page,browser})=>{
 const dir=resolve(process.env.G4_EVIDENCE||'gpu-viewer-evidence','acceptance-'+backend);mkdirSync(dir,{recursive:true});
 const result={backend,browser:browser.version(),gpu:'SwiftShader',rounds:[]},errors=[];page.on('pageerror',error=>errors.push(String(error.stack||error)));
 const consoleEvents=[],consoleCaptures=[],requestFailures=[],httpFailures=[];
 page.on('console',message=>{
  if(!['error','warning'].includes(message.type())||consoleEvents.length>=24)return;
  const row={type:message.type(),text:message.text().slice(0,4000),location:message.location()};consoleEvents.push(row);
  consoleCaptures.push(Promise.allSettled(message.args().slice(0,2).map(handle=>handle.evaluate(value=>
   value&&typeof value==='object'?{name:String(value.name||'').slice(0,200),message:String(value.message||value).slice(0,2000),code:String(value.code||'').slice(0,200),stack:String(value.stack||'').slice(0,4000)}:String(value).slice(0,2000))))
   .then(values=>{row.arguments=values.map(value=>value.status==='fulfilled'?value.value:{captureError:String(value.reason).slice(0,1000)});}));
 });
 page.on('requestfailed',request=>{if(requestFailures.length<24)requestFailures.push({url:request.url(),failure:request.failure()?.errorText||''});});
 page.on('response',response=>{if(response.status()>=400&&httpFailures.length<24)httpFailures.push({url:response.url(),status:response.status()});});
 try{
  await observe(page);await page.goto(`/?renderer=${backend}&debug=1`,{waitUntil:'domcontentloaded'});await ready(page,backend);
  for(const year of [2000,2001]){
   await page.locator('#timelineDateButton').click();await page.locator('#timelineYearInput').fill(String(year));await page.locator('#timelineGoBtn').click();
   await expect.poll(async()=>(await state(page)).state?.timelineCursor,{timeout:45000}).toBe(`${year}-12`);await ready(page,backend);await selectCountry(page);await page.waitForTimeout(750);
   const before=await state(page);expect(before.world.month).toBe(before.state.timelineCursor);expect(before.world.epoch).toBe(before.state.epoch);expect(before.selection.items.length).toBeGreaterThan(0);
   const imageBefore=await page.locator('#map').screenshot({path:join(dir,`${year}-before.png`),animations:'disabled'});
   const available=await page.evaluate(()=>{const d=globalThis.__viewerAcceptance.renderer.getRenderDevice(),extension=d.gl.getExtension('WEBGL_lose_context');if(!extension)return false;const loss={extension,lost:false,restored:false};globalThis.__acceptanceLoss=loss;d.canvas.addEventListener('webglcontextlost',()=>loss.lost=true,{once:true});d.canvas.addEventListener('webglcontextrestored',()=>loss.restored=true,{once:true});extension.loseContext();return true;});
   expect(available).toBe(true);await expect.poll(()=>page.evaluate(()=>globalThis.__acceptanceLoss.lost)).toBe(true);await page.waitForTimeout(150);await page.evaluate(()=>globalThis.__acceptanceLoss.extension.restoreContext());
   await expect.poll(()=>page.evaluate(()=>globalThis.__acceptanceLoss.restored),{timeout:10000}).toBe(true);
   await expect.poll(async()=>(await state(page)).stats.gpuRecovery.phase,{timeout:35000}).toBe('complete');await ready(page,backend);await page.waitForTimeout(500);
   const after=await state(page);expect(hash(after.document)).toBe(hash(before.document));expect(after.state.timelineCursor).toBe(before.state.timelineCursor);expect(after.world).toEqual(before.world);expect(after.selection).toEqual(before.selection);expect(after.camera).toEqual(before.camera);
   expect(after.rendering.lastCommittedVisualFrameId).toBeGreaterThan(before.rendering.lastCommittedVisualFrameId);expect(after.stats.gpuRecovery.timerPending).toBe(false);
   const difference=await pixels(page,imageBefore,await page.locator('#map').screenshot({path:join(dir,`${year}-restored.png`),animations:'disabled'}));
   expect(difference.sameSize).toBe(true);expect(difference.colors).toBeGreaterThan(8);expect(difference.changedFraction).toBeLessThan(0.03);expect(difference.meanChannelError).toBeLessThan(2);
   result.rounds.push({year,documentSha256:hash(after.document),selection:after.selection,camera:after.camera,world:after.world,recovery:after.stats.gpuRecovery,frame:after.rendering.lastCommittedVisualFrameId,difference});
  }
  expect(errors).toEqual([]);result.passed=true;
 }catch(error){result.error=String(error.stack||error);throw error;}finally{
  await Promise.allSettled(consoleCaptures);result.bootDiagnostics={consoleEvents,requestFailures,httpFailures};
  result.errors=errors;try{const s=await state(page);delete s.document;result.final=s;await page.screenshot({path:join(dir,'final.png'),timeout:5000});}catch(error){result.captureError=String(error);}
  writeFileSync(join(dir,'result.json'),JSON.stringify(result,null,2));console.log('VIEWER_ACCEPTANCE '+JSON.stringify(result));
 }
});
});


test.describe("Frame-level WebGL1 and WebGL2 evidence", () => {
test.use({viewport:{width:1280,height:900},trace:'off',actionTimeout:10000,launchOptions:{args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}});
test.setTimeout(150000);
const sha=value=>createHash('sha256').update(value).digest('hex');
const traceSource=`
    function traceViewerRecovery(where, extra = {}) {
      const recovery = gpuRecovery.snapshot();
      if (!recovery.recoveryId) return;
      const log = globalThis.__viewerRecoveryTrace ||= {rows:[], counts:{}, lastAt:0, latest:{}, signatures:{}};
      log.counts[where] = (log.counts[where] || 0) + 1;
      const at = performance.now();
      if (where === 'renderWebGl' && at - log.lastAt < 200) return;
      log.lastAt = at;
      const ticket = gpuRecovery.currentTicket(), identity = ticket?.identity;
      const physical = getPhysicalContextState(),polygonStats=polygonOverlayPass.stats(),strokeStats=strokeRenderer.stats();
      const row = {at,where,extra,recovery,rendererMode,webglContextLost,context:renderDeviceContextRevision,
        projectGeneration,projectRenderBlocked,sharedReady:sharedGpuPassesReady(),activeMeshQuality,canonicalMeshReady,
        hasMesh:!!mesh,hasOverride:!!overrideMesh,surfacePresentation,backgroundPresentedKey,countriesPublishedGeneration,
        physical:{ready:physical.ready,landRevision:physical.landRevision,waterRevision:physical.waterRevision},
        physicalMatches:physicalSceneMatchesContext(renderScene,physical),terrain:currentTerrainReadiness(),
        identity:identity?{current:recoveryIdentityCurrent(identity),quality:identity.quality,meshSame:identity.mesh===mesh,
          overrideSame:identity.override===overrideMesh,input:identity.inputRevision,currentInput:gpuRecoveryInputRevision,
          context:identity.context,project:identity.project}:null,
        pending:geometryRevisionTracker.pendingIds(),frame:lastVisualFrame?{id:lastVisualFrame.frameId,project:lastVisualFrame.projectGeneration}:null,
        evidence:gpuRecoveryFrameEvidence?{frame:gpuRecoveryFrameEvidence.frame?.frameId,fallback:!!gpuRecoveryFrameEvidence.fallback}:null,
        polygons:(renderScene?.polygons||[]).filter(p=>p.role==='physical-land'||p.role==='physical-water').map(p=>({role:p.role,key:p.key,prepared:polygonOverlayPass.hasPreparedResource(p),bytes:p.byteLength})),
        uploads:{polygon:polygonStats.uploadBytes,polygonCount:polygonStats.resourceCount,stroke:strokeStats.uploadBytes,strokeCount:strokeStats.resourceCount},
        base:lastBaseSceneResult?{surface:lastBaseSceneResult.surface,missing:lastBaseSceneResult.overlayMissingKeys,failures:lastBaseSceneResult.overlayFailures,countryStroke:lastBaseSceneResult.countryStrokeResult}:null};
      log.latest[where]=row;
      const signature=JSON.stringify([recovery.phase,extra,row.identity,row.surfacePresentation,row.polygons,row.uploads,row.terrain.terrainReady,row.base]);
      if(log.signatures[where]===signature)return;
      log.signatures[where]=signature;
      if(log.rows.length<150)log.rows.push(row);
    }
`;
async function observe(page){
 await page.route(/\/modules\/map-visual-frame\.js(?:\?|$)/,async route=>{
  const response=await route.fetch();let source=await response.text();
  const anchor='export function createMapVisualFrame(';expect(source.split(anchor).length).toBe(2);
  source=source.replace(anchor,'function originalViewerFrame(')+'\nexport function createMapVisualFrame(...args){const frame=originalViewerFrame(...args);globalThis.__viewerFrame=frame;return frame;}\n';
  await route.fulfill({response,body:source});
 });
 await page.route(/\/modules\/gpu-map-renderer\.js(?:\?|$)/,async route=>{
  const response=await route.fetch();let source=await response.text();
  const entry='export function createGpuMapRenderer(';
  expect(source.split(entry).length).toBe(2);
  source=source.replace(entry,'function observedGpuMapRenderer(');
  const anchor='    function recordMapPresentation(frame, resourcesDrawn = true, { committedWorkerBitmap = false, submittedWebGlBaseFrame = false } = {}) {';
  expect(source.split(anchor).length).toBe(2);source=source.replace(anchor,traceSource+'\n'+anchor);
  const rejected='      if (result.strokePresentationFailed) return false;';expect(source.split(rejected).length).toBe(2);
  source=source.replace(rejected,"      traceViewerRecovery('base-result',{failed:result.strokePresentationFailed,missing:result.overlayMissingKeys,failures:result.overlayFailures,countryStroke:result.countryStrokeResult});\n"+rejected);
  for(const [before,extra] of [
   ['    function recordMapPresentation(frame, resourcesDrawn = true, { committedWorkerBitmap = false, submittedWebGlBaseFrame = false } = {}) {','{resourcesDrawn,committedWorkerBitmap}'],
   ['    function recordGpuRecoveryFrame(frame, resourcesDrawn) {','{resourcesDrawn}'],
   ['    function commitGpuRecoveryFrame(frame) {','{}'],
   ['    function finishRecoveryResources(ticket) {','{}'],
   ['    function renderWebGl(visualFrame, { interactionOnly = false } = {}) {','{interactionOnly}'],
  ]){expect(source.split(before).length).toBe(2);const name=before.match(/function (\w+)/)[1];source=source.replace(before,before+`\n      traceViewerRecovery('${name}',${extra});`);}
  source+='\nexport function createGpuMapRenderer(...args){const value=observedGpuMapRenderer(...args);globalThis.__viewerRecoveryRenderer=value;return value;}\n';
  await route.fulfill({response,body:source});
 });
}
async function snapshot(page){return page.evaluate(()=>{
 const r=globalThis.__viewerRecoveryRenderer,v=globalThis.__PANDOLAB_VIEWER__;
 return {runtime:r?.getRuntimeState(),stats:r?.getStats({detailed:false}),state:v?.documentState(),document:v?JSON.stringify(v.documentSnapshot()):null,selection:v?.selectionSnapshot(),trace:globalThis.__viewerRecoveryTrace};
});}
async function ready(page){await expect.poll(async()=>page.evaluate(()=>{
 const r=globalThis.__viewerRecoveryRenderer?.getRuntimeState();
 return !!(globalThis.__PANDOLAB_VIEWER__&&r?.canonicalMeshReady&&!r.projectRenderBlocked&&!r.temporalPresentationPending&&Number.isFinite(r.firstCountryPublishedMs));
}),{timeout:65000}).toBe(true);}
for(const backend of ['webgl2','webgl1'])test(`viewer ${backend}: restored frame retains document and selection`,async({page},info)=>{
 const dir=resolve(process.env.G4_EVIDENCE||'gpu-viewer-evidence',backend);mkdirSync(dir,{recursive:true});
 const result={backend},errors=[];page.on('pageerror',e=>errors.push(String(e.stack||e)));
 try{
  await observe(page);await page.goto(`/?renderer=${backend}&debug=1`,{waitUntil:'domcontentloaded'});
  await ready(page);await page.waitForTimeout(500);
  await page.locator('#timelineDateButton').click();await expect(page.locator('#timelineYearInput')).toBeVisible();await page.locator('#timelineYearInput').fill('2000');await page.locator('#timelineGoBtn').click();
  await expect.poll(async()=>(await snapshot(page)).state?.timelineCursor,{timeout:45000}).toBe('2000-12');await ready(page);
  await page.waitForTimeout(500);
  const box=await page.locator('#map').boundingBox();
  const points=await page.evaluate(()=>[[2,46],[68,48],[103,46],[-50,-10],[135,-25],[-100,40],[30,0],[80,22],[130,50]].map(p=>globalThis.__viewerFrame?.projectVisibleCoordinate(p)).filter(p=>p&&p.every(Number.isFinite)));
  for(const p of points){if(p[0]<4||p[1]<4||p[0]>box.width-4||p[1]>box.height-4)continue;await page.mouse.click(box.x+p[0],box.y+p[1]);await page.waitForTimeout(250);if((await snapshot(page)).selection?.items?.length)break;}
  result.before=await snapshot(page);expect(result.before.selection.items.length).toBeGreaterThan(0);result.beforeHash=sha(result.before.document);
  await page.locator('#map').screenshot({path:join(dir,'before.png')});
  const supported=await page.evaluate(()=>{const d=globalThis.__viewerRecoveryRenderer.getRenderDevice(),ext=d?.gl.getExtension('WEBGL_lose_context');if(!ext)return false;globalThis.__viewerRecoveryLoss={ext,lost:false,restored:false};d.canvas.addEventListener('webglcontextlost',()=>globalThis.__viewerRecoveryLoss.lost=true,{once:true});d.canvas.addEventListener('webglcontextrestored',()=>globalThis.__viewerRecoveryLoss.restored=true,{once:true});ext.loseContext();return true;});
  expect(supported).toBe(true);await expect.poll(()=>page.evaluate(()=>globalThis.__viewerRecoveryLoss.lost)).toBe(true);
  await page.waitForTimeout(150);await page.evaluate(()=>globalThis.__viewerRecoveryLoss.ext.restoreContext());
  await expect.poll(()=>page.evaluate(()=>globalThis.__viewerRecoveryLoss.restored),{timeout:10000}).toBe(true);
  await expect.poll(async()=>(await snapshot(page)).stats.gpuRecovery.phase,{timeout:35000}).toBe('complete');
  const after=await snapshot(page);expect(after.runtime.renderer).toBe(backend);expect(sha(after.document)).toBe(result.beforeHash);expect(after.selection).toEqual(result.before.selection);
  await page.locator('#map').screenshot({path:join(dir,'restored.png')});expect(errors).toEqual([]);result.passed=true;
 }catch(error){result.error=String(error.stack||error);throw error;}finally{
  result.errors=errors;
  try{result.final=await snapshot(page);await page.screenshot({path:join(dir,'final.png'),timeout:5000});}catch(error){result.captureError=String(error);}
  for(const key of ['before','final'])if(result[key]){const text=result[key].document;result[key].documentHash=text?sha(text):null;delete result[key].document;}
  writeFileSync(join(dir,'result.json'),JSON.stringify(result,null,2));console.log('VIEWER_FRAME_RESULT '+JSON.stringify(result));
  await info.attach('viewer-frame-result',{path:join(dir,'result.json'),contentType:'application/json'});
 }
});
});
