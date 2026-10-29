import {test,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {gotoEditor} from './helpers/editor-entry.mjs';

test.use({viewport:{width:1365,height:900},trace:'off'});
async function observePhysicalContext(page){
 await page.route('**/modules/gpu-map-renderer.js*',async route=>{
  const response=await route.fetch(),source=await response.text(),anchor='const temporalPending =';
  expect(source).toContain(anchor);
  await route.fulfill({response,body:source.replace(anchor,`window.__gisPhysicalFrameProof=()=>({drawn:!!preparedBaseScene?.physicalLandItems.length&&preparedBaseScene.physicalLandItems.every(({packet})=>polygonOverlayPass.hasPreparedResource(packet))&&!!lastBaseSceneResult?.overlayRenderedKeys.includes('physical-water'),readiness:mapReadiness(),matches:physicalSceneMatchesContext(renderScene,getPhysicalContextState()),expected:getPhysicalContextState(),roles:(renderScene?.polygons||[]).filter(packet=>['physical-land','physical-water'].includes(packet.role)).map(packet=>packet.role)});\n`+anchor)});
 });
 await page.route('**/assets/js/modules/physical-resources.js*',async route=>{
  const response=await route.fetch(),source=await response.text(),anchor='  function currentPhysicalContext() {';
  expect(source).toContain(anchor);
  await route.fulfill({response,body:source.replace(anchor,`  globalThis.__gisPhysicalProof=()=>{const value=currentPhysicalContext();return {month:dependencies.projectState.state.timelineCursor,landRevision:value?.revision,waterRevision:value?.waterRevision,holes:waterContexts.get(selectedPhysicalWater().key)?.value?.waters.find(row=>row.row.objectRef.id==='waterbody:caspian')?.water.coordinates.length-1};};\n`+anchor)});
 });
}

test('App physical background publishes both selected 1922 masks with matching prepared revisions',async({page})=>{
 test.setTimeout(120000);const errors=[];page.on('pageerror',error=>errors.push(error.message));await observePhysicalContext(page);
 await gotoEditor(page,'/?debug=1');await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:90000});
 await page.getByRole('button',{name:'파일 메뉴 열기',exact:true}).click();await page.locator('#newProjectBtn').click();
 await page.locator('#projectSetupMonth').fill('1922-12');await page.locator('#projectSetupSource').selectOption('empty');await page.locator('#projectSetupSubmit').click();
 await expect.poll(async()=>{if(await page.locator('#confirmModalOkBtn').isVisible())await page.locator('#confirmModalOkBtn').click();return await page.evaluate(()=>window.__gisPhysicalFrameProof?.());},{timeout:45000}).toMatchObject({matches:true,expected:{ready:true,landRevision:'a627e16fa56d7e9ad5ff65103bd7dfc66a6ba6edf2f22eabf4300e3b7939de4f'}});
 await expect.poll(()=>page.evaluate(()=>window.__gisPhysicalFrameProof().drawn)).toBe(true);
 expect(await page.evaluate(()=>window.__gisPhysicalFrameProof().roles.sort())).toEqual(['physical-land','physical-water']);
 await expect.poll(()=>page.evaluate(()=>window.__gisPhysicalFrameProof().readiness.status),{timeout:30000}).toMatch(/ready|limited/);
 expect(errors).toEqual([]);
});
async function evidence(page,testInfo,name,details){
 const file=process.env.PANDOLAB_GIS_EVIDENCE_DIR?join(process.env.PANDOLAB_GIS_EVIDENCE_DIR,name):testInfo.outputPath(name);
 await mkdir(dirname(file),{recursive:true});await page.screenshot({path:file+'.png'});await writeFile(file+'.json',JSON.stringify(details,null,2));
}
test('Web December1922 displays the reviewed USSR founders and historical Caspian',async({page},testInfo)=>{
 test.setTimeout(150000);const errors=[];page.on('pageerror',error=>errors.push(error.message));await observePhysicalContext(page);
 await page.goto('/?debug=1&demTerrain=raster');await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:90000});
 await page.locator('#timelineDateButton').click();await page.locator('#timelineViewUnit').selectOption('month');await page.locator('#timelineYearInput').fill('1922');await page.locator('#timelineMonthInput').selectOption('12');await page.locator('#timelineGoBtn').click();
 await expect(page.locator('#timelineDateButtonText')).toHaveText('1922년 12월',{timeout:45000});
 await expect.poll(()=>page.evaluate(()=>globalThis.__gisPhysicalProof?.().holes),{timeout:30000}).toBe(68);
 const versions=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot().territorialEntities.filter(e=>e.id.startsWith('state:soviet-union')).map(e=>({id:e.id,version:e.properties.sourceGeometryVersion})));
 expect(versions).toHaveLength(5);expect(versions.every(row=>row.version===row.id+':1922-12-30-reviewed-v2')).toBe(true);
 const physical=await page.evaluate(()=>globalThis.__gisPhysicalProof());expect(physical.month).toBe('1922-12');expect(errors).toEqual([]);
 await evidence(page,testInfo,'web1922',{versions,physical,errors});
});
test('empty App web shell imports the reviewed USSR and four founders using the real library workflow',async({page},testInfo)=>{
 test.setTimeout(180000);const errors=[];page.on('pageerror',error=>errors.push(error.message));await observePhysicalContext(page);
 await page.addInitScript(()=>{globalThis.__gisImportErrors=[];});
 await page.route('**/assets/js/modules/territorial-library-controller.js*',async route=>{
  const response=await route.fetch(),source=await response.text();expect(source).toContain('  reportError,');expect(source).toContain('  let selectedId =');
  await route.fulfill({response,body:source.replace('  reportError,','  reportError: originalReportError,').replace('  let selectedId =',`  const reportError=(error,...args)=>{globalThis.__gisImportErrors.push({message:error.message,stack:error.stack});return originalReportError(error,...args);};\n  let selectedId =`)});
 });
 await gotoEditor(page,'/?debug=1&demTerrain=raster');await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:90000});
 await page.getByRole('button',{name:'파일 메뉴 열기',exact:true}).click();await page.locator('#newProjectBtn').click();
 await page.locator('#projectSetupMonth').fill('1922-12');await page.locator('#projectSetupSource').selectOption('empty');await page.locator('#projectSetupSubmit').click();
 await expect.poll(async()=>{if(await page.locator('#confirmModalOkBtn').isVisible())await page.locator('#confirmModalOkBtn').click();return await page.evaluate(()=>window.PANDOLAB_TERRITORIAL.list().length);},{timeout:30000}).toBe(0);
 await page.locator('#createMenuBtn').click();await page.locator('#addFromLibraryBtn').click();await expect(page.locator('#territorialLibraryModal')).toBeVisible();
 await page.locator('#territorialLibraryReferenceDateInput').fill('1922-12-30');await page.locator('#territorialLibrarySearchInput').fill('소련');
 await page.locator('[data-library-entity-id="state:soviet-union"]').click();await page.locator('#territorialLibraryChildDepthInput').selectOption('level1');
 await page.locator('#territorialLibraryAddBtn').click();
 await expect.poll(async()=>{const failures=await page.evaluate(()=>globalThis.__gisImportErrors);if(failures.length)throw Error(JSON.stringify(failures));return await page.locator('[data-library-impact]').count()||await page.locator('#territorialLibraryModal.hidden').count();},{timeout:60000}).toBeGreaterThan(0);
 if(await page.locator('[data-library-impact]').count())await page.locator('#territorialLibraryAddBtn').click();
 await expect.poll(async()=>{const failures=await page.evaluate(()=>globalThis.__gisImportErrors);if(failures.length)throw Error(JSON.stringify(failures));return await page.locator('#territorialLibraryModal').isVisible();},{timeout:60000}).toBe(false);
 const imported=await page.evaluate(()=>window.PANDOLAB_TERRITORIAL.list().filter(e=>e.properties.sourceEntityId?.startsWith('state:soviet-union')).map(e=>({id:e.id,source:e.properties.sourceEntityId,version:e.properties.sourceGeometryVersion,parentId:e.properties.parentId})));
 expect(imported).toHaveLength(5);expect(imported.every(row=>row.version===row.source+':1922-12-30-reviewed-v2')).toBe(true);
 const parent=imported.find(row=>row.source==='state:soviet-union');for(const child of imported.filter(row=>row!==parent))expect(child.parentId).toBe(parent.id);
 await expect.poll(()=>page.evaluate(()=>globalThis.__gisPhysicalProof?.().holes),{timeout:30000}).toBe(68);expect(errors).toEqual([]);
 await page.evaluate(()=>{const h=window.__PANDOLAB_MAP_HOST__;h.setViewState({projection:'flat',view:{...h.getViewState(),flatCenter:[51,42],flatZoom:7}});h.requestRepaint('caspian-evidence');});
 await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_GPU_METRICS__?.pendingCountryCount),{timeout:60000}).toBe(0);
 await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_GPU_METRICS__?.sceneCache?.state),{timeout:30000}).toBe('valid');
 await evidence(page,testInfo,'app1922',{imported,physical:await page.evaluate(()=>globalThis.__gisPhysicalProof()),errors});
});
