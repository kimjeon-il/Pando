import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {mkdtemp,unlink,rmdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runViewerPhases,captureAcceptedFrame} from '../../../scripts/terrain-experiment/viewer-phases.mjs';

test('terrain phase runner exercises drag, rotation, dates, theme and warm return', {timeout:30000},async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:400,height:300}});
    await page.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});
    await page.setContent('<!doctype html><canvas id="viewerCanvas" width="120" height="120"></canvas><button id="timelinePreviousYear">previous</button><button id="timelineNextYear">next</button><button id="mapDisplayBtn">view</button><button data-map-display-row="terrain">terrain</button><label for="terrainPoliticalRadio">political</label><input type="radio" name="terrainStyle" id="terrainPoliticalRadio"><label for="terrainNoneRadio">none</label><input type="radio" name="terrainStyle" id="terrainNoneRadio"><label for="terrainPhysicalRadio">physical</label><input type="radio" name="terrainStyle" id="terrainPhysicalRadio" checked>');
    await page.evaluate(()=>{
      let month='2026-11',view={globeRotation:[-102,-28,0],globeZoom:32};
      document.documentElement.dataset.theme='light';
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change',event=>{document.documentElement.dataset.theme=event.matches?'dark':'light';});
      document.getElementById('timelinePreviousYear').onclick=()=>{month='2025-12';};
      document.getElementById('timelineNextYear').onclick=()=>{month='2026-11';};
      document.getElementById('viewerCanvas').addEventListener('pointermove',event=>{if(event.buttons)view.globeRotation[0]+=.02;});
      globalThis.__PANDOLAB_MAP_HOST__={getViewState:()=>structuredClone(view),setViewState:next=>{view=next.view;},requestRepaint:()=>true};
      globalThis.__PANDOLAB_VIEWER__={builtinMonth:()=>({month}),documentState:()=>({timelineCursor:month}),rendererStats:()=>({
        mapReadiness:{mapReady:true,status:'ready'},terrainReady:true,terrainTargetLevel:globalThis.__terrainTestLevel||5,terrainRenderedLevel:globalThis.__terrainTestLevel||5,
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
      panDurationMs:100,themeCycles:2,minimumFrames:3,onStart:name=>started.push(name),onPhase:async()=>{writes++;},
      diagnostics:async()=>({cacheHits:42}),
      capture:async(_page,path,options)=>{captured.push({path,screen:options.screen});return {sha256:'fixture',terrainOnly:{sha256:await _page.evaluate(()=>document.querySelector('#terrainPoliticalRadio').checked?'political':document.querySelector('#terrainNoneRadio').checked?'none':'physical')}};}});
    assert.deepEqual(started,['drag','continuous-pan','rotate','zoom8','zoom16','zoom32-return','previous-year','date-return','dark','light','theme-cycle','warm-return','terrain-political','terrain-none','terrain-physical-return']);
    assert.equal(phases.length,15);assert.ok(phases.every(row=>row.status==='passed'&&row.frames.count>=3));
    assert.equal(captured.filter(row=>!row.screen).length,3);assert.equal(captured.length,15);assert.ok(writes>=30);
    assert.equal(phases.find(row=>row.name==='zoom8').screenSpaceCoverage,'not-verified');
    assert.equal(phases.find(row=>row.name==='terrain-none').screenSpaceCoverage,'not-applicable');
    assert.ok(phases.every(row=>row.candidateDiagnostics.cacheHits===42));
    assert.deepEqual(await page.evaluate(()=>globalThis.__PANDOLAB_MAP_HOST__.getViewState().globeRotation),[-102,-28,0]);
    await page.evaluate(()=>{globalThis.__terrainTestLevel=4;});
    const baseline=[];
    await runViewerPhases({page,pageCdp:cdp,processCdp:null,out:'unused',prefix:'a0',screen:false,center:[102,28],phases:baseline,
      expectedLevel:null,panDurationMs:100,themeCycles:2,minimumFrames:1,onStart:()=>{},onPhase:async()=>{},capture:async p=>({sha256:'fixture',terrainOnly:{sha256:await p.evaluate(()=>document.querySelector('#terrainPoliticalRadio').checked?'political':document.querySelector('#terrainNoneRadio').checked?'none':'physical')}})});
    assert.equal(baseline.length,15);assert.ok(baseline.every(row=>row.status==='passed'));
  }finally{await browser.close();}
});

test('accepted capture saves terrain-only pixels from the same frame', {timeout:15000},async()=>{
  const dir=await mkdtemp(join(tmpdir(),'pando-terrain-capture-')),path=join(dir,'frame.png');
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();await page.goto('about:blank');
    await page.evaluate(()=>{
      globalThis.__pandoCaptureFrame={};globalThis.__pandoTerrainCapture={};
      globalThis.__PANDOLAB_MAP_HOST__={requestRepaint:()=>{
        const pixels=new Uint8Array(64*64*4);crypto.getRandomValues(pixels);
        globalThis.__pandoTerrainCapture.result={pixels,width:64,height:64,frameId:7};
        globalThis.__pandoCaptureFrame.result={pixels,width:64,height:64,frameId:7,scale:10};
      }};
    });
    const result=await captureAcceptedFrame(page,path);
    assert.equal(result.frameId,7);assert.equal(result.terrainOnly.frameId,7);
    assert.equal(result.sha256,result.terrainOnly.sha256);assert.ok((await stat(join(dir,'frame-terrain.png'))).size>1024);
  }finally{
    await browser.close();await unlink(path).catch(()=>{});await unlink(join(dir,'frame-terrain.png')).catch(()=>{});await rmdir(dir);
  }
});
