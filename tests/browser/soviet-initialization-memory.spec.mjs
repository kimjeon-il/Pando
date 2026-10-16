import { expect, test } from '@playwright/test';
import { readdir, readFile } from 'node:fs/promises';

test.use({ trace: 'off', viewport: { width: 1440, height: 900 } });

// Linux CI process memory is supplemental only. Sum PSS where available to
// avoid double-counting shared Chromium pages; this is not dedicated GPU VRAM.
async function chromiumMemory() {
  if (process.platform !== 'linux') return { available: false, reason: 'linux-only' };
  const pids = (await readdir('/proc')).filter(name => /^\d+$/.test(name));
  const records = [];
  for (const pid of pids) {
    try {
      const comm = (await readFile('/proc/' + pid + '/comm', 'utf8')).trim();
      const cmdline = (await readFile('/proc/' + pid + '/cmdline', 'utf8')).replaceAll('\0', ' ');
      if (!/(chrome|chromium|headless_shell|headless-shell)/i.test(comm)
        || !/(chrome|chromium|headless_shell|headless-shell)/i.test(cmdline)) continue;
      const status = await readFile('/proc/' + pid + '/status', 'utf8');
      const rollup = await readFile('/proc/' + pid + '/smaps_rollup', 'utf8').catch(() => '');
      const kb = (text, name) => Number(text.match(new RegExp('^' + name + ':\\s*(\\d+)\\s*kB', 'm'))?.[1] || 0);
      records.push({
        role: cmdline.includes('--type=gpu-process') ? 'gpu' : cmdline.includes('--type=renderer') ? 'renderer'
          : cmdline.includes('--type=utility') ? 'utility' : 'browser-other',
        rssKiB: kb(status, 'VmRSS'), pssKiB: kb(rollup, 'Pss'),
        privateDirtyKiB: kb(rollup, 'Private_Dirty'),
      });
    } catch { /* Chromium process may exit while sampling /proc. */ }
  }
  return {
    available: records.length > 0,
    accounting: 'all isolated Chromium processes on CI runner; PSS shared-memory adjusted; excludes driver VRAM',
    count: records.length,
    rssKiB: records.reduce((sum, row) => sum + row.rssKiB, 0),
    pssKiB: records.reduce((sum, row) => sum + row.pssKiB, 0),
    privateDirtyKiB: records.reduce((sum, row) => sum + row.privateDirtyKiB, 0),
    roles: Object.fromEntries(['browser-other', 'renderer', 'gpu', 'utility'].map(role =>
      [role, {
        count: records.filter(row => row.role === role).length,
        pssKiB: records.filter(row => row.role === role).reduce((sum, row) => sum + row.pssKiB, 0),
      }])),
  };
}

const withTimeout = (promise, ms) => Promise.race([
  promise, new Promise((_, reject) => setTimeout(() => reject(new Error('worker-inspection-timeout')), ms)),
]);
async function workerMemory(page) {
  const list = page.workers();
  const values = await Promise.all(list.map(async worker => {
    try {
      return await withTimeout(worker.evaluate(() => {
        const core = globalThis.PandoLabSphericalCore;
        return {
          webAssemblyHeapBytes: core?.HEAPU8?.buffer?.byteLength ?? core?.HEAP8?.buffer?.byteLength ?? null,
          performanceMemory: globalThis.performance?.memory?.usedJSHeapSize ?? null,
          gpuMeshEngineLoaded: !!globalThis.PandoLabGpuMeshCore,
          sharedCoreReady: !!core,
        };
      }), 3000).then(value => ({ url: new URL(worker.url()).pathname, ...value }));
    } catch (error) { return { url: new URL(worker.url()).pathname, unavailable: String(error.message || error) }; }
  }));
  return { count: list.length, workers: values };
}

async function readSnapshot(page, cdp, label) {
  const pageState = await page.evaluate(() => {
    const root = window.__PANDOLAB_RENDER_DEBUG__.snapshot();
    const { gpu, renderScene, selection } = root;
    const stroke = gpu.stroke || {};
    const polygon = gpu.polygonOverlay || {};
    const gpuSelection = gpu.selection || {};
    const mainMemory = performance.memory || {};
    return {
      nowMs: Number(performance.now().toFixed(1)),
      appReadiness: document.querySelector('#app')?.dataset.readiness || null,
      historicalMonth: document.querySelector('#timelineMonthInput')?.value || null,
      mainJsHeapUsed: Number(mainMemory.usedJSHeapSize || 0),
      mainJsHeapTotal: Number(mainMemory.totalJSHeapSize || 0),
      gpu: {
        renderer: gpu.renderer,
        fallbackReason: gpu.fallbackReason,
        activeWebGlContextCount: gpu.activeWebGlContextCount,
        displayDpr: gpu.effectivePixelRatio,
        canvasBackingPixels: gpu.canvasBackingPixels,
        meshVariantBytes: gpu.meshVariantBytes,
        sceneCache: {
          width: gpu.sceneCache?.width, height: gpu.sceneCache?.height,
          recreateCount: gpu.sceneCache?.recreateCount,
          hitCount: gpu.sceneCache?.hitCount, missCount: gpu.sceneCache?.missCount,
        },
        sceneCacheFullDrawCount: gpu.sceneCacheFullDrawCount,
        polygonOverlay: {
          activeBufferBytes: polygon.activeBufferBytes, buildCount: polygon.buildCount,
          uploadBytes: polygon.uploadBytes, buildMs: polygon.buildMs, resourceCount: polygon.resourceCount,
          cacheMisses: polygon.cacheMisses,
        },
        stroke: {
          activeBufferBytes: stroke.activeBufferBytes, buildCount: stroke.buildCount,
          uploadBytes: stroke.uploadBytes, buildMs: stroke.buildMs, resourceCount: stroke.resourceCount,
          cacheMisses: stroke.cacheMisses,
          topologyJoinCount: stroke.topologyJoinCount, topologyCapCount: stroke.topologyCapCount,
          pending: stroke.resourceBudget?.pendingCount,
        },
        selection: {
          bufferBuildCount: gpuSelection.bufferBuildCount,
          bufferBuildMs: gpuSelection.bufferBuildMs,
          bufferUploadBytes: gpuSelection.bufferUploadBytes,
          geometryCacheHits: gpuSelection.geometryCacheHits,
          geometryCacheMisses: gpuSelection.geometryCacheMisses,
          segmentCount: gpuSelection.segmentCount,
          activeBufferBytes: gpuSelection.activeBufferBytes,
          channels: gpuSelection.channels,
        },
        countrySharedBoundaryRequestId: gpu.countrySharedBoundaryRequestId,
        countrySharedBoundarySegmentCount: gpu.countrySharedBoundarySegmentCount,
        patchWorkerOutputBytes: gpu.patchWorkerOutputBytes,
        patchWorkerJobs: gpu.patchWorkerJobs,
        renderQuality: gpu.renderQuality?.tier,
        lastMeshPreparation: gpu.lastMeshPreparation,
      },
      renderScene: {
        polygonCacheBytes: renderScene.polygonCacheBytes,
        strokeCacheBytes: renderScene.strokeCacheBytes,
        cacheBytes: renderScene.cacheBytes, cacheBudgetBytes: renderScene.cacheBudgetBytes,
        polygonCacheMisses: renderScene.polygonCacheMisses,
        strokeCacheMisses: renderScene.strokeCacheMisses,
      },
      selection: {
        boundarySegmentCount: selection.selectionBoundarySegmentCount,
        fallbackCount: selection.fallbackCount,
        fallbackPathMs: selection.fallbackPathMs,
        pathCharacterCount: selection.pathCharacterCount,
        geometryCacheMisses: selection.geometryCacheMisses,
        geometryCacheHits: selection.geometryCacheHits,
        selectionProjectedPathCacheMisses: selection.projectedPathCacheMisses,
        svgFallbackKeys: selection.svgFallbackKeys,
      },
      render: {
        viewRenderCount: root.viewRenderCount,
        fullRenderCount: root.fullRenderCount,
        lastRenderMs: root.lastRenderMs,
        lastRendererTimes: root.lastRendererTimes,
        lastReasons: root.lastReasons,
      },
      longTasks: (window.__SOVIET_MEMORY_TASKS__ || []).map(x => ({ startTime: x.startTime, duration: x.duration })),
    };
  });
  let cdpHeap = null, cdpPerformance = null;
  try { cdpHeap = await cdp.send('Runtime.getHeapUsage'); } catch {}
  try {
    const performanceData = await cdp.send('Performance.getMetrics');
    const metrics = new Map(performanceData.metrics.map(row => [row.name, row.value]));
    cdpPerformance = Object.fromEntries(['JSHeapUsedSize','JSHeapTotalSize','Nodes','Documents','ScriptDuration','TaskDuration','LayoutDuration','RecalcStyleDuration'].map(key => [key, metrics.get(key) ?? null]));
  } catch {}
  return {
    label, at: new Date().toISOString(), page: pageState,
    cdpHeap: cdpHeap ? { usedSize: cdpHeap.usedSize, totalSize: cdpHeap.totalSize, embedderHeapUsedSize: cdpHeap.embedderHeapUsedSize } : null,
    cdpPerformance,
    workers: await workerMemory(page),
    chromium: await chromiumMemory(),
  };
}

test('1989 Soviet initial timeline admission, selection setup, memory and cache retention', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.__SOVIET_MEMORY_TASKS__ = [];
    try {
      new PerformanceObserver(list => {
        const rows = list.getEntries();
        for (const item of rows) if (window.__SOVIET_MEMORY_TASKS__.length < 240)
          window.__SOVIET_MEMORY_TASKS__.push({ startTime: Number(item.startTime.toFixed(1)), duration: Number(item.duration.toFixed(1)) });
      }).observe({ type: 'longtask', buffered: true });
    } catch { /* Unsupported browsers provide no long-task histogram. */ }
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.goto('/?perf=1&renderer=webgl2');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 120_000 });
  await expect.poll(() => page.evaluate(() => {
    const g = window.__PANDOLAB_RENDER_DEBUG__?.snapshot().gpu;
    return g?.canonicalMeshReady && g.renderer === 'webgl2' && !g.countrySharedBoundaryReplacementPending;
  }), { timeout: 75_000 }).toBe(true);
  await page.locator('#flatBtn').evaluate(button => button.click());
  await page.waitForTimeout(400);

  const phases = [];
  phases.push(await readSnapshot(page, cdp, 'startup-modern-world'));
  const beforeTimeline = await page.evaluate(() => performance.now());
  await page.locator('#timelineMonthButton').click();
  await page.locator('#timelineMonthInput').fill('1989-06');
  await page.locator('#timelineMonthInput').press('Enter');
  await expect(page.locator('#timelineMonthInput')).toBeHidden({ timeout: 90_000 });
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('state:soviet-union')?.geometry?.coordinates?.length || 0),
    { timeout: 90_000 }).toBeGreaterThan(0);
  const timelineVisibleMs = (await page.evaluate(() => performance.now())) - beforeTimeline;
  phases.push(await readSnapshot(page, cdp, 'soviet-month-visible'));
  await expect.poll(() => page.evaluate(() => {
    const g = window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu;
    return g.canonicalMeshReady && !g.countrySharedBoundaryReplacementPending && (g.patchWorkerJobs?.queueDepth || 0) === 0;
  }), { timeout: 75_000 }).toBe(true);
  phases.push(await readSnapshot(page, cdp, 'soviet-month-settled'));

  const beforeSelect = await page.evaluate(() => performance.now());
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('state:soviet-union'));
  const selectionCommandMs = (await page.evaluate(() => performance.now())) - beforeSelect;
  phases.push(await readSnapshot(page, cdp, 'selection-dispatched'));
  await expect.poll(() => page.evaluate(() => {
    const {gpu, selection} = window.__PANDOLAB_RENDER_DEBUG__.snapshot();
    return gpu.countryEmphasis.selectedIds.includes('state:soviet-union')
      && gpu.selection?.channels?.primary?.drawSucceeded === true
      && gpu.selection?.segmentCount > 0 && selection.fallbackCount === 0;
  }), { timeout: 90_000, intervals: [350, 900, 1500] }).toBe(true);
  const selectionGpuReadyMs = (await page.evaluate(() => performance.now())) - beforeSelect;
  phases.push(await readSnapshot(page, cdp, 'selection-gpu-ready'));
  await page.waitForTimeout(700);
  phases.push(await readSnapshot(page, cdp, 'selection-stable-before-main-gc'));
  await cdp.send('HeapProfiler.collectGarbage');
  await page.waitForTimeout(250);
  phases.push(await readSnapshot(page, cdp, 'selection-after-main-gc'));

  const result = {
    schema: 'pandolab-soviet-initialization-memory-v1',
    sourceMonth: '1989-06', entity: 'state:soviet-union',
    platform: { browser: 'Chromium', ci: 'GitHub-hosted Linux', gpuDriverMemoryAvailable: false,
      workerWasmMemoryGuaranteed: false, processPssIncludesChromiumShared: true },
    durations: { timelineVisibleMs: Number(timelineVisibleMs.toFixed(1)),
      selectionCommandMs: Number(selectionCommandMs.toFixed(1)),
      selectionGpuReadyMs: Number(selectionGpuReadyMs.toFixed(1)) },
    phases, errors,
  };
  await testInfo.attach('soviet-initialization-memory.json', {
    body: Buffer.from(JSON.stringify(result, null, 2)), contentType: 'application/json',
  });
  console.log('SOVIET_INITIAL_MEMORY_REPORT', JSON.stringify(result));
  expect(result.phases[0].page.gpu.renderer).toBe('webgl2');
  expect(result.phases[4].page.gpu.selection.segmentCount).toBeGreaterThan(0);
  expect(result.phases[4].page.selection.fallbackCount).toBe(0);
  expect(errors).toEqual([]);
  await cdp.detach();
});
