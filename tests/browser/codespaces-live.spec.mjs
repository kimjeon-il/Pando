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
test('actual Codespace map, date navigation and source-watch auto-reload',async({page,request},info)=>{
  test.setTimeout(480000);
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
  await page.goto('/?debug=1&renderer=canvas',{waitUntil:'domcontentloaded',timeout:30000});
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:110000});
  await expect(page.locator('#map')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__?.visibleTerritorialCount?.()||0),
    {timeout:50000}).toBeGreaterThan(0);
  const before=await page.evaluate(()=>{
    const v=window.__PANDOLAB_VIEWER__,s=v.rendererStats();
    return {month:v.builtinMonth().month,countries:v.visibleTerritorialCount(),
      renderer:s.renderer,readiness:s.mapReadiness?.status,canonicalMeshReady:s.canonicalMeshReady};
  });
  expect(before.canonicalMeshReady).toBe(true);
  expect(['ready','limited']).toContain(before.readiness);
  await page.locator('#timelinePreviousYear').click();
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__?.builtinMonth?.().month),
    {timeout:50000}).not.toBe(before.month);
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:50000});
  proof.map={before,after:await page.evaluate(()=>({
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
    return {revisionBefore:revision,revisionAfter:await healthRevision(),
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
