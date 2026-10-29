import assert from 'node:assert/strict';
import test from 'node:test';
import { createViewerProjectPackage } from '../fixtures/viewer-project-package.mjs';
import { createNodeCoreProject } from '../helpers/core-project.mjs';
import { createTerritorialEntityRepository } from "../../shared/frontend/js/modules/territorial-entity-repository.js";
import { createDistributionLayer, createDistributionEntry } from "../../shared/frontend/js/modules/distribution-model.js";
import { normalizeLayerPresentation } from "../../shared/frontend/js/modules/layer-presentation.js";
import { resolveMapTheme } from "../../shared/frontend/js/modules/map-theme.js";
import { normalizeGenericFeatureSemantics } from "../../apps/editor/frontend/js/modules/generic-feature-service.js";

import {readDomainColor,COLOR_DOMAINS} from "../../shared/frontend/js/modules/color-adapter.js";
import {createMapContentPresentation} from "../../shared/frontend/js/modules/map-content-presentation.js";
import {layerStyle,overlayVisualOrder} from "../../shared/frontend/js/modules/layer-presentation.js";
import {normalizeObjectRef} from "../../shared/frontend/js/modules/object-selection-controller.js";
import {DISTRIBUTION_MODES,DISTRIBUTION_RENDER_MODES} from "../../shared/frontend/js/modules/distribution-model.js";
const square = { type: 'Polygon', coordinates: [[[1,1],[1,2],[2,2],[2,1],[1,1]]] };
const line = { type: 'LineString', coordinates: [[1,1],[2,2]] };
const ids = Object.fromEntries(['point','line','area','label','lake','population','temperature','expired','low','high','old','other','expired-entry']
  .map((name, index) => [name, `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`]));
const feature = (name, geometry) => normalizeGenericFeatureSemantics({ type: 'Feature', id: ids[name], geometry,
  properties: { schemaVersion: 2, name, color: '#112233', source: { kind: 'user' } } });


const chain=new Proxy(function(){},{get:(_target,key)=>key==='then'?undefined:()=>chain,apply:()=>chain});
async function fixture(t,mutate=()=>{},layers={}){
 const {project}=await createViewerProjectPackage();
 project.genericFeatures=[feature('line',line),feature('area',square)];
 project.layerPresentation=normalizeLayerPresentation({styles:{genericFeatures:{opacity:.5}}});mutate(project);
 const core=await createNodeCoreProject(project);t.after(core.dispose);
 const state={...core.documentModel.snapshot(),timelineCursor:'1914-06'};
 const entityRepository=createTerritorialEntityRepository({getEntities:()=>core.documentModel.territorialViews()});
 let scene={polygons:[],strokes:[]};let revision=0;
 const resources={getState:()=>state,layerStyle,normalizeObjectRef,
  isLayerItemVisible:(group,id)=>state.itemVisibility?.[group]?.[String(id)]!==false,
  visibleMapObjectCandidates:domains=>domains.includes('distribution')?state.distributionEntries.map(row=>({id:row.id})):
    domains.includes('generic')?state.genericFeatures.map(row=>({id:row.id})):core.documentModel.territorialViews().map(row=>({id:row.id})),
  geometryMayIntersectViewport:()=>true,replaceGpuSceneDomain:(_domain,packet)=>{scene.polygons.push(...packet.polygons||[]);scene.strokes.push(...packet.strokes||[]);},
  genericFeatureColor:feature=>feature.properties.color,gpuSceneOrder:(...args)=>overlayVisualOrder(state.layerPresentation,...args),
  buildRenderableStrokeFeature:feature=>feature,distributionLayer:layers.distribution||{selectAll:()=>chain},genericFeatureLayer:layers.generic,
  distributionColor:layer=>readDomainColor(COLOR_DOMAINS.DISTRIBUTION,{layer}).value,
  DISTRIBUTION_MODES,DISTRIBUTION_RENDER_MODES,territorialEntityRepository:entityRepository,
  featureFromGeometry:geometry=>({type:'Feature',properties:{},geometry}),getCountryGeometryRevision:()=>revision,getDistributionVisibilityRevision:()=>revision};
 const content=createMapContentPresentation({active:()=>{},framePath:()=>()=>'',isDisposed:()=>false,isSmooth:()=>true,
  generic:resources,distribution:resources,territorial:{...resources,displayEntities:()=>core.documentModel.territorialViews(),entityRepository},
  countries:{mapTheme:()=>resolveMapTheme({state,theme:'dark'})}});
 return {core,state,async build(month='1914-06'){
   await core.client.setTimelineCursor(month);state.timelineCursor=month;revision++;
   scene={polygons:[],strokes:[]};content.renderGenericFeatures({});content.renderDistributions({});return scene;
 },content};
}

test('rendered polygon and line objects do not create duplicate SVG hit paths',async t=>{
 const recorded=[];
 const layer={selectAll(selector){const selection={data(rows){recorded.push({selector,rows});return selection},enter(){return selection},exit(){return selection},append(){return selection},on(){return selection},attr(){return selection},style(){return selection},classed(){return selection},remove(){return selection}};return selection}};
 const f=await fixture(t,project=>{project.distributionLayers=[createDistributionLayer({id:ids.population,name:'인구'})];project.distributionEntries=[createDistributionEntry({id:ids.low,layerId:ids.population,mode:'geometry',geometry:square,value:10})];},{generic:layer,distribution:layer});
 const scene=await f.build();
 assert.ok(scene.polygons.length>0);assert.ok(scene.strokes.length>0);
 assert.ok(recorded.filter(row=>row.selector==='path.generic-feature-shape').every(row=>row.rows.length===0));
 assert.ok(recorded.filter(row=>row.selector==='path.distribution-shape').every(row=>row.rows.length===0));
});

test('the shared content owner keeps saved generic geometry and opacity without document writes',async t=>{
 const f=await fixture(t),before=f.core.documentModel.snapshot(),scene=await f.build();
 assert.equal(scene.strokes.find(row=>row.key===`generic:feature:${ids.line}:line`).style.alpha,.5);
 assert.equal(scene.polygons.find(row=>row.key===`generic:feature:${ids.area}:fill`).style.fillAlpha,.17);
 assert.deepEqual(scene.polygons.find(row=>row.key===`generic:feature:${ids.area}:fill`).geometry,square);
 assert.deepEqual(f.core.documentModel.snapshot(),before);assert.equal(f.core.client.state().canUndo,false);
});
test('distributions honor month-end validity, current territorial geometry, active layer and overlap', async t => {
  const f = await fixture(t, project => {
    project.distributionLayers = [
      createDistributionLayer({ id: ids.population, name: '인구', color: '#226688' }),
      createDistributionLayer({ id: ids.temperature, name: '기온', color: '#cc6644' }),
      createDistributionLayer({ id: ids.expired, validTo: '1914-06-29' }),
    ];
    project.distributionEntries = [
      createDistributionEntry({ id: ids.low, layerId: ids.population, mode: 'territorial', territorialUnitId: 'A', value: 10 }),
      createDistributionEntry({ id: ids.high, layerId: ids.population, mode: 'geometry', geometry: square, value: 30, validFrom: '1914-06-30' }),
      createDistributionEntry({ id: ids.old, layerId: ids.population, mode: 'geometry', geometry: square, value: 9999, validTo: '1914-06-29' }),
      createDistributionEntry({ id: ids.other, layerId: ids.temperature, mode: 'geometry', geometry: square, value: 20 }),
      createDistributionEntry({ id: ids['expired-entry'], layerId: ids.expired, mode: 'geometry', geometry: square, value: 20 }),
    ];
    project.distributionSettings = { renderMode: 'single', activeLayerId: ids.population, boundaryVisible: false };
  });
  let scene = await f.build();
  const rows = scene.polygons.filter(item => item.key.startsWith('distribution-entry:'));
  assert.deepEqual(rows.map(item => item.key), [`distribution-entry:${ids.low}:fill`,`distribution-entry:${ids.high}:fill`]);
  assert.equal(rows[0].style.fillAlpha, 0.12);
  assert.equal(rows[1].style.fillAlpha, 0.7);
  assert.deepEqual(rows[0].geometry, f.core.documentModel.territorialViews().find(item => item.id === 'A').geometry);
  assert.ok(!scene.strokes.some(item => item.key.startsWith('distribution-entry:')));
  const oldGeometry = rows[0].geometry;
  scene = await f.build('1914-07');
  assert.notDeepEqual(scene.polygons.find(item => item.key === `distribution-entry:${ids.low}:fill`).geometry, oldGeometry);
  f.state.distributionSettings = { ...f.state.distributionSettings, renderMode: 'overlap' };
  scene = await f.build('1914-07');
  assert.equal(scene.polygons.filter(item => item.key.startsWith('distribution-entry:')).length, 3);
  f.state.itemVisibility = { ...f.state.itemVisibility, distributions: { [ids.population]: false } };
  f.state.distributionSettings = { ...f.state.distributionSettings, renderMode: 'single' };
  scene = await f.build('1914-07');
  assert.deepEqual(scene.polygons.filter(item => item.key.startsWith('distribution-entry:')).map(item => item.key), [`distribution-entry:${ids.other}:fill`]);
});
