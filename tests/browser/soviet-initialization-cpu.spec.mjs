import { gotoEditor } from './helpers/editor-entry.mjs';
import { expect, test } from '@playwright/test';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';

test.use({ trace: 'off', viewport: { width: 1440, height: 900 } });

function cpuProfileSummary(profile) {
  const nodes = new Map((profile.nodes || []).map(node => [node.id, node]));
  const time = new Map(), files = new Map();
  for (let i = 0; i < (profile.samples || []).length; i += 1) {
    const frame = nodes.get(profile.samples[i])?.callFrame;
    if (!frame) continue;
    const name = String(frame.functionName || '(anonymous)');
    const source = String(frame.url || '').replace(/[?#].*$/, '').split('/').slice(-2).join('/');
    const key = name + ' @ ' + source + ':' + (Number(frame.lineNumber || 0) + 1);
    const ms = Number(profile.timeDeltas?.[i] || 1000) / 1000;
    time.set(key, (time.get(key) || 0) + ms);
    files.set(source, (files.get(source) || 0) + ms);
  }
  return {
    sampleCount: profile.samples?.length || 0,
    profileSpanMs: Number(((profile.endTime - profile.startTime) / 1000).toFixed(1)),
    topSelfMs: [...time].sort((a, b) => b[1] - a[1]).slice(0, 35).map(([symbol, ms]) => ({ symbol, ms: Math.round(ms * 10) / 10 })),
    bySourceSelfMs: [...files].sort((a, b) => b[1] - a[1]).slice(0, 22).map(([source, ms]) => ({ source, ms: Math.round(ms * 10) / 10 })),
  };
}
async function browserPssKiB() {
  const dirs = (await readdir('/proc')).filter(name => /^\d+$/.test(name));
  let total = 0, count = 0, rendererKiB = 0, gpuKiB = 0;
  for (const pid of dirs) {
    try {
      const comm = (await readFile('/proc/' + pid + '/comm', 'utf8')).trim();
      if (!/(chrome|chromium|headless_shell|headless-shell)/i.test(comm)) continue;
      const cmd = (await readFile('/proc/' + pid + '/cmdline', 'utf8')).replaceAll('\0',' ');
      if (!/(chrome|chromium|headless_shell|headless-shell)/i.test(cmd)) continue;
      const smaps = await readFile('/proc/' + pid + '/smaps_rollup', 'utf8');
      const kb = Number(smaps.match(/^Pss:\s*(\d+)\s*kB/m)?.[1] || 0);
      total += kb; count++;
      if (cmd.includes('--type=renderer')) rendererKiB += kb;
      if (cmd.includes('--type=gpu-process')) gpuKiB += kb;
    } catch { /* transient process */ }
  }
  return { totalKiB: total, rendererKiB, gpuKiB, processes: count };
}
async function memorySample(page, cdp, label) {
  let heap = null;
  await cdp.send('HeapProfiler.collectGarbage');
  await page.waitForTimeout(200);
  try { heap = await cdp.send('Runtime.getHeapUsage'); } catch { /* Optional CDP heap metric. */ }
  const app = await page.evaluate(() => {
    const d = window.__PANDOLAB_RENDER_DEBUG__.snapshot(), g = d.gpu;
    return {
      memory: { usedJSHeapSize: performance.memory?.usedJSHeapSize || null,
        totalJSHeapSize: performance.memory?.totalJSHeapSize || null },
      workerCount: performance.getEntriesByType('resource').filter(x => x.initiatorType === 'worker').length,
      gpuStrokeBytes: g.stroke.activeBufferBytes, selectionStrokeBytes: g.selection?.activeBufferBytes || 0,
      geometryCacheBytes: d.renderScene.cacheBytes, sceneCachePixels: (g.sceneCache.width || 0) * (g.sceneCache.height || 0),
      selectedSegments: g.selection?.segmentCount || 0,
      selectionFallback: d.selection.fallbackCount || 0,
    };
  });
  const autosave = await page.evaluate(() => {
    const report = window.__PANDOLAB_PERFORMANCE_REPORT__?.();
    const record = report?.operations?.['autosave.persist'];
    return { count: record?.count || 0, samples: (record?.samples || []).slice(-3).map(item => ({
      durationMs: item.durationMs, detail: item.detail,
    })) };
  });
  return { label, app, cdpMainHeap: heap?.usedSize || null, chromiumPss: await browserPssKiB(),
    workerUrls: page.workers().map(worker => new URL(worker.url()).pathname), autosave };
}
async function month(page, text) {
  await page.locator('#timelineMonthButton').click();
  await page.locator('#timelineMonthInput').fill(text);
  await page.locator('#timelineMonthInput').press('Enter');
  await expect(page.locator('#timelineMonthInput')).toBeHidden({ timeout: 90_000 });
}
test('attribute first Soviet timeline and GPU-selection CPU cost, then test memory retention', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await gotoEditor(page, '/?perf=1&renderer=webgl2');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 120_000 });
  await expect.poll(() => page.evaluate(() => {
    const g = window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu;
    return g?.renderer === 'webgl2' && g.canonicalMeshReady && !g.countrySharedBoundaryReplacementPending;
  }), { timeout: 80_000 }).toBe(true);
  await page.locator('#flatBtn').evaluate(button => button.click());
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
  const memory = [];
  memory.push(await memorySample(page, cdp, 'modern-world-after-main-gc'));
  await cdp.send('Profiler.start');
  const timelineStarted = await page.evaluate(() => performance.now());
  await month(page, '1989-06');
  await expect.poll(() => page.evaluate(() =>
    window.PANDOLAB_TERRITORIAL.get('state:soviet-union')?.geometry?.coordinates?.length || 0),
    { timeout: 90_000 }).toBeGreaterThan(0);
  const timelineWallMs = (await page.evaluate(() => performance.now())) - timelineStarted;
  const timelineCpu = cpuProfileSummary((await cdp.send('Profiler.stop')).profile);
  memory.push(await memorySample(page, cdp, 'soviet-1989-after-main-gc'));

  await cdp.send('Profiler.start');
  const selectStarted = await page.evaluate(() => performance.now());
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('state:soviet-union'));
  await expect.poll(() => page.evaluate(() => {
    const d = window.__PANDOLAB_RENDER_DEBUG__.snapshot();
    return d.gpu.selection?.segmentCount > 0 && d.gpu.selection?.channels?.primary?.drawSucceeded === true
      && d.selection.fallbackCount === 0;
  }), { timeout: 90_000, intervals: [350, 800, 1400] }).toBe(true);
  const selectionWallMs = (await page.evaluate(() => performance.now())) - selectStarted;
  const selectionCpu = cpuProfileSummary((await cdp.send('Profiler.stop')).profile);
  memory.push(await memorySample(page, cdp, 'soviet-selected-after-main-gc'));

  const toModernStarted = await page.evaluate(() => performance.now());
  await month(page, '2026-10');
  await expect.poll(() => page.evaluate(() =>
    window.PANDOLAB_TERRITORIAL.get('state:soviet-union') === null),
    { timeout: 90_000 }).toBe(true);
  const toModernWallMs = (await page.evaluate(() => performance.now())) - toModernStarted;
  memory.push(await memorySample(page, cdp, 'returned-modern-after-main-gc'));
  await page.waitForTimeout(5_000);
  memory.push(await memorySample(page, cdp, 'returned-modern-idle-5s-after-main-gc'));
  await page.waitForTimeout(7_000);
  memory.push(await memorySample(page, cdp, 'returned-modern-idle-12s-after-main-gc'));
  const result = {
    schema: 'pandolab-soviet-cpu-attribution-v1',
    scope: 'main JavaScript thread sampled CDP CPU profiler; Worker/WASM CPU excluded; isolated CI Chromium PSS',
    months: ['2026-10','1989-06','2026-10'],
    wall: { timelineMs: Number(timelineWallMs.toFixed(1)),
      firstSelectionGpuReadyMs: Number(selectionWallMs.toFixed(1)),
      returnMonthMs: Number(toModernWallMs.toFixed(1)) },
    timelineCpu, selectionCpu, memory, errors,
  };
  await mkdir('test-results/soviet-cpu-attribution', { recursive: true });
  await writeFile('test-results/soviet-cpu-attribution/measurement.json', JSON.stringify(result, null, 2));
  await testInfo.attach('soviet-cpu-attribution.json', { body: Buffer.from(JSON.stringify(result, null, 2)), contentType: 'application/json' });
  console.log('SOVIET_CPU_ATTRIBUTION', JSON.stringify(result));
  expect(timelineCpu.sampleCount).toBeGreaterThan(0);
  expect(selectionCpu.sampleCount).toBeGreaterThan(0);
  expect(memory[2].app.selectedSegments).toBeGreaterThan(0);
  expect(errors).toEqual([]);
  await cdp.detach();
});
