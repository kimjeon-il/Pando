import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromiumProcessPss, createWorkerMemoryProbe, summarizeMemoryPhases } from './helpers/soviet-memory-attribution.mjs';

test.use({ trace: 'off', viewport: { width: 1440, height: 900 } });

async function setMonth(page, month) {
  await page.locator('#timelineMonthButton').click();
  await page.locator('#timelineMonthInput').fill(month);
  await page.locator('#timelineMonthInput').press('Enter');
  await expect(page.locator('#timelineMonthInput')).toBeHidden({ timeout: 90_000 });
}

async function waitForSettledWork(page) {
  // Autosave and its delayed preview can run after a month is rendered.
  // A live preview is reported in the snapshot, not silently classified idle.
  await page.waitForTimeout(6_000);
  try {
    await expect.poll(() => page.workers().filter(worker => worker.url().includes('/project-preview-worker.js')).length,
      { timeout: 45_000, intervals: [500, 1200, 1800] }).toBe(0);
  } catch { /* Report the in-flight preview in the next snapshot. */ }
}

async function snapshot(page, cdp, workerProbe, label) {
  await page.evaluate(phase => window.__PANDOLAB_PREVIEW_TRANSPORT_TRACE__?.push({
    event: 'phase', phase, atMs: performance.now(),
  }), label);
  // Worker and main V8 garbage collection requested at every comparable phase.
  const workerMemory = await workerProbe.sample({ collectGarbage: true });
  await cdp.send('HeapProfiler.collectGarbage');
  await page.waitForTimeout(350);
  const main = await cdp.send('Runtime.getHeapUsage');
  const app = await page.evaluate(() => {
    const result = window.__PANDOLAB_RENDER_DEBUG__?.snapshot();
    if (!result) throw new Error('Render debug snapshot unavailable');
    const { gpu, renderScene, selection } = result;
    const scene = gpu.sceneCache || {};
    const autosave = window.__PANDOLAB_PERFORMANCE_REPORT__?.()?.operations?.['autosave.persist'];
    const mesh = gpu.meshVariantBytes || {};
    const meshBytes = Object.values(mesh).reduce((sum, value) => sum + Number(value || 0), 0);
    const extent = scene.width && scene.height ? scene.width * scene.height * 4 : 0;
    const tracked = meshBytes + Number(gpu.stroke?.activeBufferBytes || 0)
      + Number(gpu.polygonOverlay?.activeBufferBytes || 0) + Number(gpu.selection?.activeBufferBytes || 0)
      + Number(gpu.terrainCacheBytes || 0) + Number(gpu.hydroCacheBytes || 0);
    return {
      month: document.querySelector('#timelineMonthInput')?.value ?? null,
      boundaryReplacementPending: gpu.countrySharedBoundaryReplacementPending ?? null,
      renderer: gpu.renderer,
      gpu: {
        renderer: gpu.renderer, meshVariantBytes: mesh, meshVariantSumBytes: meshBytes,
        strokeBytes: gpu.stroke?.activeBufferBytes ?? null,
        selectionBytes: gpu.selection?.activeBufferBytes ?? null,
        polygonOverlayBytes: gpu.polygonOverlay?.activeBufferBytes ?? null,
        terrainCacheBytes: gpu.terrainCacheBytes ?? null,
        hydroCacheBytes: gpu.hydroCacheBytes ?? null,
        // Known app counters, not VRAM; categories can overlap.
        trackedBytes: tracked,
        sceneColorCache: { state: scene.state, width: scene.width, height: scene.height,
          activeColorTargetMinimumBytes: extent,
          recreateCount: scene.recreateCount, missCount: scene.missCount },
        strokeUploads: gpu.stroke?.uploadBytes ?? null,
        countryBoundarySegments: gpu.countrySharedBoundarySegmentCount,
        selectionSegments: gpu.selection?.segmentCount,
      },
      cpuGeometryCaches: {
        renderSceneCacheBytes: renderScene?.cacheBytes ?? null,
        polygonCacheBytes: renderScene?.polygonCacheBytes ?? null,
        strokeCacheBytes: renderScene?.strokeCacheBytes ?? null,
        cacheBudgetBytes: renderScene?.cacheBudgetBytes ?? null,
        selectionCacheEntries: selection?.cacheSize ?? null,
      },
      editor: { vertexCount: document.querySelectorAll('circle.country-vertex').length,
        boundaryVertexCount: document.querySelectorAll('circle.vertex-handle').length },
      autosave: { count: autosave?.count ?? 0,
        latest: (autosave?.samples || []).slice(-1).map(row => ({ durationMs: row.durationMs, detail: row.detail })) },
    };
  });
  const chromium = await chromiumProcessPss();
  return {
    label, at: new Date().toISOString(),
    mainJsHeap: { available: true, usedBytes: main.usedSize, totalBytes: main.totalSize,
      embedderUsedBytes: main.embedderHeapUsedSize ?? null, backingStorageBytes: main.backingStorageSize ?? null },
    workerMemory, chromium, gpu: app.gpu,
    cpuGeometryCaches: app.cpuGeometryCaches, session: {
      month: app.month, renderer: app.renderer, editor: app.editor,
      boundaryReplacementPending: app.boundaryReplacementPending,
      previewCacheWorkerActive: workerMemory.workers.some(worker => worker.url.endsWith('/project-preview-worker.js')),
      autosave: app.autosave,
    },
  };
}

test('measure main JS, each Worker JS/WASM, GPU caches and Chromium PSS across Soviet edit and time round trips', async ({ page }, testInfo) => {
  test.setTimeout(1_200_000);
  const errors = [];
  const previewWarnings = [];
  page.on('console', message => {
    if (message.type() === 'warning' || message.type() === 'error')
      previewWarnings.push({ type: message.type(), text: message.text().slice(0, 320) });
  });
  const previewWorkerLifecycle = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('worker', worker => {
    if (!worker.url().includes('/project-preview-worker.js')) return;
    const start = Date.now();
    const row = { startedAt: new Date(start).toISOString(), closedAt: null, durationMs: null };
    previewWorkerLifecycle.push(row);
    worker.on('close', () => {
      row.closedAt = new Date().toISOString();
      row.durationMs = Date.now() - start;
    });
  });
  await page.addInitScript(() => {
    const OriginalWorker = globalThis.Worker;
    const events = [];
    globalThis.__PANDOLAB_PREVIEW_TRANSPORT_TRACE__ = events;
    let nextWorkerId = 0;
    const record = row => events.push({ ...row, atMs: performance.now() });
    globalThis.Worker = class TrackedPreviewWorker extends OriginalWorker {
      constructor(script, options) {
        super(script, options);
        if (!String(script).includes('/project-preview-worker.js')) return;
        this.__previewTraceId = ++nextWorkerId;
        record({ event: 'created', workerId: this.__previewTraceId });
        this.addEventListener('message', message => {
          const data = message.data;
          // Retain scalar fields only, never the large cache or geometry.
          record({ event: 'reply', workerId: this.__previewTraceId, requestId: data?.id ?? null,
            ok: data?.ok ?? null, message: String(data?.message || '').slice(0, 180) });
        });
        this.addEventListener('error', message =>
          record({ event: 'error', workerId: this.__previewTraceId, message: String(message.message || '').slice(0, 180) }));
      }
      postMessage(data, transfer) {
        if (this.__previewTraceId) record({ event: 'request', workerId: this.__previewTraceId,
          requestId: data?.id ?? null, type: data?.type ?? null,
          entityCount: Array.isArray(data?.entities) ? data.entities.length : null,
          sourceViewCount: Array.isArray(data?.source?.territorialViews) ? data.source.territorialViews.length : null,
          cacheBytes: data?.cache?.compressed?.byteLength ?? null });
        return super.postMessage(data, transfer);
      }
      terminate() {
        if (this.__previewTraceId) record({ event: 'terminated', workerId: this.__previewTraceId });
        return super.terminate();
      }
    };
  });
  await page.goto('/?perf=1&renderer=webgl2');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 120_000 });
  await expect.poll(() => page.evaluate(() => {
    const gpu = window.__PANDOLAB_RENDER_DEBUG__?.snapshot()?.gpu;
    return gpu?.renderer === 'webgl2' && gpu.canonicalMeshReady && !gpu.countrySharedBoundaryReplacementPending;
  }), { timeout: 90_000 }).toBe(true);
  await page.locator('#flatBtn').evaluate(button => button.click());
  const cdp = await page.context().newCDPSession(page);
  const workerProbe = await createWorkerMemoryProbe(cdp, {
    origin: new URL(page.url()).origin,
  });
  const phases = [];
  const results = { schema: 'pandolab-soviet-memory-attribution-v2',
    sha: process.env.GITHUB_SHA || null, runUrl: process.env.GITHUB_RUN_ID ?
      `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
    platform: { ci: 'GitHub Ubuntu Chromium, SwiftShader software WebGL2',
      workerJs: 'CDP per-target Runtime.getHeapUsage',
      workerWasm: 'CDP queryObjects of first observed WebAssembly.Memory instances then WeakRef size sampling (linear allocation, not used C++ heap; later new instances may be missed)',
      diagnostics: 'Read-only Worker CDP expressions for shared-boundary queue/latest message and map-edit source counts; lexical access may be unavailable',
      idle: 'No-input samples at 6 and 30 seconds may overlap delayed autosave preview; final sample waits for preview Worker retirement and GC',
      chromiumPss: '/proc/smaps_rollup by process (Workers can share renderer process; not worker PSS)',
      gpu: 'application counters; excludes framebuffer stencil/staging and driver VRAM; not additive to PSS',
      gc: 'Worker and main V8 GC requested at every phase; OS memory return is not guaranteed' },
    phases, durations: {}, errors, previewWorkerLifecycle, previewWarnings, previewTransportTrace: [] };
  const report = async () => {
    results.previewTransportTrace = await page.evaluate(() =>
      globalThis.__PANDOLAB_PREVIEW_TRANSPORT_TRACE__ || []).catch(() => []);
    const requests = results.previewTransportTrace.filter(row => row.event === 'request');
    results.previewUnfinishedOnTermination = results.previewTransportTrace.filter(row =>
      row.event === 'terminated').map(row => ({
      workerId: row.workerId,
      unfinished: requests.filter(request => request.workerId === row.workerId && request.atMs < row.atMs
        && !results.previewTransportTrace.some(reply => reply.event === 'reply'
          && reply.workerId === request.workerId && reply.requestId === request.requestId))
        .map(request => ({ type: request.type, ageMs: Number((row.atMs - request.atMs).toFixed(1)) })),
    }));
    results.summary = summarizeMemoryPhases(phases);
    await mkdir('test-results/soviet-memory-attribution', { recursive: true });
    const output = JSON.stringify(results, null, 2);
    await writeFile('test-results/soviet-memory-attribution/measurement.json', output);
    await testInfo.attach('soviet-memory-attribution.json', { body: Buffer.from(output), contentType: 'application/json' });
    console.log('SOVIET_PREVIEW_TRANSPORT', JSON.stringify({
      created: results.previewTransportTrace.filter(row => row.event === 'created').length,
      requests: requests.map(row => ({ type: row.type, atMs: Math.round(row.atMs), workerId: row.workerId })),
      unfinished: results.previewUnfinishedOnTermination,
      warnings: results.previewWarnings.filter(row => row.text.includes('preview') || row.text.includes('미리보기')),
    }));
    console.log('SOVIET_MEMORY_ATTRIBUTION', JSON.stringify({
      labels: phases.map(phase => phase.label), summary: results.summary,
      measuredWorkerWasmMiB: phases.map(phase => ({ label: phase.label,
        value: phase.workerMemory.wasmAllocatedBytes == null ? null :
          Number((phase.workerMemory.wasmAllocatedBytes / 1048576).toFixed(1)) })),
    }));
  };
  try {
    phases.push(await snapshot(page, cdp, workerProbe, 'startup-modern'));
    for (let cycle = 1; cycle <= 3; cycle++) {
      const sovietStarted = Date.now();
      await setMonth(page, '1989-06');
      await expect.poll(() => page.evaluate(() =>
        window.PANDOLAB_TERRITORIAL.get('state:soviet-union')?.geometry?.coordinates?.length || 0),
      { timeout: 90_000 }).toBeGreaterThan(0);
      await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('state:soviet-union'));
      await expect.poll(() => page.evaluate(() => {
        const { gpu, selection } = window.__PANDOLAB_RENDER_DEBUG__.snapshot();
        return gpu.selection?.segmentCount > 0 && gpu.selection?.channels?.primary?.drawSucceeded === true
          && selection.fallbackCount === 0;
      }), { timeout: 90_000, intervals: [450, 1000, 1500] }).toBe(true);
      if (cycle === 1) results.durations.firstSovietMonthAndSelectionMs = Date.now() - sovietStarted;
      phases.push(await snapshot(page, cdp, workerProbe,
        cycle === 1 ? 'soviet-selected' : `reentered-soviet-${cycle - 1}`));

      await waitForSettledWork(page);
      const editStarted = Date.now();
      await page.locator('#actionsTabBtn').evaluate(button => button.click());
      await expect(page.locator('#editEntityCoastBtn')).toBeEnabled({ timeout: 30_000 });
      await page.locator('#editEntityCoastBtn').evaluate(button => button.click());
      await expect(page.locator('#modePrimaryBtn')).toHaveAttribute('aria-label', '수정 완료', { timeout: 130_000 });
      await expect.poll(() => page.locator('circle.country-vertex').count(), { timeout: 75_000 }).toBeGreaterThan(0);
      results.durations[`editEntry${cycle}Ms`] = Date.now() - editStarted;
      phases.push(await snapshot(page, cdp, workerProbe, `soviet-edit-open-${cycle}`));
      for (let attempt = 0; attempt < 2; attempt++) {
        await page.locator('#modeCancelBtn').evaluate(button => button.click());
        if (await page.locator('#confirmModal').isVisible())
          await page.locator('#confirmModalOkBtn').evaluate(button => button.click());
        await page.waitForTimeout(500);
        if ((await page.locator('circle.country-vertex').count()) === 0) break;
      }
      await expect.poll(() => page.locator('circle.country-vertex').count(), { timeout: 15_000 }).toBe(0);
      phases.push(await snapshot(page, cdp, workerProbe, `soviet-edit-cancelled-${cycle}`));

      const returnedStarted = Date.now();
      await setMonth(page, '2026-10');
      await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('state:soviet-union') === null),
        { timeout: 90_000 }).toBe(true);
      await expect.poll(() => page.evaluate(() => {
        const gpu = window.__PANDOLAB_RENDER_DEBUG__?.snapshot()?.gpu;
        return gpu?.renderer === 'webgl2' && !gpu.countrySharedBoundaryReplacementPending;
      }), { timeout: 90_000, intervals: [500, 1200, 1800] }).toBe(true);
      await waitForSettledWork(page);
      phases.push(await snapshot(page, cdp, workerProbe, `returned-modern-${cycle}`));
      results.durations[`returnModern${cycle}Ms`] = Date.now() - returnedStarted;
      await page.waitForTimeout(6_000);
      phases.push(await snapshot(page, cdp, workerProbe, `idle-modern-${cycle}-6s`));
      await page.waitForTimeout(24_000);
      phases.push(await snapshot(page, cdp, workerProbe, `idle-modern-${cycle}-30s`));
    }
    // The no-input samples above can overlap a delayed autosave preview.
    // A true post-preview sample is possible only after its Worker terminates.
    await expect.poll(() => page.workers().filter(worker =>
      worker.url().includes('/project-preview-worker.js')).length,
    { timeout: 95_000, intervals: [1000, 2000] }).toBe(0);
    await page.waitForTimeout(2_000);
    phases.push(await snapshot(page, cdp, workerProbe, 'settled-modern-after-preview'));
  } finally {
    await report();
    await workerProbe.dispose();
    await cdp.detach();
  }

  expect(phases.length).toBe(20);
  expect(phases.every(phase => phase.chromium.available)).toBe(true);
  // Preview workers can be CPU-bound until their 60s owner timeout.
  // Preserve them as explicitly unavailable; never turn an unknown measurement into zero.
  expect(phases.every(phase => phase.workerMemory.workers
    .filter(worker => !worker.url.endsWith('/project-preview-worker.js'))
    .every(worker => worker.jsHeap?.available && worker.wasmLinearMemory?.available))).toBe(true);
  expect(phases.at(-1).workerMemory.jsComplete && phases.at(-1).workerMemory.wasmComplete).toBe(true);
  expect(phases.at(-1).session.previewCacheWorkerActive).toBe(false);
  expect(phases[0].workerMemory.workers.some(worker => worker.url.endsWith('/core-session-worker.js')
    && worker.wasmLinearMemory.allocatedBytes > 0)).toBe(true);
  expect(phases.filter(phase => phase.label.startsWith('soviet-edit-cancelled-'))
    .every(phase => phase.session.editor.vertexCount === 0)).toBe(true);
  expect(phases.filter(phase => phase.label.startsWith('idle-modern-') && phase.label.endsWith('-30s')).length).toBe(3);
  expect(errors).toEqual([]);
});
