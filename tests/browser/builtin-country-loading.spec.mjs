import {test,expect} from '@playwright/test';
import {createViewerProjectPackage} from '../fixtures/viewer-project-package.mjs';
test.use({viewport:{width:1440,height:900},trace:'off'});
test('builtin country loading follows calendar rollover, retains manual dates and never requests the retired project',async({page})=>{
 test.setTimeout(180000);
 const requests=[],errors=[];page.on('request',request=>requests.push(request.url()));page.on('pageerror',error=>errors.push(error.message));
 await page.clock.install({time:new Date(2026,9,31,23,59)});
 await page.goto('/?debug=1&demTerrain=raster');
 await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:90000});
 expect(await page.evaluate(()=>window.PANDOLAB_BUILD_META.builtinWorld?.url)).toContain('builtin-world/generated/v1/index.json');
 await expect(page.locator('#timelineMonthButtonText')).toHaveText('2026년 10월');
 expect(requests.some(url=>/\/builtin-world\/generated\/v1\/transport\/countries-sha256-[a-f0-9]{64}\.bin/.test(url))).toBe(true);
 expect(requests.some(url=>url.includes('world-project.json.gz'))).toBe(false);
 await page.clock.setSystemTime(new Date(2026,10,1));await page.evaluate(()=>window.dispatchEvent(new window.Event('focus')));
 await expect(page.locator('#timelineMonthButtonText')).toHaveText('2026년 11월',{timeout:45000});
 await page.locator('#timelineMonthButton').click();await page.locator('#timelineYearInput').fill('1953');await page.locator('#timelineMonthInput').selectOption('6');await page.locator('#timelineGoBtn').click();
 await expect(page.locator('#timelineMonthButtonText')).toHaveText('1953년 6월',{timeout:45000});
 const source=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot().territorialEntities.find(row=>row.id==='KOR').properties.sourceGeometryVersion);
 expect(source).toBe('state:KOR:38th-parallel-1948');
 await page.clock.setSystemTime(new Date(2027,0,1));await page.evaluate(()=>window.dispatchEvent(new window.Event('focus')));
 await expect(page.locator('#timelineMonthButtonText')).toHaveText('1953년 6월');
 await page.getByRole('button',{name:'파일 메뉴 열기',exact:true}).click();await page.getByRole('menuitem',{name:'내장 지도',exact:true}).click();
 await expect(page.locator('#timelineMonthButtonText')).toHaveText('2027년 1월',{timeout:45000});
 expect(errors).toEqual([]);expect(requests.some(url=>url.includes('world-project.json.gz'))).toBe(false);
});

test('file reading suspends automatic changes and an opened document survives rollover',async({page})=>{
 test.setTimeout(150000);
 const fixture=await createViewerProjectPackage('사용자 파일 고정');
 await page.clock.install({time:new Date(2026,9,31,23,59)});
 await page.goto('/?debug=1&demTerrain=raster');
 await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:90000});
 const failed=await page.evaluate(async()=>{
  try{await window.__PANDOLAB_VIEWER__.openFile({name:'invalid.txt'});return false;}catch{return true;}
 });
 expect(failed).toBe(true);expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.builtinMonth().automatic)).toBe(true);
 await page.evaluate(bytes=>{
  window.__fileOpenResult=null;
  window.__PANDOLAB_VIEWER__.openFile({name:'delayed.gpkg',arrayBuffer:()=>new Promise(resolve=>{
   window.__releaseUserFile=()=>resolve(new Uint8Array(bytes).buffer);
  })}).then(value=>{window.__fileOpenResult=value;},error=>{window.__fileOpenResult=error.message;});
 },[...fixture.bytes]);
 await page.clock.setSystemTime(new Date(2026,10,1));await page.evaluate(()=>window.dispatchEvent(new window.Event('focus')));
 expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.builtinMonth().automatic)).toBe(false);
 await page.evaluate(()=>window.__releaseUserFile());
 await expect.poll(()=>page.evaluate(()=>window.__fileOpenResult),{timeout:45000}).toBe(true);
 await page.clock.setSystemTime(new Date(2027,0,1));await page.evaluate(()=>window.dispatchEvent(new window.Event('focus')));
 expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot().territorialEntities[0].properties.name)).toBe('사용자 파일 고정');
 expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.builtinMonth().automatic)).toBe(false);
});
