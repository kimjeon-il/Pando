import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapRenderCoordinator, MAP_RENDER_MASKS } from "../../shared/frontend/js/modules/map-render-coordinator.js";
import { drawGpuBaseScene } from "../../shared/frontend/js/modules/gpu-base-scene-pass.js";
import { createInitialDocument } from "../../shared/frontend/js/modules/initial-document.js";
import { createCoreDocumentReadModel } from "../../shared/frontend/js/modules/core-document-read-model.js";
import { createGeometryVersionStore } from "../../shared/frontend/js/modules/geometry-version-store.js";
import { resolveMapTheme } from "../../shared/frontend/js/modules/map-theme.js";

test('project replacement preserves the presented scene without moving labels into the new document', () => {
  const frames=[],calls=[];let blocked=true;
  const coordinator=createMapRenderCoordinator({requestFrame:callback=>frames.push(callback),
    isPresentationBlocked:()=>blocked,prepareView:()=>{calls.push('prepare');return {revision:1};},
    renderers:{preservedFrame:()=>calls.push('preserve'),beginFrame:()=>calls.push('begin'),
      countries:()=>calls.push('countries'),territorialLabels:()=>calls.push('labels')}});
  coordinator.invalidate(MAP_RENDER_MASKS.PROJECT,'replacement');frames.shift()();
  assert.deepEqual(calls,['preserve']);
  blocked=false;coordinator.invalidate(MAP_RENDER_MASKS.PROJECT,'new-first-frame');frames.shift()();
  assert.deepEqual(calls,['preserve','prepare','begin','countries','labels']);
});

test('the shared base pass can show land and ocean before country mesh exists', () => {
  const draws=[];
  const gl=new Proxy({},{get:(_target,name)=>typeof name==='string'&&name.toUpperCase()===name?0:()=>{}});
  const prepared={baseTriangleDraw:{ranges:[]},overrideTriangleDraw:{ranges:[]},territoryItems:[],
    physicalLandItems:[{packet:{key:'land',role:'physical-land'}}],independentItems:[],
    deferredOverlayKeys:new Set(),failedOverlayKeys:new Set(),strokeDomainReplacements:[]};
  const result=drawGpuBaseScene({gl,frame:{frameId:1,projectGeneration:0},width:100,height:100,
    terrainVisible:true,terrainStyle:'physical',countriesVisible:true,mapSubstrate:{color:'#ccc',fillAlpha:1},
    countries:{mesh:null,overrideMesh:null},prepared},
  {drawProgram:()=>{throw new Error('Country data must not be drawn.');},drawOceanSubstrate:()=>draws.push('ocean-substrate'),renderTerrain:pass=>draws.push(pass),
    drawHydro:()=>{},drawCountryBoundaryStrokes:()=>({renderedKeys:[],missingKeys:[]}),
    polygonOverlayPass:{drawPackets:()=>draws.push('land')},strokeRenderer:{}});
  assert.deepEqual(draws,['ocean-substrate','land','land','ocean','land']);
  assert.equal(result.frameId,1);
});

test('the ocean substrate and hydro share the physical palette without changing political water', () => {
  const state={physicalSettings:{terrainVisible:true,terrainStyle:'physical'}};
  assert.equal(resolveMapTheme({state,theme:'light'}).ocean,'#6aa8d2');
  state.terrainManifest={displayColors:{oceanRepresentative:'#6496c8'}};
  assert.equal(resolveMapTheme({state,theme:'dark'}).ocean,'#517fb1');
  state.physicalSettings.terrainStyle='political';
  assert.equal(resolveMapTheme({state,theme:'light'}).ocean,'#ffffff');
});

test('accepting immutable geometry keeps the validated allocation and isolates mutable project properties', () => {
  const ref={id:'land',version:1};
  const store=createGeometryVersionStore([{...ref,geojson:{type:'Polygon',coordinates:[[[0,0],[2,0],[0,2],[0,0]]]}}]);
  const source=createInitialDocument({appVersion:'test'});source.geometries=store.snapshot();
  const model=createCoreDocumentReadModel(createInitialDocument({appVersion:'test'}));
  model.acceptLoadedProject(source);
  assert.equal(model.geometry(ref),store.get(ref));
  source.labels.push({id:'outside'});
  assert.deepEqual(model.snapshot().labels,[]);
  const raw=structuredClone(source);raw.labels=[];model.acceptLoadedProject(raw);
  raw.geometries[0].geojson.coordinates[0][1][0]=77;
  assert.equal(model.geometry(ref).coordinates[0][1][0],2);
  assert.equal(Object.isFrozen(model.geometry(ref).coordinates[0][1]),true);
});
