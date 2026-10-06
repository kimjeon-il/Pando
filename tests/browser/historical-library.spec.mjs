import { expect, test } from '@playwright/test';
import { openLibrary, importFiniteSource } from './helpers/library-state.mjs';

test('historical library search previews a sourced country and imports a static instance reversibly', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const errors = await openLibrary(page);
  await expect.poll(() => page.locator('#territorialLibraryResults [data-library-entity-id]').count()).toBeGreaterThan(200);
  await expect(page.locator('[data-library-entity-id="state:DEU"] .territorial-library-result-flag img')).toHaveCount(1);
  await page.locator('#territorialLibrarySearchInput').fill('USSR');
  await expect(page.locator('.territorial-library-filters summary')).toHaveCount(0);
  await page.locator('#territorialLibraryReferenceDateInput').fill('1991-01-01');
  const result = page.locator('[data-library-entity-id="state:soviet-union"]');
  await result.click();
  await expect(result.locator('.territorial-library-result-flag img')).toHaveCount(1);
  await expect(page.locator('#territorialLibraryPreview')).toContainText('소련');
  await expect(page.locator('#territorialLibraryPreview')).toContainText('근사 경계');
  await expect(page.locator('#territorialLibraryPreview')).toBeVisible();
  await expect(result).toHaveAttribute('aria-controls','territorialLibraryPreview');
  await expect(page.locator('#territorialLibraryPreview a[aria-label^="출처"]')).toHaveCount(0);
  await expect(page.locator('#territorialLibraryPreview svg path')).toHaveCount(1);
  await importFiniteSource(page, testInfo, 'state:soviet-union', errors);
});

for(const renderer of ['webgl2','canvas']) test(`${renderer}: North Schleswig exact-date import preserves source and Undo`, async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const errors = await openLibrary(page,{renderer});
  await page.locator('#territorialLibrarySearchInput').fill('북슐레스비히');
  await page.locator('#territorialLibraryReferenceDateInput').fill('1900-01-01');
  const result = page.locator('[data-library-entity-id="state:north-schleswig"]');
  await expect(result.locator('.territorial-library-result-flag img')).toHaveCount(1);
  await result.click();
  await expect(page.locator('#territorialLibraryPreview')).toContainText('북슐레스비히');
  await importFiniteSource(page, testInfo, 'state:north-schleswig', errors);
});

test('catalog search loads only the index and repeated selection loads one unchanged country chunk',async({page},testInfo)=>{
  test.setTimeout(120_000);
  const requests=[];page.on('request',request=>requests.push(request.url()));
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:90_000});
  expect(requests.filter(url=>url.includes('/territorial-entities/'))).toEqual([]);
  await page.locator('#createMenuBtn').click();await page.locator('#addFromLibraryBtn').click();
  await expect(page.locator('#territorialLibrarySearchInput')).toBeEnabled();
  await page.locator('#territorialLibrarySearchInput').fill('대한민국');
  const row=page.locator('[data-library-entity-id="state:KOR"]');
  await expect(row).toBeVisible();
  expect(requests.filter(url=>url.includes('/territorial-entities/') && url.includes('.json.gz'))).toEqual([]);
  await row.click();await expect(page.locator('#territorialLibraryAddBtn')).toBeEnabled();
  await row.click();
  const [first,second]=await page.evaluate(()=>Promise.all([window.PANDOLAB_TERRITORIAL_LIBRARY.get('state:KOR'),window.PANDOLAB_TERRITORIAL_LIBRARY.get('state:KOR')]));
  expect(first).toEqual(second);expect(first.geometryVersions[0].versionId).toBe('state:KOR:natural-earth-5.1.1');
  expect(requests.filter(url=>url.includes('/territorial-entities/') && url.includes('index.json'))).toHaveLength(1);
  expect(requests.filter(url=>url.includes('/territorial-entities/') && url.includes('.json.gz')).map(url=>new URL(url).pathname)).toEqual(['/assets/data/territorial-entities/generated/v2/state-KOR.json.gz']);
  await page.locator('#territorialLibraryReferenceDateInput').fill('1970');
  await page.locator('#territorialLibrarySearchInput').fill('독일');
  await expect(page.locator('.territorial-library-lineage-title')).toContainText('독일');
  await page.locator('[data-library-entity-id="state:deutsche-demokratische-republik"]').click();
  await expect(page.locator('#territorialLibraryPreview')).toContainText('국토 자료가 없습니다');
  await expect(page.locator('#territorialLibraryAddBtn')).toBeDisabled();
  await page.locator('#territorialLibraryReferenceDateInput').fill('1989-04-25');
  await expect(page.locator('[data-library-entity-id="state:DEU"]')).toBeVisible();
  await expect(page.locator('[data-library-entity-id="state:deutsche-demokratische-republik"]')).toBeVisible();
  await expect(page.locator('#territorialLibraryPreview [data-geometry-version-id]')).toHaveAttribute('data-geometry-version-id','state:deutsche-demokratische-republik:1989-04-25-r1');
  await expect(page.locator('#territorialLibraryAddBtn')).toBeEnabled();
  const previewAspect=await page.locator('#territorialLibraryPreview svg path').evaluate(path=>{const b=path.getBBox();return b.width/b.height;});
  const sourceAspect=await page.evaluate(async()=>{const e=await window.PANDOLAB_TERRITORIAL_LIBRARY.get('state:deutsche-demokratische-republik');
    const points=e.geometryVersions[0].geometry.coordinates.flat(2),x=points.map(p=>p[0]),y=points.map(p=>p[1]);return (Math.max(...x)-Math.min(...x))/(Math.max(...y)-Math.min(...y));});
  expect(Math.abs(previewAspect-sourceAspect)).toBeLessThan(0.03);
  expect(await page.locator('#territorialLibraryPreview svg path').evaluate(path=>path.getBBox().height)).toBeGreaterThan(160);
  await page.screenshot({path:testInfo.outputPath('lineage-preview.png')});
  await page.locator('#territorialLibraryCloseBtn').click();
  await page.evaluate(()=>window.PANDOLAB_TERRITORIAL.select('DEU'));
  await page.locator('#flagMenuBtn').click();await page.locator('#flagLibraryBtn').click();
  await page.locator('#territorialLibrarySearchInput').fill('일본');
  const flagSource=await page.evaluate(async()=> (await window.PANDOLAB_TERRITORIAL_LIBRARY.list()).find(e=>e.entityId==='state:JPN').metadata.defaultFlagDataUrl);
  const chunksBefore=requests.filter(url=>url.includes('/territorial-entities/') && url.includes('.json.gz')).length;
  await page.locator('[data-library-entity-id="state:JPN"]').click();
  await expect(page.locator('#territorialLibraryAddBtn')).toHaveText('적용');
  await page.locator('#territorialLibraryAddBtn').click();
  await expect.poll(()=>page.evaluate(()=>window.PANDOLAB_TERRITORIAL.get('DEU').properties.metadata.flagDataUrl)).toBe(flagSource);
  expect(requests.filter(url=>url.includes('/territorial-entities/') && url.includes('.json.gz'))).toHaveLength(chunksBefore);

});

test('East Germany static import preserves identity, archive, history and original source', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const errors = await openLibrary(page);
  await page.locator('#territorialLibraryReferenceDateInput').fill('1989-04-25');
  await page.locator('#territorialLibrarySearchInput').fill('동독');
  await page.locator('[data-library-entity-id="state:deutsche-demokratische-republik"]').click();
  await expect(page.locator('#territorialLibraryPreview')).toBeVisible();
  await expect(page.locator('#territorialLibraryPreview details')).toHaveCount(0);
  await expect(page.locator('#territorialLibraryPreview svg path')).toHaveCount(1);
  await importFiniteSource(page, testInfo, 'state:deutsche-demokratische-republik', errors);
});
