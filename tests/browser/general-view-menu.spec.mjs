import {gotoEditor} from './helpers/editor-entry.mjs';
import {expect,test} from '@playwright/test';
import {readFileSync} from 'node:fs';

test.use({viewport:{width:1366,height:900},trace:'off',actionTimeout:10000});

test('one object menu retains common settings across keyboard navigation and mobile layout',async({page},info)=>{
  test.setTimeout(120000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/modules/app-domain-assembly.js*',async route=>{
    const source=await(await route.fetch()).text();
    await route.fulfill({contentType:'text/javascript',body:source.replace('dependencies = ports;',
      'dependencies = ports;window.__objectMenuPorts=ports;window.__objectMenuDomain=()=>projectDomain;')});
  });
  await gotoEditor(page,'/?renderer=canvas');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:90000});
  const seed=JSON.parse(readFileSync(new URL('../fixtures/timeline-exchange/complex.json',import.meta.url)));
  seed.projectSetup.initialMonth='1914-06';
  await page.evaluate(seed=>window.__objectMenuDomain().load(seed),seed);
  const before=await page.evaluate(()=>window.__objectMenuDomain().snapshot());
  await page.locator('#mapDisplayBtn').click();
  const objects=page.locator('[data-map-display-row="objects"]');
  await objects.focus();await page.keyboard.press('ArrowRight');
  await expect(page.locator('#objectsVisible')).toBeFocused();
  await expect(page.locator('#layerStylePanel-objects')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(objects).toBeFocused();
  await expect(page.locator('#layerStylePanel-objects')).toBeHidden();
  await objects.hover();
  await page.locator('#objectFlagsVisible').locator('..').click();
  await expect(page.locator('#objectFlagsVisible')).not.toBeChecked();
  await page.locator('#objectsVisible').locator('..').click();
  await expect(page.locator('#objectsVisible')).not.toBeChecked();
  await expect(page.locator('#layerStylePanel-objects .view-menu-panel-content')).toHaveJSProperty('inert',true);
  expect(await page.evaluate(()=>window.__objectMenuDomain().snapshot())).toEqual(before);
  await page.screenshot({path:info.outputPath('object-menu-desktop.png')});
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('#app')).toHaveAttribute('data-layout','mobile');
  await expect(page.locator('#objectsVisible')).toBeVisible();
  await expect(page.locator('#objectsVisible')).not.toBeChecked();
  await page.locator('#objectsVisible').locator('..').click();
  if(await objects.getAttribute('aria-expanded')!=='true')await objects.click();
  await expect(page.locator('#objectFlagsVisible')).toBeVisible();
  await expect(page.locator('#objectFlagsVisible')).not.toBeChecked();
  await expect(page.locator('#objectNamesVisible')).toBeChecked();
  await page.screenshot({path:info.outputPath('object-menu-mobile.png')});
  await page.setViewportSize({width:1366,height:900});
  await expect(page.locator('#mapDisplaySurface')).toHaveClass(/view-menu-desktop/);
  await objects.hover();
  await expect(page.locator('#objectsVisible')).toBeChecked();
  await expect(page.locator('#objectFlagsVisible')).not.toBeChecked();
  expect(await page.evaluate(()=>window.__objectMenuDomain().snapshot())).toEqual(before);
  expect(errors).toEqual([]);
});
