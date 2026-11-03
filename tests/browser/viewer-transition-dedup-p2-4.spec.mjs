import {test,expect} from '@playwright/test';

test.use({viewport:{width:1280,height:800},trace:'off'});

test('P2-4 one accepted year switch loads physical resources once and preserves map/search state',async({page})=>{
  test.setTimeout(145000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.clock.setFixedTime(new Date(2026,9,31,12));
  await page.addInitScript(()=>{
    window.__P24_COUNTS__={land:0,physical:0,updates:0};
  });
  await page.route('**/modules/viewer-map.js*',async route=>{
    const response=await route.fetch(),source=await response.text();
    const publicPorts='loadPhysicalResources:physicalResources.loadPhysicalData,loadPhysicalLandMask:physicalResources.loadPhysicalLandMask,';
    const update='async function update() {';
    if(source.split(publicPorts).length!==2||source.split(update).length!==2)
      throw Error('P2-4 viewer-map instrumentation port changed.');
    await route.fulfill({response,body:source.replace(update,
      update+'\n    window.__P24_COUNTS__.updates++;').replace(publicPorts,
      "loadPhysicalResources:(...args)=>{window.__P24_COUNTS__.physical++;return physicalResources.loadPhysicalData(...args);},"+
      "loadPhysicalLandMask:(...args)=>{window.__P24_COUNTS__.land++;return physicalResources.loadPhysicalLandMask(...args);},")});
  });
  await page.goto('/?debug=1');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:100000});
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__?.visibleTerritorialCount())).toBeGreaterThan(0);
  const initial=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot());
  const expected={land:1,physical:1,updates:2};
  for(const month of ['2025-12','2026-10']){
    await page.evaluate(()=>{window.__P24_COUNTS__={land:0,physical:0,updates:0};});
    const button=month==='2025-12'?'#timelinePreviousYear':'#timelineNextYear';
    await page.locator(button).click();
    await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.builtinMonth().month),
      {timeout:80000}).toBe(month);
    await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true');
    await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.visibleTerritorialCount())).toBeGreaterThan(0);
    // The post-presentation handler has had a chance to run. Do not sleep.
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const counts=await page.evaluate(()=>({...window.__P24_COUNTS__}));
    console.log('P2_4_TRANSITION_COUNTS '+JSON.stringify({month,...counts}));
    expect(counts,{message:'A completed map already fetched physical land and resources in setSession'}).toEqual(expected);
    const cursor=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentState().timelineCursor);
    expect(cursor).toBe(month);
  }
  const restored=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot());
  expect(restored.territorialEntities.map(x=>x.id).sort()).toEqual(initial.territorialEntities.map(x=>x.id).sort());
  await page.locator('#objectSearchBtn').click();
  await page.locator('#objectSearchInput').fill('대한민국');
  await expect(page.locator('#objectSearchResults button').first()).toBeVisible({timeout:20000});
  expect(errors).toEqual([]);
});
