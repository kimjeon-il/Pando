import { expect, test } from '@playwright/test';
import { selectUiOption } from './helpers/ui-select.mjs';

test('historical library search previews and instantiates an independent sourced country', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 30_000 });

  await page.locator('#createMenuBtn').click();
  await page.locator('#addFromLibraryBtn').click();
  await expect(page.locator('#historicalLibraryModal')).toBeVisible();
  await expect.poll(() => page.locator('#historicalLibraryResults [data-library-entity-id]').count()).toBeGreaterThan(200);

  await page.locator('#historicalLibrarySearchInput').fill('USSR');
  await page.locator('.historical-library-filters summary').click();
  await selectUiOption(page, '#historicalLibraryStatusInput', 'past');
  await page.locator('#historicalLibraryYearInput').fill('1991');
  const result = page.locator('[data-library-entity-id="historical-country:soviet-union"]');
  await expect(result).toBeVisible();
  await result.click();
  await expect(page.locator('#historicalLibraryPreview')).toContainText('소련');
  await page.locator('#historicalLibraryPreview details summary').click();
  await expect(page.locator('#historicalLibraryPreview details')).toContainText('신뢰도');
  await expect(page.locator('#historicalLibraryPreview details')).toContainText('low');
  await expect(page.locator('#historicalLibraryPreview details')).toContainText('기능 시험용 근사 경계');
  await expect(page.locator('#historicalLibraryPreview svg path')).toHaveCount(1);

  const originalGeometry = await page.evaluate(() => JSON.stringify(
    window.PANDOLAB_HISTORICAL_LIBRARY.get('historical-country:soviet-union').geometryVersions[0].geometry,
  ));
  await page.locator('#historicalLibraryAddBtn').click();
  await expect(page.locator('#historicalLibraryAddOptions')).toBeVisible();
  await expect(page.locator('#historicalLibraryAddBtn')).toHaveText('추가 확정');
  await page.locator('#historicalLibraryAddBtn').click();
  await expect(page.locator('#historicalLibraryModal')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.list({ type: 'country' })
    .filter(unit => unit.id === 'historical-country:soviet-union').length)).toBe(1);
  const instanceId = await page.evaluate(() => window.PANDOLAB_TERRITORIAL.list({ type: 'country' })
    .find(unit => unit.id === 'historical-country:soviet-union')?.id);
  expect(instanceId).toBe('historical-country:soviet-union');
  const sourceAfterEdit = await page.evaluate(() => JSON.stringify(
    window.PANDOLAB_HISTORICAL_LIBRARY.get('historical-country:soviet-union').geometryVersions[0].geometry,
  ));
  expect(sourceAfterEdit).toBe(originalGeometry);

  await page.locator('#undoBtn').click();
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.list({ type: 'country' })
    .filter(unit => unit.id === 'historical-country:soviet-union').length)).toBe(0);
  expect(errors).toEqual([]);
});

async function autosaveContainsEastGermany(page) {
  return page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('pandolab-editor', 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const project = await new Promise((resolve, reject) => {
        const transaction = database.transaction('projects', 'readonly');
        const request = transaction.objectStore('projects').get('active-project');
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
      const changedCountries = project?.format === 'pandolab-autosave-delta'
        ? (project.countryDelta?.changed || [])
        : (project?.countriesData?.features || []);
      return changedCountries.some(country => (
        country?.id === 'historical-country:east-germany'
      )) && project?.countryOverrides?.DEU?.name === '독일 연방공화국';
    } finally {
      database.close();
    }
  });
}

async function runDebugAudit(page) {
  const panel = page.locator('#debugMapPanel');
  await panel.getByRole('button', { name: '전체 지도 검사' }).click();
  await expect.poll(() => panel.locator('pre').innerText(), { timeout: 120_000 }).toContain('audit: ready / 0 issues');
}

test('East Germany pilot subtracts canonical Germany as one undoable puzzle-fit transaction', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`error: ${message.text()}`);
    if (message.type() === 'warning' && !message.text().includes('GL Driver Message')) {
      errors.push(`warning: ${message.text()}`);
    }
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?debug');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 60_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 120_000 });

  const before = await page.evaluate(() => {
    const countries = window.PANDOLAB_TERRITORIAL.list({ type: 'country' });
    const germany = countries.find(country => country.id === 'DEU');
    return { count: countries.length, name: germany.properties.name, geometry: JSON.stringify(germany.geometry) };
  });

  await page.locator('#createMenuBtn').click();
  await page.locator('#addFromLibraryBtn').click();
  await expect(page.locator('#historicalLibraryModal')).toBeVisible();
  await page.locator('#historicalLibrarySearchInput').fill('동독');
  const result = page.locator('[data-library-entity-id="historical-country:east-germany"]');
  await expect(result).toBeVisible();
  await result.click();
  await expect(page.locator('#historicalLibraryPreview')).toContainText('기준일 1989-04-25');
  await expect(page.locator('#historicalLibraryPreview')).toContainText('신뢰도 medium');
  await expect(page.locator('#historicalLibraryPreview')).toContainText('근사 경계');
  await expect(page.locator('#historicalLibraryPreview')).toContainText('Natural Earth Admin 1');
  await expect(page.locator('#historicalLibraryPreview')).toContainText('BKG Verwaltungsgebiete');
  await expect(page.locator('#historicalLibraryPreview')).toContainText('Verlauf der Berliner Mauer');
  await page.locator('#historicalLibraryAddBtn').click();
  await page.locator('#historicalLibraryAddBtn').click();
  await expect(page.locator('#historicalLibraryModal')).toBeHidden({ timeout: 60_000 });

  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.list({ type: 'country' }).length)).toBe(before.count + 1);
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('DEU')?.properties?.name)).toBe('독일 연방공화국');
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.list({ type: 'country' })
    .filter(country => country.id === 'historical-country:east-germany').length)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.pendingCountryCount || 0), { timeout: 60_000 }).toBe(0);

  await page.locator('#undoBtn').click();
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.list({ type: 'country' })
    .filter(country => country.id === 'historical-country:east-germany').length)).toBe(0);
  const afterUndo = await page.evaluate(() => {
    const countries = window.PANDOLAB_TERRITORIAL.list({ type: 'country' });
    const germany = countries.find(country => country.id === 'DEU');
    return { count: countries.length, name: germany.properties.name, geometry: JSON.stringify(germany.geometry) };
  });
  expect(afterUndo).toEqual(before);

  const apiResult = await page.evaluate(() => window.PANDOLAB_HISTORICAL_LIBRARY.instantiate(
    'historical-country:east-germany', '1989-04-25', 'none',
  ));
  expect(apiResult.added).toBe(1);
  expect(apiResult.subtracted).toBe(1);
  expect(apiResult.deleted).toBe(0);
  expect(apiResult.affectedIds).toContain('DEU');
  const duplicate = await page.evaluate(() => window.PANDOLAB_HISTORICAL_LIBRARY.instantiate(
    'historical-country:east-germany', '1989-04-25', 'none',
  ));
  expect(duplicate).toEqual({ added: 0, subtracted: 0, deleted: 0, affectedIds: [] });

  await expect.poll(() => autosaveContainsEastGermany(page), { timeout: 20_000 }).toBe(true);
  await page.reload();
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 60_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 120_000 });
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('DEU')?.properties?.name)).toBe('독일 연방공화국');
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.list({ type: 'country' })
    .filter(country => country.id === 'historical-country:east-germany').length)).toBe(1);
  await runDebugAudit(page);
  expect(errors).toEqual([]);
});
