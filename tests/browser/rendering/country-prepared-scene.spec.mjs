import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';

// Independent historical and real context-loss regression; initial startup is
// covered once by the canonical Viewer startup scenario.
// scope.extra is a generator compatibility packet, not an independent runtime
// display feature. Exercise the real historical UI without injecting that packet.
test('historical Soviet scope remains ready across reload, date return and real WebGL context restoration', async ({ page }, info) => {
  test.setTimeout(360_000);
  const observations = [], errors = [], consoleErrors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  const snapshot = () => page.evaluate(() => {
    const viewer = globalThis.__PANDOLAB_VIEWER__, stats = viewer?.rendererStats();
    return { month: viewer?.builtinMonth().month, ready: document.querySelector('#viewerStatus')?.dataset.ready,
      presented: viewer?.initialMapPresented(), stats };
  });
  const ready = async month => {
    await expect.poll(async () => {
      const value = await snapshot(), s = value.stats;
      return !!(s && (!month || value.month === month) && value.ready === 'true' && value.presented
        && s.canonicalMeshReady && !s.projectRenderBlocked && s.countriesPublishedGeneration === s.projectGeneration
        && s.pendingCountryCount === 0 && s.surfaceDraw?.countryIndexCount > 0 && s.countrySharedBoundaryReady);
    }, { timeout: 90_000 }).toBe(true);
  };
  const year = async value => {
    await page.locator('#timelineDateButton').click();
    await page.locator('#timelineViewUnit').selectOption('month');
    await page.locator('#timelineYearInput').fill(String(value));
    await page.locator('#timelineMonthInput').selectOption('12');
    await page.locator('#timelineGoBtn').click();
    await ready(value + '-12');
  };
  const record = async label => {
    const selected = await page.evaluate(async () => {
      const { temporalMonthEnd } = await import('./assets/js/modules/temporal.js?v=' + globalThis.PANDOLAB_BUILD_META.assetRevision);
      const month = globalThis.__PANDOLAB_VIEWER__.builtinMonth().month;
      return { month, effectiveDate: temporalMonthEnd(month).canonical };
    });
    expect(selected).toEqual({ month: '1922-12', effectiveDate: '1922-12-31' });
    observations.push({ label, selected, ...await snapshot() });
  };
  try {
    await page.goto('/?debug=1&renderer=webgl2', { waitUntil: 'domcontentloaded' });
    await ready();
    const bindings = await page.evaluate(async () => {
      // The built-in map now belongs to a single project manifest; the
      // historical standalone builtinWorld build-meta field was retired.
      const catalog = globalThis.PANDOLAB_BUILD_META?.mapProject?.resources?.territorial?.catalog;
      if (!catalog) throw Error('Selected project has no territorial catalog');
      const response = await fetch(new URL(catalog, location.href));
      if (!response.ok) throw Error('Pinned builtin scope index unavailable');
      const index = await response.json();
      return ['state:soviet-union', 'state:soviet-union-ukrainian-ssr'].map(id => {
        const row = index.readIndex.records.geometryBindings.find(value => value.objectRef.id === id && value.validFrom === '1922-12-30');
        return { id, validFrom: row?.validFrom, validTo: row?.validTo };
      });
    });
    for (const binding of bindings) {
      expect(binding.validFrom).toBe('1922-12-30'); expect(binding.validTo).toBe('1925-05-12');
    }
    observations.push({ bindings });
    for (const mode of ['cold', 'reload']) {
      if (mode === 'reload') { await page.reload({ waitUntil: 'domcontentloaded' }); await ready(); }
      await year(1922); await record(mode + '-historical');
      await year(2024); observations.push({ label: mode + '-ordinary-control', ...await snapshot() });
      await year(1922); await record(mode + '-historical-return');
    }
    const documentPoint = () => page.evaluate(() => {
      const { revision, checkpoint, timelineCursor } = globalThis.__PANDOLAB_VIEWER__.documentState();
      return { revision, checkpoint, timelineCursor };
    });
    const beforeRestore = await documentPoint();
    await page.evaluate(() => {
      const gl = document.querySelector('#viewerCanvas').getContext('webgl2');
      const extension = gl?.getExtension('WEBGL_lose_context');
      if (!extension) throw Error('Real WebGL context-loss exercise is unavailable');
      globalThis.__historicalContextRestore = extension;
      extension.loseContext();
    });
    await expect.poll(() => page.evaluate(() => globalThis.__PANDOLAB_VIEWER__.rendererStats().webglContextLost)).toBe(true);
    await page.evaluate(() => globalThis.__historicalContextRestore.restoreContext());
    await ready('1922-12');
    await expect.poll(async () => {
      const { stats } = await snapshot();
      return stats.renderer === 'webgl2' && stats.webglContextLost === false;
    }, { timeout: 30_000 }).toBe(true);
    await record('real-context-restored');
    expect(await documentPoint()).toEqual(beforeRestore);
    expect(errors).toEqual([]); expect(consoleErrors).toEqual([]);
    await page.screenshot({ path: info.outputPath('historical-prepared-scene.png') });
  } finally {
    const last = await snapshot().catch(error => ({ unavailable: error.message }));
    await writeFile(info.outputPath('historical-prepared-scene.json'), JSON.stringify({ observations, last, errors, consoleErrors,
      limits: ['The generated Soviet scope.extra no-raster packet is not a normal runtime display feature. This UI test does not claim that packet was drawn or uploaded.', 'Exact no-raster packet and GPU lifecycle contracts are covered separately by component tests.', 'Reload alone does not prove a persistent cache hit; Canvas fallback is not exercised.'],
    }, null, 2));
  }
});
