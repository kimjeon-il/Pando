import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {runViewerPhases} from '../../../scripts/terrain-experiment/viewer-phases.mjs';

test('terrain phase runner exercises drag, rotation, dates, theme and warm return', {timeout:30000},async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:400,height:300}});
    await page.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});
    await page.setContent('<!doctype html><canvas id="viewerCanvas" width="120" height="120"></canvas><button id="timelinePreviousYear">previous</button><button id="timelineNextYear">next</button>');
    await page.evaluate(()=>{
      let month='2026-11',view={globeRotation:[-102,-28,0],globeZoom:32};
      document.documentElement.dataset.theme='light';
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change',event=>{document.documentElement.dataset.theme=event.matches?'dark':'light';});
      document.getElementById('timelinePreviousYear').onclick=()=>{month='2025-12';};
      document.getElementById('timelineNextYear').onclick=()=>{month='2026-11';};
      document.getElementById('viewerCanvas').addEventListener('pointermove',event=>{if(event.buttons)view.globeRotation[0]+=.02;});
      globalThis.__PANDOLAB_MAP_HOST__={getViewState:()=>structuredClone(view),setViewState:next=>{view=next.view;},requestRepaint:()=>true};
      globalThis.__PANDOLAB_VIEWER__={builtinMonth:()=>({month}),documentState:()=>({timelineCursor:month}),rendererStats:()=>({
        mapReadiness:{mapReady:true,status:'ready'},terrainReady:true,terrainTargetLevel:5,terrainRenderedLevel:5,
        terrainTargetTileCount:1,terrainTargetTilesLoaded:1,screenLodPreparingKey:null,
      })};
      const meter=globalThis.__terrainFixtureFrames={active:false,last:null,gaps:[],start(){this.active=true;this.last=null;this.gaps=[];},
        stop(){this.active=false;return [...this.gaps];}};
      const tick=now=>{if(meter.active){if(meter.last!==null)meter.gaps.push(now-meter.last);meter.last=now;}requestAnimationFrame(tick);};
      requestAnimationFrame(tick);
    });
    const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
    const phases=[],started=[],captured=[];let writes=0;
    await runViewerPhases({page,pageCdp:cdp,processCdp:null,out:'unused',prefix:'case',screen:true,center:[102,28],phases,
      minimumFrames:3,onStart:name=>started.push(name),onPhase:async()=>{writes++;},
      capture:async(_page,path,options)=>{captured.push({path,screen:options.screen});return {sha256:'fixture'};}});
    assert.deepEqual(started,['drag','rotate','previous-year','date-return','dark','light','warm-return']);
    assert.equal(phases.length,7);assert.ok(phases.every(row=>row.status==='passed'&&row.frames.count>=3));
    assert.ok(captured.every(row=>row.screen));assert.equal(captured.length,7);assert.ok(writes>=14);
    assert.deepEqual(await page.evaluate(()=>globalThis.__PANDOLAB_MAP_HOST__.getViewState().globeRotation),[-102,-28,0]);
  }finally{await browser.close();}
});
