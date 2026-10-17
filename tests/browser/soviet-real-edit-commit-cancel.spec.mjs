/* global boundaryState: readonly */
import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createWorkerMemoryProbe, chromiumProcessPss } from './helpers/soviet-memory-attribution.mjs';

test.use({ trace: 'off', viewport: { width: 1440, height: 900 } });
const ENTITY = 'state:soviet-union';
const MiB = 1024 * 1024;
const round = value => Number(Number(value).toFixed(2));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fingerprint(page) {
  return page.evaluate(id => {
    const geometry = window.PANDOLAB_TERRITORIAL?.get(id)?.geometry;
    if (!geometry) return null;
    const text = JSON.stringify(geometry);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    return { hash: hash >>> 0, length: text.length,
      polygonCount: polygons.length,
      coordinateCount: polygons.reduce((sum, polygon) =>
        sum + polygon.reduce((n, ring) => n + ring.length, 0), 0) };
  }, ENTITY);
}
async function setMonth(page, month) {
  await page.locator('#timelineMonthButton').click();
  await page.locator('#timelineMonthInput').fill(month);
  await page.locator('#timelineMonthInput').press('Enter');
  await expect(page.locator('#timelineMonthInput')).toBeHidden({ timeout: 90_000 });
}
async function settleWorld(page, month, soviet) {
  await expect.poll(() => page.evaluate(() => {
    const gpu = window.__PANDOLAB_RENDER_DEBUG__?.snapshot()?.gpu;
    if (gpu?.renderer !== 'webgl2' || !gpu.canonicalMeshReady
      || gpu.countrySharedBoundaryReplacementPending) return null;
    return { month: document.querySelector('#timelineMonthInput')?.value,
      soviet: !!window.PANDOLAB_TERRITORIAL?.get('state:soviet-union') };
  }), { timeout: 120_000, intervals: [500, 1000, 1500] }).toEqual({ month, soviet });
}
async function rawSourceRefEvidence(page, phase) {
  const worker = page.workers().find(item => item.url().includes('/country-shared-boundary-worker.js'));
  if (!worker) return { phase, available: false, reason: 'no country-shared-boundary-worker' };
  return worker.evaluate(({ id, phase }) => {
    const current = typeof boundaryState !== 'undefined' ? boundaryState : null;
    const stored = current?.preparedStore?.get(id);
    if (!stored) return { phase, available: false, reason: 'no Soviet prepared source', id,
      contactCount: current?.stats?.().contactCount || 0 };
    const polygons = stored.geometry.type === 'Polygon' ? [stored.geometry.coordinates] : stored.geometry.coordinates;
    const sampleIndices = [0, 1, 2, Math.floor(stored.segments.length / 2), stored.segments.length - 1]
      .filter((index, slot, values) => index >= 0 && values.indexOf(index) === slot);
    const sample = sampleIndices.map(index => {
      const row = stored.segments[index];
      const ring = polygons[row.polygonIndex]?.[row.ringIndex];
      const valid = row.featureId === id && row.a === ring?.[row.segmentIndex]
        && row.b === ring?.[row.segmentIndex + 1];
      const a = row.a, b = row.b;
      const bounds = [Math.min(a[0], b[0])-1e-7, Math.min(a[1], b[1])-1e-7,
        Math.max(a[0], b[0])+1e-7, Math.max(a[1], b[1])+1e-7];
      return { index, valid, indexed: stored.spatialIndex.query(bounds).includes(row),
        sourceOrdinal: [row.polygonIndex, row.ringIndex, row.segmentIndex] };
    });
    const contacts = current.segments().filter(segment => segment.ownerIds.includes(id));
    const refs = contacts.flatMap(segment => segment.refs.filter(ref => String(ref.featureId) === id)).slice(0, 24);
    const sourceRefs = refs.map(ref => {
      const source = stored.segments.find(row => row.polygonIndex === ref.polygonIndex
        && row.ringIndex === ref.ringIndex && row.segmentIndex === ref.segmentIndex);
      return { valid: !!source && ref.a === source.a && ref.b === source.b
          && ref.interiorSide === source.interiorSide,
        complete: ['featureId', 'polygonIndex', 'ringIndex', 'segmentIndex', 'a', 'b', 'interiorSide',
          'startT', 'endT'].every(key => Object.hasOwn(ref, key)) };
    });
    return { phase, available: true, sourceRows: stored.segments.length,
      sample, matchingRefs: sourceRefs.length, sourceRefs,
      contactSegments: contacts.length, originalGeometrySharedWithFeature: stored.geometry === stored.feature.geometry,
      preparationCount: current.stats().preparationCount, contactCount: current.stats().contactCount };
  }, { id: ENTITY, phase });
}
async function snapshot(page, probe, label) {
  const workerSample = await probe.sample({ collectGarbage: true });
  const next = await probe.sample({ collectGarbage: true });
  const relevant = next.workers.find(item => item.url.endsWith('/country-shared-boundary-worker.js'));
  const edit = next.workers.find(item => item.url.endsWith('/map-edit-worker.js'));
  const context = await page.evaluate(() => {
    const perf = window.__PANDOLAB_PERFORMANCE_REPORT__?.();
    const gpu = window.__PANDOLAB_RENDER_DEBUG__?.snapshot()?.gpu;
    const samples = perf?.operations?.['edit.boundary.prepare']?.samples || [];
    return { autosaveCount: perf?.operations?.['autosave.persist']?.count || 0,
      preparation: samples.at(-1) || null, preparationCount: samples.length,
      countryVertexCount: document.querySelectorAll('circle.country-vertex').length,
      polygonGpuBuilds: gpu?.polygonGpuBuildCount ?? null,
      strokeGpuUploads: gpu?.strokeGpuUploadBytes ?? null };
  });
  const ownerEvidence = await rawSourceRefEvidence(page, label);
  const pss = await chromiumProcessPss();
  return { label, context, source: ownerEvidence,
    sharedJsMiB: relevant?.jsHeap?.available ? round(relevant.jsHeap.usedBytes / MiB) : null,
    sharedWasmMiB: relevant?.wasmLinearMemory?.available
      ? round(relevant.wasmLinearMemory.allocatedBytes / MiB) : null,
    editJsMiB: edit?.jsHeap?.available ? round(edit.jsHeap.usedBytes / MiB) : null,
    editWasmMiB: edit?.wasmLinearMemory?.available
      ? round(edit.wasmLinearMemory.allocatedBytes / MiB) : null,
    allWorkerJsMiB: round(next.jsUsedBytes / MiB), allWorkerWasmMiB: round(next.wasmAllocatedBytes / MiB),
    workerComplete: workerSample.jsComplete && next.jsComplete && next.wasmComplete,
    workerCount: next.count, pssMiB: pss.pssMiB };
}
async function chooseDraggableHandle(page) {
  const candidates = page.locator('.country-vertex:not(.fixed-boundary-vertex)');
  await expect.poll(() => candidates.count(), { timeout: 130_000 }).toBeGreaterThan(0);
  return candidates.evaluateAll(nodes => {
    const viewport = document.querySelector('#map')?.getBoundingClientRect();
    let best = null, visible = 0;
    if (!viewport) return { error: 'missing map container' };
    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
      if (!rect.width || x < Math.max(viewport.left + 15, 350) || x > viewport.right - 30
        || y < Math.max(viewport.top + 30, 120) || y > viewport.bottom - 30
        || document.elementFromPoint(x, y) !== node) continue;
      visible++;
      const datum = node.__data__;
      const coordinate = datum?.coordinate;
      if (!coordinate || !Array.isArray(datum.segments)) continue;
      // Prefer a well-separated vertex, reducing overlap/snap risk in huge polygon rings.
      const dists = datum.segments.map(edge => {
        const other = edge.start[0] === coordinate[0] && edge.start[1] === coordinate[1]
          ? edge.end : edge.start;
        const diff = (other[0] - coordinate[0]) ** 2 + (other[1] - coordinate[1]) ** 2;
        return diff;
      });
      const score = Math.min(...dists);
      if (!best || score > best.score) best = { x, y, score, coordinate: [...coordinate], key: datum.nodeKey };
    }
    return best ? { ...best, visible, rendered: nodes.length } : { error: 'no clickable vertices', visible, rendered: nodes.length };
  });
}
async function openCoast(page, timings) {
  await page.evaluate(id => window.PANDOLAB_TERRITORIAL.select(id), ENTITY);
  await page.locator('#actionsTabBtn').evaluate(button => button.click());
  await expect(page.locator('#editEntityCoastBtn')).toBeEnabled({ timeout: 50_000 });
  const before = Date.now();
  await page.locator('#editEntityCoastBtn').evaluate(button => button.click());
  await expect(page.locator('#modePrimaryBtn')).toHaveAttribute('aria-label', '수정 완료', { timeout: 150_000 });
  await expect.poll(() => page.locator('circle.country-vertex').count(), { timeout: 110_000 }).toBeGreaterThan(0);
  timings.enterMs = Date.now() - before;
}
async function dragAndPreview(page, timings) {
  const handle = await chooseDraggableHandle(page);
  expect(handle.error || '', JSON.stringify(handle)).toBe('');
  const { x, y } = handle;
  const started = Date.now();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 0.6, y - 0.6, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('#modePrimaryBtn')).toContainText('변경 적용', { timeout: 175_000 });
  await expect(page.locator('#modePrimaryBtn')).toBeEnabled({ timeout: 80_000 });
  timings.dragPreviewMs = Date.now() - started;
  return handle;
}
async function cancelTool(page) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (await page.locator('circle.country-vertex').count() === 0) break;
    await page.locator('#modeCancelBtn').evaluate(button => button.click());
    if (await page.locator('#confirmModal').isVisible())
      await page.locator('#confirmModalOkBtn').evaluate(button => button.click());
    await delay(250);
  }
  await expect(page.locator('circle.country-vertex')).toHaveCount(0, { timeout: 70_000 });
}
function assertOwnership(evidence) {
  expect(evidence.available, JSON.stringify(evidence)).toBe(true);
  expect(evidence.sourceRows).toBeGreaterThan(2000);
  expect(evidence.sample.length).toBeGreaterThan(3);
  expect(evidence.sample.every(row => row.valid && row.indexed)).toBe(true);
  expect(evidence.originalGeometrySharedWithFeature).toBe(true);
  expect(evidence.contactSegments).toBeGreaterThan(0);
  expect(evidence.matchingRefs).toBeGreaterThan(0);
  expect(evidence.sourceRefs.every(row => row.valid && row.complete)).toBe(true);
}
test('real Soviet coastal vertex preview cancel, confirm and Undo/Redo preserve original source references', async ({ page }, info) => {
  test.setTimeout(1_700_000);
  const pageErrors = [], scenarios = [], snapshots = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(() => {
    const longTasks = [];
    Object.defineProperty(window, '__SOVIET_EDIT_ACCEPTANCE_TASKS__', { value: longTasks });
    new window.PerformanceObserver(list => {
      for (const row of list.getEntries()) {
        longTasks.push({ atMs: Math.round(row.startTime), durationMs: Math.round(row.duration) });
        if (longTasks.length > 1500) longTasks.shift();
      }
    }).observe({ type: 'longtask', buffered: true });
  });
  let probe = null, cdp = null;
  const report = { schema: 'pando-soviet-edit-commit-cancel-v1', sourceSha: process.env.GITHUB_SHA || null,
    sourceMonth: '1989-06', scope: 'Real mouse drag of a Soviet country coast vertex, true Core preview commit / discard and history Undo/Redo',
    caveat: 'The operation wall clocks include Worker/core/transport/UI waits; longtask durations isolate observable main-thread blocks. Chromium SwiftShader is not a physical GPU. All edits occur in a disposable browser context.',
    errors: pageErrors, scenarios, snapshots };
  try {
    await page.goto('/?perf=1&renderer=webgl2');
    await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 130_000 });
    await expect.poll(() => {
      return page.evaluate(() => {
        const gpu = window.__PANDOLAB_RENDER_DEBUG__?.snapshot()?.gpu;
        return gpu?.renderer === 'webgl2' && gpu.canonicalMeshReady && !gpu.countrySharedBoundaryReplacementPending;
      });
    }, { timeout: 90_000 }).toBe(true);
    await page.locator('#flatBtn').evaluate(button => button.click());
    await setMonth(page, '1989-06');
    await settleWorld(page, '1989-06', true);
    const original = await fingerprint(page);
    report.original = original;
    expect(original).not.toBeNull();
    await page.evaluate(id => window.PANDOLAB_TERRITORIAL.select(id), ENTITY);
    await page.locator('#focusSelectedObjectBtn').evaluate(button => button.click());
    await delay(1000);
    cdp = await page.context().newCDPSession(page);
    probe = await createWorkerMemoryProbe(cdp, { origin: new URL(page.url()).origin, timeoutMs: 24_000 });
    const base = await snapshot(page, probe, 'soviet-original-idle');
    snapshots.push(base);
    assertOwnership(base.source);
    for (const [index, mode] of ['cancel-preview', 'confirm-undo-redo', 'cancel-preview'].entries()) {
      const scenario = { index: index + 1, mode, timings: {}, source: null };
      scenarios.push(scenario);
      const started = await page.evaluate(() => performance.now());
      await openCoast(page, scenario.timings);
      scenario.handle = await dragAndPreview(page, scenario.timings);
      if (mode === 'cancel-preview') {
        const phaseStarted = Date.now();
        await page.keyboard.press('Escape');
        await expect(page.locator('.geometry-preview-new-boundary')).toHaveCount(0, { timeout: 60_000 });
        scenario.timings.discardMs = Date.now() - phaseStarted;
        expect(await fingerprint(page)).toEqual(original);
        await cancelTool(page);
        expect(await fingerprint(page)).toEqual(original);
      } else {
        const preCommit = await fingerprint(page);
        const phaseStarted = Date.now();
        await page.locator('#modePrimaryBtn').evaluate(button => button.click());
        await expect.poll(() => fingerprint(page), { timeout: 130_000 }).not.toEqual(preCommit);
        scenario.timings.confirmMs = Date.now() - phaseStarted;
        scenario.committed = await fingerprint(page);
        expect(scenario.committed).not.toEqual(original);
        await expect(page.locator('#undoBtn')).toBeEnabled({ timeout: 40_000 });
        const undoStarted = Date.now();
        await page.locator('#undoBtn').evaluate(button => button.click());
        await expect.poll(() => fingerprint(page), { timeout: 120_000 }).toEqual(original);
        scenario.timings.undoMs = Date.now() - undoStarted;
        const redoStarted = Date.now();
        await page.locator('#redoBtn').evaluate(button => button.click());
        await expect.poll(() => fingerprint(page), { timeout: 120_000 }).toEqual(scenario.committed);
        scenario.timings.redoMs = Date.now() - redoStarted;
        await page.locator('#undoBtn').evaluate(button => button.click());
        await expect.poll(() => fingerprint(page), { timeout: 120_000 }).toEqual(original);
        await cancelTool(page);
      }
      await settleWorld(page, '1989-06', true);
      await delay(600);
      const current = await snapshot(page, probe, 'after-' + mode + '-' + (index + 1));
      snapshots.push(current);
      scenario.source = current.source;
      assertOwnership(current.source);
      expect(await fingerprint(page)).toEqual(original);
      scenario.elapsedMs = round((await page.evaluate(() => performance.now())) - started);
      scenario.longTask = await page.evaluate(start => {
        const tasks = (window.__SOVIET_EDIT_ACCEPTANCE_TASKS__ || []).filter(row => row.atMs >= start);
        return { count: tasks.length, largestMs: Math.max(0, ...tasks.map(row => row.durationMs)),
          totalMs: tasks.reduce((sum, row) => sum + row.durationMs, 0) };
      }, started);
      console.log('SOVIET_REAL_EDIT_SCENARIO', JSON.stringify({
        index: scenario.index, mode: scenario.mode, timings: scenario.timings,
        sourceRows: scenario.source.sourceRows, contactSegments: scenario.source.contactSegments,
        boundaryWorkerJsMiB: current.sharedJsMiB, mapEditWorkerJsMiB: current.editJsMiB,
        longTask: scenario.longTask }));
    }
    await setMonth(page, await page.evaluate(() => window.PANDOLAB_BUILD_META.historicalWorld.sourceMonth));
    await settleWorld(page, await page.evaluate(() => window.PANDOLAB_BUILD_META.historicalWorld.sourceMonth), false);
    snapshots.push(await snapshot(page, probe, 'modern-after-restored-edits'));
    expect(await fingerprint(page)).toBeNull();
    report.summary = { scenarioCount: scenarios.length, cancelCount: scenarios.filter(s => s.mode==='cancel-preview').length,
      confirmCount: scenarios.filter(s => s.mode==='confirm-undo-redo').length,
      maxEnterMs: Math.max(...scenarios.map(s=>s.timings.enterMs)),
      maxPreviewMs: Math.max(...scenarios.map(s=>s.timings.dragPreviewMs)),
      errors: pageErrors.length };
    expect(pageErrors).toEqual([]);
  } finally {
    if (probe) await probe.dispose();
    if (cdp) await cdp.detach();
    await mkdir('test-results/soviet-real-edit', { recursive: true });
    const json = JSON.stringify(report, null, 2);
    await writeFile('test-results/soviet-real-edit/measurement.json', json);
    await info.attach('soviet-real-edit.json', { body: Buffer.from(json), contentType: 'application/json' });
    console.log('SOVIET_REAL_EDIT_REPORT', JSON.stringify({
      scenarios: report.scenarios.map(s=>({ index:s.index,mode:s.mode,timings:s.timings,longTask:s.longTask,
        sourceRows:s.source?.sourceRows,ownedRefsValid:s.source?.sourceRefs?.every(r=>r.valid && r.complete) })),
      errors: pageErrors, summary: report.summary || null }));
  }
});
