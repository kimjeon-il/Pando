import {test,expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {installMapBaselineCollector,semanticSnapshot,summarizeLatency,observeWithDeadline,replaceExactlyOnce}
  from '../helpers/map-transition-baseline.mjs';

test.use({timezoneId:'Asia/Seoul',locale:'ko-KR',viewport:{width:1280,height:800},trace:'off'});
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('P5-6 actual Viewer adopts native C++ year candidates and measures A-B-A parity',async({page,browser},info)=>{
  test.setTimeout(210000);
  await page.clock.setFixedTime(new Date('2026-10-31T00:00:00+09:00'));
  await page.addInitScript(installMapBaselineCollector);
  await page.addInitScript(()=>{globalThis.__P5_6_CORE_PHASES__=[];});
  const errors=[],samples=[],hashes=new Map();
  let initialState,initialCamera,failure;
  page.on('pageerror',error=>errors.push(String(error)));
  await page.route('**/modules/viewer-composition.js*',async route=>{
    const response=await route.fetch();let source=await response.text();
    const swap=(a,b)=>{source=replaceExactlyOnce(source,a,b);};
    swap('applyMonth:async(month,{isCurrent,commit})=>{',
      'applyMonth:async(month,{isCurrent,commit})=>{globalThis.__PANDO_P0__.begin(month);');
    swap("onPresented:()=>{commit();window.dispatchEvent(new CustomEvent('pandolab:project-changed'));}",
      "onPresented:()=>{commit();globalThis.__PANDO_P0__.presented(month);window.dispatchEvent(new CustomEvent('pandolab:project-changed'));}");
    swap("status.dataset.ready='true';","status.dataset.ready='true';globalThis.__PANDO_P0__.settled();");
    swap('productMode,documentState:',
      'p56Camera:()=>structuredClone({projection:map.viewState.projection,view:map.viewState.view}),productMode,documentState:');
    await route.fulfill({response,body:source});
  });
  await page.route('**/modules/core-document-client.js*',async route=>{
    const response=await route.fetch();let source=await response.text();
    source=replaceExactlyOnce(source,
      '      const { result } = await rpc.request(operation, request, atomic || speculative',
      '      const __p56Started=performance.now();const { result } = await rpc.request(operation, request, atomic || speculative');
    source=replaceExactlyOnce(source,
      '        ? { timeoutMs: 0 } : { signal: options.signal });',
      '        ? { timeoutMs: 0 } : { signal: options.signal });globalThis.__P5_6_CORE_PHASES__.push({operation,ms:performance.now()-__p56Started});');
    await route.fulfill({response,body:source});
  });
  const ready=month=>expect.poll(()=>page.evaluate(()=>({
    month:globalThis.__PANDOLAB_VIEWER__?.builtinMonth()?.month,
    cursor:globalThis.__PANDOLAB_VIEWER__?.documentState()?.timelineCursor,
    ready:document.querySelector('#viewerStatus')?.dataset.ready
  })),{timeout:100000}).toEqual({month,cursor:month,ready:'true'});
  const snapshot=async month=>{
    const value=await page.evaluate(()=>({
      document:globalThis.__PANDOLAB_VIEWER__.documentSnapshot(),
      state:globalThis.__PANDOLAB_VIEWER__.documentState(),
      camera:globalThis.__PANDOLAB_VIEWER__.p56Camera(),
      visible:globalThis.__PANDOLAB_VIEWER__.visibleTerritorialCount(),
      renderer:globalThis.__PANDOLAB_VIEWER__.rendererStats()
    }));
    const hash=digest(semanticSnapshot(value.document));
    if(hashes.has(month))expect(hash,'semantic A-B-A '+month).toEqual(hashes.get(month));
    else hashes.set(month,hash);
    if(initialCamera)expect(value.camera,'preserve globe camera').toEqual(initialCamera);
    if(initialState)for(const key of ['dirty','canUndo','canRedo','documentDirty','presentationDirty'])
      expect(value.state[key],'unchanged '+key).toEqual(initialState[key]);
    expect(value.visible).toBeGreaterThan(0);
    return {hash,visible:value.visible,meshReuses:value.renderer?.countryMeshReuseCount??null,
      boundaryReuses:value.renderer?.countryBoundaryReuseCount??null};
  };
  const move=async(button,month,kind)=>{
    const previous=await page.evaluate(()=>globalThis.__PANDO_P0__.snapshot().active?.id||0);
    const priorCore=await page.evaluate(()=>globalThis.__P5_6_CORE_PHASES__.length);
    await page.locator('#'+button).click();
    await ready(month);
    const probe=await page.evaluate(()=>globalThis.__PANDO_P0__.snapshot());
    expect(probe.errors).toEqual([]);
    expect(probe.active?.id).toBe(previous+1);
    const events=probe.events.filter(row=>row.sampleId===probe.active.id);
    const start=events.find(row=>row.kind==='requested'),presented=events.find(row=>row.kind==='presented');
    expect(start&&presented).toBeTruthy();
    const phases=await page.evaluate(index=>globalThis.__P5_6_CORE_PHASES__.slice(index),priorCore);
    for(const operation of ['core.document-temporal-source-prepare',
      'core.document-temporal-candidate-prepare','core.document-temporal-candidate-adopt'])
      expect(phases.filter(p=>p.operation===operation),operation).toHaveLength(1);
    expect(phases.some(p=>['core.storage-baseline-load','core.document-load-baseline'].includes(p.operation))).toBe(false);
    const row={month,kind,ms:presented.at-start.inputAt,readyMs:probe.events.find(e=>e.kind==='settled'&&e.sampleId===start.sampleId)?.at-start.inputAt,
      phases:phases.filter(p=>p.operation.includes('temporal-')),semantic:await snapshot(month)};
    samples.push(row);
    console.log('P5_6_SAMPLE '+JSON.stringify({month,kind,ms:Math.round(row.ms),
      phases:row.phases.map(p=>({op:p.operation,ms:Math.round(p.ms)}))}));
  };
  try{
    await page.goto('/?debug=1');await ready('2026-10');
    const original=await page.evaluate(()=>({
      state:globalThis.__PANDOLAB_VIEWER__.documentState(),
      camera:globalThis.__PANDOLAB_VIEWER__.p56Camera(),
    }));
    initialCamera=original.camera;initialState=original.state;
    await snapshot('2026-10');
    await move('timelinePreviousYear','2025-12','adjacent-first');
    await move('timelineNextYear','2026-10','adjacent-return');
    await move('timelinePreviousDecade','2016-12','distant-first');
    await move('timelineNextDecade','2026-10','distant-return');
    expect(errors).toEqual([]);
  } catch(error){failure=String(error?.stack||error);throw error;}
  finally{
    const probe=await observeWithDeadline(()=>page.evaluate(()=>({
      measurements:globalThis.__PANDO_P0__?.snapshot(),core:globalThis.__P5_6_CORE_PHASES__||[],
    })));
    const report={scope:'P5-6',revision:info.project.name,branch:'work/ui',outcome:failure?'failed':'passed',
      browser:browser.version(),node:process.version,method:'DOM click to existing onPresented; not GPU scanout',
      comparison:{P5_1_observed_2026_to_2025_ms:2946,P5_1_2025_to_2026_ms:2445,
        P5_1_2026_to_2016_ms:12281,P5_1_2016_to_2026_ms:11721},
      caveats:['One representative desktop CI sample per direction, not a statistically reliable p95.',
        'P5-1 baseline from a different source revision and CI run; observations are not causal proof.',
        'Application JS heap is not native/WASM/GPU total memory.',
        'Only exact same-month semantic A-B-A snapshots are compared, not full P5-7 native parity.'],
      samples,summary:summarizeLatency(samples.map(row=>({...row,outcome:'success'}))),
      hashes:Object.fromEntries(hashes),errors,failure,observation:probe.status,
    };
    const file=info.outputPath('p5-6-timing.json');
    await writeFile(file,JSON.stringify(report,null,2));
    await info.attach('p5-6-timing',{path:file,contentType:'application/json'});
    console.log('P5_6_SUMMARY '+JSON.stringify({outcome:report.outcome,summary:report.summary,
      comparison:report.comparison,failure}));
  }
});
