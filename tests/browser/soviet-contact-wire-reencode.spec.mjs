import { gotoEditor, setEditorMonth } from './helpers/editor-entry.mjs';
/* global boundaryState: readonly, latestMessage: readonly, queued: readonly, draining: readonly */
import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

test.use({ trace: 'off', viewport: { width: 1440, height: 900 } });
async function month(page, value) {
  await setEditorMonth(page, value);
}
async function ready(page, value, soviet) {
  await expect.poll(() => page.evaluate(() => {
    const gpu = window.__PANDOLAB_RENDER_DEBUG__?.snapshot()?.gpu;
    if (gpu?.renderer !== 'webgl2' || !gpu.canonicalMeshReady
      || gpu.countrySharedBoundaryReplacementPending) return null;
    return { month: window.__testEditorTimeline.month(),
      soviet: !!window.PANDOLAB_TERRITORIAL?.get('state:soviet-union') };
  }), { timeout: 90_000 }).toEqual({ month: value, soviet });
}

test('benchmark repeated C++ contact source encoding on real prepared modern neighbors', async ({ page }, info) => {
  test.setTimeout(500_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await gotoEditor(page, '/?perf=1&renderer=webgl2');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 120_000 });
  await expect.poll(() => page.evaluate(() => {
    const gpu = window.__PANDOLAB_RENDER_DEBUG__?.snapshot()?.gpu;
    return gpu?.renderer === 'webgl2' && gpu.canonicalMeshReady && !gpu.countrySharedBoundaryReplacementPending;
  }), { timeout: 90_000 }).toBe(true);
  await page.waitForFunction(() => window.__PANDOLAB_MAP_HOST__.getViewState().projection === 'flat');
  const current = await page.evaluate(() => new Date().getFullYear()+'-'+String(new Date().getMonth()+1).padStart(2,'0'));
  await month(page, '1989-06'); await ready(page, '1989-06', true);
  await month(page, current); await ready(page, current, false);
  const worker = page.workers().find(w => w.url().includes('/country-shared-boundary-worker.js'));
  expect(worker).toBeTruthy();
  await expect.poll(() => worker.evaluate(() => !queued && !draining
    && boundaryState?.stats().contactCount === 339
    && (latestMessage?.features?.length || 0) === 254), { timeout: 90_000 }).toBe(true);
  const benchmark = await worker.evaluate(async () => {
    const { computeCountrySharedContacts } = await import(new URL('../modules/country-contact-core.js', globalThis.location.href).href);
    const store = boundaryState.preparedStore;
    const digest = result => ({ segments: result[0].length,
      refs: result[0].reduce((n, row) => n + row.refs.length, 0) });
    // Restrict CPU parity to real adjacent countries, not an empty broad-phase hit.
    const candidates = [['RUS', 'CHN'], ['CHN', 'MNG'], ['CAN', 'USA'],
      ['IND', 'CHN'], ['DEU', 'POL'], ['FRA', 'ESP']];
    let selected = null, expected = null, warmupMs = null;
    for (const [leftId, rightId] of candidates) {
      const left = store.get(leftId), right = store.get(rightId);
      if (!left || !right) continue;
      const count = left.segments.length + right.segments.length;
      if (count < 400 || count > 150000) continue;
      const start = performance.now();
      const actual = digest(computeCountrySharedContacts([[left, right]]));
      if (!actual.segments) continue;
      selected = { left, right, count };
      expected = actual;
      warmupMs = performance.now() - start;
      break;
    }
    if (!selected) throw new Error('No real adjacent modern-country pair found');
    const pair = [[selected.left, selected.right]];
    const durations = [];
    for (let i = 0; i < 5; i++) {
      const then = performance.now();
      const actual = digest(computeCountrySharedContacts(pair));
      durations.push(performance.now() - then);
      if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Source contact output mismatch');
    }
    const ordered = [...durations].sort((a, b) => a - b);
    return { pair: [selected.left.id, selected.right.id], sourceRows: selected.count,
      warmupMs: Number(warmupMs.toFixed(2)), samplesMs: durations.map(n => Number(n.toFixed(2))),
      medianMs: Number(ordered[2].toFixed(2)), output: expected };
  });
  expect(benchmark.sourceRows).toBeGreaterThan(399);
  expect(benchmark.samplesMs.length).toBe(5);
  expect(errors).toEqual([]);
  const result = { schema: 'pando-soviet-contact-wire-cpu-v1',
    source: process.env.PANDOLAB_EXPECT_COMMIT || null, benchmark };
  await mkdir('test-results/soviet-contact-wire', { recursive: true });
  const data = JSON.stringify(result, null, 2) + '\n';
  await writeFile('test-results/soviet-contact-wire/measurement.json', data);
  await info.attach('contact-wire-cpu.json', { body: Buffer.from(data), contentType: 'application/json' });
  console.log('SOVIET_CONTACT_WIRE_CPU', JSON.stringify(benchmark));
});
