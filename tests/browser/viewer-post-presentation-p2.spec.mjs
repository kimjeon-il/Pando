import {test,expect} from '@playwright/test';
test.use({viewport:{width:1280,height:800},trace:'off'});

test('P2-3 accepted map appears before search; superseded hydration cannot republish old results',async({page},info)=>{
  test.setTimeout(180000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.clock.setFixedTime(new Date('2026-10-31T00:00:00+09:00'));
  await page.addInitScript(()=>{
    window.__p2HydrationGates=[];
    window.__p2StaleHydration=0;
    window.__p2LayerEvents=0;
    window.addEventListener('pandolab:layer-ready',()=>window.__p2LayerEvents++);
  });
  await page.route('**/modules/object-search-controller.js*',async route=>{
    const response=await route.fetch(),source=await response.text();
    const marker='async function completeHydration({isCurrent=()=>true}={}) {';
    if(source.split(marker).length!==2)throw Error('P2-3 hydration generation boundary changed.');
    await route.fulfill({response,body:source.replace(marker,marker+
      '\n    await new Promise(resolve=>window.__p2HydrationGates.push(resolve));'+
      '\n    if(!isCurrent()){window.__p2StaleHydration++;return false;}')});
  });
  await page.goto('/?debug=1');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:110000});
  await expect.poll(()=>page.evaluate(()=>window.__p2HydrationGates.length)).toBe(1);
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.initialMapPresented())).toBe(true);
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.visibleTerritorialCount())).toBeGreaterThan(0);
  expect(await page.evaluate(()=>window.__p2LayerEvents)).toBe(0,'search is still pending');
  await page.locator('#timelinePreviousYear').click();
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.builtinMonth().month),{timeout:95000}).toBe('2025-12');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true');
  await expect.poll(()=>page.evaluate(()=>window.__p2HydrationGates.length)).toBe(2);
  await page.evaluate(()=>window.__p2HydrationGates[0]());
  await expect.poll(()=>page.evaluate(()=>window.__p2StaleHydration)).toBe(1);
  expect(await page.evaluate(()=>window.__p2LayerEvents)).toBe(0,'old result cannot republish after a newer map');
  await page.evaluate(()=>window.__p2HydrationGates[1]());
  await expect.poll(()=>page.evaluate(()=>window.__p2LayerEvents)).toBe(1);
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true');
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentState().timelineCursor)).toBe('2025-12');
  await page.locator('#objectSearchBtn').click();
  await page.locator('#objectSearchInput').fill('대한민국');
  await expect(page.locator('#objectSearchResults button').first()).toBeVisible({timeout:20000});
  await page.screenshot({path:info.outputPath('ready-map-search-hydrated.png')});
  expect(errors).toEqual([]);
});
