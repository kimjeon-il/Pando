import { describe as featureDescribe } from 'node:test';
import * as __suiteDependency0 from "node:test";
import * as __suiteDependency1 from "node:assert/strict";
import * as __suiteDependency2 from "node:worker_threads";
import * as __suiteDependency3 from "../../shared/frontend/js/modules/map-display-client.js";
import * as __suiteDependency4 from "../../shared/frontend/js/modules/worker-rpc.js";
import * as __suiteDependency5 from "../../shared/frontend/js/modules/territorial-units.js";
import * as __suiteDependency6 from "node:test";
import * as __suiteDependency7 from "node:assert/strict";
import * as __suiteDependency8 from "../../shared/frontend/js/modules/map-display-menu-state.js";
import * as __suiteDependency9 from "../helpers/read-frontend-source.mjs";
import * as __suiteDependency10 from "node:assert/strict";
import * as __suiteDependency11 from "node:fs/promises";
import * as __suiteDependency12 from "node:test";
import * as __suiteDependency13 from "../../shared/frontend/js/modules/map-interaction-gate.js";
import * as __suiteDependency14 from "../../shared/frontend/js/modules/map-host.js";

// Original feature contract: map-display-client.test.mjs
featureDescribe("map-display-client", () => {
  const test = __suiteDependency0.default;
  const assert = __suiteDependency1.default;
  const { Worker } = __suiteDependency2;
  const { createMapDisplayClient } = __suiteDependency3;
  const { createWorkerRpcClient } = __suiteDependency4;
  const { createTerritorialFeature } = __suiteDependency5;
function createWorker(){const worker=new Worker(new URL('../helpers/map-display-worker-thread.mjs',import.meta.url));const adapter={postMessage:value=>worker.postMessage(value),terminate:()=>worker.terminate()};worker.on('message',data=>adapter.onmessage?.({data}));worker.on('error',error=>adapter.onerror?.(error));return adapter;}
const shape=(id,x)=>createTerritorialFeature({id,entityKind:id==='CHILD'?'regional':'general',parentId:'',geometry:{type:'Polygon',coordinates:[[[0,0],[0,10],[x,10],[x,0],[0,0]]]}});
test('the actual common presentation Worker prepares boundaries and accepts current results without document writes',async t=>{
 const entities=[shape('ROOT',10),shape('CHILD',5)],before=structuredClone(entities);
 const client=createMapDisplayClient({createWorker,getEntities:()=>entities,getRevision:()=>1});t.after(client.dispose);
 const result=await client.prepare({kind:'boundaries'});assert.ok(result.result.segments.length);assert.deepEqual(entities,before);
 const highlight=await client.prepare({kind:'highlight',feature:entities[1],occluders:[{feature:entities[0]}]});assert.ok(highlight.result.feature.geometry);assert.deepEqual(entities,before);
});
test('the presentation transport discards results from a replaced document',async t=>{
 let revision=1;const client=createMapDisplayClient({createWorker,getEntities:()=>[shape('ROOT',10),shape('CHILD',5)],getRevision:()=>revision});t.after(client.dispose);
 const pending=client.prepare({kind:'boundaries'});revision++;
 await assert.rejects(pending,error=>error.code==='PL-WORKER-RPC-STALE');
});
test('the actual presentation Worker has no editing request handler',async t=>{
 const rpc=createWorkerRpcClient({createWorker});t.after(()=>rpc.stop());
 await assert.rejects(rpc.request('territorial-edit',{operation:'delete'}),error=>error.code==='PL-WORKER-RPC-UNKNOWN-OPERATION');
});
});
// Original feature contract: map-display-menu-state.test.mjs
featureDescribe("map-display-menu-state", () => {
  const test = __suiteDependency6.default;
  const assert = __suiteDependency7.default;
  const { createMapDisplayMenuState } = __suiteDependency8;
test('desktop menu state owns its path and focus without sharing domain settings',()=>{
  const menu=createMapDisplayMenuState();
  assert.deepEqual(menu.path,[]);
  menu.setPath(['objects','labels']);
  assert.deepEqual(menu.path,['objects','labels']);
  assert.equal(menu.popPath(),'labels');
  assert.deepEqual(menu.path,['objects']);
  const focus={id:'row'};menu.rememberFocus(focus);
  assert.equal(menu.focusedControl,focus);
  menu.rememberFocus(null);
  assert.equal(menu.focusedControl,null);
});

test('a new pointer gesture cancels pending menu open and close',async()=>{
  const menu=createMapDisplayMenuState();
  let opened=0,closed=0;
  menu.scheduleOpen(()=>opened++,5);
  menu.scheduleClose(()=>closed++,5);
  menu.beginGesture(7);
  assert.equal(menu.gesture,7);
  assert.equal(menu.endGesture(8),false);
  assert.equal(menu.endGesture(7),true);
  await new Promise(resolve=>setTimeout(resolve,15));
  assert.equal(opened,0);assert.equal(closed,0);
});
});
// Original feature contract: map-host.test.mjs
featureDescribe("map-host", () => {
  const { readFrontendSources } = __suiteDependency9;
  const assert = __suiteDependency10.default;
  const {  readFile  } = __suiteDependency11;
  const test = __suiteDependency12.default;
  const {  createMapInteractionGate  } = __suiteDependency13;
  const {  normalizeMapSurfaceDragDelta,  } = __suiteDependency14;
test('MapHost surface drag contract preserves the user input direction', () => {
  assert.deepEqual(normalizeMapSurfaceDragDelta(40, 15), [40, 15]);
  assert.deepEqual(normalizeMapSurfaceDragDelta(-40, -15), [-40, -15]);
  assert.deepEqual(normalizeMapSurfaceDragDelta(Number.NaN, Number.POSITIVE_INFINITY), [0, 0]);
});

test('flat projection remains equirectangular and is not constrained by Mercator latitude', async () => {
  const app = readFrontendSources('map-projection','map-workspace-host');
  const gpuRenderer = await readFile(new URL("../../shared/frontend/js/modules/gpu-map-renderer.js", import.meta.url), 'utf8');
  const polygonPass = await readFile(new URL("../../shared/frontend/js/modules/gpu-polygon-overlay-pass.js", import.meta.url), 'utf8');
  const strokeRenderer = await readFile(new URL("../../shared/frontend/js/modules/gpu-stroke-renderer.js", import.meta.url), 'utf8');
  assert.match(app, /d3\.geo\.equirectangular\(\)/);
  assert.doesNotMatch(app, /clamp\([^\n]*-85,\s*85\)/);
  for (const source of [gpuRenderer, polygonPass, strokeRenderer]) {
    assert.doesNotMatch(source, /log\(tan\(/);
    assert.match(source, /lat\s*-\s*uFlatCenter\.y/);
  }
});

test('MapInteractionGate keeps labels in Pando and Space pan in the host', () => {
  const gate = createMapInteractionGate();
  const handle = { closest: selector => selector.includes('.user-label') ? {} : null };
  const background = { closest: () => null };
  assert.equal(gate.ownerForEvent(handle), 'pando');
  assert.equal(gate.ownerForEvent(background), 'host');
  gate.setNavigationEnabled(false);
  assert.equal(gate.ownerForEvent(background), 'pando');
  gate.setForcedPan(true);
  assert.equal(gate.ownerForEvent(handle), 'host');
});
});
