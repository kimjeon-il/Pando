import { expect, test } from '@playwright/test';

async function runDebugAudit(page) {
  const panel = page.locator('#debugMapPanel');
  await panel.getByRole('button', { name: '전체 지도 검사' }).click();
  await expect.poll(() => panel.locator('pre').innerText(), { timeout: 120_000 }).toContain('audit: ready / 0 issues');
}

test('East Prussia r2 library entry adds an exact overlap-free country', async ({ page }) => {
  test.setTimeout(240_000);
  const consoleIssues = [];
  page.on('pageerror', error => consoleIssues.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'warning' && message.text().includes('GL Driver Message')) return;
    if (['error', 'warning'].includes(message.type())) consoleIssues.push(`${message.type()}: ${message.text()}`);
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?debug');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 60_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 120_000 });

  const before = await page.evaluate(() => ({
    count: window.PANDOLAB_TERRITORIAL.list({ type: 'country' }).length,
    geometries: Object.fromEntries(['POL', 'RUS', 'LTU'].map(id => [id, JSON.stringify(
      window.PANDOLAB_TERRITORIAL.get(id)?.geometry,
    )])),
  }));

  await page.locator('#createMenuBtn').click();
  await page.locator('#addFromLibraryBtn').click();
  await expect(page.locator('#historicalLibraryModal')).toBeVisible();
  await page.locator('#historicalLibrarySearchInput').fill('동프로이센');
  await page.locator('#historicalLibraryYearInput').fill('1900');
  const result = page.locator('[data-library-entity-id="historical-country:east-prussia"]');
  await expect(result).toBeVisible();
  await result.click();
  await expect(page.locator('#historicalLibraryPreview')).toContainText('동프로이센주');
  await page.locator('#historicalLibraryPreview details summary').click();
  await expect(page.locator('#historicalLibraryPreview details')).toContainText('exact');
  await expect(page.locator('#historicalLibraryPreview details')).toContainText('high');
  await expect(page.locator('#historicalLibraryPreview svg path')).toHaveCount(1);

  const sourceBefore = await page.evaluate(() => JSON.stringify(
    window.PANDOLAB_HISTORICAL_LIBRARY.get('historical-country:east-prussia').geometryVersions[0].geometry,
  ));
  await page.locator('#historicalLibraryAddBtn').click();
  await expect(page.locator('#historicalLibraryAddOptions')).toBeVisible();
  await page.locator('#historicalLibraryAddBtn').click();
  await expect(page.locator('#historicalLibraryModal')).toBeHidden();

  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.get(
    'historical-country:east-prussia',
  )?.id || '')).toBe('historical-country:east-prussia');
  const resultState = await page.evaluate(() => {
    const countries = window.PANDOLAB_TERRITORIAL.list({ type: 'country' });
    const east = window.PANDOLAB_TERRITORIAL.get('historical-country:east-prussia');
    const overlapIds = ['POL', 'RUS', 'LTU'].filter(id => {
      const country = window.PANDOLAB_TERRITORIAL.get(id);
      return window.polygonClipping.intersection(east.geometry.coordinates, country.geometry.coordinates).length;
    });
    return {
      count: countries.length,
      color: east.properties.style.color,
      id: east.id,
      name: east.properties.name,
      validFrom: east.properties.validFrom,
      validTo: east.properties.validTo,
      components: east.geometry.coordinates.length,
      overlapIds,
      sourceAfter: JSON.stringify(window.PANDOLAB_HISTORICAL_LIBRARY.get(
        'historical-country:east-prussia',
      ).geometryVersions[0].geometry),
    };
  });
  expect(resultState).toEqual({
    count: before.count + 1,
    color: '#53657A',
    id: 'historical-country:east-prussia',
    name: '동프로이센주',
    validFrom: '1878-04-01',
    validTo: '1920-01-10',
    components: 2,
    overlapIds: [],
    sourceAfter: sourceBefore,
  });
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.pendingCountryCount || 0), {
    timeout: 45_000,
  }).toBe(0);
  await runDebugAudit(page);

  await page.locator('#undoBtn').click();
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.get(
    'historical-country:east-prussia',
  ))).toBeNull();
  const afterUndo = await page.evaluate(() => ({
    count: window.PANDOLAB_TERRITORIAL.list({ type: 'country' }).length,
    geometries: Object.fromEntries(['POL', 'RUS', 'LTU'].map(id => [id, JSON.stringify(
      window.PANDOLAB_TERRITORIAL.get(id)?.geometry,
    )])),
  }));
  expect(afterUndo).toEqual(before);
  expect(consoleIssues).toEqual([]);
});
