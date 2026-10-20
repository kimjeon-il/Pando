import {test,expect} from '@playwright/test';
import {gotoEditor} from './helpers/editor-entry.mjs';

test('bounds picker retains pointer ownership and cancelling preserves the project',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.route('**/modules/app-domain-assembly.js*',async route=>{
    const source=await(await route.fetch()).text();
    await route.fulfill({contentType:'text/javascript',body:source.replace('dependencies = ports;',
      'dependencies = ports; window.__boundsPorts=ports; window.__boundsProject=()=>projectDomain.state().checkpoint;')});
  });
  await gotoEditor(page,'/?renderer=canvas&demTerrain=raster');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:90000});
  const checkpoint=await page.evaluate(()=>window.__boundsProject());
  await page.evaluate(()=>window.__boundsPorts.lifecycleUi.projectUi.requestNew());
  await expect(page.locator('#projectSetupDialog')).toBeVisible();
  await page.locator('#projectSetupDraw').click();
  const rect=await page.locator('.project-bounds-picker').boundingBox();
  await page.mouse.move(rect.x+100,rect.y+100);
  await page.mouse.down();
  await page.mouse.move(rect.x+300,rect.y+250,{steps:4});
  const box=page.locator('.project-bounds-box');
  await expect.poll(async()=>Math.abs((await box.boundingBox()).width-200)).toBeLessThan(3);
  const actual=await box.boundingBox();
  expect(Math.abs(actual.x-(rect.x+100))).toBeLessThan(2);
  expect(Math.abs(actual.y-(rect.y+100))).toBeLessThan(2);
  expect(Math.abs(actual.height-150)).toBeLessThan(3);
  await expect(page.locator('#map')).not.toHaveClass(/dragging/);
  await page.mouse.up();
  await expect(page.locator('#projectSetupDialog')).toBeVisible();
  await expect(page.locator('#projectSetupBounds')).toHaveValue('custom');
  await page.locator('#projectSetupCancel').click();
  await expect(page.locator('#projectSetupDialog')).not.toBeVisible();
  expect(await page.evaluate(()=>window.__boundsProject())).toBe(checkpoint);
});
