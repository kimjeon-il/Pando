import { gotoEditor, setEditorMonth } from './helpers/editor-entry.mjs';
import { expect, test } from '@playwright/test';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';

test.use({ trace: 'off', viewport: { width: 1440, height: 900 } });

async function rssPss() {
  let sum=0, renderer=0, gpu=0, count=0;
  for (const pid of (await readdir('/proc')).filter(name=>/^\d+$/.test(name))) {
    try {
      const comm=(await readFile('/proc/'+pid+'/comm','utf8')).trim();
      if (!/(chrome|chromium|headless_shell|headless-shell)/i.test(comm)) continue;
      const args=(await readFile('/proc/'+pid+'/cmdline','utf8')).replaceAll('\0',' ');
      if (!/(chrome|chromium|headless_shell|headless-shell)/i.test(args)) continue;
      const kb=Number((await readFile('/proc/'+pid+'/smaps_rollup','utf8')).match(/^Pss:\s*(\d+)\s*kB/m)?.[1]||0);
      sum+=kb; count++;
      if(args.includes('--type=renderer'))renderer+=kb;
      if(args.includes('--type=gpu-process'))gpu+=kb;
    }catch{ /* Chromium processes may exit while /proc is sampled. */ }
  }
  return {totalKiB:sum,rendererKiB:renderer,gpuKiB:gpu,chromiumProcesses:count};
}
function profileTop(profile) {
  const nodes=new Map(profile.nodes.map(n=>[n.id,n.callFrame]));
  const accum=new Map();
  for(let i=0;i<(profile.samples||[]).length;i++){
    const f=nodes.get(profile.samples[i]);if(!f)continue;
    const where=String(f.url||'').replace(/[?#].*$/,'').split('/').slice(-2).join('/');
    const k=String(f.functionName||'(anonymous)')+' @ '+where+':'+(f.lineNumber+1);
    accum.set(k,(accum.get(k)||0)+(profile.timeDeltas?.[i]||1000)/1000);
  }
  return {samples:profile.samples?.length||0,top:[...accum].sort((a,b)=>b[1]-a[1]).slice(0,35).map(([name,ms])=>({name,ms:Math.round(ms*10)/10}))};
}
async function snap(page,cdp,label){
  const state=await page.evaluate(()=>{
    const d=window.__PANDOLAB_RENDER_DEBUG__.snapshot(),g=d.gpu;
    const status=window.__PANDOLAB_PERFORMANCE_REPORT__?.()?.operations?.['autosave.persist'];
    return {timeMs:performance.now(),heapBytes:performance.memory?.usedJSHeapSize||null,
      modePrimary:document.querySelector('#modePrimaryBtn')?.getAttribute('aria-label')||null,
      vertexHandleCount:document.querySelectorAll('circle.vertex-handle').length,
      countryVertexCount:document.querySelectorAll('circle.country-vertex').length,
      boundaryEditPaths:document.querySelectorAll('path.boundary-edit-segment').length,
      gpuStrokeBytes:g.stroke?.activeBufferBytes,strokeUploads:g.stroke?.uploadBytes,
      sceneCacheBytes:d.renderScene.cacheBytes,selectionSegments:g.selection?.segmentCount||0,
      gpuSelectionBytes:g.selection?.activeBufferBytes||0,selectionFallback:d.selection.fallbackCount,
      renderedFrames:d.viewRenderCount,renderedFullFrames:g.sceneCacheFullDrawCount,
      autosave:{count:status?.count||0,last:(status?.samples||[]).slice(-1)[0]||null},
      latestRendererTimes:d.lastRendererTimes,latestRenderReasons:d.lastReasons};
  });
  let heap=null;try{heap=await cdp.send('Runtime.getHeapUsage')}catch{ /* CDP heap sampling is optional for this diagnostic. */ }
  return {label,state,mainJsHeapUsedBytes:heap?.usedSize||null,pss:await rssPss(),workers:page.workers().map(w=>new URL(w.url()).pathname)};
}
test('1989 Soviet actual coast-edit entry CPU and memory after autosave quiescence',async({page},testInfo)=>{
  test.setTimeout(300_000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await gotoEditor(page, '/?perf=1&renderer=webgl2');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:120_000});
  await expect.poll(()=>page.evaluate(()=>{
    const g=window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu;
    return g?.renderer==='webgl2'&&g.canonicalMeshReady&&!g.countrySharedBoundaryReplacementPending;
  }),{timeout:90_000}).toBe(true);
  await page.waitForFunction(() => window.__PANDOLAB_MAP_HOST__.getViewState().projection === 'flat');
  await setEditorMonth(page, '1989-06');
  await expect.poll(()=>page.evaluate(()=>window.PANDOLAB_TERRITORIAL.get('state:soviet-union')?.geometry?.coordinates?.length||0),
    {timeout:90_000}).toBeGreaterThan(0);
  await page.evaluate(()=>window.PANDOLAB_TERRITORIAL.select('state:soviet-union'));
  await expect.poll(()=>page.evaluate(()=>{
    const {gpu,selection}=window.__PANDOLAB_RENDER_DEBUG__.snapshot();
    return gpu.selection?.segmentCount>0&&gpu.selection?.channels?.primary?.drawSucceeded===true&&selection.fallbackCount===0;
  }),{timeout:90_000}).toBe(true);
  // Cursor-only timeline updates deliberately avoid full-project autosave.
  // Settle startup work and any independent preview Worker before attributing
  // the cost of opening the coast editor; no full autosave is required here.
  await page.waitForTimeout(5000);
  try {
    await expect.poll(() => page.workers().filter(worker => worker.url().includes('/project-preview-worker.js')).length,
      { timeout: 45000, intervals: [500, 1000, 1500] }).toBe(0);
  } catch { /* Report an in-flight preview as attribution uncertainty. */ }
  const previewWorkerQuiescent = !page.workers().some(worker => worker.url().includes('/project-preview-worker.js'));
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval',{interval:1000});
  const before=await snap(page,cdp,'pre-edit-after-autosave');
  const started=await page.evaluate(()=>performance.now());
  await cdp.send('Profiler.start');
  let editOpened=false,reason=null;
  try {
    await page.locator('#actionsTabBtn').evaluate(b=>b.click());
    await expect(page.locator('#editEntityCoastBtn')).toBeEnabled({timeout:30_000});
    await page.locator('#editEntityCoastBtn').evaluate(b=>b.click());
    await expect(page.locator('#modePrimaryBtn')).toHaveAttribute('aria-label','수정 완료',{timeout:130_000});
    await expect.poll(()=>page.locator('circle.country-vertex').count(),{timeout:75_000}).toBeGreaterThan(0);
    editOpened=true;
  } catch(e) {reason=String(e?.message||e).slice(0,1200);}
  const editReadyMs=(await page.evaluate(()=>performance.now()))-started;
  const profile=profileTop((await cdp.send('Profiler.stop')).profile);
  const active=await snap(page,cdp,'edit-entered-before-gc');
  await cdp.send('HeapProfiler.collectGarbage');
  await page.waitForTimeout(300);
  const afterGc=await snap(page,cdp,'edit-entered-after-main-gc');
  let afterCancel=null;
  let cancelConfirmed=false;
  if(editOpened){
    for(let step=0;step<2;step++){
      await page.locator('#modeCancelBtn').evaluate(b=>b.click());
      if(await page.locator('#confirmModal').isVisible()) await page.locator('#confirmModalOkBtn').evaluate(b=>b.click());
      await page.waitForTimeout(600);
      if(await page.locator('circle.country-vertex').count()===0){ cancelConfirmed=true;break; }
    }
    await cdp.send('HeapProfiler.collectGarbage');
    afterCancel=await snap(page,cdp,cancelConfirmed?'edit-cancelled-after-gc':'cancel-attempted-still-editing');
  }
  const boundaryPreparation = await page.evaluate(() => {
    const samples = window.__PANDOLAB_PERFORMANCE_REPORT__?.()?.operations?.['edit.boundary.prepare']?.samples || [];
    return samples.slice(-1)[0] || null;
  });
  const result={schema:'pandolab-soviet-edit-entry-v2',entity:'state:soviet-union',month:'1989-06',
    boundaryPreparation,
    conditions:'web WebGL2 after cursor-only timeline update and preview Worker quiescence; CI SwiftShader not a physical GPU',
    previewWorkerQuiescent,editOpened,reason,editReadyMs:Number(editReadyMs.toFixed(1)),cancelConfirmed,before,active,afterGc,afterCancel,
    profile,errors};
  await mkdir('test-results/soviet-edit-entry',{recursive:true});
  await writeFile('test-results/soviet-edit-entry/measurement.json',JSON.stringify(result,null,2));
  await testInfo.attach('soviet-edit-entry.json',{body:Buffer.from(JSON.stringify(result,null,2)),contentType:'application/json'});
  console.log('SOVIET_EDIT_ENTRY',JSON.stringify(result));
  expect(editOpened,reason||'Edit did not start').toBe(true);
  expect(errors).toEqual([]);
  await cdp.detach();
});
