import test from 'node:test';
import assert from 'node:assert/strict';
import {selectPhysicalWaterContext,createPhysicalResources} from "../../shared/frontend/js/modules/physical-resources.js";
import {createHash} from 'node:crypto';
import {drawGpuBaseScene} from "../../shared/frontend/js/modules/gpu-base-scene-pass.js";
import "../../shared/frontend/js/workers/canvas-scene-composition-core.js";

test('reviewed physical geography includes approved selection through May12,1925',()=>{
 const historical={validFrom:'1922-12-30',validTo:'1925-05-12',id:'caspian1922'};
 for(const date of ['','1922-12-29','1925-05-13','1925-05','1991-01-01','2026-10-24'])assert.equal(selectPhysicalWaterContext([historical],date),null);
 assert.equal(selectPhysicalWaterContext([historical],'1922-12-30'),historical);
 assert.equal(selectPhysicalWaterContext([historical],'1922-12-31'),historical);
 assert.equal(selectPhysicalWaterContext([historical],'1922-12'),historical);
 assert.equal(selectPhysicalWaterContext([historical],'1925-04'),historical);
 assert.equal(selectPhysicalWaterContext([historical],'1925-05-12'),historical);
});

test('GPU water covers political paint once using ocean style and stays separate from territories',()=>{
 const events=[],gl=new Proxy({},{get:(_,key)=>/^[A-Z_]+$/.test(key)?key:()=>{}});
 const range={ranges:[]},water={kind:'polygon',packet:{key:'historic-water',role:'physical-water',style:{color:'wrong'}}};
 drawGpuBaseScene({gl,frame:{},width:10,height:10,terrainVisible:false,countriesVisible:true,mapSubstrate:{},mapOcean:{color:'#125678',fillAlpha:1},countries:{mesh:{triangleIndices:[]}},prepared:{baseTriangleDraw:range,overrideTriangleDraw:range,territoryItems:[],physicalLandItems:[],physicalWaterItems:[water],independentItems:[],deferredOverlayKeys:new Set(),failedOverlayKeys:new Set()}},{drawProgram:()=>events.push('countries'),drawOceanSubstrate(){},renderTerrain(){},drawHydro(){},drawCountryBoundaryStrokes:()=>events.push('borders'),polygonOverlayPass:{hasResource:()=>true,drawPackets(p){events.push(p[0]);return {renderedKeys:[p[0].key]};}},strokeRenderer:{}});
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
 const modern=asset('modern',{type:'MultiPolygon',coordinates:[]}),land=asset('history-land',{type:'MultiPolygon',coordinates:[]}),water=asset('history-water',{type:'Polygon',coordinates:[]});
 globalThis.PANDOLAB_BUILD_META={dataRevision:'test-history',physicalLand:modern,physicalWaterHistory:[{id:'history',validFrom:'1922-12-30',validTo:'1925-05-12',land,water}]};
 let reject=true,requests=0,failed,ready;
 const failure=new Promise(resolve=>{failed=resolve;}),loaded=new Promise(resolve=>{ready=resolve;});
 globalThis.fetch=async url=>{requests++;if(reject&&String(url).includes('history-land'))throw Error('transient');return new Response(bytes.get(new URL(url).pathname.split('/').at(-1)));};
 const state={timelineCursor:''},resource=createPhysicalResources({capabilities:{terrain:false,builtinHydro:false}});
 resource.connect({projectState:{state},physicalConfig:{PHYSICAL_DATA_BASE_URL:'http://fixture/assets/data/'},domains:{renderingDomain:{invalidateProject:reason=>{if(reason==='historical-physical-water-ready')ready();}}},feedback:{reportOperationError:failed}});
 await resource.loadPhysicalData({includeHydro:false});const initial=resource.physicalLand;
 state.timelineCursor='1922-12';assert.equal(resource.physicalLand,initial);await failure;
 const count=requests;assert.equal(resource.physicalLand,initial);assert.equal(resource.physicalLand,initial);assert.equal(requests,count);
 state.timelineCursor='2026-10';assert.equal(resource.physicalLand,initial);
 reject=false;state.timelineCursor='1922-12';void resource.physicalLand;await loaded;
 assert.equal(resource.physicalLand.water.type,'Polygon');assert.ok(requests>count);
});
