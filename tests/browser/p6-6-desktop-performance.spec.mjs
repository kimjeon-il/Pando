import {test,expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {installMapBaselineCollector,replaceExactlyOnce,semanticSnapshot,summarizeLatency}
  from '../helpers/map-transition-baseline.mjs';

test.use({timezoneId:'Asia/Seoul',locale:'ko-KR',viewport:{width:1280,height:800},trace:'off'});
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const summarizeField=(rows,key)=>summarizeLatency(rows.map(row=>({
  outcome:row.outcome,ms:row[key]??null,
})));

test('P6-6 desktop transition performance uses the P0 presentation boundary with 20 repeat samples',async({page,browser},info)=>{
  test.setTimeout(600000);
  await page.clock.setFixedTime(new Date('2026-10-31T00:00:00+09:00'));
  await page.addInitScript(installMapBaselineCollector);
  await page.addInitScript(()=>{globalThis.__P6_6_CORE_PHASES__=[];});

  const errors=[],samples=[],semanticHashes=new Map();
  let initialCamera=null,initialState=null,failure=null,buildMeta=null;

  page.on('pageerror',error=>errors.push(String(error.stack||error)));

  await page.route('**/modules/viewer-composition.js*',async route=>{
    const response=await route.fetch();let source=await response.text();
    const swap=(a,b)=>{source=replaceExactlyOnce(source,a,b);};
    swap('applyMonth:async(month,{isCurrent,commit})=>{',
      'applyMonth:async(month,{isCurrent,commit})=>{globalThis.__PANDO_P0__.begin(month);');
    swap("onPresented:()=>{commit();window.dispatchEvent(new CustomEvent('pandolab:project-changed'));}",
      "onPresented:()=>{commit();globalThis.__PANDO_P0__.presented(month);window.dispatchEvent(new CustomEvent('pandolab:project-changed'));}");
    swap("status.dataset.ready='true';",
      "status.dataset.ready='true';globalThis.__PANDO_P0__.settled();");
    swap('diagnostics:diagnostics.snapshot,rendererStats:()=>map.renderer.getStats(),visibleTerritorialCount:',
      'diagnostics:diagnostics.snapshot,rendererStats:()=>map.renderer.getStats(),p66Camera:()=>structuredClone({projection:map.viewState.projection,view:map.viewState.view}),p66BuildMeta:()=>runtimeContext.meta,p66SourceCacheStats:()=>owners.builtinSession.sourceCacheStats(),visibleTerritorialCount:');
    await route.fulfill({response,body:source});
  });

  await page.route('**/modules/viewer-post-presentation.js*',async route=>{
    const response=await route.fetch();let source=await response.text();
    source=replaceExactlyOnce(source,'try{await hydrate(current);}',
      "try{globalThis.__PANDO_P0__?.mark('post-hydrate:start');await hydrate(current);globalThis.__PANDO_P0__?.mark('post-hydrate:end');}");
    source=replaceExactlyOnce(source,'try{await refresh();}',
      "try{globalThis.__PANDO_P0__?.mark('post-search:start');await refresh();globalThis.__PANDO_P0__?.mark('post-search:end');globalThis.__PANDO_P0__?.mark('post-settled');}");
    await route.fulfill({response,body:source});
  });

  await page.route('**/modules/core-document-client.js*',async route=>{
    const response=await route.fetch();let source=await response.text();
    source=replaceExactlyOnce(source,
      '      const { result } = await rpc.request(operation, request, atomic || speculative',
      '      const __p66Started=performance.now();const { result } = await rpc.request(operation, request, atomic || speculative');
    source=replaceExactlyOnce(source,
      '        ? { timeoutMs: 0 } : { signal: options.signal });',
      "        ? { timeoutMs: 0 } : { signal: options.signal });if(operation.includes('temporal-'))globalThis.__P6_6_CORE_PHASES__.push({operation,ms:performance.now()-__p66Started});");
    await route.fulfill({response,body:source});
  });

  const ready=month=>expect.poll(()=>page.evaluate(()=>({
    month:globalThis.__PANDOLAB_VIEWER__?.builtinMonth()?.month??null,
    cursor:globalThis.__PANDOLAB_VIEWER__?.documentState()?.timelineCursor??null,
    ready:document.querySelector('#viewerStatus')?.dataset.ready??null,
  })),{timeout:90000,intervals:[150,300,600]}).toEqual({month,cursor:month,ready:'true'});

  const postSettled=async id=>expect.poll(()=>page.evaluate(sampleId=>
    globalThis.__PANDO_P0__?.snapshot()?.events?.some(row=>row.sampleId===sampleId&&row.kind==='post-settled')??false,id),
    {timeout:90000,intervals:[100,250,500]}).toBe(true);

  const capture=async month=>{
    const value=await page.evaluate(()=>({
      document:globalThis.__PANDOLAB_VIEWER__.documentSnapshot(),
      state:globalThis.__PANDOLAB_VIEWER__.documentState(),
      camera:globalThis.__PANDOLAB_VIEWER__.p66Camera(),
      visible:globalThis.__PANDOLAB_VIEWER__.visibleTerritorialCount(),
    }));
    const hash=digest(semanticSnapshot(value.document));
    if(semanticHashes.has(month))expect(hash,'semantic round-trip '+month).toBe(semanticHashes.get(month));
    else semanticHashes.set(month,hash);
    expect(value.camera).toEqual(initialCamera);
    for(const key of ['dirty','canUndo','canRedo','documentDirty','presentationDirty'])
      expect(value.state[key],key).toEqual(initialState[key]);
    expect(value.visible).toBeGreaterThan(0);
    return hash;
  };

  const transition=async(control,month,classification)=>{
    const beforeId=await page.evaluate(()=>globalThis.__PANDO_P0__.snapshot().active?.id??0);
    const coreStart=await page.evaluate(()=>globalThis.__P6_6_CORE_PHASES__.length);
    await page.locator('#'+control).click();
    await ready(month);
    const probe=await page.evaluate(()=>globalThis.__PANDO_P0__.snapshot());
    expect(probe.errors).toEqual([]);
    const id=probe.active?.id;
    expect(id).toBe(beforeId+1);
    await postSettled(id);
    const completeProbe=await page.evaluate(()=>globalThis.__PANDO_P0__.snapshot());
    const events=completeProbe.events.filter(row=>row.sampleId===id);
    const requested=events.find(row=>row.kind==='requested');
    const presented=events.find(row=>row.kind==='presented');
    const settled=events.find(row=>row.kind==='settled');
    const post=events.find(row=>row.kind==='post-settled');
    expect(requested&&presented&&settled&&post).toBeTruthy();
    expect(requested.origin).toBe('dom-input');
    expect(presented.at).toBeGreaterThanOrEqual(requested.inputAt);
    expect(settled.at).toBeGreaterThanOrEqual(presented.at);
    expect(post.at).toBeGreaterThanOrEqual(settled.at);
    const phases=await page.evaluate(index=>globalThis.__P6_6_CORE_PHASES__.slice(index),coreStart);
    const row={id,control,month,classification,outcome:'success',
      presentMs:presented.at-requested.inputAt,
      readyMs:settled.at-requested.inputAt,
      searchMs:post.at-requested.inputAt,
      temporalCorePhases:phases,
      semanticSha256:await capture(month)};
    samples.push(row);
    console.log('P6_6_SAMPLE '+JSON.stringify({classification,month,presentMs:Math.round(row.presentMs),
      readyMs:Math.round(row.readyMs),searchMs:Math.round(row.searchMs),
      core:phases.map(p=>({op:p.operation,ms:Math.round(p.ms)}))}));
    return row;
  };

  const report={schema:'pando-p6-6-desktop-v1',scope:'P6-6',profile:{name:'desktop',width:1280,height:800},
    fixedClock:'2026-10-31T00:00:00+09:00',
    p0Reference:{presentP50Ms:1546,presentP95Ms:1604,postReadyP50Ms:3420,
      note:'Historical P0 desktop observation; different code revision/CI run, not causal proof.'},
    timing:{
      present:'captured DOM input to existing temporal onPresented callback; not hardware scanout',
      ready:'captured DOM input to viewerStatus data-ready=true after accepted map update',
      search:'captured DOM input to optional post-presentation hydrate+search completion',
    },
    limitations:['Playwright module routing disables browser HTTP cache; repeat means same-page application reuse.',
      'Semantic hash checks run outside measured intervals but may influence later garbage collection.',
      'One CI run with 20 repeat observations is not physical desktop hardware.',
      'Current source revision differs from P0; compare directionally, not as isolated causal attribution.'],
    samples,errors};

  try{
    await page.goto('/?debug=1&renderer=webgl2',{waitUntil:'domcontentloaded'});
    await ready('2026-10');
    const initial=await page.evaluate(()=>({
      camera:globalThis.__PANDOLAB_VIEWER__.p66Camera(),
      state:globalThis.__PANDOLAB_VIEWER__.documentState(),
      buildMeta:globalThis.__PANDOLAB_VIEWER__.p66BuildMeta(),
      sourceCache:globalThis.__PANDOLAB_VIEWER__.p66SourceCacheStats(),
    }));
    initialCamera=initial.camera;initialState=initial.state;buildMeta=initial.buildMeta;
    await capture('2026-10');

    await transition('timelinePreviousYear','2025-12','first-adjacent');
    await transition('timelinePreviousDecade','2015-12','first-distant');
    await transition('timelineNextDecade','2025-12','distant-return');
    await transition('timelineNextYear','2026-10','adjacent-return');

    for(let i=0;i<10;i++){
      await transition('timelinePreviousYear','2025-12','repeat');
      await transition('timelineNextYear','2026-10','repeat');
    }

    expect(errors).toEqual([]);
    report.outcome='passed';
  }catch(error){failure=String(error.stack||error);report.outcome='failed';report.failure=failure;throw error;}
  finally{
    const repeat=samples.filter(row=>row.classification==='repeat');
    const summary={
      present:summarizeField(repeat,'presentMs'),
      ready:summarizeField(repeat,'readyMs'),
      search:summarizeField(repeat,'searchMs'),
    };
    const firsts=Object.fromEntries(samples.filter(row=>row.classification!=='repeat')
      .map(row=>[row.classification,{presentMs:row.presentMs,readyMs:row.readyMs,searchMs:row.searchMs}]));
    report.codeRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
    report.dataPin=JSON.parse(await readFile(new URL('../../config/library-data.json',import.meta.url),'utf8'));
    report.buildMeta=buildMeta;
    report.browser=browser.version();report.node=process.version;report.platform=process.platform;
    report.repeatCount=repeat.length;report.summary=summary;report.firsts=firsts;
    try{
      report.finalSourceCache=await page.evaluate(()=>globalThis.__PANDOLAB_VIEWER__?.p66SourceCacheStats?.()??null);
      report.finalRenderer=await page.evaluate(()=>globalThis.__PANDOLAB_VIEWER__?.rendererStats?.()??null);
    }catch(error){report.finalObservationError=String(error);}
    report.failure=failure;
    await mkdir('test-results/p6-6-desktop',{recursive:true});
    const path='test-results/p6-6-desktop/measurement.json';
    await writeFile(path,JSON.stringify(report,null,2));
    await info.attach('p6-6-desktop-measurement',{path,contentType:'application/json'});
    console.log('P6_6_RESULT '+JSON.stringify({outcome:report.outcome,codeRevision:report.codeRevision,
      repeatCount:report.repeatCount,summary,firsts,sourceCache:report.finalSourceCache,failure}));
  }
});
