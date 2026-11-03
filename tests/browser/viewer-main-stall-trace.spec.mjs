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
    try{new globalThis.PerformanceObserver(list=>{
      for(const event of list.getEntries())probe.longTasks.push({at:event.startTime,ms:event.duration});
    }).observe({type:'longtask',buffered:true});}catch(_){/* optional */}
    try{new globalThis.PerformanceObserver(list=>{
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
      "onPresented:()=>{commit();}",
      "onPresented:()=>{window.__MAIN_STALL_PROBE__.mark('presentation');commit();}");
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
  const glDetails=await page.evaluate(()=>{
    const canvas=document.getElementById('viewerCanvas'),gl=canvas?.getContext('webgl2');
    const info=gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      webglVersion:gl?.getParameter(gl.VERSION)??null,
      vendor:gl?.getParameter(gl.VENDOR)??null,
      renderer:gl?.getParameter(gl.RENDERER)??null,
      unmaskedRenderer:info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):null,
      unmaskedVendor:info?gl.getParameter(info.UNMASKED_VENDOR_WEBGL):null,
      attributes:gl?.getContextAttributes?.()??null,
      canvasSize:[canvas.width,canvas.height],dpr:globalThis.devicePixelRatio
    };
  });
  console.log('PANDO_GL_BACKEND '+JSON.stringify(glDetails));

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
    const obs=await page.evaluate(()=>{
      const p=globalThis.__MAIN_STALL_PROBE__;
      return {marks:p.marks.slice(),longTasks:p.longTasks.slice(),longFrames:p.longFrames.slice(),
        glCalls:p.glCalls.slice(),heartbeat:p.heartbeat.slice()};
    });
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
    expect(obs.marks.some(mark=>mark.name==='release-request'),'Transition release must be observed').toBe(true);
    expect(obs.marks.some(mark=>mark.name==='release-ack'),'Worker acknowledgement must be observed').toBe(true);
    expect(summary.trace.eventCount,'Chromium trace must contain renderer events').toBeGreaterThan(0);
    expect(errors,'No page crashes').toEqual([]);
    console.log('PANDO_MAIN_TRACE '+JSON.stringify({
      observation:{marks:obs.marks,largeTasks:obs.longTasks.filter(t=>t.ms>=300),longFrames:obs.longFrames.filter(f=>f.ms>=300),
        glSlow:obs.glCalls.slice(0,35),heartbeats:obs.heartbeat},
      trace:summary.trace
    }).slice(0,26000));
    summary.outcome='passed';
  }catch(error){summary.outcome='failed';summary.failure=String(error.stack||error);throw error;}
  finally{
    if(traceLive){try{await cdp.send('Tracing.end');}catch(_){/* trace may already be stopped */}}
    await mkdir('test-results/viewer-main-stall',{recursive:true});
    const filename='test-results/viewer-main-stall/summary.json';
    await writeFile(filename,JSON.stringify(summary,null,2));
    await info.attach('main-stall-trace-summary',{path:filename,contentType:'application/json'});
    await cdp.detach();
  }
});


test('Compare native compositor stall with the SVG and GPU canvas selectively hidden (diagnostic only)',async({page},info)=>{
  test.setTimeout(240000);
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    const p=globalThis.__LAYER_ABLATION__={events:[],longTasks:[],heartbeat:null,mark(name){
      this.events.push({name,at:performance.now()});
    },start(){
      const record={start:performance.now(),ticks:[]};
      record.timer=setInterval(()=>record.ticks.push(performance.now()),16);
      this.heartbeat=record;
    },end(){
      if(!this.heartbeat)return;
      clearInterval(this.heartbeat.timer);
      this.heartbeat.end=performance.now();
    }};
    try{new globalThis.PerformanceObserver(list=>{
      for(const entry of list.getEntries())p.longTasks.push({at:entry.startTime,ms:entry.duration});
    }).observe({type:'longtask',buffered:true});}catch(_){/* optional browser diagnostic */}
  });
  await page.route('**/modules/core-document-client.js*',async route=>{
    const response=await route.fetch();let source=await response.text();
    source=replaceOnce(source,'      const { result } = await rpc.request(operation, request, atomic || speculative',
      "      if(operation==='core.document-replacement-release'){window.__LAYER_ABLATION__.mark('release:start');window.__LAYER_ABLATION__.start();}"+
      '      const { result } = await rpc.request(operation, request, atomic || speculative');
    source=replaceOnce(source,'        ? { timeoutMs: 0 } : { signal: options.signal });',
      "        ? { timeoutMs: 0 } : { signal: options.signal });if(operation==='core.document-replacement-release'){window.__LAYER_ABLATION__.mark('release:end');window.__LAYER_ABLATION__.end();}");
    await route.fulfill({response,body:source});
  });
  await page.goto('/?debug=1&renderer=webgl2',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:100000});
  const currentMonth=await page.evaluate(()=>globalThis.__PANDOLAB_VIEWER__?.builtinMonth()?.month);
  expect(currentMonth).toMatch(/^\d{4}-\d{2}$/);
  const previousMonth=String(Number(currentMonth.slice(0,4))-1)+'-12';
  const scenarios=[
    {name:'baseline',hidden:[],button:'timelinePreviousYear',month:previousMonth},
    {name:'hide-label-svg',hidden:['viewerLabels'],button:'timelineNextYear',month:currentMonth},
    {name:'hide-gpu-canvas',hidden:['viewerCanvas'],button:'timelinePreviousYear',month:previousMonth},
    {name:'hide-both-map-surfaces',hidden:['viewerCanvas','viewerLabels'],button:'timelineNextYear',month:currentMonth},
    {name:'restored-baseline',hidden:[],button:'timelinePreviousYear',month:previousMonth},
  ];
  const observations=[];
  try{
    for(const scenario of scenarios){
      await page.evaluate(ids=>{
        let node=document.getElementById('pando-ablation-style');
        if(!node){node=document.createElement('style');node.id='pando-ablation-style';document.head.appendChild(node);}
        node.textContent=ids.map(id=>'#'+id+' {visibility:hidden !important}').join('\n');
        window.__LAYER_ABLATION__.events=[];
        window.__LAYER_ABLATION__.longTasks=[];
        window.__LAYER_ABLATION__.heartbeat=null;
      },scenario.hidden);
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const start=await page.evaluate(()=>performance.now());
      await page.locator('#'+scenario.button).click();
      await expect.poll(()=>page.evaluate(()=>({
        month:globalThis.__PANDOLAB_VIEWER__?.builtinMonth()?.month,
        cursor:globalThis.__PANDOLAB_VIEWER__?.documentState()?.timelineCursor,
        ready:document.querySelector('#viewerStatus')?.dataset.ready
      })),{timeout:90000}).toEqual({month:scenario.month,cursor:scenario.month,ready:'true'});
      const observation=await page.evaluate(since=>{
        const p=globalThis.__LAYER_ABLATION__;
        const start=p.events.find(e=>e.name==='release:start')?.at??null;
        const end=p.events.find(e=>e.name==='release:end')?.at??null;
        const tasks=p.longTasks.filter(e=>e.at>=since-50);
        const hb=p.heartbeat;
        const points=hb?[hb.start,...hb.ticks,hb.end]:[];
        return {
          releaseMs:start!==null&&end!==null?end-start:null,
          longTaskMaxMs:Math.max(0,...tasks.map(t=>t.ms)),
          longTasks:tasks.filter(t=>t.ms>100).slice(0,12),
          heartbeatTicks:hb?.ticks?.length??null,
          heartbeatLongestGapMs:points.length>1?Math.max(...points.slice(1).map((v,i)=>v-points[i])):null,
          labelsChildCount:document.getElementById('viewerLabels').querySelectorAll('*').length,
          canvasPixels:[document.getElementById('viewerCanvas').width,document.getElementById('viewerCanvas').height],
          visibleTerritorialCount:globalThis.__PANDOLAB_VIEWER__?.visibleTerritorialCount()
        };
      },start);
      const row={scenario:scenario.name,hidden:scenario.hidden,month:scenario.month,...observation};
      observations.push(row);
      console.log('PANDO_LAYER_ABLATION '+JSON.stringify(row));
      expect(row.releaseMs,'Each case must retain the real Core release handshake').not.toBe(null);
      expect(row.visibleTerritorialCount).toBeGreaterThan(0);
    }
    expect(errors).toEqual([]);
  }finally{
    await mkdir('test-results/viewer-main-stall',{recursive:true});
    const path='test-results/viewer-main-stall/ablation.json';
    await writeFile(path,JSON.stringify({observations,errors},null,2));
    await info.attach('viewer-surface-ablation',{path,contentType:'application/json'});
  }
});
