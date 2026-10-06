import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {chromium} from '@playwright/test';

// Compare two served checkouts without writing either checkout. Cache warmth
// refers to stored asset bytes; autosaved projects are removed between loads.
const baselineRoot=process.argv[2],candidateRoot=process.argv[3],output=process.argv[4];
if(!baselineRoot||!candidateRoot||!output)throw new Error('Usage: node tools/measure-territorial-startup.mjs <baseline root> <candidate root> <output JSON>');
const cases=[{label:'baseline',root:path.resolve(baselineRoot),port:4285},{label:'candidate',root:path.resolve(candidateRoot),port:4286}];
const servers=[],runs=[];
let browser;
try{
  for(const entry of cases){
    const server=spawn(process.execPath,['tests/browser/server.mjs'],{cwd:entry.root,env:{...process.env,PANDOLAB_TEST_PORT:String(entry.port)},stdio:'pipe'});
    servers.push(server);
    await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(new Error(`Server exited: ${code}`)));});
  }
  browser=await chromium.launch({args:['--enable-precise-memory-info']});
  for(let run=0;run<3;run++)for(const entry of cases){
    const context=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:1});
    await context.addInitScript(()=>{
      globalThis.__territorialMeasure={active:false,frames:[],preparation:[],uploadMs:0,uploadBytes:0};
      for(const type of [globalThis.WebGLRenderingContext,globalThis.WebGL2RenderingContext]){
        const original=type.prototype.bufferData;
        type.prototype.bufferData=function(...args){const start=performance.now();const result=Reflect.apply(original,this,args);const measure=globalThis.__territorialMeasure;measure.uploadMs+=performance.now()-start;measure.uploadBytes+=typeof args[1]==='number'?args[1]:(args[1]?.byteLength||0);return result;};
      }
    });
    // Observe existing production preparation and submission, not a substitute
    // renderer. Both checkouts must contain the exact observation boundaries.
    await context.route('**/assets/js/modules/gpu-map-renderer.js*',async route=>{
      const response=await route.fetch();let source=(await response.text()).replaceAll('\r\n','\n');
      const markers=['function prepareBaseScene() {',"      if (deferredOverlayKeys.size) invalidateGpuFrame('overlay-upload-budget');",'frameTimes.push(performance.now() - started);'];
      for(const marker of markers)if(!source.includes(marker))throw new Error(`Missing production observation boundary: ${marker}`);
      source=source.replace(markers[0],`${markers[0]}\nconst observedPreparationStart=performance.now();`)
        .replace(markers[1],`${markers[1]}\nif(globalThis.__territorialMeasure.active)globalThis.__territorialMeasure.preparation.push(performance.now()-observedPreparationStart);`)
        .replace(markers[2],`${markers[2]}\nif(globalThis.__territorialMeasure.active)globalThis.__territorialMeasure.frames.push(performance.now()-started);`);
      await route.fulfill({response,body:source});
    });
    let page=await context.newPage();
    try{
      for(const cache of ['cold','warm']){
        if(cache==='warm'){
          await page.close();page=await context.newPage();
          await page.goto(`http://127.0.0.1:${entry.port}/assets/data/country-label-anchors-v0.10.1.json`);
          await page.evaluate(()=>new Promise((resolve,reject)=>{const request=globalThis.indexedDB.deleteDatabase('pandolab-editor');request.onsuccess=resolve;request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Autosave reset blocked'));}));
        }
        const requests=[];const listener=request=>requests.push(request.url());page.on('request',listener);
        console.log(`${entry.label} run ${run} ${cache}`);
        await page.goto(`http://127.0.0.1:${entry.port}/?renderer=webgl2`,{waitUntil:'domcontentloaded'});
        await page.waitForFunction(()=>globalThis.document.querySelector('#app')?.dataset.readiness==='enhanced',null,{timeout:120000});
        await page.evaluate(()=>{globalThis.__territorialMeasure.active=true;});
        await page.mouse.move(650,400);await page.mouse.wheel(0,-1300);
        for(let i=0;i<6;i++){await page.mouse.move(650,400);await page.mouse.down();await page.mouse.move(680+i,410,{steps:8});await page.mouse.up();await page.mouse.wheel(0,i%2?110:-110);}
        await page.waitForTimeout(1000);
        const values=await page.evaluate(()=>({startup:globalThis.__PANDOLAB_STARTUP_METRICS__,observations:globalThis.__territorialMeasure,memory:performance.memory?.usedJSHeapSize}));
        page.off('request',listener);
        if(!values.observations.frames.length||!values.observations.preparation.length)throw new Error('No actual pan/zoom submission/preparation samples');
        const result={label:entry.label,run,cache,requestCount:requests.length,catalogRequests:requests.filter(url=>url.includes('/territorial-entities/')), ...values};
        runs.push(result);fs.writeFileSync(output,JSON.stringify({method:'paired asset-cache-only warm; precise heap; actual production preparation/submission; CPU bufferData submission timing',runs},null,2));
        console.log(JSON.stringify({label:entry.label,run,cache,readyMs:values.startup.readyMs,frames:values.observations.frames.length,requests:requests.length}));
      }
    }finally{await context.close();}
  }
}finally{if(browser)await browser.close();for(const server of servers)server.kill();}
