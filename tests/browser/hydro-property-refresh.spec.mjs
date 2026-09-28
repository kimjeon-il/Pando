import { expect, test } from '@playwright/test';

const NILE_POINT = [32.421142578125, 22.6723086609316];

async function openHydroMap(page, report) {
  page.on('pageerror', error => report.pageErrors.push(error.stack || error.message));
  page.on('console', message => {
    if (message.type() === 'warning' || message.type() === 'error') report.consoleMessages.push(message.text());
  });
  await page.addInitScript(() => {
    const nativePostMessage = Worker.prototype.postMessage;
    const probe = { hold: true, pending: [], requests: 0, replies: 0, failures: 0, refreshes: 0, exceptions: [], workerErrors: [] };
    const observed = new WeakSet();
    window.__HYDRO_PROPERTY_PROBE__ = probe;
    window.addEventListener('error', event => probe.exceptions.push(String(event.error?.stack || event.message)));
    window.addEventListener('unhandledrejection', event => probe.exceptions.push(String(event.reason?.stack || event.reason)));
    const NativeWorker = window.Worker;
    window.Worker = class DiagnosticWorker extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        this.addEventListener('message', event => {
          if (String(event.data?.type || '').endsWith('error')) probe.workerErrors.push(event.data);
        });
        this.addEventListener('error', event => probe.workerErrors.push({ type: 'worker-error', message: event.message }));
      }
    };
    Worker.prototype.postMessage = function observedPostMessage(message, transfer) {
      if (!observed.has(this)) {
        observed.add(this);
        this.addEventListener('message', event => {
          if (String(event.data?.type || '').endsWith('error')) probe.workerErrors.push(event.data);
          if (event.data?.type === 'feature') probe.replies += 1;
          if (event.data?.type === 'feature-error') probe.failures += 1;
        });
        this.addEventListener('error', event => probe.workerErrors.push({ type: 'worker-error', message: event.message }));
      }
      if (message?.type === 'load-feature') {
        probe.requests += 1;
        if (probe.hold) {
          probe.pending.push({ worker: this, message, transfer });
          return;
        }
      }
      return transfer === undefined ? nativePostMessage.call(this, message) : nativePostMessage.call(this, message, transfer);
    };
    probe.release = () => {
      probe.hold = false;
      for (const item of probe.pending.splice(0)) {
        if (item.transfer === undefined) nativePostMessage.call(item.worker, item.message);
        else nativePostMessage.call(item.worker, item.message, item.transfer);
      }
    };
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/?debug=1&demTerrain=raster');
  try {
    const outcome = await Promise.race([
      page.locator('#app[data-readiness="enhanced"]').waitFor({ timeout: 120_000 }).then(() => 'enhanced'),
      page.locator('#bootstrapLoading.error').waitFor({ timeout: 120_000 }).then(() => 'error'),
    ]);
    expect(outcome).toBe('enhanced');
  } catch (error) {
    report.startup = await page.evaluate(() => ({
      loading: document.querySelector('#bootstrapLoadingText')?.textContent,
      probe: document.querySelector('#startupProbe')?.textContent,
      metrics: window.__PANDOLAB_STARTUP_METRICS__,
      exceptions: window.__HYDRO_PROPERTY_PROBE__?.exceptions,
      workerErrors: window.__HYDRO_PROPERTY_PROBE__?.workerErrors,
    }));
    console.log(`HYDRO_STARTUP_DIAGNOSTIC ${JSON.stringify(report)}`);
    throw error;
  }
  await page.locator('#flatBtn').evaluate(button => button.click());
  await expect(page.locator('#projectionStatus')).toHaveText('평면지도');
  await page.evaluate(center => {
    const host = window.__PANDOLAB_MAP_HOST__;
    const previous = host.getViewState();
    host.setViewState({ projection: 'flat', view: { ...previous, flatCenter: center, flatZoom: 16 } });
    host.requestRepaint('hydro-property-refresh-test');
  }, NILE_POINT);
  await expect.poll(() => page.evaluate(() => {
    const view = window.__PANDOLAB_VIEW_STATE__;
    const gpu = window.__PANDOLAB_RENDER_DEBUG__?.snapshot()?.gpu;
    return view?.projection === 'flat' && view.flatZoom === 16
      && gpu?.displayedRevision >= view.revision && gpu?.hydroPacksActive > 0;
  }), { timeout: 60_000 }).toBe(true);
}

async function selectNile(page) {
  const point = await page.evaluate(coordinate => window.__PANDOLAB_VIEW_DEBUG__.geoToScreen(coordinate), NILE_POINT);
  const mapBox = await page.locator('#map').boundingBox();
  expect(mapBox).not.toBeNull();
  for (const [dx, dy] of [[0, 0], [-4, 0], [4, 0], [0, -4], [0, 4]]) {
    await page.mouse.click(mapBox.x + point[0] + dx, mapBox.y + point[1] + dy);
    await page.waitForTimeout(550);
    if (await page.locator('#objectChooser').isVisible()) {
      const options = await page.locator('#objectChooserList [data-object-chooser-index]').allInnerTexts();
      const riverIndex = options.findIndex(value => /강/.test(value));
      if (riverIndex >= 0) await page.locator('#objectChooserList [data-object-chooser-index]').nth(riverIndex).click();
      else await page.locator('#objectChooserCloseBtn').click();
    }
    if (await page.locator('#propertyTitle').innerText() === '나일강'
      && await page.locator('#hydroProperties').isVisible()) return;
  }
  throw new Error('나일강 선택이 성립하지 않았습니다.');
}

async function attachReport(page, report, testInfo) {
  try {
    report.probe = await page.evaluate(() => {
      const { pending, release, ...rest } = window.__HYDRO_PROPERTY_PROBE__ || {};
      return { ...rest, pending: pending?.length || 0 };
    });
  } catch (error) {
    report.probeReadError = String(error);
  }
  await testInfo.attach('hydro-property-refresh-diagnostic.json', {
    body: JSON.stringify(report, null, 2), contentType: 'application/json',
  });
}

async function expectNoHydroRefreshTypeError(page, report) {
  const exceptions = await page.evaluate(() => window.__HYDRO_PROPERTY_PROBE__.exceptions);
  expect([...report.consoleMessages, ...report.pageErrors, ...exceptions]
    .filter(message => message.includes('objectPropertyController.presentHydro is not a function'))).toEqual([]);
}

test('selected built-in river refreshes its properties after the full geometry arrives', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const report = { pageErrors: [], consoleMessages: [] };
  try {
    await openHydroMap(page, report);
    await selectNile(page);
    await expect.poll(() => page.evaluate(() => window.__HYDRO_PROPERTY_PROBE__.requests)).toBeGreaterThan(0);
    await page.evaluate(() => {
      const probe = window.__HYDRO_PROPERTY_PROBE__;
      new MutationObserver(() => { probe.refreshes += 1; }).observe(document.querySelector('#hydroIdValue'), { childList: true, characterData: true, subtree: true });
      probe.release();
    });
    await expect.poll(() => page.evaluate(() => window.__HYDRO_PROPERTY_PROBE__.replies), { timeout: 30_000 }).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => window.__HYDRO_PROPERTY_PROBE__.refreshes), { timeout: 10_000 }).toBeGreaterThan(0);
    expect(await page.locator('#propertyTitle').innerText()).toBe('나일강');
    expect(await page.locator('#hydroProperties').isVisible()).toBe(true);
    const requestsAfterHydration = await page.evaluate(() => window.__HYDRO_PROPERTY_PROBE__.requests);
    await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('country', 'SDN'));
    await expect(page.locator('#propertyTitle')).toHaveText('수단');
    await selectNile(page);
    expect(await page.evaluate(() => window.__HYDRO_PROPERTY_PROBE__.requests)).toBe(requestsAfterHydration);
    await expectNoHydroRefreshTypeError(page, report);
  } finally {
    await attachReport(page, report, testInfo);
  }
});

test('late river geometry does not replace a newer country selection', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const report = { pageErrors: [], consoleMessages: [] };
  try {
    await openHydroMap(page, report);
    await selectNile(page);
    await expect.poll(() => page.evaluate(() => window.__HYDRO_PROPERTY_PROBE__.requests)).toBeGreaterThan(0);
    await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('country', 'SDN'));
    await expect(page.locator('#propertyTitle')).toHaveText('수단');
    await page.evaluate(() => window.__HYDRO_PROPERTY_PROBE__.release());
    await expect.poll(() => page.evaluate(() => window.__HYDRO_PROPERTY_PROBE__.replies), { timeout: 30_000 }).toBeGreaterThan(0);
    await expect(page.locator('#propertyTitle')).toHaveText('수단');
    await expect(page.locator('#hydroProperties')).toBeHidden();
    await expectNoHydroRefreshTypeError(page, report);
  } finally {
    await attachReport(page, report, testInfo);
  }
});

test('late river geometry does not restore a cleared selection', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const report = { pageErrors: [], consoleMessages: [] };
  try {
    await openHydroMap(page, report);
    await selectNile(page);
    await expect.poll(() => page.evaluate(() => window.__HYDRO_PROPERTY_PROBE__.requests)).toBeGreaterThan(0);
    for (let attempt = 0; attempt < 3 && await page.locator('#hydroProperties').isVisible(); attempt += 1) {
      await page.keyboard.press('Escape');
    }
    await expect(page.locator('#hydroProperties')).toBeHidden();
    await expect(page.locator('#selectionStatus')).toBeEmpty();
    await page.evaluate(() => window.__HYDRO_PROPERTY_PROBE__.release());
    await expect.poll(() => page.evaluate(() => window.__HYDRO_PROPERTY_PROBE__.replies), { timeout: 30_000 }).toBeGreaterThan(0);
    await expect(page.locator('#hydroProperties')).toBeHidden();
    await expect(page.locator('#selectionStatus')).toBeEmpty();
    await expectNoHydroRefreshTypeError(page, report);
  } finally {
    await attachReport(page, report, testInfo);
  }
});
