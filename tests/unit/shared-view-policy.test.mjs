import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createCoreDocumentReadModel} from "../../shared/frontend/js/modules/core-document-read-model.js";
import {createMapHost} from "../../shared/frontend/js/modules/map-workspace-host.js";
import assert from 'node:assert/strict';
import {createRenderQuality} from "../../shared/frontend/js/modules/render-quality.js";
import {createTerritorialEntityStore} from "../../shared/frontend/js/modules/territorial-entity-store.js";
import {createHydroSettings} from "../../shared/frontend/js/modules/physical-settings.js";

test('terrain intents retain the last enabled mode and reject unknown modes',()=>{
 const settings={terrainVisible:true,terrainStyle:'physical',hydroLayers:{rivers_hydro:false}};
 const physical=createHydroSettings();physical.connect({projectState:{state:{physicalSettings:settings}}});
 assert.deepEqual(physical.terrainModeSettings('none'),{...settings,terrainVisible:false});
 assert.equal(physical.terrainModeSettings('political').terrainStyle,'political');
 assert.throws(()=>physical.terrainModeSettings('unknown'),/Unknown terrain mode/);
 assert.equal(settings.terrainVisible,true);assert.equal(settings.terrainStyle,'physical');
});

test('the render quality owner applies preference style to every render consumer',()=>{
 const style={hover:{color:'#ff0088'},selection:{color:'#ff0088',outlineVisible:false,fillStrength:.8}};
 const calls=[];
 const quality=createRenderQuality();
 quality.connect({preferences:{resolvedInteractionStyle:style},selectionServices:{setSelectionInteractionStyle:value=>calls.push(['shared',value])},
  gpuRenderingA:{selectionPass:{updateStyle:value=>calls.push(['pass',value])}},
  rendering:{gpuMapRenderer:{setInteractionStyle:value=>calls.push(['renderer',value]),invalidateCountryPalette:(...args)=>calls.push(['palette',...args]),invalidatePhysicalStyle:reason=>calls.push(['physical',reason])}},
  domains:{renderingDomain:{invalidateSelectionStyle:reason=>calls.push(['selection',reason]),invalidateBaseScene:reason=>calls.push(['base',reason])}}});
 quality.applyMapAppearanceChange({reason:'preferences',rerender:true});
 assert.deepEqual(calls.slice(0,3),[['shared',style],['pass',style],['renderer',style]]);
 assert.ok(calls.some(([key])=>key==='selection'));assert.ok(calls.some(([key])=>key==='base'));
 calls.length=0;quality.applyMapAppearanceChange({reason:'preview',rerender:false});
 assert.ok(calls.some(([key])=>key==='renderer'));assert.ok(!calls.some(([key])=>key==='selection'||key==='base'));
});

test('the entity projection reports actual root shape changes separately from metadata and child changes',()=>{
 const geometry={type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[0,0]]]};
 let rows=[{id:'A',geometry,properties:{entityKind:'general',parentId:'',name:'A'}}],transition,version=1;
 const changes=[];
 const store=createTerritorialEntityStore({documentModel:{territorialViews:()=>rows,list:()=>[],world:()=>({entities:rows.map(row=>({id:row.id,geometryRef:{id:`shape:${row.id}`,version}}))}),projectWorld:()=>({})},
  commandOwner:{state:()=>({}),subscribeTransitions:listener=>{transition=listener;return ()=>{};},resolveWorld(){},setTimelineCursor(){}},
  onEntitiesReplaced:(_rows,change)=>changes.push(change)});
 rows=[{...rows[0],properties:{...rows[0].properties,name:'renamed'}}];transition();
 assert.equal(changes.at(-1).rootGeometryChanged,false);
 rows=[{...rows[0],geometry:structuredClone(geometry)}];transition();
 assert.equal(changes.at(-1).rootGeometryChanged,false,'the same canonical geometry version must not rebuild because its allocation changed');
 version++;rows=[{...rows[0],geometry:structuredClone(geometry)}];transition();
 assert.equal(changes.at(-1).rootGeometryChanged,true);
 rows=[...rows,{id:'B',geometry,properties:{entityKind:'general',parentId:'A'}}];transition();
 assert.equal(changes.at(-1).rootGeometryChanged,false);
 rows=rows.map(row=>row.id==='B'?{...row,properties:{...row.properties,parentId:''}}:row);transition();
 assert.equal(changes.at(-1).rootGeometryChanged,true);
 store.dispose();
});


test('replacing a document invalidates roots even when archive-local geometry references collide',()=>{
 const seed=JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json',import.meta.url),'utf8'));
 const model=createCoreDocumentReadModel(seed),binding=seed.timelineRecords.geometryBindings.find(row=>row.entityId==='A');
 const world={month:'2026-10',sourceEpoch:1,entities:[{id:'A',geometryRef:binding.geometryRef,parentId:'',coverageMode:'explicit',validFrom:null,validTo:null,rootId:'A',ancestors:[],properties:seed.territorialEntities.find(row=>row.id==='A').properties}]};
 model.acceptWorld(world,1);
 let transition;const changes=[];
 const store=createTerritorialEntityStore({documentModel:model,commandOwner:{state:()=>({}),subscribeTransitions:listener=>{transition=listener;return ()=>{};},resolveWorld(){},setTimelineCursor(){}},onEntitiesReplaced:(_rows,change)=>changes.push(change)});
 const before=store.snapshot()[0].geometry,next=structuredClone(seed);
 next.geometries.find(row=>row.id===binding.geometryRef.id&&row.version===binding.geometryRef.version).geojson={type:'Polygon',coordinates:[[[30,0],[30,10],[40,10],[40,0],[30,0]]]};
 for(const operation of ['core.document-load','core.document-load-baseline','core.document-initialize','core.document-replacement-rollback']){
  model.acceptLoadedProject(next);model.acceptWorld({...world,sourceEpoch:2},2);transition({},operation);
  assert.equal(changes.at(-1).rootGeometryChanged,true,operation);
 }
 assert.notDeepEqual(store.snapshot()[0].geometry,before);store.dispose();
});

test('the shared resize owner unregisters viewport and DPR listeners before restart and disposal',()=>{
 const viewport=new globalThis.EventTarget(),query=new globalThis.EventTarget();let refreshes=0,queued=0,disconnects=0,queries=0;
 const saved=Object.fromEntries(['window','ResizeObserver','requestAnimationFrame','cancelAnimationFrame'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 Object.assign(globalThis,{window:{visualViewport:viewport,matchMedia:()=>{queries++;return query;},devicePixelRatio:1},ResizeObserver:class{observe(){}disconnect(){disconnects++;}},requestAnimationFrame:()=>++queued,cancelAnimationFrame:()=>{}});
 try{
  const host=createMapHost({productMode:'viewer'});host.connect({platform:{$:()=>({})},workspaceUiB:{refreshMapSheetMetrics:()=>refreshes++}});
  host.initializeMapResizeObserver();host.initializeResolutionQuery();host.startMapResizeObserver();host.startMapResizeObserver();
  viewport.dispatchEvent(new globalThis.Event('resize'));assert.equal(refreshes,1,'restart must not multiply callbacks');
  query.dispatchEvent(new globalThis.Event('change'));assert.equal(queries,3,'DPR changes install the next resolution query');
  host.stopMapResizeObserver();const before=queued;
  viewport.dispatchEvent(new globalThis.Event('resize'));query.dispatchEvent(new globalThis.Event('change'));
  assert.equal(refreshes,1);assert.equal(queued,before);assert.equal(queries,3);assert.ok(disconnects>=2);
 }finally{for(const [key,descriptor]of Object.entries(saved)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
});
