import {test,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {coreFileProjection,productionGeoPackage} from '../helpers/production-geopackage.mjs';
import {normalizeLayerPresentation} from "../../shared/frontend/js/modules/layer-presentation.js";
import {startupDocument} from '../helpers/core-startup.mjs';
import {createTerritorialFeature} from "../../shared/frontend/js/modules/territorial-units.js";
import {createDistributionLayer,createDistributionEntry} from "../../shared/frontend/js/modules/distribution-model.js";
import {normalizeGenericFeatureSemantics} from "../../apps/editor/frontend/js/modules/generic-feature-service.js";

const flag='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8"><path fill="red" d="M0 0h12v8H0z"/></svg>').toString('base64');
async function observe(page){
 await page.addInitScript(()=>{window.__parityScenes={};window.__parityErrors=[];});
 await page.route('**/modules/gpu-scene.js*',async route=>{
  const response=await route.fetch(),source=await response.text();
  const original='function replaceGpuSceneDomain(domain, { polygons = [], strokes = [] } = {}) {';
  expect(source).toContain(original);
  await route.fulfill({response,body:source.replace(original,original+'\nwindow.__parityScenes[domain]=structuredClone({polygons,strokes});')});
 });
 await page.route('**/modules/rendering-domain.js*',async route=>{
  const response=await route.fetch(),source=await response.text();
  await route.fulfill({response,body:source.replace('export function createRenderingDomain(','function createObservedDomain(')+`
export function createRenderingDomain(options){
 const domain=createObservedDomain({...options,prepareView:value=>{const frame=options.prepareView(value);window.__parityFrame=frame;return frame;}});
 window.__parityDomain=domain;window.__paritySelection=options.selectionDomain;
 window.__parityResources=Object.fromEntries(['labelResources','countryResources','hydroResources','territorialResources','genericResources','distributionResources','territorialBoundaryResources','selectionResources','baseResources'].map(key=>[key,Object.keys(options[key]||{}).sort()]));
 window.__parityState=()=>options.territorialResources.getState();
 window.__parityDocument=()=>options.projectDomain.snapshot();
 window.__parityVisible=ref=>options.selectionResources.objectRefVisible(ref);
 window.__parityOutlines=()=>{const feature=options.territorialResources.entityRepository.get('A');return {
  content:options.countryResources.countryOutlineFeature(feature).geometry,
  selection:options.selectionResources.countryOutlineFeature(feature).geometry};};
 return domain;
}`});
 });
}

test('web and editor use the same hover flags and child boundary scene',async({browser},testInfo)=>{
 test.setTimeout(300000);
 const square=(x0,y0,x1,y1)=>({type:'Polygon',coordinates:[[[x0,y0],[x0,y1],[x1,y1],[x1,y0],[x0,y0]]]});
 const seed=startupDocument([
  createTerritorialFeature({id:'A',name:'A 영토',entityKind:'general',geometry:square(0,0,20,20),metadata:{flagDataUrl:flag}}),
  createTerritorialFeature({id:'B',name:'B 영토',entityKind:'general',parentId:'A',geometry:square(0,0,10,20),metadata:{flagDataUrl:flag}}),
  createTerritorialFeature({id:'C',name:'C 영토',entityKind:'general',geometry:square(30,0,40,20),metadata:{flagDataUrl:flag}}),
  createTerritorialFeature({id:'R',name:'R 영토',entityKind:'regional',geometry:square(4,4,8,8),metadata:{flagDataUrl:flag}}),
 ]);
 seed.layerPresentation=normalizeLayerPresentation({styles:{subunits:{opacity:.55,boundaryVisible:true,boundaryWidth:2},regions:{opacity:.7,boundaryVisible:true,boundaryWidth:3}}});
 seed.distributionLayers=[createDistributionLayer({id:'10000000-0000-4000-8000-000000000002',name:'인구',color:'#336699'})];
 seed.distributionEntries=[createDistributionEntry({id:'10000000-0000-4000-8000-000000000003',layerId:seed.distributionLayers[0].id,mode:'territorial',territorialUnitId:'C',value:10})];
 seed.genericFeatures=[normalizeGenericFeatureSemantics({type:'Feature',id:'10000000-0000-4000-8000-000000000001',geometry:{type:'LineString',coordinates:[[1,1],[5,5]]},properties:{schemaVersion:2,name:'선',color:'#112233',source:{kind:'user'}}})];
 const receipt=await coreFileProjection(seed),file=await productionGeoPackage('write',new ArrayBuffer(0),receipt.project,receipt.spatialState);
 const outputs={};
 for(const mode of ['viewer','editor']){
  const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(20000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));await observe(page);
  await page.goto(mode==='viewer'?'/':'/__editor/index.html?debug=1');
  await expect(page.locator(mode==='viewer'?'#viewerStatus':'#app')).toHaveAttribute(mode==='viewer'?'data-ready':'data-readiness',mode==='viewer'?'true':'enhanced',{timeout:120000});
  await page.evaluate(()=>{window.__parityOpened=false;window.addEventListener('pandolab:project-changed',event=>{if(!event.detail||event.detail.reason==='project-load')window.__parityOpened=true;});});
  await page.locator('#mobileFileBtn').click();
  const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.locator('#openProjectBtn').click()]);
  await chooser.setFiles({name:'parity.gpkg',mimeType:'application/geopackage+sqlite3',buffer:Buffer.from(file.buffer)});
  await expect.poll(()=>page.evaluate(()=>window.__parityOpened),{timeout:90000}).toBe(true);
  await expect.poll(()=>page.evaluate(()=>window.__parityScenes['territorial-boundaries']?.strokes?.length||0),{timeout:30000}).toBeGreaterThan(0);
  const beforeHover=await page.evaluate(()=>window.__parityDocument());
  expect(await page.evaluate(()=>window.__parityVisible({domain:'territorial',type:'entity',id:'B'}))).toBe(true);
  const bounds=await page.locator('#map').boundingBox();
  for(const [id,coordinate] of [['A',[15,15]],['B',[5,15]]]){
   const point=await page.evaluate(coordinate=>window.__parityFrame.projectVisibleCoordinate(coordinate),coordinate);
   expect(point).not.toBeNull();
   await page.mouse.move(bounds.x+point[0],bounds.y+point[1]);
   await expect(page.locator('#uiTooltip')).toContainText(`${id} 영토`);
   await expect(page.locator('#uiTooltip img')).toHaveAttribute('src',flag);
  }
  expect(await page.evaluate(()=>window.__parityDocument())).toEqual(beforeHover);
  outputs[mode]=await page.evaluate(()=>({resources:window.__parityResources,scenes:window.__parityScenes,
   hoverFlag:document.querySelector('#uiTooltip img')?.getAttribute('src')||null,
   presentation:window.__parityState().layerPresentation,stats:window.__parityDomain.getStats(),outlines:window.__parityOutlines(),
   boundaries:window.__parityDomain.getTerritorialBoundaryStats(),
   diagnostics:window.__PANDOLAB_RESOURCE_DIAGNOSTICS__,
   entities:window.__parityState().territorialEntities.map(f=>({id:f.id,kind:f.properties.entityKind,parent:f.properties.parentId,geometry:!!f.geometry})),
   visibility:window.__parityState().layerVisibility}));
  outputs[mode].errors=errors;await page.close();
  writeFileSync(testInfo.outputPath('map-parity.json'),JSON.stringify(outputs,null,2));
 }
 writeFileSync(testInfo.outputPath('map-parity.json'),JSON.stringify(outputs,null,2));
 expect(outputs.viewer.hoverFlag).toBe(flag);expect(outputs.editor.hoverFlag).toBe(flag);
 const boundary=output=>output.scenes['territorial-boundaries'].strokes.map(({geometry,style,order})=>({geometry,style,order}));
 expect(boundary(outputs.viewer)).toEqual(boundary(outputs.editor));
 expect(outputs.viewer.outlines).toEqual(outputs.editor.outlines);
 for(const domain of ['territorial-units','distributions','generic-features']){
  const normalized=output=>Object.fromEntries(['polygons','strokes'].map(channel=>[channel,output.scenes[domain][channel].map(({geometry,style,order,role,ownerId,parentId,territoryDepth})=>({geometry,style,order,role,ownerId,parentId,territoryDepth}))]));
  expect(normalized(outputs.viewer)).toEqual(normalized(outputs.editor));
 }
 expect(outputs.viewer.errors).toEqual([]);expect(outputs.editor.errors).toEqual([]);
});
