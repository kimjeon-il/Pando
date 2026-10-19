import { test, expect } from '@playwright/test';
import { createViewerProjectPackage } from '../fixtures/viewer-project-package.mjs';

test('web keeps common tooltips and selection without a separate information panel', async ({ page }) => {
  page.setDefaultTimeout(15000);
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/?debug=1');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:120000});
  await page.locator('#timelinePreviousYear').hover();
  await expect(page.locator('#uiTooltip')).toBeVisible();
  await expect(page.locator('#uiTooltip')).toHaveText('1년 이전');
  const style=await page.locator('#uiTooltip').evaluate(element=>({background:getComputedStyle(element).backgroundColor,color:getComputedStyle(element).color}));
  expect(style.background).toBe('rgb(0, 0, 0)');
  expect(style.color).toBe('rgb(255, 255, 255)');
  const fixture=await createViewerProjectPackage('선택 유지');
  await page.locator('#projectFileInput').setInputFiles({name:'current.gpkg',mimeType:'application/geopackage+sqlite3',buffer:fixture.bytes});
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot().territorialEntities[0].properties.name),{timeout:30000}).toBe('선택 유지');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true');
  await page.locator('#objectSearchBtn').click();
  await page.getByLabel('지도에서 찾기',{exact:true}).fill('선택 유지');
  await page.locator('#objectSearchResults button').filter({hasText:'선택 유지'}).first().click();
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.selectionSnapshot().items.length)).toBe(1);
  await expect(page.locator('#viewerStatus')).toContainText('선택 유지');
  await expect(page.locator('#viewerInfoPanel')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('web uses the canonical compact workspace breakpoint',async({page})=>{
  page.setDefaultTimeout(15000);
  await page.setViewportSize({width:1300,height:800}); await page.goto('/?debug=1');
  await expect(page.locator('#viewer')).toHaveAttribute('data-layout','compact');
});
