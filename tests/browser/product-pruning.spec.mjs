import {test,expect} from '@playwright/test';
import {gotoEditor} from './helpers/editor-entry.mjs';

test('editor advanced menus retain shared viewing settings and GIS commands without changing editing state',async({browser})=>{
 test.setTimeout(150000);
 const context=await browser.newContext({hasTouch:true,viewport:{width:1440,height:900}}),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 try{
  await gotoEditor(page,'/?renderer=canvas');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:90000});
  const before=await page.evaluate(()=>({view:window.__testEditorTimeline.state().view,month:window.__testEditorTimeline.month(),selected:window.__testEditorTimeline.state().selected}));
  const undo=await page.locator('#undoBtn').isDisabled();
  for(const viewport of [{width:1440,height:900},{width:640,height:360},{width:844,height:390}]){
   await page.setViewportSize(viewport);
   await expect(page.locator('#timelineComparePin,#timelineComparisonPanel,#autosaveRecoveryBtn')).toHaveCount(0);
   await page.locator('#mobileFileBtn').evaluate(button=>button.click());
   await expect(page.locator('#openGisBtn')).toBeHidden();
   await page.locator('#fileAdvancedBtn').click();
   await expect(page.locator('#openGisBtn')).toBeVisible();
   await expect(page.locator('#dataExportBtn')).toBeVisible();
   await page.locator('#fileAdvancedBackBtn').press('Escape');
   await expect(page.locator('#fileAdvancedBtn')).toBeFocused();
   await page.locator('#fileAdvancedBtn').press('ArrowRight');
   await expect(page.locator('#fileAdvancedBackBtn')).toBeFocused();
   await page.locator('#fileAdvancedBackBtn').click();
   await expect(page.locator('#openProjectBtn')).toBeVisible();
   await page.locator('#fileAdvancedBtn').press('Escape');
   await expect(page.locator('#fileMenu')).toBeHidden();
   if(viewport.width===1440)await page.locator('#mapDisplayBtn').click();
   else{await page.locator('#mobileMenuBtn').click();await page.locator('#mobileDisplayBtn').click();}
   const trigger=page.locator('[data-map-display-row="advanced"]');
   await expect(page.locator('[data-map-background="graticule"]')).toBeHidden();
   if(viewport.width===1440){
    await trigger.focus();await trigger.press('ArrowRight');
    await expect(page.locator('[data-map-background="graticule"]')).toBeFocused();
    await page.keyboard.press('ArrowLeft');await expect(trigger).toBeFocused();
    await trigger.press('ArrowRight');
   }else await trigger.click();
   const graticule=page.locator('[data-map-background="graticule"]');
   await expect(graticule).toBeVisible();
   await graticule.locator('..').click();
   expect(await page.evaluate(()=>window.__testEditorTimeline.state().backgroundSettings.graticule)).toBe(true);
   await graticule.locator('..').click();
   if(viewport.width===1440)await page.locator('#mapDisplayBtn').click();
   else{await trigger.click();await expect(graticule).toBeHidden();await page.locator('#mapDisplayCloseBtn').click();}
   expect(await page.evaluate(()=>({view:window.__testEditorTimeline.state().view,month:window.__testEditorTimeline.month(),selected:window.__testEditorTimeline.state().selected}))).toEqual(before);
  }
  expect(await page.locator('#undoBtn').isDisabled()).toBe(undo);
  await page.setViewportSize({width:1440,height:900});
  await page.locator('#mobileFileBtn').click();await page.locator('#fileAdvancedBtn').click();await page.locator('#dataExportBtn').click();
  await expect(page.locator('#gisExportModal')).toBeVisible();await page.locator('#gisExportCancelBtn').click();
  expect(errors).toEqual([]);
 }finally{await context.close();}
});

test('ordinary web startup has no diagnostic API and retains basic background controls',async({page})=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/?renderer=canvas');
 await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:90000});
 expect(await page.evaluate(()=>Object.hasOwn(globalThis,'__PANDOLAB_VIEWER__'))).toBe(false);
 await page.locator('#mapDisplayBtn').click();
 await expect(page.locator('[data-map-background="graticule"]')).toBeVisible();
 await expect(page.locator('[data-map-display-row="advanced"]')).toHaveCount(0);
 expect(errors).toEqual([]);
});
