// P1 focused browser reproduction: the published Viewer and immutable
// Places Worker, plus genuine WEBGL_lose_context restoration (not source slices).
import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {waitForCanonicalMap} from '../helpers/viewer-acceptance.mjs';

test.use({viewport:{width:1280,height:800},
  launchOptions:{args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}});
test.describe('P1 actual Places Worker and GPU recovery diagnosis',()=>{
  test('pinned Places Worker accepts a real RPC search without timing out',async({page},info)=>{
    test.setTimeout(110_000);
    const evidence={case:'place.search',errors:[],httpErrors:[],workerScripts:[]};
    page.on('pageerror',error=>evidence.errors.push(String(error.message)));
    page.on('console',message=>{
      if(message.type()==='error'&&evidence.errors.length<16)evidence.errors.push(message.text().slice(0,600));
    });
    page.on('response',response=>{
      if(response.status()>=400&&evidence.httpErrors.length<16)
        evidence.httpErrors.push({status:response.status(),path:new URL(response.url()).pathname});
    });
    page.on('worker',worker=>evidence.workerScripts.push(new URL(worker.url()).pathname));
    try{
      await page.goto('/?debug=1&renderer=webgl2',{waitUntil:'domcontentloaded'});
      await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:65_000});
      const rpc=await page.evaluate(async()=>{
        const meta=globalThis.PANDOLAB_BUILD_META;
        const asset=meta?.workerAssets?.['assets/js/workers/place-worker.js'];
        if(!asset)throw Error('Generated Place Worker asset missing');
        const url=new URL(asset.url,new URL('./',location.href));
        url.searchParams.set('v',meta.assetRevision);
        url.searchParams.set('dataRevision',meta.dataRevision);
        const manifestUrl=new URL(meta.mapProject.resources.places.catalog,new URL('./',location.href)).href;
        const {createWorkerRpcClient}=await import('/assets/js/modules/worker-rpc.js?v='+encodeURIComponent(meta.assetRevision));
        const started=performance.now();
        const client=createWorkerRpcClient({createWorker:()=>new Worker(url,{type:'module'}),
          defaultTimeoutMs:15_000});
        try{
          const value=await client.request('place.search',{query:'zz',manifestUrl,presentation:null});
          return {ok:true,resultType:typeof value,records:value?.records?.length??null,
            durationMs:performance.now()-started,workerPath:url.pathname,manifestPath:new URL(manifestUrl).pathname};
        }catch(error){
          return {ok:false,code:error.code,category:error.category,message:String(error.message),
            durationMs:performance.now()-started,workerPath:url.pathname,manifestPath:new URL(manifestUrl).pathname};
        }finally{client.stop();}
      });
      evidence.rpc=rpc;
      evidence.ready=await page.locator('#viewerStatus').getAttribute('data-ready');
      evidence.map=await page.evaluate(()=>{
        const s=globalThis.__PANDOLAB_VIEWER__?.rendererStats?.();
        return s?{ready:s.mapReadiness?.mapReady,backend:s.renderer,projectGeneration:s.projectGeneration}:null;
      });
      expect(rpc.ok,JSON.stringify(rpc)).toBe(true);
      expect(rpc.records).toBeGreaterThanOrEqual(0);
      expect(evidence.errors.filter(row=>row.includes('PL-PLACE-LOAD-001'))).toEqual([]);
      expect(evidence.map?.ready).toBe(true);
    }finally{await writeFile(info.outputPath('p1-place-worker.json'),JSON.stringify(evidence,null,2));}
  });

  test('a real WebGL2 context loss returns to an accepted current map frame',async({page},info)=>{
    test.setTimeout(130_000);
    const evidence={case:'webgl2-context-restoration',consoleErrors:[],pageErrors:[]};
    page.on('pageerror',error=>evidence.pageErrors.push(String(error.message)));
    page.on('console',message=>{
      if(message.type()==='error'&&evidence.consoleErrors.length<18)evidence.consoleErrors.push(message.text().slice(0,900));
    });
    try{
      await page.goto('/?debug=1&renderer=webgl2',{waitUntil:'domcontentloaded'});
      await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:65_000});
      await waitForCanonicalMap(page,{timeout:65_000});
      const before=await page.evaluate(()=>{
        const api=globalThis.__PANDOLAB_VIEWER__,s=api?.rendererStats();
        return {projectGeneration:s.projectGeneration,frame:s.displayedRevision,
          recovery:s.gpuRecovery,renderer:s.renderer,month:api?.documentState()?.timelineCursor};
      });
      evidence.before=before;
      const result=await page.evaluate(()=>{
        const canvas=document.querySelector('canvas.gpu-map-canvas');
        const gl=canvas?.getContext('webgl2');
        const extension=gl?.getExtension('WEBGL_lose_context');
        if(!extension)return {ok:false,reason:'WEBGL_lose_context unavailable'};
        globalThis.__p1Loss={lost:false,restored:false,extension};
        canvas.addEventListener('webglcontextlost',()=>{globalThis.__p1Loss.lost=true;},{once:true});
        canvas.addEventListener('webglcontextrestored',()=>{globalThis.__p1Loss.restored=true;},{once:true});
        extension.loseContext();
        return {ok:true};
      });
      evidence.loss=result;
      expect(result.ok,JSON.stringify(result)).toBe(true);
      await expect.poll(()=>page.evaluate(()=>globalThis.__p1Loss?.lost),{timeout:10_000}).toBe(true);
      await page.waitForTimeout(200);
      await page.evaluate(()=>globalThis.__p1Loss.extension.restoreContext());
      await expect.poll(()=>page.evaluate(()=>globalThis.__p1Loss?.restored),{timeout:12_000}).toBe(true);
      await expect.poll(()=>page.evaluate(()=>globalThis.__PANDOLAB_VIEWER__?.rendererStats()?.gpuRecovery?.phase),
        {timeout:38_000}).toBe('complete');
      await waitForCanonicalMap(page,{timeout:38_000});
      evidence.after=await page.evaluate(()=>{
        const api=globalThis.__PANDOLAB_VIEWER__,s=api?.rendererStats();
        return {projectGeneration:s.projectGeneration,frame:s.displayedRevision,
          recovery:s.gpuRecovery,renderer:s.renderer,month:api?.documentState()?.timelineCursor,
          ready:document.querySelector('#viewerStatus')?.dataset.ready};
      });
      expect(evidence.after.projectGeneration).toBe(before.projectGeneration);
      expect(evidence.after.month).toBe(before.month);
      expect(evidence.after.recovery.phase).toBe('complete');
      expect(evidence.after.ready).toBe('true');
      expect(evidence.pageErrors).toEqual([]);
    }finally{
      if(!evidence.after)try{evidence.final=await page.evaluate(()=>{
        const api=globalThis.__PANDOLAB_VIEWER__,r=api?.rendererStats();
        return {renderer:r?.renderer,recovery:r?.gpuRecovery,ready:r?.mapReadiness,
          screenReady:document.querySelector('#viewerStatus')?.dataset.ready};
      });}catch(error){evidence.captureError=String(error);}
      await writeFile(info.outputPath('p1-gpu-recovery.json'),JSON.stringify(evidence,null,2));
    }
  });
});
