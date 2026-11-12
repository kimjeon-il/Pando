import { test as featureTest } from '@playwright/test';
import * as __suiteDependency0 from "@playwright/test";
import * as __suiteDependency1 from "../../fixtures/viewer-project-package.mjs";
import * as __suiteDependency2 from "../../../src/document/initial-document.js";
import * as __suiteDependency3 from "../../../src/document/distribution-model.js";
import * as __suiteDependency4 from "../helpers/viewing-display.mjs";
import * as __suiteDependency5 from "../helpers/viewing-display.mjs";
import * as __suiteDependency6 from "@playwright/test";
import * as __suiteDependency7 from "../../fixtures/viewer-project-package.mjs";

// Preserved Viewer feature contract: viewer-project-open.spec.mjs
featureTest.describe("viewer-project-open", () => {
  const {  test, expect  } = __suiteDependency0;
  const {  createViewerProjectPackage  } = __suiteDependency1;
  const {  createInitialDocument  } = __suiteDependency2;
  const {  createDistributionLayer, createDistributionEntry  } = __suiteDependency3;
  const {  openViewingDisplay, closeViewingDisplay  } = __suiteDependency4;
let first;
let latest;
test.beforeAll(async () => {
  first = await createViewerProjectPackage('파일 지도 A');
  latest = await createViewerProjectPackage('마지막 파일 지도');
});

test('viewer menus follow project replacement while builtin sources stay available', async ({ page }, info) => {
  test.setTimeout(150000);
  page.setDefaultTimeout(15000);
  const empty = createInitialDocument({ appVersion: '0.36.0' });
  const layer = createDistributionLayer({ id: crypto.randomUUID(), name: '값 0 분포' });
  const entry = createDistributionEntry({ id: crypto.randomUUID(), layerId: layer.id, mode: 'geometry', value: 0,
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } });
  const packages = [
    await createViewerProjectPackage('빈 분포', { ...empty, distributionLayers: [layer] }),
    await createViewerProjectPackage('분포 자료', { ...empty, distributionLayers: [layer], distributionEntries: [entry] }),
  ];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?debug=1&renderer=canvas');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready', 'true', { timeout: 120000 });
  for (const [index, fixture] of [packages[0], packages[1], packages[0]].entries()) {
    await page.locator('#projectFileInput').setInputFiles({ name: 'menu.gpkg', mimeType: 'application/geopackage+sqlite3', buffer: fixture.bytes });
    await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEWER__.documentSnapshot().documentId)).toBe(fixture.project.documentId);
    await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready', 'true');
    const before = await page.evaluate(() => window.__PANDOLAB_VIEWER__.documentSnapshot());
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await openViewingDisplay(page);
      await expect(page.locator('#preferencesGenericSlot')).toBeHidden();
      for (const id of ['preferencesRiversInput','preferencesLakesInput','preferencesGraticuleInput'])
        await expect(page.locator('#'+id)).toBeVisible();
      await expect(page.locator('input[name="preferencesMapStyle"]')).toHaveCount(3);
      if (index === 1) await expect(page.locator('#preferencesDistributionSlot')).toBeVisible();
      else await expect(page.locator('#preferencesDistributionSlot')).toBeHidden();
      if (index === 1 && viewport.width === 1440 || index === 2 && viewport.width === 390)
        await page.screenshot({ path: info.outputPath(`viewer-menu-${index}-${viewport.width}.png`) });
      await closeViewingDisplay(page);
    }
    expect(await page.evaluate(() => window.__PANDOLAB_VIEWER__.documentSnapshot())).toEqual(before);
    expect(await page.evaluate(() => window.__PANDOLAB_VIEWER__.documentState().canUndo)).toBe(false);
  }
  expect(errors).toEqual([]);
});

test('viewer opens the real editor GeoPackage and keeps it through invalid files, picker cancellation and a stale read', async ({ page }) => {
  test.setTimeout(240000);
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?debug=1&renderer=canvas');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready', 'true', { timeout: 120000 });
  const initialGeneration=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats().projectGeneration);
  await page.locator('#projectFileInput').setInputFiles({ name: 'editor-export.gpkg', mimeType: 'application/geopackage+sqlite3', buffer: first.bytes });
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEWER__.documentSnapshot().territorialEntities[0].properties.name),{timeout:45000}).toBe('파일 지도 A');
  // A previous generation may still own the status element for one paint.
  // Require the new project's accepted physical frame, not a stale DOM flag.
  await expect.poll(()=>page.evaluate(initialGeneration=>{
    const state=window.__PANDOLAB_VIEWER__.rendererStats();
    return state.projectGeneration>initialGeneration
      && state.mapReadiness.mapReady
      && state.countriesPublishedGeneration===state.projectGeneration;
  },initialGeneration),{timeout:120000}).toBe(true);
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true');
  const firstMap=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats());
  expect(firstMap.mapReadiness.mapReady).toBe(true);
  expect(firstMap.countriesPublishedGeneration).toBe(firstMap.projectGeneration);
  expect(firstMap.projectGeneration).toBeGreaterThan(initialGeneration);
  const loaded = await page.evaluate(() => window.__PANDOLAB_VIEWER__.documentSnapshot());
  expect(loaded.territorialEntities).toEqual(first.project.territorialEntities);
  expect(loaded.geometries).toEqual(first.project.geometries);
  expect(loaded.timelineRecords).toEqual(first.project.timelineRecords);
  expect(loaded.projectSetup).toEqual(first.project.projectSetup);
  await expect(page.locator('#timelineDateButton')).toHaveAttribute('aria-label', '1914년, 6월말 기준, 시점 직접 입력');
  await page.locator('#objectSearchBtn').click();
  await page.getByLabel('지도에서 찾기', { exact:true }).fill('파일 지도 A');
  await page.locator('#objectSearchResults button').filter({ hasText: '파일 지도 A' }).first().click();
  expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot().territorialEntities[0].properties.notes)).toBe('원본 메타데이터 보존');
  await page.locator('#timelineDateButton').click();await page.locator('#timelineViewUnit').selectOption('month');
  await page.locator('#timelineYearInput').fill('1914');
  await page.locator('#timelineMonthInput').selectOption('7');
  await page.locator('#timelineYearInput').press('Enter');
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEWER__.documentState().timelineCursor)).toBe('1914-07');

  const before = await page.evaluate(() => ({ state: window.__PANDOLAB_VIEWER__.documentState(), project: window.__PANDOLAB_VIEWER__.documentSnapshot() }));
  await page.locator('#projectFileInput').setInputFiles({ name: 'broken.gpkg', mimeType: 'application/octet-stream', buffer: Buffer.from('not a sqlite database') });
  await expect(page.locator('#actionStatus')).toHaveClass(/error/,{timeout:45000});
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true');
  expect(await page.evaluate(() => ({ state: window.__PANDOLAB_VIEWER__.documentState(), project: window.__PANDOLAB_VIEWER__.documentSnapshot() }))).toEqual(before);
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#mobileFileBtn').click();
  await page.locator('#openProjectBtn').click();
  await (await chooser).setFiles([]);
  expect(await page.evaluate(() => ({ state: window.__PANDOLAB_VIEWER__.documentState(), project: window.__PANDOLAB_VIEWER__.documentSnapshot() }))).toEqual(before);

  await page.evaluate(async ({ earlier, newer }) => {
    const api = window.__PANDOLAB_VIEWER__;
    const old = new File([new Uint8Array(earlier)], 'earlier.gpkg');
    const originalRead = old.arrayBuffer.bind(old);
    let release;
    old.arrayBuffer = () => new Promise(resolve => { release = () => originalRead().then(resolve); });
    const pending = api.openFile(old);
    await api.openFile(new File([new Uint8Array(newer)], 'latest.gpkg'));
    await release();
    await pending;
  }, { earlier: [...first.bytes], newer: [...latest.bytes] });
  const final = await page.evaluate(() => ({ state: window.__PANDOLAB_VIEWER__.documentState(), project: window.__PANDOLAB_VIEWER__.documentSnapshot() }));
  expect(final.project.territorialEntities[0].properties.name).toBe('마지막 파일 지도');
  expect(final.project.geometries).toEqual(latest.project.geometries);
  expect(final.state.canUndo).toBe(false);
  await expect.poll(()=>page.evaluate(()=>{
    const state=window.__PANDOLAB_VIEWER__.rendererStats();
    return state.mapReadiness.mapReady
      && state.countriesPublishedGeneration===state.projectGeneration;
  }),{timeout:120000}).toBe(true);
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true');
  const lastMap=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats());
  expect(lastMap.mapReadiness.mapReady).toBe(true);
  expect(lastMap.countriesPublishedGeneration).toBe(lastMap.projectGeneration);
  expect(errors).toEqual([]);
});
});
// Preserved Viewer feature contract: viewer-canvas.spec.mjs
featureTest.describe("viewer-canvas", () => {
  const {  openViewingDisplay, setViewingLayer, closeViewingDisplay  } = __suiteDependency5;
  const {  test, expect  } = __suiteDependency6;
  const {  createViewerProjectPackage  } = __suiteDependency7;
test('Canvas viewer selects a saved country polygon body without changing project data', async ({ page }) => {
  const fixture = await createViewerProjectPackage('Canvas 본문 선택');
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(() => {
    const getContext = window.HTMLCanvasElement.prototype.getContext;
    window.HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return String(type).includes('webgl') ? null : getContext.call(this, type, ...args);
    };
  });
  await page.goto('/?debug=1');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready', 'true', { timeout: 120000 });
  await page.locator('#projectFileInput').setInputFiles({
    name: 'canvas-country.gpkg', mimeType: 'application/geopackage+sqlite3', buffer: fixture.bytes,
  });
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEWER__.documentSnapshot()
    .territorialEntities[0].properties.name)).toBe('Canvas 본문 선택');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready', 'true');
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEWER__.rendererStats().renderer)).toBe('canvas-worker');
  const before = await page.evaluate(() => ({
    project: window.__PANDOLAB_VIEWER__.documentSnapshot(), state: window.__PANDOLAB_VIEWER__.documentState(),
  }));

  await openViewingDisplay(page);
  // The fixture contains overlapping polygons; choose A explicitly from the real hit list.
  // Preserve the map theme's names and markers; toggle only independent hydro data.
  for (const group of ['rivers', 'lakes']) {
    await setViewingLayer(page,group,false);
  }
  await closeViewingDisplay(page);
  await page.locator('#resetViewBtn').click();
  await expect(page.locator('#preferencesModal')).toBeHidden();
  expect((await page.evaluate(() => window.__PANDOLAB_VIEWER__.selectionSnapshot())).items).toEqual([]);
  const priorDisplayedRevision = await page.evaluate(() => window.__PANDOLAB_VIEWER__.rendererStats().displayedRevision);
  await page.evaluate(()=>{const host=window.__PANDOLAB_MAP_HOST__;host.setViewState({projection:'globe',view:{...host.getViewState(),globeRotation:[-5,-5,0],globeZoom:4}});host.requestRepaint('canvas-body-selection');});
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_MAP_HOST__.getViewState().globeRotation)).toEqual([-5,-5,0]);
  // Wait for the asynchronous Canvas Worker to present the new camera before picking.
  await expect.poll(() => page.evaluate(previous => {
    const stats = window.__PANDOLAB_VIEWER__.rendererStats();
    return stats.renderer === 'canvas-worker' && !stats.canvasWorkerBusy
      && stats.displayedRevision > previous && stats.displayedRevision >= stats.requestedRevision;
  }, priorDisplayedRevision), { timeout: 45_000 }).toBe(true);
  // A displayed Canvas frame is not by itself an admitted country-picking surface.
  // The renderer writes countryVisualPhase from surfacePresentation.quality.
  await expect.poll(() => page.evaluate(() => {
    const stats = window.__PANDOLAB_VIEWER__.rendererStats();
    return stats.projectRenderBlocked ? 'blocked' : stats.surfacePresentation?.quality || 'unknown';
  }), { timeout: 45_000, message: 'Country surface must leave pending before Canvas picking' }).toMatch(/^(preview|canonical)$/);
  const bounds = await page.locator('#map').boundingBox();
  // Bring the known body coordinate into the viewport and use the real projection.
  const point=await page.evaluate(()=>window.__PANDOLAB_MAP_HOST__.project([8,8]));
  expect(point[0]).toBeGreaterThan(0);expect(point[0]).toBeLessThan(bounds.width);
  expect(point[1]).toBeGreaterThan(0);expect(point[1]).toBeLessThan(bounds.height);
  await page.mouse.click(bounds.x+point[0],bounds.y+point[1]);
  const chooser = page.locator('#objectChooser');
  // A sole hit selects immediately; overlapping hits open the chooser.
  await expect.poll(async () => {
    const selected = await page.evaluate(() => window.__PANDOLAB_VIEWER__.selectionSnapshot().items);
    return selected.some(item => item.domain === 'territorial' && item.id === 'A') || await chooser.isVisible();
  }, { timeout: 15_000 }).toBe(true);
  if (await chooser.isVisible()) {
    // B has the same text in its parent detail; match A's full accessible name.
    const target = page.locator('#objectChooserList').getByRole('option', {name:'Canvas 본문 선택 객체',exact:true});
    await expect(target).toHaveCount(1);
    await target.click();
  }
  await expect(page.locator('#viewerSelectionStatus')).toHaveText('Canvas 본문 선택');
  expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot().territorialEntities[0].properties.notes)).toBe('원본 메타데이터 보존');
  expect((await page.evaluate(() => window.__PANDOLAB_VIEWER__.selectionSnapshot())).items)
    .toEqual([{ domain: 'territorial', type: 'entity', id: 'A', key: 'territorial:entity:A' }]);
  const after = await page.evaluate(() => ({
    project: window.__PANDOLAB_VIEWER__.documentSnapshot(), state: window.__PANDOLAB_VIEWER__.documentState(),
  }));
  expect(after.project).toEqual(before.project);
  expect(after.state.checkpoint).toBe(before.state.checkpoint);
  expect(after.state.presentationCheckpoint).toBe(before.state.presentationCheckpoint);
  expect(after.state.canUndo).toBe(false);
  expect(errors).toEqual([]);
});

// Map display Worker startup is exercised alongside the active Canvas Viewer.
test('a map display request waits for Worker startup and preserves caller geometry',async({page})=>{
 await page.route('**/map-display-worker-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Map display Worker</title>'}));
 await page.goto('/map-display-worker-fixture');
 await page.addScriptTag({url:'/assets/js/build-meta.js'});
 const result=await page.evaluate(async()=>{
  const {createMapDisplayClient}=await import('/assets/js/modules/map-display-client.js');
  const {createTerritorialFeature}=await import('/assets/js/modules/territorial-units.js');
  const feature=(id,x)=>createTerritorialFeature({id,entityKind:id==='CHILD'?'regional':'general',parentId:'',geometry:{type:'Polygon',coordinates:[[[0,0],[0,10],[x,10],[x,0],[0,0]]]}});
  const entities=[feature('ROOT',10),feature('CHILD',5)],before=JSON.stringify(entities);
  const client=createMapDisplayClient({getEntities:()=>entities,getRevision:()=>1});
  try{const response=await client.prepare({kind:'boundaries'});
   return {count:response.result.segments.length,same:before===JSON.stringify(entities)};
  }finally{client.dispose();}
 });
 expect(result.count).toBeGreaterThan(0);expect(result.same).toBe(true);
});
});
