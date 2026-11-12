#!/usr/bin/env node
// P7-based, opt-in regional A1/512 tile experiment. No production assets change.
import {chromium} from '@playwright/test';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {a1TerrainFragmentSource} from './a1-shader.mjs';
import {makeViewerFixtureManifest} from './viewer-fixture.mjs';
import {serve,identity,mapSummary,chromiumProcessMemory} from '../p7-browser-ab-measure.mjs';

const revision='ad4872bb1289fa3ed3ea2f3951680bd56c2a2633';
const base=`https://raw.githubusercontent.com/kimjeon-il/PandoLab-library-data/${revision}/reports/development/performance/terrain-architecture-2026-11-12/p2/fixtures-viewer/webp/`;
const manifestHash='ea21beb9d96f39b3baa19f74c7114a3de22b2d902aab96a0293efccbad01f203';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const out=process.argv.find(arg=>arg.startsWith('--out='))?.slice(6);
const smoke=process.argv.includes('--smoke');
if(!out)throw Error('Explicit --out directory required');
await mkdir(out,{recursive:false});
const fixtureResponse=await fetch(base+'manifest.json');
if(!fixtureResponse.ok)throw Error(`Fixture manifest HTTP ${fixtureResponse.status}`);
const fixtureBytes=Buffer.from(await fixtureResponse.arrayBuffer());
if(digest(fixtureBytes)!==manifestHash)throw Error('Fixture manifest hash mismatch');
const fixture=JSON.parse(fixtureBytes),runs=[],sequence=smoke?[1024,512]:[1024,512,512,1024,1024,512];
const report={schema:'pando-terrain-viewer-regional-ab-v1',identity:identity(),fixtureRevision:revision,
  fixtureManifestSha256:manifestHash,sequence,startedAt:new Date().toISOString(),runs,status:'running',
  limitations:['Only a bounded LOD5 region uses Q1; lower LODs use the original v0.14 tiles.',
    'Only WebGL2 and a flat 32x stationary scene; this is not complete A1/B acceptance.',
    '512 versus 1024 varies tile partition only; an atlas or instancing optimization is not implemented.',
    'Playwright interception proxies fixed-commit bytes, so browser network totals are not real-host transfer measurements.',
    'rAF intervals are scheduling proxies, not actual GPU presentation or GPU time.']};
let server,browser;
try{
  server=await serve();
  browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader',
    '--enable-unsafe-swiftshader','--disable-gpu-sandbox']});
  report.browserVersion=browser.version();
  for(let index=0;index<sequence.length;index++){
    const size=sequence[index],run={index:index+1,tileSize:size,status:'running',candidateRequests:[],pageErrors:[],error:null};
    runs.push(run);const page=await browser.newPage({viewport:{width:1280,height:800},locale:'ko-KR',timezoneId:'Asia/Seoul'});
    let selected,manifestRequests=0,shaderRequests=0,processCdp;
    try{
      page.on('pageerror',error=>run.pageErrors.push(String(error)));
      await page.route('**/assets/js/modules/terrain-dem-shaders.js*',route=>{
        shaderRequests++;
        const body=`export function terrainDemFragmentSource(v){if(v===1)return ${JSON.stringify(a1TerrainFragmentSource(1))};if(v===2)return ${JSON.stringify(a1TerrainFragmentSource(2))};throw Error('WebGL version');}`;
        return route.fulfill({status:200,contentType:'text/javascript',body});
      });
      await page.route('**/terrain/v0.14.0/manifest.json*',async route=>{
        const original=await route.fetch();if(!original.ok())throw Error('Original terrain manifest fetch failed');
        selected=makeViewerFixtureManifest(await original.json(),fixture,size);manifestRequests++;
        return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(selected.manifest)});
      });
      await page.route('https://raw.githubusercontent.com/kimjeon-il/PandoLab-library-data/**/terrain/v0.15.0/**',async route=>{
        const url=new URL(route.request().url()),parts=url.pathname.split('/terrain/v0.15.0/');
        const key=parts[1];
        if(!selected||!key)return route.abort('failed');
        if(key.startsWith('5/')){
          const item=selected.tiles.get(key);if(!item){run.candidateRequests.push({key,error:'outside fixture'});return route.abort('failed');}
          const response=await fetch(base+item.file);if(!response.ok())throw Error('Fixture tile HTTP '+response.status);
          const bytes=Buffer.from(await response.arrayBuffer());
          if(bytes.length!==item.bytes||digest(bytes)!==item.sha256)throw Error('Fixture tile identity mismatch: '+key);
          run.candidateRequests.push({key,bytes:bytes.length,sha256:item.sha256});
          return route.fulfill({status:200,contentType:'image/webp',body:bytes});
        }
        const original=url.href.replace('/terrain/v0.15.0/','/terrain/v0.14.0/');
        return route.fulfill({response:await route.fetch({url:original})});
      });
      await page.addInitScript(()=>{
        const meter=globalThis.__terrainFixtureFrames={active:false,last:null,gaps:[],start(){this.active=true;this.last=null;this.gaps=[];},
          stop(){this.active=false;return [...this.gaps];}};
        const tick=now=>{if(meter.active){if(meter.last!==null)meter.gaps.push(now-meter.last);meter.last=now;}requestAnimationFrame(tick);};
        requestAnimationFrame(tick);
      });
      await page.clock.setFixedTime(new Date('2026-11-06T03:00:00+09:00'));
      await page.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});
      processCdp=await browser.newBrowserCDPSession();
      await page.goto('http://127.0.0.1:4173/?debug=1&renderer=webgl2',{waitUntil:'domcontentloaded',timeout:120000});
      await page.waitForFunction(()=>{
        const api=globalThis.__PANDOLAB_VIEWER__,s=api?.rendererStats();
        return s?.canonicalMeshReady===true&&s.countriesPublishedGeneration===s.projectGeneration&&s.projectGeneration>0
          &&api.builtinMonth().month==='2026-11'&&document.getElementById('viewerStatus')?.dataset.ready==='true';
      },null,{timeout:210000,polling:300});
      if(!selected||manifestRequests!==1||shaderRequests<1)throw Error('Experiment manifest or shader was not consumed');
      await page.evaluate(()=>globalThis.__terrainFixtureFrames.start());
      const started=Date.now();
      await page.evaluate(center=>{
        const host=globalThis.__PANDOLAB_MAP_HOST__,view=host.getViewState();
        host.setViewState({projection:'flat',view:{...view,flatCenter:center,flatZoom:32}});
        host.requestRepaint('terrain-regional-fixture');
      },selected.center);
      await page.waitForFunction(()=>{
        const s=globalThis.__PANDOLAB_VIEWER__?.rendererStats();
        return s?.terrainTargetLevel===5&&s.terrainRenderedLevel===5&&s.terrainTargetTileCount>0
          &&s.terrainTargetTilesLoaded===s.terrainTargetTileCount&&s.terrainReady===true&&!s.screenLodPreparingKey;
      },null,{timeout:180000,polling:250});
      run.readyMs=Date.now()-started;
      await page.waitForFunction(()=>globalThis.__terrainFixtureFrames.gaps.length>=300,null,{timeout:180000,polling:250});
      run.frameGapsMs=await page.evaluate(()=>globalThis.__terrainFixtureFrames.stop());
      const sorted=[...run.frameGapsMs].sort((a,b)=>a-b),at=q=>sorted[Math.floor((sorted.length-1)*q)];
      run.frames={count:sorted.length,p50Ms:at(.5),p95Ms:at(.95),p99Ms:at(.99)};
      run.renderer=mapSummary(await page.evaluate(()=>globalThis.__PANDOLAB_VIEWER__.rendererStats()));
      run.chromiumProcessMemory=await chromiumProcessMemory(processCdp);
      run.center=selected.center;run.manifestRequests=manifestRequests;run.shaderRequests=shaderRequests;
      try{await page.screenshot({path:`${out}/viewer-${index+1}-${size}.png`,timeout:30000});}
      catch(error){run.screenshotError=String(error);}
      run.status=run.pageErrors.length||run.screenshotError||run.candidateRequests.some(x=>x.error)?'failed':'passed';
      if(run.status!=='passed')run.error='Screenshot, candidate request, or page error';
    }catch(error){run.status='failed';run.error=String(error?.stack||error).slice(0,5000);
      run.diagnostics=await page.evaluate(()=>globalThis.__PANDOLAB_VIEWER__?.rendererStats?.()||null).catch(()=>null);
    }finally{await processCdp?.detach().catch(()=>{});await page.close();
      await writeFile(`${out}/report.json`,JSON.stringify(report,null,2)+'\n');}
  }
  report.status=runs.length===sequence.length&&runs.every(run=>run.status==='passed')?'passed':'failed';
}catch(error){report.status='failed';report.error=String(error?.stack||error).slice(0,5000);}
finally{
  report.finishedAt=new Date().toISOString();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2)+'\n');
  await browser?.close().catch(()=>{});
  if(server){server.kill('SIGTERM');await Promise.race([new Promise(done=>server.once('exit',done)),delay(5000)]);if(server.exitCode===null)server.kill('SIGKILL');}
}
console.log('TERRAIN_REGIONAL_EXPERIMENT '+JSON.stringify({status:report.status,runs:runs.map(run=>({tileSize:run.tileSize,status:run.status,error:run.error?.slice(0,200)}))}));
if(report.status!=='passed')process.exitCode=1;
