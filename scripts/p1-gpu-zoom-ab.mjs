// P1-1 GPU optimization A/B: same pinned dataset and Chromium host, no synthetic map.
// This harness is kept at one tested revision and run against two checked-out source commits.
import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { cpus, arch, platform } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

const args = Object.fromEntries(process.argv.slice(2).filter(s => s.startsWith('--')).map(s => {
  const at = s.indexOf('=');
  return [s.slice(2, at < 0 ? undefined : at), at < 0 ? '1' : s.slice(at + 1)];
}));
const out = args.out;
const backend = args.backend || 'webgl2';
const gpuMode = args.gpu || 'swiftshader';
const zooms = args.zooms === 'smoke' ? [1, 2, 4, 8, 16, 32] : Array.from({length:32}, (_, i) => i + 1);
const projections = ['globe', 'flat'];
const referencePin = () => JSON.parse(readFileSync('config/library-data.json', 'utf8')).revision;
const sourceSha = () => execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim();
const rounded = n => Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
const finite = n => typeof n === 'number' && Number.isFinite(n);
const quantile = (values, p) => {
  const v = values.filter(finite).sort((a,b) => a - b);
  if (!v.length) return null;
  const pos = (v.length - 1) * p, lo = Math.floor(pos), hi = Math.ceil(pos);
  return rounded(v[lo] + (v[hi] - v[lo]) * (pos - lo));
};
const save = (path, report) => {
  if (!path) throw Error('--out=<path> is required');
  mkdirSync(dirname(path), {recursive:true});
  writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
};
const metricDelta = (before, after, key) => finite(before?.[key]) && finite(after?.[key])
  ? rounded((after[key] - before[key]) * 1000) : null;

async function serve() {
  const proc = spawn(process.execPath, ['tests/browser/server.mjs'], {
    env:{...process.env, PANDOLAB_TEST_PORT:'4173'}, stdio:['ignore','pipe','pipe']
  });
  let logs = '';
  for (const stream of [proc.stdout, proc.stderr]) stream.on('data', data => {
    logs = (logs + String(data)).slice(-4000);
  });
  for (let i = 0; i < 450; i++) {
    if (proc.exitCode !== null) throw Error('Viewer server exited: ' + logs);
    try {
      if ((await fetch('http://127.0.0.1:4173/', {signal:AbortSignal.timeout(1500)})).ok) return proc;
    } catch { /* Server startup. */ }
    await delay(300);
  }
  proc.kill('SIGTERM');
  throw Error('Viewer server timeout: ' + logs);
}
async function pss(cdp) {
  if (!cdp || platform() !== 'linux') return null;
  try {
    const {processInfo} = await cdp.send('SystemInfo.getProcessInfo');
    let count = 0, bytes = 0;
    for (const p of processInfo) {
      if (!Number.isSafeInteger(p.id) || p.id <= 0) continue;
      const text = readFileSync('/proc/' + p.id + '/smaps_rollup', 'utf8');
      const v = /^Pss:\s+(\d+)\s+kB$/m.exec(text);
      if (!v) return null;
      bytes += Number(v[1]) * 1024;
      count++;
    }
    return count ? {bytes, processCount:count} : null;
  } catch { return null; }
}
const statsSubset = (s, selectedBackend) => ({
  renderer:s?.renderer ?? null,
  mapReady:s?.mapReadiness?.mapReady ?? null,
  activeMeshQuality:s?.activeMeshQuality ?? null,
  screenScale:s?.screenScale ?? null,
  screenLodBucket:s?.screenLodBucket ?? null,
  screenLodFailure:s?.screenLodFailure || null,
  screenLodPreparedCount:s?.screenLodPreparedCount ?? null,
  screenLodUploadCount:s?.screenLodUploadCount ?? null,
  sceneCacheFullDrawCount:s?.sceneCacheFullDrawCount ?? null,
  countryMeshRebuildCount:s?.countryMeshRebuildCount ?? null,
  countryMeshReuseCount:s?.countryMeshReuseCount ?? null,
  p95CpuSubmitMs:s?.p95CpuSubmitMs ?? null,
  p99CpuSubmitMs:s?.p99CpuSubmitMs ?? null,
  strokeDrawCallCount:s?.stroke?.drawCallCount ?? null,
  strokeCulledOwnerCount:s?.stroke?.culledOwnerCount ?? null,
  strokeMergedDrawRangeCount:s?.stroke?.mergedDrawRangeCount ?? null,
  webGlLastFrameSceneDrawCalls:s?.webGlLastFrameSceneDrawCalls ?? null,
  terrainCacheBytes:s?.terrainCacheBytes ?? null,
  hydroCacheBytes:s?.hydroCacheBytes ?? null,
  // App-tracked GPU allocation is not GPU VRAM and is inapplicable to Canvas.
  gpuTrackedBufferBytes:selectedBackend.startsWith('webgl') &&
      s?.meshVariantBytes && finite(s?.stroke?.activeBufferBytes) &&
      finite(s?.polygonOverlay?.activeBufferBytes)
    ? Object.values(s.meshVariantBytes).reduce((sum, n) => sum + (finite(n) ? n : 0), 0)
      + s.stroke.activeBufferBytes + s.polygonOverlay.activeBufferBytes
    : null
});
const deviceIdentity = () => ({
  environment:process.env.GITHUB_ACTIONS === 'true' ? 'github-actions-runner' : 'local-host',
  runnerName:process.env.RUNNER_NAME || null,
  runnerOs:process.env.RUNNER_OS || null,
  physicalDeviceVerified:false, // A cloud VM or reported GPU name alone does not prove physical hardware.
  platform:platform(), arch:arch(), cpuModel:cpus()[0]?.model || null,
  logicalCpus:cpus().length
});
function expectedMode(mode) {
  return mode === 'canvas' ? 'canvas-worker' : mode;
}
const identity = report => ({
  sourceCommit:report.sourceCommit, dataPin:report.dataPin, gpuMode:report.gpuMode,
  browserVersion:report.browserVersion, gpu:report.gpu,
  backend:report.backend, zooms:report.zooms,
  viewport:report.viewport, device:report.device, frozenClock:report.frozenClock
});
async function measure() {
  if (!['webgl2','webgl1','canvas'].includes(backend)) throw Error('Invalid --backend');
  if (!['swiftshader','native'].includes(gpuMode)) throw Error('Invalid --gpu');
  const report = {
    schema:'pando-p1-gpu-zoom-ab-v1', sourceCommit:sourceSha(), dataPin:referencePin(),
    backend, gpuMode, expectedRuntimeBackend:expectedMode(backend),
    zooms, projections, viewport:[1280,800], frozenClock:'2026-11-06T03:00:00+09:00',
    device:deviceIdentity(), browserVersion:null, gpu:null,
    startedAt:new Date().toISOString(), finishedAt:null, status:'running',
    coldStartMs:null, rows:[], errors:[], unsupported:[],
    limitations:[
      'A source checkout on a GitHub-hosted runner is not a verified physical user device.',
      'rAF intervals are scheduling cadence, not GPU-presented frames or true GPU FPS.',
      'CDP TaskDuration/ScriptDuration are main renderer thread time, not host CPU utilization.',
      'Chromium process-family Linux PSS is not GPU VRAM; GPU buffers are application tracked.',
      'The current Web Viewer is globe-only. A flat result needs a real supported flat product; do not fake it.',
      'One sweep per revision is descriptive; not a statistically powered performance claim.'
    ]
  };
  let server, browser, context, page, cdp, systemCdp;
  let benchmarkError = null;
  try {
    server = await serve();
    browser = await chromium.launch({headless:true,args:gpuMode==='swiftshader'
      ? ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox']
      : [], timeout:90000});
    report.browserVersion = browser.version();
    context = await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:1,
      timezoneId:'Asia/Seoul',locale:'ko-KR',reducedMotion:'reduce'});
    page = await context.newPage();
    page.on('pageerror', e => report.errors.push('pageerror: '+String(e)));
    await page.addInitScript(() => {
      const p = globalThis.__p1ZoomProbe = {
        last:null,gaps:[],longTasks:[],active:false,
        begin(){this.gaps=[];this.longTasks=[];this.last=null;this.active=true;},
        end(){
          this.active=false;
          const vals=this.gaps.slice().sort((a,b)=>a-b);
          const at=q=>vals.length ? vals[Math.round((vals.length-1)*q)] : null;
          return {rafSamples:vals.length,rafP50GapMs:at(.5),rafP95GapMs:at(.95),
            rafMaxGapMs:vals.at(-1)??null, longTaskCount:this.longTasks.length,
            longTaskMaxMs:this.longTasks.length ? Math.max(...this.longTasks) : 0};
        }
      };
      try {new PerformanceObserver(list => {
        if(p.active) for(const e of list.getEntries()) p.longTasks.push(e.duration);
      }).observe({type:'longtask', buffered:false});} catch {}
      const tick=t=>{if(p.active){if(p.last!==null)p.gaps.push(t-p.last);p.last=t;}requestAnimationFrame(tick);};
      requestAnimationFrame(tick);
    });
    await page.clock.setFixedTime(new Date(report.frozenClock));
    await page.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});
    cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    systemCdp = await browser.newBrowserCDPSession();
    const start = performance.now();
    await page.goto('http://127.0.0.1:4173/?debug=1&renderer=' + backend,
      {waitUntil:'domcontentloaded',timeout:120000});
    await page.waitForFunction(() => {
      const v=globalThis.__PANDOLAB_VIEWER__, s=v?.rendererStats?.();
      return s?.canonicalMeshReady && s?.mapReadiness?.mapReady &&
        s.countriesPublishedGeneration === s.projectGeneration &&
        document.getElementById('viewerStatus')?.dataset.ready === 'true';
    }, null, {timeout:180000, polling:250});
    report.coldStartMs = rounded(performance.now() - start);
    report.gpu = await page.evaluate(expected => {
      const s=globalThis.__PANDOLAB_VIEWER__.rendererStats();
      const canvas=document.querySelector('#map .gpu-map-canvas');
      const gl=expected === 'canvas' ? null : canvas?.getContext(expected === 'webgl2' ? 'webgl2' : 'webgl');
      const debug=gl?.getExtension('WEBGL_debug_renderer_info');
      return {actualRenderer:s.renderer, version:gl?.getParameter(gl.VERSION)??null,
        vendor:gl?.getParameter(gl.VENDOR)??null,
        renderer:gl?.getParameter(gl.RENDERER)??null,
        unmaskedVendor:debug?gl.getParameter(debug.UNMASKED_VENDOR_WEBGL):null,
        unmaskedRenderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):null,
        devicePixelRatio:window.devicePixelRatio,
        canvasWidth:canvas?.width??null,canvasHeight:canvas?.height??null};
    }, backend);
    if (report.gpu.actualRenderer !== expectedMode(backend))
      throw Error('Requested '+backend+' but actual runtime is '+report.gpu.actualRenderer+'; no fallback-as-success');
    if (backend.startsWith('webgl') && !report.gpu.version?.includes(backend==='webgl2'?'WebGL 2.0':'WebGL 1.0'))
      throw Error('Requested GPU version unavailable: ' + JSON.stringify(report.gpu));
    const counters = async () => Object.fromEntries(
      (await cdp.send('Performance.getMetrics')).metrics.map(item => [item.name,item.value]));
    const accepted = async (projection, zoom) => page.waitForFunction(({projection,zoom,mode}) => {
      const host=globalThis.__PANDOLAB_MAP_HOST__, state=host?.getViewState?.();
      const s=globalThis.__PANDOLAB_VIEWER__?.rendererStats?.();
      return state?.projection === projection && Math.abs(state.zoom-zoom) < 1e-8 &&
        s?.renderer === mode && s.canonicalMeshReady && s.mapReadiness?.mapReady &&
        s.countriesPublishedGeneration === s.projectGeneration &&
        s.activeMeshQuality === 'lod' && s.screenLodTargetKey &&
        s.screenLodBucket && s.screenLodLatest?.key === s.screenLodBucket &&
        !s.screenLodPreparingKey && !s.screenLodFailure &&
        (mode !== 'canvas-worker' || (!s.canvasWorkerBusy && !s.canvasWorkerHasPendingFrame &&
          s.canvasDisplayedStyleRevision === s.canvasStyleRevision));
    }, {projection,zoom,mode:expectedMode(backend)}, {timeout:110000,polling:150});

    for (const projection of projections) {
      let unsupported = null;
      for (const zoom of zooms) {
        if (unsupported) {
          report.rows.push({projection,zoom,status:'unsupported',reason:unsupported});
          continue;
        }
        const row = {projection,zoom,status:'running',elapsedMs:null,cpuTaskMs:null,
          cpuScriptMs:null,raf:null,mainJsHeapBytes:null,chromiumFamilyPssBytes:null,
          stats:null,actualProjection:null,actualZoom:null,error:null};
        let probeStarted=false;
        try {
          const before = await counters();
          await page.evaluate(() => globalThis.__p1ZoomProbe.begin());
          probeStarted=true;
          const started = performance.now();
          await page.evaluate(({projection,zoom}) => {
            const host=globalThis.__PANDOLAB_MAP_HOST__;
            host.setViewState({projection,view:{flatCenter:[127.8,36.5],flatZoom:zoom,
              globeRotation:[-127.8,-36.5,0],globeZoom:zoom}});
            host.requestRepaint('p1-gpu-zoom-ab');
          }, {projection,zoom});
          const actual=await page.evaluate(() => globalThis.__PANDOLAB_MAP_HOST__.getViewState());
          if (actual.projection !== projection) {
            unsupported='Projection rejected by product policy: requested='+projection+
              ', actual='+actual.projection;
          } else {
            await accepted(projection,zoom);
            row.elapsedMs=rounded(performance.now()-started);
            row.status='passed';
          }
          row.actualProjection=actual.projection;
          row.actualZoom=actual.zoom;
          const after = await counters();
          row.cpuTaskMs=metricDelta(before,after,'TaskDuration');
          row.cpuScriptMs=metricDelta(before,after,'ScriptDuration');
          row.mainJsHeapBytes=after.JSHeapUsedSize??null;
          const s=await page.evaluate(() => globalThis.__PANDOLAB_VIEWER__.rendererStats());
          row.stats=statsSubset(s,backend);
          // PSS capture is heavyweight; gather at fixed checkpoints, never fill skipped cells with zero.
          if ([1,8,16,32].includes(zoom)) row.chromiumFamilyPssBytes=(await pss(systemCdp))?.bytes??null;
        } catch (e) {
          row.error=String(e?.stack||e).slice(0,1500);
          if (projection==='flat' && /PL-PRODUCT-PROJECTION|supports only the globe projection|projection is fixed/i.test(row.error)) {
            unsupported='Flat projection is prohibited by the actual Viewer product policy';
          } else {
            row.status='failed';
            report.errors.push(projection+' '+zoom+': '+row.error);
          }
        } finally {
          if(probeStarted) row.raf=await page.evaluate(() => globalThis.__p1ZoomProbe.end()).catch(() => null);
        }
        if (unsupported) {
          row.status='unsupported';row.reason=unsupported;row.elapsedMs=null;
          report.unsupported.push({projection,reason:unsupported});
        }
        report.rows.push(row);
        console.log('P1_GPU_ZOOM '+JSON.stringify({backend,projection,zoom,status:row.status,
          elapsedMs:row.elapsedMs,cpuTaskMs:row.cpuTaskMs,rafP95:row.raf?.rafP95GapMs,
          gpuTrackedBufferBytes:row.stats?.gpuTrackedBufferBytes,error:row.error}).slice(0,1200));
      }
    }
    const good = report.rows.filter(r=>r.status==='passed').length;
    const partial = report.rows.filter(r=>r.status==='unsupported').length;
    report.status=report.errors.length?'failed':(good===zooms.length*projections.length?'passed':
      (good>0 && partial ? 'partial':'failed'));
  } catch (e) {
    benchmarkError=String(e?.stack||e).slice(0,4000);
    report.errors.push(benchmarkError);
    report.status='failed';
  } finally {
    report.finishedAt=new Date().toISOString();
    report.actualCells=report.rows.filter(r=>r.status==='passed').length;
    report.unsupportedCells=report.rows.filter(r=>r.status==='unsupported').length;
    report.failedCells=report.rows.filter(r=>r.status==='failed').length;
    report.fatalError=benchmarkError;
    save(out,report);
    console.log('P1_GPU_ZOOM_SAMPLE '+JSON.stringify({
      source:report.sourceCommit, backend, status:report.status, actualCells:report.actualCells,
      unsupportedCells:report.unsupportedCells, failedCells:report.failedCells,
      gpu:report.gpu?.unmaskedRenderer,errors:report.errors.slice(0,2)}));
    await cdp?.detach().catch(()=>{});
    await systemCdp?.detach().catch(()=>{});
    await context?.close().catch(()=>{});
    await browser?.close().catch(()=>{});
    if(server){
      server.kill('SIGTERM');
      await Promise.race([new Promise(r=>server.once('exit',r)),delay(2000)]);
      if(server.exitCode===null)server.kill('SIGKILL');
    }
  }
  if(report.status==='failed')process.exitCode=1;
}
function compare() {
  const base=JSON.parse(readFileSync(args.baseline,'utf8'));
  const next=JSON.parse(readFileSync(args.candidate,'utf8'));
  const issues=[];
  const json=value=>JSON.stringify(value);
  if(base.schema!=='pando-p1-gpu-zoom-ab-v1'||next.schema!==base.schema)issues.push('schema-mismatch');
  if(base.sourceCommit===next.sourceCommit)issues.push('same-commit-not-ab');
  if(base.status==='failed'||next.status==='failed'||base.status==='running'||next.status==='running')
    issues.push('source-measurement-failed');
  for(const key of ['dataPin','backend','gpuMode','expectedRuntimeBackend','viewport','frozenClock','browserVersion','zooms','projections'])
    if(json(base[key])!==json(next[key]))issues.push('different-'+key);
  if(base.device?.platform!==next.device?.platform || base.device?.cpuModel!==next.device?.cpuModel ||
    base.device?.logicalCpus!==next.device?.logicalCpus)issues.push('different-host-class');
  if(base.gpu?.unmaskedRenderer!==next.gpu?.unmaskedRenderer ||
    base.gpu?.actualRenderer!==next.gpu?.actualRenderer)issues.push('different-gpu-runtime');
  if(base.rows.length!==next.rows.length || base.rows.length!==base.zooms.length*base.projections.length)
    issues.push('incomplete-matrix-length');
  const cells=[];
  for(const b of base.rows) {
    const c=next.rows.find(r=>r.projection===b.projection&&r.zoom===b.zoom);
    const ok=!!c && b.status==='passed' && c.status==='passed';
    const delta=(name)=>ok&&finite(b[name])&&finite(c[name])&&b[name]>0
      ? rounded((c[name]-b[name])/b[name]*100) : null;
    cells.push({projection:b.projection,zoom:b.zoom,baselineStatus:b.status,
      candidateStatus:c?.status??'missing',comparable:ok,reason:ok?null:
        (b.reason||c?.reason||b.error||c?.error||'missing-verified-frame'),
      baselineMs:ok?b.elapsedMs:null,candidateMs:ok?c.elapsedMs:null,
      transitionDeltaPercent:delta('elapsedMs'),cpuDeltaPercent:delta('cpuTaskMs'),
      baselineRafP95Ms:ok?b.raf?.rafP95GapMs??null:null,
      candidateRafP95Ms:ok?c.raf?.rafP95GapMs??null:null,
      baselineTrackedGpuBytes:ok?b.stats?.gpuTrackedBufferBytes??null:null,
      candidateTrackedGpuBytes:ok?c.stats?.gpuTrackedBufferBytes??null:null});
  }
  const paired=cells.filter(r=>r.comparable),missing=cells.filter(r=>!r.comparable);
  const result={
    schema:'pando-p1-gpu-zoom-comparison-v1',
    status:issues.length?'invalid':missing.length?'partial':'complete',
    comparable:issues.length===0, issues, reference:identity(base),candidate:identity(next),
    pairedCells:paired.length,unsupportedOrFailedCells:missing.length,
    rows:cells,
    summary:{
      globePaired:paired.filter(x=>x.projection==='globe').length,
      flatPaired:paired.filter(x=>x.projection==='flat').length,
      transitionDeltaMedianPercent:quantile(paired.map(x=>x.transitionDeltaPercent),.5),
      cpuDeltaMedianPercent:quantile(paired.map(x=>x.cpuDeltaPercent),.5),
      regressionsOver20Percent:paired.filter(x=>x.transitionDeltaPercent>20)
        .map(x=>({projection:x.projection,zoom:x.zoom,deltaPercent:x.transitionDeltaPercent})),
    },
    limitations:[
      'GitHub Actions GPU/CPU are hosted runner measurements, not verified physical-user-device numbers.',
      'One source-paired sweep per zoom; no statistical significance or approved FPS threshold.',
      'Flat projection cells are unmeasured where the immutable globe Viewer rejects flat.',
      'A negative transition delta indicates a faster candidate, not proof of GPU acceleration.',
      'rAF p95 is not native compositor present latency; GPU VRAM is unavailable.'
    ]
  };
  save(out,result);
  console.log('P1_GPU_ZOOM_COMPARISON '+JSON.stringify({
    status:result.status,issues,paired:result.pairedCells,
    missing:result.unsupportedOrFailedCells,summary:result.summary
  }));
  if(process.env.GITHUB_STEP_SUMMARY){
    const lines=['### P1-1 GPU zoom A/B (source-paired)','Base: '+base.sourceCommit,
      'Current: '+next.sourceCommit,'Data pin: '+base.dataPin,
      'Actual browser/backend: '+base.browserVersion+' / '+base.backend,
      'Status: '+result.status+', valid pairs: '+result.pairedCells+'/'+cells.length,
      'Globe pairs: '+result.summary.globePaired+', flat pairs: '+result.summary.flatPaired,
      'Median transition delta: '+result.summary.transitionDeltaMedianPercent+'%',
      'Reported renderer: '+(base.gpu?.unmaskedRenderer||'not reported'),
      'Physical-user-device verified: no','',
      '| Projection | Zoom | Before ms | After ms | Delta % | Status |',
      '|---|---:|---:|---:|---:|---|',
      ...cells.map(x=>'| '+x.projection+' | '+x.zoom+' | '+(x.baselineMs??'—')+
        ' | '+(x.candidateMs??'—')+' | '+(x.transitionDeltaPercent??'—')+
        ' | '+(x.comparable?'paired':'not measured')+' |')];
    writeFileSync(process.env.GITHUB_STEP_SUMMARY,lines.join('\n')+'\n',{flag:'a'});
  }
  // A partial matrix is NOT acceptance: do not turn missing flat samples into success.
  if(result.status!=='complete')process.exitCode=1;
}
if(args.mode==='compare')compare();
else await measure();
