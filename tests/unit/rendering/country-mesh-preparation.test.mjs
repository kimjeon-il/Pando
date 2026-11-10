import "../../helpers/spherical-core.mjs";
import "../../../src/rendering/workers/gpu-mesh-core.js";
import { describe as contractSuite } from 'node:test';
import * as __dep0 from "node:test";
import * as __dep1 from "node:assert/strict";
import * as __dep2 from "../../../src/rendering/country-mesh-preparation.js";
import * as __dep3 from "../../../src/rendering/mesh-spatial-blocks.js";


import * as __dep6 from "../../../src/rendering/country-mesh-codec.js";
import * as __dep7 from "../../../src/rendering/country-mesh-content-key.js";
import * as __dep8 from "../../../src/rendering/resource-update-policy.js";
import * as __dep9 from "../../../src/geometry/geometry-version-store.js";
import * as __dep10 from "../../../src/rendering/country-mesh-quality-gate.js";
import * as __dep11 from "../../../src/rendering/country-mesh-transfer.js";
import * as __dep12 from "../../../src/rendering/country-mesh-zoom-policy.js";
import * as __dep13 from "../../../src/rendering/gpu-map-renderer.js";

// Original feature contract: country-mesh-preparation.test.mjs
contractSuite("country-mesh-preparation", () => {
const test = __dep0.default;
const assert = __dep1.default;
const { createCountryMeshPreparation } = __dep2;
const { prepareMeshSpatialBlocks, visibleSpatialBlockRanges, coalesceSpatialBlockRanges } = __dep3;
const engine = globalThis.PandoLabGpuMeshCore;
const shape = (id, size = 2) => ({ id, geometry: { type: 'Polygon', coordinates: [[[0,0],[size,0],[size,2],[0,2],[0,0]]] } });
const context = { throwIfCancelled() {} };
test('prepared country parts keep exact engine output and reuse only unchanged shapes', async () => {
  const store = createCountryMeshPreparation({ engine });
  const features = [shape('A'), shape('B', 3)];
  const first = await store.build(features, context);
  const expected = engine.buildGpuMeshFeatures(features);
  for (const [key, value] of Object.entries(expected)) {
    if (ArrayBuffer.isView(value)) assert.deepEqual(first[key], value, key);
  }
  assert.deepEqual(first.strokeOwnerRanges, expected.strokeOwnerRanges);
  const copied = structuredClone(first, { transfer: [first.positions.buffer] });
  assert.equal(first.positions.byteLength, 0);
  const second = await store.build([shape('renamed', 3), shape('A')], context);
  assert.equal(second.preparation.builtCount, 0); assert.equal(second.preparation.reusedCount, 2);
  assert.deepEqual(second.countryIds, ['renamed', 'A']);
  assert.equal(second.positions.length, copied.positions.length);
  const changed = await store.build([shape('A', 4), shape('B', 3)], context);
  assert.equal(changed.preparation.builtCount, 1); assert.equal(changed.preparation.reusedCount, 1);
});
test('cache budget and cancellation stay bounded between geometry jobs', async () => {
  const tiny = createCountryMeshPreparation({ engine, byteBudget: 1 });
  await tiny.build([shape('A')], context);
  assert.equal((await tiny.build([shape('A')], context)).preparation.builtCount, 1);
  let cancelled = false;
  const store = createCountryMeshPreparation({ engine,
    yieldTask: async () => { cancelled = true; } });
  await assert.rejects(store.build([shape('A')], { throwIfCancelled() { if (cancelled) throw Error('cancelled'); } }), /cancelled/);
});

test('empty country slots retain their ranges and full-world bounds', async () => {
  const store = createCountryMeshPreparation({ engine });
  const features = [{ id: 'empty', geometry: null }, shape('A')];
  const mesh = await store.build(features, context);
  const expected = engine.buildGpuMeshFeatures(features);
  for (const key of ['countryTriangleRanges', 'countryBoundaryRanges', 'countryBounds', 'countryBoundsFlags']) assert.deepEqual(mesh[key], expected[key]);
});


test('spatial BVH packs large country meshes without boxed intermediate arrays or lost primitives', () => {
  const positions = Int32Array.from([0,0, 1000000,0, 0,1000000, 12000000,0, 13000000,0, 12000000,1000000]);
  const triangleCount = 2300;
  const triangleIndices = new Uint32Array(triangleCount * 3);
  for (let i = 0; i < triangleCount; i++) triangleIndices.set(i % 2 ? [3,4,5] : [0,1,2], i * 3);
  const make = () => ({ positions, triangleIndices:triangleIndices.slice(), lineIndices:Uint32Array.from([0,1,1,2,3,4,4,5]),
    countryTriangleRanges:Uint32Array.from([0,triangleIndices.length]), countryBoundaryRanges:Uint32Array.from([0,8]) });
  const first = prepareMeshSpatialBlocks(make()), second = prepareMeshSpatialBlocks(make());
  assert.deepEqual(first.triangleIndices,second.triangleIndices,'partition order remains deterministic');
  assert.deepEqual(first.spatialBlocks,second.spatialBlocks,'tree serialization remains deterministic');
  const tree = first.spatialBlocks.triangle;
  assert.ok(tree.ranges.length > 2,'large geometry must actually partition');
  assert.equal(tree.children.length,tree.ranges.length);
  assert.equal(tree.bounds.length,tree.ranges.length * 3);
  assert.equal(tree.geographicBounds.length,tree.ranges.length * 2);
  assert.equal(first.triangleIndices.length,triangleIndices.length);
  assert.deepEqual([...first.triangleIndices].sort((a,b)=>a-b),[...triangleIndices].sort((a,b)=>a-b));
  const visible = visibleSpatialBlockRanges(first,{mode:0,cssViewport:[1280,800],cssTranslate:[640,400],cssScale:500,
    rowX:[1,0,0],rowY:[0,1,0],rowZ:[0,0,1]},'triangle');
  assert.ok(Array.isArray(visible));
  assert.ok(visible.every(range=>range.count>0&&range.first+range.count<=triangleIndices.length));
});

// Quadratic reference is a test oracle only; production uses the heap.
test('spatial range coalescing retains the exact minimum-gap and earliest-tie semantics', () => {
  const baseline=(input,limit)=>{
    const ranges=input.map(range=>({...range}));
    while(ranges.length>limit){
      let best=0;
      for(let i=1;i<ranges.length-1;i++)if(
        ranges[i+1].first-ranges[i].first-ranges[i].count
        <ranges[best+1].first-ranges[best].first-ranges[best].count)best=i;
      ranges[best].count=ranges[best+1].first+ranges[best+1].count-ranges[best].first;
      ranges.splice(best+1,1);
    }
    return ranges;
  };
  const inputs=[
    Array.from({length:300},(_,i)=>({first:i*5,count:2})),
    Array.from({length:300},(_,i)=>({first:i*9+(i%4===0?2:0),count:3})),
    Array.from({length:300},(_,i)=>({first:i*19+(i%7),count:4})),
  ];
  for(const input of inputs)for(const limit of [1,2,17,96,120,300]){
    const actual=coalesceSpatialBlockRanges(input.map(row=>({...row})),limit);
    assert.deepEqual(actual,baseline(input,limit),`merge mismatch for limit ${limit}`);
  }
});
});

// Original feature contract: country-mesh-codec-runtime.test.mjs
contractSuite("country-mesh-codec-runtime", () => {
const assert = __dep1.default;


const test = __dep0.default;
const { decodeCountryMesh } = __dep6;

const countryCount=258;
function emptyMeshWithRevision(revision) {
  const words=12+countryCount*2+countryCount*2+countryCount*4+countryCount;
  const buffer=new ArrayBuffer(words*4);
  new Uint32Array(buffer,0,12).set([
    0x434d4731,2,countryCount,0,0,0,1,revision,
    countryCount*2,countryCount*2,countryCount*4,countryCount
  ]);
  return buffer;
}
test('the same v2 mesh decoder accepts the current shared fill revision 6',()=>{
  for(const revision of [6]) {
    const mesh=decodeCountryMesh(emptyMeshWithRevision(revision));
    assert.equal(mesh.mesh.countryBoundsFlags.length,countryCount);
    assert.equal(mesh.sourceCoordinateCount,1);
  }
});
test('unknown future algorithm revisions fail closed before buffer interpretation',()=>{
  for(const revision of [0,2,3,4,5,7,255])
    assert.throws(()=>decodeCountryMesh(emptyMeshWithRevision(revision)),/알고리즘 리비전/);
});
});

// Original feature contract: country-mesh-content-key.test.mjs
contractSuite("country-mesh-content-key", () => {
const test = __dep0.default;
const assert = __dep1.default;
const { countryMeshContentKey } = __dep7;
const { resourceUpdate } = __dep8;
const { createGeometryVersionStore } = __dep9;

const square=(x=0)=>({type:'Polygon',coordinates:[[[x,0],[x+2,0],[x+2,2],[x,2],[x,0]]]});
const country=(id,geometry)=>({id,geometry,properties:{color:'#123456',name:id}});
const key=features=>countryMeshContentKey(features);

test('P3-2 a structurally identical new country geometry object reuses one content identity',async()=>{
 const a=[country('A',square()),country('B',square(4))];
 const b=structuredClone(a);
 b[0].properties.color='#ffffff';
 const ka=await key(a),kb=await key(b);
 assert.equal(ka,kb);
 assert.ok(Object.keys(a[0].geometry).length===2);
 assert.notStrictEqual(a[0].geometry,b[0].geometry);
});
test('P3-2 different coordinates, topology, country ID or ordering never share a canonical key',async()=>{
 const original=[country('A',square()),country('B',square(4))],k=await key(original);
 const moved=structuredClone(original);moved[0].geometry.coordinates[0][1][0]+=0.00000001;
 const hole=structuredClone(original);hole[0].geometry.coordinates.push([[0.2,0.2],[1,0.2],[1,1],[0.2,1],[0.2,0.2]]);
 const renamed=structuredClone(original);renamed[0].id='X';
 const swapped=structuredClone(original).reverse();
 for(const changed of [moved,hole,renamed,swapped])assert.notEqual(await key(changed),k);
});
test('P3-2 live mutable geometry changes never reuse an earlier digest',async()=>{
 const rows=[country('A',square())],previous=await key(rows);
 rows[0].geometry.coordinates[0][2][0]+=0.125;
 assert.notEqual(await key(rows),previous);
});
test('P3-2 superseded canonical fingerprint can never be admitted',async()=>{
 const features=[country('A',square()),country('B',square(4))];
 let checks=0;
 const result=await countryMeshContentKey(features,{isCurrent:()=>++checks<2});
 assert.equal(result,null);
});
test('P3-2 GPU context changes still require upload even if prepared geometry matches',async()=>{
 const a=await key([country('A',square())]),ctxA={},ctxB={};
 const previous={source:'country-mesh',content:a,preparation:'mesh-v7',context:[ctxA,1],presentation:'countries'};
 const same={...previous},otherGpu={...previous,context:[ctxB,2]},newPrep={...previous,preparation:'mesh-v8'};
 assert.equal(resourceUpdate(previous,same).prepare,false);
 assert.equal(resourceUpdate(previous,otherGpu).prepare,false);
 assert.equal(resourceUpdate(previous,otherGpu).upload,true);
 assert.equal(resourceUpdate(previous,newPrep).prepare,true);
});

test('verified immutable country geometries reuse their digest while mutable inputs are rechecked',async t=>{
 const store=createGeometryVersionStore([{id:'geom',version:1,geojson:square()}]);
 const immutable=store.get({id:'geom',version:1}),mutable=square(4);
 const subtle=globalThis.crypto.subtle,previous=Object.getOwnPropertyDescriptor(subtle,'digest'),digest=subtle.digest.bind(subtle);let calls=0;
 Object.defineProperty(subtle,'digest',{configurable:true,value:(...args)=>{calls++;return digest(...args);}});
 t.after(()=>{if(previous)Object.defineProperty(subtle,'digest',previous);else delete subtle.digest;});
 const first=await key([country('A',immutable),country('B',mutable)]);
 assert.equal(await key([country('A',immutable),country('B',mutable)]),first);
 assert.equal(calls,3,'only the structurally validated immutable geometry can skip a second hash');
 mutable.coordinates[0][1][0]+=0.125;
 assert.notEqual(await key([country('A',immutable),country('B',mutable)]),first);
 assert.equal(calls,4);
});

test('immutable digest failures are retried and stale requests cannot admit a key',async t=>{
 const store=createGeometryVersionStore([{id:'retry-geometry',version:1,geojson:square(9)}]);
 const immutable=store.get({id:'retry-geometry',version:1}),rows=[country('A',immutable)];
 const subtle=globalThis.crypto.subtle,previous=Object.getOwnPropertyDescriptor(subtle,'digest'),digest=subtle.digest.bind(subtle);let calls=0;
 Object.defineProperty(subtle,'digest',{configurable:true,value:(...args)=>{calls++;return calls===1?Promise.reject(Error('digest failed')):digest(...args);}});
 t.after(()=>{if(previous)Object.defineProperty(subtle,'digest',previous);else delete subtle.digest;});
 await assert.rejects(key(rows),/digest failed/);
 let checks=0;assert.equal(await countryMeshContentKey(rows,{isCurrent:()=>++checks<2}),null);
 assert.equal(typeof await key(rows),'string');assert.equal(calls,2);
});
});

// Original feature contract: country-mesh-quality-gate.test.mjs
contractSuite("country-mesh-quality-gate", () => {
const test = __dep0.default;
const assert = __dep1.default;
const { decideCountryPatchPresentation } = __dep10;

test('preview base queues country patches instead of mixing a canonical override into the frame', () => {
  assert.deepEqual(decideCountryPatchPresentation({ renderer: 'webgl2', canonicalMeshReady: false, ids: ['GRC'] }), {
    mode: 'defer',
    ids: ['GRC'],
  });
});

test('canonical and non-WebGL renderers install country patches immediately', () => {
  assert.deepEqual(decideCountryPatchPresentation({ renderer: 'webgl2', canonicalMeshReady: true, ids: ['GRC'] }), {
    mode: 'install',
    ids: ['GRC'],
  });
  assert.deepEqual(decideCountryPatchPresentation({ renderer: 'canvas', canonicalMeshReady: false, ids: ['GRC'] }), {
    mode: 'install',
    ids: ['GRC'],
  });
});
});

// Original feature contract: country-mesh-transfer.test.mjs
contractSuite("country-mesh-transfer", () => {
const test = __dep0.default;
const assert = __dep1.default;
const { packCountryMeshFeatures, unpackCountryMeshFeatures } = __dep11;

test('presentation transfer preserves doubles, holes, polygon order and IDs without detaching source geometry', async () => {
  const ring = [[0.1234567890123, -5], [2, 1], [4, 2], [0.1234567890123, -5]];
  const features = [{ id: 'A', geometry: { type: 'Polygon', coordinates: [ring, ring.toReversed()] } },
    { id: 'B', geometry: { type: 'MultiPolygon', coordinates: [[ring], [ring.toReversed()]] } }];
  const before = structuredClone(features);
  const packed = await packCountryMeshFeatures(features);
  const received = structuredClone(packed, { transfer: [packed.coordinates.buffer] });
  assert.deepEqual(unpackCountryMeshFeatures(received), before);
  assert.deepEqual(features, before);
});

test('packing yields within a large ring and stops an obsolete request before dispatch', async () => {
  let current = true, yields = 0;
  const features = [{ id: 'A', geometry: { type: 'Polygon', coordinates: [Array.from({ length: 50000 }, (_, n) => [n, n])] } }];
  await assert.rejects(packCountryMeshFeatures(features, { isCurrent: () => current,
    yieldTask: async () => { yields++; current = false; } }), { name: 'AbortError' });
  assert.equal(yields, 1);
});
});

// Original feature contract: country-mesh-zoom-policy.test.mjs
contractSuite("country-mesh-zoom-policy", () => {
const assert = __dep1.default;
const test = __dep0.default;
const surfacePolicy = __dep12;

test('prepared country geometry stays hidden until its background frame is presented', () => {
  const prepared = { cssScale: 700, canonicalReady: true, backgroundPresented: false };
  assert.equal(surfacePolicy.resolveMapSurfacePresentation(prepared).quality, 'pending');
  assert.equal(surfacePolicy.resolveMapSurfacePresentation(prepared).geometryQuality, 'canonical');
  assert.equal(surfacePolicy.resolveMapSurfacePresentation({ ...prepared, backgroundPresented: true }).quality, 'canonical');
});

test('scale, selection and focus cannot activate independent preview geometry', () => {
  for(const cssScale of [100,504,570,642,10000])for(const selected of [false,true]) {
    const pending=surfacePolicy.resolveMapSurfacePresentation({cssScale,selected,focus:selected,canonicalReady:false});
    assert.equal(pending.geometryQuality,'pending');
    assert.equal(surfacePolicy.resolveMapSurfacePresentation({cssScale,selected,canonicalReady:true}).geometryQuality,'canonical');
  }
});

test('one surface decision withholds both country and land preview at high scale while precise data is pending', () => {
  assert.deepEqual(surfacePolicy.resolveMapSurfacePresentation?.({ cssScale: 700,
    canonicalReady: false, previewReady: true, previewVerified: true }),
  { targetQuality: 'canonical', geometryQuality: 'pending', quality: 'pending' });
});

test('a prepared formal surface remains the sole source at low scale', () => {
  assert.deepEqual(surfacePolicy.resolveMapSurfacePresentation?.({ cssScale: 400,
    canonicalReady: true, previewReady: true, previewVerified: true }),
  { targetQuality: 'canonical', geometryQuality: 'canonical', quality: 'canonical' });
  assert.deepEqual(surfacePolicy.resolveMapSurfacePresentation?.({ cssScale: 400,
    canonicalReady: true, previewReady: true, previewVerified: false }),
  { targetQuality: 'canonical', geometryQuality: 'canonical', quality: 'canonical' });
});

test('selection and missing or invalid derivatives cannot silently admit a simplified surface', () => {
  for (const flags of [{ selected: true }, { focus: true }]) {
    assert.deepEqual(surfacePolicy.resolveMapSurfacePresentation?.({ cssScale: 100,
      canonicalReady: false, previewReady: true, previewVerified: true, ...flags }),
    { targetQuality: 'canonical', geometryQuality: 'pending', quality: 'pending' });
  }
  assert.deepEqual(surfacePolicy.resolveMapSurfacePresentation?.({ cssScale: 100,
    canonicalReady: false, previewReady: true, previewVerified: false }),
  { targetQuality: 'canonical', geometryQuality: 'pending', quality: 'pending' });
});
});

// Original feature contract: country-mesh-zoom-runtime.test.mjs
contractSuite("country-mesh-zoom-runtime", () => {
const assert = __dep1.default;
const test = __dep0.default;
const { createGpuMapRenderer } = __dep13;

function fixture(t) {
  const oldWindow = globalThis.window;
  const oldWorker = globalThis.Worker;
  const oldFrame = globalThis.requestAnimationFrame;
  const oldCancel = globalThis.cancelAnimationFrame;
  globalThis.window = { devicePixelRatio: 1 };
  const workers=[];
  globalThis.Worker = class extends EventTarget { constructor(){super();this.sent=[];workers.push(this);} postMessage(message) {this.sent.push(message);} terminate() {} };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  const state = { projection: 'globe', view: { globeZoom: 1, flatZoom: 1 }, physicalSettings: {}, pendingCountryRenderIds: new Set() };
  const retries = [];
  const renderer = createGpuMapRenderer({ state, runtimeAssetUrl: path => new URL(path,'https://test.local/assets/js/'), scheduleGpuFrame: () => {}, scheduleGpuMeshRebuild: (...args) => retries.push(args),
    renderCountryBoundaryFeatures: () => [], countryBoundaryStyleById: () => null,
    mapWorkScheduler: { cancel: () => {} }, isMobile: () => false, rendererUi: { setMapPreparationStatus() {} }, renderViewFrame: () => {} });
  t.after(() => { renderer.dispose(); globalThis.window = oldWindow; globalThis.Worker = oldWorker;
    globalThis.requestAnimationFrame = oldFrame; globalThis.cancelAnimationFrame = oldCancel; });
  return { state, renderer, retries, workers };
}

test('failed boundary preparation exposes a retry through the real rebuild contract', t => {
  const { renderer, retries } = fixture(t);
  renderer.failMapPreparation(new Error('upload failed'));
  assert.equal(renderer.mapReadiness().status, 'error');
  renderer.retryMapPreparation();
  assert.deepEqual(retries, [[0, renderer.getProjectGeneration()]]);
  assert.equal(renderer.mapReadiness().status, 'boundaries');
});

test('camera scale cannot publish an unprepared source mesh', t => {
  const { renderer } = fixture(t);
  renderer.syncCountryMeshQuality({ cssScale: 700 });
  assert.equal(renderer.getRuntimeState().surfacePresentation.quality, 'pending');
  assert.equal(renderer.getRuntimeState().canonicalMeshReady, false);
  renderer.syncCountryMeshQuality({ cssScale: 504 });
  assert.equal(renderer.getRuntimeState().surfacePresentation.quality, 'pending');
});

test('unchanged country geometry skips complete preparation across a project generation', async t => {
  const { renderer } = fixture(t);
  await renderer.rebuildFromCountries([]);
  const before = renderer.getStats().countryMeshReuseCount || 0;
  renderer.resetProjectRenderState();
  await renderer.rebuildFromCountries([]);
  assert.equal(renderer.getStats().countryMeshReuseCount, before + 1);
});

test('an unchanged boundary request shares the current in-flight preparation', async t => {
  const {renderer,workers}=fixture(t);
  await renderer.rebuildFromCountries([]);
  workers[0].sent.length=0;
  await renderer.rebuildFromCountries([]);
  await renderer.rebuildFromCountries([]);
  assert.equal(workers.length,1);
  assert.equal(workers[0].sent.length,0,'unchanged in-flight topology is not retransferred');
});

test('reusing a completed mesh invalidates an older rebuild delivery token', async t => {
  const {renderer}=fixture(t);
  await renderer.rebuildFromCountries([]);
  const older=renderer.getStats().geometryRenderTaskToken;
  await renderer.rebuildFromCountries([]);
  assert.ok(renderer.getStats().geometryRenderTaskToken>older);
});

test('scale changes retain the admitted formal display source', async t => {
  const { renderer } = fixture(t);
  await renderer.rebuildFromCountries([]);
  renderer.syncCountryMeshQuality({ cssScale: 300 });
  renderer.commitVisualFrame({ frameId: 1 });
  assert.equal(renderer.getRuntimeState().surfacePresentation.geometryQuality, 'canonical');
  renderer.syncCountryMeshQuality({ cssScale: 300 });
  assert.equal(renderer.getRuntimeState().surfacePresentation.geometryQuality, 'canonical', 'uncertified startup mesh is never readmitted');
});

test('project replacement keeps unprepared surfaces pending across projections', async t => {
  const { state, renderer } = fixture(t);
  renderer.syncCountryMeshQuality({ cssScale: 300 });
  renderer.syncCountryMeshQuality({ cssScale: 570 });
  assert.equal(renderer.getRuntimeState().surfacePresentation.quality, 'pending');
  state.projection = 'flat';
  renderer.syncCountryMeshQuality({ cssScale: 570, projection: 'flat' });
  assert.equal(renderer.getRuntimeState().surfacePresentation.quality, 'pending');
  renderer.resetProjectRenderState();
  renderer.syncCountryMeshQuality({ cssScale: 570 });
  assert.equal(renderer.getRuntimeState().surfacePresentation.quality, 'pending');
});
});
