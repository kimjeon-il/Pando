import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { semanticSnapshot, summarizeLatency, installMapBaselineCollector, instrumentMapBaselineSource } from '../helpers/map-transition-baseline.mjs';

test.use({ timezoneId: 'Asia/Seoul', locale: 'ko-KR', trace: 'off' });
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const repeatPairs = 10;

for (const profile of [{name: 'desktop', width: 1280, height: 800}, {name: 'narrow-viewport', width: 390, height: 844}]) {
  test(`P0 unchanged map result, presentation latency and resources: ${profile.name}`, async ({page, browser}, testInfo) => {
    test.setTimeout(600_000);
    await page.setViewportSize({width: profile.width, height: profile.height});
    await page.clock.setFixedTime(new Date('2026-10-31T00:00:00+09:00'));
    await page.addInitScript(installMapBaselineCollector);
    const pageErrors = [], sourceHashes = {}, samples = [], snapshots = {}, resourceSamples = [];
    page.on('pageerror', error => pageErrors.push(String(error)));
    for (const name of ['viewer-composition.js', 'builtin-session.js', 'project-domain.js']) {
      await page.route(`**/modules/${name}*`, async route => {
        const response = await route.fetch(), source = await response.text();
        sourceHashes[name] = createHash('sha256').update(source).digest('hex');
        await route.fulfill({response, body: instrumentMapBaselineSource(source, name)});
      });
    }
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const resources = async label => {
      const {metrics} = await cdp.send('Performance.getMetrics');
      const values = Object.fromEntries(metrics.map(row => [row.name, row.value]));
      const row = {label, workers: page.workers().length, jsHeapUsedBytes: values.JSHeapUsedSize ?? null,
        jsHeapTotalBytes: values.JSHeapTotalSize ?? null, domNodes: values.Nodes ?? null,
        jsEventListeners: values.JSEventListeners ?? null,
        renderer: await page.evaluate(() => globalThis.__PANDOLAB_VIEWER__.rendererStats())};
      resourceSamples.push(row); return row;
    };
    const ready = month => expect.poll(() => page.evaluate(() => ({
      month: globalThis.__PANDOLAB_VIEWER__?.builtinMonth().month,
      cursor: globalThis.__PANDOLAB_VIEWER__?.documentState().timelineCursor,
      ready: document.querySelector('#viewerStatus')?.dataset.ready,
    })), {timeout: 90_000}).toEqual({month, cursor: month, ready: 'true'});
    let initialCamera, initialState, buildMeta, startup, failure = null;
    const capture = async month => {
      const value = await page.evaluate(() => ({document: globalThis.__PANDOLAB_VIEWER__.documentSnapshot(),
        state: globalThis.__PANDOLAB_VIEWER__.documentState(), camera: globalThis.__PANDOLAB_VIEWER__.cameraSnapshot()}));
      const semantic = semanticSnapshot(value.document), hash = digest(semantic);
      if (snapshots[month]) expect(hash, `semantic round-trip at ${month}`).toBe(snapshots[month].sha256);
      else {
        const name = `semantic-${month}.json`;
        await writeFile(testInfo.outputPath(name), JSON.stringify(semantic));
        snapshots[month] = {sha256: hash, file: name, entityCount: semantic.territorialEntities.length, geometryCount: semantic.geometries.length};
      }
      expect(value.camera).toEqual(initialCamera);
      for (const key of ['dirty', 'canUndo', 'canRedo', 'documentDirty', 'presentationDirty']) {
        expect(value.state[key], `unchanged ${key}`).toEqual(initialState[key]);
      }
      return hash;
    };
    const transition = async (control, month, classification) => {
      const beforeId = await page.evaluate(() => globalThis.__PANDO_P0__.snapshot().active?.id ?? 0);
      await page.locator('#' + control).click();
      await ready(month);
      const probe = await page.evaluate(() => globalThis.__PANDO_P0__.snapshot());
      expect(probe.errors).toEqual([]);
      const id = probe.active.id; expect(id).toBe(beforeId + 1);
      const events = probe.events.filter(row => row.sampleId === id), requested = events.filter(row => row.kind === 'requested');
      const presented = events.filter(row => row.kind === 'presented'), settled = events.filter(row => row.kind === 'settled');
      expect(requested).toHaveLength(1); expect(presented).toHaveLength(1); expect(settled).toHaveLength(1);
      expect(requested[0].origin).toBe('dom-input');
      expect(presented[0].at).toBeGreaterThanOrEqual(requested[0].inputAt);
      expect(settled[0].at).toBeGreaterThanOrEqual(presented[0].at);
      const row = {id, month, classification, control, outcome: 'success',
        ms: presented[0].at - requested[0].inputAt, readyMs: settled[0].at - requested[0].inputAt,
        events, longTasks: probe.longTasks.filter(task => task.startTime < settled[0].at && task.startTime + task.duration > requested[0].inputAt),
        network: probe.resources.filter(resource => resource.startTime >= requested[0].inputAt && resource.startTime <= settled[0].at)};
      row.resources = await resources(`${id}:${month}`);
      row.semanticSha256 = await capture(month);
      samples.push(row);
    };
    try {
      await page.goto('/?debug=1');
      await ready('2026-10');
      const initial = await page.evaluate(() => ({camera: globalThis.__PANDOLAB_VIEWER__.cameraSnapshot(),
        state: globalThis.__PANDOLAB_VIEWER__.documentState(), buildMeta: globalThis.__PANDOLAB_VIEWER__.p0BuildMeta(),
        observedReadyAtMs: performance.now(), visibility: document.visibilityState}));
      initialCamera = initial.camera; initialState = initial.state; buildMeta = initial.buildMeta;
      startup = {readyObservedAtMs: initial.observedReadyAtMs, visibility: initial.visibility,
        definition: 'poll observation of application-ready, NOT first presented frame'};
      await resources('initial'); await capture('2026-10');
      await page.screenshot({path: testInfo.outputPath('initial.png')});
      await transition('timelinePreviousYear', '2025-12', 'first-visit');
      await transition('timelinePreviousDecade', '2015-12', 'first-visit-distant');
      await transition('timelineNextDecade', '2025-12', 'revisit');
      await transition('timelineNextYear', '2026-10', 'revisit');
      for (let i = 0; i < repeatPairs; i++) {
        await transition('timelinePreviousYear', '2025-12', 'repeat-pair');
        await transition('timelineNextYear', '2026-10', 'repeat-pair');
      }
      await page.screenshot({path: testInfo.outputPath('round-trip.png')});
      expect(pageErrors).toEqual([]);
    } catch (error) { failure = String(error?.stack || error); throw error; }
    finally {
      const probe = await page.evaluate(() => globalThis.__PANDO_P0__?.snapshot() ?? null).catch(() => null);
      if (failure && probe?.active && !samples.some(row => row.id === probe.active.id)) {
        samples.push({id: probe.active.id, month: probe.active.month, classification: 'failed-attempt',
          outcome: 'failed', ms: null, failure});
      }
      const report = {schemaVersion: 1, scope: 'P0', outcome: failure ? 'failed' : 'passed', failure,
        codeRevision: execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(),
        dataPin: JSON.parse(await readFile(new URL('../../config/library-data.json', import.meta.url), 'utf8')),
        buildMeta, sourceHashes, profile, browser: browser.version(), platform: process.platform, node: process.version,
        rendererHardware: 'CI/headless; see renderer stats; NOT a user-device benchmark',
        cachePolicy: 'Playwright routing disables HTTP cache; repeat-pair means same-page application reuse, not verified cache hit',
        timingDefinition: 'DOM input capture to existing temporal onPresented callback; not hardware scanout or GPU fence timing',
        limitations: ['Semantic snapshots and resource reads occur outside intervals but may affect subsequent GC.',
          'CDP JS heap is not total process, WASM or GPU memory.', 'Narrow viewport is not a physical mobile device.',
          'Initial ready observation is not first-map presentation latency.', 'No performance threshold is enforced at P0.'],
        startup, initialCamera, initialState, snapshots, samples, resourceSamples, pageErrors, probe,
        summary: {all: summarizeLatency(samples), repeatPairs: summarizeLatency(samples.filter(row => row.classification === 'repeat-pair'))}};
      const file = testInfo.outputPath('p0-baseline.json'); await writeFile(file, JSON.stringify(report, null, 2));
      await testInfo.attach('p0-baseline', {path: file, contentType: 'application/json'});
      console.log('P0_BASELINE_SUMMARY ' + JSON.stringify({profile: profile.name, outcome: report.outcome,
        codeRevision: report.codeRevision, summary: report.summary, failure}));
      await cdp.detach();
    }
  });
}
