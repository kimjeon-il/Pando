import {createTrackedGlBufferPort} from "../../helpers/gpu-buffer-test-port.mjs";
import { describe as contractSuite } from 'node:test';
import * as __dep0 from "node:assert/strict";
import * as __dep1 from "node:test";
import * as __dep2 from "../../../src/rendering/gpu-blend-utils.js";
import * as __dep3 from "../../../src/rendering/gpu-shader-utils.js";
import * as __dep4 from "../../../src/rendering/gpu-view-uniforms.js";
import * as __dep5 from "../../../src/rendering/scene-color-cache.js";
import * as __dep8 from "../../helpers/gpu-recovery-source-harness.mjs";
import * as __dep9 from "../../../scripts/lib/renderer-v2-architecture.mjs";
import * as __dep10 from "../../../src/rendering/gpu-hydro-preparation.js";
const assert = __dep0.default;
const test = __dep1.default;
const { applyGpuBlendMode, parseGpuColor, resetGpuNormalBlend } = __dep2;
const { compileGpuShader, linkGpuProgram } = __dep3;
const { GPU_VIEW_UNIFORM_NAMES, setGpuViewUniforms } = __dep4;
const { createSceneColorCache } = __dep5;


function createFakeGl({ compileOk = true, linkOk = true, validateShaderSource = false } = {}) {
  let nextId = 1;
  const calls = [];
  const shaders = new Map();
  const programs = new Map();
  const gl = {
    calls,
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    BLEND: 5,
    SRC_ALPHA: 6,
    ONE_MINUS_SRC_ALPHA: 7,
    ONE: 8,
    DST_COLOR: 9,
    ARRAY_BUFFER: 10,
    STATIC_DRAW: 11,
    createShader(type) {
      const shader = { id: nextId++, type };
      shaders.set(shader, { source: '', compiled: compileOk });
      return shader;
    },
    shaderSource(shader, source) { shaders.get(shader).source = source; calls.push(['shaderSource', shader.type, source]); },
    compileShader(shader) {
      const entry = shaders.get(shader);
      if (validateShaderSource) {
        let depth = 0;
        entry.compiled = entry.compiled && [...entry.source].every(character => {
          if (character === '{') depth += 1;
          if (character === '}') depth -= 1;
          return depth >= 0;
        }) && depth === 0;
      }
      calls.push(['compileShader', shader.type]);
    },
    getShaderParameter(shader) { return shaders.get(shader).compiled; },
    getShaderInfoLog() { return 'compile failed'; },
    deleteShader(shader) { calls.push(['deleteShader', shader?.type]); shaders.delete(shader); },
    createProgram() {
      const program = { id: nextId++ };
      programs.set(program, { linked: linkOk });
      return program;
    },
    attachShader(program, shader) { calls.push(['attachShader', program.id, shader.type]); },
    linkProgram(program) { calls.push(['linkProgram', program.id]); },
    getProgramParameter(program) { return programs.get(program).linked; },
    getProgramInfoLog() { return 'link failed'; },
    deleteProgram(program) { calls.push(['deleteProgram', program?.id]); programs.delete(program); },
    getAttribLocation() { return 0; },
    getUniformLocation(_program, name) { return name; },
    createBuffer() { return { id: nextId++ }; },
    bindBuffer(...args) { calls.push(['bindBuffer', ...args]); },
    bufferData(...args) { calls.push(['bufferData', ...args]); },
    deleteBuffer(buffer) { calls.push(['deleteBuffer', buffer?.id]); },
    isContextLost() { return false; },
    enable(cap) { calls.push(['enable', cap]); },
    blendFuncSeparate(...args) { calls.push(['blendFuncSeparate', ...args]); },
    uniform2f(...args) { calls.push(['uniform2f', ...args]); },
    uniform1f(...args) { calls.push(['uniform1f', ...args]); },
    uniform3fv(...args) { calls.push(['uniform3fv', ...args]); },
    uniform1i(...args) { calls.push(['uniform1i', ...args]); },
  };
  return gl;
}

test('GPU shader helper compiles, links, and cleans temporary shaders', () => {
  const gl = createFakeGl();
  const program = linkGpuProgram(gl, 'vertex', 'fragment', { label: 'test' });
  assert.ok(program);
  assert.equal(gl.calls.filter(([name]) => name === 'deleteShader').length, 2);
  assert.equal(gl.calls.filter(([name]) => name === 'deleteProgram').length, 0);
});

test('GPU shader helper deletes failed shaders and programs', () => {
  const compileGl = createFakeGl({ compileOk: false });
  assert.throws(() => compileGpuShader(compileGl, compileGl.VERTEX_SHADER, 'bad'), /compile failed/);
  assert.equal(compileGl.calls.filter(([name]) => name === 'deleteShader').length, 1);

  const linkGl = createFakeGl({ linkOk: false });
  assert.throws(() => linkGpuProgram(linkGl, 'vertex', 'fragment'), /link failed/);
  assert.equal(linkGl.calls.filter(([name]) => name === 'deleteShader').length, 2);
  assert.equal(linkGl.calls.filter(([name]) => name === 'deleteProgram').length, 1);
});

test('SceneColorCache shaders initialize with balanced WebGL sources', () => {
  for (const version of [1, 2]) {
    const gl = createFakeGl({ validateShaderSource: true });
    const cache = createSceneColorCache();
    assert.equal(cache.initialize({ gl, version, capabilities: { stencil: false } }), true);
    assert.equal(cache.stats().disabled, false);
    cache.dispose();
  }
});

test('SceneColorCache retains its previous active target when candidate publication fails', () => {
  const gl = createFakeGl();
  for (const method of ['bindFramebuffer','viewport','texParameteri','texImage2D','framebufferTexture2D',
    'bindTexture','bindRenderbuffer','deleteTexture','deleteFramebuffer','disable','colorMask','clearColor','clear',
    'useProgram','enableVertexAttribArray','vertexAttribPointer','activeTexture','disableVertexAttribArray']) {
    gl[method] = (...args) => gl.calls.push([method,...args]);
  }
  let texture = 0, fail = false;
  gl.createTexture = () => ({texture:++texture});
  gl.createFramebuffer = () => ({});
  gl.FRAMEBUFFER_COMPLETE = 100;
  gl.checkFramebufferStatus = () => gl.FRAMEBUFFER_COMPLETE;
  gl.drawArrays = () => {if(fail){fail=false;throw new Error('controlled composite failure');}};
  const cache = createSceneColorCache();
  cache.initialize({gl,version:2,capabilities:{stencil:false}});
  assert.equal(cache.beginScene(100,80,'old',1),true);
  assert.equal(cache.presentScene(100,80,'old',1),true);
  cache.invalidate('new-date');
  assert.equal(cache.beginScene(100,80,'new',2),true);
  fail = true;
  assert.equal(cache.presentScene(100,80,'new',2),false);
  assert.equal(cache.hasActiveFor('old',1),true);
  assert.equal(cache.hasActiveFor('new',2),false);
  assert.equal(cache.stats().dirty,true);
  assert.equal(cache.beginScene(100,80,'retry',3),true);
  assert.equal(cache.presentScene(100,80,'retry',3),true);
  assert.equal(cache.hasActiveFor('retry',3),true);
  cache.dispose();
});

test('GPU blend helper preserves normal and multiply contracts', () => {
  assert.deepEqual(parseGpuColor('#336699'), [0x33 / 255, 0x66 / 255, 0x99 / 255]);
  assert.deepEqual(parseGpuColor('invalid'), [0, 0, 0]);
  const gl = createFakeGl();
  applyGpuBlendMode(gl, 'normal');
  applyGpuBlendMode(gl, 'multiply');
  resetGpuNormalBlend(gl);
  assert.deepEqual(gl.calls.filter(([name]) => name === 'blendFuncSeparate').map(([, ...args]) => args), [
    [gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA],
    [gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA],
    [gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA],
  ]);
});

test('GPU view helper writes the shared uniforms in stable order', () => {
  const gl = createFakeGl();
  const frameContext = {
    viewport: [100, 200],
    translate: [10, 20],
    scale: 3,
    rowX: [1, 0, 0],
    rowY: [0, 1, 0],
    rowZ: [0, 0, 1],
    flatCenter: [0.1, 0.2],
    mode: 1,
  };
  const locations = new Map(GPU_VIEW_UNIFORM_NAMES.map(name => [name, name]));
  assert.equal(setGpuViewUniforms(gl, { frameContext, worldOffset: 2, getLocation: name => locations.get(name) }), true);
  assert.deepEqual(gl.calls.filter(([name]) => name.startsWith('uniform')).map(([name, location, ...values]) => [name, location, ...values]), [
    ['uniform2f', 'uViewport', 100, 200],
    ['uniform2f', 'uTranslate', 10, 20],
    ['uniform1f', 'uScale', 3],
    ['uniform3fv', 'uRowX', [1, 0, 0]],
    ['uniform3fv', 'uRowY', [0, 1, 0]],
    ['uniform3fv', 'uRowZ', [0, 0, 1]],
    ['uniform2f', 'uFlatCenter', 0.1, 0.2],
    ['uniform1f', 'uWorldOffset', 2],
    ['uniform1i', 'uMode', 1],
  ]);
});
contractSuite("gpu-shared-pass-initialization", () => {
const assert = __dep0.default;
const test = __dep1.default;
const { fixture } = __dep8;
const { auditSharedGpuPassInitialization } = __dep9;

// The renderer's structural boundary is checked by check-renderer-v2.
test('shared initialization architecture rejects another device, copied resources, unawaited calls and ignored failures',()=>{
  const polygon="if (await enqueue('polygon', () => polygonOverlayPass.initialize(entry.device)) !== true) throw Error('polygon');";
  const stroke="if (await strokeRenderer.initializeProgressively(entry.device, enqueue) !== true) throw Error('stroke');";
  const selection="if (entry.selection && await enqueue('selection', () => entry.selection.initialize(entry.device, { strokeRenderer, polygonPass: polygonOverlayPass })) !== true) throw Error('selection');";
  const source=`function initializeSharedGpuPasses() {
    const entry = { device: renderDevice, selection: selectionPass };
    const initialize = async () => { ${polygon} ${stroke} ${selection} };
  }`;
  assert.deepEqual(auditSharedGpuPassInitialization(source),[]);
  assert.deepEqual(auditSharedGpuPassInitialization(source.replace(/throw Error\('([^']+)'\);/g,"{ throw Error('$1'); }")),[]);
  const changed=[
    source.replace('device: renderDevice','device: anotherDevice'),
    source.replace('selection: selectionPass','selection: anotherSelection'),
    source.replace('{ strokeRenderer, polygonPass:', '{ strokeRenderer: copiedStrokeRenderer, polygonPass:'),
    source.replace('polygonPass: polygonOverlayPass','polygonPass: copiedPolygonPass'),
    source.replace('entry.selection.initialize(', 'entry.selection.initialize?.('),
    source.replace("await enqueue('selection'", "enqueue('selection'"),
    source.replace(selection,selection.replace('!== true','=== false')),
    source.replace("throw Error('selection')","return false"),
    source.replace(`${polygon} ${stroke} ${selection}`,`${selection} ${polygon} ${stroke}`),
  ];
  for(const mutation of changed){
    assert.notEqual(mutation,source,'Each negative case must change the contract.');
    assert.notDeepEqual(auditSharedGpuPassInitialization(mutation),[]);
  }
});

test('scheduled polygon, stroke and selection passes share the exact GPU device and resource owners',async t=>{
  const f=await fixture({shared:true}),calls=[],device=f.c.renderDevice;
  t.after(f.stop);
  f.c.polygonOverlayPass.initialize=value=>{calls.push('polygon');assert.strictEqual(value,device);return true;};
  f.c.strokeRenderer.initializeProgressively=async(value,enqueue)=>{
    calls.push('stroke');assert.strictEqual(value,device);return enqueue('stroke-body',()=>true);
  };
  f.c.selectionPass.initialize=(value,resources)=>{
    calls.push('selection');assert.strictEqual(value,device);
    assert.strictEqual(resources.strokeRenderer,f.c.strokeRenderer);
    assert.strictEqual(resources.polygonPass,f.c.polygonOverlayPass);return true;
  };
  f.c.initializeSharedGpuPasses();await f.flush();
  assert.deepEqual(calls,['polygon','stroke','selection']);
  assert.equal(f.c.sharedGpuPassesReady(),true);
  assert.deepEqual(f.events.filter(row=>['fallback','error'].includes(row[0])),[]);
});

// Exercise the canonical initializer through the actual scheduler. Unlike the
// earlier copied closure fixture, cancellation uses the renderer's reset/loss paths.
test('project replacement before shader compilation restarts preparation for the current project',async()=>{
  const f=await fixture({shared:true});
  f.c.initializeSharedGpuPasses();f.c.resetProjectRenderState({generation:8});await f.flush();
  assert.equal(f.events.filter(row=>row[0]==='stroke').length,1);
  assert.equal(f.c.sharedGpuPassesReady(),true);
  assert.equal(f.events.filter(row=>row[0]==='fallback').length,0);
});
for(const pass of ['polygon','stroke','selection'])test(`required ${pass} initialization false switches to Canvas with diagnostics`,async t=>{
  const f=await fixture({shared:true});
  t.after(f.stop);
  if(pass==='polygon')f.c.polygonOverlayPass.initialize=()=>false;
  else if(pass==='stroke')f.c.strokeRenderer.initializeProgressively=async()=>false;
  else f.c.selectionPass.initialize=()=>false;
  f.c.initializeSharedGpuPasses();await f.flush();
  const failures=f.events.filter(row=>row[0]==='fallback'),diagnostics=f.events.filter(row=>row[0]==='error');
  assert.equal(failures.length,1);assert.match(failures[0][1],new RegExp(pass));assert.equal(diagnostics.length,1);
});
test('required pass initialization exception is contained by the renderer boundary',async()=>{
  const original=new Error('shader link failed'),f=await fixture({shared:true});
  f.c.polygonOverlayPass.initialize=()=>{throw original;};f.c.initializeSharedGpuPasses();await f.flush();
  assert.deepEqual(f.events.filter(row=>row[0]==='fallback').map(row=>row[1]),['shader link failed']);
  assert.equal(f.events.filter(row=>row[0]==='error').length,1);
});
for(const replace of ['replaceProject','replaceContext','dispose'])test(`cancelled initialization after ${replace} cannot switch the current renderer`,async()=>{
  const f=await fixture({shared:true,holdStroke:true});f.c.initializeSharedGpuPasses();await f.flush();
  if(replace==='replaceProject')f.c.resetProjectRenderState({generation:8});
  else if(replace==='replaceContext')f.loss();else f.stop();
  f.rejectStroke(new Error('old shader failed'));
  // Retired continuation must settle without requiring a new animation frame.
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.events.filter(row=>row[0]==='fallback').length,0);
  assert.equal(f.events.filter(row=>row[0]==='error').length,0);
  f.stop();
});
});
contractSuite("gpu-hydro-preparation", () => {
const test = __dep1.default;
const assert = __dep0.default;
const { createGpuHydroPreparation } = __dep10;

function fixture(t) {
  globalThis.Worker = class {};
  t.after(() => { delete globalThis.Worker; });
  const workers = [], messages = [], phases = [], registrations = [], errors = [];
  const owner = createGpuHydroPreparation({
    createWorker: () => { const worker = { postMessage: message => messages.push(message), terminate() { this.terminated = true; } }; workers.push(worker); return worker; },
    getMode: () => 'webgl2', getView: () => ({ projection: 'flat', threshold: 1, width: 100, height: 100, scale: 100, flatCenter: [0, 0] }),
    getCacheBudget: () => 8 * 1024 * 1024, getProtectedPackIds: () => [], isMobile: () => false, DATA_REVISION: 'data', ASSET_REVISION: 'asset',
    registerHydroPack: entry => registrations.push(['register', entry]),
    unregisterHydroPack: entry => registrations.push(['unregister', entry]),
    queueHydroRender() {}, reportOperationError: error => errors.push(error), setActionStatus() {}, onReset() {}, onConnect() {}, onLoadState: phase => phases.push(phase),
  });
  t.after(() => owner.dispose());
  const manifest = { stages: [{ id: 0, minZoom: 0, columns: 1, rows: 1 }], index: { sha256: '123456789012345' } };
  return { owner, workers, messages, phases, registrations, manifest, errors };
}

function fakeTimers(t) {
  const timers = new Map();
  let next = 0;
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => {
    const id = ++next; timers.set(id, { callback, delay }); return id;
  });
  t.mock.method(globalThis, 'clearTimeout', id => timers.delete(id));
  return timers;
}

test('retiring a replaced pack unregisters it before cancelling upload and releasing its buffers', async t => {
  const { owner, workers, manifest, registrations } = fixture(t);
  const jobs = new Map();
  const {gl,deleted}=createTrackedGlBufferPort({withUploads:true});
  const scheduler = {
    enqueueUpload: job => { jobs.set(job.key, job); return new Promise(() => {}); },
    cancelKey: key => {
      assert.equal(registrations.at(-1)[0], 'unregister');
      const job = jobs.get(key); jobs.delete(key); job?.dispose();
    },
  };
  
  owner.setContext({ gl, version: 2, projectGeneration: 1, contextGeneration: 1, scheduler });
  const ready = owner.setManifest(manifest, 'https://example.test/hydro/index.json');
  workers[0].onmessage({ data: { type: 'ready' } }); await ready;
  const send = () => workers[0].onmessage({ data: { type: 'pack', revision: 1, packId: 7,
    mesh: { riverStarts: new Int32Array([1, 2, 3, 4]) } } });
  send();
  const old = owner.pack(7);
  const oldJob = [...jobs.values()][0];
  oldJob.step({ byteBudget: 8 });
  const replaced=owner.setManifest({...manifest,index:{sha256:'replacement-source'}},'https://example.test/hydro/index.json');
  workers[1].onmessage({data:{type:'ready'}});await replaced;
  workers[1].onmessage({data:{type:'pack',revision:2,packId:7,mesh:{riverStarts:new Int32Array([1,2,3,4])}}});
  assert.equal(deleted.length, 1);
  assert.equal(old.uploadState, null);
  assert.equal(jobs.size, 1);
  assert.throws(() => oldJob.step({ byteBudget: 8 }), { name: 'AbortError' });
});

for (const operation of ['feature', 'query']) {
  test(`${operation} RPC timeout retires the entire Worker and ignores late replies`, async t => {
    const timers = fakeTimers(t);
    const { owner, workers, manifest } = fixture(t);
    const ready = owner.setManifest(manifest, 'https://example.test/hydro/index.json');
    workers[0].onmessage({ data: { type: 'ready' } }); await ready;
    const feature = owner.loadFeature(12).catch(error => error);
    const query = owner.queryFeatures([0, 0, 1, 1]).catch(error => error);
    assert.equal(timers.size, 2);
    const timeout = [...timers.values()][operation === 'feature' ? 0 : 1];
    assert.equal(timeout.delay, 30000);
    timeout.callback();
    const failure = await feature;
    assert.equal(failure.name, 'TimeoutError');
    assert.equal(failure.requestType, operation === 'feature' ? 'load-feature' : 'query-logical-features');
    assert.strictEqual(await query, failure);
    assert.equal(owner.hasWorker(), false);
    assert.equal(workers[0].terminated, true);
    assert.equal(owner.stats().hydroFeaturePendingCount, 0);
    assert.equal(owner.stats().hydroLogicalQueryPendingCount, 0);
    assert.equal(timers.size, 0);
    workers[0].onmessage({ data: { type: 'logical-features', requestId: 2, logicalFids: [9] } });
    workers[0].onmessage({ data: { type: 'ready' } });
    assert.equal(owner.hasWorker(), false);
  });
}

test('hydro owner owns readiness, restart RPC settlement, stale delivery and request payloads', async t => {
  const { owner, workers, messages, manifest } = fixture(t);
  const ready = owner.setManifest(manifest, 'https://example.test/hydro/index.json');
  assert.deepEqual(messages[0], { type: 'init', manifest, baseUrl: 'https://example.test/hydro/', assetRevision: 'data-123456789012', dataRevision: 'data', includeGeometry: false });
  workers[0].onmessage({ data: { type: 'ready' } });
  assert.equal(await ready, true);
  assert.equal(messages[1].type, 'view');
  const pending = owner.loadFeature(12);
  const rejected = assert.rejects(pending, /다시 시작/);
  const restart = owner.setManifest({ ...manifest, index: { sha256: 'changed-source' } }, 'https://example.test/hydro/index.json');
  await rejected;
  workers[0].onmessage({ data: { type: 'pack', packId: 99, revision: 100, mesh: {} } });
  assert.equal(owner.entries().length, 0);
  owner.dispose();
  assert.equal(await restart, false);
  workers[1].onmessage({ data: { type: 'ready' } });
  assert.equal(owner.hasWorker(), false);
});

test('hydro owner rejects older packs and owns chunked uploads and context cancellation', async t => {
  const { owner, workers, manifest } = fixture(t);
  const jobs = new Map();
  const {gl,deleted}=createTrackedGlBufferPort({withUploads:true});
  const scheduler = { enqueueUpload: job => { jobs.set(job.key, job); return new Promise(() => {}); }, cancelKey: key => { const job = jobs.get(key); jobs.delete(key); job?.dispose(); } };
  
  owner.setContext({ gl, version: 2, projectGeneration: 1, contextGeneration: 1, scheduler });
  const ready = owner.setManifest(manifest, 'https://example.test/hydro/index.json');
  workers[0].onmessage({ data: { type: 'ready' } }); await ready;
  workers[0].onmessage({ data: { type: 'active', revision: 2, packIds: [1] } });
  workers[0].onmessage({ data: { type: 'pack', revision: 1, packId: 9, mesh: {} } });
  assert.equal(owner.pack(9), undefined);
  workers[0].onmessage({ data: { type: 'pack', revision: 2, packId: 1, mesh: { riverStarts: new Int32Array([1, 2, 3, 4]) } } });
  assert.equal(jobs.size, 1);
  const job = [...jobs.values()][0];
  assert.equal(job.step({ byteBudget: 8 }).bytes, 0);
  assert.equal(job.step({ byteBudget: 8 }).bytes, 8);
  assert.equal(owner.stats().hydroUploadBytes, 8);
  owner.resetGpu();
  assert.equal(jobs.size, 0);
  assert.equal(deleted.length, 1);
  assert.equal(owner.pack(1).resources, null);
  assert.throws(() => job.step({ byteBudget: 8 }), { name: 'AbortError' });
});

test('hydro readiness timeout settles false and makes late ready inert', async t => {
  let timeout;
  t.mock.method(globalThis, 'setTimeout', callback => { timeout = callback; return 1; });
  t.mock.method(globalThis, 'clearTimeout', () => {});
  const { owner, workers, manifest } = fixture(t);
  const ready = owner.setManifest(manifest, 'https://example.test/hydro/index.json');
  timeout();
  assert.equal(await ready, false);
  workers[0].onmessage({ data: { type: 'ready' } });
  assert.equal(owner.hasWorker(), false);
});

test('replacing an edit during upload releases its buffers without treating segment counts as WebGL buffers', t => {
  const { owner } = fixture(t);
  const jobs = new Map(), created = [], deleted = [];
  const scheduler = {
    enqueueUpload: job => { jobs.set(job.key, job); return new Promise(() => {}); },
    cancelKey: key => { const job = jobs.get(key); jobs.delete(key); job?.dispose(); },
  };
  const gl = {
    ARRAY_BUFFER: 1, ELEMENT_ARRAY_BUFFER: 2,
    createBuffer() { const buffer = {}; created.push(buffer); return buffer; },
    bindBuffer() {}, bufferData() {}, bufferSubData() {},
    isBuffer(value) { assert.equal(typeof value, 'object', 'WebGL isBuffer rejects numeric segment counts'); return created.includes(value); },
    deleteBuffer: value => deleted.push(value),
  };
  owner.setContext({ gl, version: 2, projectGeneration: 1, contextGeneration: 1, scheduler });
  const mesh = Object.fromEntries([
    'riverStarts', 'riverEnds', 'riverFeatureIds', 'riverStartWidths', 'riverEndWidths',
    'borderRiverStarts', 'borderRiverEnds', 'borderRiverFeatureIds', 'borderRiverStartWidths', 'borderRiverEndWidths',
    'lakePositions', 'lakeFeatureIds', 'lakeIndices', 'lakeBoundaryStarts', 'lakeBoundaryEnds', 'lakeBoundaryFeatureIds', 'lakeBoundaryWidths',
  ].map(key => [key, new Int32Array()]));
  mesh.riverStarts = new Int32Array([0, 0, 1, 1]);
  mesh.riverFeatureIds = new Uint32Array([0]);
  const entry = { id: 'edit:river:#3b82c4', mesh };
  owner.replaceEdits([entry], 7);
  [...jobs.values()][0].step({ byteBudget: 8 });
  assert.equal(entry.uploadState.resources.riverSegmentCount, 1);
  assert.ok(created.length > 0);
  owner.replaceEdits([], 8);
  assert.equal(owner.editRevision, 8);
  assert.deepEqual(deleted, created);
  assert.equal(entry.uploadState, null);
  assert.equal(jobs.size, 0);
});
});
