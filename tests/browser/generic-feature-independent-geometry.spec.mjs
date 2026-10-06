import { expect, test } from '@playwright/test';
import { staticAutosaveProject } from '../helpers/timeline-project.mjs';
import { GENERIC_FEATURE_SCHEMA_VERSION, SOURCE_PROVENANCE_SCHEMA_VERSION } from '../../assets/js/modules/version-contract.js';

test('restored generic geometry ignores source ownership metadata', async ({ page }) => {
  test.setTimeout(60_000);
  page.setDefaultTimeout(10_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(() => {
    window.__genericWorkerOperations = [];
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(message, ...args) {
      if (message?.type === 'execute') window.__genericWorkerOperations.push(message.operation);
      return send.call(this, message, ...args);
    };
  });
  const geometry = { type: 'Polygon', coordinates: [[[5, 45], [5, 55], [15, 55], [15, 45], [5, 45]]] };
  await page.goto('/assets/css/app.css');
  const saved = staticAutosaveProject({
      layerVisibility: { genericFeatures: true },
      genericFeatures: [{ type: 'Feature', id: '00000000-0000-4000-8000-000000000006', geometry,
        properties: { schemaVersion: GENERIC_FEATURE_SCHEMA_VERSION, name: '독립 형상 검증', color: '#8c68d8', notes: '', locked: false,
          source: { schemaVersion: SOURCE_PROVENANCE_SCHEMA_VERSION, kind: 'gis', sourceId: 'original', sourceFormat: 'geojson',
            details: { legacyGenericSemantics: { ownerId: 'DEU', landBinding: 'hard' } } } } }],
  });
  await page.evaluate(saved => localStorage.setItem('pandolab-editor-project', JSON.stringify(saved)), saved);
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 30_000 });
  await page.locator('#objectSearchBtn').click();
  await page.locator('#layerSearchInput').fill('독립 형상 검증');
  await page.locator('#layerSearchResults .layer-search-result').click();
  await expect(page.locator('#genericFeatureProperties')).toBeVisible();
  const shape = page.locator('path.generic-feature-shape');
  await expect(shape).toHaveCount(1);
  expect(await shape.evaluate(node => node.__data__.geometry)).toEqual(geometry);
  expect(await shape.evaluate(node => node.__data__.properties.source.details.legacyGenericSemantics))
    .toEqual({ ownerId: 'DEU', landBinding: 'hard' });
  expect(await shape.getAttribute('d')).toBeTruthy();
  expect(await page.evaluate(() => window.__genericWorkerOperations)).not.toContain('territorial-land-clip');
  expect(errors).toEqual([]);
});
