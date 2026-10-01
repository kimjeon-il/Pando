import { expect, test } from '@playwright/test';
import { encodePlaceTile } from '../../assets/js/modules/place-codec.js';

test.use({ viewport:{width:1440,height:900} });

test('builtin selection is readonly, copy edits separately, and undo restores builtin ownership',async({page,context})=>{
  test.setTimeout(90_000);
  page.setDefaultTimeout(8_000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const records=[{source:'synthetic',sourceId:'seoul',name:'서울 Synthetic',kind:'capital',coordinates:[127,37],minZoom:0,priority:90},
    {source:'synthetic',sourceId:'london',name:'London Synthetic',kind:'capital',coordinates:[0,51],minZoom:0,priority:90}];
  const bytes=Buffer.from(encodePlaceTile(records));
  const row={shard:'test',offset:0,length:bytes.length};
  const manifest={version:1,revision:'browser-synthetic',stages:[{id:0,minZoom:0,columns:1,rows:1}],tiles:{'0/0-0':row},shards:{test:{url:'test.bin',bytes:bytes.length}},
    search:{'서울':[{...row,first:'서울 synthetic',last:'서울 synthetic'}],lo:[{...row,first:'london synthetic',last:'london synthetic'}]}};
  await context.route('**/assets/data/places/**',route=>route.fulfill({status:200,contentType:route.request().url().includes('manifest.json')?'application/json':'application/octet-stream',body:route.request().url().includes('manifest.json')?JSON.stringify(manifest):bytes}));
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:60_000});
  await page.locator('#objectSearchBtn').click();
  await page.locator('#layerSearchInput').fill('서울');
  const result=page.locator('[data-object-search-select="labels"][data-item-id="builtin:place:synthetic:seoul"]');
  await expect(result).toBeVisible();await result.click();
  await expect(page.locator('#labelProperties')).toBeVisible();
  await expect(page.locator('#labelNameInput')).toHaveAttribute('readonly','');
  await expect(page.locator('#labelKindInput')).toBeDisabled();
  await expect(page.locator('#labelKindInput').locator('..').locator('.ui-select-control')).toBeDisabled();
  await expect(page.locator('#labelBuiltinSource')).toHaveText('synthetic');
  await expect(page.locator('#objectDeleteBtn')).toBeDisabled();
  await page.locator('#actionsTabBtn').click();
  await page.locator('#copyPlaceBtn').click();
  await expect(page.locator('#labelNameInput')).toBeVisible();
  await expect(page.locator('#labelNameInput')).not.toHaveAttribute('readonly','');
  await expect(page.locator('#labelKindInput')).toBeEnabled();
  await expect(page.locator('#labelKindInput').locator('..').locator('.ui-select-control')).toBeEnabled();
  await page.locator('#labelNameInput').fill('서울 편집 복사');await page.locator('#labelNameInput').press('Tab');
  await expect(page.locator('#propertyTitle')).toHaveText('서울 편집 복사');
  // Copy and subsequent edit each use the existing document history.
  await page.locator('#undoBtn').click();await page.locator('#undoBtn').click();
  await page.locator('#objectSearchBtn').click();await page.locator('#layerSearchInput').fill('서울');
  await expect(result).toBeVisible();await result.click();
  await expect(page.locator('#labelNameInput')).toHaveValue('서울 Synthetic');
  await expect(page.locator('#labelNameInput')).toHaveAttribute('readonly','');
  await expect(page.locator('[data-object-search-select="labels"]')).toHaveCount(1);
  expect(await page.locator('.user-label').count()).toBeLessThanOrEqual(2048);
  expect(errors).toEqual([]);
});
