import { gotoEditor } from './helpers/editor-entry.mjs';
import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { createP3PreviewServer } from '../../scripts/p3-preview-server.mjs';
import { installP9EditWorkload, runP9EditWorkload, readP9EditWorkload, P9_EDIT_METRIC_KEYS } from './helpers/p9-edit-workload.mjs';

const baselineSha = 'd57e235cc4b8c7f94a603d4352556f11b28bc735';
const candidateRoot = fileURLToPath(new URL('../../', import.meta.url));
const viewport = { width: 1440, height: 900 };
const hardware = process.env.PANDO_P9_HARDWARE === 'true';
const editWorkload = process.env.PANDO_P9_WORKLOAD === 'edit';
const gpuArgs = hardware ? [] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const median = values => {
  const sorted = [...values].sort((a,b)=>a-b), index = Math.floor(sorted.length/2);
  return sorted.length%2 ? sorted[index] : (sorted[index-1]+sorted[index])/2;
};
const percentile = (values, fraction) => [...values].sort((a,b)=>a-b)[Math.ceil(values.length*fraction)-1];
const gitHead = root => execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
function verifyBaseline(root) {
  if (existsSync(resolve(root, '.git'))) {
    expect(gitHead(root), 'baseline HEAD must match the pre-P6 revision').toBe(baselineSha);
    expect(execFileSync('git', ['diff', '--name-only', 'HEAD', '--', 'index.html', 'assets'], { cwd: root, encoding: 'utf8' }).trim()).toBe('');
    return { kind: 'checkout', sha: baselineSha };
  }
  // A static git archive is a measurement input, with no branch or worktree.
  // Verify every served baseline blob against the fixed Git tree before use.
  const tree = execFileSync('git', ['ls-tree', '-rz', baselineSha, '--', 'index.html', 'assets'], {
    cwd: candidateRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  let count = 0;
  for (const entry of tree.split('\0').filter(Boolean)) {
    const match = /^\d+ blob ([a-f0-9]{40})\t(.+)$/.exec(entry);
    expect(match, `Unexpected baseline tree entry ${entry}`).toBeTruthy();
    const bytes = readFileSync(resolve(root, match[2]));
    const hash = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    expect(hash, `Changed baseline input ${match[2]}`).toBe(match[1]);
    count++;
  }
  expect(count).toBeGreaterThan(0);
  return { kind: 'verified-static-git-archive', sha: baselineSha, verifiedBlobs: count };
}
const metricKeys = editWorkload ? P9_EDIT_METRIC_KEYS : ['interactivePaintMs','editableMs','frameP95Ms','jsHeapUsedBytes'];
const summarize = rounds => Object.fromEntries(metricKeys.map(key=>{
  const baseline = rounds.map(row=>row.baseline[key]), candidate = rounds.map(row=>row.candidate[key]);
  return [key, {
    baseline, candidate, baselineMedian: median(baseline), candidateMedian: median(candidate),
    baselineRange: [Math.min(...baseline),Math.max(...baseline)], candidateRange: [Math.min(...candidate),Math.max(...candidate)],
    // Same deliberately simple rule as p6-calculation-performance.mjs; this is
    // a distribution comparison, not a statistical significance claim.
    status: Math.min(...candidate)>Math.max(...baseline) ? 'regression'
      : median(candidate)>median(baseline) ? 'uncertain' : 'no-regression',
  }];
}));

test.use({ trace: 'off', screenshot: 'off' });

test(`P9 alternates fixed baseline and candidate ${editWorkload ? 'large RUS editing, Worker and autosave' : 'browser startup, focus frames and main-page heap'}`, async ({ playwright, baseURL }, testInfo) => {
  // Full RUS save verification is deliberately outside compared timing and is
  // expensive on the baseline. Allow the specified two rounds to finish once.
  test.setTimeout((editWorkload ? 45 : 30)*60_000);
  const report = {
    schema: 'pando-p9-browser-performance-v1', baselineSha, candidateSha: gitHead(candidateRoot),
    status: 'unverified', rounds: [], warmups: {}, metrics: {},
    scope: `Chromium ${hardware ? 'physical GPU' : 'software WebGL'} ${editWorkload ? 'full RUS line preparation/cancellation, Worker RTT/compute, main-page LongTask/rAF and real autosave/Undo' : 'startup and RUS selection/focus; main-page JS heap only'}.`,
    notVerified: [...(hardware ? [] : ['physical GPU']), 'Qt startup/frames/memory', 'Android touch', ...(editWorkload ? ['startup/focus/heap are in a separate completed report'] : ['large geometry edit frames']), 'Worker/WASM/GPU/process memory'],
    conditions: { viewport, deviceScaleFactor: 1, softwareGpuArguments: gpuArgs,
      httpCache: 'disabled by CDP on both pages', serviceWorkers: 'blocked',
      storage: 'separate fresh contexts, retained per side after one warmup; Cache Storage may be warm',
      concurrency: 'one application page at a time; previous page and CDP session closed before every sample',
      frames: editWorkload ? 'Actual rAF intervals during the existing full-RUS line-preparation and cancellation workflow; no idle intervals appended' : 'Reset the view through the existing command before every RUS focus; 120 consecutive requestAnimationFrame intervals starting immediately before focus, excluding pointer and panel animation timing',
      frameCollectionDeadlineMs: 120_000,
      warmupsPerContext: 1, initialAlternatingRounds: 5, maximumExtraRoundsIfUncertain: 5,
      memory: 'CDP Performance.getMetrics JSHeapUsedSize after focus frames, no forced GC',
      node: process.version, cpu: os.cpus()[0]?.model, platform: process.platform },
  };
  let server, browser, activePage = null, activeCdp = null;
  const reportPath=testInfo.outputPath('p9-browser-performance.json');
  async function checkpoint(stage) {
    report.stage=stage;
    await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
    console.log(`P9 ${editWorkload?'RUS edit':'startup'}: ${stage}; complete pairs=${report.rounds.length}`);
  }
  try {
    const baselineRoot = process.env.PANDO_P9_BASELINE_ROOT;
    expect(baselineRoot, 'PANDO_P9_BASELINE_ROOT must name the fixed baseline checkout').toBeTruthy();
    report.conditions.baselineInput = verifyBaseline(resolve(baselineRoot));
    expect(baseURL, 'candidate baseURL is required').toBeTruthy();
    server = createP3PreviewServer(baselineRoot);
    await new Promise((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done);});
    const baselineUrl = `http://127.0.0.1:${server.address().port}/?debug=1&renderer=webgl2`;
    const candidateUrl = new URL('/?debug=1&renderer=webgl2',baseURL).href;
    const launch = testInfo.project.use.launchOptions || {};
    browser = await playwright.chromium.launch({ ...launch, channel: testInfo.project.use.channel,
      headless: !hardware, args: [...(launch.args||[]),...gpuArgs] });
    report.conditions.browserVersion = browser.version();
    const sides = {};
    for(const [side,url] of Object.entries({baseline:baselineUrl,candidate:candidateUrl})) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1, serviceWorkers: 'block',
        locale: 'ko-KR', timezoneId: 'UTC', colorScheme: 'light' });
      sides[side] = {context,url};
    }
    async function sample(side) {
      if(activeCdp) { await activeCdp.detach(); activeCdp = null; }
      if(activePage) { await activePage.close(); activePage = null; }
      const {context,url} = sides[side];
      const page = await context.newPage(); activePage = page;
      if(editWorkload) await installP9EditWorkload(page);
      const cdp = await context.newCDPSession(page); activeCdp = cdp;
      await cdp.send('Network.enable');
      await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
      await cdp.send('Performance.enable');
      await page.bringToFront();
      await gotoEditor(page, url,{waitUntil:'domcontentloaded'});
      await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:120_000});
      if(editWorkload) {
        const edit = await runP9EditWorkload(page);
        report.conditions.editInput ??= edit.input;
        expect(edit.input, 'Every side and round must edit identical canonical input').toEqual(report.conditions.editInput);
        return { ...edit.metrics, editWorkload: edit };
      }
      const startup = await page.evaluate(()=>({
        interactivePaintMs: globalThis.__PANDOLAB_STARTUP_METRICS__?.interactivePaintMs,
        editableMs: globalThis.__PANDOLAB_STARTUP_METRICS__?.editableMs,
      }));
      for(const [key,value] of Object.entries(startup))expect(typeof value==='number'&&Number.isFinite(value)&&value>=0,`${side} missing startup ${key}`).toBe(true);
      // The retained context restores the last saved RUS view on later pages.
      // Reset through the real command so every sample performs the same move.
      await page.locator('#resetViewBtn').evaluate(button=>button.click());
      await page.evaluate(()=>window.PANDOLAB_TERRITORIAL.select('RUS'));
      await expect(page.locator('#propertyTitle')).toHaveText('러시아');
      const focus = page.locator('#focusSelectedObjectBtn');
      await expect(focus).toHaveCount(1);await expect(focus).toBeEnabled();
      const beforeView = await page.evaluate(()=>JSON.stringify(window.__PANDOLAB_VIEW_DEBUG__.snapshot()));
      await page.evaluate(()=>{
        const state = {intervals:[],done:false};globalThis.__p9FocusFrames=state;
        let previous=null;
        const frame=time=>{if(previous!==null)state.intervals.push(time-previous);previous=time;
          if(state.intervals.length===120)state.done=true;else requestAnimationFrame(frame);};
        requestAnimationFrame(frame);
      });
      await focus.evaluate(button=>button.click());
      expect(await page.evaluate(()=>JSON.stringify(window.__PANDOLAB_VIEW_DEBUG__.snapshot()))).not.toBe(beforeView);
      await page.waitForFunction(()=>globalThis.__p9FocusFrames.done,undefined,{timeout:report.conditions.frameCollectionDeadlineMs});
      const frames = await page.evaluate(()=>globalThis.__p9FocusFrames.intervals);
      expect(frames).toHaveLength(120);
      expect(frames.every(value=>Number.isFinite(value)&&value>0)).toBe(true);
      const {metrics} = await cdp.send('Performance.getMetrics');
      const heap = metrics.find(item=>item.name==='JSHeapUsedSize')?.value;
      expect(Number.isFinite(heap)&&heap>0,`${side} CDP heap metric unavailable`).toBe(true);
      return {...startup,frameP95Ms:percentile(frames,.95),frameIntervalsMs:frames,jsHeapUsedBytes:heap};
    }
    for(const side of ['baseline','candidate']) {
      report.warmups[side] = await sample(side);
      await checkpoint(`warmup-${side}`);
      const renderer = await activePage.evaluate(()=>{
        const canvas=document.querySelector('#map canvas'),gl=canvas?.getContext('webgl2');
        if(!gl)return null;const info=gl.getExtension('WEBGL_debug_renderer_info');
        const name=info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
        return name;
      });
      report.conditions[side+'Renderer'] = renderer;
      if(hardware) {
        expect(renderer,`${side} application GL context is required`).toBeTruthy();
        expect(renderer,`${side} must use the physical GPU`).not.toMatch(/SwiftShader|llvmpipe|software/i);
      } else expect(renderer,`${side} must use software SwiftShader`).toMatch(/SwiftShader/i);
    }
    async function measureFive() {
      for(let count=0;count<5;count++) {
        const round={index:report.rounds.length};
        round.order=round.index%2?['candidate','baseline']:['baseline','candidate'];
        for(const side of round.order)round[side]=await sample(side);
        report.rounds.push(round);
        await checkpoint(`pair-${round.index+1}`);
      }
      report.metrics=summarize(report.rounds);
    }
    await measureFive();
    if(Object.values(report.metrics).some(metric=>metric.status==='uncertain'))await measureFive();
    report.status=Object.values(report.metrics).some(metric=>metric.status==='regression')?'regression'
      :Object.values(report.metrics).some(metric=>metric.status==='uncertain')?'uncertain':'no-regression';
    expect(report.status,'See attached distributions; uncertain results do not satisfy P9').toBe('no-regression');
  } catch(error) {
    if(editWorkload && activePage && !activePage.isClosed()) {
      try { report.partialEditWorkload = await readP9EditWorkload(activePage); }
      catch(diagnosticError) { report.partialEditWorkloadError = diagnosticError.message; }
    }
    if(activeCdp) {
      try {
        const partial = await activeCdp.send('Runtime.evaluate', { expression: 'JSON.stringify({frames:globalThis.__p9FocusFrames,visibility:document.visibilityState,render:globalThis.__PANDOLAB_RENDER_DEBUG__?.snapshot()})', returnByValue: true, timeout: 5000 });
        report.partialSample = JSON.parse(partial.result.value || 'null');
      } catch(diagnosticError) { report.partialSampleError = diagnosticError.message; }
    }
    report.error={name:error.name,message:error.message};throw error;
  } finally {
    await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
    await testInfo.attach('p9-browser-performance.json',{path:reportPath,contentType:'application/json'});
    if(browser)await browser.close();
    if(server)await new Promise((done,reject)=>{server.close(error=>error?reject(error):done());server.closeIdleConnections();});
  }
});
