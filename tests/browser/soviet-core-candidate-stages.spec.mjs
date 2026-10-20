import { gotoEditor, setEditorMonth } from './helpers/editor-entry.mjs';
import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

test.use({ trace: 'off', viewport: { width: 1440, height: 900 } });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function month(page, value) {
  await setEditorMonth(page, value);
}

test('measure Soviet Core document-prepare queue and actual WASM synchronous call without default 30s RPC deadline', async ({ page }, info) => {
  test.setTimeout(390_000);
  test.skip(process.env.PANDO_CORE_CANDIDATE_DIAGNOSTIC_ISOLATED !== '1',
    'Only the disposable CI checkout may disable the Core RPC prepare timeout');
  const result = { schema: 'pando-core-soviet-prepare-stage-probe-v1',
    sourceSha: process.env.GITHUB_SHA || null,
    sourceMonth: '1989-06', stages: [], captured: null, errors: [],
    note: 'TEST ONLY: core.document-prepare RPC deadline lifted in isolated checkout. Normal product timeout remains 30000ms. Stage durations do not equal C++ inner function breakdown.' };
  page.on('pageerror', e => result.errors.push(e.message));
  let baseHash = null;
  try {
    await page.addInitScript(() => {
      window.__OBJ097_EVENTS__ = [];
      window.__OBJ097_LONGTASKS__ = [];
      const ActualWorker = window.Worker;
      window.Worker = class CoreDiagnosticWorker extends ActualWorker {
        constructor(...args) {
          super(...args);
          const kind = String(args[0]).includes('core-session-worker') ? 'core'
            : String(args[0]).includes('map-edit-worker') ? 'map-edit' : null;
          if (!kind) return;
          this.addEventListener('message', event => {
            const m = event.data;
            if (m?.type === 'OBJ097_CORE_STAGE')
              window.__OBJ097_EVENTS__.push({ ...m, worker: kind });
            else if (m?.rpc === 'pandolab-worker-rpc' && m?.type === 'result'
              && (m.operation === 'core.document-prepare' ||
                m.operation === 'territorial-edit' || m.operation === 'boundary-move'))
              window.__OBJ097_EVENTS__.push({
                phase: 'rpc-result', operation: m.operation, worker: kind,
                requestId: m.requestId, atMs: performance.now(),
                ok: m.ok === true, code: m.error?.code || null, error: m.error?.message || null,
                durationMs: m.timing?.durationMs ?? null,
              });
          });
          const post = this.postMessage;
          this.postMessage = function (m, ...extra) {
            if (m?.rpc === 'pandolab-worker-rpc' && m?.type === 'request'
              && (m.operation === 'core.document-prepare' ||
                m.operation === 'territorial-edit' || m.operation === 'boundary-move'))
              window.__OBJ097_EVENTS__.push({
                phase: 'rpc-request', operation: m.operation, worker: kind,
                requestId: m.requestId, atMs: performance.now() });
            return post.call(this, m, ...extra);
          };
        }
      };
      new window.PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          window.__OBJ097_LONGTASKS__.push({
            atMs: entry.startTime, durationMs: entry.duration,
          });
        }
      }).observe({ type: 'longtask', buffered: true });
    });
    await gotoEditor(page, '/?perf=1&renderer=webgl2');
    await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 120_000 });
    await expect.poll(() => page.evaluate(() => {
      const gpu = window.__PANDOLAB_RENDER_DEBUG__?.snapshot()?.gpu;
      return gpu?.renderer === 'webgl2' && gpu.canonicalMeshReady && !gpu.countrySharedBoundaryReplacementPending;
    }), { timeout: 90_000 }).toBe(true);
    await page.waitForFunction(() => window.__PANDOLAB_MAP_HOST__.getViewState().projection === 'flat');
    await month(page, '1989-06');
    await expect.poll(() => page.evaluate(() => !!window.PANDOLAB_TERRITORIAL?.get('state:soviet-union')),
      { timeout: 90_000 }).toBe(true);
    baseHash = await page.evaluate(() => JSON.stringify(window.PANDOLAB_TERRITORIAL.get('state:soviet-union').geometry).length);
    await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('state:soviet-union'));
    await page.locator('#focusSelectedObjectBtn').evaluate(button => button.click());
    await delay(600);
    await page.locator('#actionsTabBtn').evaluate(button => button.click());
    await expect(page.locator('#editEntityCoastBtn')).toBeEnabled({ timeout: 55_000 });
    await page.locator('#editEntityCoastBtn').evaluate(button => button.click());
    await expect(page.locator('#modePrimaryBtn')).toHaveAttribute('aria-label', '변경 미리보기', { timeout: 150_000 });
    const candidates = page.locator('.country-vertex:not(.fixed-boundary-vertex)');
    await expect.poll(() => candidates.count(), { timeout: 75_000 }).toBeGreaterThan(0);
    const selected = await candidates.evaluateAll(nodes => {
      const view = document.querySelector('#map')?.getBoundingClientRect();
      let best = null;
      for(const node of nodes) {
        const rect = node.getBoundingClientRect(), x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
        if (!rect.width || !view || x < Math.max(view.left + 15,350) || x > view.right-30
          || y < Math.max(view.top+30,120) || y > view.bottom-30
          || document.elementFromPoint(x,y) !== node) continue;
        const d = node.__data__, coord = d?.coordinate;
        if (!Array.isArray(coord) || coord[1] < 35 || coord[1] > 73) continue;
        const score = (d.segments || []).length ? Math.min(...d.segments.map(s => {
          const end = s.start[0] === coord[0] && s.start[1] === coord[1] ? s.end : s.start;
          return (end[0]-coord[0])**2 + (end[1]-coord[1])**2;
        })) : 0;
        if (!best || score > best.score) best = { x,y,score,coord };
      }
      return best;
    });
    expect(selected, 'Visible safe coastal vertex must be available').toBeTruthy();
    result.selected = selected;
    await page.mouse.move(selected.x,selected.y);
    await page.mouse.down();
    await page.mouse.move(selected.x+20, selected.y-14, { steps: 8 });
    await page.mouse.move(selected.x+1.5, selected.y-1.5, { steps: 8 });
    await page.mouse.up();
    await page.locator('#modePrimaryBtn').click();

    await expect.poll(() => page.evaluate(() => window.__OBJ097_EVENTS__.some(e =>
      e.operation === 'core.document-prepare' && e.phase === 'rpc-request')), {
      timeout: 90_000, intervals: [500, 1400, 2500],
    }).toBe(true);
    const didWasmEnter = await expect.poll(() => page.evaluate(() =>
      window.__OBJ097_EVENTS__.some(e => e.phase === 'wasm-call-enter')), {
      timeout: 60_000, intervals: [500, 1400, 2500],
    }).toBe(true).then(() => true, () => false);
    result.wasmEntered = didWasmEnter;
    if (didWasmEnter) {
      result.wasmReturned = await expect.poll(() => page.evaluate(() =>
        window.__OBJ097_EVENTS__.some(e => e.phase === 'wasm-call-return')), {
        timeout: 135_000, intervals: [750, 2200, 4500],
      }).toBe(true).then(() => true, () => false);
    } else result.wasmReturned = false;
    result.previewReady = await page.locator('#modePrimaryBtn').textContent()
      .then(text => text?.includes('변경 적용') || false);
    result.status = await page.locator('#actionStatus').textContent();
    result.geomStillOriginal = await page.evaluate(len =>
      JSON.stringify(window.PANDOLAB_TERRITORIAL.get('state:soviet-union').geometry).length === len, baseHash);
    await delay(500);
    // Do not claim the isolated long-deadline experiment validates product UX.
    expect(result.wasmEntered, 'Core Worker never reached WASM method').toBe(true);
    expect(result.wasmReturned, 'WASM Core document-prepare did not complete within isolated 135s budget').toBe(true);
  } finally {
    result.stages = await page.evaluate(() => window.__OBJ097_EVENTS__ || []).catch(() => []);
    result.longTasks = await page.evaluate(() => window.__OBJ097_LONGTASKS__?.slice(-120) || []).catch(() => []);
    result.originalGeometryLength = baseHash;
    result.coreStages = result.stages.filter(e => e.worker === 'core');
    result.mapStages = result.stages.filter(e => e.worker === 'map-edit');
    await mkdir('test-results/soviet-core-candidate-stages', { recursive: true });
    const body = JSON.stringify(result,null,2) + '\n';
    await writeFile('test-results/soviet-core-candidate-stages/measurement.json',body);
    await info.attach('soviet-core-candidate-stages.json', { body: Buffer.from(body), contentType: 'application/json' });
    console.log('OBJ097_CORE_CANDIDATE_STAGE',JSON.stringify({
      sourceSha: result.sourceSha, wasmEntered: result.wasmEntered,
      wasmReturned: result.wasmReturned, previewReady: result.previewReady,
      selected: result.selected, coreStages: result.coreStages,
      mapStages: result.mapStages, errors: result.errors,
    }));
  }
});
