import {gotoEditor,setEditorMonth} from './helpers/editor-entry.mjs';
import {shiftTimelineMonth} from "../../shared/frontend/js/modules/timeline-controls.js";
import {test,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {coreFileProjection,productionGeoPackage} from '../helpers/production-geopackage.mjs';
import {startupDocument} from '../helpers/core-startup.mjs';
import {createTerritorialFeature} from "../../shared/frontend/js/modules/territorial-units.js";

test('viewing policies share selection settings, passes, base scene, controls and geometry refresh',async({browser},testInfo)=>{
 test.setTimeout(360000);
 const requestedRenderer=process.env.PANDOLAB_POLICY_RENDERER||'';
 const square=(x0,y0,x1,y1)=>({type:'Polygon',coordinates:[[[x0,y0],[x0,y1],[x1,y1],[x1,y0],[x0,y0]]]});
 const seed=startupDocument([
  createTerritorialFeature({id:'A',name:'상위 객체',entityKind:'general',geometry:square(0,0,20,20)}),
  createTerritorialFeature({id:'B',name:'하위 객체',entityKind:'general',parentId:'A',geometry:square(0,0,10,20)}),
 ]);
 seed.editorState={lastViewedMonth:'2026-10'};
 const receipt=await coreFileProjection(seed),file=await productionGeoPackage('write',new ArrayBuffer(0),receipt.project,receipt.spatialState);
 const evidence={};
 for(const mode of ['viewer','editor']){
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[],consoleErrors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
  await page.addInitScript(()=>{window.__auditScenes={};window.__auditCalls=[];window.__auditStyleCalls=[];window.__auditMeshCalls=0;window.__auditMonthSettled=false;});
  await page.route('**/modules/render-quality.js*',async route=>{
   const response=await route.fetch(),source=await response.text(),marker="reason='canonical-mesh'}={}){";
   expect(source).toContain(marker);
   await route.fulfill({response,body:source.replace(marker,marker+'window.__auditMeshCalls++;')});
  });
  await page.route('**/modules/timeline-controls.js*',async route=>{
   const response=await route.fetch(),source=await response.text();
   await route.fulfill({response,body:source.replace('export function installTimelineControls(','function observedTimeline(')+`\nexport function installTimelineControls(options){return observedTimeline({...options,setMonth:async value=>{try{return await options.setMonth(value);}finally{window.__auditMonthSettled=true;}}});}`});
  });
  for(const [file,name,globalName] of [['preference-presentation.js','createPreferencePresentation','__auditPreferences'],['app-map-settings.js','createMapSettings','__auditSettings'],['map-owner-composition.js','createMapOwners','__auditOwners']]){
   await page.route(`**/modules/${file}*`,async route=>{
    const response=await route.fetch(),source=await response.text();
    expect(source).toContain(`export function ${name}(`);
    await route.fulfill({response,body:source.replace(`export function ${name}(`,`function observedFactory(`)+`\nexport function ${name}(...args){const result=observedFactory(...args);window.${globalName}=result;return result;}`});
   });
  }
  await page.route('**/modules/gpu-map-renderer.js*',async route=>{
   const response=await route.fetch(),source=await response.text();
   await route.fulfill({response,body:source.replace('let interactionStyle = resolveMapInteractionStyle();','let interactionStyle = resolveMapInteractionStyle();window.__auditRendererStyle=()=>interactionStyle;').replace('function setInteractionStyle(nextStyle) {','function setInteractionStyle(nextStyle) {window.__auditStyleCalls.push(structuredClone(nextStyle));')});
  });
  await page.route('**/modules/gpu-scene.js*',async route=>{
   const response=await route.fetch(),source=await response.text();
   await route.fulfill({response,body:source.replace('function replaceGpuSceneDomain(domain, { polygons = [], strokes = [] } = {}) {','function replaceGpuSceneDomain(domain, { polygons = [], strokes = [] } = {}) {window.__auditScenes[domain]={polygons:polygons.length,strokes:strokes.length};')});
  });
  await page.route('**/modules/rendering-domain.js*',async route=>{
   const response=await route.fetch(),source=await response.text();
   await route.fulfill({response,body:source.replace('export function createRenderingDomain(','function observedFactory(')+`
export function createRenderingDomain(options){const domain=observedFactory(options);window.__auditDomain=domain;window.__auditSelection=options.selectionDomain;window.__auditPassStats=()=>options.selectionResources.selectionPass.stats();window.__auditRuntime=()=>options.gpuMapRenderer.getRuntimeState();window.__auditSelectionPass=()=>!!options.selectionResources.selectionPass;window.__auditState=()=>options.territorialResources.getState();
return Object.freeze(Object.fromEntries(Object.entries(domain).map(([key,value])=>[key,key.startsWith('invalidate')? (...args)=>{window.__auditCalls.push({key,args});return value(...args);}:value])));}`});
  });
  await page.route('**/modules/reliability-core.js*',async route=>{
   const response=await route.fetch(),source=await response.text();
   await route.fulfill({response,body:source.replace('export function createDiagnosticLog(','function observedDiagnosticLog(')+`\nexport function createDiagnosticLog(...args){const log=observedDiagnosticLog(...args);globalThis.__auditDiagnostics=log;return log;}`});
  });
  if(mode==='viewer')await page.goto('/'+(requestedRenderer?`?renderer=${requestedRenderer}`:''));
  else await gotoEditor(page,'/'+(requestedRenderer?`?renderer=${requestedRenderer}`:''));
  await expect(page.locator(mode==='viewer'?'#viewerStatus':'#app')).toHaveAttribute(mode==='viewer'?'data-ready':'data-readiness',mode==='viewer'?'true':'enhanced',{timeout:120000});
  await page.evaluate(()=>{window.__auditOpened=false;window.addEventListener('pandolab:project-changed',event=>{if(!event.detail||event.detail.reason==='project-load')window.__auditOpened=true;});});
  await page.locator('#mobileFileBtn').click();
  const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.locator('#openProjectBtn').click()]);
  await chooser.setFiles({name:'policy.gpkg',mimeType:'application/geopackage+sqlite3',buffer:Buffer.from(file.buffer)});
  await expect.poll(()=>page.evaluate(()=>window.__auditOpened),{timeout:90000}).toBe(true);
  await expect.poll(()=>page.evaluate(()=>window.__auditState().territorialEntities.length)).toBe(2);
  const beforeMonth=await page.evaluate(()=>({month:window.__auditState().timelineCursor,meshes:window.__auditMeshCalls}));
  if(mode==='viewer'){await page.locator('#timelineDateButton').click();await page.locator('#timelineViewUnit').selectOption('month');await page.locator('#timelineNextMonth').click();await page.keyboard.press('Escape');}
  else await setEditorMonth(page,shiftTimelineMonth(beforeMonth.month,1));
  await expect.poll(()=>page.evaluate(()=>window.__auditMonthSettled),{timeout:60000}).toBe(true);
  const afterMonth=await page.evaluate(()=>({month:window.__auditState().timelineCursor,meshes:window.__auditMeshCalls}));
  await page.evaluate(async()=>{
   const root=window.__auditState().territorialEntities.find(row=>row.geometry&&row.properties.entityKind==='general'&&!row.properties.parentId);
   await window.__auditSelection.setHover({domain:'territorial',type:'entity',id:root.id},{source:'map'});
  });
  await expect.poll(()=>page.evaluate(()=>window.__auditPassStats().segmentCount)).toBeGreaterThan(0);
  if(requestedRenderer==='canvas')expect((await page.evaluate(()=>window.__auditRuntime())).renderer).toMatch(/^canvas/);
  else if(requestedRenderer){
   expect((await page.evaluate(()=>window.__auditRuntime())).renderer).toBe(requestedRenderer);
   await expect.poll(()=>page.evaluate(()=>window.__auditPassStats().channels.hover.drawSucceeded),{timeout:30000}).toBe(true);
  }
  const hoverPass=await page.evaluate(()=>window.__auditPassStats());
  const beforeResize=await page.evaluate(()=>({view:structuredClone(window.__auditState().view),refresh:window.__auditOwners.mapProjection.mapLayoutMetricsRefreshCount}));
  const client=await page.context().newCDPSession(page);
  await client.send('Emulation.setDeviceMetricsOverride',{width:1441,height:900,deviceScaleFactor:2,mobile:false});
  await expect.poll(()=>page.evaluate(()=>window.devicePixelRatio)).toBe(2);
  await expect.poll(()=>page.evaluate(()=>window.__auditOwners.mapProjection.mapLayoutMetricsRefreshCount)).toBeGreaterThan(beforeResize.refresh);
  const afterDpr=await page.evaluate(()=>window.__auditOwners.mapProjection.mapLayoutMetricsSnapshot.dpr);
  await client.send('Emulation.clearDeviceMetricsOverride');await client.detach();
  await page.setViewportSize({width:640,height:360});
  await expect.poll(()=>page.evaluate(()=>window.__auditState().size.width)).toBe(await page.locator('#map').evaluate(node=>node.clientWidth));
  const afterResize=await page.evaluate(()=>structuredClone(window.__auditState().view));
  expect(afterResize).toEqual(beforeResize.view);
  await page.setViewportSize({width:1440,height:900});
  await expect.poll(()=>page.evaluate(()=>window.__auditState().size.width)).toBe(await page.locator('#map').evaluate(node=>node.clientWidth));
  evidence[mode]=await page.evaluate(async()=>{
   const settings=window.__auditSettings,owners=window.__auditOwners;
   settings.renderMapDisplaySettings();
   await settings.updateLayerPresentationStyle('objects',{opacity:.25});
   settings.renderMapDisplaySettings();
   const input=document.querySelector('[data-layer-style-opacity="objects"]');
   const range={value:input.value,common:input.style.getPropertyValue('--ui-range-progress'),independent:input.style.getPropertyValue('--range-progress')};
   await settings.setTerrainMode('physical');await settings.setTerrainMode('none');
   const disabledTerrain=structuredClone(window.__auditState().physicalSettings);
   window.__auditCalls=[];window.__auditStyleCalls=[];
   const preferences=structuredClone(window.__auditPreferences.current);
   preferences.selection.color='#ff0088';preferences.selection.outlineVisible=false;preferences.selection.fillStrength=.8;
   window.__auditPreferences.apply(preferences,{persist:false});
   const result={range,disabledTerrain,preferenceCalls:window.__auditCalls,rendererStyleCalls:window.__auditStyleCalls,
    requestedStyle:window.__auditPreferences.interactionStyle,rendererStyle:window.__auditRendererStyle(),scenes:window.__auditScenes,runtime:window.__auditRuntime(),passStats:window.__auditPassStats()};
   result.host={hostAllocated:!!owners.mapHost.mapHost,commonResizeObserver:!!owners.mapHost.mapResizeObserver};
   result.selectionPass=window.__auditSelectionPass();
   result.noticeBefore={error:document.getElementById('actionStatus').classList.contains('error'),text:document.getElementById('actionStatus').textContent};
   window.__auditDomain.recordSelectionRenderError({stage:'policy-test',error:new Error('retained-frame-test')});
   result.noticeAfter={error:document.getElementById('actionStatus').classList.contains('error'),text:document.getElementById('actionStatus').textContent};
   result.recoveredDiagnostic=window.__auditDiagnostics.snapshot().find(row=>row.technicalMessage==='retained-frame-test');
   return result;
  });
  evidence[mode].hoverPass=hoverPass;
  evidence[mode].timeline={before:beforeMonth,after:afterMonth};
  evidence[mode].resize={dpr:afterDpr,view:afterResize};
  evidence[mode].errors=errors;evidence[mode].consoleErrors=consoleErrors;await page.close();
  writeFileSync(testInfo.outputPath('shared-view-policy.json'),JSON.stringify(evidence,null,2));
 }
 expect(evidence.viewer.errors).toEqual([]);expect(evidence.editor.errors).toEqual([]);
 for(const mode of ['viewer','editor']){
  const result=evidence[mode];
  expect.soft(result.consoleErrors.filter(message=>message.includes('PL-PLACE-LOAD-001')),`${mode}: builtin place publication uses its live rendering owner`).toEqual([]);
  expect.soft(result.rendererStyle.selection,`${mode}: renderer receives preferences`).toEqual(result.requestedStyle.selection);
  expect.soft(result.range.common,`${mode}: common slider progress`).toBe('25%');
  expect.soft(result.disabledTerrain.terrainStyle,`${mode}: turning terrain off retains its style`).toBe('physical');
  expect.soft(result.scenes['base-graticule']?.strokes,`${mode}: common base scene`).toBeGreaterThan(0);
  expect.soft(result.timeline.after.meshes-result.timeline.before.meshes,`${mode}: unchanged monthly geometry`).toBe(0);
  expect.soft(result.host,`${mode}: shared output and resize owner`).toEqual({hostAllocated:true,commonResizeObserver:true});
  expect.soft(result.selectionPass,`${mode}: selection pass registered`).toBe(true);
  expect.soft(result.noticeAfter,`${mode}: retained frame does not publish an operation error`).toEqual(result.noticeBefore);
  expect.soft(result.resize.dpr,`${mode}: resized layout uses the emulated DPR`).toBe(2);
  expect.soft(result.recoveredDiagnostic?.result,`${mode}: technical diagnostic retained`).toBe('recovered');
 }
});


test('low-resource startup initializes resize state before the renderer requests a quality resize',async({page})=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 await page.addInitScript(()=>{Object.defineProperty(navigator,'deviceMemory',{value:2,configurable:true});Object.defineProperty(navigator,'hardwareConcurrency',{value:2,configurable:true});});
 await page.goto('/?debug=1&renderer=canvas');
 await expect.poll(async()=>errors.length>0||await page.locator('#viewerStatus').getAttribute('data-ready')==='true',{timeout:120000}).toBe(true);
 expect(errors).toEqual([]);
 await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true');
 expect((await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot())).territorialEntities.length).toBeGreaterThan(0);
 await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats().displayedRevision)).toBeGreaterThan(0);
});
