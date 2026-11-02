import {test,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';

test.use({timezoneId:'Asia/Seoul',locale:'ko-KR',viewport:{width:1280,height:800},trace:'off'});
const replaceOnce=(source,find,replacement)=>{
  if(source.split(find).length!==2)throw new Error('Main-stall probe source contract changed: '+find.slice(0,100));
  return source.replace(find,replacement);
};

test('Trace Chromium renderer thread during accepted year frame and delayed Worker acknowledgement',async({page},info)=>{
  test.setTimeout(210000);
  const errors=[],consoleErrors=[];
  page.on('pageerror',e=>errors.push(String(e.stack||e)));
  page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
  await page.addInitScript(()=>{
    const clock=()=>performance.now();
    const probe=globalThis.__MAIN_STALL_PROBE__={
      marks:[],longTasks:[],longFrames:[],glCalls:[],heartbeat:[],heartbeatActive:null,
      mark(name,details={}){this.marks.push({name,at:clock(),...details});},
      startHeartbeat(){
        const sample={at:clock(),ticks:[]};
        const timer=setInterval(()=>sample.ticks.push(clock()),16);
        this.heartbeatActive={timer,sample};
      },
      stopHeartbeat(){
        const active=this.heartbeatActive;
        if(!active)return;
        clearInterval(active.timer);
        this.heartbeatActive=null;
        const ends=[active.sample.at,...active.sample.ticks,clock()];
        this.heartbeat.push({durationMs:ends.at(-1)-ends[0],ticks:active.sample.ticks.length,
          longestGapMs:Math.max(...ends.slice(1).map((v,i)=>v-ends[i]))});
      }
    };
    try{new PerformanceObserver(list=>{
      for(const event of list.getEntries())probe.longTasks.push({at:event.startTime,ms:event.duration});
    }).observe({type:'longtask',buffered:true});}catch(_){/* optional */}
    try{new PerformanceObserver(list=>{
      for(const event of list.getEntries())if(event.duration>100)
        probe.longFrames.push({at:event.startTime,ms:event.duration,blockingMs:event.blockingDuration,
          scripts:(event.scripts||[]).map(s=>({source:s.sourceURL,fn:s.sourceFunctionName,
            at:s.startTime,ms:s.duration,invoker:s.invoker})).slice(0,20)});
    }).observe({type:'long-animation-frame',buffered:true});}catch(_){/* optional */}
    for(const ctor of [globalThis.WebGLRenderingContext,globalThis.WebGL2RenderingContext]){
      if(!ctor?.prototype)continue;
      for(const name of ['readPixels','texImage2D','texSubImage2D','bufferData','bufferSubData',
        'drawElements','drawArrays','blitFramebuffer','deleteTexture','deleteBuffer',
        'finish','flush','getError','getParameter','checkFramebufferStatus',
        'compileShader','linkProgram','getProgramParameter','getShaderParameter']){
        const descriptor=Object.getOwnPropertyDescriptor(ctor.prototype,name);
        if(typeof descriptor?.value!=='function'||!descriptor.configurable)continue;
        Object.defineProperty(ctor.prototype,name,{...descriptor,value:function(...args){
          if(!probe.heartbeatActive)return descriptor.value.apply(this,args);
          const start=clock();
          try{return descriptor.value.apply(this,args);}
          finally{
            const ms=clock()-start;
            if(ms>=10)probe.glCalls.push({name,ms,at:start,args:args.map(v=>typeof v==='number'?v:typeof v)});
          }
        }});
      }
    }
  });
  await page.route('**/modules/viewer-composition.js*',async route=>{
    const response=await route.fetch();let source=await response.text();
    source=replaceOnce(source,
      "onPresented:()=>{commit();window.dispatchEvent(new CustomEvent('pandolab:project-changed'));}",
      "onPresented:()=>{window.__MAIN_STALL_PROBE__.mark('presentation');commit();window.dispatchEvent(new CustomEvent('pandolab:project-changed'));}");
    source=replaceOnce(source,"status.dataset.ready='true';",
      "status.dataset.ready='true';window.__MAIN_STALL_PROBE__.mark('ready');");
    await route.fulfill({response,body:source});
  });
  await page.route('**/modules/core-document-client.js*',async route=>{
    const response=await route.fetch();let source=await response.text();
    source=replaceOnce(source,'      const { result } = await rpc.request(operation, request, atomic || speculative',
      "      if(operation==='core.document-replacement-release'){window.__MAIN_STALL_PROBE__.mark('release-request');window.__MAIN_STALL_PROBE__.startHeartbeat();console.timeStamp('PANDO_RELEASE_REQUEST');}"+
      '      const { result } = await rpc.request(operation, request, atomic || speculative');
    source=replaceOnce(source,'        ? { timeoutMs: 0 } : { signal: options.signal });',
      "        ? { timeoutMs: 0 } : { signal: options.signal });if(operation==='core.document-replacement-release'){window.__MAIN_STALL_PROBE__.stopHeartbeat();window.__MAIN_STALL_PROBE__.mark('release-ack');console.timeStamp('PANDO_RELEASE_ACK');}");
    await route.fulfill({response,body:source});
  });
  await page.goto('/?debug=1&renderer=webgl2',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:100000});
  const initial=await page.evaluate(()=>globalThis.__PANDOLAB_VIEWER__?.builtinMonth()?.month);
  expect(initial).toMatch(/^\d{4}-\d{2}$/);
  const earlier=String(Number(initial.slice(0,4))-1)+'-12';

  const cdp=await page.context().newCDPSession(page);
  let traceLive=false;
  let summary={schema:'pando-main-thread-trace-v1',initial,earlier,errors,consoleErrors};
  try {
    const categories='toplevel,devtools.timeline,disabled-by-default-devtools.timeline,v8,blink,blink.user_timing,cc,renderer.scheduler';
    await cdp.send('Tracing.start',{categories,transferMode:'ReturnAsStream'});
    traceLive=true;
    await page.locator('#timelinePreviousYear').click();
    await expect.poll(()=>page.evaluate(()=>({
      month:globalThis.__PANDOLAB_VIEWER__?.builtinMonth()?.month,
      cursor:globalThis.__PANDOLAB_VIEWER__?.documentState()?.timelineCursor,
      ready:document.querySelector('#viewerStatus')?.dataset.ready
    })),{timeout:100000}).toEqual({month:earlier,cursor:earlier,ready:'true'});
    const obs=await page.evaluate(()=>structuredClone(globalThis.__MAIN_STALL_PROBE__));
    summary.observation=obs;
    const completed=new Promise((resolve,reject)=>{
      cdp.once('Tracing.tracingComplete',resolve);
      cdp.once('Tracing.dataLossOccurred',()=>reject(new Error('Chrome lost tracing events')));
    });
    await cdp.send('Tracing.end');traceLive=false;
    const result=await completed;
    if(!result.stream)throw new Error('Chrome trace stream missing');
    let parts=[],bytes=0;
    for(let i=0;i<600;i++){
      const chunk=await cdp.send('IO.read',{handle:result.stream,size:8388608});
      const data=chunk.base64Encoded?Buffer.from(chunk.data,'base64').toString('utf8'):chunk.data;
      parts.push(data);bytes+=Buffer.byteLength(data,'utf8');
      if(bytes>90*1024*1024)throw new Error('Chrome trace >90MiB; avoid retaining oversized diagnostic');
      if(chunk.eof)break;
    }
    await cdp.send('IO.close',{handle:result.stream});
    const decoded=JSON.parse(parts.join(''));parts=[];
    const events=decoded.traceEvents||[];
    const threadNames=new Map();
    for(const event of events){
      if(event.ph==='M'&&event.name==='thread_name')
        threadNames.set(String(event.pid)+':'+event.tid,event.args?.name||'');
    }
    const label=event=>threadNames.get(String(event.pid)+':'+event.tid)||'unknown-thread';
    const allLong=events.filter(e=>e.ph==='X'&&e.dur>=50000);
    const mainEvents=allLong.filter(e=>/RendererMain|CrRendererMain|CrRendererMain|MainThread/i.test(label(e)));
    const take=arr=>arr.sort((a,b)=>b.dur-a.dur).slice(0,35).map(e=>({
      name:e.name,thread:label(e),ms:e.dur/1000,ts:e.ts,
      cat:e.cat,detail:e.args?.data?.url||e.args?.data?.name||null
    }));
    const longest=mainEvents.length?mainEvents:allLong;
    const top=take([...longest]);
    const longTask=longest.find(e=>e.dur>=1000000);
    const children=longTask?events.filter(e=>
      e.ph==='X'&&e.pid===longTask.pid&&e.tid===longTask.tid&&
      e.ts>=longTask.ts&&e.ts+e.dur<=longTask.ts+longTask.dur && e!==longTask):[];
    summary.trace={
      bytes,eventCount:events.length,threads:[...threadNames.entries()].filter(x=>/Main|Renderer|Compositor|Gpu|IO/i.test(x[1])).slice(0,35),
      topMain:top,
      longTask:longTask?{name:longTask.name,thread:label(longTask),ms:longTask.dur/1000,ts:longTask.ts}:null,
      longTaskChildren:take(children),
      namedEvents:events.filter(e=>(/TimeStamp|PANDO_RELEASE/i).test(e.name||'')).slice(0,20).map(e=>({name:e.name,ts:e.ts,thread:label(e),args:e.args}))
    };
    expect(obs.longTasks.some(t=>t.ms>900),'Baseline 2s stall should reproduce under tracing').toBeTruthy();
    expect(errors,'No page crashes').toEqual([]);
    console.log('PANDO_MAIN_TRACE '+JSON.stringify({
      observation:{marks:obs.marks,largeTasks:obs.longTasks.filter(t=>t.ms>=300),longFrames:obs.longFrames.filter(f=>f.ms>=300),
        glSlow:obs.glCalls.slice(0,35),heartbeats:obs.heartbeat},
      trace:summary.trace
    }).slice(0,26000));
    summary.outcome='passed';
  }catch(error){summary.outcome='failed';summary.failure=String(error.stack||error);throw error;}
  finally{
    if(traceLive){try{await cdp.send('Tracing.end');}catch(_){}}
    await mkdir('test-results/viewer-main-stall',{recursive:true});
    const filename='test-results/viewer-main-stall/summary.json';
    await writeFile(filename,JSON.stringify(summary,null,2));
    await info.attach('main-stall-trace-summary',{path:filename,contentType:'application/json'});
    await cdp.detach();
  }
});
