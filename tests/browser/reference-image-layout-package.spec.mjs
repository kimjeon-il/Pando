import { expect, test } from '@playwright/test';
import { gotoEditor } from './helpers/editor-entry.mjs';
import { staticAutosaveProject } from '../helpers/timeline-project.mjs';

test('framed inset becomes an independent shared-source image and survives actual GeoPackage reopen', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(value => localStorage.setItem('pandolab-editor-project', JSON.stringify(value)), staticAutosaveProject());
  await page.route('**/modules/app-domain-assembly.js*', async route => {
    const source = await (await route.fetch()).text();
    await route.fulfill({ contentType: 'text/javascript', body: source.replace('dependencies = ports;', 'dependencies = ports;window.__referenceProject=()=>projectDomain;') });
  });
  // OCR transcription is the only fixture. Frame detection, crop decoding,
  // Worker RPC, collection history, package encoder and Core replacement run normally.
  await page.route('**/assets/vendor/reference-analysis/tesseract.mjs', route => route.fulfill({ contentType: 'text/javascript', body: `export default {createWorker:async()=>({
    detect:async()=>({data:{script:'Latin',orientation_degrees:0,orientation_confidence:20}}),recognize:async()=>({data:{blocks:[]}}),
    setParameters:async()=>{},terminate:async()=>{}})};` }));
  await gotoEditor(page, '/');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');canvas.width = 400;canvas.height = 300;
    const context = canvas.getContext('2d');context.fillStyle = 'white';context.fillRect(0, 0, 400, 300);
    context.strokeStyle = 'black';context.lineWidth = 1;
    context.strokeRect(10.5, 10.5, 380, 280);context.strokeRect(250.5, 180.5, 120, 90);
    const blob = await new Promise(resolve => canvas.toBlob(resolve));
    const { replaceStoredReferenceImages } = await import('/assets/js/modules/reference-image-store.js');
    await replaceStoredReferenceImages([{ id: 'layout-original', name: '원본 지도', blob, mapQuad: [[0, 10], [20, 10], [20, 0], [0, 0]], controlPoints: [] }]);
  });
  await page.locator('#referenceImageBtn').click();
  const panel = page.locator('#referenceImageSurface');
  await expect(panel.locator('[data-ref-field="name"]')).toHaveValue('원본 지도');
  await panel.locator('[data-ref-tab="match"]').click();
  await panel.locator('[data-ref-action="analyze-layout"]').click();
  const choices = panel.locator('[data-ref-action="use-layout-panel"]');
  await expect(choices).toHaveCount(2, { timeout: 30_000 });
  await choices.nth(1).click();
  await expect(panel.locator('[data-ref-field="name"]')).toHaveValue('원본 지도 · 삽입도');
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGES__.list().length)).toBe(2);
  const result = await page.evaluate(async () => {
    const domain = window.__referenceProject();
    const receipt = await domain.buildFileSnapshot();
    const images = receipt.project.packageAssets.referenceImages;
    const storedSources = images.sources.length;
    await domain.save(async blob => {
      const { readProjectFile } = await import('/assets/js/modules/project-file-reader.js');
      const restored = await readProjectFile(new File([blob], 'crop-project.gpkg'));
      window.__referenceReopen = restored;
      return {};
    });
    await domain.load({ ...receipt.project, packageAssets: { schemaVersion: 1, referenceImages: { schemaVersion: 1, sources: [], records: [] } } });
    const cleared = window.__PANDOLAB_REFERENCE_IMAGES__.list().length;
    await domain.load(window.__referenceReopen);
    return { storedSources, cleared, records: window.__PANDOLAB_REFERENCE_IMAGES__.list() };
  });
  expect(result.storedSources).toBe(1);expect(result.cleared).toBe(0);expect(result.records).toHaveLength(2);
  expect(result.records[1].sourceRect).toEqual({ x: 250, y: 180, width: 121, height: 91 });
  await expect(panel.locator('[data-ref-field="name"]')).toHaveValue('원본 지도 · 삽입도');
  expect(errors).toEqual([]);
});
