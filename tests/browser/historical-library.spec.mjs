import { expect, test } from '@playwright/test';
import { selectUiOption } from './helpers/ui-select.mjs';
import { openLibrary, refuseFiniteActivation } from './helpers/library-state.mjs';

test('historical library search previews a sourced country and rejects finite activation atomically', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const errors = await openLibrary(page);
  await expect.poll(() => page.locator('#historicalLibraryResults [data-library-entity-id]').count()).toBeGreaterThan(200);
  await expect(page.locator('[data-library-entity-id="state:DEU"] .historical-library-result-flag img')).toHaveCount(1);
  await page.locator('#historicalLibrarySearchInput').fill('USSR');
  await expect(page.locator('.historical-library-filters summary')).toHaveCount(0);
  await selectUiOption(page, '#historicalLibraryStatusInput', 'past');
  await page.locator('#historicalLibraryYearInput').fill('1991');
  const result = page.locator('[data-library-entity-id="state:soviet-union"]');
  await result.click();
  await expect(result.locator('.historical-library-result-flag img')).toHaveCount(1);
  await expect(page.locator('#historicalLibraryPreview')).toContainText('소련');
  await expect(page.locator('#historicalLibraryPreview')).toContainText('근사 경계');
  await expect(page.locator('#historicalLibraryPreview')).toBeHidden();
  await expect(result).not.toHaveAttribute('aria-controls');
  await expect(page.locator('#historicalLibraryPreview a[aria-label^="출처"]')).toHaveCount(0);
  await expect(page.locator('#historicalLibraryPreview svg path')).toHaveCount(0);
  await refuseFiniteActivation(page, testInfo, 'state:soviet-union', errors);
});

test('North Schleswig 1900 remains searchable and finite activation preserves Denmark and source', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const errors = await openLibrary(page);
  await page.locator('#historicalLibrarySearchInput').fill('북슐레스비히');
  // The year filter uses the end of the year. This point snapshot is selected
  // with its exact source date when no year filter is entered.
  const result = page.locator('[data-library-entity-id="state:north-schleswig"]');
  await expect(result.locator('.historical-library-result-flag img')).toHaveCount(1);
  await result.click();
  await expect(page.locator('#historicalLibraryPreview')).toContainText('북슐레스비히');
  await refuseFiniteActivation(page, testInfo, 'state:north-schleswig', errors);
});

test('catalog search loads only the index and repeated selection loads one unchanged country chunk',async({page})=>{
  test.setTimeout(120_000);
  const requests=[];page.on('request',request=>requests.push(request.url()));
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:90_000});
  expect(requests.filter(url=>url.includes('/territorial-entities/'))).toEqual([]);
  await page.locator('#createMenuBtn').click();await page.locator('#addFromLibraryBtn').click();
  await expect(page.locator('#historicalLibrarySearchInput')).toBeEnabled();
  await page.locator('#historicalLibrarySearchInput').fill('대한민국');
  const row=page.locator('[data-library-entity-id="state:KOR"]');
  await expect(row).toBeVisible();
  expect(requests.filter(url=>url.includes('/territorial-entities/') && url.includes('.json.gz'))).toEqual([]);
  await row.click();await expect(page.locator('#historicalLibraryAddBtn')).toBeEnabled();
  await row.click();
  const [first,second]=await page.evaluate(()=>Promise.all([window.PANDOLAB_TERRITORIAL_LIBRARY.get('state:KOR'),window.PANDOLAB_TERRITORIAL_LIBRARY.get('state:KOR')]));
  expect(first).toEqual(second);expect(first.geometryVersions[0].id).toBe('state:KOR:natural-earth-5.1.1');
  expect(requests.filter(url=>url.includes('/territorial-entities/') && url.includes('index.json'))).toHaveLength(1);
  expect(requests.filter(url=>url.includes('/territorial-entities/') && url.includes('.json.gz')).map(url=>new URL(url).pathname)).toEqual(['/assets/data/territorial-entities/generated/v2/state-KOR.json.gz']);
});

test('East Germany finite activation preserves identity, archive, history, save and original source', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const errors = await openLibrary(page);
  await page.locator('#historicalLibrarySearchInput').fill('동독');
  await page.locator('[data-library-entity-id="state:deutsche-demokratische-republik"]').click();
  await expect(page.locator('#historicalLibraryPreview')).toBeHidden();
  await expect(page.locator('#historicalLibraryPreview details')).toHaveCount(0);
  await expect(page.locator('#historicalLibraryPreview svg path')).toHaveCount(0);
  await refuseFiniteActivation(page, testInfo, 'state:deutsche-demokratische-republik', errors);
});
