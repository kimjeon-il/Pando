import {test,expect} from '@playwright/test';
import {createViewerProjectPackage} from '../../fixtures/viewer-project-package.mjs';

// Bounded browser regression for the common project runtime, not a GPU benchmark.
test('accepted default-world and GeoPackage share the same Viewer scene and recover on return',async({page})=>{
 test.setTimeout(240000);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const fixture=await createViewerProjectPackage('프로젝트 전환 회귀');
 await page.goto('/?debug=1&renderer=canvas');
 const ready=()=>expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:120000});
 await ready();
 const initial=await page.evaluate(()=>{
  const api=window.__PANDOLAB_VIEWER__;
  return {documentId:api.documentSnapshot().documentId,
   generation:api.rendererStats().projectGeneration,visible:api.visibleTerritorialCount(),
   month:api.documentState().timelineCursor};
 });
 expect(initial.visible).toBeGreaterThan(0);
 await page.locator('#objectSearchBtn').click();
 await page.getByLabel('지도에서 찾기',{exact:true}).fill('대한민국');
 await expect(page.locator('#objectSearchResults button').first()).toBeVisible();
 await page.locator('#projectFileInput').setInputFiles({
  name:'project-roundtrip.gpkg',mimeType:'application/geopackage+sqlite3',buffer:fixture.bytes,
 });
 await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot().documentId),
  {timeout:90000}).toBe(fixture.project.documentId);
 try { await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:12000}); }
 catch {
   const diagnostic=await page.evaluate(()=>{
     const api=window.__PANDOLAB_VIEWER__,r=api?.rendererStats?.()||{};
     const core=api?.documentState?.()||{};
     return {
       status:document.getElementById('viewerStatus')?.outerHTML,
       pageError:document.getElementById('actionStatus')?.textContent,
       documentId:api?.documentSnapshot?.().documentId,
       core:{epoch:core.epoch,timelineCursor:core.timelineCursor,storageBaselineId:core.storageBaselineId},
       renderer:r,
       diagnostics:api?.diagnostics?.()?.slice(-16),
     };
   });
   console.log('FILE_REPLACEMENT_STALL_DIAGNOSTIC '+JSON.stringify(diagnostic).slice(0,20000));
 }
 await ready();
 await expect.poll(()=>page.evaluate(()=>{
  const r=window.__PANDOLAB_VIEWER__.rendererStats();
  return r.mapReadiness.mapReady&&r.countriesPublishedGeneration===r.projectGeneration;
 }),{timeout:90000}).toBe(true);
 if(!(await page.getByLabel('지도에서 찾기',{exact:true}).isVisible()))
  await page.locator('#objectSearchBtn').click();
 await page.getByLabel('지도에서 찾기',{exact:true}).fill('프로젝트 전환 회귀');
 await expect(page.locator('#objectSearchResults button').filter({hasText:'프로젝트 전환 회귀'}).first()).toBeVisible();
 await page.locator('#timelineDateButton').click();
 await page.locator('#timelineViewUnit').selectOption('month');
 await page.locator('#timelineYearInput').fill('1914');
 await page.locator('#timelineMonthInput').selectOption('7');
 await page.locator('#timelineYearInput').press('Enter');
 await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentState().timelineCursor),
  {timeout:90000}).toBe('1914-07');
 await page.evaluate(()=>document.getElementById('builtinMapBtn').click());
 await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot().documentId),
  {timeout:120000}).not.toBe(fixture.project.documentId);
 await ready();
 await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.visibleTerritorialCount()),
  {timeout:90000}).toBeGreaterThan(0);
 const returned=await page.evaluate(()=>{
  const api=window.__PANDOLAB_VIEWER__,r=api.rendererStats();
  return {generation:r.projectGeneration,ready:r.mapReadiness.mapReady,
   countryGeneration:r.countriesPublishedGeneration,month:api.documentState().timelineCursor};
 });
 expect(returned.generation).toBeGreaterThan(initial.generation);
 expect(returned.ready).toBe(true);
 expect(returned.countryGeneration).toBe(returned.generation);
 expect(returned.month).toMatch(/^\d{4}-\d{2}$/);
 expect(errors).toEqual([]);
});
