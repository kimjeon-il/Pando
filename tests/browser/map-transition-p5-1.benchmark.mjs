import {test,expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {instrumentP5Source,p5Stages} from '../helpers/map-transition-p5-1.mjs';
import {installMapBaselineCollector,semanticSnapshot,summarizeLatency,observeWithDeadline} from '../helpers/map-transition-baseline.mjs';

test.use({timezoneId:'Asia/Seoul',locale:'ko-KR',viewport:{width:1280,height:800},trace:'off'});
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('P5-1 actual Core source, storage admission and replacement timing',async({page,browser},info)=>{
  test.setTimeout(220000);
  await page.clock.setFixedTime(new Date('2026-10-31T00:00:00+09:00'));
  await page.addInitScript(installMapBaselineCollector);
  const errors=[],sources={},samples=[],snapshots=new Map();
  page.on('pageerror',error=>errors.push(String(error)));
  for(const name of ['viewer-composition.js','builtin-session.js','project-domain.js']){
    await page.route(`**/modules/${name}*`,async route=>{
      const response=await route.fetch(),source=await response.text();
      sources[name]=createHash('sha256').update(source).digest('hex');
      await route.fulfill({response,body:instrumentP5Source(source,name)});
    });
  }
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const resourceSnapshot=async()=>{
    const {metrics}=await cdp.send('Performance.getMetrics');
    const m=Object.fromEntries(metrics.map(row=>[row.name,row.value]));
    const r=await page.evaluate(()=>window.__PANDOLAB_VIEWER__?.rendererStats?.()||{});
    return {workers:page.workers().length,jsHeapUsedBytes:m.JSHeapUsedSize??null,
      jsHeapTotalBytes:m.JSHeapTotalSize??null,domNodes:m.Nodes??null,
      meshReuseCount:r.countryMeshReuseCount??null,meshRebuildCount:r.countryMeshRebuildCount??null,
      boundaryReuseCount:r.countryBoundaryReuseCount??null,
      boundaryPrepareCount:r.countryBoundaryPrepareCount??null,renderer:r.renderer??null};
  };
  const ready=month=>expect.poll(()=>page.evaluate(()=>({
    month:window.__PANDOLAB_VIEWER__?.builtinMonth?.().month,
    cursor:window.__PANDOLAB_VIEWER__?.documentState?.()?.timelineCursor,
    ready:document.querySelector('#viewerStatus')?.dataset.ready
  })),{timeout:100000}).toEqual({month,cursor:month,ready:'true'});
  let initialState,initialCamera,meta,failure=null;
  const snapshot=async month=>{
    const value=await page.evaluate(()=>({document:window.__PANDOLAB_VIEWER__.documentSnapshot(),
      state:window.__PANDOLAB_VIEWER__.documentState(),
      camera:window.__PANDOLAB_VIEWER__.p5CameraSnapshot()}));
    const hash=digest(semanticSnapshot(value.document));
    if(snapshots.has(month))expect(hash,'semantic source roundtrip '+month).toBe(snapshots.get(month));
    else snapshots.set(month,hash);
    if(initialCamera)expect(value.camera,'map view retained').toEqual(initialCamera);
    if(initialState)for(const key of ['dirty','canUndo','canRedo','documentDirty','presentationDirty'])
      expect(value.state[key],'unchanged '+key).toEqual(initialState[key]);
    return {sha256:hash,entityCount:value.document.territorialEntities.length,
      geometryCount:value.document.geometries.length};
  };
  const change=async(control,month,classification)=>{
    const before=await page.evaluate(()=>window.__PANDO_P0__.snapshot().active?.id??0);
    await page.locator('#'+control).click();
    await ready(month);
    const observed=await page.evaluate(()=>window.__PANDO_P0__.snapshot());
    expect(observed.errors).toEqual([]);
    expect(observed.active?.id).toBe(before+1);
    const events=observed.events.filter(row=>row.sampleId===observed.active.id);
    const started=events.filter(x=>x.kind==='requested'),presented=events.filter(x=>x.kind==='presented'),
      settled=events.filter(x=>x.kind==='settled');
    expect(started).toHaveLength(1);expect(presented).toHaveLength(1);expect(settled).toHaveLength(1);
    expect(started[0].origin).toBe('dom-input');
    const ms=presented[0].at-started[0].inputAt;
    const readyMs=settled[0].at-started[0].inputAt;
    expect(ms).toBeGreaterThanOrEqual(0);expect(readyMs).toBeGreaterThanOrEqual(ms);
    samples.push({month,classification,outcome:'success',ms,readyMs,
      ...p5Stages(events),resource:await resourceSnapshot(),semantic:await snapshot(month)});
  };
  try{
    await page.goto('/?debug=1');
    await ready('2026-10');
    initialState=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentState());
    initialCamera=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.p5CameraSnapshot());
    meta=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.p5BuildMeta());
    await snapshot('2026-10');
    await change('timelinePreviousYear','2025-12','first-adjacent');
    await change('timelineNextYear','2026-10','return-current');
    await change('timelinePreviousDecade','2016-12','first-distant');
    await change('timelineNextDecade','2026-10','return-from-distant');
    expect(errors).toEqual([]);
  }catch(error){failure=String(error?.stack||error);throw error;}
  finally{
    const observation=await observeWithDeadline(()=>page.evaluate(()=>window.__PANDO_P0__?.snapshot()??null));
    await observeWithDeadline(()=>cdp.detach());
    const report={
      schemaVersion:1,scope:'P5-1',outcome:failure?'failed':'passed',failure,
      codeRevision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
      dataPin:JSON.parse(await readFile(new URL('../../config/library-data.json',import.meta.url),'utf8')),
      sourceHashes:sources,buildMeta:meta,browser:browser.version(),node:process.version,
      platform:process.platform,observationStatus:observation.status,
      caveats:['Four transitions only: percentile estimates are not statistically reliable.',
        'DOM click to existing onPresented is not physical scanout.',
        'Async phases include queueing; nested intervals cannot be summed as independent CPU time.',
        'JS heap is not WASM or GPU memory; prefetch may run outside measured interval.',
        'Playwright route instrumentation disables HTTP caching; cache hit describes only session source cache.'],
      samples,summary:summarizeLatency(samples),pageErrors:errors,
      semanticHashes:Object.fromEntries(snapshots),
    };
    const path=info.outputPath('p5-1-timing.json');
    await writeFile(path,JSON.stringify(report,null,2));
    await info.attach('p5-1-timing',{path,contentType:'application/json'});
    for(const row of samples)console.log('P5_1_SAMPLE '+JSON.stringify({
      month:row.month,kind:row.classification,ms:Math.round(row.ms),
      readyMs:Math.round(row.readyMs),cache:row.cache,
      phases:Object.fromEntries(Object.entries(row.phases).map(([name,ms])=>[name,Math.round(ms)])),
      resource:row.resource,
    }));
    console.log('P5_1_SUMMARY '+JSON.stringify({outcome:report.outcome,revision:report.codeRevision,
      dataPin:report.dataPin,summary:report.summary,observation:observation.status,failure}));
  }
});
