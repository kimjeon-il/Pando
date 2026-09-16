import { expect, test } from '@playwright/test';
test.use({ channel: 'chromium' });

test('Russia subunit components keep input responsive and reuse preparation on hover and selection', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.__componentMetrics = { jobs: [], longTasks: [], ticks: 0 };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      postMessage(message, ...args) {
        if (message?.type === 'execute') window.__componentMetrics.jobs.push(message.operation);
        return super.postMessage(message, ...args);
      }
    };
    new window.PerformanceObserver(list => {
      window.__componentMetrics.longTasks.push(...list.getEntries().map(entry => ({ start: entry.startTime, duration: entry.duration })));
    }).observe({ type: 'longtask', buffered: true });
    setInterval(() => { window.__componentMetrics.ticks += 1; }, 50);
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?debug=1');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('country', 'RUS'));
  await page.locator('#addCountrySubunitBtn').evaluate(button => button.click());
  await expect(page.locator('#modePrimaryBtn')).toBeEnabled({ timeout: 60_000 });
  await page.locator('#modePrimaryBtn').click();
  await page.evaluate(() => { window.__componentMetrics.start = performance.now(); });
  await page.locator('#modeComponentsMethodInput').check();
  const components = page.locator('.draft-layer path.territory-component');
  await expect.poll(() => components.count(), { timeout: 60_000 }).toBeGreaterThan(1);
  const prepared = await page.evaluate(() => window.__componentMetrics.jobs.filter(job => job === 'territory-components').length);
  const ticks = await page.evaluate(() => window.__componentMetrics.ticks);
  await components.evaluateAll(nodes => {
    for (const node of nodes.slice(0, 10)) {
      node.dispatchEvent(new window.MouseEvent('mouseenter'));
      node.dispatchEvent(new window.MouseEvent('mouseleave'));
    }
    const node = nodes.at(-1);
    node.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await expect(page.locator('.draft-layer .selected-component')).toHaveCount(1);
  await expect(page.locator('#modePrimaryBtn')).toBeEnabled({ timeout: 60_000 });
  // Calculate a selection but leave the project unmodified.
  await components.last().dispatchEvent('click');
  await expect(page.locator('.draft-layer .selected-component')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__componentMetrics.ticks), { timeout: 2000 }).toBeGreaterThan(ticks + 2);
  await page.locator('#map').hover();
  await page.mouse.wheel(0, -180);
  await expect.poll(() => page.evaluate(() => window.__componentMetrics.jobs.filter(job => job === 'territory-components').length)).toBe(prepared);
  await page.locator('#modeCancelBtn').click();
  await page.locator('#modeCancelBtn').click();
  await expect(components).toHaveCount(0);
  const metrics = await page.evaluate(() => window.__componentMetrics);
  await testInfo.attach('component-responsiveness.json', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' });
  expect(metrics.longTasks.filter(task => task.start >= metrics.start && task.duration > 1000)).toEqual([]);
  expect(errors).toEqual([]);
});

test('Germany river components prepare a subunit preview before the next step', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?debug=1');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('country', 'DEU'));
  await page.locator('#addCountrySubunitBtn').evaluate(button => button.click());
  await expect(page.locator('#modePrimaryBtn')).toBeEnabled({ timeout: 60_000 });
  await page.locator('#territorialCreateNameInput').fill('하천 조각 회귀 시험');
  await page.locator('#modePrimaryBtn').click();
  await page.locator('#modeComponentsMethodInput').check();
  await page.locator('#modeRiverBoundaryInput').evaluate(input => input.click());
  const components = page.locator('.draft-layer .territory-component.river-partition');
  await expect.poll(() => components.count(), { timeout: 90_000 }).toBeGreaterThan(2);
  await components.evaluateAll(nodes => nodes.slice(0, 3).forEach(node => node.dispatchEvent(new window.MouseEvent('click', {
    bubbles: true, cancelable: true,
  }))));
  await expect(page.locator('#modePrimaryBtn')).toBeEnabled({ timeout: 60_000 });
  await expect(page.locator('#modePrimaryBtn')).toContainText('다음');
  await page.locator('#modePrimaryBtn').click();
  await expect(page.locator('#modeTaskStage')).toHaveText('결과 확인');
  await expect(page.locator('#modePrimaryBtn')).toBeEnabled();
  await expect(page.locator('#modePrimaryBtn')).toContainText('생성');
  expect(errors.filter(message => /PL-TERRITORY-PREVIEW-001|beginGeometryPreview/.test(message))).toEqual([]);
  await page.locator('#modePrimaryBtn').click();
  const created = () => page.evaluate(() => window.PANDOLAB_TERRITORIAL.list({ type: 'subunit' })
    .some(feature => feature.properties.name === '하천 조각 회귀 시험'));
  await expect.poll(created, { timeout: 60_000 }).toBe(true);
  await page.locator('#undoBtn').click();
  await expect.poll(created, { timeout: 30_000 }).toBe(false);
});
