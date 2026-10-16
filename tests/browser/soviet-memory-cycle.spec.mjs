import { expect, test } from '@playwright/test';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';

test.use({ trace: 'off', viewport: { width: 1440, height: 900 } });

async function chromiumPss() {
  if (process.platform !== 'linux') return { supported: false, reason: 'Linux /proc required' };
  const roles = new Map();
  for (const pid of (await readdir('/proc')).filter(row => /^\d+$/.test(row))) {
    try {
      const command = (await readFile('/proc/' + pid + '/cmdline', 'utf8')).replaceAll('\0', ' ');
      if (!/(?:chrome|chromium|headless_shell|headless-shell)/i.test(command)) continue;
      const content = await readFile('/proc/' + pid + '/smaps_rollup', 'utf8');
      const pssKiB = Number(content.match(/^Pss:\s*(\d+)\s*kB/m)?.[1] || 0);
      const name = command.includes('--type=gpu-process') ? 'gpu-process'
        : command.includes('--type=renderer') ? 'renderer'
          : command.includes('--type=utility') ? 'utility' : 'browser-other';
      const current = roles.get(name) || { count: 0, pssKiB: 0 };
      current.count++;
      current.pssKiB += pssKiB;
      roles.set(name, current);
    } catch { /* A Chromium subprocess may exit while its smaps are sampled. */ }
  }
  const groups = Object.fromEntries(roles);
  return { supported: roles.size > 0, accounting: 'Linux Chromium process PSS; not per-Worker heap or VRAM',
    pssKiB: [...roles.values()].reduce((sum, group) => sum + group.pssKiB, 0),
    processCount: [...roles.values()].reduce((sum, group) => sum + group.count, 0),
    groups };
}

async function withTimeout(promise, durationMs) {
  let timer;
  try {
    return await Promise.race([promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Worker inspection timed out')), durationMs); })]);
  } finally { clearTimeout(timer); }
}

async function workerOwnership(page) {
  return Promise.all(page.workers().map(async worker => {
    const name = new URL(worker.url()).pathname.split('/').at(-1);
    try {
      const diagnostic = await withTimeout(worker.evaluate(() => {
        const core = globalThis.PandoLabSphericalCore;
        return {
          mapEdit: globalThis.__PANDOLAB_MAP_EDIT_MEMORY_DIAGNOSTICS__?.() || null,
          // The manifest-pinned Emscripten module does not expose its linear
          // memory in every worker. Unknown bytes are recorded as null.
          wasmHeapBytes: core?.HEAPU8?.buffer?.byteLength ?? core?.HEAP8?.buffer?.byteLength ?? null,
          workerJsHeapBytes: globalThis.performance?.memory?.usedJSHeapSize ?? null,
          sharedCorePresent: !!core,
        };
      }), 2500);
      return { name, ...diagnostic };
    } catch (error) { return { name, unavailable: String(error?.message || error) }; }
  }));
}

async function sample(page, cdp, label, { collectMainGarbage = false } = {}) {
  if (collectMainGarbage) {
    await cdp.send('HeapProfiler.collectGarbage');
    await page.waitForTimeout(350);
  }
  const ui = await page.evaluate(() => {
    const debug = window.__PANDOLAB_RENDER_DEBUG__.snapshot(), gpu = debug.gpu;
    const prep = window.__PANDOLAB_PERFORMANCE_REPORT__?.()?.operations?.['edit.boundary.prepare'];
    const autosave = window.__PANDOLAB_PERFORMANCE_REPORT__?.()?.operations?.['autosave.persist'];
    return {
      renderer: gpu.renderer,
      countryVertexNodes: document.querySelectorAll('circle.country-vertex').length,
      boundarySegmentsInDom: document.querySelectorAll('path.boundary-edit-segment').length,
      countrySelectionSegments: gpu.selection?.segmentCount || 0,
      meshVariantBytes: gpu.meshVariantBytes,
      polygonGpuBytes: gpu.polygonOverlay?.activeBufferBytes ?? null,
      strokeGpuBytes: gpu.stroke?.activeBufferBytes ?? null,
      selectionGpuBytes: gpu.selection?.activeBufferBytes ?? null,
      canvasBackingPixels: gpu.canvasBackingPixels,
      renderSceneCacheBytes: debug.renderScene.cacheBytes,
      renderSceneCacheBudgetBytes: debug.renderScene.cacheBudgetBytes,
      prep: prep?.samples?.at(-1) || null,
      autosaveCount: autosave?.count || 0,
      projectMonth: window.PANDOLAB_TERRITORIAL.get('state:soviet-union') ? 'soviet-present' : 'soviet-absent',
      mainPerformanceMemoryBytes: performance.memory?.usedJSHeapSize ?? null,
    };
  });
  let heap = null;
  try {
    const result = await cdp.send('Runtime.getHeapUsage');
    heap = { jsUsedBytes: result.usedSize, jsTotalBytes: result.totalSize,
      embedderUsedBytes: result.embedderHeapUsedSize ?? null };
  } catch { /* CDP may not provide heap totals; record an explicit null. */ }
  const workers = await workerOwnership(page);
  return { label, ui, heap, workers, chromium: await chromiumPss() };
}

async function setMonth(page, month) {
  await page.locator('#timelineMonthButton').click();
  await page.locator('#timelineMonthInput').fill(month);
  await page.locator('#timelineMonthInput').press('Enter');
  await expect(page.locator('#timelineMonthInput')).toBeHidden({ timeout: 90_000 });
}

async function geometryIdentity(page) {
  return page.evaluate(() => {
    const geometry = window.PANDOLAB_TERRITORIAL.get('state:soviet-union')?.geometry;
    if (!geometry) return null;
    const source = JSON.stringify(geometry);
    let hash = 2166136261;
    for (let i = 0; i < source.length; i++) {
      hash ^= source.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return { length: source.length, fingerprint: hash >>> 0 };
  });
}

test('1989 Soviet repeated coast edit and month round-trip keep bounded caches and unchanged geometry', async ({ page }, testInfo) => {
  test.setTimeout(390_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const cdp = await page.context().newCDPSession(page);
  await page.goto('/?perf=1&renderer=webgl2');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 120_000 });
  await expect.poll(() => {
    return page.evaluate(() => {
      const gpu = window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu;
      return gpu.renderer === 'webgl2' && gpu.canonicalMeshReady && !gpu.countrySharedBoundaryReplacementPending;
    });
  }, { timeout: 90_000 }).toBe(true);
  await page.locator('#flatBtn').evaluate(button => button.click());

  const sourceMonth = await page.evaluate(() => window.PANDOLAB_BUILD_META?.historicalWorld?.sourceMonth);
  expect(sourceMonth).toMatch(/^\d{4}-\d{2}$/);
  expect(sourceMonth).not.toBe('1989-06');

  await setMonth(page, '1989-06');
  await expect.poll(() => geometryIdentity(page), { timeout: 90_000 }).not.toBeNull();
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('state:soviet-union'));
  await expect.poll(() => page.evaluate(() => {
    const gpu = window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu;
    return gpu.selection?.segmentCount || 0;
  }), { timeout: 90_000 }).toBeGreaterThan(0);
  const original = await geometryIdentity(page);
  const phases = [await sample(page, cdp, 'soviet-before-edits-after-main-gc', { collectMainGarbage: true })];
  for (let index = 0; index < 3; index++) {
    await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('state:soviet-union'));
    await page.locator('#actionsTabBtn').evaluate(button => button.click());
    await expect(page.locator('#editEntityCoastBtn')).toBeEnabled({ timeout: 30_000 });
    await page.locator('#editEntityCoastBtn').evaluate(button => button.click());
    await expect(page.locator('#modePrimaryBtn')).toHaveAttribute('aria-label', '수정 완료', { timeout: 130_000 });
    await expect.poll(() => page.locator('circle.country-vertex').count(), { timeout: 90_000 }).toBeGreaterThan(0);
    phases.push(await sample(page, cdp, 'coast-edit-' + (index + 1) + '-active'));
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.locator('#modeCancelBtn').evaluate(button => button.click());
      if (await page.locator('#confirmModal').isVisible()) await page.locator('#confirmModalOkBtn').evaluate(button => button.click());
      if (await page.locator('circle.country-vertex').count() === 0) break;
    }
    await expect(page.locator('circle.country-vertex')).toHaveCount(0, { timeout: 30_000 });
    expect(await geometryIdentity(page)).toEqual(original);
    phases.push(await sample(page, cdp, 'coast-edit-' + (index + 1) + '-cancelled-after-main-gc',
      { collectMainGarbage: true }));
  }

  await setMonth(page, sourceMonth);
  await expect.poll(() => page.evaluate(() => !window.PANDOLAB_TERRITORIAL.get('state:soviet-union')),
    { timeout: 90_000 }).toBe(true);
  phases.push(await sample(page, cdp, 'modern-after-main-gc', { collectMainGarbage: true }));
  await setMonth(page, '1989-06');
  await expect.poll(() => geometryIdentity(page), { timeout: 90_000 }).toEqual(original);
  await page.waitForTimeout(1500);
  phases.push(await sample(page, cdp, 'soviet-return-after-main-gc', { collectMainGarbage: true }));

  const editWorkerReadouts = phases.map(phase => ({
    phase: phase.label,
    mapEdit: phase.workers.find(worker => worker.name === 'map-edit-worker.js')?.mapEdit ?? null,
    workers: phase.workers.length,
  }));
  const result = {
    schema: 'pandolab-soviet-memory-cycle-v1', month: '1989-06', sourceMonth,
    accounting: 'Main JS heap after CDP main GC; Worker JS and WASM only when available; Linux Chromium PSS is not VRAM',
    original, phases, editWorkerReadouts, errors,
  };
  await mkdir('test-results/soviet-memory-cycle', { recursive: true });
  await writeFile('test-results/soviet-memory-cycle/measurement.json', JSON.stringify(result, null, 2));
  await testInfo.attach('soviet-memory-cycle.json', { body: Buffer.from(JSON.stringify(result, null, 2)),
    contentType: 'application/json' });
  console.log('SOVIET_MEMORY_CYCLE', JSON.stringify({
    schema: result.schema, original, errors, phases: phases.map(phase => ({
      label: phase.label, heap: phase.heap?.jsUsedBytes ?? null,
      pssKiB: phase.chromium.pssKiB, workers: phase.workers.length,
      edit: phase.workers.find(worker => worker.name === 'map-edit-worker.js')?.mapEdit ?? null,
      gpu: { strokeBytes: phase.ui.strokeGpuBytes, selectionBytes: phase.ui.selectionGpuBytes,
        sceneCacheBytes: phase.ui.renderSceneCacheBytes }, handles: phase.ui.countryVertexNodes,
    })),
  }));

  expect(errors).toEqual([]);
  expect(phases[0].ui.renderer).toBe('webgl2');
  for (const phase of phases.filter(row => row.label.includes('-active'))) {
    expect(phase.ui.countryVertexNodes).toBeGreaterThan(0);
  }
  for (const phase of phases.filter(row => row.label.includes('-cancelled'))) {
    expect(phase.ui.countryVertexNodes).toBe(0);
  }
  // Structural contracts are stable across CI hardware. Absolute RSS/PSS
  // thresholds are deliberately not used as a proxy for a proved memory leak.
  const observed = editWorkerReadouts.filter(row => row.mapEdit?.boundary);
  expect(observed.length).toBeGreaterThan(0);
  for (const row of observed) {
    const stats = row.mapEdit.boundary;
    expect(stats.cachedPreparations).toBeLessThanOrEqual(8);
    expect(stats.cacheBudgetBytes).toBe(32 * 1024 * 1024);
    if (stats.cacheEstimatedBytes > stats.cacheBudgetBytes)
      expect(stats.cachedPreparations).toBe(1);
  }
  const initialWorkerCount = phases[0].workers.length;
  for (const phase of phases) expect(phase.workers.length).toBeLessThanOrEqual(initialWorkerCount + 2);
  await cdp.detach();
});
