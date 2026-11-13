import {test,expect} from '@playwright/test';

// Same pinned source, device, canvas size, camera sequence. No natural pigment;
// precolored uses the retained tile bitmaps; numerical uses the production
// destination-pixel bilinear-height sampler. Their output quality is NOT identical.
test.use({viewport:{width:1100,height:760},trace:'off',screenshot:'off'});
test('Canvas A/B: precolored vs numerical Worker CPU and frame pacing',async({browser},info)=>{
  test.setTimeout(600_000);
  const records=[];
  for(const variant of ['precolored','numerical']){
    const context=await browser.newContext({viewport:{width:1100,height:760},deviceScaleFactor:1});
    const page=await context.newPage(),errors=[];
    try{
      page.on('pageerror',error=>errors.push(error.message));
      await page.addInitScript(()=>{
        window.__canvasAb=[];
        const Original=window.Worker;
        window.Worker=class extends Original{
          constructor(...args){
            super(...args);
            this.addEventListener('message',e=>{
              if(e.data?.type==='terrain-canvas-ab')window.__canvasAb.push(e.data);
            });
          }
        };
      });
      await page.route('**/workers/canvas-render-core.js*',async route=>{
        const response=await route.fetch();
        let code=(await response.text()).replaceAll('\r\n','\n');
        function patch(oldText,newText){
          if(code.split(oldText).length!==2)throw Error('Canvas A/B source anchor mismatch: '+oldText.slice(0,50));
          code=code.replace(oldText,newText);
        }
        if(variant==='precolored')patch('if(tile.raw){','if(tile.raw && false){');
        patch('function advancePaint(task) {\n      if (activePaint !== task) return;',
          'function advancePaint(task) {\n      if (activePaint !== task) return;\n      const __abStart=performance.now();');
        patch('task.timer = setTimeout(() => advancePaint(task), 0);\n            return;',
          'task.__abCpu=(task.__abCpu||0)+performance.now()-__abStart;\n            task.timer = setTimeout(() => advancePaint(task), 0);\n            return;');
        const complete='        activePaint = null;\n        if (repaintAfterPaint) {';
        patch(complete,
          "        task.__abCpu=(task.__abCpu||0)+performance.now()-__abStart;\n"+
          "        if(task.__abZoom===8 && terrainFrameStats?.terrainReady)"+
          " self.postMessage({type:'terrain-canvas-ab',cpuMs:task.__abCpu,rotation:task.__abRotation,"+
          "numericPixels:terrainFrameStats.canvasTerrainNumericPixels||0,"+
          "scratchBytes:terrainFrameStats.canvasTerrainNumericScratchPeakBytes||0});\n"+complete);
        patch('        timer: 0,\n      };\n      activePaint = task;',
          '        timer: 0,\n        __abZoom:Number(message.view?.globeZoom||0),\n'+
          '        __abRotation:Number(message.view?.globeRotation?.[0]||0),\n'+
          '      };\n      activePaint = task;');
        await route.fulfill({response,body:code});
      });
      await page.goto('/?debug=1&renderer=canvas',{waitUntil:'domcontentloaded'});
      await expect.poll(()=>page.evaluate(()=>{
        const stats=window.__PANDOLAB_VIEWER__?.rendererStats(),r=stats?.mapReadiness;
        return stats?.renderer==='canvas-worker'&&r?.mapReady===true&&r?.terrainReady===true;
      }),{timeout:100_000}).toBe(true);
      const frames=[];
      for(const longitude of [-105.8,-106,-106.2]){
        await page.evaluate(value=>{
          const host=window.__PANDOLAB_MAP_HOST__,v=host.getViewState();
          host.setViewState({projection:'globe',view:{...v,globeZoom:8,globeRotation:[value,-28,0]}});
          host.requestRepaint('numeric-ab-camera');
        },longitude);
        await expect.poll(()=>page.evaluate(lon=>
          window.__canvasAb.filter(x=>Math.abs(x.rotation-lon)<.0001).length,longitude),
          {timeout:100_000}).toBeGreaterThan(0);
        frames.push(await page.evaluate(lon=>
          window.__canvasAb.filter(x=>Math.abs(x.rotation-lon)<.0001).at(-1),longitude));
      }
      const raf=await page.evaluate(()=>new Promise(resolve=>{
        const gaps=[];let start=null,last=null;
        function tick(time){
          if(start===null)start=time;
          if(last!==null)gaps.push(time-last);
          last=time;
          if(time-start>=650){
            gaps.sort((a,b)=>a-b);
            const q=p=>gaps.length?gaps[Math.floor((gaps.length-1)*p)]:null;
            resolve({samples:gaps.length,p50:q(.5),p95:q(.95),p99:q(.99),
              disclaimer:'rAF scheduling; not physical GPU presentation'});
          }else requestAnimationFrame(tick);
        }requestAnimationFrame(tick);
      }));
      const cdp=await context.newCDPSession(page);
      await cdp.send('Performance.enable');
      const metrics=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
      await cdp.detach();
      const stats=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats());
      await page.locator('canvas.gpu-map-canvas').first().screenshot({path:info.outputPath('canvas-'+variant+'.png')});
      const times=frames.map(x=>x.cpuMs).sort((a,b)=>a-b);
      const row={variant,workerCpuMs:times,medianWorkerCpuMs:times[1],frames,
        rasterScratchPeakBytes:Math.max(...frames.map(x=>x.scratchBytes)),
        estimatedTerrainCacheBytes:stats.terrainDemCacheBytes??null,
        mainThreadHeapUsedBytes:metrics.JSHeapUsedSize??null,rafScheduling:raf,errors};
      records.push(row);
      expect(errors).toEqual([]);
      expect(frames.every(x=>x.cpuMs>0)).toBe(true);
      if(variant==='numerical')expect(frames.at(-1).numericPixels).toBeGreaterThan(0);
    }finally{await context.close();}
  }
  const output={schema:'canvas-numeric-ab-v1',environment:'Chromium CI proxy',
    scene:{viewport:[1100,760],dpr:1,zoom:8,rotations:[-105.8,-106,-106.2],natural:false},
    caveat:'Different color interpolation quality; CPU frame times exclude cooperative scheduling idle, rAF is scheduling only.',
    records};
  await info.attach('canvas-numeric-ab',{body:JSON.stringify(output,null,2),contentType:'application/json'});
  console.log('CANVAS_NUMERIC_AB='+JSON.stringify(output));
});
