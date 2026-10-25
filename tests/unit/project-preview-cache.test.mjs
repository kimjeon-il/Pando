import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers';

import { createProjectPreviewCache } from "../../apps/editor/frontend/js/modules/project-preview-cache.js";

function previewCache(t, options = {}) {
  const workers = [];
  const warnings = [];
  const waiting=new Map();
  const ready=index=>workers[index] ? Promise.resolve(workers[index]):new Promise(resolve=>waiting.set(index,resolve));
  class FakeWorker {
    messages = [];
    terminated = false;
    constructor() { workers.push(this);options.onWorkerCreated?.(this);waiting.get(workers.length-1)?.(this); }
    postMessage(message) { this.messages.push(message); options.onPostMessage?.(this, message); }
    terminate() { this.terminated = true; }
    reply(result) { this.onmessage({ data: { id: this.messages.at(-1).id, ok: true, result } }); }
  }
  const originalWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: FakeWorker });
  t.after(() => {
    if (originalWorker) Object.defineProperty(globalThis, 'Worker', originalWorker);
    else delete globalThis.Worker;
  });
  const project = {};
  const stored = { geometryKey: 'same-key', baseSourceSha256: 'baseline' };
  const cache = createProjectPreviewCache({
    storage: { readPreview: async () => stored, ...options.storage },
    scheduler: options.scheduler || { cancel() {} },
    getGeometry: options.getGeometry || (() => null),
    getBaseline: () => ({ sourceSha256: 'baseline' }),
    getPreviewSource:options.getPreviewSource || (async project=>({project,territorialViews:[]})),
    onWarning: (message, error) => warnings.push({ message, error }),
  });
  t.after(() => cache.cancel());
  return { cache, project, workers, warnings,ready };
}

function barrier() {
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  return { wait, release };
}

for(const method of ['ensure','schedule'])test('cancelled '+method+' source-query rejection cannot report a warning after preview retirement',async t=>{
  let reject;const requested=barrier(),source=new Promise((_resolve,no)=>{reject=no;});
  const {cache,project,warnings,workers}=previewCache(t,{getPreviewSource:()=>{requested.release();return source;}});
  const pending=cache[method](project);await requested.wait;cache.cancel();reject(new Error('Project domain is disposed.'));
  if(method==='ensure')assert.equal(await pending,false);
  else await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(warnings,[]);assert.equal(workers.length,0);
});

const autoReply = (worker, message) => globalThis.queueMicrotask(() => {
  if (!worker.terminated) worker.reply(message.type === 'key' ? 'same-key'
    : { geometryKey: 'same-key', baseSourceSha256: 'baseline' });
});

async function finishEnsure(worker, pending) {
  worker.reply('same-key');
  for (let i = 0; i < 4; i++) await Promise.resolve();
  assert.equal(worker.messages.at(-1).type, 'validate');
  worker.reply({ valid: true });
  assert.equal(await pending, true);
}

test('a cancelled preview worker error cannot terminate replacement ensure', async t => {
  const { cache, project, workers, warnings,ready } = previewCache(t);
  const first = cache.ensure(project);
  await ready(0);
  const retiredError = workers[0].onerror;
  cache.cancel();
  assert.equal(await first, false);
  const replacement = cache.ensure(project);
  await ready(1);
  retiredError({ message: 'late retired import failure' });
  assert.equal(workers[1].terminated, false);
  assert.equal(workers.length, 2);
  await finishEnsure(workers[1], replacement);
  assert.equal(warnings.length, 0, 'superseded preview preparation is expected cancellation');
  assert.equal(workers[1].terminated, true, 'idle cache workers are released');
});

test('retired preview messages cannot resolve replacement work', async t => {
  const { cache, project, workers,ready } = previewCache(t);
  const first = cache.ensure(project);
  await ready(0);
  const retiredMessage = workers[0].onmessage;
  cache.cancel();
  assert.equal(await first, false);
  const replacement = cache.ensure(project);
  await ready(1);
  const request = workers[1].messages[0];
  retiredMessage({ data: { id: request.id, ok: true, result: 'retired-key' } });
  for (let i = 0; i < 4; i++) await Promise.resolve();
  assert.equal(workers[1].terminated, false);
  assert.equal(workers[1].messages.length, 1);
  await finishEnsure(workers[1], replacement);
});

test('an idle-released preview worker cannot crash its replacement', async t => {
  const { cache, project, workers,ready } = previewCache(t);
  const first = cache.ensure(project);
  await ready(0);
  const retiredError = workers[0].onerror;
  await finishEnsure(workers[0], first);
  assert.equal(workers[0].terminated, true);
  const replacement = cache.ensure(project);
  await ready(1);
  retiredError({ message: 'late idle worker failure' });
  assert.equal(workers[1].terminated, false);
  await finishEnsure(workers[1], replacement);
});

test('active preview worker failures still warn and settle ensure false', async t => {
  const { cache, project, workers, warnings,ready } = previewCache(t);
  const pending = cache.ensure(project);
  await ready(0);
  let prevented = false;
  workers[0].onerror({ message: 'NetworkError: importScripts failed', preventDefault: () => { prevented = true; } });
  assert.equal(await pending, false);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].message, 'Project preview cache unavailable');
  assert.equal(warnings[0].error.message, 'NetworkError: importScripts failed');
  assert.equal(prevented, true);
  assert.equal(workers[0].terminated, true);
});

for (const retirement of ['cancel', 'idle']) {
  test(`preview ${retirement} isolates late native errors before termination`, async t => {
    const { cache, project, workers,ready } = previewCache(t);
    const pending = cache.ensure(project);
    await ready(0);
    const worker = workers[0];
    const capturedMessage = worker.onmessage;
    let handlersAtTermination;
    worker.terminate = () => {
      handlersAtTermination = [worker.onmessage, worker.onerror];
      capturedMessage({ data: { id: worker.messages.at(-1).id, ok: true, result: 'retired result' } });
    };
    if (retirement === 'cancel') {
      cache.cancel();
      assert.equal(await pending, false);
    } else await finishEnsure(worker, pending);
    assert.equal(handlersAtTermination[0], null);
    assert.equal(typeof handlersAtTermination[1], 'function');
    let prevented = false;
    handlersAtTermination[1]({ preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true, 'late native errors remain inside the preview cache boundary');
  });
}

test('async geometry is awaited and previews the same persisted project', async t => {
  const requested = barrier(), geometry = barrier(), writes = [];
  let currentProject;
  const { cache, project, workers } = previewCache(t, {
    onPostMessage: autoReply,
    storage: { readPreview: async () => null, readProject: async () => currentProject,
      writePreview: async value => writes.push(value) },
    getGeometry: async () => { requested.release(); return geometry.wait; },
  });
  currentProject = project;
  const pending = cache.ensure(project);
  await requested.wait;
  assert.deepEqual(workers[0].messages.map(row => row.type), ['key']);
  const entities = [{ id: 'A', geometry: { type: 'Point', coordinates: [1,2] } }];
  geometry.release({ project, entities });
  assert.equal(await pending, true);
  assert.deepEqual(workers[0].messages.find(row => row.type === 'build').entities, entities);
  assert.equal(writes.length, 1);
});

test('cancelled async geometry cannot restart a retired preview worker', async t => {
  const requested = barrier(), geometry = barrier(), writes = [];
  const { cache, project, workers } = previewCache(t, {
    onPostMessage: autoReply,
    storage: { readPreview: async () => null, readProject: async () => project,
      writePreview: async value => writes.push(value) },
    getGeometry: async () => { requested.release(); return geometry.wait; },
  });
  const pending = cache.ensure(project);
  await requested.wait;
  cache.cancel();
  geometry.release({ project, entities: [{ id: 'old' }] });
  assert.equal(await pending, false);
  assert.equal(workers.length, 1);
  assert.deepEqual(workers[0].messages.map(row => row.type), ['key']);
  assert.deepEqual(writes, []);
});

test('late preview read after project cancellation never installs a validation worker', async t => {
  const reading = barrier(), preview = barrier(), created = barrier();
  const { cache, project, workers } = previewCache(t, {
    onWorkerCreated: () => created.release(),
    storage: { readPreview: async () => { reading.release(); return preview.wait; } },
  });
  const pending = cache.restore(project);
  await reading.wait;
  cache.cancel();
  preview.release({ geometryKey: 'old-key', baseSourceSha256: 'baseline' });
  const result = await Promise.race([pending.then(() => 'completed'), created.wait.then(() => 'late-worker')]);
  if (result === 'late-worker') cache.cancel();
  assert.equal(result, 'completed');
  assert.equal(await pending, null);
  assert.equal(workers.length, 0);
});

test('cancelled Core source inspection cannot create a preview Worker or write display data',async t=>{
  const requested=barrier(),source=barrier(),writes=[];
  const {cache,project,workers}=previewCache(t,{getPreviewSource:async()=>{requested.release();return source.wait;},
    storage:{writePreview:async value=>writes.push(value)}});
  const pending=cache.ensure(project);await requested.wait;cache.cancel();
  source.release({project,territorialViews:[]});
  assert.equal(await pending,false);assert.deepEqual(workers,[]);assert.deepEqual(writes,[]);
});


test('startup preview validation reuses the already inspected Core projection',async t=>{
  let inspections=0;
  const {cache,project,workers}=previewCache(t,{
    onPostMessage:autoReply,
    getPreviewSource:async()=>{inspections++;throw new Error('duplicate startup inspection');},
  });
  const prepared={project,territorialViews:[]};
  const restored=await cache.restore(project,prepared);
  assert.equal(restored.geometryKey,'same-key');
  assert.equal(inspections,0);
  assert.deepEqual(workers[0].messages.map(message=>message.type),['validate']);
  assert.equal(workers[0].messages[0].source,prepared);
});

test('persisted preview receipt avoids duplicate Core inspection, export and geometry hashing',async t=>{
  const saved={format:'pandolab-autosave-full',savedAt:'2026-10-16T00:00:00.000Z'};
  const checkpoint={projectGeneration:3,epoch:12,content:7,presentation:4};
  const written=barrier(),writes=[];
  let inspections=0,geometryQueries=0;
  const {cache,workers,warnings}=previewCache(t,{
    onPostMessage:autoReply,
    scheduler:{cancel(){},scheduleIdle(_key,task){task();}},
    storage:{
      readPreview:async()=>null,
      readProject:async()=>structuredClone(saved),
      writePreview:async value=>{writes.push(value);written.release();},
    },
    getPreviewSource:async project=>{inspections++;return {project,territorialViews:[]};},
    getGeometry:async(project,receipt)=>{
      geometryQueries++;
      assert.equal(project,saved);assert.equal(receipt,checkpoint);
      return {project,entities:[{id:'SOV',properties:{entityKind:'general'},geometry:{type:'Point',coordinates:[1,2]}}]};
    },
  });
  cache.schedule(saved,checkpoint);
  await written.wait;
  assert.equal(inspections,1,'the saved project is inspected only once');
  assert.equal(geometryQueries,1,'the accepted read-model is used without re-export');
  assert.equal(writes.length,1);
  assert.deepEqual(workers[0].messages.map(message=>message.type),['key','build']);
  assert.equal(workers[0].messages[1].key,'same-key');
  assert.equal(Object.hasOwn(workers[0].messages[1],'source'),false,'mesh build does not re-clone the source');
  assert.deepEqual(warnings,[]);
});

test('a later persisted project with different content still rejects a stale preview',async t=>{
  const saved={format:'pandolab-autosave-full',savedAt:'2026-10-16T00:00:00.000Z'};
  const newer={...saved,savedAt:'2026-10-16T00:00:01.000Z'};
  const inspected=[];
  let builds=0,writes=0;
  const {cache,workers,ready}=previewCache(t,{
    onPostMessage:(worker,message)=>globalThis.queueMicrotask(()=>{
      if(worker.terminated)return;
      if(message.type==='key')worker.reply(message.source.project.savedAt===saved.savedAt?'same-key':'newer-key');
      else {builds++;worker.reply({geometryKey:'same-key'});}
    }),
    storage:{readPreview:async()=>null,readProject:async()=>newer,writePreview:async()=>{writes++;}},
    getPreviewSource:async project=>{inspected.push(project);return {project,territorialViews:[]};},
    getGeometry:async project=>({project,entities:[{id:'A',properties:{entityKind:'general'},geometry:{type:'Point',coordinates:[0,0]}}]}),
  });
  const result=cache.ensure(saved,0,null,{projectGeneration:1,epoch:1,content:2});
  await ready(0);
  assert.equal(await result,false);
  assert.equal(builds,1);
  assert.equal(writes,0);
  assert.deepEqual(inspected,[saved,newer]);
  assert.deepEqual(workers[0].messages.map(message=>message.type),['key','build','key']);
});
