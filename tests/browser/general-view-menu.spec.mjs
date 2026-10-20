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
  await expect(page.locator('#layerStylePanel-objects')).toHaveJSProperty('inert',true);
  const popup = page.locator('[data-view-menu-popup="objects"]');
  await expect(popup).toHaveClass(/ui-menu-list/);
  await expect(popup).toHaveClass(/ui-menu-surface/);
  await expect(popup).toHaveAttribute('role', 'menu');
  expect(await popup.evaluate(element => element.parentElement?.dataset.mapDisplayGroup)).toBe('objects');
  expect(await page.locator('#mapDisplaySurface').evaluate(element => element.querySelector('.view-menu-popups'))).toBeNull();
  expect(await page.evaluate(()=>window.__objectMenuDomain().snapshot())).toEqual(before);
  await page.screenshot({path:info.outputPath('object-menu-desktop.png')});
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('#app')).toHaveAttribute('data-layout','mobile');
  await expect(page.locator('#objectsVisible')).toBeVisible();
  await expect(popup).not.toHaveClass(/ui-menu-list/);
  await expect(popup).not.toHaveAttribute('role', 'menu');
  expect(await popup.evaluate(element => element.parentElement?.dataset.mapDisplayGroup)).toBe('objects');
  await expect(page.locator('#objectsVisible')).not.toBeChecked();
  await page.locator('#objectsVisible').locator('..').click();
  if(await objects.getAttribute('aria-expanded')!=='true')await objects.click();
  await expect(page.locator('#objectFlagsVisible')).toBeVisible();
  await expect(page.locator('#objectFlagsVisible')).not.toBeChecked();
  await expect(page.locator('#objectNamesVisible')).toBeChecked();
  await page.screenshot({path:info.outputPath('object-menu-mobile.png')});
  await page.setViewportSize({width:1366,height:900});
  await expect(page.locator('#mapDisplaySurface')).toHaveClass(/view-menu-desktop/);
  await expect(popup).toHaveClass(/ui-menu-list/);
  expect(await popup.evaluate(element => element.parentElement?.dataset.mapDisplayGroup)).toBe('objects');
  await objects.hover();
  await expect(page.locator('#objectsVisible')).toBeChecked();
  await expect(page.locator('#objectFlagsVisible')).not.toBeChecked();
  expect(await page.evaluate(()=>window.__objectMenuDomain().snapshot())).toEqual(before);
  expect(errors).toEqual([]);
});

test('web viewer keeps the same view controls in its desktop menu and mobile sheet',async({page})=>{
  test.setTimeout(120000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/?debug=1');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:120000});

  const surface=page.locator('#mapDisplaySurface');
  const popup=surface.locator('[data-view-menu-popup="labels"]');
  const trigger=surface.locator('[data-map-display-row="labels"]');
  await page.locator('#mapDisplayBtn').click();
  await expect(surface).toHaveClass(/view-menu-desktop/);
  await expect(surface).toHaveClass(/ui-menu-surface/);
  await expect(popup).toHaveClass(/ui-menu-list/);
  await expect(popup).toHaveAttribute('role','menu');
  expect(await popup.evaluate(element=>element.parentElement?.dataset.mapDisplayGroup)).toBe('labels');

  await trigger.click();
  await expect(popup).toBeVisible();
  await expect(surface.locator('#layerStylePanel-labels')).toBeVisible();
  await expect(surface.locator('#labelsVisible')).toBeChecked();

  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('#viewer')).toHaveAttribute('data-layout','mobile');
  await expect(surface).not.toHaveClass(/view-menu-desktop/);
  await expect(surface).toHaveClass(/ui-sheet/);
  await expect(popup).not.toHaveClass(/ui-menu-list/);
  await expect(popup).not.toHaveAttribute('role','menu');
  await expect(surface.locator('#labelsVisible')).toBeVisible();
  if(await trigger.getAttribute('aria-expanded')!=='true')await trigger.click();
  await expect(surface.locator('#layerStylePanel-labels')).toBeVisible();
  expect(await popup.evaluate(element=>element.parentElement?.dataset.mapDisplayGroup)).toBe('labels');
  expect(errors).toEqual([]);
});
