import { test, expect } from '@playwright/test';
import { createViewerProjectPackage } from '../fixtures/viewer-project-package.mjs';

const cases = [
  { viewport: { width: 640, height: 360 }, hasTouch: true },
  { viewport: { width: 844, height: 390 }, hasTouch: true },
  { viewport: { width: 1280, height: 800 }, hasTouch: false },
];

for (const { viewport, hasTouch } of cases) {
  test.describe(`viewer search at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, hasTouch });

    test('opens search and selects a project object across the supported orientation', async ({ page }, testInfo) => {
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => {
        localStorage.setItem('pandolab-editor-project', 'preserve-editor-autosave');
        // Match the existing viewer layout test's Canvas rendering path.
        const getContext = window.HTMLCanvasElement.prototype.getContext;
        window.HTMLCanvasElement.prototype.getContext = function(type, ...args) {
          return String(type).includes('webgl') ? null : getContext.call(this, type, ...args);
        };
      });
      await page.goto('/?debug=1');

      const root = page.locator('.viewer-root');
      const searchButton = page.locator('#objectSearchBtn');
      if (hasTouch) {
        await expect(root).toHaveAttribute('data-layout', 'phone-landscape');
        expect(await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches)).toBe(true);
        expect(await page.evaluate(() => navigator.maxTouchPoints)).toBeGreaterThan(0);
      }
      await expect(searchButton).toBeVisible();
      await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready', 'true', { timeout: 120000 });

      const fixture = await createViewerProjectPackage('회전 검색 검증 지도');
      await page.locator('#projectFileInput').setInputFiles({
        name: 'responsive-search.gpkg',
        mimeType: 'application/geopackage+sqlite3',
        buffer: fixture.bytes,
      });
      await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEWER__.documentSnapshot().baseDataset))
        .toBe(fixture.project.baseDataset);
      await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready', 'true');
      const before = await page.evaluate(() => ({
        project: window.__PANDOLAB_VIEWER__.documentSnapshot(),
        state: window.__PANDOLAB_VIEWER__.documentState(),
      }));
      const targetId = fixture.project.territorialEntities[0].id;
      const expectedSelection = [{
        domain: 'territorial', type: 'entity', id: targetId, key: `territorial:entity:${targetId}`,
      }];
      const orientations = hasTouch
        ? [viewport, { width: viewport.height, height: viewport.width }, viewport]
        : [viewport];

      for (const [index, size] of orientations.entries()) {
        await page.setViewportSize(size);
        if (hasTouch) {
          await expect(root).toHaveAttribute('data-layout', size.width > size.height ? 'phone-landscape' : 'mobile');
        }
        await expect(searchButton).toBeVisible();
        await expect(searchButton).toBeInViewport();
        if (hasTouch) await searchButton.tap();
        else await searchButton.click();
        const input = page.getByLabel('지도에서 찾기', { exact: true });
        await expect(input).toBeVisible();
        await input.fill('회전 검색 검증 지도');
        const result = page.locator('#objectSearchResults button').filter({ hasText: '회전 검색 검증 지도' }).first();
        await expect(result).toBeVisible();
        if (hasTouch) await result.tap();
        else await result.click();
        await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEWER__.selectionSnapshot().items))
          .toEqual(expectedSelection);
        await expect(page.locator('#objectSearchSurface')).toBeHidden();

        expect(await page.evaluate(() => window.__PANDOLAB_VIEWER__.documentSnapshot())).toEqual(before.project);
        const after = await page.evaluate(() => window.__PANDOLAB_VIEWER__.documentState());
        expect(after.checkpoint).toBe(before.state.checkpoint);
        expect(after.presentationCheckpoint).toBe(before.state.presentationCheckpoint);
        expect(await page.evaluate(() => localStorage.getItem('pandolab-editor-project'))).toBe('preserve-editor-autosave');
        if (index === 0) await page.screenshot({ path: testInfo.outputPath('search-result-selected.png') });
      }
      expect(errors).toEqual([]);
    });
  });
}
