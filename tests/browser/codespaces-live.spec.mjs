import {expect,test} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {writeFile,unlink} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../',import.meta.url));
const origin='http://127.0.0.1:4173';
function codespaceIdentity(){
  if(process.env.CODESPACES!=='true'||!process.env.CODESPACE_NAME||process.env.PANDO_REMOTE_ONLY!=='1')
    throw Error('PANDO_CODESPACES_REQUIRED: actual remote Codespaces environment is missing');
  const branch=execFileSync('git',['symbolic-ref','--short','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  if(branch!=='work/remote-only')throw Error('Codespace is on wrong branch: '+branch);
  const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  return {codespace:process.env.CODESPACE_NAME,branch,sha,node:process.version};
}

async function currentPresentation(page) {
  return page.evaluate(()=>{
    const viewer=globalThis.__PANDOLAB_VIEWER__,s=viewer?.rendererStats?.();
    if(!s)return {status:'renderer-unavailable'};
    return {
      status:s.mapReadiness?.status??'unknown',
      renderer:s.renderer,
      canonicalMeshReady:s.canonicalMeshReady,
      surfaceQuality:s.surfacePresentation?.quality,
      canonicalPromotionError:s.canonicalPromotionError,
      projectRenderBlocked:s.projectRenderBlocked,
      projectGeneration:s.projectGeneration,
      countriesPublishedGeneration:s.countriesPublishedGeneration,
      displayedRevision:s.displayedRevision,
      requestedRevision:s.requestedRevision,
      displayedGeometryRevision:s.displayedGeometryRevision,
      committedGeometryRevision:s.committedGeometryRevision,
      pendingCountryCount:s.pendingCountryCount,
      countries:viewer.visibleTerritorialCount(),
      canvasWorkerBusy:s.canvasWorkerBusy,
      canvasStyleRevision:s.canvasStyleRevision,
      canvasDisplayedStyleRevision:s.canvasDisplayedStyleRevision,
      terrainReady:s.terrainReady,
      terrainTargetLevel:s.terrainTargetLevel,
      terrainRenderedLevel:s.terrainRenderedLevel
    };
  });
}
function presentationGate(state) {
  // "terrain" is an intermediate state, not proof that the map was presented.
  if(!['ready','limited'].includes(state.status))return 'readiness:'+state.status;
  if(state.canonicalMeshReady!==true||state.surfaceQuality!=='canonical'||state.canonicalPromotionError)
    return 'canonical-geometry-not-presented';
  if(state.projectRenderBlocked!==false)return 'map-render-blocked';
  if(!(state.countries>0)||state.pendingCountryCount!==0)return 'countries-pending';
  if(state.projectGeneration!==state.countriesPublishedGeneration)return 'country-publication-stale';
  if(!Number.isSafeInteger(state.displayedRevision)||state.displayedRevision<=0
    ||state.displayedRevision!==state.requestedRevision
    ||state.displayedGeometryRevision!==state.committedGeometryRevision)
    return 'current-frame-unacknowledged';
  if(!['canvas-worker','canvas2d'].includes(state.renderer))return 'wrong-canvas-renderer';
  if(state.renderer==='canvas-worker'&&(state.canvasWorkerBusy===true
    ||state.canvasDisplayedStyleRevision!==state.canvasStyleRevision))
    return 'canvas-bitmap-stale';
  return 'presented';
}
async function waitForPresentedMap(page,stage,{timeout=125000}={}) {
  let last=null;
  try{
    await expect.poll(async()=>{
      last=await currentPresentation(page);
      return presentationGate(last);
    },{timeout,message:'Codespaces '+stage+': real canonical country and terrain frame must be displayed'}).toBe('presented');
  }catch(error){
    console.error('PANDO_CODESPACES_MAP_NOT_PRESENTED '+JSON.stringify({stage,last}));
    throw error;
  }
  return last;
}

test('actual Codespace map, date navigation and source-watch auto-reload',async({page,request},info)=>{
  test.setTimeout(600000);
  const proof={schema:'pando-codespaces-live-v1',...codespaceIdentity(),startedAt:new Date().toISOString()};
  const response=await request.get(origin+'/__shell/health',{timeout:5000}).catch(error=>{
    throw Error('Codespaces development server unavailable on 4173; inspect /tmp/pando-remote-only-preview.log',{cause:error});
  });
  expect(response.status()).toBe(200);
  const health=await response.json();
  expect(health).toMatchObject({product:'viewer',profile:'map-data',executionMode:'development',error:null});
  expect(Number.isInteger(health.revision)).toBe(true);
  expect((await request.get(origin+'/config/library-data.json')).status()).toBe(404);
  const wasm=await request.get(origin+'/assets/wasm/pandoeditor-core.wasm');
  expect(wasm.status()).toBe(200);
  expect(Buffer.from(await wasm.body()).subarray(0,4)).toEqual(Buffer.from([0,97,115,109]));
  proof.preview={revision:health.revision,wasmBytes:(await wasm.body()).length};
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/?debug=1&renderer=canvas&demTerrain=raster&perf=1',{waitUntil:'domcontentloaded',timeout:30000});
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:110000});
  await expect(page.locator('#map')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__?.visibleTerritorialCount?.()||0),
    {timeout:50000}).toBeGreaterThan(0);
  // Application startup readiness is distinct from a fully presented map frame.
  const firstFrame=await waitForPresentedMap(page,'initial map');
  const before={month:await page.evaluate(()=>window.__PANDOLAB_VIEWER__.builtinMonth().month),
    countries:firstFrame.countries,renderer:firstFrame.renderer,readiness:firstFrame.status,
    canonicalMeshReady:firstFrame.canonicalMeshReady};
  await page.locator('#timelinePreviousYear').click();
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__?.builtinMonth?.().month),
    {timeout:50000}).not.toBe(before.month);
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:50000});
  const datedFrame=await waitForPresentedMap(page,'year navigation',{timeout:110000});
  proof.map={before,datedFrame,after:await page.evaluate(()=>({
    month:window.__PANDOLAB_VIEWER__.builtinMonth().month,
    countries:window.__PANDOLAB_VIEWER__.visibleTerritorialCount()
  }))};
  expect(proof.map.after.countries).toBeGreaterThan(0);

  // Create and then *edit* a real source file. Do not touch tracked source or user WIP.
  const probe=join(root,'apps/viewer/css','codespaces-refresh-probe-'+randomUUID()+'.css');
  if(existsSync(probe))throw Error('Temporary probe name already exists');
  let navigations=0;
  page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations++;});
  const healthRevision=async()=>{
    const response=await request.get(origin+'/__shell/health');
    expect(response.ok()).toBe(true);
    const state=await response.json();
    if(state.error)throw Error('Frontend refresh: '+state.error);
    return state.revision;
  };
  const watchAndReload=async({revision,navigationCount})=>{
    await expect.poll(healthRevision,{timeout:70000}).toBeGreaterThan(revision);
    await expect.poll(()=>navigations,{timeout:70000}).toBeGreaterThan(navigationCount);
    await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:120000});
    const presented=await waitForPresentedMap(page,'auto reload',{timeout:120000});
    return {presented,revisionBefore:revision,revisionAfter:await healthRevision(),
      navigations:navigations-navigationCount};
  };
  try {
    const beforeCreate=await healthRevision(),navBeforeCreate=navigations;
    await writeFile(probe,'/* Codespaces source creation acceptance: A */\n',{flag:'wx'});
    const created=await watchAndReload({revision:beforeCreate,navigationCount:navBeforeCreate});

    // Mutate the same source file. This is distinct from a new-file watcher event.
    const beforeEdit=await healthRevision(),navBeforeEdit=navigations;
    await writeFile(probe,'/* Codespaces source editing acceptance: B */\n',{flag:'w'});
    const edited=await watchAndReload({revision:beforeEdit,navigationCount:navBeforeEdit});
    proof.refresh={sourceCreated:created,sourceEdited:edited};
    expect(edited.revisionAfter).toBeGreaterThan(created.revisionAfter);
    expect(errors).toEqual([]);

    // Capture evidence *before* deleting the probe: unlink triggers a third reload.
    const screenshot=info.outputPath('codespaces-map.png');
    await page.screenshot({path:screenshot,animations:'disabled',timeout:20000});
    const output=info.outputPath('codespaces-proof.json');
    proof.completedAt=new Date().toISOString();
    await writeFile(output,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
    await info.attach('codespaces-proof.json',{path:output,contentType:'application/json'});
    await info.attach('codespaces-map.png',{path:screenshot,contentType:'image/png'});
  } finally {
    if(existsSync(probe))await unlink(probe);
  }
  console.log('PANDO_CODESPACES_LIVE_PASS '+JSON.stringify({codespace:proof.codespace,sha:proof.sha,map:proof.map.after,refresh:proof.refresh}));
});
