import { setViewingProjection, setViewingLayer, closeViewingDisplay } from './helpers/viewing-display.mjs';
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
  await page.locator('#projectFileInput').setInputFiles({
    name: 'canvas-country.gpkg', mimeType: 'application/geopackage+sqlite3', buffer: fixture.bytes,
  });
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEWER__.documentSnapshot()
    .territorialEntities[0].properties.name)).toBe('Canvas 본문 선택');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready', 'true');
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEWER__.rendererStats().renderer)).toBe('canvas-worker');
  const before = await page.evaluate(() => ({
    project: window.__PANDOLAB_VIEWER__.documentSnapshot(), state: window.__PANDOLAB_VIEWER__.documentState(),
  }));

  await setViewingProjection(page,'flat');
  // The fixture deliberately overlaps A, its child B and independent region R.
  // Hide overlays and text so only a root polygon body can satisfy this click.
  for (const group of ['subunits', 'regions', 'labels', 'rivers', 'lakes']) {
    await setViewingLayer(page,group,false);
  }
  await setViewingLayer(page,'countries',true);
  await page.locator('#basemapLabelsVisible').locator('..').click();
  await closeViewingDisplay(page);
  await page.locator('#resetViewBtn').click();
  await expect(page.locator('#map text')).toHaveCount(0);
  expect((await page.evaluate(() => window.__PANDOLAB_VIEWER__.selectionSnapshot())).items).toEqual([]);
  const bounds = await page.locator('#map').boundingBox();
  // Reset preserves the current center. Use the canonical frame to hit [8,8].
  const point=await page.evaluate(()=>{const view=window.__PANDOLAB_VIEW_STATE__;return d3.geo.equirectangular().translate(view.translate).scale(view.scale).center(view.projectionCenter)([8,8]);});
  await page.mouse.click(bounds.x+point[0],bounds.y+point[1]);
  await expect(page.locator('#objectChooser')).toBeVisible();
  await expect(page.locator('#objectChooserList [data-object-chooser-index]')).toHaveCount(2);
  await page.locator('#objectChooserList [data-object-chooser-index]').filter({hasText:'Canvas 본문 선택'}).click();
  await expect(page.locator('#viewerStatus')).toHaveText('Canvas 본문 선택');
  expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot().territorialEntities[0].properties.notes)).toBe('원본 메타데이터 보존');
  expect((await page.evaluate(() => window.__PANDOLAB_VIEWER__.selectionSnapshot())).items)
    .toEqual([{ domain: 'territorial', type: 'entity', id: 'A', key: 'territorial:entity:A' }]);
  const after = await page.evaluate(() => ({
    project: window.__PANDOLAB_VIEWER__.documentSnapshot(), state: window.__PANDOLAB_VIEWER__.documentState(),
  }));
  expect(after.project).toEqual(before.project);
  expect(after.state.checkpoint).toBe(before.state.checkpoint);
  expect(after.state.presentationCheckpoint).toBe(before.state.presentationCheckpoint);
  expect(after.state.canUndo).toBe(false);
  expect(errors).toEqual([]);
});
