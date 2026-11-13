import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { waitForCommittedMonth } from '../helpers/viewer-acceptance.mjs';
import { test as featureTest } from '@playwright/test';
import * as __suiteDependency0 from "../helpers/viewing-display.mjs";
import * as __suiteDependency1 from "@playwright/test";
import * as __suiteDependency4 from "../../fixtures/viewer-project-package.mjs";
import * as __suiteDependency6 from "node:url";
import * as __suiteDependency7 from "node:fs";
import * as __suiteDependency8 from "../../../scripts/build-ui-bundle.mjs";
import * as __suiteDependency9 from "../../../scripts/lib/frontend-layout.mjs";
// Restore the original feature boundary; merged descriptions must be balanced.
featureTest.describe("web-viewer", () => {
  const {  openViewingDisplay, setViewingLayer, closeViewingDisplay  } = __suiteDependency0;
  const {  test, expect  } = __suiteDependency1;
for (const viewport of [{ width: 1280, height: 800 }, { width: 640, height: 360 }]) {
test(`existing UI loads, searches and navigates without document writes at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
  page.setDefaultTimeout(15000);
  await page.setViewportSize(viewport);
  const errors=[]; page.on('pageerror', error=>errors.push(error.message));
  await page.goto('/?debug=1');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:120000});
  await expect(page.locator('#viewerStatus')).toHaveClass('ui-visually-hidden');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('role','status');
  await expect(page.locator('#viewerStatus')).toHaveCSS('clip-path','inset(50%)');
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEWER__.visibleTerritorialCount())).toBeGreaterThan(0);
  await expect(page).toHaveTitle('판도연구소');
  await expect(page.locator('#map')).toBeVisible();
  await expect(page.locator('#projectFileInput')).toHaveCount(1);
  const before=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentState());
  await page.locator('#objectSearchBtn').click();
  await page.getByLabel('지도에서 찾기', { exact: true }).fill('대한민국');
  await expect(page.locator('#objectSearchResults button').first()).toBeVisible();
  await page.locator('#objectSearchResults button').first().click();
  await expect(page.locator('#viewerSelectionStatus')).toContainText('대한민국');
  await openViewingDisplay(page);
  await setViewingLayer(page,'rivers',false);
  await setViewingLayer(page,'rivers',true);
  await expect(page.locator('#preferencesModal')).toContainText('지도 테마');
  await expect(page.locator('#mapDisplaySurface,#mapDisplayBtn,#countriesVisible,#subunitsVisible,#regionsVisible')).toHaveCount(0);
  const bounds=await page.locator('.preferences-card').boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x+bounds.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds.y+bounds.height).toBeLessThanOrEqual(viewport.height);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath(`existing-ui-${viewport.width}x${viewport.height}.png`)});
  await closeViewingDisplay(page);
  await page.locator('#timelineDateButton').click();
  await page.locator('#timelineViewUnit').selectOption('month');
  await page.locator('#timelineYearInput').fill('2025');
  await page.locator('#timelineMonthInput').selectOption('12');
  await page.locator('#timelineYearInput').press('Enter');
  await expect(page.locator('#timelineDateButtonText')).toHaveText('2025년 12월',{timeout:90_000});
  await page.locator('#timelineDateButton').click();
  await page.locator('#timelineNextMonth').click();
  await expect(page.locator('#timelineDateButtonText')).toHaveText('2026년 1월',{timeout:90_000});
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Delete');
  const after=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentState());
  expect(after.checkpoint).toBe(before.checkpoint);
  expect(after.presentationCheckpoint).toBe(before.presentationCheckpoint);
  expect(errors).toEqual([]);
});
}
});
featureTest.describe("viewer-layout", () => {
  const {  openViewingDisplay, closeViewingDisplay  } = __suiteDependency0;
  const {  test, expect  } = __suiteDependency1;
  const {  createViewerProjectPackage  } = __suiteDependency4;
test('existing surfaces preserve project and selection across portrait, tablet and landscape sizes', async ({ page }, testInfo) => {
  page.setDefaultTimeout(15000);
  const fixture=await createViewerProjectPackage('화면 검증 지도');
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    const getContext=window.HTMLCanvasElement.prototype.getContext;
    window.HTMLCanvasElement.prototype.getContext=function(type,...args){return String(type).includes('webgl')?null:getContext.call(this,type,...args);};
  });
  await page.goto('/?debug=1');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:120000});
  await page.locator('#timelinePreviousYear').hover();
  await expect(page.locator('#uiTooltip')).toBeVisible();
  await page.locator('#projectFileInput').setInputFiles({name:'layout.gpkg',mimeType:'application/geopackage+sqlite3',buffer:fixture.bytes});
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot().baseDataset)).toBe(fixture.project.baseDataset);
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true');
  const before=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot());
  for(const viewport of [{width:390,height:844},{width:768,height:1024},{width:1024,height:768},{width:844,height:390}]){
    await page.setViewportSize(viewport);
    // Exercise the shipped controls, not frozen HTML button IDs or CSS pixels.
    const visibleButtons=await page.locator('button.ui-button').evaluateAll(nodes=>nodes.filter(node=>{
      // The selector's visibility snapshot and a later layout read must be
      // atomic across a responsive resize, especially for the mobile toolbar.
      const style=getComputedStyle(node),rect=node.getBoundingClientRect();
      return style.display!=='none'&&style.visibility!=='hidden'&&rect.width>0&&rect.height>0;
    }).map(node=>{
      const bounds=node.getBoundingClientRect();return {id:node.id,classes:node.className,width:bounds.width,height:bounds.height};
    }));
    expect(visibleButtons.length).toBeGreaterThan(0);
    for(const bounds of visibleButtons){expect(bounds.width,JSON.stringify(bounds)).toBeGreaterThan(0);expect(bounds.height,JSON.stringify(bounds)).toBeGreaterThan(0);}
    await page.locator('#objectSearchBtn').click();
    await page.locator('#objectSearchInput').fill('화면 검증 지도');
    await page.locator('#objectSearchResults button').filter({hasText:'화면 검증 지도'}).first().click();
    expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot().territorialEntities[0].properties.notes)).toBe('원본 메타데이터 보존');
    await expect(page.locator('#viewerInfoPanel')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await openViewingDisplay(page);
    await page.locator('.preferences-card').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
    const panel=await page.locator('.preferences-card').boundingBox();
    expect(panel.x).toBeGreaterThanOrEqual(0);expect(panel.y).toBeGreaterThanOrEqual(0);
    expect(panel.x+panel.width).toBeLessThanOrEqual(viewport.width);
    expect(panel.y+panel.height).toBeLessThanOrEqual(viewport.height);
    await page.screenshot({path:testInfo.outputPath(`current-${viewport.width}x${viewport.height}.png`)});
    await closeViewingDisplay(page);
    expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot())).toEqual(before);
    expect((await page.evaluate(()=>window.__PANDOLAB_VIEWER__.selectionSnapshot())).items).toEqual([{domain:'territorial',type:'entity',id:'A',key:'territorial:entity:A'}]);
  }
  expect(errors).toEqual([]);
});
});
featureTest.describe("phone-landscape-surface-contract", () => {
  const {  expect, test  } = __suiteDependency1;
  const { fileURLToPath } = __suiteDependency6;
  const { readFileSync } = __suiteDependency7;
  const { buildUiBundles } = __suiteDependency8;
  const { buildFrontendIndex,frontendAsset } = __suiteDependency9;
const root=fileURLToPath(new URL("../../../",import.meta.url)),index=buildFrontendIndex(root);
const styles=buildUiBundles(root,{readSource:path=>frontendAsset(root,path,{index}).bytes.toString('utf8')}).viewer;

test.use({ hasTouch: true });

for (const viewport of [{width: 640, height: 360}, {width: 844, height: 390}]) {
  test('phone-landscape sheet at ' + viewport.width + ' keeps its common side-dock skin', async ({ page }) => {
    await page.setViewportSize(viewport);
    const safeTop = viewport.width === 640 ? 24 : 0;
    const css=styles.replaceAll('env(safe-area-inset-top)',safeTop+'px').replaceAll('env(safe-area-inset-right)',safeTop?'12px':'0px');
    await page.setContent([
      '<style>'+readFileSync(new URL("../../../src/ui/css/app.css",import.meta.url),'utf8')+'</style>',
      '<style>'+css+'</style>',
      '<div class="app-root" data-layout="phone-landscape">',
      ' <div class="workspace search-drawer-open">',
      '   <main class="map-wrap"></main>',
      '   <aside id="fixtureSheet" class="workspace-surface ui-sheet surface-search surface-open">',
      '     <header class="surface-header">',
      '       <button class="sheet-drag-handle" type="button">높이</button>',
      '       <div class="surface-header-title"><strong>검색</strong></div>',
      '     </header>',
      '     <div class="surface-body"><input aria-label="검색어"></div>',
      '   </aside>',
      '   <div class="mobile-workspace-controls">',
      '     <div class="mobile-menu-toolbar"><button class="ui-button ui-nav-item mobile-menu-trigger"><span><svg class="ui-icon" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg></span><strong>메뉴</strong></button></div>',
      '     <nav class="mobile-bottom-bar"><button class="ui-button ui-nav-item" aria-expanded="true"><span>검색</span><strong>검색</strong></button></nav>',
      '   </div>',
      '   <div class="mobile-global-menu"><button class="ui-button ui-menu-item">파일</button></div>',
      '   <div class="top-actions mobile-open"><button class="ui-button ui-menu-item">뒤로</button></div>',
      ' </div></div>',
    ].join(''));
    const actual = await page.locator('#fixtureSheet').evaluate(element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const header = element.querySelector('.surface-header');
      return {
        position: style.position,
        borderTop: style.borderTopWidth,
        borderLeft: style.borderLeftWidth,
        radius: style.borderTopLeftRadius,
        background: style.backgroundColor,
        shadow: style.boxShadow,
        right: rect.right,
        width: rect.width,
        headerDisplay: getComputedStyle(header).display,
        handleDisplay: getComputedStyle(header.querySelector('.sheet-drag-handle')).display,
        titleDisplay: getComputedStyle(header.querySelector('.surface-header-title')).display,
      };
    });
    expect(actual.position).toBe('fixed');
    expect(actual.borderTop).toBe('0px');
    expect(actual.borderLeft).toBe('1px');
    expect(actual.radius).toBe('0px');
    expect(actual.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(actual.shadow).not.toBe('none');
    expect(actual.width).toBeLessThanOrEqual(Math.min(320, viewport.width * 0.45) + 1);
    const dock = await page.locator('.mobile-workspace-controls').boundingBox();
    expect(dock.x + dock.width).toBeCloseTo(viewport.width, 0);
    expect(actual.right).toBeCloseTo(dock.x, 0);
    const panel = await page.locator('#fixtureSheet').boundingBox();
    expect(panel.y).toBe(safeTop);
    expect(panel.y + panel.height).toBe(viewport.height);
    const menu = await page.locator('.mobile-menu-toolbar').boundingBox();
    const nav = await page.locator('.mobile-bottom-bar').boundingBox();
    expect(menu.x).toBeCloseTo(dock.x, 0);
    expect(menu.y).toBe(safeTop);
    for (const selector of ['.mobile-global-menu','.top-actions']) {
      const bounds = await page.locator(selector).boundingBox();
      expect(bounds.y).toBe(safeTop);
      expect(bounds.x + bounds.width).toBeCloseTo(dock.x, 0);
    }
    expect(nav.x).toBeCloseTo(dock.x, 0);
    expect(nav.y).toBeCloseTo(menu.y + menu.height, 0);
    expect(nav.y + nav.height).toBeLessThanOrEqual(viewport.height);
    const insets = await page.locator('.workspace').evaluate(node => {
      const style = getComputedStyle(node);
      return {left:style.getPropertyValue('--map-safe-left').trim(),right:style.getPropertyValue('--map-safe-right').trim()};
    });
    expect(insets.left).toBe('0px');
    expect(Number.parseFloat(insets.right)).toBeCloseTo(dock.width + actual.width, 0);
    const chrome = await page.locator('.mobile-menu-toolbar').evaluate(node => {
      const style = getComputedStyle(node);
      return {border:style.borderTopWidth,radius:style.borderRadius,shadow:style.boxShadow};
    });
    expect(chrome).toEqual({border:'0px',radius:'0px',shadow:'none'});
    for (const selected of [true,false]) {
      await page.locator('.mobile-workspace-controls button').evaluateAll((buttons, value) => buttons.forEach(button => button.setAttribute('aria-expanded', String(value))), selected);
      await expect.poll(async () => {
        const states = await page.locator('.mobile-workspace-controls button').evaluateAll(buttons => buttons.map(button => {
          const style = getComputedStyle(button);
          return [style.color,style.backgroundColor,style.borderColor,style.boxShadow];
        }));
        return JSON.stringify(states[0]) === JSON.stringify(states[1]);
      }).toBe(true);
    }
    expect(actual.headerDisplay).toBe('flex');
    expect(actual.handleDisplay).toBe('none');
    expect(actual.titleDisplay).toBe('flex');
    await expect(page.locator('.mobile-bottom-bar')).toBeVisible();
    const navStyle = await page.locator('.mobile-workspace-controls').evaluate(node => getComputedStyle(node).backgroundColor);
    expect(navStyle).not.toBe('rgba(0, 0, 0, 0)');
  });
}
});
featureTest.describe("viewer-search-responsive", () => {
  const {  test, expect  } = __suiteDependency1;
  const {  createViewerProjectPackage  } = __suiteDependency4;
const cases = [
  { viewport: { width: 640, height: 360 }, hasTouch: true },
  { viewport: { width: 844, height: 390 }, hasTouch: true },
  { viewport: { width: 1280, height: 800 }, hasTouch: false },
];

for (const { viewport, hasTouch } of cases) {
  test.describe(`viewer search at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, hasTouch });

    test('opens search and selects a project object across the supported orientation', async ({ page }, testInfo) => {
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => {
        localStorage.setItem('pandolab-editor-project', 'preserve-editor-autosave');
        // Match the existing viewer layout test's Canvas rendering path.
        const getContext = window.HTMLCanvasElement.prototype.getContext;
        window.HTMLCanvasElement.prototype.getContext = function(type, ...args) {
          return String(type).includes('webgl') ? null : getContext.call(this, type, ...args);
        };
      });
      await page.goto('/?debug=1');

      const root = page.locator('.viewer-root');
      const searchButton = page.locator('#objectSearchBtn');
      if (hasTouch) {
        await expect(root).toHaveAttribute('data-layout', 'phone-landscape');
        expect(await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches)).toBe(true);
        expect(await page.evaluate(() => navigator.maxTouchPoints)).toBeGreaterThan(0);
      }
      await expect(searchButton).toBeVisible();
      await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready', 'true', { timeout: 120000 });

      const fixture = await createViewerProjectPackage('회전 검색 검증 지도');
      await page.locator('#projectFileInput').setInputFiles({
        name: 'responsive-search.gpkg',
        mimeType: 'application/geopackage+sqlite3',
        buffer: fixture.bytes,
      });
      await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEWER__.documentSnapshot().baseDataset))
        .toBe(fixture.project.baseDataset);
      await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready', 'true');
      const before = await page.evaluate(() => ({
        project: window.__PANDOLAB_VIEWER__.documentSnapshot(),
        state: window.__PANDOLAB_VIEWER__.documentState(),
      }));
      const targetId = fixture.project.territorialEntities[0].id;
      const expectedSelection = [{
        domain: 'territorial', type: 'entity', id: targetId, key: `territorial:entity:${targetId}`,
      }];
      const orientations = hasTouch
        ? [viewport, { width: viewport.height, height: viewport.width }, viewport]
        : [viewport];

      for (const [index, size] of orientations.entries()) {
        await page.setViewportSize(size);
        if (hasTouch) {
          await expect(root).toHaveAttribute('data-layout', size.width > size.height ? 'phone-landscape' : 'mobile');
        }
        await expect(searchButton).toBeVisible();
        await expect(searchButton).toBeInViewport();
        if (hasTouch) await searchButton.tap();
        else await searchButton.click();
        const input = page.getByLabel('지도에서 찾기', { exact: true });
        await expect(input).toBeVisible();
        await input.fill('회전 검색 검증 지도');
        const result = page.locator('#objectSearchResults button').filter({ hasText: '회전 검색 검증 지도' }).first();
        await expect(result).toBeVisible();
        if (hasTouch) await result.tap();
        else await result.click();
        await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEWER__.selectionSnapshot().items))
          .toEqual(expectedSelection);
        await expect(page.locator('#objectSearchSurface')).toBeHidden();

        expect(await page.evaluate(() => window.__PANDOLAB_VIEWER__.documentSnapshot())).toEqual(before.project);
        const after = await page.evaluate(() => window.__PANDOLAB_VIEWER__.documentState());
        expect(after.checkpoint).toBe(before.state.checkpoint);
        expect(after.presentationCheckpoint).toBe(before.state.presentationCheckpoint);
        expect(await page.evaluate(() => localStorage.getItem('pandolab-editor-project'))).toBe('preserve-editor-autosave');
        if (index === 0) await page.screenshot({ path: testInfo.outputPath('search-result-selected.png') });
      }
      expect(errors).toEqual([]);
    });
  });
}
});
featureTest.describe("viewer-globe-only", () => {
  const {  expect, test  } = __suiteDependency1;
test('web keeps its globe through bounded file open, search, reset and mobile navigation',async({page})=>{
  const {createViewerProjectPackage}=await import(process.env.PANDOLAB_TEST_VIEWER_FIXTURE || '../../fixtures/viewer-project-package.mjs');
  const fixture=await createViewerProjectPackage('지구본 범위 검사');
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/modules/viewer-map.js*',async route=>{
    const source=await(await route.fetch()).text(),anchor='const state=projectSession.state,mapWorkScheduler=projectSession.mapWorkScheduler;';
    expect(source).toContain(anchor);
    await route.fulfill({contentType:'text/javascript',body:source.replace(anchor,anchor+`
      window.__restoreGlobeCamera=()=>{const camera=projectSession.atomicMapStateController;
        camera.commit(camera.begin(),{projection:'flat',view:{...state.view,flatCenter:[175,25],flatZoom:3}});
        return {projection:state.projection,rotation:state.view.globeRotation};};`)});
  });
  await page.goto('/?debug=1&demTerrain=raster');
  await expect.poll(()=>page.evaluate(()=>typeof window.__restoreGlobeCamera)).toBe('function');
  expect(await page.evaluate(()=>window.__restoreGlobeCamera())).toEqual({projection:'globe',rotation:[-175,-25,0]});
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:60000});
  const projection=()=>page.evaluate(()=>window.__PANDOLAB_MAP_HOST__.getViewState().projection);
  expect(await projection()).toBe('globe');
  await expect(page.locator('#globeBtn,#flatBtn,#mapProjectionMenuTrigger,.projection-control')).toHaveCount(0);
  expect(await page.evaluate(()=>{try{window.__PANDOLAB_MAP_HOST__.setProjectionKind('flat');return null;}catch(error){return error.code;}})).toBe('PL-PRODUCT-PROJECTION');
  await page.locator('#projectFileInput').setInputFiles({name:'globe-bounds.gpkg',mimeType:'application/geopackage+sqlite3',buffer:fixture.bytes});
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot().baseDataset)).toBe(fixture.project.baseDataset);
  await expect.poll(()=>page.evaluate(()=>{
    const state=window.__PANDOLAB_VIEWER__.rendererStats();
    return state.mapReadiness.mapReady && state.countriesPublishedGeneration===state.projectGeneration;
  }),{timeout:120000}).toBe(true);
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:120000});
  expect(await projection()).toBe('globe');
  const initial=await page.evaluate(()=>window.__PANDOLAB_MAP_HOST__.getViewState());
  expect(initial.globeRotation.slice(0,2)).toEqual([-7.5,-7.5]);expect(initial.globeZoom).toBe(1); // The project bounds already calibrate globeBaseScale.
  const before=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentState());
  await page.locator('#objectSearchBtn').click();await page.locator('#objectSearchInput').fill('지구본 범위 검사');
  await page.locator('#objectSearchResults button').filter({hasText:'지구본 범위 검사'}).first().click();
  expect(await projection()).toBe('globe');
  await page.locator('#resetViewBtn').click();
  expect(await page.evaluate(()=>window.__PANDOLAB_MAP_HOST__.getViewState().globeZoom)).toBe(1);
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('#viewer')).toHaveAttribute('data-layout','mobile');
  const box=await page.locator('#map').boundingBox(),rotation=await page.evaluate(()=>window.__PANDOLAB_MAP_HOST__.getViewState().globeRotation);
  await page.mouse.move(box.x+box.width*.7,box.y+box.height*.35);await page.mouse.down();
  await page.mouse.move(box.x+box.width*.3,box.y+box.height*.4,{steps:5});await page.mouse.up();
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_MAP_HOST__.getViewState().globeRotation)).not.toEqual(rotation);
  const cdp=await page.context().newCDPSession(page),x=box.x+box.width/2,y=box.y+box.height*.4;
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
  const zoom=await page.evaluate(()=>window.__PANDOLAB_MAP_HOST__.getViewState().globeZoom);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x-25,y,id:1},{x:x+25,y,id:2}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-50,y,id:1},{x:x+50,y,id:2}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_MAP_HOST__.getViewState().globeZoom)).toBeGreaterThan(zoom);
  await cdp.detach();
  expect(await projection()).toBe('globe');
  expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentState())).toEqual(before);
  expect(errors).toEqual([]);
});
});

test.describe('desktop acceptance',()=>{

const fixedTime = '2026-10-31T00:00:00+09:00';
const cleanHistory = {
  dirty: false, documentDirty: false, presentationDirty: false,
  canUndo: false, canRedo: false,
};

test.use({
  viewport: { width: 1280, height: 800 },
  locale: 'ko-KR', timezoneId: 'Asia/Seoul', colorScheme: 'light',
});

test('startup, camera, year navigation, direct input and themes', async ({ page, browser }, info) => {
  test.setTimeout(180_000);
  await page.clock.setFixedTime(new Date(fixedTime));
  const errors = [], consoleErrors = [], observations = [], screenshots = [];
  let preservedCamera, failure = null, checksCompleted = false;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  const camera = () => page.evaluate(() => {
    const state = window.__PANDOLAB_MAP_HOST__.getViewState();
    return {
      projection: state.projection, globeRotation: state.globeRotation,
      globeZoom: state.globeZoom, flatCenter: state.flatCenter, flatZoom: state.flatZoom,
    };
  });
  const ready = (month, timeout = 45_000) => waitForCommittedMonth(page,month,{timeout});
  const observe = async (step, month, year, basis) => {
    await ready(month);
    await expect(page.locator('#timelineDateButtonText')).toHaveText(`${year}년`);
    await expect(page.locator('#timelineDateBasis')).toHaveText(basis);
    await expect(page.locator('#viewer')).toHaveAttribute('data-initial-loading', 'false');
    await expect(page.locator('#timelineDateError')).toHaveJSProperty('hidden', true);
    await expect(page.locator('#viewerCanvas')).toBeVisible();
    const state = await page.evaluate(() => {
      const viewer = window.__PANDOLAB_VIEWER__, documentState = viewer.documentState();
      const canvas = document.querySelector('#viewerCanvas');
      return {
        presented: viewer.initialMapPresented(), visible: viewer.visibleTerritorialCount(),
        history: Object.fromEntries(['dirty', 'documentDirty', 'presentationDirty', 'canUndo', 'canRedo']
          .map(key => [key, documentState[key]])),
        canvas: { width: canvas.width, height: canvas.height },
        theme: document.documentElement.dataset.theme,
        mapBackground: getComputedStyle(document.querySelector('#map')).backgroundColor,
      };
    });
    expect(state.presented).toBe(true);
    expect(state.visible).toBeGreaterThan(0);
    expect(state.canvas.width).toBeGreaterThan(0);
    expect(state.canvas.height).toBeGreaterThan(0);
    expect(state.history).toEqual(cleanHistory);
    const currentCamera = await camera();
    expect(currentCamera.projection).toBe('globe');
    if (preservedCamera) expect(currentCamera, `${step} preserves adjusted camera`).toEqual(preservedCamera);
    observations.push({ step, month, year, basis, ...state, camera: currentCamera });
  };
  const screenshot = async name => {
    const path = info.outputPath(name);
    await page.screenshot({ path, type: 'jpeg', quality: 70 });
    await info.attach(name, { path, contentType: 'image/jpeg' });
    screenshots.push(name);
  };

  try {
    await test.step('Initial desktop presentation', async () => {
      await page.goto('/?debug=1');
      await ready('2026-10', 75_000);
      await expect(page.locator('#viewer')).toHaveAttribute('data-layout', 'compact');
      await observe('initial', '2026-10', 2026, '현재 월 기준');
      await screenshot('initial.jpg');
    });

    await test.step('Real mouse pan and wheel zoom', async () => {
      const before = await camera(), map = page.locator('#map'), box = await map.boundingBox();
      expect(box).not.toBeNull();
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 100, y, { steps: 5 });
      await page.mouse.up();
      await expect.poll(async () => (await camera()).globeRotation).not.toEqual(before.globeRotation);
      await expect(map).not.toHaveClass(/dragging/);
      const panned = await camera();
      await page.mouse.move(x, y);
      await page.mouse.wheel(0, -200);
      await expect.poll(async () => (await camera()).globeZoom).toBeGreaterThan(panned.globeZoom);
      await expect(map).not.toHaveClass(/dragging/);
      preservedCamera = await camera();
      await observe('pan-and-zoom', '2026-10', 2026, '현재 월 기준');
    });

    await test.step('Previous year', async () => {
      await page.locator('#timelinePreviousYear').click();
      await observe('previous-year', '2025-12', 2025, '연말 기준');
    });
    await test.step('Next year returns to current month', async () => {
      await page.locator('#timelineNextYear').click();
      await observe('next-year', '2026-10', 2026, '현재 월 기준');
    });
    await test.step('Direct year input', async () => {
      await page.locator('#timelineDateButton').click();
      await expect(page.locator('#timelinePopover')).toBeVisible();
      await page.locator('#timelineViewUnit').selectOption('year');
      await page.locator('#timelineYearInput').fill('2024');
      await page.locator('#timelineGoBtn').click();
      await observe('direct-year', '2024-12', 2024, '연말 기준');
      await expect(page.locator('#timelinePopover')).toBeHidden();
    });

    for (const [theme, background] of [['dark', 'rgb(12, 17, 23)'], ['light', 'rgb(255, 255, 255)']]) {
      await test.step(`Apply ${theme} theme through preferences`, async () => {
        await page.locator('#preferencesBtn').click();
        await expect(page.locator('#preferencesModal')).toBeVisible();
        const swatch = page.locator(`#preferencesModal [data-preference-theme="${theme}"]`);
        await swatch.click();
        await expect(swatch).toHaveAttribute('aria-pressed', 'true');
        await page.locator('#preferencesCloseBtn').click();
        await expect(page.locator('#preferencesModal')).toBeHidden();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(page.locator('#map')).toHaveCSS('background-color', background);
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pandolab-user-preferences')).appearance.theme))
          .toBe(theme);
        await observe(`theme-${theme}`, '2024-12', 2024, '연말 기준');
        await screenshot(`${theme}.jpg`);
      });
    }
    expect(errors, 'No unhandled browser exceptions').toEqual([]);
    expect(consoleErrors, 'No browser console errors').toEqual([]);
    checksCompleted = true;
  } catch (error) {
    failure = String(error?.stack || error);
    throw error;
  } finally {
    const report = {
      scope: 'desktop', checksCompleted, revision: process.env.GITHUB_SHA || null,
      browser: browser.version(), node: process.version,
      environment: { viewport: { width: 1280, height: 800 }, locale: 'ko-KR', timezone: 'Asia/Seoul', fixedTime },
      observations, screenshots, errors, consoleErrors, failure,
      boundaries: [
        'One desktop Chromium session; no mobile, other browser or native desktop package coverage.',
        'No forced failure, historical timeout rerun, performance benchmark or reload persistence check.',
        'Screenshots require visual review; checksCompleted is confirmed by the final Playwright/CI outcome.',
      ],
    };
    const path = info.outputPath('desktop-functional.json');
    await writeFile(path, JSON.stringify(report, null, 2) + '\n');
    await info.attach('desktop-functional', { path, contentType: 'application/json' });
    console.log('VIEWER_DESKTOP_SUMMARY ' + JSON.stringify(report));
  }
});

});

test.describe('touch acceptance',()=>{

const fixedTime = '2026-10-31T00:00:00+09:00';
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
  locale: 'ko-KR', timezoneId: 'Asia/Seoul', colorScheme: 'light' });

test('narrow layout, touch camera, year input and mobile preferences', async ({ page, browser }, info) => {
  test.setTimeout(180_000);
  await page.clock.setFixedTime(new Date(fixedTime));
  const observations = [], layouts = [], screenshots = [], errors = [], consoleErrors = [];
  let preservedCamera, failure = null, checksCompleted = false;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  const camera = () => page.evaluate(() => {
    const state = window.__PANDOLAB_MAP_HOST__.getViewState();
    return { projection: state.projection, globeRotation: state.globeRotation,
      globeZoom: state.globeZoom, flatCenter: state.flatCenter, flatZoom: state.flatZoom };
  });
  const ready = (month, timeout = 45_000) => waitForCommittedMonth(page,month,{timeout});
  const observe = async (step, month, year, basis) => {
    await ready(month);
    await expect(page.locator('#viewer')).toHaveAttribute('data-layout', 'mobile');
    await expect(page.locator('#timelineDateButtonText')).toHaveText(`${year}년`);
    await expect(page.locator('#timelineDateBasis')).toHaveText(basis);
    await expect(page.locator('#viewer')).toHaveAttribute('data-initial-loading', 'false');
    await expect(page.locator('#timelineDateError')).toHaveJSProperty('hidden', true);
    await expect(page.locator('#viewerCanvas')).toBeVisible();
    const state = await page.evaluate(() => {
      const viewer = window.__PANDOLAB_VIEWER__, documentState = viewer.documentState();
      const canvas = document.querySelector('#viewerCanvas');
      return { presented: viewer.initialMapPresented(), visible: viewer.visibleTerritorialCount(),
        history: Object.fromEntries(['dirty', 'documentDirty', 'presentationDirty', 'canUndo', 'canRedo']
          .map(key => [key, documentState[key]])),
        canvas: { width: canvas.width, height: canvas.height },
        theme: document.documentElement.dataset.theme, pageScale: visualViewport.scale };
    });
    expect(state.presented).toBe(true); expect(state.visible).toBeGreaterThan(0);
    expect(state.canvas.width).toBeGreaterThan(0); expect(state.canvas.height).toBeGreaterThan(0);
    expect(state.history).toEqual({ dirty: false, documentDirty: false, presentationDirty: false,
      canUndo: false, canRedo: false });
    const currentCamera = await camera();
    expect(currentCamera.projection).toBe('globe');
    if (preservedCamera) expect(currentCamera, `${step} preserves touch-adjusted camera`).toEqual(preservedCamera);
    observations.push({ step, month, year, basis, ...state, camera: currentCamera });
  };
  const bounds = async (selector, { hit = false, contents = false, minimum = 0 } = {}) => {
    const state = await page.locator(selector).evaluate(element => {
      const r = element.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height,
        viewportWidth: innerWidth, viewportHeight: innerHeight,
        hit: element.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)),
        scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
    });
    expect(state.width).toBeGreaterThan(0); expect(state.height).toBeGreaterThan(0);
    expect(state.left, selector).toBeGreaterThanOrEqual(-1);
    expect(state.top, selector).toBeGreaterThanOrEqual(-1);
    expect(state.right, selector).toBeLessThanOrEqual(state.viewportWidth + 1);
    expect(state.bottom, selector).toBeLessThanOrEqual(state.viewportHeight + 1);
    if (hit) expect(state.hit, `${selector} receives a center tap`).toBe(true);
    if (contents) expect(state.scrollWidth, `${selector} horizontal contents`).toBeLessThanOrEqual(state.clientWidth + 1);
    if (minimum) { expect(state.width).toBeGreaterThanOrEqual(minimum); expect(state.height).toBeGreaterThanOrEqual(minimum); }
    layouts.push({ selector, ...state });
    return state;
  };
  const screenshot = async name => {
    const path = info.outputPath(name);
    await page.screenshot({ path, type: 'jpeg', quality: 75 });
    await info.attach(name, { path, contentType: 'image/jpeg' }); screenshots.push(name);
  };

  try {
    await test.step('Narrow first presentation and unobstructed controls', async () => {
      await page.goto('/?debug=1'); await ready('2026-10', 75_000);
      await observe('initial', '2026-10', 2026, '현재 월 기준');
      await bounds('html', { contents: true });
      await bounds('#map'); await bounds('.viewer-map-tools');
      await bounds('#mobileMenuBtn', { hit: true });
      const toolbar = await bounds('.map-command-toolbar'), timeline = await bounds('#timelineControls');
      expect(toolbar.bottom).toBeLessThanOrEqual(timeline.top - 8);
      const controls = page.locator('#timelineControls > button'); await expect(controls).toHaveCount(5);
      for (const id of await controls.evaluateAll(elements => elements.map(element => element.id))) {
        await bounds('#' + id, { hit: true, minimum: 40 });
      }
    });

    await test.step('One-finger pan and two-finger pinch', async () => {
      const before = await camera(), pageScale = await page.evaluate(() => visualViewport.scale);
      const box = await page.locator('#map').boundingBox(); expect(box).not.toBeNull();
      const x = Math.round(box.x + box.width * .5), y = Math.round(box.y + box.height * .4);
      const cdp = await page.context().newCDPSession(page);
      const touch = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
      try {
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
        await touch('touchStart', [{ x, y, id: 1 }]);
        for (const dx of [15, 30, 45, 60]) await touch('touchMove', [{ x: x + dx, y, id: 1 }]);
        await touch('touchEnd', []);
        await expect.poll(async () => (await camera()).globeRotation).not.toEqual(before.globeRotation);
        await expect(page.locator('#map')).not.toHaveClass(/dragging/);
        const panned = await camera();
        await touch('touchStart', [{ x: x - 24, y, id: 1 }, { x: x + 24, y, id: 2 }]);
        for (const half of [28, 32, 36]) await touch('touchMove', [{ x: x - half, y, id: 1 }, { x: x + half, y, id: 2 }]);
        await touch('touchEnd', []);
        await expect.poll(async () => (await camera()).globeZoom).toBeGreaterThan(panned.globeZoom);
        await expect(page.locator('#map')).not.toHaveClass(/dragging/);
        expect(await page.evaluate(() => visualViewport.scale), 'Pinch zooms the map, not the document').toBe(pageScale);
      } finally { await cdp.detach(); }
      preservedCamera = await camera();
      await observe('touch-pan-pinch', '2026-10', 2026, '현재 월 기준');
    });

    await test.step('Narrow year input and tap submission', async () => {
      await page.locator('#timelineDateButton').tap();
      await expect(page.locator('#timelinePopover')).toBeVisible();
      await expect(page.locator('#timelineViewUnit')).toHaveValue('year');
      await bounds('#timelinePopover', { contents: true });
      await bounds('#timelineYearInput', { hit: true }); await bounds('#timelineGoBtn', { hit: true });
      await page.locator('#timelineYearInput').fill('2024');
      await screenshot('year-input.jpg');
      await page.locator('#timelineGoBtn').tap();
      await observe('direct-year', '2024-12', 2024, '연말 기준');
      await expect(page.locator('#timelinePopover')).toBeHidden();
    });

    await test.step('Mobile menu and persisted theme', async () => {
      await page.locator('#mobileMenuBtn').tap();
      await expect(page.locator('#mobileGlobalMenu')).toBeVisible();
      await bounds('#mobileGlobalMenu', { contents: true }); await bounds('#mobilePreferencesBtn', { hit: true });
      await page.locator('#mobilePreferencesBtn').tap();
      await expect(page.locator('#mobileGlobalMenu')).toBeHidden();
      await expect(page.locator('#preferencesModal')).toBeVisible();
      await bounds('.preferences-card', { contents: true }); await bounds('.preferences-fields', { contents: true });
      const swatch = '#preferencesModal [data-preference-theme="dark"]';
      await bounds(swatch, { hit: true }); await bounds('#preferencesCloseBtn', { hit: true });
      await page.locator(swatch).tap();
      await expect(page.locator(swatch)).toHaveAttribute('aria-pressed', 'true');
      await screenshot('preferences.jpg');
      await page.locator('#preferencesCloseBtn').tap();
      await expect(page.locator('#preferencesModal')).toBeHidden();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await expect(page.locator('#map')).toHaveCSS('background-color', 'rgb(12, 17, 23)');
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pandolab-user-preferences')).appearance.theme)).toBe('dark');
      await observe('mobile-preferences', '2024-12', 2024, '연말 기준');
      await screenshot('narrow-dark.jpg');
    });
    expect(errors).toEqual([]); expect(consoleErrors).toEqual([]); checksCompleted = true;
  } catch (error) { failure = String(error?.stack || error); throw error; }
  finally {
    const report = { scope: 'touch', checksCompleted, revision: process.env.GITHUB_SHA || null,
      browser: browser.version(), node: process.version,
      environment: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
        locale: 'ko-KR', timezone: 'Asia/Seoul', fixedTime },
      observations, layouts, screenshots, errors, consoleErrors, failure,
      boundaries: ['Chromium touch emulation; not physical-device, Safari, WebView, software-keyboard or IME certification.',
        'No deferred timeout rerun, performance benchmark, or repeated desktop scenario.'] };
    const path = info.outputPath('touch-functional.json');
    await writeFile(path, JSON.stringify(report, null, 2) + '\n');
    await info.attach('touch-functional', { path, contentType: 'application/json' });
    console.log('VIEWER_TOUCH_SUMMARY ' + JSON.stringify(report));
  }
});

});
