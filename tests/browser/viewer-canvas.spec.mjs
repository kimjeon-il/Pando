import { test, expect } from '@playwright/test';
import { createViewerProjectPackage } from '../fixtures/viewer-project-package.mjs';

test('Canvas viewer selects a saved country polygon body without changing project data', async ({ page }) => {
  const fixture = await createViewerProjectPackage('Canvas 본문 선택');
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(() => {
    const getContext = window.HTMLCanvasElement.prototype.getContext;
    window.HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return String(type).includes('webgl') ? null : getContext.call(this, type, ...args);
    };
  });
  await page.goto('/');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready', 'true', { timeout: 120000 });
  await page.locator('#viewerFile').setInputFiles({
    name: 'canvas-country.gpkg', mimeType: 'application/geopackage+sqlite3', buffer: fixture.bytes,
  });
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEWER__.documentSnapshot()
    .territorialEntities[0].properties.name)).toBe('Canvas 본문 선택');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready', 'true');
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEWER__.rendererStats().renderer)).toBe('canvas-worker');
  const before = await page.evaluate(() => ({
    project: window.__PANDOLAB_VIEWER__.documentSnapshot(), state: window.__PANDOLAB_VIEWER__.documentState(),
  }));

  await page.locator('#viewerDisplayToggle').click();
  await page.locator('#viewerFlat').click();
  // The fixture deliberately overlaps A, its child B and independent region R.
  // Hide overlays and text so only a root polygon body can satisfy this click.
  for (const group of ['subunits', 'regions', 'labels', 'rivers', 'lakes']) {
    const input = page.locator(`#viewerLayers input[value="${group}"]`);
    await input.evaluate(element => {
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (parent.tagName === 'DETAILS') parent.open = true;
      }
    });
    await input.uncheck();
  }
  await page.locator('#viewerDisplayClose').click();
  await page.locator('#viewerFit').click();
  await expect(page.locator('#viewerLabels text')).toHaveCount(0);
  expect((await page.evaluate(() => window.__PANDOLAB_VIEWER__.selectionSnapshot())).items).toEqual([]);
  const bounds = await page.locator('#map').boundingBox();
  // At flat fit, the shared projection maps longitude/latitude [8, 8] inside A.
  await page.mouse.click(bounds.x + bounds.width / 2 + bounds.width * 8 / 360,
    bounds.y + bounds.height / 2 - bounds.width * 8 / 360);
  await expect(page.locator('#viewerInfo h2')).toHaveText('Canvas 본문 선택');
  await expect(page.locator('#viewerInfo')).toContainText('원본 메타데이터 보존');
  expect((await page.evaluate(() => window.__PANDOLAB_VIEWER__.selectionSnapshot())).items)
    .toEqual([{ domain: 'territorial', type: 'entity', id: 'A' }]);
  const after = await page.evaluate(() => ({
    project: window.__PANDOLAB_VIEWER__.documentSnapshot(), state: window.__PANDOLAB_VIEWER__.documentState(),
  }));
  expect(after.project).toEqual(before.project);
  expect(after.state.checkpoint).toBe(before.state.checkpoint);
  expect(after.state.presentationCheckpoint).toBe(before.state.presentationCheckpoint);
  expect(after.state.canUndo).toBe(false);
  expect(errors).toEqual([]);
});
