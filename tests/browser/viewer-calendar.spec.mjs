import { test, expect } from '@playwright/test';
import { createViewerProjectPackage } from '../fixtures/viewer-project-package.mjs';
import { shiftTimelineMonth, timelineMonthLabel } from '../../shared/frontend/js/modules/timeline-controls.js';

// Keep renderer-specific fixtures and failure evidence scoped to each contract family.


test.describe("Automatic current month", () => {
test.use({viewport:{width:1440,height:900},trace:'off'});
test('builtin country loading follows calendar rollover, retains manual dates and never requests the retired project',async({page})=>{
 test.setTimeout(180000);
 const requests=[],errors=[];page.on('request',request=>requests.push(request.url()));page.on('pageerror',error=>errors.push(error.message));
 await page.clock.install({time:new Date(2026,9,31,23,59)});
 await page.goto('/?debug=1&demTerrain=raster');
 await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:90000});
 expect(await page.evaluate(()=>window.PANDOLAB_BUILD_META.builtinWorld?.url)).toContain('builtin-world/generated/v1/index.json');
 await expect(page.locator('#timelineDateButtonText')).toHaveText('2026년');
 expect(requests.some(url=>/\/builtin-world\/generated\/v1\/countries\/.*\.json\.gz/.test(url))).toBe(true);
 expect(requests.some(url=>url.includes('/builtin-world/generated/v1/transport/'))).toBe(false);
 expect(requests.some(url=>url.includes('world-project.json.gz'))).toBe(false);
 await page.clock.setSystemTime(new Date(2026,10,1));await page.evaluate(()=>window.dispatchEvent(new window.Event('focus')));
 await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.builtinMonth().month),{timeout:45000}).toBe('2026-11');
 await expect(page.locator('#timelineDateBasis')).toHaveText('현재 월 기준');
 await page.locator('#timelineDateButton').click();await page.locator('#timelineViewUnit').selectOption('month');await page.locator('#timelineYearInput').fill('1953');await page.locator('#timelineMonthInput').selectOption('6');await page.locator('#timelineGoBtn').click();
 await expect(page.locator('#timelineDateButtonText')).toHaveText('1953년 6월',{timeout:45000});
 const source=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot().territorialEntities.find(row=>row.id==='KOR').properties.sourceGeometryVersion);
 expect(source).toBe('state:KOR:38th-parallel-1948');
 expect(requests.some(url=>url.includes('/builtin-world/generated/v1/country-parts/'))).toBe(true);
 await page.clock.setSystemTime(new Date(2027,0,1));await page.evaluate(()=>window.dispatchEvent(new window.Event('focus')));
 await expect(page.locator('#timelineDateButtonText')).toHaveText('1953년 6월');
 await page.getByRole('button',{name:'파일 메뉴 열기',exact:true}).click();await page.getByRole('menuitem',{name:'내장 지도',exact:true}).click();
 await expect(page.locator('#timelineDateButtonText')).toHaveText('2027년 1월',{timeout:45000});
 expect(errors).toEqual([]);expect(requests.some(url=>url.includes('world-project.json.gz')||url.includes('/builtin-world/generated/v1/transport/'))).toBe(false);
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
});


test.describe("Last-date-wins source queries", () => {
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
});


test.describe("Manual calendar controls", () => {
test.use({ trace: 'off', hasTouch: true, actionTimeout: 15000 });

test('floating date controls preserve navigation and document state across desktop and narrow mobile', async ({ page }, testInfo) => {
  test.setTimeout(180000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('pandolab-user-preferences', JSON.stringify({ version: 2, appearance: { statusBarVisible: false } })));
  await page.goto('/?debug=1');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready', 'true', { timeout: 90000 });
  const fixture = await createViewerProjectPackage('날짜 도구 검증');
  await page.locator('#projectFileInput').setInputFiles({ name: 'date-controls.gpkg', mimeType: 'application/geopackage+sqlite3', buffer: fixture.bytes });
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEWER__.documentSnapshot().baseDataset)).toBe(fixture.project.baseDataset);
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#mapBottomStatus')).toHaveCount(0);
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true');
  await expect(page.locator('#viewerStatus')).toHaveClass('ui-visually-hidden');
  const button = page.locator('#timelineDateButton'), year = page.locator('#timelineYearInput');
  const month = page.locator('#timelineMonthInput'), popup = page.locator('#timelinePopover');
  const before = await page.evaluate(() => window.__PANDOLAB_VIEWER__.documentSnapshot());
  let current = '1914-06';
  await expect(button).toContainText('1914년');
  await expect(page.locator('#timelineDateBasis')).toHaveText('6월말 기준');
  for (const [id, delta] of [['timelinePreviousYear', -12], ['timelineNextYear', 12], ['timelinePreviousDecade', -120], ['timelineNextDecade', 120]]) {
    await expect(page.locator(`#${id} svg use`)).toHaveCount(1);
    expect(await page.locator(`#${id}`).innerText()).not.toMatch(/[«‹›»]/);
    await page.locator(`#${id}`).click();
    current = shiftTimelineMonth(current, delta).replace(/-\d{2}$/, '-12');
    await expect(button).toContainText(timelineMonthLabel(current).replace(/ \d+월$/, ''));
    await expect(page.locator('#timelineDateBasis')).toHaveText('연말 기준');
  }
  await page.locator('#preferencesBtn').click();
  await expect(page.locator('#preferencesStatusBarVisibleInput')).toHaveCount(0);
  await page.locator('#preferencesCancelBtn').click();
  for (const [width, value, selectedMonth, label] of [[1440, '1914', '7', '1914년 7월'], [1024, '1914', '7', '1914년 7월'], [800, '1914', '7', '1914년 7월'], [390, '-1', '12', '기원전 1년 12월'], [320, '10000', '3', '10000년 3월']]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(button).toBeVisible();
    if (width < 800) await button.tap(); else await button.click();
    await expect(popup).toBeVisible();
    await expect(year).toBeFocused();
    await page.locator('#timelineViewUnit').selectOption('month');
    await expect(month).toBeVisible();
    await expect(page.locator('#timelineMonthInputControl')).toHaveCount(0);
    await year.fill(value); await month.selectOption(selectedMonth);
    await year.press('Enter');
    await expect(popup).toBeHidden(); await expect(button).toBeFocused();
    await expect(button).toContainText(label);
    if (width === 1440) {
      await button.click();
      await page.locator('#timelineNextMonth').focus(); await page.keyboard.press('Enter');
      await expect(popup).toBeVisible(); await expect(button).toContainText('1914년 8월');
      await page.locator('#timelinePreviousMonth').focus(); await page.keyboard.press('Enter');
      await expect(popup).toBeVisible(); await expect(button).toContainText(label);
      await page.keyboard.press('Escape');
    }
    const layout = await page.evaluate(() => {
      const bounds = el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
      const root = document.getElementById('timelineControls');
      const controls = [...root.querySelectorAll(':scope > button')].map(el => {
        const r = bounds(el), hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
        return { ...r, hit: el.contains(hit) };
      });
      return { tool: bounds(root), search: bounds(document.querySelector('.map-command-toolbar')), controls };
    });
    expect(layout.tool.left).toBeGreaterThanOrEqual(0); expect(layout.tool.right).toBeLessThanOrEqual(width);
    for (const control of layout.controls) {
      const minimum = width < 800 ? 40 : 36;
      expect(control.width).toBeGreaterThanOrEqual(minimum); expect(control.height).toBeGreaterThanOrEqual(minimum); expect(control.hit).toBe(true);
    }
    if (width < 900) expect(layout.search.bottom).toBeLessThanOrEqual(layout.tool.top - 8);
    else expect(layout.search.right).toBeLessThanOrEqual(layout.tool.left);
    if (width === 1024) {
      await page.locator('#objectSearchBtn').click();
      await expect(page.getByLabel('지도에서 찾기', { exact: true })).toBeVisible();
      await expect.poll(() => page.evaluate(() => {
        const tool = document.getElementById('timelineControls').getBoundingClientRect();
        const search = document.querySelector('.map-command-toolbar').getBoundingClientRect();
        return search.bottom <= tool.top - 8;
      })).toBe(true);
      await page.getByLabel('지도에서 찾기', { exact: true }).press('Escape');
    }
    await button.click();
    const popupBounds = await popup.boundingBox();
    expect(popupBounds.x).toBeGreaterThanOrEqual(0); expect(popupBounds.x + popupBounds.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`date-popover-${width}.png`) });
    const moveVisible = await page.locator('#timelineGoBtn').evaluate(el => {
      const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    });
    expect(moveVisible, `date popover action at ${width}px`).toBe(true);
    await year.fill('0'); await page.locator('#timelineGoBtn').click();
    await expect(page.locator('#timelineDateError')).toBeVisible(); await expect(button).toContainText(label);
    await year.press('Escape'); await expect(popup).toBeHidden(); await expect(button).toBeFocused();
    await button.click(); await year.fill('1900');
    const map = await page.locator('#map').boundingBox();
    await page.locator('#map').click({ position: { x: map.width / 2, y: map.height / 3 } });
    await expect(popup).toBeHidden(); await expect(button).toContainText(label);
  }
  expect(await page.evaluate(() => window.__PANDOLAB_VIEWER__.documentSnapshot())).toEqual(before);
  expect(errors).toEqual([]);
});
});
