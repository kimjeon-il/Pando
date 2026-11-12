#!/usr/bin/env node
// P7-based, opt-in regional A1/512 tile experiment. No production assets change.
import {chromium} from '@playwright/test';
import {build} from 'esbuild';
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
const includeCog=process.argv.includes('--cog');
if(!out)throw Error('Explicit --out directory required');
await mkdir(out,{recursive:false});
const fixtureResponse=await fetch(base+'manifest.json');
if(!fixtureResponse.ok)throw Error(`Fixture manifest HTTP ${fixtureResponse.status}`);
const fixtureBytes=Buffer.from(await fixtureResponse.arrayBuffer());
if(digest(fixtureBytes)!==manifestHash)throw Error('Fixture manifest hash mismatch');
const fixture=JSON.parse(fixtureBytes),runs=[];
const sequence=includeCog?(smoke?['a1','b512','cog']:['a1','b512','cog','cog','b512','a1','b512','cog','a1']):
  (smoke?['a1','b512']:['a1','b512','b512','a1','a1','b512']);
let cogManifest,cogBytes,cogBundle;
if(includeCog){
  const root='https://raw.githubusercontent.com/kimjeon-il/PandoLab-library-data/8f0eb13eac9dabaafd8be5295374b1664ab581d2/reports/development/performance/terrain-architecture-2026-11-12/p3/cog-viewer-fixture/';
  const response=await fetch(root+'manifest.json');if(!response.ok)throw Error('COG manifest download failed');
  const raw=Buffer.from(await response.arrayBuffer());
  if(digest(raw)!=='b8eb34c52d1b6d849eae463ebf39ae4f33448d9e73f4a954a2fd661066200b14')throw Error('COG manifest hash mismatch');
  cogManifest=JSON.parse(raw);const file=await fetch(root+cogManifest.filename);if(!file.ok)throw Error('COG fixture download failed');
  cogBytes=Buffer.from(await file.arrayBuffer());
  if(cogBytes.length!==cogManifest.bytes||digest(cogBytes)!==cogManifest.sha256)throw Error('COG fixture hash mismatch');
  const bundle=await build({stdin:{contents:"export {openViewerCogTiles} from './scripts/terrain-experiment/viewer-cog-tiles.mjs';",
    resolveDir:process.cwd(),loader:'js'},bundle:true,platform:'browser',format:'iife',globalName:'PandoCogFixture',write:false});
  cogBundle=bundle.outputFiles[0].text;
}
const report={schema:'pando-terrain-viewer-regional-ab-v1',identity:identity(),fixtureRevision:revision,
  fixtureManifestSha256:manifestHash,sequence,startedAt:new Date().toISOString(),runs,status:'running',
  limitations:['Only a bounded LOD5 region uses Q1; lower LODs use the original v0.14 tiles.',
    'Only WebGL2 and a globe 32x stationary scene; this is not complete A1/B acceptance.',
    '512 versus 1024 varies tile partition only; an atlas or instancing optimization is not implemented.',
    'Playwright interception proxies fixed-commit bytes, so browser network totals are not real-host transfer measurements.',
    'COG runs use a simulated same-origin 206 range host; GitHub raw CORS is not fixed by this test.',
    'rAF intervals are scheduling proxies, not actual GPU presentation or GPU time.']};
let server,browser;
try{
  server=await serve();
  browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader',
    '--enable-unsafe-swiftshader','--disable-gpu-sandbox']});
  report.browserVersion=browser.version();
  for(let index=0;index<sequence.length;index++){
    const candidate=sequence[index],size=candidate==='b512'?512:1024;
    const run={index:index+1,candidate,tileSize:size,status:'running',candidateRequests:[],pageErrors:[],routeErrors:[],error:null};
    runs.push(run);const page=await browser.newPage({viewport:{width:1280,height:800},locale:'ko-KR',timezoneId:'Asia/Seoul'});
    let selected,manifestRequests=0,shaderRequests=0,processCdp;
    try{
      page.on('pageerror',error=>run.pageErrors.push(String(error)));
      if(candidate==='cog'){
        await page.route('**/__terrain_experiment/regional-q1.tif',route=>{
          const match=/^bytes=(\d+)-(\d+)$/.exec(route.request().headers().range||'');
          if(!match)return route.fulfill({status:416,body:''});
          const start=Number(match[1]),end=Math.min(Number(match[2]),cogBytes.length-1);
          if(start>=cogBytes.length||end<start)return route.fulfill({status:416,body:''});
          return route.fulfill({status:206,contentType:'image/tiff',body:cogBytes.subarray(start,end+1),
            headers:{'Content-Range':`bytes ${start}-${end}/${cogBytes.length}`,'Accept-Ranges':'bytes'}});
        });
        const init=`${cogBundle}\nglobalThis.__pandoCogReady=PandoCogFixture.openViewerCogTiles(${JSON.stringify({
          url:'http://127.0.0.1:4173/__terrain_experiment/regional-q1.tif',cogManifest,tileManifest:fixture,tileSize:size})});`;
        await page.addInitScript({content:init});
        await page.route('**/assets/js/modules/terrain-manifest.js*',async route=>{
          try{
            const response=await route.fetch(),source=await response.text();
            const marker='export async function fetchTerrainTile(request, { signal, fetchFn = fetch } = {}) {';
            if(!source.includes(marker))throw Error('Terrain tile source contract changed');
            const injection=`\n  if(globalThis.__pandoCogReady&&new URL(request.url).pathname.includes('/terrain/v0.15.0/5/')){\n    const key='5/'+new URL(request.url).pathname.split('/5/').pop();\n    return (await globalThis.__pandoCogReady).readTile(key,{signal});\n  }\n`;
            return await route.fulfill({status:200,contentType:'text/javascript',body:source.replace(marker,marker+injection)});
          }catch(error){run.routeErrors.push(String(error));return route.abort('failed');}
        });
      }
      await page.route('**/assets/js/modules/terrain-dem-shaders.js*',route=>{
        shaderRequests++;
        const body=`export function terrainDemFragmentSource(v){if(v===1)return ${JSON.stringify(a1TerrainFragmentSource(1))};if(v===2)return ${JSON.stringify(a1TerrainFragmentSource(2))};throw Error('WebGL version');}`;
        return route.fulfill({status:200,contentType:'text/javascript',body});
      });
      await page.route('**/terrain/v0.14.0/manifest.json*',async route=>{
        try{
          const original=await route.fetch();if(!original.ok())throw Error('Original terrain manifest fetch failed');
          selected=makeViewerFixtureManifest(await original.json(),fixture,size);manifestRequests++;
          return await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(selected.manifest)});
        }catch(error){run.routeErrors.push(String(error));return route.abort('failed');}
      });
      await page.route('https://raw.githubusercontent.com/kimjeon-il/PandoLab-library-data/**/terrain/v0.15.0/**',async route=>{
        try{
        const url=new URL(route.request().url()),parts=url.pathname.split('/terrain/v0.15.0/');
        const key=parts[1];
        if(!selected||!key)return route.abort('failed');
        if(key.startsWith('5/')){
          const item=selected.tiles.get(key);if(!item){run.candidateRequests.push({key,error:'outside fixture'});return route.abort('failed');}
          const response=await fetch(base+item.file);if(!response.ok)throw Error('Fixture tile HTTP '+response.status);
          const bytes=Buffer.from(await response.arrayBuffer());
          if(bytes.length!==item.bytes||digest(bytes)!==item.sha256)throw Error('Fixture tile identity mismatch: '+key);
          run.candidateRequests.push({key,bytes:bytes.length,sha256:item.sha256});
          return await route.fulfill({status:200,contentType:'image/webp',body:bytes});
        }
        const original=url.href.replace('/terrain/v0.15.0/','/terrain/v0.14.0/');
        return await route.fulfill({response:await route.fetch({url:original})});
        }catch(error){run.routeErrors.push(String(error));return route.abort('failed');}
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
        host.setViewState({projection:'globe',view:{...view,globeRotation:[-center[0],-center[1],0],globeZoom:32}});
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
      if(candidate==='cog'){
        run.cog=await page.evaluate(async()=>{const adapter=await globalThis.__pandoCogReady;
          return {counts:{...adapter.counts},range:{...adapter.statistics}};});
        if(!run.cog.counts.decodedTiles)throw Error('COG did not supply any visible tile');
      }
      run.center=selected.center;run.manifestRequests=manifestRequests;run.shaderRequests=shaderRequests;
      const screenshotPath=`${out}/viewer-${index+1}-${size}.png`,screenshotCdp=await page.context().newCDPSession(page);
      try{
        let timer;
        const capture=await Promise.race([screenshotCdp.send('Page.captureScreenshot',{
          format:'png',fromSurface:false,captureBeyondViewport:false}),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('CDP screenshot timed out')),45000);})]).finally(()=>clearTimeout(timer));
        const bytes=Buffer.from(capture.data,'base64');
        if(bytes.length<1024||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Invalid screenshot payload');
        await writeFile(screenshotPath,bytes);run.screenshotMethod='CDP Page.captureScreenshot fromSurface=false';
      }catch(error){
        run.screenshotCdpError=String(error);
        try{await page.screenshot({path:screenshotPath,timeout:30000});run.screenshotMethod='Playwright page.screenshot';}
        catch(fallback){run.screenshotError=String(fallback);}
      }finally{await screenshotCdp.detach().catch(()=>{});}
      run.status=run.pageErrors.length||run.routeErrors.length||run.screenshotError||run.candidateRequests.some(x=>x.error)?'failed':'passed';
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
console.log('TERRAIN_REGIONAL_EXPERIMENT '+JSON.stringify({status:report.status,runs:runs.map(run=>({candidate:run.candidate,tileSize:run.tileSize,status:run.status,error:run.error?.slice(0,200)}))}));
if(report.status!=='passed')process.exitCode=1;
