import test from 'node:test';
import assert from 'node:assert/strict';
import "../../../assets/js-vendor/earcut.min.js";
import "../../../src/rendering/workers/gpu-mesh-core.js";
import { encodePolygonMesh, decodePolygonMesh } from "../../../src/rendering/polygon-mesh-codec.js";
import { createPreparedPolygonMeshStore, polygonGeometryDigest } from "../../../src/rendering/prepared-polygon-mesh.js";
import { createRenderSceneBuilder } from "../../../src/rendering/render-scene.js";


import { createHash } from 'node:crypto';
import {createPreparedMeshDelta} from '../../../tools/data/prepared-mesh-storage.mjs';
import {applyPreparedMeshDelta,preparedMeshDeltaLayout} from '../../../src/data/prepared-mesh-delta.js';

const geometry = { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 1], [0, 1], [0, 0]]] };
const engine = globalThis.PandoLabGpuMeshCore;
const context = { throwIfCancelled() {} };

test('prepared binary delta preserves every mesh byte and reuses the loaded base without triangulating',async()=>{
 const after=structuredClone(geometry);after.coordinates[0][1][0]=3;
 const base=encodePolygonMesh(engine.buildPolygonGeometryPacket(geometry)),target=encodePolygonMesh(engine.buildPolygonGeometryPacket(after));
 const patch=createPreparedMeshDelta(Buffer.from(base),Buffer.from(target)),delta=Uint8Array.from(patch).buffer;
 assert.deepEqual(new Uint8Array(applyPreparedMeshDelta(base,delta,{decodedBytes:target.byteLength})),new Uint8Array(target));
 assert.throws(()=>applyPreparedMeshDelta(base,delta.slice(0,-1),{decodedBytes:target.byteLength}),/mesh|delta/i);
 const digest=bytes=>createHash('sha256').update(new Uint8Array(bytes)).digest('hex'),baseKey=await polygonGeometryDigest(geometry),targetKey=await polygonGeometryDigest(after),baseSpec={url:'base'},patchSpec={url:'patch'},calls=[];
 const asset={storageLayout:preparedMeshDeltaLayout,baseGeometryDigest:baseKey,base:baseSpec,replacement:patchSpec,
  baseContentSha256:digest(base),contentSha256:digest(target),decodedBytes:target.byteLength};
 const store=createPreparedPolygonMeshStore({engine:{...engine,buildPolygonGeometryPacket:()=>assert.fail('existing mesh bytes must be reused')},
  loadManifest:async()=>({meshes:{[baseKey]:baseSpec,[targetKey]:asset}}),loadAsset:async spec=>{calls.push(spec.url);return spec===baseSpec?base:delta;}});
 await store.prepare({cacheKey:'base',geometry},context);await store.prepare({cacheKey:'historical',geometry:after},context);
 assert.deepEqual(calls,['base','patch']);assert.equal(store.stats().builds,0);
});

test('fixed assets and transferred copies retain holes, geometry and algorithm identity', async () => {
  const packet = engine.buildPolygonGeometryPacket(geometry), encoded = encodePolygonMesh(packet);
  const decoded = decodePolygonMesh(encoded, { algorithmVersion: engine.MESH_ALGORITHM_REVISION });
  assert.deepEqual(decoded.indices, packet.indices);
  assert.deepEqual(decoded.boundaryIndices, packet.boundaryIndices);
  assert.deepEqual(decoded.startsEnds, packet.startsEnds);
  assert.equal(decoded.segmentCount, packet.segmentCount);
  const obsolete = encoded.slice(0);
  new Uint32Array(obsolete)[1] = 1;
  assert.throws(() => decodePolygonMesh(obsolete, { algorithmVersion: engine.MESH_ALGORITHM_REVISION }), /format/);
  assert.throws(() => decodePolygonMesh(encoded, { algorithmVersion: engine.MESH_ALGORITHM_REVISION - 1 }), /algorithm/);
  assert.throws(() => decodePolygonMesh(encoded.slice(0, -1), { algorithmVersion: engine.MESH_ALGORITHM_REVISION }), /Invalid/);
  const digest = await polygonGeometryDigest(geometry);
  const store = createPreparedPolygonMeshStore({ engine,
    loadManifest: async () => ({ meshes: { [digest]: { id: digest } } }), loadAsset: async () => encoded });
  const first = await store.prepare({ cacheKey: 'fixed', geometry }, context);
  structuredClone(first, { transfer: [first.packet.positions.buffer] });
  const next = await store.prepare({ cacheKey: 'fixed', geometry }, context);
  assert.deepEqual(next.packet.positions, packet.positions);
  assert.deepEqual(next.packet.startsEnds, packet.startsEnds);
  const anotherRole = await store.prepare({ cacheKey: 'selected', geometry: structuredClone(geometry) }, context);
  assert.deepEqual(anotherRole.packet.indices, packet.indices);
  assert.equal(store.stats().assetHits, 1);
  assert.equal(store.stats().builds, 0);
});

test('edited shapes build once, cancellation prevents admission and memory is bounded', async () => {
  const store = createPreparedPolygonMeshStore({ engine });
  await store.prepare({ cacheKey: 'revision-1', geometry }, context);
  await store.prepare({ cacheKey: 'style-role', geometry: structuredClone(geometry) }, context);
  assert.equal(store.stats().builds, 1);
  const tiny = createPreparedPolygonMeshStore({ engine, byteBudget: 1 });
  assert.ok((await tiny.prepare({ cacheKey: 'oversized', geometry }, context)).packet.triangleCount);
  assert.equal(tiny.stats().bytes, 0);
  assert.ok((await tiny.prepare({ cacheKey: 'oversized', geometry }, context)).packet.segmentCount,
    'evicted cache-key mappings must be rebuilt');
  await assert.rejects(store.prepare({ cacheKey: 'cancelled', geometry }, {
    throwIfCancelled: () => { throw Object.assign(new Error('cancelled'), { cancelled: true }); },
  }), /cancelled/);
  assert.equal(store.stats().builds, 1);
});

test('production scene adopts only the latest prepared batch and reuses style changes', async () => {
  const requests = [];
  const builder = createRenderSceneBuilder({ meshJobs: {
    preparePolygons: items => new Promise(resolve => requests.push({ items, resolve })), cancelAll() {},
  } });
  const first = { key: 'editable', geometry, geometryRevision: 1 };
  const edited = { ...first, geometryRevision: 2, geometry: { type: 'Polygon', coordinates: [[[0, 0], [3, 0], [3, 1], [0, 1], [0, 0]]] } };
  assert.throws(() => builder.build({ polygons: [first] }), /준비되지/);
  const old = builder.preparePolygons([first]);
  const latest = builder.preparePolygons([edited]);
  const complete = request => request.resolve({ packets: request.items.map(item => ({ cacheKey: item.cacheKey,
    packet: engine.buildPolygonGeometryPacket(item.geometry) })) });
  complete(requests[1]); await latest;
  const scene = builder.build({ polygons: [edited] }); builder.releasePrepared();
  complete(requests[0]); await old;
  assert.equal(builder.missingPolygons([first]).length, 1, 'old completion must not enter the scene cache');
  const recolored = builder.patch(scene, { polygons: [{ ...edited, style: { color: '#ff0000' } }] });
  assert.strictEqual(recolored.polygons[0].positions, scene.polygons[0].positions);
  assert.equal(recolored.polygons[0].style.color, '#ff0000');
  assert.equal(requests.length, 2);
});

test('one Worker mesh serves both fill and outline roles and survives style changes', async () => {
  const submitted = [];
  const builder = createRenderSceneBuilder({ meshJobs: {
    preparePolygons: async items => {
      submitted.push(items);
      return { packets: items.map(item => ({ cacheKey: item.cacheKey,
        packet: engine.buildPolygonGeometryPacket(item.geometry) })) };
    },
    cancelAll() {},
  } });
  const fill = { key: 'shape:fill', geometry, geometryRevision: 'fixed-1' };
  const outline = { key: 'shape:outline', geometry, geometryRevision: 'fixed-1' };
  assert.equal(builder.missingPolygons([fill, outline]).length, 2);
  await builder.preparePolygons([fill, outline]);
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0].length, 1, 'matching polygon sources must share one Worker transfer');
  const scene = builder.build({ polygons: [fill], strokes: [outline] });
  assert.strictEqual(scene.strokes[0].startsEnds, scene.polygons[0].startsEnds);
  assert.equal(scene.strokes[0].segmentCount, scene.polygons[0].segmentCount);
  const recolored = builder.patch(scene, { strokes: [{ ...outline, style: { color: '#ff0000' } }] });
  assert.strictEqual(recolored.strokes[0].startsEnds, scene.strokes[0].startsEnds);
  assert.equal(submitted.length, 1);
  builder.releasePrepared();
});

test('sequential physical batches accumulate and cancellation preserves completed inputs', async () => {
  const submitted=[];
  const builder=createRenderSceneBuilder({meshJobs:{preparePolygons:async items=>{
    submitted.push(items.map(item=>item.cacheKey));
    return {packets:items.map(item=>({cacheKey:item.cacheKey,packet:engine.buildPolygonGeometryPacket(item.geometry)}))};
  },cancelAll(){}}});
  const land={key:'physical-land',geometry,geometryRevision:'historical-land'};
  const water={key:'physical-water',geometry:{type:'Polygon',coordinates:[[[4,0],[5,0],[5,1],[4,1],[4,0]]]},geometryRevision:'historical-water'};
  await builder.preparePolygons([land]);
  builder.cancelPreparation();
  assert.equal(builder.missingPolygons([land]).length,0,'cancelling a request must retain a completed mesh');
  await builder.preparePolygons([land,water]);
  assert.equal(builder.missingPolygons([land,water]).length,0,'both physical results must coexist');
  assert.deepEqual(submitted.map(rows=>rows.length),[1,1]);
  const scene=builder.build({polygons:[land,water]});builder.releasePrepared();
  assert.deepEqual(scene.polygons.map(item=>item.key),['physical-land','physical-water']);
  assert.equal(builder.missingPolygons([land,water]).length,0,'adopted results live in the existing scene cache');
  builder.invalidateGeometry('physical-water');
  assert.equal(builder.missingPolygons([land,water]).length,1);
  builder.clear();
});

test('triangulation rejection identifies the failing scene geometry', async () => {
  const store = createPreparedPolygonMeshStore({ engine });
  await assert.rejects(store.prepare({ cacheKey: 'edited-object:revision-7',
    geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[2,0],[0,0]]] } }, context),
  error => error.code === 'PL-MESH-TRIANGULATION' && error.message.includes('edited-object:revision-7'));
});

const gridThin = {type:'Polygon',coordinates:[[[48.84445074879411,38.793252790239734],[48.844450748794124,38.793252790239706],[48.81202354483041,38.844431391612304],[48.84445074879411,38.793252790239734]]]};

test('exact positive geometry collapsed by the render grid retains every source coordinate and its digest', async()=>{
  const before=structuredClone(gridThin),digest=await polygonGeometryDigest(gridThin);
  assert.equal(digest,'ab190310f2a1809494f81b531507f2a5412e4c93f4e3293b09bfa190b82034ca');
  assert.deepEqual(globalThis.PandoLabSphericalCore.validateClippedTerritorialRing(gridThin.coordinates[0]),[]);
  assert.ok(globalThis.PandoLabSphericalCore.validateTerritorialRing(gridThin.coordinates[0]).length);
  const packet=engine.buildPolygonGeometryPacket(gridThin);
  assert.equal(packet.rasterState,'grid-collapsed');assert.equal(packet.triangleCount,0);assert.equal(packet.segmentCount,0);
  const encoded=encodePolygonMesh(packet),decoded=decodePolygonMesh(encoded,{algorithmVersion:6});
  assert.equal(decoded.rasterState,'grid-collapsed');assert.deepEqual(Array.from(decoded.ringCoordinates),gridThin.coordinates.flat(2));
  assert.deepEqual(Array.from(decoded.ringOffsets),[0,4]);assert.deepEqual(Array.from(decoded.polygonOffsets),[0,1]);
  const store=createPreparedPolygonMeshStore({engine,loadManifest:async()=>({meshes:{[digest]:{url:'actual'}}}),loadAsset:async()=>encoded});
  const transferred=await store.prepare({cacheKey:'scope:1922:extra',geometry:gridThin},context);
  assert.equal(transferred.packet.rasterState,'grid-collapsed');assert.equal(store.stats().builds,0);assert.equal(store.stats().assetHits,1);
  assert.deepEqual(gridThin,before);assert.equal(await polygonGeometryDigest(gridThin),digest);
});

test('grid collapsed source remains in initial and patched scenes and reaches Canvas unchanged',async()=>{
  const {createCanvasScenePackets}=await import('../../../src/rendering/gpu-canvas-scene-packets.js');
  const builder=createRenderSceneBuilder(),item={key:'scope:extra',geometry:gridThin,geometryRevision:'exact'};
  const first=builder.build({polygons:[item]});assert.equal(first.polygons.length,1);assert.equal(first.polygons[0].triangleCount,0);
  const patched=builder.patch(first,{polygons:[{...item,style:{color:'#123456'}}]});assert.equal(patched.polygons.length,1);
  const canvas=createCanvasScenePackets().scenePolygons(patched.polygons);assert.equal(canvas.length,1);
  assert.deepEqual(Array.from(canvas[0].ringCoordinates),gridThin.coordinates.flat(2));assert.equal(canvas[0].style.color,'#123456');
});

test('no-raster admission does not suppress native invalid geometry errors or accept genuinely empty input',()=>{
  for(const bad of [{type:'Polygon',coordinates:[]},{type:'MultiPolygon',coordinates:[]},{type:'Polygon',coordinates:[[[0,0],[1,0],[2,0],[0,0]]]},{type:'Polygon',coordinates:[[[0,0],[1,1],[1,0],[0,1],[0,0]]]}])
    assert.throws(()=>engine.buildPolygonGeometryPacket(bad),e=>e.code==='PL-MESH-TRIANGULATION');
});

test('empty indices are not a certificate: ordinary polygons and malformed ring/position payloads are rejected',()=>{
  const packet=engine.buildPolygonGeometryPacket(geometry),zero={...packet,indices:new Uint32Array(),boundaryIndices:new Uint32Array()};
  assert.throws(()=>decodePolygonMesh(encodePolygonMesh(zero),{algorithmVersion:6}),/Invalid prepared polygon mesh/);
  const thin=engine.buildPolygonGeometryPacket(gridThin);
  for(const changed of [
    {ringOffsets:new Uint32Array([0,3])}, {polygonOffsets:new Uint32Array([0,0])},
    {ringCoordinates:new Float64Array(thin.ringCoordinates.map((x,i)=>i===0?NaN:x))},
    {positions:new Float32Array(thin.positions.map((x,i)=>i===0?0:x))},
    {ringCoordinates:new Float64Array([0,0,1,1,1,0,0,1,0,0]),ringOffsets:new Uint32Array([0,5])},
    {boundaryIndices:new Uint32Array([0,2])},
  ])assert.throws(()=>decodePolygonMesh(encodePolygonMesh({...thin,...changed}),{algorithmVersion:6}),/Invalid prepared polygon mesh/);
});


test('grid-collapse is a ready no-raster resource, never a fabricated draw or missing upload',async()=>{
  const {createGpuPolygonOverlayPass}=await import('../../../src/rendering/gpu-polygon-overlay-pass.js');
  const gl={createShader:()=>({}),createProgram:()=>({}),getShaderParameter:()=>true,getProgramParameter:()=>true,getAttribLocation:()=>0,getUniformLocation:()=>0,isContextLost:()=>false};
  let buffers=0,draws=0;gl.createBuffer=()=>{buffers++;return {};};gl.drawElements=()=>{draws++;};
  for(const name of ['shaderSource','compileShader','deleteShader','attachShader','linkProgram','deleteProgram','bindBuffer','bufferData','deleteBuffer','useProgram','disable','enable','blendFuncSeparate','uniform4f','enableVertexAttribArray','vertexAttribPointer','uniform2f','uniform1f','uniform3fv','uniform1i','disableVertexAttribArray'])gl[name]=()=>{};
  const pass=createGpuPolygonOverlayPass();assert.equal(pass.initialize({gl,version:2,capabilities:{uintIndices:true}}),true);
  const packet={...engine.buildPolygonGeometryPacket(gridThin),key:'thin',sourceKey:'thin-exact'};
  const {prepareGpuBaseScene}=await import('../../../src/rendering/gpu-scene-preparation.js');
  const prepared=prepareGpuBaseScene({scene:{polygons:[packet]},frame:{},presentedStrokeDomains:new Map()},{polygonOverlayPass:pass,strokeRenderer:{}});
  assert.equal(prepared.overlayUploadBytes,0);assert.equal(prepared.deferredOverlayKeys.size,0);assert.equal(prepared.failedOverlayKeys.size,0);
  assert.ok(pass.ensureResource(packet).resource);assert.equal(pass.hasPreparedResource(packet),true);assert.equal(buffers,0);
  const frame={viewport:[100,100],translate:[0,0],flatCenter:[0,0],scale:1,mode:1};
  for(const result of [pass.drawPackets([packet],frame,{preparedOnly:true}),pass.drawResourceItems([{key:'thin'}],frame)]){
    assert.equal(result.succeeded,true);assert.deepEqual(result.renderedKeys,[]);assert.deepEqual(result.gridCollapsedKeys,['thin']);assert.deepEqual(result.missingKeys,[]);
  }
  assert.equal(draws,0);assert.equal(pass.stats().drawCallCount,0);assert.equal(pass.stats().uploadBytes,0);
  const fake={...packet,key:'fake',sourceKey:'fake',ringCoordinates:new Float64Array([0,0,1,0,1,1,0,0])};
  assert.equal(pass.ensureResource(fake).resource,null);pass.dispose();
});


test('reader uses exact integer grid predicates rather than Number cancellation',()=>{
  const thin=engine.buildPolygonGeometryPacket(gridThin);
  const ring=[[-50,-50],[50.000001,50],[50,49.999999],[-50,-50]];
  assert.equal(100000001*99999999-100000000*100000000,0,'binary64 determinant loses the final unit');
  assert.equal(100000001n*99999999n-100000000n*100000000n,-1n);
  const fake={...thin,ringCoordinates:Float64Array.from(ring.flat()),positions:Float32Array.from(ring.slice(0,-1).flat().map(x=>Math.round(x*1e6)*1e-6))};
  assert.throws(()=>decodePolygonMesh(encodePolygonMesh(fake),{algorithmVersion:6}),/uncertified empty triangulation/);
});

test('mixed renderable and collapsed components retain source rings, hole roles and ordinary packet bytes',()=>{
  const hole=[[.5,.25],[.5,.75],[1.5,.75],[1.5,.25],[.5,.25]];
  const ordinary={type:'Polygon',coordinates:[geometry.coordinates[0],hole]};
  const mixed={type:'MultiPolygon',coordinates:[ordinary.coordinates,gridThin.coordinates]};
  const packet=engine.buildPolygonGeometryPacket(mixed),decoded=decodePolygonMesh(encodePolygonMesh(packet),{algorithmVersion:6});
  assert.ok(decoded.triangleCount>0);assert.deepEqual(Array.from(decoded.ringCoordinates),mixed.coordinates.flat(3));
  assert.deepEqual(Array.from(decoded.polygonOffsets),[0,2,3]);assert.deepEqual(Array.from(decoded.ringOffsets),[0,5,10,14]);
  const plain={type:'Polygon',coordinates:[[[0,0],[0,2],[2,2],[2,0],[0,0]]]};
  assert.equal(createHash('sha256').update(Buffer.from(encodePolygonMesh(engine.buildPolygonGeometryPacket(plain)))).digest('hex'),'fa3e54a7c21b1c9e2944de7c6e06c74a96ab8e155e6dd6bfbe003888ef565ac1');
});

test('multiple grid-collapsed polygons preserve separate shell and hole roles',()=>{
  const tinyRect={type:'Polygon',coordinates:[[[10,10],[10.00000001,10],[10.00000001,10.0001],[10,10.0001],[10,10]],[[10.000000002,10.00002],[10.000000002,10.00008],[10.000000008,10.00008],[10.000000008,10.00002],[10.000000002,10.00002]]]};
  const multi={type:'MultiPolygon',coordinates:[tinyRect.coordinates,gridThin.coordinates]};
  const packet=engine.buildPolygonGeometryPacket(multi),decoded=decodePolygonMesh(encodePolygonMesh(packet),{algorithmVersion:6});
  assert.equal(decoded.rasterState,'grid-collapsed');assert.equal(decoded.segmentCount,0);
  assert.deepEqual(Array.from(decoded.ringCoordinates),multi.coordinates.flat(3));
  assert.deepEqual(Array.from(decoded.ringOffsets),[0,5,10,14]);assert.deepEqual(Array.from(decoded.polygonOffsets),[0,2,3]);
});


test('reader rejects exact-zero and self-intersecting originals even if their render grid is collinear',()=>{
  const fake = rings => {
    const points=rings.flat(),coordinates=points.flat(),ends=[0];for(const ring of rings)ends.push(ends.at(-1)+ring.length);
    return {algorithmVersion:6,maxEdgeDegrees:0,positions:Float32Array.from(coordinates.map(x=>Math.round(x*1e6)*1e-6)),indices:new Uint32Array(),boundaryIndices:new Uint32Array(),featureIds:new Uint32Array(points.length),ringCoordinates:Float64Array.from(coordinates),ringOffsets:Uint32Array.from(ends),polygonOffsets:new Uint32Array([0,rings.length])};
  };
  const shell=[[10,10],[10.00000001,10],[10.00000001,10.0001],[10,10.0001],[10,10]];
  for(const rings of [
    [[[0,0],[1,1],[2,2],[0,0]]],
    [[[10,10],[10.00000001,10.0001],[10.00000001,10],[10,10.0001],[10,10]]],
  ])assert.throws(()=>decodePolygonMesh(encodePolygonMesh(fake(rings)),{algorithmVersion:6}),/Invalid prepared polygon mesh/);
  // Ring admission does not certify shell/hole subtraction. The native producer
  // remains responsible for a nonempty full-polygon triangulation.
  assert.throws(()=>engine.buildPolygonGeometryPacket({type:'Polygon',coordinates:[shell,[...shell].reverse()]}),e=>e.code==='PL-MESH-TRIANGULATION');
});

test('no-raster source admission fails closed without the canonical exact predicate',()=>{
  const encoded=encodePolygonMesh(engine.buildPolygonGeometryPacket(gridThin)),ordinary=encodePolygonMesh(engine.buildPolygonGeometryPacket(geometry));
  const core=globalThis.PandoLabSphericalCore;
  try{globalThis.PandoLabSphericalCore=null;assert.throws(()=>decodePolygonMesh(encoded,{algorithmVersion:6}),/uncertified empty/);assert.ok(decodePolygonMesh(ordinary,{algorithmVersion:6}).triangleCount);}
  finally{globalThis.PandoLabSphericalCore=core;}
});
