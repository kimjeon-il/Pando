import assert from 'node:assert/strict';
import test from 'node:test';
import { createDocumentSessionRuntime } from "../../shared/frontend/js/modules/core-document-runtime.js";

const context = () => ({ throwIfCancelled() {} });
function fixture() {
  const calls = [];
  let epoch = 0;
  let month = '2026-10';
  class DocumentSession {
    constructor(ports) { calls.push(['ports', ports]); }
    documentLoad(json, currentMonth) { calls.push(['load', json, currentMonth]); epoch += 1; return { epoch, stateRevision: 0, canUndo: false, canRedo: false,timelineCursor: currentMonth }; }
    documentLoadBaseline(baselineId,setup) { calls.push(['loadBaseline',baselineId,setup]);return { epoch: ++epoch,timelineCursor: setup.initialMonth }; }
    documentTransitionBaseline(baselineId,setup,expectedEpoch) {
      calls.push(['transitionBaseline',baselineId,setup,expectedEpoch]);month=setup.initialMonth;
      return {ok:true,changed:true,state:{epoch:++epoch,timelineCursor:month},
        selection:this.selectionSnapshot(),delta:{objects:[],geometries:[],timelineRecords:null}};
    }
    documentInitialize(payload) { calls.push(['initialize',payload]); return this.documentLoad(JSON.stringify(payload.project),payload.currentMonth); }
    executeCommand(command) { calls.push(['execute', command]); return { ok: true, changed: true, state: { epoch: ++epoch, stateRevision: 1,timelineCursor: month }, delta: { objects: [],timelineRecords: null } }; }
    undo(value) { calls.push(['undo', value]); return { ok: true, changed: true, state: { epoch: ++epoch, stateRevision: 1,timelineCursor: month }, delta: { objects: [],timelineRecords: {} } }; }
    storageSnapshot() { return '{"allDomains":true}'; }
    documentSnapshot() { calls.push(['documentSnapshot']);return { allDomains: true }; }
    storageBaselineLoad(baseline,expectedEpoch) { calls.push(['storageBaselineLoad',baseline,expectedEpoch]);return { epoch: ++epoch,storageBaselineId: 7,timelineCursor: month }; }
    validateImport(storageJson,baselineId) { calls.push(['validateImport',storageJson,baselineId]);return JSON.parse(storageJson); }
    inspectImport(storageJson,baselineId,currentMonth) { calls.push(['inspectImport',storageJson,baselineId,currentMonth]);return {project:JSON.parse(storageJson),world:{month:currentMonth,entities:[]}}; }
    captureReplacement(expectedEpoch) { calls.push(['captureReplacement',expectedEpoch]);return 7; }
    rollbackReplacement(id,expectedEpoch) { calls.push(['rollbackReplacement',id,expectedEpoch]);return { epoch: ++epoch,timelineCursor: month }; }
    releaseReplacement(id) { calls.push(['releaseReplacement',id]);return true; }
    selectionSnapshot() { return { selectionRevision: 0,hoverRevision: 0,items: [],primary: null,hover: null }; }
    draftApply(payload) { calls.push(['draftApply', payload]); return { coords: [[0,0],[1,1]], revision: 2 }; }
    draftSnapshot() { calls.push(['draftSnapshot']); return { coords: [[0,0],[1,1]], revision: 2 }; }
    selectionCatalogLoad(domain,refs,expectedEpoch) { calls.push(['selectionCatalogLoad',domain,refs,expectedEpoch]);
      return {ok:true,changed:false,state:{epoch,timelineCursor:month},selection:this.selectionSnapshot(),delta:null}; }
    resolveWorld(month, expectedEpoch) { calls.push(['resolveWorld', month, expectedEpoch]); return { month, sourceEpoch: expectedEpoch, entities: [] }; }
    setTimelineCursor(nextMonth, expectedEpoch) { calls.push(['setTimelineCursor', nextMonth, expectedEpoch]);month = nextMonth;
      return { state: { epoch: ++epoch, timelineCursor: month }, selection: this.selectionSnapshot(),
        world: { month, sourceEpoch: epoch, entities: [] } }; }
    delete() { calls.push(['delete']); }
  }
  const validateFlagDataUrl = value => { if (typeof value !== 'string') throw new TypeError('invalid string'); };
  return { calls, validateFlagDataUrl, setCurrentMonth: value => { month = value; },
    runtime: createDocumentSessionRuntime({ loadModule: async () => ({ DocumentSession }), validateFlagDataUrl, currentMonth: () => month }) };
}

test('document runtime constructs one complete-project owner and forwards typed command/history without Web mutations', async () => {
  const f = fixture();
  assert.deepEqual(await f.runtime.load({ storageJson: '{"complete":"project"}' }, context()), {
    state: { epoch: 1, stateRevision: 0, canUndo: false, canRedo: false,timelineCursor: '2026-10' },project: { allDomains: true },
    selection: { selectionRevision: 0,hoverRevision: 0,items: [],primary: null,hover: null },
    draft: { coords: [[0,0],[1,1]],revision: 2 },
    world: { month: '2026-10',sourceEpoch: 1,entities: [] },
  });
  const envelope = { commandId: 'territorial.field', expectedEpoch: 1, targets: [{ domain: 'territorial', id: 'A' }], payload: { id: 'A', field: 'name', value: 'Beta' } };
  const command = f.runtime.execute(envelope, context());
  const undo = f.runtime.undo({ expectedEpoch: 2 }, context());
  assert.equal((await command).state.epoch, 2);
  assert.equal((await undo).state.stateRevision, 1);
  assert.equal(await f.runtime.storageSnapshot({}, context()), '{"allDomains":true}');
  assert.equal(f.calls[0][1].validateFlagDataUrl, f.validateFlagDataUrl);
  assert.equal(f.calls.filter(row => row[0] === 'ports').length, 1);
  assert.deepEqual(f.calls.find(row => row[0] === 'execute')[1], envelope);
  assert.deepEqual(f.calls.filter(row => row[0] === 'resolveWorld'),[['resolveWorld','2026-10',1],['resolveWorld','2026-10',3]],
    'Load/history resolve current C++ rows; metadata commits reuse the unchanged accepted timeline.');
  await f.runtime.dispose();
  assert.equal(f.calls.at(-1)[0], 'delete');
});

test('detached import inspection passes the current platform UTC month and retained baseline handle without active load/query',async()=>{
  const f=fixture();f.setCurrentMonth('1914-07');
  assert.deepEqual(await f.runtime.inspectImport({storageJson:'{}',baselineId:7},context()),{project:{},world:{month:'1914-07',entities:[]}});
  assert.deepEqual(f.calls.filter(row=>row[0]==='inspectImport'),[['inspectImport','{}',7,'1914-07']]);
  assert.equal(f.calls.some(row=>row[0]==='load'||row[0]==='resolveWorld'),false);await f.runtime.dispose();
});

test('each document load receives the current platform month instead of reusing a constructor clock', async () => {
  const f = fixture();
  await f.runtime.load({ storageJson: '{}' }, context());
  f.setCurrentMonth('2026-11');
  await f.runtime.load({ storageJson: '{}' }, context());
  assert.deepEqual(f.calls.filter(row => row[0] === 'load'), [['load','{}','2026-10'],['load','{}','2026-11']]);
  assert.equal(f.calls.filter(row => row[0] === 'ports').length, 1);
  await f.runtime.dispose();
});

test('static feature admission goes to the same C++ initializer with a fresh clock and no Web archive allocation', async () => {
  const f=fixture(),payload={ project: { complete: true },features: [{ id: 'A' }],preserveCursor: true,currentMonth: 'stale-caller-month' };
  const result=await f.runtime.initialize(payload,context());
  assert.equal(result.state.epoch,1);assert.equal(result.world.sourceEpoch,1);
  assert.deepEqual(f.calls.find(row => row[0]==='initialize'),['initialize',{ ...payload,currentMonth: '2026-10' }]);
  f.setCurrentMonth('2026-11');await f.runtime.initialize(payload,context());
  assert.equal(f.calls.filter(row => row[0]==='initialize').at(-1)[1].currentMonth,'2026-11');
  assert.equal(f.calls.filter(row => row[0]==='ports').length,1);
  await f.runtime.dispose();
});

test('replacement capsules restore one session through its raw read projection and never a storage reload',async () => {
  const f=fixture();await f.runtime.load({ storageJson: '{}' },context());
  const id=await f.runtime.captureReplacement({ expectedEpoch: 1 },context());
  assert.equal(id,7);
  await f.runtime.execute({ commandId: 'fixture' },context());
  const restored=await f.runtime.rollbackReplacement({ replacementId: id,expectedEpoch: 2 },context());
  assert.equal(restored.state.epoch,3);assert.equal(restored.world.sourceEpoch,3);
  assert.deepEqual(restored.project,{ allDomains: true });
  assert.equal(f.calls.filter(row => row[0]==='load').length,1);
  assert.deepEqual(f.calls.find(row => row[0]==='rollbackReplacement'),['rollbackReplacement',7,2]);
  assert.equal(await f.runtime.releaseReplacement({ replacementId: id },context()),true);
  assert.equal(f.calls.filter(row => row[0]==='ports').length,1);await f.runtime.dispose();
});

test('a required DocumentSession export cannot silently fall back to the timeline-only owner', async () => {
  const runtime = createDocumentSessionRuntime({ loadModule: async () => ({ CoreSession: class {} }), validateFlagDataUrl() {} });
  await assert.rejects(runtime.load({ storageJson: '{}' }, context()), { code: 'PL-CORE-DOCUMENT-ABI' });
});

test('storage baseline bytes and pure import validation use the same session without a JavaScript decoder',async () => {
  const f=fixture();await f.runtime.load({ storageJson: '{}' },context());
  const baseline={ sourceBytes: new Uint8Array([31,139,8]),encoding: 'gzip',compressedBytes: 3,decodedBytes: 17,
    sourceMonth: '2026-10',baseDataset: 'test',fingerprint: 'a'.repeat(64) };
  const receipt=await f.runtime.storageBaselineLoad({ baseline,expectedEpoch: 1 },context());
  assert.deepEqual(receipt,{ state: { epoch: 2,storageBaselineId: 7,timelineCursor: '2026-10' } });
  assert.equal(f.calls.find(row => row[0]==='storageBaselineLoad')[1],baseline);
  assert.deepEqual(await f.runtime.validateImport({ storageJson: '{"validated":true}',baselineId: null },context()),{ validated: true });
  assert.deepEqual(f.calls.find(row => row[0]==='validateImport'),['validateImport','{"validated":true}',null]);
  assert.equal(f.calls.filter(row => row[0]==='documentSnapshot').length,1);
  assert.equal(f.calls.filter(row => row[0]==='ports').length,1);await f.runtime.dispose();
});

test('full baseline load returns its one accepted packet without decoding or loading project JSON again',async () => {
  const f=fixture();await f.runtime.load({ storageJson: '{}' },context());
  const setup={ initialMonth: '2026-11',timelineRange: null,initialMapBounds: null,sourceMode: 'builtin' };
  f.setCurrentMonth('2030-01'); // The accepted setup, not today's clock, owns the requested month.
  const result=await f.runtime.loadBaseline({ baselineId: 7,setup },context());
  assert.equal(result.state.epoch,2);assert.equal(result.world.sourceEpoch,2);assert.equal(result.world.month,'2026-11');
  assert.deepEqual(f.calls.find(row => row[0]==='loadBaseline'),['loadBaseline',7,setup]);
  assert.equal(f.calls.filter(row => row[0]==='load').length,1);await f.runtime.dispose();
});

test('draft ABI dispatch uses the same session and forwards C++ coordinates/actions without a second writable draft', async () => {
  const f = fixture(); await f.runtime.load({ storageJson: '{}' }, context());
  const payload = { action: 'replaceCoordinates', expectedEpoch: 1, coords: [[0,0],[1,1]],
    record: true, selectedVertexIndex: 1, inputPhase: 'refine' };
  assert.deepEqual(await f.runtime.draftApply(payload, context()), { coords: [[0,0],[1,1]], revision: 2 });
  assert.deepEqual(await f.runtime.draftSnapshot({}, context()), { coords: [[0,0],[1,1]], revision: 2 });
  assert.deepEqual(f.calls.find(row => row[0] === 'draftApply')[1], payload);
  assert.equal(f.calls.filter(row => row[0] === 'ports').length, 1);
  await f.runtime.dispose();
});

test('catalog admission carries the explicit project epoch to the shared document owner', async () => {
  const f = fixture(); await f.runtime.load({ storageJson: '{}' }, context());
  const refs = [{ domain: 'hydroBuiltin', type: 'river', id: 'builtin-hydro',sourceIds:['1','2'] }];
  assert.deepEqual(await f.runtime.selectionCatalogLoad({ domain: 'hydroBuiltin',refs,expectedEpoch: 1 },context()),
    {ok:true,changed:false,state:{epoch:1,timelineCursor:'2026-10'},
      selection:{selectionRevision:0,hoverRevision:0,items:[],primary:null,hover:null},delta:null});
  assert.deepEqual(f.calls.find(row => row[0] === 'selectionCatalogLoad'),['selectionCatalogLoad','hydroBuiltin',refs,1]);
  await f.runtime.dispose();
});

test('document world queries carry their operation epoch to C++ before projecting a current view', async () => {
  const f = fixture(); await f.runtime.load({ storageJson: '{}' }, context());
  assert.deepEqual(await f.runtime.resolveWorld({ month: '1914-07', expectedEpoch: 1 }, context()),
    { month: '1914-07', sourceEpoch: 1, entities: [] });
  assert.deepEqual(f.calls.filter(row => row[0] === 'resolveWorld').at(-1), ['resolveWorld','1914-07',1]);
  await f.runtime.dispose();
});

test('cursor transition consumes the one C++ world packet without a follow-up resolve RPC', async () => {
  const f = fixture();
  await f.runtime.load({ storageJson: '{}' }, context());
  const before = f.calls.filter(row => row[0] === 'resolveWorld').length;
  const result = await f.runtime.setTimelineCursor({ month: '1989-06', expectedEpoch: 1 }, context());
  assert.equal(result.state.timelineCursor, '1989-06');
  assert.deepEqual(result.world, { month: '1989-06', sourceEpoch: 2, entities: [] });
  assert.deepEqual(f.calls.filter(row => row[0] === 'setTimelineCursor'), [['setTimelineCursor', '1989-06', 1]]);
  assert.equal(f.calls.filter(row => row[0] === 'resolveWorld').length, before);
  await f.runtime.dispose();
});

test('cursor transition rejects missing, stale or malformed Core world without a second query', async () => {
  for (const world of [
    null,
    { month: '1914-07', sourceEpoch: 1, entities: [] },
    { month: '1914-06', sourceEpoch: 2, entities: [] },
    { month: '1914-07', sourceEpoch: 2, entities: null },
  ]) {
    let secondaryQueries = 0;
    const runtime = createDocumentSessionRuntime({
      loadModule: async () => ({ DocumentSession: class {
        setTimelineCursor() { return { state: { epoch: 2, timelineCursor: '1914-07' }, world }; }
        resolveWorld() { secondaryQueries += 1; return { month: '1914-07', sourceEpoch: 2, entities: [] }; }
        delete() {}
      } }),
      validateFlagDataUrl() {},
    });
    await assert.rejects(runtime.setTimelineCursor({ month: '1914-07', expectedEpoch: 1 }, context()),
      { code: 'PL-CORE-DOCUMENT-ABI' });
    assert.equal(secondaryQueries, 0);
    await runtime.dispose();
  }
});

// Temporal admission must not call documentSnapshot and copy the whole geometry archive.
test('builtin temporal transition publishes a native delta and its current world without a full document snapshot',async()=>{
  const f=fixture();await f.runtime.load({storageJson:'{}'},context());f.calls.length=0;
  const setup={initialMonth:'1951-12',timelineRange:null,initialMapBounds:null,sourceMode:'builtin'};
  const result=await f.runtime.transitionBaseline({baselineId:7,setup,expectedEpoch:1},context());
  assert.equal(result.state.timelineCursor,'1951-12');assert.equal(result.world.month,'1951-12');
  assert.equal(result.world.sourceEpoch,result.state.epoch);assert.deepEqual(result.delta.geometries,[]);
  assert.equal(Object.hasOwn(result,'project'),false);
  assert.deepEqual(f.calls.filter(row=>row[0]==='transitionBaseline'),[['transitionBaseline',7,setup,1]]);
  assert.equal(f.calls.some(row=>row[0]==='documentSnapshot'||row[0]==='loadBaseline'),false);
  await f.runtime.dispose();
});
