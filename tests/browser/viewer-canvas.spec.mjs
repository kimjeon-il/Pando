import { openViewingDisplay, setViewingLayer, closeViewingDisplay } from './helpers/viewing-display.mjs';
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
  await page.goto('/?debug=1');
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

  await openViewingDisplay(page);
  // The fixture contains overlapping polygons; choose A explicitly from the real hit list.
  // Hide labels and hydro layers so the click targets the actual polygon body.
  for (const group of ['labels', 'rivers', 'lakes']) {
    await setViewingLayer(page,group,false);
  }
  await setViewingLayer(page,'objects',true);
  await page.locator('#objectNamesVisible').locator('..').click();
  await closeViewingDisplay(page);
  await page.locator('#resetViewBtn').click();
  await expect(page.locator('#map text')).toHaveCount(0);
  expect((await page.evaluate(() => window.__PANDOLAB_VIEWER__.selectionSnapshot())).items).toEqual([]);
  const priorDisplayedRevision = await page.evaluate(() => window.__PANDOLAB_VIEWER__.rendererStats().displayedRevision);
  await page.evaluate(()=>{const host=window.__PANDOLAB_MAP_HOST__;host.setViewState({projection:'globe',view:{...host.getViewState(),globeRotation:[-5,-5,0],globeZoom:4}});host.requestRepaint('canvas-body-selection');});
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_MAP_HOST__.getViewState().globeRotation)).toEqual([-5,-5,0]);
  // Wait for the asynchronous Canvas Worker to present the new camera before picking.
  await expect.poll(() => page.evaluate(previous => {
    const stats = window.__PANDOLAB_VIEWER__.rendererStats();
    return stats.renderer === 'canvas-worker' && !stats.canvasWorkerBusy
      && stats.displayedRevision > previous && stats.displayedRevision >= stats.requestedRevision;
  }, priorDisplayedRevision), { timeout: 45_000 }).toBe(true);
  // A displayed Canvas frame is not by itself an admitted country-picking surface.
  // The renderer writes countryVisualPhase from surfacePresentation.quality.
  await expect.poll(() => page.evaluate(() => {
    const stats = window.__PANDOLAB_VIEWER__.rendererStats();
    return stats.projectRenderBlocked ? 'blocked' : stats.surfacePresentation?.quality || 'unknown';
  }), { timeout: 45_000, message: 'Country surface must leave pending before Canvas picking' }).toMatch(/^(preview|canonical)$/);
  const bounds = await page.locator('#map').boundingBox();
  // Bring the known body coordinate into the viewport and use the real projection.
  const point=await page.evaluate(()=>window.__PANDOLAB_MAP_HOST__.project([8,8]));
  expect(point[0]).toBeGreaterThan(0);expect(point[0]).toBeLessThan(bounds.width);
  expect(point[1]).toBeGreaterThan(0);expect(point[1]).toBeLessThan(bounds.height);
  await page.mouse.click(bounds.x+point[0],bounds.y+point[1]);
  const chooser = page.locator('#objectChooser');
  // A sole hit selects immediately; overlapping hits open the chooser.
  await expect.poll(async () => {
    const selected = await page.evaluate(() => window.__PANDOLAB_VIEWER__.selectionSnapshot().items);
    return selected.some(item => item.domain === 'territorial' && item.id === 'A') || await chooser.isVisible();
  }, { timeout: 15_000 }).toBe(true);
  if (await chooser.isVisible()) {
    const target = page.locator('#objectChooserList [data-object-chooser-index]').filter({hasText:'Canvas 본문 선택'});
    await expect(target).toHaveCount(1);
    await target.click();
  }
  await expect(page.locator('#viewerSelectionStatus')).toHaveText('Canvas 본문 선택');
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
