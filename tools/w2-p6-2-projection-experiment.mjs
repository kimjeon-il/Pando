/* global Worker, TextEncoder, crypto, document, requestAnimationFrame, PerformanceObserver, createImageBitmap, atob, Blob */
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium,expect} from '@playwright/test';
import {projectCountryBoundaryMessage} from './w2-p6-2-project-country-feature.mjs';
import {prepareLibraryData} from './library-data.mjs';

const PIN='fe8282ba32761ab9586348d1712e11cc1f4e7882';
const DATA='5eb7be55208efaafe39bd5a65ec2f111d70b9053';
const RUNTIME='data-f50b7f480c812df6f5ea0c40f5461ab0';
const root=resolve(process.cwd());
const sourceRoot=resolve(root,process.env.PANDOLAB_P6_PINNED_SOURCE||'.w2-p6-fixed');
const output=resolve(root,process.env.PANDOLAB_P6_OUTPUT||'test-results/w2-p6-2');
const port=Number(process.env.PANDOLAB_P6_PORT||4252);
const git=(dir,...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8'}).trim();
const assert=(yes,message)=>{if(!yes)throw Error(message);};
assert(git(sourceRoot,'rev-parse','HEAD')===PIN,'Unexpected P6-0 pinned source');
const config=JSON.parse(readFileSync(join(root,'config/library-data.json')));
const pinnedConfig=JSON.parse(readFileSync(join(sourceRoot,'config/library-data.json')));
assert(config.revision===DATA&&pinnedConfig.revision===DATA,'Library revision must remain identical');
assert(Number.isInteger(port)&&port>1024&&port<65536,'Invalid port');
mkdirSync(output,{recursive:true});
const prepared=prepareLibraryData({root});
assert(prepared.revision===DATA,'Materialized data revision mismatch');
const fixedImport=async path=>import(pathToFileURL(join(sourceRoot,path)).href);
const {buildFrontendSnapshot}=await fixedImport('scripts/lib/frontend-build.mjs');
const snapshot=await buildFrontendSnapshot({
  root:sourceRoot,sourceCommit:PIN,
  readPinnedData:path=>readFileSync(resolve(prepared.materialized,path)),
  dataPaths:Object.keys(prepared.files).filter(path=>path.startsWith('assets/data/')),
  readSourceBytes:path=>readFileSync(resolve(sourceRoot,path)),
});
assert(snapshot.sourceCommit===PIN&&snapshot.dataRevision===RUNTIME,
  'Built snapshot source/data identity changed');
const {developmentAssets}=await fixedImport('scripts/frontend-dev-server.mjs');
const {createP3PreviewServer}=await fixedImport('scripts/p3-preview-server.mjs');
const {assets}=await developmentAssets({repository:sourceRoot,product:'viewer',prepared,snapshot});
for(const [name,asset] of snapshot.assets)if(snapshot.viewerPaths.has(name))assets.set(name,{bytes:asset.bytes});
const server=createP3PreviewServer(sourceRoot,{assets:()=>assets,reports:false});
await new Promise((done,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',done);});

const reps=Number(process.env.PANDOLAB_P6_REPETITIONS||2);
assert(Number.isInteger(reps)&&reps>=1&&reps<=3,'P6-2 repetitions must be 1..3');
function installBrowserProbe(mode){
  const NativeWorker=globalThis.Worker;
  const probe=globalThis.__P6_2={mode,original:null,url:null,sent:[],clickAt:null,presentedAt:null,
    longTasks:[],workerResponses:[],metaProjectionMessages:0};
  new PerformanceObserver(list=>{
    for(const task of list.getEntries())probe.longTasks.push({startMs:task.startTime,durationMs:task.duration});
  }).observe({type:'longtask',buffered:true});
  document.addEventListener('click',event=>{
    if(event.target.closest?.('#timelinePreviousYear'))probe.clickAt=performance.now();
  },true);
  globalThis.addEventListener('pandolab:project-changed',()=>{
    if(probe.clickAt!==null&&probe.presentedAt===null &&
       globalThis.__PANDOLAB_VIEWER__?.builtinMonth()?.month==='2025-12')
      probe.presentedAt=performance.now();
  });
  globalThis.Worker=class P6MeasuredWorker extends NativeWorker {
    constructor(url,options){
      super(url,options);
      if(options?.name==='pandolab-country-shared-boundary')probe.url=String(url);
    }
    postMessage(data,...rest){
      if(!data||!['replace','patch'].includes(data.type) ||
         !Object.hasOwn(data,'includeOutlines') || !Array.isArray(data.features))
        return super.postMessage(data,...rest);
      if(data.features.length===254&&!probe.original)probe.original=data;
      const actual=probe.mode==='B'?projectCountryBoundaryMessage(data):data;
      const started=performance.now();
      const result=super.postMessage(actual,...rest);
      const elapsedMs=performance.now()-started;
      if(probe.sent.length<20)probe.sent.push({
        generation:data.projectGeneration,requestId:data.requestId,
        featureCount:data.features.length,mode:probe.mode,elapsedMs,
        projected:actual!==data,removedCount:data.removedIds?.length||0,
        type:data.type,quality:data.quality,
      });
      if(actual!==data)probe.metaProjectionMessages++;
      return result;
    }
  };
}
async function pageState(page){
  return page.evaluate(async()=>{
    const viewer=globalThis.__PANDOLAB_VIEWER__;
    const d=viewer.documentSnapshot();
    const labels=[...document.querySelectorAll('svg text')].map(item=>[
      item.textContent,item.getAttribute('x'),item.getAttribute('y'),
      item.parentElement?.getAttribute('transform')]).sort();
    const body={entities:d.territorialEntities,geometries:d.geometries,
      timeline:d.timelineRecords,labels,
      paths:[...document.querySelectorAll('#viewerLabels path')].map(x=>x.getAttribute('d')).sort()};
    const hash=async value=>[...new Uint8Array(await crypto.subtle.digest(
      'SHA-256',new TextEncoder().encode(JSON.stringify(value))))]
      .map(x=>x.toString(16).padStart(2,'0')).join('');
    const stats=viewer.rendererStats();
    return {hash:await hash(body),month:viewer.builtinMonth().month,
      cursor:viewer.documentState().timelineCursor,ready:document.querySelector('#viewerStatus')?.dataset.ready,
      canonical:stats.canonicalMeshReady,
      boundaryReady:stats.countrySharedBoundaryReady,
      countryCount:Array.isArray(d.territorialEntities)?d.territorialEntities.length:null,
      labels:labels.length,projectGeneration:stats.projectGeneration,
      reused:stats.countryBoundaryReuseCount??null};
  });
}
async function pixelHash(page,picture){
  return page.evaluate(async base64=>{
    const bytes=Uint8Array.from(atob(base64),ch=>ch.charCodeAt(0));
    const image=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
    const canvas=document.createElement('canvas');
    canvas.width=image.width;canvas.height=image.height;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(image,0,0);image.close();
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    const hash=await crypto.subtle.digest('SHA-256',
      new Uint8Array(pixels.buffer,pixels.byteOffset,pixels.byteLength));
    return {size:[canvas.width,canvas.height],
      sha256:[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')};
  },picture.toString('base64'));
}
async function runCase(mode,index){
  let browser,context;
  const row={mode,index,status:'pending'};
  try{
    browser=await chromium.launch({headless:true,args:process.platform==='linux'
      ?['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox']
      :['--use-angle=d3d11']});
    row.browserVersion=browser.version();
    context=await browser.newContext({viewport:{width:1280,height:800},
      deviceScaleFactor:1,locale:'ko-KR',timezoneId:'Asia/Seoul',reducedMotion:'reduce'});
    const init='globalThis.projectCountryBoundaryMessage='+projectCountryBoundaryMessage.toString()+
      ';('+installBrowserProbe.toString()+')('+JSON.stringify(mode)+');';
    await context.addInitScript({content:init});
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(String(error)));
    await page.clock.setFixedTime(new Date(2026,10,2,12,0,0));
    await page.goto('http://127.0.0.1:'+port+'/?debug=1&renderer=webgl2',
      {waitUntil:'domcontentloaded',timeout:120000});
    await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:180000});
    await expect.poll(()=>page.evaluate(()=>!!globalThis.__P6_2.original &&
      globalThis.__P6_2.original.features.length===254),{timeout:180000}).toBe(true);
    row.meta=await page.evaluate(()=>globalThis.PANDOLAB_BUILD_META);
    assert(row.meta.sourceCommit===PIN&&row.meta.dataRevision===RUNTIME,'P6-2 source/data mismatch');
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    row.initial=await pageState(page);
    assert(row.initial.month==='2026-11'&&row.initial.cursor==='2026-11'
      &&row.initial.ready==='true'&&row.initial.boundaryReady,'Initial map not ready');
    // Entire geometry count and JSON sizes are compared ONLY after the map is
    // ready, never in the critical path around postMessage or a year click.
    row.offPath=await page.evaluate(()=>{
      const source=globalThis.__P6_2.original;
      const projected=projectCountryBoundaryMessage(source);
      const encoder=new TextEncoder();
      const bytes=obj=>encoder.encode(JSON.stringify(obj)).byteLength;
      const normal=bytes(source),compact=bytes(projected);
      const normalProps=source.features.reduce((v,f)=>v+bytes(f.properties),0);
      const compactProps=projected.features.reduce((v,f)=>v+bytes(f.properties),0);
      const fields=[...new Set(source.features.flatMap(feature=>Object.keys(feature)))];
      const nested=[...new Set(source.features.flatMap(feature=>Object.keys(feature.properties||{})))];
      const unchangedCoords=source.features.every((feature,i)=>
        feature.geometry===projected.features[i].geometry);
      return {normalBytes:normal,compactBytes:compact,savedBytes:normal-compact,
        savedPercent:100*(normal-compact)/normal,normalPropertyBytes:normalProps,
        projectedPropertyBytes:compactProps,outerKeys:fields,propertyKeys:nested,
        unchangedCoordinateReferences:unchangedCoords,count:source.features.length};
    });
    assert(row.offPath.count===254&&row.offPath.unchangedCoordinateReferences,
      'P6-2 census changed source geometry references');
    await page.locator('#timelinePreviousYear').click({timeout:45000});
    await expect.poll(()=>page.evaluate(()=>({
      month:globalThis.__PANDOLAB_VIEWER__.builtinMonth().month,
      cursor:globalThis.__PANDOLAB_VIEWER__.documentState().timelineCursor,
      ready:document.querySelector('#viewerStatus').dataset.ready,
    })),{timeout:180000}).toEqual({month:'2025-12',cursor:'2025-12',ready:'true'});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    row.after=await pageState(page);
    row.timing=await page.evaluate(()=>{
      const state=globalThis.__P6_2;
      const started=state.clickAt,ended=performance.now();
      return{requestedAt:started,presentedAt:state.presentedAt,
        clickToCommitMs:started!==null&&state.presentedAt!==null?state.presentedAt-started:null,
        clickToReadyObservationMs:started!==null?ended-started:null,
        mainPost:state.sent,projectionCount:state.metaProjectionMessages,
        longTasks:state.longTasks.filter(x=>started!=null &&
          x.startMs<=ended&&x.startMs+x.durationMs>=started)
          .map(x=>x.durationMs)};
    });
    const picture=await page.locator('#viewerCanvas').screenshot({animations:'disabled',
      style:'body * {visibility:hidden!important} #viewerCanvas {visibility:visible!important}'});
    row.pixel=await pixelHash(page,picture);
    writeFileSync(join(output,'p6-2-'+mode+'-'+index+'-2025-12.png'),picture,{flag:'wx'});
    // Independent, fresh Workers share the exact same WASM and quality/outline
    // program as production, but each starts with its own clean topology state.
    // Validate A/B/A2 byte-for-byte, including metadata and all TypedArrays.
    if(index===0){
      row.isolated=await page.evaluate(async()=>{
        const probe=globalThis.__P6_2;
        if(!probe.url||!probe.original)throw Error('Worker URI/canonical input unavailable');
        const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
          .map(v=>v.toString(16).padStart(2,'0')).join('');
        const packetDigest=async packet=>{
          const arrays=[];
          const metadata=JSON.stringify(packet,(key,value)=>{
            if(ArrayBuffer.isView(value)){
              const id=arrays.push(value)-1;
              return{typed:value.constructor.name,index:id,bytes:value.byteLength};
            }
            return value;
          });
          const hashParts=[];
          for(const array of arrays)hashParts.push(await digest(
            new Uint8Array(array.buffer,array.byteOffset,array.byteLength)));
          return{sha:await digest(new TextEncoder().encode(JSON.stringify({metadata,hashParts}))),
            arrayHashes:hashParts,typedArrays:arrays.map(v=>({kind:v.constructor.name,bytes:v.byteLength}))};
        };
        const results=[];
        const originalMode=probe.mode;
        try{
          for(const probeMode of ['A','B','A2']){
            probe.mode=probeMode;
            const worker=new Worker(probe.url,{name:'w2-p6-2-isolated'});
            try{
              const start=performance.now();
              const response=await new Promise((resolve,reject)=>{
                const timeout=setTimeout(()=>reject(Error('Worker reference packet timeout')),150000);
                worker.addEventListener('message',event=>{
                  if(!['prepared','error'].includes(event.data?.type))return;
                  clearTimeout(timeout);
                  if(event.data.type==='error')reject(Error(event.data.message));
                  else resolve(event.data);
                });
                worker.addEventListener('error',error=>{clearTimeout(timeout);reject(Error(error.message));});
                worker.postMessage(probe.original);
              });
              const untilPreparedMs=performance.now()-start;
              results.push({mode:probeMode,untilPreparedMs,
                cacheHit:response.packetCacheHit,packet:await packetDigest(response.packet),
                requestId:response.requestId,projectGeneration:response.projectGeneration,
                quality:response.quality,
                postMs:probe.sent.at(-1).elapsedMs});
            }finally{worker.terminate();}
          }
        }finally{probe.mode=originalMode;}
        if(results.some(x=>x.packet.sha!==results[0].packet.sha))throw Error('A-B-A Worker output packet SHA mismatch');
        return results;
      });
    }
    assert(row.after.hash && row.after.month==='2025-12'&&row.after.ready==='true',
      'P6-2 completed transition has no accepted 2025-12 frame');
    assert(errors.length===0,'Unexpected page errors: '+errors.join(' | '));
    row.status='passed';
    console.log('W2P6_PROJECTION_SAMPLE '+JSON.stringify({mode,index,status:row.status,
      bytes:row.offPath.normalBytes,projectedBytes:row.offPath.compactBytes,
      savedBytes:row.offPath.savedBytes,
      mapHash:row.after.hash,screenHash:row.pixel.sha256,
      commitMs:row.timing.clickToCommitMs,
      mainPost:row.timing.mainPost,
      isolated:row.isolated?.map(x=>({mode:x.mode,sha:x.packet.sha,postMs:x.postMs,
        roundTripMs:x.untilPreparedMs}))||null,
    }));
  }catch(error){
    row.status='failed';row.failure=String(error?.stack||error);
  }finally{
    await context?.close();await browser?.close();
    writeFileSync(join(output,'p6-2-'+mode+'-'+index+'.json'),JSON.stringify(row,null,2)+'\n',{flag:'wx'});
  }
  return row;
}
const report={
 schema:'pando-w2-p6-2-reference-preserving-feature-projection-v1',
 kind:'linux-chromium-functional-experiment-not-windows-gtx1650-evidence',
 pins:{source:PIN,library:DATA,runtime:RUNTIME,sourceInputsSha256:snapshot.sourceSha256},
 repetitions:reps,arms:[],status:'pending'};
try{
 for(const mode of ['A','B','A2']){
   const rows=[];
   for(let i=0;i<reps;i++){
     const row=await runCase(mode,i);
     rows.push(row);
     if(row.status!=='passed')throw Error('P6-2 '+mode+'-'+i+': '+row.failure);
   }
   report.arms.push({mode,rows});
 }
 const all=report.arms.flatMap(arm=>arm.rows);
 const baseline=all[0];
 assert(all.every(x=>x.after.hash===baseline.after.hash),
   'Projected Viewer document/labels/timeline differs');
 assert(all.every(x=>x.pixel.sha256===baseline.pixel.sha256),
   'Projected Viewer canvas pixels differ');
 assert(all.every(x=>x.offPath.normalBytes===baseline.offPath.normalBytes &&
   x.offPath.compactBytes===baseline.offPath.compactBytes),
   'P6-2 snapshot size differs across source-pinned fresh Chromium processes');
 const proof=all.filter(x=>x.isolated).flatMap(x=>x.isolated);
 assert(proof.length===9,'Need nine isolated Worker packet checks');
 assert(proof.every(x=>x.packet.sha===proof[0].packet.sha),
   'Full vs projected Worker metadata/TypedArray SHA differs');
 report.summary={
   featureCount:baseline.offPath.count,
   originalBytes:baseline.offPath.normalBytes,
   projectedBytes:baseline.offPath.compactBytes,
   savedBytes:baseline.offPath.savedBytes,
   savedPercent:baseline.offPath.savedPercent,
   originalPropertyBytes:baseline.offPath.normalPropertyBytes,
   compactPropertyBytes:baseline.offPath.projectedPropertyBytes,
   outerKeys:baseline.offPath.outerKeys,
   propertyKeys:baseline.offPath.propertyKeys,
   mapSemanticSha:baseline.after.hash,
   canvasRgbaSha:baseline.pixel.sha256,
   isolatedPacketSha:proof[0].packet.sha,
   isolatedPacketsMatched:proof.length,
   sampleCount:all.length,
   samples:all.map(x=>({mode:x.mode,index:x.index,
     clickToCommitMs:x.timing.clickToCommitMs,
     initialPost:x.timing.mainPost.find(row=>row.featureCount===254)?.elapsedMs??null,
     postCount:x.timing.mainPost.length,maxLongTaskMs:Math.max(0,...x.timing.longTasks),
   })),
   limits:[
     'Linux software-rendered Chromium is not a Windows GTX 1650 benchmark',
     'The first year switch can reuse the main renderer and skip Worker postMessage',
     'Independent Workers include module/WASM initialization, not just structured-clone',
     'A-B-A n='+reps+' per arm is a correctness pilot, not a statistical proof of speedup',
   ],
 };
 report.status='passed';
 console.log('W2P6_PROJECTION_FINAL '+JSON.stringify(report.summary));
}catch(error){
 report.status='failed';report.failure=String(error?.stack||error);
 console.error('W2P6_PROJECTION_ERROR '+report.failure);
}finally{
 await new Promise(done=>server.close(done));
 writeFileSync(join(output,'w2-p6-2-experiment.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
}
if(report.status!=='passed')process.exitCode=1;
