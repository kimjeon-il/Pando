import {test,expect} from '@playwright/test';
import {writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';

test.use({timezoneId:'Asia/Seoul',locale:'ko-KR',viewport:{width:1280,height:800},trace:'off'});

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('instrumented WASM measures replacement_.reset() in real year navigation',async({page,browser},info)=>{
  test.setTimeout(300000);
  const resetNs=[],nativeCallMs=[],rpcMs=[],errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{
    const text=message.text();
    const reset=text.match(/PANDO_RESET_PROBE_NS\s+([0-9]+)/);
    if(reset)resetNs.push(Number(reset[1]));
    const worker=text.match(/PANDO_RESET_NATIVE_CALL_MS\s+([0-9.]+)/);
    if(worker)nativeCallMs.push(Number(worker[1]));
    const main=text.match(/PANDO_RESET_RPC_MS\s+([0-9.]+)/);
    if(main)rpcMs.push(Number(main[1]));
  });
  const replaceOne=(source,oldValue,newValue)=>{
    if(source.split(oldValue).length!==2)throw new Error('Release benchmark source contract changed: '+oldValue.slice(0,75));
    return source.replace(oldValue,newValue);
  };
  // Worker-side call timing is independent of main-thread message delivery.
  await page.route('**/modules/core-document-runtime.js*',async route=>{
    const response=await route.fetch();
    let source=await response.text();
    source=replaceOne(source,
      '      return projectResult(core[method](...(typeof args === \'function\' ? args() : args)),core);',
      '      if(method===\'releaseReplacement\'){const started=performance.now();' +
      'const accepted=core[method](...(typeof args===\'function\' ? args() : args));' +
      'console.info(\'PANDO_RESET_NATIVE_CALL_MS \'+(performance.now()-started));' +
      'return projectResult(accepted,core);}' +
      'return projectResult(core[method](...(typeof args === \'function\' ? args() : args)),core);');
    await route.fulfill({response,body:source});
  });
  // Measure the full browser -> Worker -> browser round trip separately.
  await page.route('**/modules/core-document-client.js*',async route=>{
    const response=await route.fetch();
    let source=await response.text();
    source=replaceOne(source,
      '      const { result } = await rpc.request(operation, request, atomic || speculative',
      '      const __resetRpcStart=performance.now();const { result } = await rpc.request(operation, request, atomic || speculative');
    source=replaceOne(source,
      '        ? { timeoutMs: 0 } : { signal: options.signal });',
      '        ? { timeoutMs: 0 } : { signal: options.signal });' +
      'if(operation===\'core.document-replacement-release\')' +
      'console.info(\'PANDO_RESET_RPC_MS \'+(performance.now()-__resetRpcStart));');
    await route.fulfill({response,body:source});
  });
  const results=[];
  const report={schema:'pando-reset-probe-v1',codeRevision:info.project.name,
    browser:browser.version(),measurement:'steady_clock immediately around C++ replacement_.reset(), within instrumented CI-only WASM build',
    results,errors,limitations:[
      'Injected instrumentation is diagnostic and not deployed.',
      'Browser round trip includes main-thread scheduling and is not C++ execution time.',
      'Same-page Chromium CI observation; not a physical mobile hardware benchmark.'
    ]};
  try{
    await page.goto('/?debug=1&renderer=webgl2',{waitUntil:'domcontentloaded'});
    await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:100000});
    await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__?.visibleTerritorialCount()||0)).toBeGreaterThan(0);
    const currentMonth=await page.evaluate(()=>window.__PANDOLAB_VIEWER__?.builtinMonth()?.month);
    expect(currentMonth).toMatch(/^\d{4}-\d{2}$/);
    const previousMonth=String(Number(currentMonth.slice(0,4))-1)+'-12';
    const hashes=new Map();
    async function saveSemantic(month){
      const snapshot=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot());
      const hash=digest({
        documentId:snapshot.documentId,
        initialMonth:snapshot.projectSetup.initialMonth,
        entities:snapshot.territorialEntities.map(x=>({id:x.id,properties:x.properties})),
        geometryBindings:snapshot.timelineRecords.geometryBindings,
      });
      if(hashes.has(month))expect(hash,'unchanged semantic map '+month).toBe(hashes.get(month));
      else hashes.set(month,hash);
      return hash;
    }
    for(let i=0;i<4;i++){
      const target=i%2===0?previousMonth:currentMonth;
      const button=i%2===0?'#timelinePreviousYear':'#timelineNextYear';
      const before={reset:resetNs.length,native:nativeCallMs.length,rpc:rpcMs.length};
      await page.locator(button).click();
      await expect.poll(()=>page.evaluate(()=>({
        month:window.__PANDOLAB_VIEWER__?.builtinMonth()?.month??null,
        cursor:window.__PANDOLAB_VIEWER__?.documentState()?.timelineCursor??null,
        ready:document.querySelector('#viewerStatus')?.dataset.ready??null
      })),{timeout:90000}).toEqual({month:target,cursor:target,ready:'true'});
      await expect.poll(()=>resetNs.length,{timeout:15000}).toBeGreaterThan(before.reset);
      await expect.poll(()=>nativeCallMs.length,{timeout:15000}).toBeGreaterThan(before.native);
      await expect.poll(()=>rpcMs.length,{timeout:15000}).toBeGreaterThan(before.rpc);
      const result={i,month:target,resetMs:resetNs.at(-1)/1e6,
        nativeCallMs:nativeCallMs.at(-1),rpcMs:rpcMs.at(-1),
        semanticHash:await saveSemantic(target)};
      expect(result.resetMs).toBeGreaterThanOrEqual(0);
      expect(result.resetMs).toBeLessThanOrEqual(result.nativeCallMs+1);
      results.push(result);
      console.log('PANDO_RESET_RESULT '+JSON.stringify(result));
    }
    expect(errors).toEqual([]);
    report.outcome='passed';
  }catch(error){
    report.outcome='failed';report.failure=String(error?.stack||error);
    throw error;
  }finally{
    report.resetNs=[...resetNs];report.nativeCallMs=[...nativeCallMs];
    report.rpcMs=[...rpcMs];
    if(results.length){
      const reset=results.map(row=>row.resetMs).sort((a,b)=>a-b);
      report.summary={samples:reset.length,minMs:reset[0],
        maxMs:reset.at(-1),medianMs:reset[Math.floor((reset.length-1)/2)]};
    }
    await mkdir('test-results/replacement-reset',{recursive:true});
    const filename='test-results/replacement-reset/measurement.json';
    await writeFile(filename,JSON.stringify(report,null,2));
    await info.attach('replacement-reset-timing',{path:filename,contentType:'application/json'});
    console.log('PANDO_RESET_SUMMARY '+JSON.stringify({
      outcome:report.outcome,summary:report.summary,
      results:report.results,errors:report.errors,failure:report.failure
    }));
  }
});
