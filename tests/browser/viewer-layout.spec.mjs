import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { createViewerProjectPackage } from '../fixtures/viewer-project-package.mjs';

test('existing surfaces preserve project and selection across portrait, tablet and landscape sizes', async ({ page }) => {
  const fixture=await createViewerProjectPackage('화면 검증 지도');
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    const getContext=window.HTMLCanvasElement.prototype.getContext;
    window.HTMLCanvasElement.prototype.getContext=function(type,...args){return String(type).includes('webgl')?null:getContext.call(this,type,...args);};
  });
  await page.goto('/');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:120000});
  await page.locator('#viewerFile').setInputFiles({name:'layout.gpkg',mimeType:'application/geopackage+sqlite3',buffer:fixture.bytes});
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot().baseDataset)).toBe(fixture.project.baseDataset);
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true');
  const before=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot());
  mkdirSync('reports/images/viewer-editor',{recursive:true});
  for(const viewport of [{width:390,height:844},{width:768,height:1024},{width:1024,height:768},{width:844,height:390}]){
    await page.setViewportSize(viewport);
    await page.locator('#viewerSearchToggle').click();
    await page.locator('#viewerSearch').fill('화면 검증 지도');
    await page.locator('#viewerResults button').filter({hasText:'화면 검증 지도'}).first().click();
    await expect(page.locator('#viewerInfo')).toContainText('원본 메타데이터 보존');
    await page.locator('#viewerInfoClose').click();
    await page.keyboard.press('Escape');
    await page.locator('#viewerDisplayToggle').click();
    await page.locator('#viewerFlat').click();
    const panel=await page.locator('#viewerDisplayPanel').boundingBox();
    expect(panel.x).toBeGreaterThanOrEqual(0);expect(panel.y).toBeGreaterThanOrEqual(0);
    expect(panel.x+panel.width).toBeLessThanOrEqual(viewport.width);
    expect(panel.y+panel.height).toBeLessThanOrEqual(viewport.height);
    await page.screenshot({path:`reports/images/viewer-editor/current-${viewport.width}x${viewport.height}.png`});
    await page.locator('#viewerDisplayClose').click();
    expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot())).toEqual(before);
    expect((await page.evaluate(()=>window.__PANDOLAB_VIEWER__.selectionSnapshot())).items).toEqual([{domain:'territorial',type:'entity',id:'A'}]);
  }
  expect(errors).toEqual([]);
});
