import {test,expect} from '@playwright/test';

test.use({viewport:{width:1280,height:800},trace:'off'});

test('P2-4 one accepted year switch loads physical resources once and preserves map/search state',async({page})=>{
  test.setTimeout(145000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.clock.setFixedTime(new Date(2026,9,31,12));
  await page.addInitScript(()=>{
    window.__P24_COUNTS__={land:0,physical:0,updates:0};
  });
  await page.route('**/modules/viewer-map.js*',async route=>{
    const response=await route.fetch(),source=await response.text();
    const publicPorts='loadPhysicalResources:physicalResources.loadPhysicalData,loadPhysicalLandMask:physicalResources.loadPhysicalLandMask,';
    const update='async function update() {';
    if(source.split(publicPorts).length!==2||source.split(update).length!==2)
      throw Error('P2-4 viewer-map instrumentation port changed.');
    await route.fulfill({response,body:source.replace(update,
      update+'\n    window.__P24_COUNTS__.updates++;').replace(publicPorts,
      "loadPhysicalResources:(...args)=>{window.__P24_COUNTS__.physical++;return physicalResources.loadPhysicalData(...args);},"+
      "loadPhysicalLandMask:(...args)=>{window.__P24_COUNTS__.land++;return physicalResources.loadPhysicalLandMask(...args);},")});
  });
  await page.goto('/?debug=1');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:100000});
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__?.visibleTerritorialCount())).toBeGreaterThan(0);
  const initial=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot());
  const expected={land:1,physical:1,updates:2};
  for(const month of ['2025-12','2026-10']){
    await page.evaluate(()=>{window.__P24_COUNTS__={land:0,physical:0,updates:0};});
    const button=month==='2025-12'?'#timelinePreviousYear':'#timelineNextYear';
    await page.locator(button).click();
    await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.builtinMonth().month),
      {timeout:80000}).toBe(month);
    await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true');
    await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.visibleTerritorialCount())).toBeGreaterThan(0);
    // The post-presentation handler has had a chance to run. Do not sleep.
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const counts=await page.evaluate(()=>({...window.__P24_COUNTS__}));
    console.log('P2_4_TRANSITION_COUNTS '+JSON.stringify({month,...counts}));
    expect(counts,{message:'A completed map already fetched physical land and resources in setSession'}).toEqual(expected);
    const cursor=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentState().timelineCursor);
    expect(cursor).toBe(month);
  }
  const restored=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot());
  expect(restored.territorialEntities.map(x=>x.id).sort()).toEqual(initial.territorialEntities.map(x=>x.id).sort());
  await page.locator('#objectSearchBtn').click();
  await page.locator('#objectSearchInput').fill('대한민국');
  await expect(page.locator('#objectSearchResults button').first()).toBeVisible({timeout:20000});
  expect(errors).toEqual([]);
});


test('P2-4 diagnose bounded source misses and post-present readiness without changing runtime code', async ({page},info)=>{
  test.setTimeout(240000);
  await page.clock.setFixedTime(new Date(2026,9,31,12));
  await page.addInitScript(()=>{
    window.__P2_COST__={events:[],mark(name,detail={}){
      this.events.push({name,at:performance.now(),...detail});
    }};
  });
  const swap=(source,old,next)=>{
    const first=source.indexOf(old);
    if(first<0||source.indexOf(old,first+old.length)!==-1)throw Error('Profiling anchor changed: '+old.slice(0,85));
    return source.slice(0,first)+next+source.slice(first+old.length);
  };
  await page.route('**/modules/viewer-composition.js*',async route=>{
    const response=await route.fetch();let source=await response.text();
    source=swap(source,"onPresented:()=>{commit();window.dispatchEvent(new CustomEvent('pandolab:project-changed'));}",
      "onPresented:()=>{window.__P2_COST__.mark('presented');commit();window.dispatchEvent(new CustomEvent('pandolab:project-changed'));}");
    source=swap(source,"if(!await projectDomain.open(reader,options)){firstMap.cancel();return false;}",
      "const __p2Opened=await projectDomain.open(reader,options);window.__P2_COST__.mark('domain.open:end');if(!__p2Opened){firstMap.cancel();return false;}");
    source=swap(source,"await map.objectCatalog.pruneLayerItemVisibility();\n    await map.update();",
      "window.__P2_COST__.mark('post-prune:start');await map.objectCatalog.pruneLayerItemVisibility();window.__P2_COST__.mark('post-prune:end');window.__P2_COST__.mark('post-update:start');await map.update();window.__P2_COST__.mark('post-update:end');");
    source=swap(source,"status.dataset.ready='true';","status.dataset.ready='true';window.__P2_COST__.mark('ready');");
    source=swap(source,"productMode,documentState:","p2SourceCache:()=>owners.builtinSession.sourceCacheStats(),productMode,documentState:");
    await route.fulfill({response,body:source});
  });
  await page.route('**/modules/builtin-session.js*',async route=>{
    const response=await route.fetch();let source=await response.text();
    source=swap(source,"let record=cachedBytesFor(month,identity,{background});",
      "let record=cachedBytesFor(month,identity,{background});window.__P2_COST__.mark('source:lookup',{month,hit:!!record,cache:sourceCacheStats()});");
    source=swap(source,"record={bytes,fingerprint};\n      rememberSource(month,identity,record,epoch,{background});",
      "record={bytes,fingerprint};const __p2Stored=rememberSource(month,identity,record,epoch,{background});window.__P2_COST__.mark('source:store',{month,bytes:bytes.byteLength,stored:__p2Stored,cache:sourceCacheStats()});");
    await route.fulfill({response,body:source});
  });
  await page.route('**/modules/project-domain.js*',async route=>{
    const response=await route.fetch();let source=await response.text();
    source=swap(source,"const result = await replaceSnapshot(reason === 'new' ? null : documentModel.snapshot(), {",
      "window.__P2_COST__.mark('replaceSnapshot:start');const result = await replaceSnapshot(reason === 'new' ? null : documentModel.snapshot(), {");
    source=swap(source,"if (result === false) throw new Error('Project replacement was rejected.');",
      "window.__P2_COST__.mark('replaceSnapshot:end');if (result === false) throw new Error('Project replacement was rejected.');");
    source=swap(source,"try { if(checkpoint)await commandOwner.releaseReplacement(checkpoint.replacementId); }",
      "try { window.__P2_COST__.mark('release:start');if(checkpoint)await commandOwner.releaseReplacement(checkpoint.replacementId);window.__P2_COST__.mark('release:end'); }");
    await route.fulfill({response,body:source});
  });
  await page.route('**/modules/object-catalog.js*',async route=>{
    const response=await route.fetch();let source=await response.text();
    source=swap(source,"if (!catalogAlreadyAdmitted) await dependencies.domains.projectDomain.admitPresentationCatalog(presentationCatalog());",
      "if (!catalogAlreadyAdmitted){window.__P2_COST__.mark('catalog:start');await dependencies.domains.projectDomain.admitPresentationCatalog(presentationCatalog());window.__P2_COST__.mark('catalog:end');}");
    source=swap(source,"dependencies.projectSession.pruneViewingItems(presentationCatalog());",
      "window.__P2_COST__.mark('view-prune:start');dependencies.projectSession.pruneViewingItems(presentationCatalog());window.__P2_COST__.mark('view-prune:end');");
    source=swap(source,"await dependencies.domains.selectionDomain.prune(null,{ reason:'prune-invalid-selection' });",
      "window.__P2_COST__.mark('selection-prune:start');await dependencies.domains.selectionDomain.prune(null,{ reason:'prune-invalid-selection' });window.__P2_COST__.mark('selection-prune:end');");
    await route.fulfill({response,body:source});
  });
  await page.route('**/modules/viewer-map.js*',async route=>{
    const response=await route.fetch();let source=await response.text();
    source=swap(source,"async function update() {",
      "async function update() {window.__P2_COST__.mark('map.update:start');");
    source=swap(source,"if(generation===updateGeneration)schedule();",
      "if(generation===updateGeneration)schedule();window.__P2_COST__.mark('map.update:end');");
    await route.fulfill({response,body:source});
  });
  await page.route('**/modules/core-document-client.js*',async route=>{
    const response=await route.fetch();let source=await response.text();
    source=swap(source,"const { result } = await rpc.request(operation, request, atomic || speculative",
      "const __p2RpcStart=performance.now();const { result } = await rpc.request(operation, request, atomic || speculative");
    source=swap(source,"? { timeoutMs: 0 } : { signal: options.signal });",
      "? { timeoutMs: 0 } : { signal: options.signal });window.__P2_COST__.mark('rpc:done',{operation,elapsedMs:performance.now()-__p2RpcStart});");
    await route.fulfill({response,body:source});
  });
  // Read-only diagnostic instrumentation of the real Core Worker entry.
  await page.route('**/modules/core-document-runtime.js*',async route=>{
    const response=await route.fetch();let source=await response.text();
    source=swap(source,"  function call(method, args, context, projectResult = result => result) {\n    const result = queue.then(async () => {","  function call(method, args, context, projectResult = result => result) {\n    const __p2QueuedAt=performance.now();\n    const result = queue.then(async () => {\n      const __p2DequeuedAt=performance.now();");
    source=swap(source,"      return projectResult(core[method](...(typeof args === 'function' ? args() : args)),core);","      if(method==='releaseReplacement'){\n        const __p2NativeStarted=performance.now();\n        const __p2Return=core[method](...(typeof args === 'function' ? args() : args));\n        const __p2NativeEnded=performance.now();\n        const __p2Project=projectResult(__p2Return,core);\n        console.info('P2_WORKER_RELEASE '+JSON.stringify({\n          queuedMs:__p2DequeuedAt-__p2QueuedAt,\n          sessionMs:__p2NativeStarted-__p2DequeuedAt,\n          nativeMs:__p2NativeEnded-__p2NativeStarted,\n          projectedMs:performance.now()-__p2NativeEnded,\n          released:__p2Return,\n        }));\n        return __p2Project;\n      }\n      return projectResult(core[method](...(typeof args === 'function' ? args() : args)),core);");
    await route.fulfill({response,body:source});
  });
  const pageErrors=[],consoleErrors=[],failedRequests=[],nativeRelease=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  page.on('console',message=>{
    const str=message.text();
    if(message.type()==='error')consoleErrors.push(str);
    if(str.startsWith('P2_WORKER_RELEASE ')){
      try{nativeRelease.push(JSON.parse(str.slice('P2_WORKER_RELEASE '.length)));}
      catch(error){consoleErrors.push('Bad native timing payload '+error.message);}
    }
  });
  page.on('requestfailed',request=>failedRequests.push({url:request.url(),error:request.failure()?.errorText}));
  await page.goto('/?debug=1&renderer=webgl2');
  await page.waitForFunction(()=>{
    const e=document.querySelector('#viewerStatus');
    return e?.dataset.ready==='true'||e?.getAttribute('role')==='alert';
  },null,{timeout:95000});
  const boot=await page.evaluate(()=>{
    const node=document.querySelector('#viewerStatus');
    return {ready:node?.dataset.ready,role:node?.getAttribute('role'),text:node?.textContent,
      diagnostics:globalThis.__PANDOLAB_VIEWER__?.diagnostics?.()??null,
      status:globalThis.__PANDOLAB_VIEWER__?.documentState?.()??null};
  });
  if(boot.ready!=='true')throw Error('P2 diagnostic startup failure: '+JSON.stringify({boot,pageErrors,consoleErrors,failedRequests}).slice(0,12000));
  const results=[];
  for(const [button,target] of [['timelinePreviousYear','2025-12'],['timelineNextYear','2026-10']]){
    await page.evaluate(()=>{window.__P2_COST__.events=[];});
    await page.locator('#'+button).click();
    await expect.poll(()=>page.evaluate(()=>({
      month:window.__PANDOLAB_VIEWER__?.builtinMonth().month,
      ready:document.querySelector('#viewerStatus')?.dataset.ready,
    })),{timeout:100000}).toEqual({month:target,ready:'true'});
    const result=await page.evaluate(()=>{
      const events=window.__P2_COST__.events.slice(),cache=window.__PANDOLAB_VIEWER__.p2SourceCache();
      const at=name=>events.find(e=>e.name===name)?.at??null;
      const elapsed=(first,last)=>at(first)==null||at(last)==null?null:Math.round(at(last)-at(first));
      const spans={
        presentToReady:elapsed('presented','ready'),
        presentedToDomainOpen:elapsed('presented','domain.open:end'),
        release:elapsed('release:start','release:end'),
        postPrune:elapsed('post-prune:start','post-prune:end'),
        presentationCatalog:elapsed('catalog:start','catalog:end'),
        viewPrune:elapsed('view-prune:start','view-prune:end'),
        selectionPrune:elapsed('selection-prune:start','selection-prune:end'),
        postUpdate:elapsed('post-update:start','post-update:end'),
      };
      return {spans,cache,events:events.map(e=>({...e,at:Math.round(e.at)}))};
    });
    expect(result.spans.presentToReady).not.toBe(null);
    expect(result.spans.postPrune).not.toBe(null);
    expect(result.spans.postUpdate).not.toBe(null);
    results.push({target,...result});
    console.log('P2_COST_DIAG '+JSON.stringify({target,spans:result.spans,source:result.events.filter(e=>e.name.startsWith('source:')),rpc:result.events.filter(e=>e.name==='rpc:done'),cache:result.cache}).slice(0,14000));
  }
  expect(pageErrors).toEqual([]);
  console.log('P2_WORKER_DIAG '+JSON.stringify({nativeRelease,consoleErrors}));
  expect(nativeRelease.length,'Worker-side native release should be timed for both transitions').toBeGreaterThanOrEqual(2);
  await info.attach('post-ready-cache-diagnostic',{body:JSON.stringify({results,pageErrors,nativeRelease,consoleErrors},null,2),contentType:'application/json'});
});
