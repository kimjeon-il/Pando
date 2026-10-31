import assert from 'node:assert/strict';
import test from 'node:test';
import { createCoreDocumentClient } from "../../shared/frontend/js/modules/core-document-client.js";

function fixture({ onTransition } = {}) {
  const sent = [], effects = [];
  let hold = false, heldReply = null;
  let signalHeldCommand;
  const commandHeld = new Promise(resolve => { signalHeldCommand = resolve; });
  let epoch = 0;
  let timelineCursor = '2026-10';
  const state = () => ({ epoch, revision: epoch, stateRevision: effects.filter(row => row === 'execute').length,
    dirty: effects.length > 0, canUndo: effects.length > 0, canRedo: false, timelineCursor });
  const worker = { terminate() {}, postMessage(message) {
    sent.push(message);
    if (message.type !== 'request') return;
    const reply = () => {
      let result;
      if (message.operation === 'core.document-load') { epoch += 1; result = { state: state(),project: { complete: 'all-domains' },
        selection: { selectionRevision: 0,hoverRevision: 0,items: [],primary: null,hover: null },draft: { active: false } }; }
      else if (message.operation === 'core.document-initialize') {
        assert.equal(message.payload.expectedEpoch,epoch);epoch+=1;result={ state: state(),project: { complete: 'source-admission' } };
      }
      else if (message.operation === 'core.document-load-baseline') {
        assert.equal(message.payload.baselineId,7);assert.equal(message.payload.expectedEpoch,epoch);
        epoch+=1;result={ state: state(),project: { complete: 'retained-source' } };
      }
      else if (message.operation === 'core.document-transition-baseline') {
        assert.equal(message.payload.baselineId,7);assert.equal(message.payload.expectedEpoch,epoch);
        timelineCursor=message.payload.setup.initialMonth;epoch++;
        result={ok:true,changed:true,state:state(),delta:{objects:[],geometries:[],timelineRecords:null}};
      }
      else if (message.operation === 'core.document-replacement-capture') { assert.equal(message.payload.expectedEpoch,epoch);result=7; }
      else if (message.operation === 'core.document-replacement-release') result=true;
      else if (message.operation === 'core.document-replacement-rollback') {
        assert.equal(message.payload.expectedEpoch,epoch);assert.equal(message.payload.replacementId,7);epoch+=1;result={ state: state(),project: { complete: 'restored' } };
      }
      else if (message.operation === 'core.storage-snapshot') result = '{"complete":"all-domains"}';
      else if (message.operation === 'core.document-resolve-world') result = { month: message.payload.month, entities: [] };
      else if (message.operation === 'core.document-state') result = state();
      else if (message.operation === 'core.document-export') result = { storageJson: '{"complete":"all-domains"}', state: state() };
      else if (message.operation === 'core.storage-baseline-load') {
        assert.equal(message.payload.expectedEpoch,epoch);epoch+=1;result={ state: { ...state(),storageBaselineId: 7 } };
      }
      else if (message.operation === 'core.document-validate-import') result=JSON.parse(message.payload.storageJson);
      else if (message.operation === 'core.document-inspect-import') result={project:JSON.parse(message.payload.storageJson),world:{month:'1914-07',entities:[]}};
      else if (message.operation.startsWith('core.document-selection-')) {
        assert.equal(message.payload.expectedEpoch, epoch);
        result = { selectionRevision: 1, hoverRevision: 0, items: [{ domain: 'placeBuiltin', type: 'city', id: 'builtin:place:fixture:1' }],
          primary: { domain: 'placeBuiltin', type: 'city', id: 'builtin:place:fixture:1' }, hover: null };
      }
      else if (message.operation.startsWith('core.document-draft-')) {
        assert.equal(message.payload.expectedEpoch, epoch);
        result = { active: true, shape: 'line', coords: [[0,0],[1,1]], selectedVertexIndex: 1, inputPhase: 'refine',
          insertMode: false, insertTarget: null, dragging: false, historyCount: 1, futureCount: 0, revision: 2 };
      }
      else if (message.operation === 'core.document-mark-saved' && message.payload.expectedEpoch !== epoch) {
        worker.onmessage({ data: { ...message, type: 'result', ok: false, error: { code: 'STALE_REVISION', message: 'Saved snapshot epoch is stale.' } } }); return;
      }
      else if (message.operation === 'core.document-mark-saved') {
        assert.equal(message.payload.expectedEpoch, epoch); epoch += 1; result = state();
      }
      else if (message.operation === 'core.document-timeline-cursor') {
        assert.equal(message.payload.expectedEpoch, epoch); timelineCursor = message.payload.month; epoch += 1;
        result = { state: state(), selection: { selectionRevision: 0, hoverRevision: 0, items: [], primary: null, hover: null } };
      }
      else if (message.operation === 'core.document-execute' && message.payload.expectedEpoch !== epoch) {
        result = { ok: false,changed: false,state: state(),error: { code: 'STALE_REVISION',message: 'Async origin changed.' } };
      }
      else {
        assert.equal(message.payload.expectedEpoch, epoch);
        if (message.operation === 'core.document-execute') effects.push('execute');
        else effects.push('undo');
        epoch += 1;
        result = { ok: true, changed: true, state: state(), delta: { domains: ['territorial','label','hydro','generic','distribution','presentation','provenance'] } };
      }
      worker.onmessage({ data: { ...message, type: 'result', ok: true, result } });
    };
    if (hold && message.operation === 'core.document-execute') { heldReply = reply; signalHeldCommand(); }
    else globalThis.queueMicrotask(reply);
  } };
  return { client: createCoreDocumentClient({ createWorker: () => worker, onTransition }), sent, effects,
    holdCommand() { hold = true; }, releaseCommand() { hold = false; heldReply(); }, commandHeld };
}

test('disposal cancels queued work and a late atomic acknowledgement without publishing unloaded-document errors',async()=>{
  const transitions=[],f=fixture({onTransition:(_result,operation)=>transitions.push(operation)});
  await f.client.load('{}');f.holdCommand();
  const running=f.client.execute({commandId:'territorial.parent'});
  const queued=f.client.selectionCatalogLoad('placeBuiltin',[]);
  const completed=Promise.allSettled([running,queued]);
  await f.commandHeld;f.releaseCommand();f.client.dispose();
  for(const result of await completed){assert.equal(result.status,'rejected');assert.equal(result.reason.name,'AbortError');assert.equal(result.reason.cancelled,true);}
  assert.deepEqual(transitions,['core.document-load']);assert.equal(f.client.state(),null);
  assert.equal(f.sent.filter(row=>row.type==='request').length,2);
  await assert.rejects(f.client.exportSnapshot({}),{code:'PL-CORE-CANCELLED'});
  const active=fixture();await assert.rejects(active.client.exportSnapshot({}),{code:'PL-CORE-NOT-LOADED'});active.client.dispose();
});

test('acknowledgement subscribers publish in registration order and unsubscribe without another owner', async () => {
  const calls=[],f=fixture({ onTransition: (_result,operation) => calls.push(`model:${operation}`) });
  const remove=f.client.subscribeTransitions((_result,operation) => calls.push(`selection:${operation}`));
  await f.client.load('{}');
  remove();
  await f.client.selectionSnapshot();
  assert.deepEqual(calls,['model:core.document-load','selection:core.document-load','model:core.document-selection-snapshot']);
  assert.throws(() => f.client.subscribeTransitions(null),TypeError);
  f.client.dispose();
});

test('detached import inspection never adopts imported root state or publishes an active world transition',async()=>{
  const transitions=[],f=fixture({onTransition:(_result,operation)=>transitions.push(operation)});
  await f.client.load('{}');const before=f.client.state();
  const packet=await f.client.inspectImport('{"state":{"epoch":999},"delta":{"objects":[]}}',{baselineId:7});
  assert.equal(packet.project.state.epoch,999);assert.equal(Object.hasOwn(packet.world,'sourceEpoch'),false);
  assert.equal(f.client.state(),before);assert.deepEqual(transitions,['core.document-load']);
  assert.equal(f.sent.at(-1).payload.baselineId,7);f.client.dispose();
});

test('acknowledgement subscribers receive the original intent identity for publication metadata without reordering dispatch', async () => {
  const f=fixture(),intent={ action: 'replace',ref: { domain: 'label',type: 'city',id: 'L' },scope: 'map' },seen=[];
  await f.client.load('{}');
  const metadata=new WeakMap([[intent,{ reason: 'map-click' }]]);
  f.client.subscribeTransitions((_result,operation,payload) => {
    if (operation==='core.document-selection-apply') seen.push({ payload,reason: metadata.get(payload).reason });
  });
  await f.client.selectionApply(intent);
  assert.equal(seen[0].payload,intent);assert.equal(seen[0].reason,'map-click');
  f.client.dispose();
});

test('document transport orders complete-project mutations and computes epochs at dispatch time', async () => {
  const f = fixture();
  await f.client.load('{"all":"domains"}');
  const first = f.client.execute({ commandId: 'territorial.field', targets: [{ domain: 'territorial', id: 'A' }], payload: { id: 'A', field: 'name', value: 'Beta' } });
  const second = f.client.undo();
  assert.deepEqual((await first).delta.domains, ['territorial','label','hydro','generic','distribution','presentation','provenance']);
  assert.equal((await second).state.stateRevision, 1);
  assert.equal(f.client.state().epoch, 3);
  assert.equal(f.client.state().stateRevision, 1);
  assert.deepEqual(f.sent.filter(row => row.type === 'request').map(row => row.payload.expectedEpoch), [undefined, 1, 2]);
  assert.equal(await f.client.storageSnapshot(), '{"complete":"all-domains"}');
  assert.ok(Object.isFrozen(f.client.state()));
  f.client.dispose();
});

test('selection transport carries captured types and admitted external identities without changing document epochs', async () => {
  const transitions = [], f = fixture({ onTransition: (result, operation) => transitions.push({ result, operation }) });
  await f.client.load('{}');
  const ref = { domain: 'placeBuiltin', type: 'city', id: 'builtin:place:fixture:1' };
  await f.client.selectionCatalogLoad('placeBuiltin',[ref]);
  await f.client.selectionApply({ action: 'replace', ref, scope: 'labels' });
  const snapshot = await f.client.selectionSnapshot();
  assert.deepEqual(snapshot.primary, ref);
  assert.equal(f.client.state().epoch, 1);
  assert.deepEqual(f.sent.filter(row => row.type === 'request').slice(1).map(row => row.payload), [
    { domain: 'placeBuiltin',refs: [ref],expectedEpoch: 1 },{ action: 'replace',ref,scope: 'labels',expectedEpoch: 1 },{ expectedEpoch: 1 },
  ]);
  assert.equal(transitions.at(-1).operation, 'core.document-selection-snapshot');
  f.client.dispose();
});

test('queued selection uses the dispatch epoch and rejects an obsolete project intent before reaching Core', async () => {
  const ref = { domain: 'placeBuiltin', type: 'city', id: 'builtin:place:fixture:1' };
  const intent = { action: 'replace', ref, scope: 'map' };
  const current = fixture();
  await current.client.load('{}');
  current.holdCommand();
  const command = current.client.execute({ commandId: 'territorial.field', targets: [], payload: {} });
  await current.commandHeld;
  const selection = current.client.selectionApply(intent, { isCurrent: () => true });
  current.releaseCommand();
  await command;
  await selection;
  assert.equal(current.sent.find(row => row.operation === 'core.document-selection-apply').payload.expectedEpoch, 2);
  current.client.dispose();

  const obsolete = fixture();
  await obsolete.client.load('{}');
  obsolete.holdCommand();
  const pending = obsolete.client.execute({ commandId: 'territorial.field', targets: [], payload: {} });
  await obsolete.commandHeld;
  let sameProject = true;
  const rejected = obsolete.client.selectionApply(intent, { isCurrent: () => sameProject });
  sameProject = false;
  obsolete.releaseCommand();
  await pending;
  await assert.rejects(rejected, { code: 'PL-CORE-STALE' });
  assert.equal(obsolete.sent.some(row => row.operation === 'core.document-selection-apply'), false);
  obsolete.client.dispose();
});

test('an already dispatched atomic command always reconciles its acknowledgement after an abort', async () => {
  const f = fixture();
  await f.client.load('{}'); f.holdCommand();
  const controller = new globalThis.AbortController();
  const command = f.client.execute({ commandId: 'territorial.field', targets: [], payload: {} }, { signal: controller.signal });
  await f.commandHeld;
  controller.abort(); f.releaseCommand();
  assert.equal((await command).state.epoch, 2);
  assert.equal(f.client.state().epoch, 2);
  assert.equal(f.sent.some(row => row.type === 'cancel'), false);
  f.client.dispose();
});

test('document transport has no mutation path until the complete document is loaded', async () => {
  const f = fixture();
  await assert.rejects(f.client.execute({ commandId: 'territorial.field', targets: [], payload: {} }), { code: 'PL-CORE-NOT-LOADED' });
  assert.deepEqual(f.sent, []);
  f.client.dispose();
});

test('verified source bytes retain typed transport identity and import validation cannot publish a new document state',async () => {
  const f=fixture();await f.client.load('{}');
  const baseline={ sourceBytes: new Uint8Array([31,139,8]),encoding: 'gzip',compressedBytes: 3,decodedBytes: 17,
    sourceMonth: '2026-10',baseDataset: 'test',fingerprint: 'a'.repeat(64) };
  const command=f.client.execute({ commandId: 'fixture',targets: [],payload: {} }),admission=f.client.storageBaselineLoad(baseline);
  await command;assert.equal((await admission).state.storageBaselineId,7);
  const published=[];f.client.subscribeTransitions((_result,operation) => published.push(operation));
  const state=f.client.state(),project=await f.client.validateImport('{"pure":"validated-input","state":{"epoch":999}}');
  assert.deepEqual(project,{ pure: 'validated-input',state: { epoch: 999 } });assert.equal(f.client.state(),state);
  assert.deepEqual(published,[]);
  const request=f.sent.find(row => row.operation==='core.storage-baseline-load');
  assert.equal(request.payload.baseline,baseline);assert.equal(request.payload.baseline.sourceBytes,baseline.sourceBytes);
  assert.equal(request.payload.expectedEpoch,2);assert.deepEqual(f.effects,['execute']);f.client.dispose();
});

test('source initialization and replacement capsules pin epochs at actual dispatch and retain one owner',async () => {
  const f=fixture();await f.client.initialize({ project: {},preserveCursor: true });
  assert.equal(f.client.state().epoch,1);
  const capture=f.client.captureReplacement(),command=f.client.execute({ commandId: 'fixture',targets: [],payload: {} }),
    source=f.client.initialize({ project: {},territorialSource: {},preserveCursor: true });
  assert.equal(await capture,7);await command;await source;
  const restored=await f.client.rollbackReplacement(7);
  assert.equal(restored.state.epoch,4);assert.equal(await f.client.releaseReplacement(7),true);
  assert.deepEqual(f.sent.filter(row => row.type==='request').map(row => row.payload.expectedEpoch),[0,1,1,2,3,4]);
  assert.equal(f.client.state().epoch,4);f.client.dispose();
});

test('cursor and saved-checkpoint acknowledgements share the command epoch and queries retain the same session', async () => {
  const f = fixture();
  await f.client.load('{}');
  const cursor = await f.client.setTimelineCursor('2020-03');
  assert.equal(cursor.state.epoch, 2);
  assert.equal(cursor.state.timelineCursor, '2020-03');
  assert.deepEqual(cursor.selection, { selectionRevision: 0, hoverRevision: 0, items: [], primary: null, hover: null });
  assert.equal((await f.client.markSaved(f.client.state().epoch)).epoch, 3);
  assert.deepEqual(await f.client.resolveWorld('2020-03'), { month: '2020-03', entities: [] });
  assert.equal((await f.client.projectState()).epoch, 3);
  assert.equal(f.client.state().epoch, 3);
  assert.deepEqual(f.sent.filter(row => row.type === 'request').map(row => row.payload.expectedEpoch), [undefined,1,2,3,3]);
  f.client.dispose();
});

test('a late file-save acknowledgement cannot mark a newer document command clean', async () => {
  const f = fixture(); await f.client.load('{}');
  const exported = await f.client.exportSnapshot({ version: 'fixture', savedAt: '2026-10-13T00:00:00.000Z', format: 'pandolab-project-state' });
  assert.equal(exported.state.epoch, 1);
  await f.client.execute({ commandId: 'territorial.field', targets: [], payload: {} });
  await assert.rejects(f.client.markSaved(exported.state.epoch), { code: 'STALE_REVISION' });
  assert.equal(f.client.state().epoch, 2); assert.equal(f.client.state().dirty, true);
  f.client.dispose();
});

test('draft transitions use the existing ordered document owner without advancing document history or epoch', async () => {
  const transitions = [], f = fixture({ onTransition: (result, operation) => transitions.push({ result, operation }) });
  await f.client.load('{}');
  const state = f.client.state();
  const first = f.client.draftApply({ action: 'start', shape: 'line', coords: [[0,0],[1,1]], inputPhase: 'draw' });
  const second = f.client.draftApply({ action: 'undo' });
  await first; await second;
  const draft = await f.client.draftSnapshot();
  assert.equal(draft.historyCount, 1); assert.equal(draft.selectedVertexIndex, 1);
  assert.deepEqual(f.client.state(), state);
  assert.deepEqual(f.effects, []);
  assert.deepEqual(f.sent.filter(row => row.type === 'request').slice(1).map(row => row.payload), [
    { action: 'start', shape: 'line', coords: [[0,0],[1,1]], inputPhase: 'draw', expectedEpoch: 1 },
    { action: 'undo', expectedEpoch: 1 }, { expectedEpoch: 1 },
  ]);
  assert.equal(transitions.at(-1).operation, 'core.document-draft-snapshot');
  f.client.dispose();
});

test('an explicit asynchronous command origin remains stale while an ordinary queued command uses current dispatch epoch', async () => {
  const f = fixture(); await f.client.load('{}'); const origin = f.client.state().epoch;
  const command = { commandId: 'territorial.field',targets: [],payload: {} };
  await f.client.execute(command);
  const rejected = await f.client.execute({ ...command,expectedEpoch: origin });
  assert.equal(rejected.ok,false); assert.equal(rejected.error.code,'STALE_REVISION');
  assert.equal(f.client.state().epoch,2);
  assert.equal((await f.client.execute(command)).state.epoch,3);
  assert.deepEqual(f.sent.filter(row => row.type === 'request').map(row => row.payload.expectedEpoch), [undefined,1,1,2]);
  assert.deepEqual(f.effects,['execute','execute']);
  f.client.dispose();
});

test('a failed accepted read-model publication stops subsequent mutations until an explicit document reload', async () => {
  const error = Object.assign(new Error('Authoritative C++ delta cannot be reconciled'), { code: 'PL-CORE-RESPONSE' });
  const f = fixture({ onTransition: (result, operation) => { if (operation === 'core.document-execute') throw error; } });
  await f.client.load('{}');
  const command = { commandId: 'territorial.field',targets: [],payload: {} };
  await assert.rejects(f.client.execute(command),failure => failure === error);
  assert.equal(f.client.state(),null); const sent = f.sent.length;
  await assert.rejects(f.client.execute(command), { code: 'PL-CORE-NOT-LOADED' });
  assert.equal(f.sent.length,sent);
  await f.client.load('{}'); assert.equal(f.client.state().epoch,3);
  f.client.dispose();
});


test('builtin temporal client operation is epoch-pinned and publishes a delta rather than a whole load',async()=>{
 const transitions=[],f=fixture({onTransition:(result,operation)=>transitions.push({result,operation})});
 await f.client.load('{}');const before=f.client.state().epoch;
 const setup={initialMonth:'1951-12',timelineRange:null,initialMapBounds:null,sourceMode:'builtin'};
 const result=await f.client.transitionBaseline(7,setup);
 assert.equal(f.sent.filter(row=>row.type==='request').at(-1).operation,'core.document-transition-baseline');
 assert.equal(f.sent.filter(row=>row.type==='request').at(-1).payload.expectedEpoch,before);
 assert.equal(f.client.state().timelineCursor,'1951-12');assert.equal(Object.hasOwn(result,'project'),false);
 assert.equal(transitions.at(-1).operation,'core.document-transition-baseline');f.client.dispose();
});
