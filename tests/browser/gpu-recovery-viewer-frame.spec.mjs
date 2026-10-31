import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';

test.use({viewport:{width:1280,height:900},trace:'off',launchOptions:{args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}});
test.setTimeout(150000);
const sha=value=>createHash('sha256').update(value).digest('hex');
const traceSource=`
    function traceViewerRecovery(where, extra = {}) {
      const recovery = gpuRecovery.snapshot();
      if (!recovery.recoveryId) return;
      const log = globalThis.__viewerRecoveryTrace ||= {rows:[], counts:{}, lastAt:0};
      log.counts[where] = (log.counts[where] || 0) + 1;
      const at = performance.now();
      if (where === 'renderWebGl' && at - log.lastAt < 200) return;
      log.lastAt = at;
      const ticket = gpuRecovery.currentTicket(), identity = ticket?.identity;
      const physical = getPhysicalContextState();
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
        polygons:(renderScene?.polygons||[]).filter(p=>p.role==='physical-land'||p.role==='physical-water').map(p=>({role:p.role,key:p.key,prepared:polygonOverlayPass.hasPreparedResource(p)})),
        base:lastBaseSceneResult?{surface:lastBaseSceneResult.surface,missing:lastBaseSceneResult.overlayMissingKeys,failures:lastBaseSceneResult.overlayFailures,countryStroke:lastBaseSceneResult.countryStrokeResult}:null};
      if(log.rows.length<150)log.rows.push(row);
    }
`;
async function observe(page){
 await page.route(/\/modules\/gpu-map-renderer\.js(?:\?|$)/,async route=>{
  const response=await route.fetch();let source=await response.text();
  const entry='export function createGpuMapRenderer(';
  expect(source.split(entry).length).toBe(2);
  source=source.replace(entry,'function observedGpuMapRenderer(');
  const anchor='    function recordMapPresentation(frame, resourcesDrawn = true) {';
  expect(source.split(anchor).length).toBe(2);source=source.replace(anchor,traceSource+'\n'+anchor);
  for(const [before,extra] of [
   ['    function recordMapPresentation(frame, resourcesDrawn = true) {','{resourcesDrawn}'],
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
for(const backend of ['webgl2','webgl1'])test(`viewer ${backend}: restored frame retains document and selection`,async({page},info)=>{
 const dir=resolve(process.env.G4_EVIDENCE||'gpu-viewer-evidence',backend);mkdirSync(dir,{recursive:true});
 const result={backend},errors=[];page.on('pageerror',e=>errors.push(String(e.stack||e)));
 try{
  await observe(page);await page.goto(`/?renderer=${backend}&debug=1`,{waitUntil:'domcontentloaded'});
  await expect.poll(async()=>(await snapshot(page)).runtime?.firstCountryPublishedMs,{timeout:65000}).not.toBeNull();
  await expect(page.locator('#timelineDateButton')).toBeVisible();
  await page.locator('#timelineDateButton').click();await page.locator('#timelineYearInput').fill('2000');await page.locator('#timelineGoBtn').click();
  await expect.poll(async()=>(await snapshot(page)).state?.timelineCursor,{timeout:45000}).toBe('2000-12');
  await expect.poll(async()=>{const s=await snapshot(page);return s.runtime?.canonicalMeshReady&&!s.runtime?.projectRenderBlocked&&!s.runtime?.temporalPresentationPending;},{timeout:45000}).toBe(true);
  await page.waitForTimeout(500);
  const box=await page.locator('#map').boundingBox();
  for(const [x,y]of [[0.35,0.45],[0.45,0.40],[0.55,0.50],[0.60,0.40]]){await page.mouse.click(box.x+box.width*x,box.y+box.height*y);await page.waitForTimeout(250);if((await snapshot(page)).selection?.items?.length)break;}
  result.before=await snapshot(page);expect(result.before.selection.items.length).toBeGreaterThan(0);result.beforeHash=sha(result.before.document);
  await page.locator('#map').screenshot({path:join(dir,'before.png')});
  const supported=await page.evaluate(()=>{const d=globalThis.__viewerRecoveryRenderer.getRenderDevice(),ext=d?.gl.getExtension('WEBGL_lose_context');if(!ext)return false;globalThis.__viewerRecoveryLoss={ext,lost:false,restored:false};d.canvas.addEventListener('webglcontextlost',()=>globalThis.__viewerRecoveryLoss.lost=true,{once:true});d.canvas.addEventListener('webglcontextrestored',()=>globalThis.__viewerRecoveryLoss.restored=true,{once:true});ext.loseContext();return true;});
  expect(supported).toBe(true);await expect.poll(()=>page.evaluate(()=>globalThis.__viewerRecoveryLoss.lost)).toBe(true);
  await page.waitForTimeout(150);await page.evaluate(()=>globalThis.__viewerRecoveryLoss.ext.restoreContext());
  await expect.poll(()=>page.evaluate(()=>globalThis.__viewerRecoveryLoss.restored),{timeout:10000}).toBe(true);
  await expect.poll(async()=>(await snapshot(page)).stats.gpuRecovery.phase,{timeout:35000}).toBe('complete');
  const after=await snapshot(page);expect(after.runtime.renderer).toBe(backend);expect(sha(after.document)).toBe(result.beforeHash);expect(after.selection).toEqual(result.before.selection);
  await page.locator('#map').screenshot({path:join(dir,'restored.png')});expect(errors).toEqual([]);result.passed=true;
 }finally{
  result.errors=errors;
  try{result.final=await snapshot(page);await page.screenshot({path:join(dir,'final.png'),timeout:5000});}catch(error){result.captureError=String(error);}
  for(const key of ['before','final'])if(result[key]){const text=result[key].document;result[key].documentHash=text?sha(text):null;delete result[key].document;}
  writeFileSync(join(dir,'result.json'),JSON.stringify(result,null,2));console.log('VIEWER_FRAME_RESULT '+JSON.stringify(result));
  await info.attach('viewer-frame-result',{path:join(dir,'result.json'),contentType:'application/json'});
 }
});
