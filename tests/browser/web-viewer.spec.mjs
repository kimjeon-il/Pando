import { test, expect } from '@playwright/test';

for (const viewport of [{ width: 1280, height: 800 }, { width: 640, height: 360 }]) {
test(`existing UI loads, searches and navigates without document writes at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
  await page.setViewportSize(viewport);
  const errors=[]; page.on('pageerror', error=>errors.push(error.message));
  await page.addInitScript(()=>{
    localStorage.setItem('pandolab-editor-project','preserve-existing-editor-autosave');
    const open=indexedDB.open.bind(indexedDB);window.__viewerOpenedDatabases=[];
    indexedDB.open=(name,...args)=>{window.__viewerOpenedDatabases.push(name);return open(name,...args);};
  });
  await page.goto('/');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:120000});
  await expect(page.locator('#viewerStatus')).toContainText('객체');
  await expect(page).toHaveTitle('판도연구소');
  await expect(page.locator('#newProjectBtn, #saveProjectBtn, #undoBtn, #editorPanel')).toHaveCount(0);
  const before=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentState());
  await page.locator('#viewerSearchToggle').click();
  await page.getByLabel('지도에서 찾기', { exact: true }).fill('대한민국');
  await expect(page.locator('#viewerResults button').first()).toBeVisible();
  await page.locator('#viewerResults button').first().click();
  await expect(page.locator('#viewerInfo')).toContainText('대한민국');
  await page.locator('#viewerDisplayToggle').click();
  await page.locator('#viewerFlat').click();
  await page.locator('#viewerLayers summary').click();
  await page.getByLabel('상위 객체 표시', {exact:true}).uncheck();
  await page.getByLabel('상위 객체 표시', {exact:true}).check();
  await expect(page.locator('#viewerLayers')).toContainText('일반');
  await expect(page.locator('#viewerLayers')).toContainText('지방');
  const bounds=await page.locator('#viewerDisplayPanel').boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x+bounds.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds.y+bounds.height).toBeLessThanOrEqual(viewport.height);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath(`existing-ui-${viewport.width}x${viewport.height}.png`)});
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Delete');
  const after=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentState());
  expect(after.checkpoint).toBe(before.checkpoint);
  expect(after.presentationCheckpoint).toBe(before.presentationCheckpoint);
  expect(await page.evaluate(()=>localStorage.getItem('pandolab-editor-project'))).toBe('preserve-existing-editor-autosave');
  expect(await page.evaluate(()=>window.__viewerOpenedDatabases)).not.toContain('pandolab-editor');
  expect(errors).toEqual([]);
});
}
