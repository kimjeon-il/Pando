import { expect, test } from '@playwright/test';

test.use({ channel: 'chromium', viewport: { width: 1440, height: 900 } });

test('editing a river color advances the actual GPU edit revision and undo restores the color', async ({ page }) => {
  test.setTimeout(45_000);
  page.setDefaultTimeout(8_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/assets/css/app.css');
  await page.evaluate(async () => {
    const { PROJECT_SCHEMA_VERSION, DISTRIBUTION_MODEL_SCHEMA_VERSION, LAYER_PRESENTATION_SCHEMA_VERSION } =
      await import('/assets/js/modules/version-contract.js');
    const { assertCurrentProjectSchema } = await import('/assets/js/modules/project-state.js');
    const saved = { format: 'pandolab-autosave-delta', schemaVersion: PROJECT_SCHEMA_VERSION,
      version: '0.34.0', savedAt: '2026-10-01T00:00:00Z', countryDelta: { changed: [], removedIds: [] },
      landObjectModel: { schemaVersion: 2, purpose: 'lossless-fallback', directCreation: false,
        coastlineAuthority: 'countries', sourceProvenanceSchemaVersion: 1 },
      territorialModel: { schemaVersion: 2 }, distributionModel: { schemaVersion: DISTRIBUTION_MODEL_SCHEMA_VERSION },
      distributionSettings: { renderMode: 'overlap', activeLayerId: '', boundaryVisible: true },
      layerPresentation: { schemaVersion: LAYER_PRESENTATION_SCHEMA_VERSION, overlayOrder: [], styles: {} },
      hydroEdits: [{ type: 'Feature', id: '00000000-0000-4000-8000-000000000005',
        geometry: { type: 'LineString', coordinates: [[5, 45], [8, 46], [10, 45]] },
        properties: { pandolab_schema_version: 1, category: 'river', name: '메타데이터 검증 강', editorColor: '#3b82c4', notes: '', source: 'test', locked: false } }],
    };
    assertCurrentProjectSchema(saved);
    localStorage.setItem('pandolab-editor-project', JSON.stringify(saved));
  });
  await page.goto('/?debug=1');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 30_000 });
  await page.locator('#objectSearchBtn').click();
  await page.locator('#layerSearchInput').fill('메타데이터 검증 강');
  await page.locator('#layerSearchResults .layer-search-result').click();
  await expect(page.locator('#hydroProperties')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu.hydroEditBatchCount)).toBe(1);
  const originalColor = await page.locator('#hydroColorInput').inputValue();
  const before = await page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu.hydroEditRevision);
  await page.locator('#hydroColorTrigger').click();
  const swatch = page.locator(`#hydroColorPopover [data-color-value]:not([data-color-value="${originalColor}"])`).first();
  const nextColor = await swatch.getAttribute('data-color-value');
  await swatch.click();
  await expect(page.locator('#hydroColorInput')).toHaveValue(nextColor);
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu.hydroEditRevision)).toBe(before + 1);
  await page.locator('#undoBtn').click();
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu.hydroEditRevision)).toBeGreaterThan(before + 1);
  await expect(page.locator('#hydroColorInput')).toHaveValue(originalColor);
  expect(errors).toEqual([]);
});
