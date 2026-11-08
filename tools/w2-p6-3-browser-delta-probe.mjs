/* global document, TextEncoder, crypto, PerformanceObserver, createImageBitmap, atob, Blob */
import {execFileSync} from 'node:child_process';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium,expect} from '@playwright/test';
import {prepareLibraryData} from "./data/library-runtime.mjs";
import {injectBoundaryDeltaWorker} from './w2-p6-3-worker-bridge.mjs';
import {createBoundaryDeltaSender} from './w2-p6-3-boundary-delta-sender.mjs';

const PIN='fe8282ba32761ab9586348d1712e11cc1f4e7882';
const DATA='5eb7be55208efaafe39bd5a65ec2f111d70b9053';
const RUNTIME='data-f50b7f480c812df6f5ea0c40f5461ab0';
const root=resolve(process.cwd()),sourceRoot=resolve(root,process.env.PANDOLAB_P6_PINNED_SOURCE||'.w2-p6-fixed');
const output=resolve(root,process.env.PANDOLAB_P6_OUTPUT||'test-results/w2-p6-3'),port=Number(process.env.PANDOLAB_P6_PORT||4253);
const git=(dir,...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8'}).trim();
const ensure=(value,message)=>{if(!value)throw Error(message);};
ensure(git(sourceRoot,'rev-parse','HEAD')===PIN,'P6-3 exact source mismatch');
ensure(JSON.parse(readFileSync(join(sourceRoot,'config/library-data.json'))).revision===DATA,
  'P6-3 source/library pin mismatch');
mkdirSync(output,{recursive:true});
const prepared=prepareLibraryData({root});
ensure(prepared.revision===DATA,'P6-3 materialized data mismatch');
const importFromFixed=async path=>import(pathToFileURL(join(sourceRoot,path)).href);
const {buildFrontendSnapshot}=await importFromFixed('scripts/lib/frontend-build.mjs');
const {developmentAssets}=await importFromFixed('scripts/frontend-dev-server.mjs');
const {createP3PreviewServer}=await importFromFixed('scripts/p3-preview-server.mjs');
const canonicalModule="import {geometryReferenceFor as __p6CoreGeometryRef} from './geometry-version-store.js';\n"+
  "globalThis.__P6GeometryReferenceFor=__p6CoreGeometryRef;\n";
const forceAnchor='    function syncCountryBoundaryScene() {';
const forceHook="    globalThis.__P6ForceCountryBoundary=()=>{countryBoundaryDependencies=null;"+
  "prepareCountrySharedBoundary({replace:true,baselineCache:false});return countryBoundaryRequestId;};\n";
async function build(mode){
  const readSourceBytes=path=>{
    let bytes=readFileSync(resolve(sourceRoot,path));
    if(path==='shared/frontend/js/modules/gpu-map-renderer.js'){
      let text=bytes.toString('utf8');
      ensure(text.split(forceAnchor).length===2,'P6-3 forced boundary probe anchor moved');
      text=canonicalModule+text.replace(forceAnchor,forceHook+forceAnchor);
      bytes=Buffer.from(text);
    }
    return bytes;
  };
  const snapshot=await buildFrontendSnapshot({root:sourceRoot,sourceCommit:PIN,
    readPinnedData:path=>readFileSync(resolve(prepared.materialized,path)),
    dataPaths:Object.keys(prepared.files).filter(path=>path.startsWith('assets/data/')),
    readSourceBytes,
    workerSourceTransform:(name,script)=>mode==='B'&&name.endsWith('/country-shared-boundary-worker.js')
      ?injectBoundaryDeltaWorker(script):script,
  });
  ensure(snapshot.sourceCommit===PIN&&snapshot.dataRevision===RUNTIME,
    'P6-3 built snapshot source/data mismatch');
  const {assets}=await developmentAssets({repository:sourceRoot,product:'viewer',prepared,snapshot});
  for(const [name,asset]of snapshot.assets)if(snapshot.viewerPaths.has(name))assets.set(name,{bytes:asset.bytes});
  return {assets,sourceSha256:snapshot.sourceSha256,codeSha256:snapshot.buildMeta?.workerAssets?.['assets/js/workers/country-shared-boundary-worker.js']?.sha256||{}};
}
const builds={A:await build('A'),B:await build('B')};
let active=builds.A.assets;
const server=createP3PreviewServer(sourceRoot,{assets:()=>active,reports:false});
await new Promise((done,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',done);});

function installProbe(mode){
  const Native=globalThis.Worker;
  const state=globalThis.__P6D={mode,requests:[],replies:[],packet:null,samples:[],errors:[],clickAt:0,
    longTasks:[],projectionKnown:false,sendModes:[],payloads:[],nativeRoundTrip:[]};
  new PerformanceObserver(list=>{
    for(const entry of list.getEntries())state.longTasks.push({at:entry.startTime,ms:entry.duration});
  }).observe({type:'longtask',buffered:true});
  document.addEventListener('click',event=>{
    if(event.target.closest?.('#timelinePreviousYear'))state.clickAt=performance.now();
  },true);
  globalThis.Worker=class P6Worker extends Native{
    constructor(url,options){
      super(url,options);
      this.p6Boundary=options?.name==='pandolab-country-shared-boundary';
      if(!this.p6Boundary)return;
      const actualSend=(payload,transfer)=>{
        const at=performance.now();
        const result=Native.prototype.postMessage.call(this,payload,transfer);
        const elapsedMs=performance.now()-at;
        state.requests.push({requestId:payload?.requestId,generation:payload?.projectGeneration,
          geometryRevision:payload?.geometryRevision,quality:payload?.quality,
          type:payload?.type,rows:payload?.features?.length||0,
          reused:payload?.features?.filter?.(row=>row.mode==='reuse')?.length||0,
          transferCallMs:elapsedMs});
        if(state.payloads.length<12)state.payloads.push(payload);
        return result;
      };
      this.p6Sender=state.mode==='B'?globalThis.__P6CreateDeltaSender({
        sendNative:actualSend,
        geometryReferenceFor:geometry=>globalThis.__P6GeometryReferenceFor?.(geometry)||null,
        onSample:detail=>state.samples.push(detail),
      }):null;
      this.addEventListener('message',event=>{
        const data=event.data;
        this.p6Sender?.receive(data);
        if(data?.type==='prepared'){
          state.replies.push({requestId:data.requestId,generation:data.projectGeneration,
            quality:data.quality,cacheHit:data.packetCacheHit,hasBaseToken:!!data.p6BaseToken});
          state.packet={requestId:data.requestId,packet:data.packet};
        }
      });
      this.p6Send=actualSend;
    }
    postMessage(data,transfer){
      if(!this.p6Boundary||!data||!['replace','patch'].includes(data.type)
        ||!Array.isArray(data.features))return super.postMessage(data,transfer);
      const started=performance.now();
      const value=this.p6Sender?this.p6Sender.send(data,transfer):this.p6Send(data,transfer);
      state.sendModes.push({requestId:data.requestId,mode:this.p6Sender?'B':'A',
        elapsedMs:performance.now()-started});
      return value;
    }
  };
}

async function canvasSha(page){
  const picture=await page.locator('#viewerCanvas').screenshot({animations:'disabled',
    style:'body * {visibility:hidden!important} #viewerCanvas {visibility:visible!important}'});
  return page.evaluate(async b64=>{
    const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
    const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
    const canvas=document.createElement('canvas');
    canvas.width=bitmap.width;canvas.height=bitmap.height;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0);bitmap.close();
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
    const digest=await crypto.subtle.digest('SHA-256',pixels.data);
    return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
  },picture.toString('base64'));
}
async function semantic(page){
  return page.evaluate(async()=>{
    const viewer=globalThis.__PANDOLAB_VIEWER__,d=viewer.documentSnapshot();
    const labels=[...document.querySelectorAll('svg text')].map(e=>[
      e.textContent,e.getAttribute('x'),e.getAttribute('y'),e.parentElement?.getAttribute('transform')]).sort();
    const value={entities:d.territorialEntities,geometries:d.geometries,timeline:d.timelineRecords,
      labels,paths:[...document.querySelectorAll('#viewerLabels path')].map(e=>e.getAttribute('d')).sort()};
    const bytes=new TextEncoder().encode(JSON.stringify(value));
    const digest=await crypto.subtle.digest('SHA-256',bytes);
    const stats=viewer.rendererStats();
    return{sha:[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join(''),
      month:viewer.builtinMonth().month,cursor:viewer.documentState().timelineCursor,
      generation:stats.projectGeneration,boundaryReady:stats.countrySharedBoundaryReady,
      ready:document.querySelector('#viewerStatus')?.dataset.ready};
  });
}
async function packetDigest(page){
  return page.evaluate(async()=>{
    const current=globalThis.__P6D.packet;
    if(!current)return null;
    const arrays=[];
    const meta=JSON.stringify(current.packet,(key,value)=>{
      if(ArrayBuffer.isView(value)){
        const index=arrays.push(value)-1;
        return{kind:value.constructor.name,index,bytes:value.byteLength};
      }
      return value;
    });
    const dig=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
      .map(x=>x.toString(16).padStart(2,'0')).join('');
    const hashes=[];
    for(const arr of arrays)hashes.push(await dig(new Uint8Array(
      arr.buffer,arr.byteOffset,arr.byteLength)));
    return{requestId:current.requestId,sha:await dig(new TextEncoder().encode(JSON.stringify({meta,hashes}))),
      arrays:arrays.length,bytes:arrays.reduce((n,x)=>n+x.byteLength,0)};
  });
}
async function payloadSizes(page){
  return page.evaluate(()=>{
    const encoder=new TextEncoder(),samples=[];
    for(const message of globalThis.__P6D.payloads){
      // Off the timed phase: serialization only after presentation and force.
      samples.push({type:message.type,requestId:message.requestId,
        features:message.features?.length||0,
        reuse:message.features?.filter?.(x=>x.mode==='reuse')?.length||0,
        bytes:encoder.encode(JSON.stringify(message)).byteLength});
    }
    return samples;
  });
}

async function run(mode,index){
  active=(mode==='B'?builds.B:builds.A).assets;
  const result={mode,index,status:'pending',snapshotSha256:(mode==='B'?builds.B:builds.A).sourceSha256};
  let browser,context,page;
  try{
    browser=await chromium.launch({headless:true,args:process.platform==='linux'
      ?['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox']
      :['--use-angle=d3d11']});
    result.browser=browser.version();
    context=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:1,
      locale:'ko-KR',timezoneId:'Asia/Seoul',reducedMotion:'reduce'});
    const install='globalThis.__P6CreateDeltaSender='+createBoundaryDeltaSender.toString()+
      ';('+installProbe.toString()+')('+JSON.stringify(mode)+');';
    await context.addInitScript({content:install});
    page=await context.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(String(error)));
    await page.clock.setFixedTime(new Date(2026,10,2,12));
    await page.goto('http://127.0.0.1:'+port+'/?debug=1&renderer=webgl2',{waitUntil:'domcontentloaded',
      timeout:120000});
    await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:150000});
    await expect.poll(()=>page.evaluate(()=>globalThis.__P6D?.replies?.some(row=>row.generation===1&&
      row.quality==='canonical')),{timeout:150000}).toBe(true);
    result.initial=await semantic(page);
    const provenance=await page.evaluate(()=>{
      const feature=globalThis.__P6D?.payloads?.find(row=>row.features?.length===254);
      if(!feature)return null;
      const byId=feature.features.map(row=>({
        id:row.id,canonical:!!globalThis.__P6GeometryReferenceFor?.(row.geometry),
        frozen:Object.isFrozen(row.geometry)&&Object.isFrozen(row.geometry?.coordinates)}));
      return {count:byId.length,branded:byId.filter(row=>row.canonical).length,
        frozen:byId.filter(row=>row.frozen).length};
    });
    result.provenance=provenance;
    // Natural year transition: the renderer may legally reuse the old border
    // without sending any Worker input. Do not force a request here.
    await page.locator('#timelinePreviousYear').click();
    await expect.poll(()=>page.evaluate(()=>({
      month:globalThis.__PANDOLAB_VIEWER__?.builtinMonth().month,
      cursor:globalThis.__PANDOLAB_VIEWER__?.documentState().timelineCursor,
      ready:document.querySelector('#viewerStatus')?.dataset.ready,
    })),{timeout:150000}).toEqual({month:'2025-12',cursor:'2025-12',ready:'true'});
    result.after=await semantic(page);
    result.canvas=await canvasSha(page);
    result.beforeForced=await page.evaluate(()=>({
      requested:globalThis.__P6D.requests.length,
      replies:globalThis.__P6D.replies.length,
      clickAt:globalThis.__P6D.clickAt,
    }));
    // Explicit same-generation test-only full-boundary request. Its timing is
    // NOT a natural historical year-switch timing and is analyzed separately.
    const ticket=await page.evaluate(()=>globalThis.__P6ForceCountryBoundary());
    await expect.poll(()=>page.evaluate(id=>globalThis.__P6D.replies.some(row=>row.requestId===id),ticket),
      {timeout:150000}).toBe(true);
    await expect.poll(()=>page.evaluate(()=>globalThis.__PANDOLAB_VIEWER__?.rendererStats()?.countrySharedBoundaryReady),
      {timeout:120000}).toBe(true);
    result.force={ticket,packet:await packetDigest(page),payloads:await payloadSizes(page)};
    result.force.state=await semantic(page);
    result.probe=await page.evaluate(()=>({
      requests:globalThis.__P6D.requests,
      replies:globalThis.__P6D.replies,
      samples:globalThis.__P6D.samples,
      longTaskMax:Math.max(0,...globalThis.__P6D.longTasks.map(row=>row.ms)),
    }));
    ensure(result.probe.replies.some(row=>row.requestId===ticket),
      'Forced boundary message was never processed');
    ensure(result.after.ready==='true' && result.after.month==='2025-12' &&
      result.force.state.month==='2025-12','Date or frame changed during full/delta probe');
    ensure(errors.length===0,'Browser errors: '+errors.join(' | '));
    result.status='passed';
    console.log('W2P6_P3_BROWSER '+JSON.stringify({
      mode,index,status:'passed',provenance:result.provenance,
      forcedRequests:result.probe.requests.filter(x=>x.requestId===ticket),
      latestPacket:result.force.packet,bytes:result.force.payloads.map(x=>({
        id:x.requestId,type:x.type,reuse:x.reuse,bytes:x.bytes})),
      semantic:result.after.sha,canvas:result.canvas,
    }));
  }catch(error){result.status='failed';result.failure=String(error.stack||error);}
  finally{
    await context?.close();await browser?.close();
    writeFileSync(join(output,'w2-p6-3-'+mode+'-'+index+'.json'),
      JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  }
  return result;
}
const repetitions=Number(process.env.PANDOLAB_P6_REPETITIONS||1);
ensure(Number.isInteger(repetitions)&&repetitions>=1&&repetitions<=3,'Invalid P6-3 pilot repetition count');
const report={
  schema:'pando-w2-p6-3-immutable-worker-reference-prototype-v1',
  pins:{source:PIN,library:DATA,runtime:RUNTIME,
    baselineSnapshotSha256:builds.A.sourceSha256,
    deltaSnapshotSha256:builds.B.sourceSha256},
  samples:[],status:'pending',
  limits:['Linux Chromium is not GTX1650 D3D11',
    'Forced requests are isolated functional transport probes, not natural user transitions',
    'n=1 per condition cannot establish end-to-end speed improvements',
    'Worker geometry references require verified branded frozen Core geometry identity'],
};
try{
  for(const mode of ['A','B','A2'])for(let index=0;index<repetitions;index++){
    const caseResult=await run(mode,index);
    report.samples.push(caseResult);
    if(caseResult.status!=='passed')throw Error('P6-3 '+mode+'-'+index+' '+caseResult.failure);
  }
  const first=report.samples[0];
  ensure(report.samples.every(x=>x.after.sha===first.after.sha&&x.canvas===first.canvas),
    'Viewer country/label/timeline/pixel parity failed');
  ensure(report.samples.every(x=>x.force.packet.sha===first.force.packet.sha),
    'Forced shared-boundary C++ packet digest mismatch');
  report.summary={samples:report.samples.length,
    semantic:first.after.sha,canvas:first.canvas,packet:first.force.packet.sha,
    provenance:report.samples.map(x=>({mode:x.mode,...x.provenance})),
    forced:report.samples.map(x=>({mode:x.mode,replies:x.probe.replies.length,
      payload:x.force.payloads.at(-1),lastRequest:x.probe.requests.at(-1)})),
    note:'Functional prototype only; cannot attribute natural year-switch improvements.'};
  report.status='passed';
  console.log('W2P6_P3_FINAL '+JSON.stringify(report.summary));
}catch(error){report.status='failed';report.failure=String(error.stack||error);
  console.error('W2P6_P3_FAILED '+report.failure);
}finally{
  await new Promise(done=>server.close(done));
  writeFileSync(join(output,'w2-p6-3-experiment.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
}
if(report.status!=='passed')process.exitCode=1;
