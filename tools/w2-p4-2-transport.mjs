import {chromium,expect} from '@playwright/test';
import {writeFileSync,existsSync} from 'node:fs';
const base=process.env.PANDOLAB_W3_EVIDENCE;if(!base)throw Error('Missing evidence path');
const output=base+'/transport.json';if(existsSync(output))throw Error('Preserve existing evidence');
const browser=await chromium.launch({headless:true,args:['--use-angle=d3d11']});const report={status:'pending',browser:browser.version(),rows:[]};
try{
 const cdp=await browser.newBrowserCDPSession();report.gpu=(await cdp.send('SystemInfo.getInfo')).gpu;
 const context=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:1,locale:'ko-KR',timezoneId:'Asia/Seoul'});
 await context.addInitScript(()=>{const original=Worker.prototype.postMessage;Worker.prototype.postMessage=function(...args){if(args[0]?.type==='replace'&&Object.hasOwn(args[0],'includeOutlines')&&args[0]?.features?.length===254)globalThis.__w4Snapshot=args[0];return original.apply(this,args);};});
 const page=await context.newPage();await page.goto('http://127.0.0.1:4211/?debug=1&renderer=webgl2',{waitUntil:'domcontentloaded'});await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:150000});await expect.poll(()=>page.evaluate(()=>!!globalThis.__w4Snapshot),{timeout:120000}).toBe(true);
 report.identity=await page.evaluate(()=>{const c=document.querySelector('#viewerCanvas'),g=c.getContext('webgl2'),e=g.getExtension('WEBGL_debug_renderer_info');return{renderer:g.getParameter(e.UNMASKED_RENDERER_WEBGL),build:PANDOLAB_BUILD_META};});
 if(report.browser!=='151.0.7922.34'||!report.gpu.devices.some(d=>d.deviceString==='NVIDIA GeForce GTX 1650'&&d.driverVersion==='32.0.16.1088')||report.gpu.featureStatus.gpu_compositing!=='enabled'||!/NVIDIA.*Direct3D11/.test(report.identity.renderer)||report.identity.build.sourceCommit!=='fe8282ba32761ab9586348d1712e11cc1f4e7882'||report.identity.build.dataRevision!=='data-f50b7f480c812df6f5ea0c40f5461ab0')throw Error('Environment mismatch');
 report.result=await page.evaluate(async()=>{
  const snapshot=globalThis.__w4Snapshot,encoder=new TextEncoder(),decoder=new TextDecoder();const hash=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');
  const source=JSON.stringify(snapshot),expected=await hash(source);const worker=new Worker(URL.createObjectURL(new Blob([`onmessage=e=>{if(e.data.kind==='object'){postMessage({kind:'object',value:e.data.value});return;}const t=performance.now();const value=JSON.parse(new TextDecoder().decode(e.data.value));const decoded=performance.now()-t;const s=performance.now();const bytes=new TextEncoder().encode(JSON.stringify(value));postMessage({kind:'buffer',value:bytes.buffer,decoded,encoded:performance.now()-s},[bytes.buffer]);}`],{type:'text/javascript'})));
  const rows=[];try{for(const kind of ['object','buffer','object'])for(let i=0;i<10;i++){
   const start=performance.now();let value=snapshot,encodeMs=0;if(kind==='buffer'){const t=performance.now();value=encoder.encode(JSON.stringify(snapshot)).buffer;encodeMs=performance.now()-t;}
   const response=await new Promise((resolve,reject)=>{worker.onmessage=e=>resolve(e.data);worker.onerror=reject;if(kind==='buffer')worker.postMessage({kind,value},[value]);else worker.postMessage({kind,value});});
   const decodeStart=performance.now();const text=kind==='buffer'?JSON.stringify(JSON.parse(decoder.decode(response.value))):JSON.stringify(response.value);const decodeMs=performance.now()-decodeStart;const elapsed=performance.now()-start;const digest=await hash(text);if(digest!==expected)throw Error('Snapshot mismatch');rows.push({kind,i,elapsedMs:elapsed,encodeMs,decodeMs,workerEncodeMs:response.encoded??null,workerDecodeMs:response.decoded??null,digest});
  }}finally{worker.terminate();}return{featureCount:snapshot.features.length,bytes:encoder.encode(source).byteLength,expected,rows};
 });report.status='passed';
}catch(e){report.status='failed';report.failure=String(e.stack||e);}finally{await browser.close();writeFileSync(output,JSON.stringify(report,null,2),{flag:'wx'});}
console.log('W4_TRANSPORT',report.status,report.failure||'');if(report.status!=='passed')process.exitCode=1;
