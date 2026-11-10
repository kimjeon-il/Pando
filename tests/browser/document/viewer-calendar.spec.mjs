import { test as featureTest } from '@playwright/test';
import * as __suiteDependency0 from "@playwright/test";
import * as __suiteDependency1 from "../../fixtures/viewer-project-package.mjs";
import * as __suiteDependency2 from "../../../src/ui/timeline-controls.js";
import * as __suiteDependency3 from "../helpers/viewer-acceptance.mjs";
featureTest.use({launchOptions:{args:[
  '--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox',
]}});
  const {  test, expect  } = __suiteDependency0;
  const {  createViewerProjectPackage  } = __suiteDependency1;
  const {  shiftTimelineMonth, timelineMonthLabel  } = __suiteDependency2;
  const {  openReadyViewer, waitForCommittedMonth  } = __suiteDependency3;
// Keep renderer-specific fixtures and failure evidence scoped to each contract family.


test.describe("Automatic current month", () => {
test.use({viewport:{width:1440,height:900}});

test('the first builtin map follows the actual device month without a pinned year', async ({page}) => {
  await openReadyViewer(page,{url:'/?debug=1&demTerrain=raster'});
  const actual=await page.evaluate(() => {
    const now=new Date();
    const expected=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
    const api=window.__PANDOLAB_VIEWER__;
    return {expected,shown:api.builtinMonth().month,cursor:api.documentState().timelineCursor,
      automatic:api.builtinMonth().automatic};
  });
  expect(actual.automatic).toBe(true);
  expect(actual.shown).toBe(actual.expected);
  expect(actual.cursor).toBe(actual.expected);
});
test('builtin country loading follows calendar rollover, retains manual dates and never requests the retired project',async({page})=>{
 test.setTimeout(180000);
 const requests=[],errors=[];page.on('request',request=>requests.push(request.url()));page.on('pageerror',error=>errors.push(error.message));
 await page.clock.install({time:new Date(2026,9,31,23,59)});
 await openReadyViewer(page,{url:'/?debug=1&demTerrain=raster'});
 expect(await page.evaluate(()=>window.PANDOLAB_BUILD_META.projectCatalogs.territorial.catalog)).toContain('builtin-world/generated/v1/index.json');
 await expect(page.locator('#timelineDateButtonText')).toHaveText('2026년');
 const initialProject=await page.evaluate(()=>{
  const project=window.__PANDOLAB_VIEWER__.documentSnapshot();
  return {id:project.documentId,initialMonth:project.projectSetup.initialMonth,
   countries:project.territorialEntities.length,records:JSON.stringify(project.timelineRecords)};
 });
 expect(initialProject.countries).toBeGreaterThan(0);
 expect(requests.some(url=>/\/builtin-world\/generated\/v1\/countries\/.*\.json\.gz/.test(url))).toBe(true);
 expect(requests.some(url=>url.includes('/builtin-world/generated/v1/transport/'))).toBe(false);
 expect(requests.some(url=>url.includes('world-project.json.gz'))).toBe(false);
 await page.clock.setSystemTime(new Date(2026,10,1));await page.evaluate(()=>window.dispatchEvent(new window.Event('focus')));
 await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.builtinMonth().month),{timeout:45000}).toBe('2026-11');
 expect(await page.evaluate(()=>{
  const project=window.__PANDOLAB_VIEWER__.documentSnapshot();
  return {id:project.documentId,initialMonth:project.projectSetup.initialMonth,
   countries:project.territorialEntities.length,records:JSON.stringify(project.timelineRecords)};
 })).toEqual(initialProject,'calendar rollover must not replace the full-history project');
 await expect(page.locator('#timelineDateBasis')).toHaveText('현재 월 기준');
 await page.locator('#timelineDateButton').click();await page.locator('#timelineViewUnit').selectOption('month');await page.locator('#timelineYearInput').fill('1953');await page.locator('#timelineMonthInput').selectOption('6');await page.locator('#timelineGoBtn').click();
 await expect(page.locator('#timelineDateButtonText')).toHaveText('1953년 6월',{timeout:45000});
 const source=await page.evaluate(()=>{
  const row=window.__PANDOLAB_VIEWER__.resolvedWorld().byId.get('KOR');
  return row.identity.properties.metadata.historicalTimeline.geometryBindings
    .find(binding=>JSON.stringify(binding.geometryRef)===JSON.stringify(row.geometryRef))?.sourceVersionId;
 });
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
 await openReadyViewer(page,{url:'/?debug=1&demTerrain=raster'});
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
test.use({viewport:{width:1280,height:800}});

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
 await openReadyViewer(page,{timeout:100000});
 await waitForCommittedMonth(page,'2026-10');
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
test.use({ hasTouch: true, actionTimeout: 15000 });

test('floating date controls preserve navigation and document state across desktop and narrow mobile', async ({ page }, testInfo) => {
  test.setTimeout(180000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('pandolab-user-preferences', JSON.stringify({ version: 2, appearance: { statusBarVisible: false } })));
  await openReadyViewer(page);
  const fixture = await createViewerProjectPackage('날짜 도구 검증');
  await page.locator('#projectFileInput').setInputFiles({ name: 'date-controls.gpkg', mimeType: 'application/geopackage+sqlite3', buffer: fixture.bytes });
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEWER__.documentSnapshot().baseDataset)).toBe(fixture.project.baseDataset);
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#mapBottomStatus')).toHaveCount(0);
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

// Historical identity changes belong to the same dated-map feature suite.
test.describe('Historical country membership', () => {
  test.use({viewport:{width:1280,height:800}});
// The published historical world has one Serbia-Montenegro predecessor in
// 2005 and independent Serbia/Montenegro objects from 2006 onwards.
test('P4-4 actual country birth and extinction refresh map selection and open search',async({page})=>{
  test.setTimeout(170000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.clock.setFixedTime(new Date(2026,9,31,12));
  await page.goto('/?debug=1');
  const ready=page.locator('#viewerStatus');
  await expect(ready).toHaveAttribute('data-ready','true',{timeout:100000});
  async function go(year){
    await page.locator('#timelineDateButton').click();
    await page.locator('#timelineYearInput').fill(String(year));
    await page.locator('#timelineGoBtn').click();
    await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__?.builtinMonth().month),
      {timeout:85000}).toBe(year+'-12');
    await expect(ready).toHaveAttribute('data-ready','true',{timeout:20000});
  }
  const ids=()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.resolvedWorld().entities.filter(row=>row.objectRef.domain==='territorial').map(row=>row.id));
  await go(2005);
  expect(await ids()).toContain('state:yugoslavia');
  expect(await ids()).not.toContain('MNE');
  await page.locator('#objectSearchBtn').click();
  await page.locator('#objectSearchInput').fill('세르비아 몬테네그로');
  await expect(page.locator('#objectSearchResults [data-object-search-select][data-item-id="state:yugoslavia"]'))
    .toBeVisible({timeout:20000});
  await page.locator('#objectSearchResults [data-object-search-select][data-item-id="state:yugoslavia"]').click();
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__?.selectionSnapshot().items.map(item=>item.id)))
    .toContain('state:yugoslavia');

  await go(2006);
  const currentIds=await ids();
  expect(currentIds).not.toContain('state:yugoslavia');
  expect(currentIds).toContain('MNE');
  expect(currentIds).toContain('SRB');
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__?.selectionSnapshot().items.map(item=>item.id)))
    .not.toContain('state:yugoslavia');
  await page.locator('#objectSearchBtn').click();
  await expect(page.locator('#objectSearchResults [data-object-search-select][data-item-id="state:yugoslavia"]'))
    .toHaveCount(0,{timeout:20000});
  await page.locator('#objectSearchInput').fill('몬테네그로');
  const newRow=page.locator('#objectSearchResults [data-object-search-select][data-item-id="MNE"]');
  await expect(newRow).toBeVisible({timeout:20000});
  await newRow.click();
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__?.selectionSnapshot().items.map(item=>item.id)))
    .toContain('MNE');
  expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentState().timelineCursor)).toBe('2006-12');
  expect(errors).toEqual([]);
});
});
featureTest.describe("viewer-temporal-regressions", () => {
  const {  test, expect  } = __suiteDependency0;
  const {  createViewerProjectPackage  } = __suiteDependency1;
  const {  waitForCommittedMonth  } = __suiteDependency3;
// Keep renderer-specific fixtures and failure evidence scoped to each contract family.


test.describe("Canonical dated document/frame admission", () => {
// Worker-scoped launch settings belong at file scope. The Canvas cases still
// select the supported Canvas renderer explicitly through the page query.
test.use({actionTimeout:15000});

async function start(page,renderer){
  if(renderer==='canvas2d'){
    await page.addInitScript(()=>Object.defineProperty(window,'OffscreenCanvas',
      {configurable:true,value:undefined}));
  }
  await page.clock.setFixedTime(new Date(2026,9,24,12));
  await page.route('**/modules/viewer-composition.js*',async route=>{
    const source=await(await route.fetch()).text();
    const boot='  const disposables=[',debug='productMode,documentState:',reader='await owners.physicalResources.preparePhysicalContext(month,{isCurrent});';
    for(const anchor of [boot,debug,reader])expect(source.includes(anchor),`Missing observation boundary: ${anchor}`).toBe(true);
    await route.fulfill({contentType:'text/javascript',body:source
      .replace(boot,`  window.__temporalPackets=[];
  documentSession.commandOwner.subscribeTransitions((packet,operation)=>{
    if(['core.document-load','core.document-load-baseline','core.document-temporal-candidate-adopt','core.document-timeline-cursor'].includes(operation))
      window.__temporalPackets.push({operation,fullProject:Object.hasOwn(packet,'project'),
        geometryCount:packet.delta?.geometries?.length??null,month:packet.state?.timelineCursor});
  });
  const disposables=[`)
      .replace(debug,'cameraSnapshot:()=>structuredClone({projection:map.viewState.projection,view:map.viewState.view}),'+debug)
      .replace(reader,'if(window.__temporalRead)await window.__temporalRead(month);\n      '+reader)});
  });
  // This suite verifies document and frame admission. Full DEM streaming is
  // covered by the dedicated terrain scenarios.
  await page.goto('/?debug=1'+(renderer==='webgl'?'':'&renderer=canvas')
    +(renderer==='canvas-worker'?'&demTerrain=raster':''));
  await waitForCommittedMonth(page,'2026-10');
  if (renderer !== 'canvas-worker') await expect.poll(() => page.evaluate(() => {
    const state = window.__PANDOLAB_VIEWER__.rendererStats();
    return ['ready', 'limited'].includes(state.mapReadiness.status) && !state.canvasWorkerBusy;
  }), { timeout: 90000 }).toBe(true);
}
for(const renderer of ['webgl','canvas-worker','canvas2d'])for(const width of [1280,390])test.describe(`${renderer} ${width}px`,()=>{
  test.use({viewport:{width,height:844},hasTouch:width===390});
  test('dedicated temporal path presents dated frames without another whole-document load',async({page},testInfo)=>{
    test.setTimeout(210000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await start(page,renderer);
    const backend=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats().renderer);
    if(renderer==='webgl')expect(backend).toMatch(/^webgl[12]$/);
    else expect(backend,'Canvas Worker and Canvas2D must not silently substitute').toBe(renderer);
    const camera=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.cameraSnapshot());
    const identity=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot().documentId);
    const activate=async id=>{const control=page.locator('#'+id);if(width===390)await control.tap();else await control.click();};
    await activate('timelinePreviousYear');await waitForCommittedMonth(page,'2025-12');
    expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.cameraSnapshot())).toEqual(camera);
    await activate('timelineNextYear');await waitForCommittedMonth(page,'2026-10');
    const returned=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats());
    expect(returned.mapReadiness.mapReady).toBe(true);
    expect(returned.countriesPublishedGeneration).toBe(returned.projectGeneration);
    expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.cameraSnapshot())).toEqual(camera);
    await expect(page.locator('#viewer')).toHaveAttribute('data-initial-loading','false');
    // A newer Core cursor is not sufficient proof of a painted frame.
    await expect.poll(()=>page.evaluate(()=>{
      const stats=window.__PANDOLAB_VIEWER__.rendererStats();
      return !!(['ready','limited'].includes(stats.mapReadiness?.status)
        && !stats.projectRenderBlocked
        && stats.countriesPublishedGeneration===stats.projectGeneration
        && stats.canonicalMeshReady
        && stats.displayedGeometryRevision===stats.committedGeometryRevision
        && (stats.renderer!=='canvas-worker'||!stats.canvasWorkerBusy
          && stats.canvasDisplayedStyleRevision===stats.canvasStyleRevision));
    }),{timeout:45000,message:'Current dated frame must be presented by the selected renderer'}).toBe(true);
    const packets=await page.evaluate(()=>window.__temporalPackets);
    expect(packets.filter(row=>row.operation==='core.document-load-baseline')).toHaveLength(0);
    const adoptions=packets.filter(row=>row.operation==='core.document-temporal-candidate-adopt');
    expect(adoptions.filter(row=>row.fullProject)).toHaveLength(1);
    const transitions=packets.filter(row=>row.operation==='core.document-timeline-cursor');
    expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot().documentId)).toBe(identity);
    expect(transitions.map(row=>row.month)).toEqual(['2025-12','2026-10']);
    expect(transitions.every(row=>row.fullProject===false&&row.geometryCount===null)).toBe(true);
    expect(adoptions).toHaveLength(1,'date navigation must never admit another project');
    expect(errors).toEqual([]);
    await testInfo.attach('temporal-packets',{body:JSON.stringify({renderer,backend,width,packets,renderedVerified:true}),contentType:'application/json'});
  });
});

test('temporal failures and superseded source reads preserve the last displayed date',async({page})=>{
  test.setTimeout(150000);
  await start(page,'canvas-worker');
  const camera=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.cameraSnapshot());
  await page.evaluate(()=>{window.__temporalRead=async()=>{throw Error('temporal source unavailable');};});
  await page.locator('#timelinePreviousYear').click();
  await expect(page.locator('#timelineDateError')).toHaveText('temporal source unavailable');
  await waitForCommittedMonth(page,'2026-10');await page.keyboard.press('Escape');
  await page.evaluate(()=>{window.__temporalRead=month=>month==='2025-12'?new Promise(resolve=>{window.__releaseTemporal=resolve;}):Promise.resolve();});
  await page.locator('#timelinePreviousYear').click();
  await page.waitForFunction(()=>typeof window.__releaseTemporal==='function');
  try{await page.locator('#timelinePreviousYear').click();}
  finally{await page.evaluate(()=>window.__releaseTemporal());}
  await waitForCommittedMonth(page,'2024-12');
  expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.cameraSnapshot())).toEqual(camera);
  const transitions=await page.evaluate(()=>window.__temporalPackets.filter(row=>row.operation==='core.document-timeline-cursor'));
  expect(transitions.map(row=>row.month)).toEqual(['2024-12']);
});


test('Canvas user-file opening retains full document admission after a builtin delta transition',async({page})=>{
  test.setTimeout(150000);
  await start(page,'canvas-worker');
  await page.locator('#timelinePreviousYear').click();await waitForCommittedMonth(page,'2025-12');
  const previous=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot().documentId);
  const fixture=await createViewerProjectPackage('시점 전환 후 사용자 파일');
  await page.locator('#projectFileInput').setInputFiles({name:'temporal-user-file.gpkg',
    mimeType:'application/geopackage+sqlite3',buffer:fixture.bytes});
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot().baseDataset),
    {timeout:60000}).toBe(fixture.project.baseDataset);
  try {
    // Core admits the file before Canvas can paint its new generation. Require
    // the actual new-country bitmap, rather than the old 8s status-only gate.
    await expect.poll(()=>page.evaluate(()=>{
      const s=window.__PANDOLAB_VIEWER__.rendererStats();
      return s.countriesPublishedGeneration===s.projectGeneration&&s.mapReadiness.mapReady;
    }),{timeout:60000}).toBe(true);
    await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:15000});
  } catch(error) {
    const diagnostic=await page.evaluate(()=>{
      const api=window.__PANDOLAB_VIEWER__,s=api?.rendererStats?.()||{},m=window.__PANDOLAB_GPU_METRICS__||{};
      const keys=['renderer','mapReadiness','projectGeneration','countriesPublishedGeneration',
        'canonicalMeshReady','projectRenderBlocked','surfacePresentation','terrainReady','terrainFailed',
        'canvasWorkerBusy','canvasWorkerHasPendingFrame','canvasWorkerStaleFrameCount',
        'canvasStyleRevision','canvasDisplayedStyleRevision','canvasWorkerMessagesByType',
        'requestedRevision','displayedRevision','pendingCountryCount','committedGeometryRevision',
        'displayedGeometryRevision','firstBackgroundFrameMs','firstCountryPublishedMs',
        'gpuRecovery','mapHost'];
      return {status:document.querySelector('#viewerStatus')?.dataset.ready,
        map:Object.fromEntries(keys.map(key=>[key,s[key]??m[key]??null])),
        document:api?.documentState?.(),
        diagnostics:api?.diagnostics?.()?.slice(-10)};
    });
    console.error('CANVAS_DATE_GPKG_FRAME_DIAGNOSTIC '+JSON.stringify(diagnostic).slice(0,15000));
    throw error;
  }
  expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats().mapReadiness.mapReady)).toBe(true);
  const loaded=await page.evaluate(()=>({id:window.__PANDOLAB_VIEWER__.documentSnapshot().documentId,
    packet:window.__temporalPackets.at(-1)}));
  expect(loaded.id).not.toBe(previous);
  expect(loaded.packet.operation).toBe('core.document-load');
  expect(loaded.packet.fullProject).toBe(true);
});
});


test.describe("Unchanged resource reuse on date switch", () => {
test.use({viewport:{width:1280,height:800}});

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
  const expected={land:0,physical:0,updates:1};
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
    expect(counts,{message:'Cursor updates must not replace or reinitialize map resources'}).toEqual(expected);
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
});
});
featureTest.describe("temporal-map-presentation", () => {
  const { test,expect } = __suiteDependency0;
test.use({viewport:{width:960,height:640}});

for (const mode of ['webgl','canvas','canvas-worker']) test(`temporal map holds its last complete ${mode} frame until its successor is presented`,async({page})=>{
  test.setTimeout(180000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const consoleErrors=[];page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
  // Keep this measured transition on one source snapshot when another local
  // task refreshes the shared development server.
  await page.route('**/__frontend/reload.js',route=>route.fulfill({contentType:'text/javascript',body:''}));
  await page.addInitScript(mode=>{
    const getContext=window.HTMLCanvasElement.prototype.getContext;
    window.HTMLCanvasElement.prototype.getContext=function(type,...args){
      if(String(type).includes('webgl') && mode.startsWith('canvas'))return null;
      return getContext.call(this,type,...args);
    };
    if(mode==='canvas'){
      const WorkerClass=window.Worker;
      window.Worker=class extends WorkerClass{constructor(url,options){if(String(url).includes('canvas-render-worker'))throw new Error('Canvas2D test path');super(url,options);}};
    }
  },mode);
  await page.route('**/modules/gpu-map-renderer.js*',async route=>{
    const response=await route.fetch(),source=await response.text();
    const marker="const nextDependencies = { source: 'country-mesh',";
    expect(source).toContain(marker);
    const proofMarker='const temporalPending =';
    expect(source).toContain(proofMarker);
    const sourceMarker='async function prepareTemporalCountrySource(features) {';
    expect(source).toContain(sourceMarker);
    const instrumented=source.replace(proofMarker,`window.__physicalFrameProof=()=>({expected:getPhysicalContextState(),
      actual:(renderScene?.polygons||[]).filter(packet=>['physical-land','physical-water'].includes(packet.role)).map(packet=>({role:packet.role,revision:packet.geometryRevision})),
      matches:physicalSceneMatchesContext(renderScene,getPhysicalContextState()),at:performance.now()});\n`+proofMarker)
      .replace(sourceMarker,sourceMarker+`\nif(temporalPending()&&temporalPresentation.sourceAdmitted){
        const sourceTicket=temporalPresentation;
        if(window.__temporalFailureOnce){window.__temporalFailureOnce=false;throw new Error('controlled temporal preparation failure');}
        if(window.__temporalSourceGate){
          sourceTicket.testGatePromise ||= window.__temporalSourceGate();await sourceTicket.testGatePromise;
          if(sourceTicket!==temporalPresentation||!sourceTicket.isCurrent())return false;
        }
      }`);
    await route.fulfill({response,body:instrumented.replace(marker,`
      window.__temporalWaterPresented=()=>preparedBaseScene?.physicalWaterItems.length>0
        && preparedBaseScene.physicalWaterItems.every(({packet})=>polygonOverlayPass.hasPreparedResource(packet))
        && lastBaseSceneResult?.overlayRenderedKeys.includes('physical-water');
      if (window.__temporalGate) await window.__temporalGate();
    `+marker)});
  });
  await page.route('**/modules/render-scene.js*',async route=>{
    const response=await route.fetch(),source=await response.text(),marker='if (revision !== preparationRevision) return;';
    expect(source).toContain(marker);
    await route.fulfill({response,body:source.replace(marker,marker+`\n(window.__physicalBatches||=[]).push({at:performance.now(),keys:groups.map(value=>value.request.cacheKey),stats:result.stats});`)});
  });
  await page.route('**/modules/physical-resources.js*',async route=>{
    const response=await route.fetch(),source=await response.text(),start='async function preparePhysicalContext(month,{isCurrent=()=>true}={}) {',done='assertCurrent();return result;';
    expect(source).toContain(start);expect(source).toContain(done);
    await route.fulfill({response,body:source.replace(start,start+`\n(window.__physicalRequests||=[]).push({month,phase:'start',at:performance.now()});`).replace(done,`(window.__physicalRequests||=[]).push({month,phase:'ready',at:performance.now()});`+done)});
  });
  await page.route('**/modules/country-index.js*',async route=>{
    const response=await route.fetch(),source=await response.text();
    const marker='function scheduleCountryLabelAnchors(ids = null, delay = 30) {';
    expect(source).toContain(marker);
    await route.fulfill({response,body:source.replace(marker,marker+'\nwindow.__pendingCountryAnchors = () => pendingCountryLabelAnchors.size;')});
  });
  await page.route('**/modules/rendering-domain.js*',async route=>{
    const response=await route.fetch(),source=await response.text();
    const marker='const canPresentFrame =';
    expect(source).toContain(marker);
    await route.fulfill({response,body:source.replace(marker,
      "window.__temporalInvalidate = () => { invalidateLabels('country-label-anchor-ready'); invalidateSelection('selection-ready'); invalidateGpuInteraction('highlight-ready'); };\n"+marker)});
  });
  await page.goto('/?debug=1');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:90000});
  try {
    await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats().mapReadiness.status),{timeout:90000}).toMatch(/ready|limited/);
  } catch(error) {
    console.log('startup errors',errors,consoleErrors);
    console.log('initial readiness',await page.evaluate(()=>{const stats=window.__PANDOLAB_VIEWER__.rendererStats();
      return {readiness:stats.mapReadiness,terrainReady:stats.terrainReady,terrainFailed:stats.terrainFailed,renderer:stats.renderer};}));throw error;
  }
  await expect.poll(()=>page.evaluate(()=>window.__pendingCountryAnchors?.()),{timeout:45000}).toBe(0);
  const image=async()=>{
    // Read WebGL through the compositor without changing its context options.
    // Read Canvas directly: toggling visibility for a screenshot can
    // retain its earlier compositor image even after a new bitmap is accepted.
    const png=mode==='webgl'?await page.locator('.gpu-map-canvas').screenshot({style:
      'body * {visibility:hidden!important} .gpu-map-canvas {visibility:visible!important}'}):null;
    return page.evaluate(async encoded=>{
    const bitmap=encoded?await createImageBitmap(await (await fetch('data:image/png;base64,'+encoded)).blob()):document.querySelector('.gpu-map-canvas');
    const snapshot=document.createElement('canvas');snapshot.width=bitmap.width;snapshot.height=bitmap.height;
    const context=snapshot.getContext('2d');context.drawImage(bitmap,0,0);bitmap.close?.();
    const pixels=context.getImageData(0,0,snapshot.width,snapshot.height).data;
    let hash=2166136261;for(let i=0;i<pixels.length;i++)hash=Math.imul(hash^pixels[i],16777619);
    const previous=window.__temporalPixels;let different=0,maxDelta=0;
    if(previous&&previous.length===pixels.length)for(let i=0;i<pixels.length;i++){if(previous[i]!==pixels[i])different++;maxDelta=Math.max(maxDelta,Math.abs(previous[i]-pixels[i]));}
    if(!previous)window.__temporalPixels=pixels.slice();
    return {hash:hash>>>0,width:snapshot.width,height:snapshot.height,different,maxDelta};
    },png?.toString('base64'));
  };
  const date=await page.locator('#timelineDateButtonText').textContent();
  const labelPositions=()=>page.locator('#map .territorial-label-item, #map .user-label').evaluateAll(nodes=>
    nodes.map(node=>({text:node.textContent,transform:node.getAttribute('transform')})));
  // General readiness precedes asynchronous borders and selected historical
  // water. Compare retained frames only after those pixels have been submitted.
  const waitForCompleteScene=async()=>{
    if(mode!=='webgl')return;
    await expect.poll(()=>page.evaluate(()=>{
      const s=window.__PANDOLAB_VIEWER__.rendererStats();
      return window.__temporalWaterPresented() && s.countrySharedBoundaryReady
        && !s.countrySharedBoundaryReplacementPending && s.surfacePresentation.quality==='canonical'
        && s.sceneCache.valid && !s.sceneCache.dirty;
    }),{timeout:45000}).toBe(true);
  };
  await page.evaluate(()=>{window.__temporalHeld=[];window.__temporalGate=()=>new Promise((resolve,reject)=>window.__temporalHeld.push({resolve,reject}));});
  await page.locator('#timelineDateButton').click();
  await page.locator('#timelineViewUnit').selectOption('month');
  await page.locator('#timelineYearInput').fill('1922');
  await page.locator('#timelineMonthInput').selectOption('12');
  await waitForCompleteScene();
  const before=await image(),labels=await page.locator('#map').innerText(),positions=await labelPositions();
  expect(positions.length).toBeGreaterThan(0);
  await page.screenshot({path:test.info().outputPath(`before-${mode}.png`)});
  await page.locator('#timelineGoBtn').click();
  await expect.poll(()=>page.evaluate(()=>window.__temporalHeld.length)).toBe(1);
  await expect(page.locator('#viewerStatus')).toHaveText('다음 시점 준비 중…');
  await expect(page.locator('#viewerStatus')).toHaveClass('ui-visually-hidden');
  await page.evaluate(()=>window.__temporalInvalidate());
  const mapBox=await page.locator('#map').boundingBox();
  const camera=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats().screenScale);
  await page.mouse.move(mapBox.x+mapBox.width/2,mapBox.y+mapBox.height/2);
  await page.mouse.down();await page.mouse.move(mapBox.x+mapBox.width/2+100,mapBox.y+mapBox.height/2,{steps:5});await page.mouse.up();
  await page.mouse.wheel(0,-120);
  // The in-flight date must remain unchanged, but direct user camera input
  // is still authoritative. A blocked temporal response cannot freeze panning.
  const movedScale=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats().screenScale);
  expect(movedScale).not.toBe(camera);
  expect(await page.locator('#timelineDateButtonText').textContent()).toBe(date);
  const held=await image();console.log('temporal pixel comparison',JSON.stringify({before,held}));
  // Canvas alpha round-trips may differ by one byte at antialiased edges.
  // A partially replaced or cleared frame exceeds this bound immediately.
  if(mode==='webgl')expect(held.hash).toBe(before.hash);
  else expect(held.maxDelta).toBeLessThanOrEqual(1);
  expect(await page.locator('#map').innerText()).toBe(labels);
  expect(await labelPositions()).toEqual(positions);
  await page.evaluate(()=>{window.__temporalGate=null;window.__temporalHeld.shift().resolve();});
  try {
    await expect(page.locator('#timelineDateButtonText')).toHaveText('1922년 12월',{timeout:60000});
  } catch(error) {
    console.log('transition errors',errors,consoleErrors);
    console.log('transition readiness',await page.evaluate(()=>{const stats=window.__PANDOLAB_VIEWER__.rendererStats();return {readiness:stats.mapReadiness,generation:stats.projectGeneration,blocked:stats.projectRenderBlocked,terrain:stats.terrainReady,boundary:stats.countrySharedBoundaryReady,physical:window.__physicalFrameProof(),batches:window.__physicalBatches,requests:window.__physicalRequests,mesh:stats.lastMeshPreparation};}));
    throw error;
  }
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true');
  await expect(page.locator('#viewerStatus')).toHaveClass('ui-visually-hidden');
  const physical=await page.evaluate(()=>({frame:window.__physicalFrameProof(),batches:window.__physicalBatches,requests:window.__physicalRequests,
    mesh:window.__PANDOLAB_VIEWER__.rendererStats().lastMeshPreparation}));
  expect(physical.frame.matches).toBe(true);
  expect(physical.frame.expected.landRevision).toMatch(/^[a-f0-9]{64}$/);
  expect(physical.frame.actual.find(row=>row.role==='physical-land')?.revision).toBe(physical.frame.expected.landRevision);
  expect(physical.frame.actual.map(row=>row.role).sort()).toEqual(['physical-land','physical-water']);
  console.log('temporal physical preparation',mode,JSON.stringify({matches:physical.frame.matches,landRevision:physical.frame.expected.landRevision,
    roles:physical.frame.actual.map(row=>row.role),requests:physical.requests,
    batches:physical.batches.map(row=>({at:row.at,count:row.keys.length,physicalKeys:row.keys.filter(key=>key.startsWith('polygon:physical-')).map(key=>key.split('::')[0]),stats:row.stats})),mesh:physical.mesh}));
  expect((await image()).hash).not.toBe(before.hash);
  if(mode==='webgl'){
    await page.locator('#timelineDateButton').click();
    await page.mouse.move(20,20);
    await waitForCompleteScene();
    const committed=await image();
    // Unchanged effective geometry reuses its mesh and does not enter the
    // rebuild hook. Fail the always-required admitted-source preparation so
    // this still verifies rollback after Core cursor admission.
    await page.evaluate(()=>{window.__temporalFailureOnce=true;});
    await page.locator('#timelineNextMonth').click();
    await expect(page.locator('#timelineDateError')).toContainText('controlled temporal preparation failure',{timeout:45000});
    expect(await page.locator('#timelineDateButtonText').textContent()).toBe('1922년 12월');
    expect((await image()).hash).toBe(committed.hash);
    await page.locator('#timelineYearInput').fill('1922');
    await page.locator('#timelineMonthInput').selectOption('12');
    // Every date prepares its admitted source, including dates that reuse
    // unchanged geometry. Coalescing must not require a redundant mesh build.
    await page.evaluate(()=>{window.__temporalHeld=[];window.__temporalSourceGate=()=>new Promise(resolve=>window.__temporalHeld.push({resolve}));});
    await page.locator('#timelineNextMonth').click();
    await expect.poll(()=>page.evaluate(()=>window.__temporalHeld.length)).toBe(1);
    await page.locator('#timelineNextMonth').click();
    await page.evaluate(()=>window.__temporalHeld.shift().resolve());
    await expect.poll(()=>page.evaluate(()=>window.__temporalHeld.length),{timeout:45000}).toBe(1);
    expect(await page.locator('#timelineDateButtonText').textContent()).toBe('1922년 12월');
    expect((await image()).hash).toBe(committed.hash);
    await page.evaluate(()=>{window.__temporalSourceGate=null;window.__temporalHeld.shift().resolve();});
    await expect(page.locator('#timelineDateButtonText')).toHaveText('1923년 2월',{timeout:45000});
    expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.builtinMonth().month)).toBe('1923-02');
    await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true');
    await expect(page.locator('#viewerStatus')).toHaveClass('ui-visually-hidden');
    const preparation=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats());
    await page.locator('#timelineGoBtn').click();
    await expect(page.locator('#timelinePopover')).toBeHidden({timeout:45000});
    const reused=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats());
    expect(reused.countryMeshRebuildCount||0).toBe(preparation.countryMeshRebuildCount||0);
    expect(reused.committedGeometryRevision).toBe(preparation.committedGeometryRevision);
    expect(reused.meshVariantBytes.canonical).toBe(preparation.meshVariantBytes.canonical);
    expect(reused.polygonOverlay.uploadBytes).toBe(preparation.polygonOverlay.uploadBytes);
  }
  const beforeDrag=await image(),positionsBeforeDrag=await labelPositions();
  await page.mouse.move(mapBox.x+mapBox.width/2,mapBox.y+mapBox.height/2);
  await page.mouse.down();await page.mouse.move(mapBox.x+mapBox.width/2+100,mapBox.y+mapBox.height/2,{steps:5});await page.mouse.up();
  await expect.poll(labelPositions).not.toEqual(positionsBeforeDrag);
  await expect.poll(async()=> (await image()).hash,{timeout:mode==='canvas-worker'?60000:15000}).not.toBe(beforeDrag.hash);
  const committedFrames=await page.locator('#map [data-visual-frame-id]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-visual-frame-id')));
  expect(new Set(committedFrames).size).toBe(1);
  expect((await image()).hash).not.toBe(beforeDrag.hash);
  await page.screenshot({path:test.info().outputPath(`temporal-${mode}.png`)});
  expect(errors).toEqual([]);
});
});
featureTest.describe("resource-dependency-reuse", () => {
  const { test,expect } = __suiteDependency0;
const stats=page=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats());
async function month(page,value){
  const [year,month]=value.split('-');
  if (!await page.locator('#timelineViewUnit').isVisible()) await page.locator('#timelineDateButton').click();
  await page.locator('#timelineViewUnit').selectOption('month');
  await page.locator('#timelineYearInput').fill(year);
  await page.locator('#timelineMonthInput').selectOption(String(Number(month)));
  await page.locator('#timelineGoBtn').click();
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.builtinMonth().month),{timeout:60000}).toBe(value);
  await expect(page.locator('#timelineDateButton')).toHaveAttribute('aria-expanded', 'false', { timeout: 60000 });
  await expect.poll(async()=>{const s=await stats(page);return s.countriesPublishedGeneration===s.projectGeneration;}).toBe(true);
}

for(const renderer of ['webgl2','canvas'])test(`${renderer}: unchanged date queries retain prepared resources`,async({page},info)=>{
  test.setTimeout(120000);
  const errors=[],workers=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('worker',w=>workers.push(w.url()));
  page.on('request',r=>{if(r.url().includes('/assets/data/'))requests.push(r.url());});
  await page.addInitScript(()=>{
    window.__resourceLargeBufferUploads=0;
    for(const type of [window.WebGLRenderingContext,window.WebGL2RenderingContext]){
      if(!type)continue;
      const original=type.prototype.bufferData;
      type.prototype.bufferData=function(target,data,...args){
        if((typeof data==='number'?data:data?.byteLength)>=256*1024)window.__resourceLargeBufferUploads++;
        return original.call(this,target,data,...args);
      };
    }
  });
  await page.goto(`/?debug=1&renderer=${renderer}`,{waitUntil:'domcontentloaded'});
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:60000});
  await page.evaluate(()=>{const h=window.__PANDOLAB_MAP_HOST__;h.setViewState({projection:'globe',view:{...h.getViewState(),globeRotation:[-24.6,-38.5,0],globeZoom:5}});h.requestRepaint('dependency-regression');});
  await expect.poll(async()=>(await stats(page)).hydroPacksLoaded,{timeout:30000}).toBeGreaterThan(0);
  const currentMonth = await page.evaluate(() => window.__PANDOLAB_VIEWER__.documentState().timelineCursor);
  const [year, monthNumber] = currentMonth.split('-').map(Number);
  const previousMonth = `${monthNumber === 1 ? year - 1 : year}-${String(monthNumber === 1 ? 12 : monthNumber - 1).padStart(2, '0')}`;
  await month(page,previousMonth);
  await expect.poll(async()=>(await stats(page)).countrySharedBoundaryReady,{timeout:30000}).toBe(true);
  if(renderer==='webgl2'){
    await expect.poll(async()=>(await stats(page)).terrainTilesLoading).toBe(0);
    await expect.poll(async()=>(await stats(page)).terrainPendingDecodedBytes).toBe(0);
    await expect.poll(async()=>(await stats(page)).hydroPendingUploadCount).toBe(0);
  }
  const before=await stats(page),requestCount=requests.length,workerCount=workers.length;
  const uploads=await page.evaluate(()=>window.__resourceLargeBufferUploads);
  await month(page,currentMonth);
  await month(page,previousMonth);
  const after=await stats(page);
  expect(after.renderer).toBe(renderer==='canvas'?'canvas-worker':renderer);
  expect(after.countryMeshRebuildCount).toBe(before.countryMeshRebuildCount);
  expect(after.countryBoundaryPrepareCount).toBe(before.countryBoundaryPrepareCount);
  expect(after.hydroUploadBytes).toBe(before.hydroUploadBytes);
  expect(after.hydroPacksLoaded).toBe(before.hydroPacksLoaded);
  expect(after.terrainUploadCount).toBe(before.terrainUploadCount);
  expect(workers.slice(workerCount)).toEqual([]);
  expect(requests.slice(requestCount)).toEqual([]);
  expect(await page.evaluate(()=>window.__resourceLargeBufferUploads)).toBe(uploads);
  if(renderer==='webgl2'){
    await page.evaluate(()=>{window.__resourceContext=document.querySelector('#viewerCanvas').getContext('webgl2').getExtension('WEBGL_lose_context');window.__resourceContext.loseContext();});
    await expect.poll(async()=>(await stats(page)).webglContextLost).toBe(true);
    await page.evaluate(()=>window.__resourceContext.restoreContext());
    await expect.poll(async()=>(await stats(page)).webglContextLost,{timeout:30000}).toBe(false);
    await expect.poll(async()=>{const s=await stats(page);return s.countriesPublishedGeneration===s.projectGeneration;},{timeout:30000}).toBe(true);
    await expect.poll(async()=>(await stats(page)).terrainTilesLoading).toBe(0);
    await expect.poll(async()=>(await stats(page)).terrainPendingDecodedBytes).toBe(0);
    await expect.poll(async()=>(await stats(page)).hydroPendingUploadCount).toBe(0);
    const restoredUploads=await page.evaluate(()=>window.__resourceLargeBufferUploads);
    expect(restoredUploads).toBeGreaterThan(uploads);
    await month(page,currentMonth);
    expect(await page.evaluate(()=>window.__resourceLargeBufferUploads)).toBe(restoredUploads);
  }
  expect(errors).toEqual([]);
  await page.screenshot({path:info.outputPath('date-reuse.png')});
  console.log(JSON.stringify({renderer,before:{mesh:before.countryMeshRebuildCount,boundary:before.countryBoundaryPrepareCount,hydro:before.hydroUploadBytes,terrain:before.terrainUploadCount},after:{mesh:after.countryMeshRebuildCount,boundary:after.countryBoundaryPrepareCount,hydro:after.hydroUploadBytes,terrain:after.terrainUploadCount},additionalRequests:requests.length-requestCount,additionalWorkers:workers.length-workerCount}));
});


// Failures print the accepted C++ document and renderer state. Do not replace
// real readiness, date, GPU or terrain assertions with this diagnostic.
test.afterEach(async({page},info)=>{
  if(info.status===info.expectedStatus)return;
  const state=await page.evaluate(()=>{
    const api=window.__PANDOLAB_VIEWER__,stats=api?.rendererStats?.()||{};
    const fields=['renderer','mapReadiness','projectGeneration','countriesPublishedGeneration',
      'canonicalMeshReady','projectRenderBlocked','surfacePresentation','terrainReady',
      'terrainTargetLevel','terrainRenderedLevel','terrainTargetTilesLoaded','terrainTargetTileCount',
      'terrainTilesLoading','terrainPendingDecodedBytes','screenScale','hydroPendingUploadCount',
      'webglContextLost','temporalPresentationPending','requestedRevision','displayedRevision',
      'firstBackgroundFrameMs','firstCountryPublishedMs','lastMeshPreparation'];
    return {documentState:api?.documentState?.()||null,
      builtinMonth:api?.builtinMonth?.()||null,
      map:Object.fromEntries(fields.map(k=>[k,stats[k]??null])),
      diagnostics:api?.diagnostics?.().slice(-12)||[],
      status:document.getElementById('viewerStatus')?.dataset.ready};
  }).catch(error=>({unavailable:String(error)}));
  console.error('P7_FAILED_MAP_STATE '+JSON.stringify({test:info.title,state}).slice(0,14000));
});
});
