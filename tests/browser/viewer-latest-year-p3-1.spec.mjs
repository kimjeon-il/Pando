import {test,expect} from '@playwright/test';

test.use({viewport:{width:1280,height:800},trace:'off'});

test('P3-1 rapid year inputs merge to the latest visible month and stale reads never publish',async({page})=>{
 test.setTimeout(175000);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.clock.setFixedTime(new Date(2026,9,31,12));
 await page.addInitScript(()=>{
   window.__P3_REQUESTS__=[];
   window.__P3_COMMITS__=[];
   window.addEventListener('pandolab:project-changed',()=>{
     const month=window.__PANDOLAB_VIEWER__?.builtinMonth?.().month;
     if(month)window.__P3_COMMITS__.push(month);
   });
 });
 await page.route('**/modules/viewer-map.js*',async route=>{
  const response=await route.fetch(),source=await response.text();
  const anchor='prepareBuiltinProject:async(month,options)=>{';
  if(source.split(anchor).length!==2)throw Error('P3-1 verified read adapter is missing');
  await route.fulfill({response,body:source.replace(anchor,anchor+
   'window.__P3_REQUESTS__.push(month);'+
   'if(window.__P3_GATE_MONTH__===month)await new Promise(resolve=>{window.__P3_RELEASE__=resolve;});')});
 });
 await page.goto('/?debug=1');
 await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:100000});
 await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__?.builtinMonth().month)).toBe('2026-10');
 const before=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentState());
 await page.evaluate(()=>{window.__P3_REQUESTS__=[];window.__P3_COMMITS__=[];});
 // Genuine timeline-control handlers, dispatched synchronously in one task.
 await page.evaluate(()=>{
   for(let i=0;i<3;i++)document.querySelector('#timelinePreviousYear').click();
 });
 await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.builtinMonth().month),
  {timeout:100000}).toBe('2023-12');
 await expect.poll(()=>page.evaluate(()=>window.__P3_REQUESTS__)).toEqual(['2023-12']);
 await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentState().timelineCursor)).toBe('2023-12');
 await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true');
 await expect(page.locator('#timelineDateButtonText')).toHaveText('2023년');
 await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.visibleTerritorialCount())).toBeGreaterThan(0);
 const firstCommit=await page.evaluate(()=>window.__P3_COMMITS__.slice());
 expect(firstCommit.filter(month=>month==='2025-12'||month==='2024-12')).toEqual([]);
 // With a genuinely pending earlier source, later intents must still win.
 await page.evaluate(()=>{window.__P3_GATE_MONTH__='2022-12';window.__P3_REQUESTS__=[];window.__P3_COMMITS__=[];});
 await page.locator('#timelinePreviousYear').click();
 await expect.poll(()=>page.evaluate(()=>typeof window.__P3_RELEASE__)).toBe('function');
 await page.evaluate(()=>{document.querySelector('#timelinePreviousYear').click();
   document.querySelector('#timelinePreviousYear').click();});
 await page.evaluate(()=>{window.__P3_RELEASE__();window.__P3_GATE_MONTH__=null;});
 await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.builtinMonth().month),
  {timeout:100000}).toBe('2020-12');
 await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentState().timelineCursor)).toBe('2020-12');
 await expect(page.locator('#timelineDateButtonText')).toHaveText('2020년');
 await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true');
 await expect(page.locator('#viewerInitialPreview')).toBeHidden();
 const result=await page.evaluate(()=>({
   requested:window.__P3_REQUESTS__.slice(),
   commits:window.__P3_COMMITS__.slice(),
   cursor:window.__PANDOLAB_VIEWER__.documentState().timelineCursor,
   month:window.__PANDOLAB_VIEWER__.builtinMonth().month,
   entities:window.__PANDOLAB_VIEWER__.visibleTerritorialCount(),
   ready:document.querySelector('#viewerStatus').dataset.ready,
 }));
 console.log('P3_1_LATEST_INTENT '+JSON.stringify(result));
 expect(result.requested).toEqual(['2022-12','2020-12']);
 expect(result.commits).not.toContain('2022-12');expect(result.commits).not.toContain('2021-12');
 expect(result.entities).toBeGreaterThan(0);
 expect(result.ready).toBe('true');
 expect(before.checkpoint).toBeDefined();
 await page.locator('#objectSearchBtn').click();
 await page.locator('#objectSearchInput').fill('대한민국');
 await expect(page.locator('#objectSearchResults button').first()).toBeVisible({timeout:30000});
 expect(errors).toEqual([]);
});
