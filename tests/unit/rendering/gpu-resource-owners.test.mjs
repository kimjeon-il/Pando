import {createTrackedGlBufferPort} from "../../helpers/gpu-buffer-test-port.mjs";
import { describe as contractSuite } from 'node:test';
import * as __contract_dep0 from "node:test";
import * as __contract_dep1 from "node:assert/strict";
import * as __contract_dep2 from "../../../src/rendering/gpu-resource-lifecycle.js";
import * as __contract_dep3 from "../../../src/rendering/gpu-upload-scheduler.js";
import * as __contract_dep4 from "../../../src/rendering/gpu-worker-channels.js";
import * as __contract_dep5 from "../../../src/rendering/gpu-resource-budget.js";
import * as __contract_dep6 from "../../../src/rendering/gpu-map-renderer.js";
import * as __contract_dep7 from "../../../src/rendering/mesh-spatial-blocks.js";
const { describe : featureDescribe } = __contract_dep0;
const __suiteDependency0 = __contract_dep0;
const __suiteDependency1 = __contract_dep1;
const __suiteDependency2 = __contract_dep2;
const __suiteDependency3 = __contract_dep3;
const __suiteDependency4 = __contract_dep4;
const __suiteDependency5 = __contract_dep1;
const __suiteDependency6 = __contract_dep0;
const __suiteDependency7 = __contract_dep5;
const __suiteDependency8 = __contract_dep0;
const __suiteDependency9 = __contract_dep1;
const __suiteDependency10 = __contract_dep6;
const __suiteDependency11 = __contract_dep2;
featureDescribe("gpu-resource-owners", () => {
  const test = __suiteDependency0.default;
  const assert = __suiteDependency1.default;
  const lifecycleModule = __suiteDependency2;
  const {  createGpuUploadScheduler  } = __suiteDependency3;
  const {  createGpuWorkerChannels  } = __suiteDependency4;
test('renderer upload cancellation leaves another scheduler consumer live', async () => {
  assert.equal(typeof lifecycleModule.createGpuUploadScope, 'function');
  const frames = [];
  const scheduler = createGpuUploadScheduler({ requestFrame: fn => (frames.push(fn), frames.length), cancelFrame() {},
    now: () => 0, isHidden: () => false, isInputPending: () => false });
  const scope = lifecycleModule.createGpuUploadScope(scheduler);
  let foreignRan = false;
  const foreign = scheduler.enqueueUpload({ key: 'foreign', step: () => { foreignRan = true; return { done: true }; } });
  const own = scope.enqueueUpload({ key: 'foreign', step: () => assert.fail('cancelled renderer job ran') });
  scope.cancelAll();
  await assert.rejects(own, { name: 'AbortError' });
  frames.shift()();
  await foreign;
  assert.equal(foreignRan, true);
  scheduler.dispose();
});

test('lifecycle releases each GL resource once using the context that allocated it', () => {
  const {gl,deleted:released}=createTrackedGlBufferPort();
  const owner = lifecycleModule.createGpuResourceLifecycle();
  const first = owner.create(gl, 'Buffer');
  const second = owner.create(gl, 'Buffer');
  owner.release(first); owner.release(first); owner.dispose(); owner.dispose();
  assert.deepEqual(released, [first, second]);
});

test('terminated Worker channels close late bitmaps and never dispatch late errors', () => {
  const workers = [];
  class NativeWorker extends EventTarget { constructor() { super();workers.push(this); } postMessage() {} terminate() {} }
  const owner = createGpuWorkerChannels({ WorkerClass: NativeWorker });
  const first = owner.create('https://test.local/worker.js');
  let delivered = 0, closed = 0;
  first.onmessage = first.onerror = () => delivered++;
  first.terminate();
  workers[0].onmessage({ data: { bitmap: { close: () => closed++ } } });
  workers[0].onerror({ message: 'late' });
  assert.equal(delivered, 0); assert.equal(closed, 1);
  owner.dispose();
});

test('P3-4 lease frees a staged base when a later override stage aborts', async () => {
  const {gl,deleted}=createTrackedGlBufferPort();
  const lifecycle = lifecycleModule.createGpuResourceLifecycle();
  const lease = lifecycleModule.createGpuResourceLease(resources => {
    lifecycle.release(resources.positionBuffer);
    lifecycle.release(resources.fillIndexBuffer);
  });
  const base = { positionBuffer: lifecycle.create(gl, 'Buffer'), fillIndexBuffer: lifecycle.create(gl, 'Buffer') };
  await assert.rejects(async () => {
    try {
      lease.own(base);
      throw Object.assign(new Error('Override staging superseded'), { name: 'AbortError' });
    } finally { lease.releaseAll(); }
  }, { name: 'AbortError' });
  lease.releaseAll();
  assert.deepEqual(deleted, [base.positionBuffer, base.fillIndexBuffer]);
  lifecycle.dispose();
  assert.equal(deleted.length, 2);
});

test('P3-4 lease transfers only adopted resources and releases rejected buffers once', () => {
  const {gl,deleted}=createTrackedGlBufferPort();
  const lifecycle = lifecycleModule.createGpuResourceLifecycle();
  const lease = lifecycleModule.createGpuResourceLease(resources => lifecycle.release(resources.positionBuffer));
  const base = { positionBuffer: lifecycle.create(gl, 'Buffer') };
  const override = { positionBuffer: lifecycle.create(gl, 'Buffer') };
  lease.own(base);
  lease.own(override);
  assert.equal(lease.transfer(base), true);
  lease.releaseAll(); lease.releaseAll();
  assert.deepEqual(deleted, [override.positionBuffer]);
  lifecycle.release(base.positionBuffer);
  assert.deepEqual(deleted, [override.positionBuffer, base.positionBuffer]);
  lifecycle.dispose();
  assert.equal(deleted.length, 2);
});

test('P3-4 late GL handles after lifecycle disposal are released by their allocating context', () => {
  const {gl,deleted:freed}=createTrackedGlBufferPort();
  gl.isContextLost=()=>false;
  const lifecycle = lifecycleModule.createGpuResourceLifecycle();
  lifecycle.dispose();
  const lateBuffer = {};
  assert.equal(lifecycle.retain(gl, 'Buffer', lateBuffer), null);
  assert.deepEqual(freed, [lateBuffer]);
});
test('a GPU job cancelled from its own step cannot resolve or requeue itself', async () => {
  const frames=[];
  const scheduler=createGpuUploadScheduler({
    requestFrame:fn=>(frames.push(fn),frames.length),cancelFrame(){},now:()=>0,
    isHidden:()=>false,isInputPending:()=>false,
  });
  const pending=scheduler.enqueueUpload({key:'retired',
    step:()=>{scheduler.cancelKey('retired');return {done:true,bytes:1};}});
  const rejected=assert.rejects(pending,{name:'AbortError'});
  frames.shift()();
  await rejected;
  assert.equal(scheduler.getStats().pending,0);
  assert.equal(scheduler.getStats().completed,0);
  scheduler.dispose();
});

test('upload priority is sorted on admission and not resorted during repeated drain frames', async () => {
  const frames=[],order=[];
  const scheduler=createGpuUploadScheduler({
    requestFrame:cb=>(frames.push(cb),frames.length),cancelFrame(){},
    now:()=>0,isHidden:()=>false,isInputPending:()=>false,
  });
  const push=(key,priority)=>scheduler.enqueueUpload({
    key,priority,step:()=>{order.push(key);return {done:true,bytes:1};},
  });
  const low=push('low',1),high=push('high',5),medium=push('medium',2);
  frames.shift()();
  await Promise.all([low,high,medium]);
  assert.deepEqual(order,['high','medium','low']);
  assert.equal(scheduler.getStats().pending,0);
  scheduler.dispose();
});
});
featureDescribe("gpu-resource-budget", () => {
  const assert = __suiteDependency5.default;
  const test = __suiteDependency6.default;
  const {  createGpuResourceBudget  } = __suiteDependency7;
test('GPU byte budget evicts inactive low-priority LRU resources first', () => {
  const budget = createGpuResourceBudget({ byteBudget: 100 });
  budget.track('old-background', 60, 0);
  budget.track('recent-background', 60, 0);
  budget.touch('recent-background');
  assert.deepEqual(budget.reconcile({ active: ['recent-background'] }), ['old-background']);
  assert.equal(budget.stats().activeBytes, 60);
});

test('active and protected resources are never evicted even under pressure', () => {
  const budget = createGpuResourceBudget({ byteBudget: 50 });
  budget.track('visible', 60, 0);
  budget.track('editing', 70, 100);
  assert.deepEqual(budget.reconcile({ active: ['visible'], protected: ['editing'] }), []);
  assert.equal(budget.stats().overBudgetBytes, 80);
  assert.equal(budget.stats().blockedEvictionCount, 1);
});

test('lowering the budget returns only safe eviction keys', () => {
  const budget = createGpuResourceBudget({ byteBudget: 500 });
  budget.track('visible', 100, 10);
  budget.track('cached-a', 120, 0);
  budget.track('cached-b', 120, 1);
  budget.reconcile({ active: ['visible'] });
  assert.deepEqual(budget.setByteBudget(210), ['cached-a', 'cached-b']);
  assert.equal(budget.stats().activeBytes, 100);
});
});
featureDescribe("gpu-renderer-lifecycle", () => {
  const test = __suiteDependency8.default;
  const assert = __suiteDependency9.default;
  const {  createGpuMapRenderer,physicalSceneMatchesContext  } = __suiteDependency10;
  const {  createGpuResourceLifecycle  } = __suiteDependency11;
test('physical presentation requires the selected land and water revisions, including no water',()=>{
  const polygon=(role,geometryRevision)=>({role,geometryRevision});
  const target={ready:true,landRevision:'historical-land',waterRevision:'historical-water'};
  assert.equal(physicalSceneMatchesContext({polygons:[polygon('physical-land','modern-land')]},target),false);
  assert.equal(physicalSceneMatchesContext({polygons:[polygon('physical-land','historical-land')]},target),false);
  const scene={polygons:[polygon('physical-land','historical-land'),polygon('physical-water','historical-water')]};
  assert.equal(physicalSceneMatchesContext(scene,target),true);
  assert.equal(physicalSceneMatchesContext(scene,{...target,ready:false}),false);
  assert.equal(physicalSceneMatchesContext(scene,{...target,waterRevision:null}),false);
  assert.equal(physicalSceneMatchesContext({polygons:[scene.polygons[0]]},{...target,waterRevision:null}),true);
});

test('disposing an awaited frame settles AbortError and a late callback is inert', async t => {
  let callback;
  globalThis.requestAnimationFrame = fn => { callback = fn; return 1; };
  globalThis.cancelAnimationFrame = () => {};
  t.after(() => { delete globalThis.requestAnimationFrame; delete globalThis.cancelAnimationFrame; });
  const lifecycle = createGpuResourceLifecycle();
  const pending = lifecycle.nextFrame();
  lifecycle.dispose();
  await assert.rejects(pending, { name: 'AbortError' });
  callback(10);
  await assert.rejects(lifecycle.nextFrame(), { name: 'AbortError' });
});

test('renderer disposal is idempotent and prevents deferred initialization', async t => {
  t.mock.method(globalThis, 'setTimeout', () => { throw new Error('disposed renderer scheduled work'); });
  globalThis.Worker = class {};
  t.after(() => { delete globalThis.Worker; });
  let requestedFrames = 0;
  const renderer = createGpuMapRenderer({
    state: {}, runtimeAssetUrl: path => path,
    renderCountryBoundaryFeatures: () => [], countryBoundaryStyleById: () => null,
    scheduleGpuFrame: () => requestedFrames++,
  });
  assert.equal(typeof renderer.dispose, 'function');
  renderer.dispose();
  renderer.dispose();
  assert.equal(await renderer.initialize(), false);
  assert.equal(renderer.getRenderDevice(), null);
  assert.equal(requestedFrames, 0);
});
test('timeline changes release modern preview ownership', t => {
  const previous = globalThis.window; globalThis.window = { devicePixelRatio: 1 };
  t.after(() => { globalThis.window = previous; });
  const state = { projection: 'globe', view: { globeZoom: 1 }, countryVisualPhase: 'preview' };
  state.physicalSettings = {};
  const renderer = createGpuMapRenderer({ state, runtimeAssetUrl: path => path,
    renderCountryBoundaryFeatures: () => [], countryBoundaryStyleById: () => null, scheduleGpuFrame: () => {} });
  assert.equal(typeof renderer.invalidateCountryPreview, 'function');
  renderer.invalidateCountryPreview();
  assert.equal(renderer.getRuntimeState().previewAllowed, false);
  assert.equal(state.countryVisualPhase, 'canonical'); renderer.dispose();
});

test('temporal presentation wait is cancelled by a newer generation and rejects stale requests',async t=>{
  const previous=globalThis.window;globalThis.window={devicePixelRatio:1};
  t.after(()=>{globalThis.window=previous;});
  const renderer=createGpuMapRenderer({state:{physicalSettings:{},pendingCountryRenderIds:new Set()},rendererUi:{},isMobile:()=>false,mapWorkScheduler:{cancel(){}},runtimeAssetUrl:path=>path,
    renderCountryBoundaryFeatures:()=>[],countryBoundaryStyleById:()=>null,scheduleGpuFrame:()=>{}});
  renderer.resetProjectRenderState({generation:1,presentation:'temporal'});
  assert.equal(renderer.canPresentVisualFrame({frameId:1,projectGeneration:1}),false);
  assert.equal(renderer.canPresentVisualFrame({frameId:1,projectGeneration:0},{succeeded:true}),false);
  const pending=renderer.waitForTemporalPresentation();
  renderer.resetProjectRenderState({generation:2});
  await assert.rejects(pending,{name:'AbortError'});
  assert.equal(await renderer.waitForTemporalPresentation(),true);
  renderer.resetProjectRenderState({generation:3,presentation:'temporal',isCurrent:()=>false});
  await assert.rejects(renderer.waitForTemporalPresentation(),{name:'AbortError',cancelled:true});
  renderer.dispose();
});
});
contractSuite("gpu-upload-staging", () => {
const test = __contract_dep0.default;
const assert = __contract_dep1.default;
const { createGpuUploadScheduler } = __contract_dep3;
const { prepareMeshSpatialBlocks, visibleSpatialBlockRanges } = __contract_dep7;

function clock() {
  const frames = []; let time = 0;
  const scheduler = createGpuUploadScheduler({ requestFrame: fn => (frames.push(fn), frames.length), cancelFrame: () => {}, now: () => time, isHidden: () => false, isInputPending: () => false });
  return { scheduler, frames, tick(ms) { time += ms; frames.shift()?.(); }, advance(ms) { time += ms; } };
}
test('upload keys deduplicate and only complete after all chunks', async () => {
  const c = clock(); let chunks = 0;
  const job = { key: 'mesh', step: ({ byteBudget }) => { assert.ok(byteBudget <= 256 * 1024); return { bytes: byteBudget, done: ++chunks === 3 }; } };
  const promise = c.scheduler.enqueueUpload(job);
  assert.equal(c.scheduler.enqueueUpload(job), promise);
  c.tick(16); assert.equal(chunks, 3); await promise;
  assert.equal(c.scheduler.getStats().frames, 1);
  assert.equal(c.scheduler.getStats().completed, 1);
});
test('input holds uploads until 500ms after release', async () => {
  const c = clock(); let calls = 0;
  const done = c.scheduler.enqueueUpload({ key: 'mesh', step: () => ({ done: ++calls > 0 }) });
  c.scheduler.noteInput(true); c.tick(1000); assert.equal(calls, 0);
  c.scheduler.noteInput(false); c.tick(499); assert.equal(calls, 0); c.tick(1); await done; assert.equal(calls, 1);
});
test('input-pending frames advance admitted current terrain while pausing optional GPU uploads', async () => {
  let time=0,pendingInput=true;
  const frames=[],calls=[];
  const scheduler=createGpuUploadScheduler({
    requestFrame:fn=>(frames.push(fn),frames.length),
    cancelFrame:()=>{},now:()=>time,isHidden:()=>false,isInputPending:()=>pendingInput,
  });
  const optional=scheduler.enqueueUpload({key:'hydro',priority:40,step:()=>{calls.push('hydro');return {bytes:128,done:true};}});
  const terrain=scheduler.enqueueUpload({key:'terrain',priority:40,allowDuringInteraction:true,
    step:({byteBudget})=>{assert.ok(byteBudget<=256*1024);calls.push('terrain');return {bytes:128,done:true};}});
  frames.shift()();
  await terrain;
  assert.deepEqual(calls,['terrain'],'pending input must not starve permitted visible terrain');
  assert.equal(scheduler.getStats().pending,1,'deferred hydro remains queued');
  pendingInput=false;time+=499;
  frames.shift()();
  assert.deepEqual(calls,['terrain'],'optional uploads stay paused during the interaction grace');
  time+=1;frames.shift()();await optional;
  assert.deepEqual(calls,['terrain','hydro']);
  assert.equal(scheduler.getStats().pending,0);
  scheduler.dispose();
});

test('shared time budget stops another consumer after an atomic overrun', async () => {
  const c = clock(), seen = [];
  const a = c.scheduler.enqueueUpload({ key: 'terrain', priority: 10, step: () => { seen.push('terrain'); c.advance(3); return { done: true, bytes: 100 }; } });
  const b = c.scheduler.enqueueUpload({ key: 'hydro', step: () => { seen.push('hydro'); return { done: true }; } });
  c.tick(16); assert.deepEqual(seen, ['terrain']); assert.equal(c.scheduler.getStats().overrunCount, 1);
  c.tick(16); await Promise.all([a, b]); assert.deepEqual(seen, ['terrain', 'hydro']);
});
test('generation cancellation disposes staging and rejects rather than committing', async () => {
  const c = clock(); let disposed = false;
  const p = c.scheduler.enqueueUpload({ key: 'mesh', projectGeneration: 7, step: () => assert.fail('stale upload'), dispose: () => { disposed = true; } });
  c.scheduler.cancelGeneration(7); await assert.rejects(p, { name: 'AbortError' }); assert.equal(disposed, true);
});

function mesh() {
  return { positions: new Int32Array([0, 0, 1000000, 0, 0, 1000000, 179000000, 0, 180000000, 0, 179000000, 1000000]), triangleIndices: new Uint32Array([0, 1, 2, 3, 4, 5]), lineIndices: new Uint32Array([0, 1, 3, 4]), countryTriangleRanges: new Uint32Array([0, 3, 3, 3]), countryBoundaryRanges: new Uint32Array([0, 2, 2, 2]) };
}
test('spatial preparation preserves primitive winding, coordinates and country ranges', () => {
  const m = mesh(), before = structuredClone(m); prepareMeshSpatialBlocks(m);
  assert.deepEqual(m.positions, before.positions); assert.deepEqual(m.triangleIndices, before.triangleIndices);
  assert.deepEqual(m.countryTriangleRanges, before.countryTriangleRanges);
  assert.ok(m.spatialBlocks.triangle.bounds instanceof Float64Array);
});
test('spatial blocks reject rear hemisphere while retaining the front geometry', () => {
  const m = prepareMeshSpatialBlocks(mesh());
  const ranges = visibleSpatialBlockRanges(m, { mode: 0, cssViewport: [400, 400], cssTranslate: [200, 200], cssScale: 100, rowX: [0, 1, 0], rowY: [0, 0, -1], rowZ: [1, 0, 0] }, 'triangle', 0);
  assert.deepEqual(ranges, [{ first: 0, count: 3 }]);
});
test('invalid block ranges fall back rather than submitting invalid indices', () => {
  const m = prepareMeshSpatialBlocks(mesh()); m.spatialBlocks.triangle.ranges[1] = 100;
  assert.equal(visibleSpatialBlockRanges(m, { mode: 0 }), null);
});

test('large spatial partitions preserve every oriented primitive and use bounded median selection', () => {
  const count=18000,positions=new Int32Array(count*6),indices=new Uint32Array(count*3);
  for(let i=0;i<count;i++){
    const x=((i*7919)%36000-18000)*10000,y=((i*6271)%16000-8000)*10000;
    positions.set([x,y,x+1000,y,x,y+1000],i*6);indices.set([i*3,i*3+1,i*3+2],i*3);
  }
  const m={positions,triangleIndices:indices,lineIndices:new Uint32Array(),countryTriangleRanges:new Uint32Array([0,indices.length]),countryBoundaryRanges:new Uint32Array([0,0])};
  const original=structuredClone(m);prepareMeshSpatialBlocks(m);
  assert.deepEqual(m.positions,original.positions);
  assert.deepEqual(m.countryTriangleRanges,original.countryTriangleRanges);
  const seen=new Set();
  for(let i=0;i<m.triangleIndices.length;i+=3){const id=m.triangleIndices[i]/3;assert.equal(Number.isInteger(id),true);assert.equal(seen.has(id),false);seen.add(id);assert.deepEqual([...m.triangleIndices.subarray(i,i+3)],[id*3,id*3+1,id*3+2]);}
  assert.equal(seen.size,count);
  assert.ok(m.spatialPreparation?.partitionComparisons>0);
  assert.ok(m.spatialPreparation.partitionComparisons<count*30,'median selection must not fully sort every recursive partition');
  const repeat=structuredClone(original);prepareMeshSpatialBlocks(repeat);assert.deepEqual(repeat.triangleIndices,m.triangleIndices);
});
});
