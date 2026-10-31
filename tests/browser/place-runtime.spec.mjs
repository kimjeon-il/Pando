import { gotoEditor } from './helpers/editor-entry.mjs';
import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { encodePlaceTile } from "../../shared/frontend/js/modules/place-codec.js";
import { staticAutosaveProject } from '../helpers/timeline-project.mjs';

test.use({ viewport:{width:1440,height:900} });

test('builtin selection is readonly, copy edits separately, and undo restores builtin ownership',async({page,context})=>{
  test.setTimeout(150_000);
  page.setDefaultTimeout(8_000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const records=[{source:'synthetic',sourceId:'seoul',name:'서울 Synthetic',nameEn:'Seoul',nameNative:'서울',kind:'capital',coordinates:[127,37],minZoom:0,priority:90},
    {source:'synthetic',sourceId:'london',name:'London Synthetic',nameEn:'London',nameNative:'London',kind:'capital',coordinates:[0,51],minZoom:0,priority:90}];
  const bytes=Buffer.from(encodePlaceTile(records));
  const row={shard:'test',offset:0,length:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  const manifest={version:1,revision:'browser-synthetic',stages:[{id:0,minZoom:0,columns:1,rows:1}],tiles:{'0/0-0':row},shards:{test:{url:'test.bin',bytes:bytes.length}},
    search:{'서울':[{...row,first:'서울 synthetic',last:'서울 synthetic'}],lo:[{...row,first:'london synthetic',last:'london synthetic'}]}};
  await context.route('**/assets/data/places/**',route=>route.fulfill({status:200,contentType:route.request().url().includes('manifest.json')?'application/json':'application/octet-stream',body:route.request().url().includes('manifest.json')?JSON.stringify(manifest):bytes}));
  await page.addInitScript(value => localStorage.setItem('pandolab-editor-project', JSON.stringify(value)), staticAutosaveProject());
  // Exercise the real supported Canvas backend: this gate owns Place/History
  // contracts, not headless software-WebGL throughput. Keep native UI clicks.
  await gotoEditor(page, '/?renderer=canvas');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:60_000});
  await page.locator('#mapDisplayBtn').evaluate(button => button.click());
  await page.locator('[data-map-display-row="labels"]').evaluate(button => button.click());
  const englishSwitch = page.locator('[data-place-language="en"]');
  const nativeSwitch = page.locator('[data-place-language="native"]');
  await expect(englishSwitch).toBeVisible();
  await englishSwitch.locator('..').click();
  await nativeSwitch.locator('..').click();
  await expect(englishSwitch).toBeChecked();
  await expect(nativeSwitch).toBeChecked();
  await page.locator('#mapDisplayBtn').evaluate(button => button.click());
  await page.locator('#objectSearchBtn').evaluate(button => button.click());
  await page.locator('#objectSearchInput').fill('서울');
  const result=page.locator('[data-object-search-select="labels"][data-item-id="builtin:place:synthetic:seoul"]');
  await expect(result).toBeVisible();await result.click();
  await expect(page.locator('#labelProperties')).toBeVisible({timeout:30_000});
  await expect(page.locator('#labelNameInput')).toHaveAttribute('readonly','');
  await expect(page.locator('#labelKindInput')).toBeDisabled();
  await expect(page.locator('#labelKindInput').locator('..').locator('.ui-select-control')).toBeDisabled();
  const provenance = page.locator('#labelBuiltinInfo details');
  await expect(page.locator('#labelBuiltinInfo .ui-help-text')).toContainText('원본 수정 불가');
  await expect(provenance).toBeVisible();
  await expect(provenance).not.toHaveAttribute('open');
  await expect(page.locator('#labelBuiltinSource')).toHaveText('synthetic');
  await expect(page.locator('#labelBuiltinSource')).toBeHidden();
  await provenance.locator('summary').click();
  await expect(page.locator('#labelBuiltinSource')).toBeVisible();
  await expect(page.locator('#labelBuiltinId')).toHaveText('seoul');
  await expect(page.locator('label[for="labelNotesInput"]')).toHaveClass(/ui-visually-hidden/);
  await expect(page.locator('#labelPositionValue')).toHaveText(/^(자동 배치|사용자 지정 위치)$/);
  await expect(page.locator('#objectDeleteBtn')).toBeDisabled();
  await expect(page.locator('#objectDeleteBtn')).toHaveAttribute('data-tooltip','내장 지명은 삭제할 수 없습니다.');
  await page.locator('#actionsTabBtn').click();
  await page.locator('#copyPlaceBtn').click();
  await expect(page.locator('#labelNameInput')).not.toHaveAttribute('readonly','',{timeout:30_000});
  await expect(page.locator('#labelNameInput')).toBeVisible();
  await expect(page.locator('#labelKindInput')).toBeEnabled();
  await expect(page.locator('#labelKindInput').locator('..').locator('.ui-select-control')).toBeEnabled();
  await expect(page.locator('#labelBuiltinInfo')).toBeHidden();
  await expect(page.locator('#labelNotesInput')).not.toHaveAttribute('readonly', '');
  await page.locator('#objectSearchBtn').evaluate(button => button.click());
  await page.locator('#objectSearchInput').fill('서울');
  await expect(result).toHaveCount(0);
  await expect(page.locator('[data-object-search-select="labels"]')).toHaveCount(1);
  // Undo the copy itself; the builtin source must immediately become searchable again.
  await page.locator('#undoBtn').evaluate(button => button.click());
  await expect(result).toBeVisible({timeout:30_000});await result.click();
  await expect(page.locator('#labelNameInput')).toHaveValue('서울 Synthetic');
  await expect(page.locator('#labelNameInput')).toHaveAttribute('readonly','',{timeout:30_000});
  await expect(page.locator('#labelBuiltinInfo details')).not.toHaveAttribute('open');
  // Selecting a search hit closes/clears the result list. Reopen to verify
  // the original indexed place is again the only result after undo.
  await page.locator('#objectSearchBtn').evaluate(button => button.click());
  await page.locator('#objectSearchInput').fill('서울');
  await expect(result).toBeVisible();
  await expect(page.locator('[data-object-search-select="labels"]')).toHaveCount(1);
  expect(await page.locator('.user-label').count()).toBeLessThanOrEqual(2048);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pandolab-user-preferences')).labels.place.languages)).toEqual({ko:true,en:true,native:true});
  expect(errors).toEqual([]);
});
