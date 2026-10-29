import test from 'node:test';
import {createCoreDocumentReadModel} from '../../shared/frontend/js/modules/core-document-read-model.js';
import {sharedCalculationCore} from '../../shared/frontend/js/modules/temporal.js';
import assert from 'node:assert/strict';
import {resolvePhysicalWaterObjects,createPhysicalResources} from "../../shared/frontend/js/modules/physical-resources.js";
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createGeometryVersionStore} from '../../shared/frontend/js/modules/geometry-version-store.js';
import {modernCaspianWater} from '../../tools/gis/prepare-water-object-history.mjs';
import {drawGpuBaseScene} from "../../shared/frontend/js/modules/gpu-base-scene-pass.js";
import "../../shared/frontend/js/workers/canvas-scene-composition-core.js";

const objectRef={domain:'hydroBuiltin',id:'waterbody:caspian'};
test('derived modern water retains islands and uses the small spherical interior',()=>{
 const square=(w,s,e,n)=>[[w,s],[w,n],[e,n],[e,s],[w,s]];
 const outer=square(40,30,60,55),water=square(45,36,55,47).reverse(),island=square(48,40,49,41);
 const land={type:'MultiPolygon',coordinates:[[outer,water],[island]]},before=structuredClone(land);
 const result=modernCaspianWater(land),scope={};
 vm.runInNewContext(readFileSync(new URL('../../shared/frontend/js/vendor/d3.min.js',import.meta.url),'utf8'),scope);
 assert.equal(result.coordinates.length,2);
 assert.ok(scope.d3.geo.area(result)>0&&scope.d3.geo.area(result)<0.1,'water cannot fill the complementary world');
 assert.deepEqual(land,before,'source land and islands stay immutable');
 const points=rings=>[...new Set(rings.flat().map(point=>point.join(',')))].sort();
 assert.deepEqual(points(result.coordinates),points([water,island]));
});
function catalog(land,water) {
 return {identities:[{objectRef,entityKind:'lake',name:'Caspian',layerId:'lakes_base'}],geometries:[{geometryRef:{id:'reviewed-water',version:1},land,asset:water}],
  timelineRecords:{schemaVersion:3,lifetimes:[{id:'life',objectRef,validFrom:'1922-12-30',validTo:'1925-05-12'}],parentRelations:[],propertyBindings:[],
   geometryBindings:[{id:'water',objectRef,validFrom:'1922-12-30',validTo:'1925-05-12',geometryRef:{id:'reviewed-water',version:1}}]}};
}
test('reviewed physical geography uses the common object resolver through May12,1925',()=>{
 const input=catalog({},{});
 for(const date of ['','1922-12-29','1925-05-13','1925-05','1991-01-01','2026-10-24'])assert.deepEqual(resolvePhysicalWaterObjects(input,date),[]);
 for(const date of ['1922-12-30','1922-12-31','1922-12','1925-04','1925-05-12']){
  const selected=resolvePhysicalWaterObjects(input,date);assert.equal(selected.length,1);assert.deepEqual(selected[0].objectRef,objectRef);
 }
});

test('physical history prefetch is detached, deduplicated and reusable when its month activates',async t=>{
 const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous;});
 const bytes=new Map(),requests=[];
 const asset=(name,geometry)=>{const body=Buffer.from(JSON.stringify(geometry));bytes.set(name,body);return {url:'assets/data/'+name,encoding:'identity',sha256:createHash('sha256').update(body).digest('hex'),compressedBytes:body.length,decodedBytes:body.length};};
 const modern=asset('modern-prefetch',{type:'MultiPolygon',coordinates:[]}),land=asset('history-prefetch',{type:'MultiPolygon',coordinates:[[[[0,0],[0,1],[1,1],[0,0]]]]}),water=asset('water-prefetch',{type:'Polygon',coordinates:[]});
 globalThis.fetch=async url=>{const name=new URL(url).pathname.split('/').at(-1);requests.push(name);return new Response(bytes.get(name));};
 const state={timelineCursor:'2026-10',hydroFeatureCache:new Map()},invalidations=[];
 const resource=createPhysicalResources({buildMeta:{dataRevision:'prefetch-test',physicalLand:modern,physicalWaterObjects:catalog(land,water)},capabilities:{terrain:false,builtinHydro:false}});
 resource.connect({projectState:{state},physicalConfig:{PHYSICAL_DATA_BASE_URL:'http://fixture/assets/data/'},domains:{renderingDomain:{invalidateProject:reason=>invalidations.push(reason)}},feedback:{reportOperationError:error=>{throw error;}}});
 await resource.loadPhysicalLandMask();const initial=resource.physicalLand;invalidations.length=0;
 await Promise.all([resource.preparePhysicalContext('1922-12'),resource.preparePhysicalContext('1922-12')]);
 assert.equal(state.timelineCursor,'2026-10');assert.equal(resource.physicalLand,initial);assert.equal(state.hydroFeatureCache.size,0);
 assert.deepEqual(invalidations,[],'preparation cannot publish or invalidate the current view');
 assert.equal(requests.filter(name=>name==='history-prefetch').length,1);
 state.timelineCursor='1922-12';const selected=resource.physicalLand;
 assert.equal(selected.revision,land.sha256);assert.equal(selected.water.type,'Polygon');
 const count=requests.length;await resource.preparePhysicalContext('1925-04');assert.equal(requests.length,count,'same selected versions share the existing cache');
 await assert.rejects(resource.preparePhysicalContext('1922-12',{isCurrent:()=>false}),{name:'AbortError'});
 assert.equal(resource.physicalLand,selected,'a stale request cannot change the active physical context');
});

test('GPU water covers political paint once using ocean style and stays separate from territories',()=>{
 const events=[],gl=new Proxy({},{get:(_,key)=>/^[A-Z_]+$/.test(key)?key:()=>{}});
 const range={ranges:[]},water={kind:'polygon',packet:{key:'historic-water',role:'physical-water',style:{color:'wrong'}}};
 drawGpuBaseScene({gl,frame:{},width:10,height:10,terrainVisible:false,countriesVisible:true,surfacePresentation:{quality:"ready",terrainMode:"off",countrySurfaceMode:"political"},mapSubstrate:{},mapOcean:{color:'#125678',fillAlpha:1},countries:{mesh:{triangleIndices:[]}},prepared:{baseTriangleDraw:range,overrideTriangleDraw:range,territoryItems:[],physicalLandItems:[],physicalWaterItems:[water],independentItems:[],deferredOverlayKeys:new Set(),failedOverlayKeys:new Set()}},{drawProgram:()=>events.push('countries'),drawOceanSubstrate(){},renderTerrain(){},drawHydro(){},drawCountryBoundaryStrokes:()=>events.push('borders'),polygonOverlayPass:{hasResource:()=>true,drawPackets(p){events.push(p[0]);return {renderedKeys:[p[0].key]};}},strokeRenderer:{}});
 const painted=events.filter(e=>typeof e==='object');assert.equal(painted.length,1);assert.equal(painted[0].style.color,'#125678');assert.ok(events.indexOf(painted[0])>events.indexOf('borders'));
});

test('Canvas water uses polygon holes and ocean paint without emitting NOT_COAST strokes',()=>{
 const painted=[],context={beginPath(){},fill(){painted.push(this.fillStyle);}};
 const packet={role:'physical-water',ringCoordinates:new Float64Array([0,0,4,0,4,4,0,0,1,1,1,2,2,1,1,1]),ringOffsets:new Uint32Array([0,4,8]),polygonOffsets:new Uint32Array([0,2]),style:{color:'wrong',fillAlpha:1}};
 let geometry;globalThis.PandoLabCanvasSceneComposition.drawPhysicalWater(context,g=>{geometry=g;},[packet],{color:'#125678',fillAlpha:1});
 assert.deepEqual(painted,['#125678']);assert.equal(geometry.coordinates[0].length,2);
});

test('a rejected history load retains the background, avoids a fetch loop and retries on reentry',async t=>{
 const saved={fetch:globalThis.fetch,meta:globalThis.PANDOLAB_BUILD_META};
 t.after(()=>{globalThis.fetch=saved.fetch;globalThis.PANDOLAB_BUILD_META=saved.meta;});
 const bytes=new Map(),asset=(name,geometry)=>{const body=Buffer.from(JSON.stringify(geometry));bytes.set(name,body);return {url:'assets/data/'+name,encoding:'identity',sha256:createHash('sha256').update(body).digest('hex'),compressedBytes:body.length,decodedBytes:body.length};};
 const modern=asset('modern',{type:'MultiPolygon',coordinates:[]}),land=asset('history-land',{type:'MultiPolygon',coordinates:[[[[0,0],[0,1],[1,1],[0,0]]]]}),water=asset('history-water',{type:'Polygon',coordinates:[]});
 globalThis.PANDOLAB_BUILD_META={dataRevision:'test-history',physicalLand:modern,physicalWaterObjects:catalog(land,water)};
 let reject=true,requests=0,failed,ready;
 const failure=new Promise(resolve=>{failed=resolve;}),loaded=new Promise(resolve=>{ready=resolve;});
 globalThis.fetch=async url=>{requests++;if(reject&&String(url).includes('history-land'))throw Error('transient');return new Response(bytes.get(new URL(url).pathname.split('/').at(-1)));};
 const state={timelineCursor:''},resource=createPhysicalResources({buildMeta:globalThis.PANDOLAB_BUILD_META,capabilities:{terrain:false,builtinHydro:false}});
 resource.connect({projectState:{state},physicalConfig:{PHYSICAL_DATA_BASE_URL:'http://fixture/assets/data/'},domains:{renderingDomain:{invalidateProject:reason=>{if(reason==='physical-water-ready')ready();}}},feedback:{reportOperationError:failed}});
 await resource.loadPhysicalData({includeHydro:false});const initial=resource.physicalLand;
 state.timelineCursor='1922-12';assert.equal(resource.physicalLand,initial);await failure;
 const count=requests;assert.equal(resource.physicalLand,initial);assert.equal(resource.physicalLand,initial);assert.equal(requests,count);
 state.timelineCursor='2026-10';assert.equal(resource.physicalLand,initial);
 reject=false;state.timelineCursor='1922-12';void resource.physicalLand;await loaded;
 assert.equal(resource.physicalLand.water.type,'Polygon');assert.ok(requests>count);
});

test('two independently resolved lakes share one physical land derivative without a parallel date selector',async t=>{
 const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous;});
 const bytes=new Map(),requests=[];
 const asset=(name,geometry)=>{const body=Buffer.from(JSON.stringify(geometry));bytes.set(name,body);return {url:'assets/data/'+name,encoding:'identity',sha256:createHash('sha256').update(body).digest('hex'),compressedBytes:body.length,decodedBytes:body.length};};
 const box=x=>({type:'Polygon',coordinates:[[[x,0],[x+1,0],[x+1,1],[x,0]]]});
 const modern=asset('modern',{type:'MultiPolygon',coordinates:[]}),land=asset('combined-land',{type:'MultiPolygon',coordinates:[box(0).coordinates]}),first=asset('first',box(2)),second=asset('second',box(5));
 const input=catalog(land,first),other={domain:'hydroBuiltin',id:'waterbody:second'};
 for(const row of [...input.timelineRecords.lifetimes,...input.timelineRecords.geometryBindings]){row.validFrom='1922-01-01';row.validTo='1929-12-31';}
 input.identities.push({objectRef:other,entityKind:'lake',name:'Second',layerId:'lakes_base'});
 const replaced={domain:'hydroBuiltin',id:'lakes_base:fixture'};
 input.geometries.push({geometryRef:{id:'second-water',version:1},land,asset:second,replaces:[replaced]});
 input.timelineRecords.lifetimes.push({id:'life-second',objectRef:other,validFrom:null,validTo:null});
 input.timelineRecords.geometryBindings.push({id:'second-binding',objectRef:other,validFrom:'1922-01-01',validTo:'1929-12-31',geometryRef:{id:'second-water',version:1}});
 for(const date of ['1921-12-31','1930-01-01','1930'])assert.equal(resolvePhysicalWaterObjects(input,date).length,0);
 for(const date of ['1922-01-01','1929-12-31','1922','1929'])assert.equal(resolvePhysicalWaterObjects(input,date).length,2);
 globalThis.fetch=async url=>{const name=new URL(url).pathname.split('/').at(-1);requests.push(name);return new Response(bytes.get(name));};
 let ready;const loaded=new Promise(resolve=>{ready=resolve;});
 const original={id:replaced.id,properties:{pandolab_id:replaced.id,category:'lake'}};
 const state={timelineCursor:'',hydroEdits:[],hydroFeatureCache:new Map([[replaced.id,original]])},resource=createPhysicalResources({buildMeta:{dataRevision:'two-lakes',physicalLand:modern,physicalWaterObjects:input},capabilities:{terrain:false,builtinHydro:false}});
 const hidden=new Set();
 resource.connect({projectState:{state},physicalServices:{isHydroFeatureVisible:feature=>!hidden.has(feature.id)},physicalConfig:{PHYSICAL_DATA_BASE_URL:'http://fixture/assets/data/'},domains:{renderingDomain:{invalidateProject:reason=>{if(reason==='physical-water-ready')ready();}}},feedback:{reportOperationError:error=>{throw error;}}});
 await resource.loadPhysicalData({includeHydro:false});const initial=resource.physicalLand;
 state.timelineCursor='1922';assert.equal(resource.physicalLand,initial);assert.equal(resource.isHydroObjectActive(original),true,'loading retains the original source');await loaded;
 const selected=resource.physicalLand;assert.equal(selected.water.type,'MultiPolygon');assert.equal(selected.water.coordinates.length,2);assert.equal(requests.filter(name=>name==='combined-land').length,1);
 assert.equal(resource.isHydroObjectActive(original),false,'only the selected ready geometry replaces its explicit source');
 state.timelineCursor='1929';assert.equal(resource.physicalLand,selected,'unchanged selected versions reuse presentation');
 state.hydroFeatureCache.set(other.id,{id:other.id});hidden.add(other.id);
 const firstOnly=resource.physicalLand;assert.deepEqual(firstOnly.water,box(2));assert.equal(resource.physicalLand,firstOnly);
 hidden.clear();assert.equal(resource.physicalLand.water.coordinates.length,2,'visibility changes rebuild only presentation');
 const store=createGeometryVersionStore([{id:'copy-first',version:1,geojson:box(3)},{id:'copy-second',version:1,geojson:box(6)},{id:'copy-second',version:2,geojson:box(7)}]);
 state.hydroEdits=[{id:'copy-first',properties:{sourceFeatureId:objectRef.id},geometry:store.get({id:'copy-first',version:1})}];
 assert.deepEqual(resource.physicalLand.water,box(5),'copying one water transfers only its fill to the authored renderer');
 const firstCopyLand=resource.physicalLand.geometry;
 state.hydroEdits.push({id:'copy-second',properties:{sourceFeatureId:other.id},geometry:store.get({id:'copy-second',version:1})});
 assert.equal(resource.physicalLand.water,null,'both copies own their independent fills');
 const expected=globalThis.polygonClipping.difference(globalThis.polygonClipping.union(firstCopyLand.coordinates,[box(5).coordinates]),[box(6).coordinates]);
 assert.deepEqual(globalThis.polygonClipping.xor(resource.physicalLand.geometry.coordinates,expected),[]);
 state.hydroEdits[1]={...state.hydroEdits[1],geometry:store.get({id:'copy-second',version:2})};
 const revised=globalThis.polygonClipping.difference(globalThis.polygonClipping.union(firstCopyLand.coordinates,[box(5).coordinates]),[box(7).coordinates]);
 assert.deepEqual(globalThis.polygonClipping.xor(resource.physicalLand.geometry.coordinates,revised),[],'second edit preserves the first local patch');
 state.hydroEdits.pop();assert.deepEqual(resource.physicalLand.water,box(5),'removing the second copy restores only that source fill');
 const raw={territorialEntities:[],hydroEdits:[{id:'copy-second',type:'Feature',geometry:null,properties:{category:'lake',sourceFeatureId:other.id}}],geometries:store.snapshot()};
 const model=createCoreDocumentReadModel(raw),copyRef={domain:'hydro',id:'copy-second'};
 const records={schemaVersion:3,lifetimes:[{id:'life',objectRef:copyRef,validFrom:null,validTo:null}],parentRelations:[],propertyBindings:[],geometryBindings:[
   {id:'early',objectRef:copyRef,validFrom:null,validTo:'1925-12-31',geometryRef:{id:'copy-second',version:1}},
   {id:'late',objectRef:copyRef,validFrom:'1926-01-01',validTo:null,geometryRef:{id:'copy-second',version:2}}]};
 for(const [date,x] of [['1925-12-31',6],['1926-01-01',7]]) {
   const world=sharedCalculationCore.timelineResolveWorld(records,{entities:[{objectRef:copyRef,entityKind:'lake'}],geometryExists:()=>true},date);
   model.acceptWorld({...world,sourceEpoch:1},1);
   assert.equal(model.snapshot().hydroEdits[0].geometry,null,'canonical identity remains geometry-free');
   state.hydroEdits=model.list('hydro');
   assert.deepEqual(state.hydroEdits[0].geometry,box(x),'read model supplies the C++ selected geometry');
   const projected=resource.physicalLand;
   assert.deepEqual(projected.water,box(2));
   const expectedProjection=globalThis.polygonClipping.difference(globalThis.polygonClipping.union(selected.geometry.coordinates,[box(5).coordinates]),[box(x).coordinates]);
   assert.deepEqual(globalThis.polygonClipping.xor(projected.geometry.coordinates,expectedProjection),[]);
 }

 assert.equal(requests.filter(name=>name==='combined-land').length,1,'visibility and copying reuse immutable land');
 state.timelineCursor='1930';assert.equal(resource.physicalLand,initial);assert.equal(resource.isHydroObjectActive(original),true);assert.equal(state.hydroFeatureCache.get(replaced.id),original);
 input.geometries[1].land={...land,sha256:'different'};state.timelineCursor='1922';
 assert.throws(()=>resource.physicalLand,/one coherent physical land derivative/);
});
