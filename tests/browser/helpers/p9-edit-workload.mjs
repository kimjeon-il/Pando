import { expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { startChildCreation } from './ui-select.mjs';

// Opt-in extension of the existing P9 sample; no browser, server or round loop.
// Before page.goto(): await installP9EditWorkload(page).
// After readiness/focus sampling: const edit = await runP9EditWorkload(page).
// Return {...existingSample, ...edit.metrics, editWorkload: edit}; compare the
// same P9_EDIT_METRIC_KEYS in the existing five-pair/one-extra-round owner.
export const P9_EDIT_METRIC_KEYS = Object.freeze([
  'editFrameP95Ms', 'editLongTaskTotalMs', 'editLongestTaskMs', 'editWorkerRoundTripP95Ms',
  'editWorkerComputeP95Ms', 'autosavePersistMs', 'autosaveEndToEndMs',
]);
const percentile = (values, fraction) => [...values].sort((a,b)=>a-b)[Math.ceil(values.length*fraction)-1];
let canonical;
function canonicalRussia() {
  if (canonical) return canonical;
  const root = new URL('../../../assets/data/', import.meta.url);
  const build = JSON.parse(readFileSync(new URL('world/build-input.json', root), 'utf8'));
  const source = JSON.parse(readFileSync(new URL(build.canonicalSource, root), 'utf8'));
  const geometry = source.features.find(feature => feature.id === 'RUS').geometry;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  canonical = { source: build.canonicalSource,
    sha256: createHash('sha256').update(JSON.stringify(geometry)).digest('hex'),
    polygons: polygons.length, coordinatePairs: polygons.flat().reduce((sum, ring)=>sum+ring.length, 0) };
  return canonical;
}

export async function installP9EditWorkload(page) {
  await page.addInitScript(() => {
    const key = '__PANDOLAB_P9_EDIT_TEST_PROBE__';
    if (globalThis[key]) throw new Error('P9 edit probe installed twice');
    const probe = { installedAtMs: performance.now(), stage: null, windows: [],
      requests: [], longTasks: [], longTaskSupported: false, errors: [] };
    globalThis[key] = probe;
    if (globalThis.PerformanceObserver?.supportedEntryTypes.includes('longtask')) {
      const retain = entries => probe.longTasks.push(...entries.map(entry => ({
        startMs: entry.startTime, durationMs: entry.duration, name: entry.name,
      })));
      const observer = new PerformanceObserver(list => retain(list.getEntries()));
      observer.observe({ type: 'longtask' });
      probe.longTaskSupported = true;
      probe.drainLongTasks = () => retain(observer.takeRecords());
    }
    const NativeWorker = globalThis.Worker;
    let workerSequence = 0;
    globalThis.Worker = class P9ObservedWorker extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.p9WorkerId = ++workerSequence;
        this.p9WorkerUrl = String(args[0]);
        this.p9Pending = new Map();
        this.addEventListener('message', event => {
          const reply = event.data;
          if (reply?.rpc !== 'pandolab-worker-rpc' || reply.protocolVersion !== 1 || reply.type !== 'result') return;
          const entry = this.p9Pending.get(reply.requestId);
          if (!entry) return;
          entry.responseAtMs = performance.now();
          entry.roundTripMs = entry.responseAtMs-entry.sentAtMs;
          entry.ok = reply.ok === true;
          entry.responseOperation = reply.operation;
          entry.workerDurationMs = Number.isFinite(reply.timing?.durationMs) ? reply.timing.durationMs : null;
          entry.error = reply.error ? { code: reply.error.code, category: reply.error.category, message: reply.error.message } : null;
          entry.status = 'responded';
          this.p9Pending.delete(reply.requestId);
        });
      }
      postMessage(message, ...rest) {
        let entry;
        if (message?.rpc === 'pandolab-worker-rpc' && message.protocolVersion === 1) {
          if (message.type === 'request') {
            entry = { workerId: this.p9WorkerId, workerUrl: this.p9WorkerUrl,
              requestId: message.requestId, operation: message.operation, projectRevision: message.projectRevision,
              stage: probe.stage, sentAtMs: performance.now(), postMessageMs: null,
              responseAtMs: null, roundTripMs: null, workerDurationMs: null, status: 'pending', cancelAtMs: null };
            this.p9Pending.set(message.requestId, entry);probe.requests.push(entry);
          } else if (message.type === 'cancel') {
            const pending = this.p9Pending.get(message.requestId);
            if (pending) pending.cancelAtMs = performance.now();
          }
        }
        try { return super.postMessage(message, ...rest); }
        catch (error) {
          if (entry) { entry.status='post-failed';entry.error={name:error.name,message:error.message}; }
          throw error;
        } finally { if (entry) entry.postMessageMs=performance.now()-entry.sentAtMs; }
      }
      terminate() {
        for (const entry of this.p9Pending.values()) {
          entry.status = 'terminated';entry.terminatedAtMs = performance.now();
        }
        this.p9Pending.clear();return super.terminate();
      }
    };
    probe.begin = stage => {
      if (probe.stage) throw new Error('P9 edit stages overlap');
      probe.stage=stage;probe.windows.push({stage,startMs:performance.now(),endMs:null});
      if(stage==='rus-line-preparation-and-cancel') {
        const window=probe.windows.at(-1);window.frameIntervals=[];window.firstFrameDelayMs=null;
        let previous=null;
        const frame=atMs=>{
          if(probe.stage!==stage)return;
          if(previous!==null)window.frameIntervals.push({atMs,previousAtMs:previous,durationMs:atMs-previous});
          else window.firstFrameDelayMs=performance.now()-window.startMs;
          previous=atMs;probe.frameHandle=requestAnimationFrame(frame);
        };
        probe.frameHandle=requestAnimationFrame(frame);
      }
    };
    probe.end = stage => {
      if (probe.stage!==stage) throw new Error('P9 edit stage mismatch');
      const window=probe.windows.at(-1);window.endMs=performance.now();probe.stage=null;
      if(stage==='rus-line-preparation-and-cancel')cancelAnimationFrame(probe.frameHandle);
      probe.drainLongTasks?.();return {...window};
    };
    addEventListener('error',event=>probe.errors.push({stage:probe.stage,message:event.message}));
    addEventListener('unhandledrejection',event=>probe.errors.push({stage:probe.stage,message:String(event.reason?.message||event.reason)}));
  });
}

// The existing P9 owner's finally/catch can retain partial evidence on failure.
export async function readP9EditWorkload(page) {
  return page.evaluate(()=>{
    const probe=globalThis.__PANDOLAB_P9_EDIT_TEST_PROBE__;
    if(!probe)return {installed:false};
    probe.drainLongTasks?.();
    return {installed:true,longTaskSupported:probe.longTaskSupported,stage:probe.stage,
      requests:probe.requests.filter(request=>request.stage),longTasks:probe.longTasks,
      errors:probe.errors,windows:probe.windows};
  });
}

// Same IndexedDB owner/key and transaction completion used by persistence tests.
async function autosaveReceipt(page, { name, afterMs }) {
  return page.evaluate(async ({name,afterMs}) => {
    const db = await new Promise((resolve,reject) => {
      const request=indexedDB.open('pandolab-editor',2);
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
    let saved;
    try { saved=await new Promise((resolve,reject)=>{
      const transaction=db.transaction('projects','readonly');
      const request=transaction.objectStore('projects').get('active-project');
      transaction.oncomplete=()=>resolve(request.result||null);
      transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error||new Error('Autosave read aborted'));
    }); } finally { db.close(); }
    if (!saved) return null;
    // Full historical-world startup owns a full current autosave, as in the
    // timeline persistence workflow. No delta reconstruction or older reader.
    if (saved.format!=='pandolab-autosave-full'||saved.schemaVersion!==10)
      throw new Error(`P9 requires the current full-world autosave, got ${saved.format}/${saved.schemaVersion}`);
    const entity=saved.territorialEntities.find(entity=>entity.id==='RUS');
    if (entity?.properties.name!==name) return null;
    const samples=globalThis.__PANDOLAB_PERFORMANCE_REPORT__().operations['autosave.persist']?.samples||[];
    const metric=samples.find(sample=>sample.atMs>=afterMs&&sample.atMs-sample.durationMs>=afterMs-.1&&sample.detail?.outcome==='indexeddb');
    return metric ? {metric,savedAt:saved.savedAt,format:saved.format,schemaVersion:saved.schemaVersion,
      observedAtMs:performance.now(),name:entity.properties.name} : null;
  }, {name,afterMs});
}

async function verifySavedRussia(page, expectedName, expectedGeometry) {
  return page.evaluate(async ({expectedName,expectedGeometry}) => {
    const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('pandolab-editor',2);
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    let saved;
    try { saved=await new Promise((resolve,reject)=>{const transaction=db.transaction('projects','readonly');
      const request=transaction.objectStore('projects').get('active-project');
      transaction.oncomplete=()=>resolve(request.result);transaction.onerror=()=>reject(transaction.error);
      transaction.onabort=()=>reject(transaction.error||new Error('Autosave verification read aborted'));}); }
    finally { db.close(); }
    const [{prepareProjectForStorage},{restoreTimelineStorage},{resolveWorld}]=await Promise.all([
      import('/assets/js/modules/project-state.js'),import('/assets/js/modules/timeline-storage.js'),import('/assets/js/modules/timeline-resolver.js')]);
    const project=prepareProjectForStorage(saved);
    const storage=restoreTimelineStorage({schemaVersion:1,records:project.timelineRecords,geometries:project.geometries},
      project.territorialEntities.map(entity=>({id:entity.id,entityKind:entity.properties.entityKind})));
    const month=document.querySelector('#timelineMonthInput').value;
    const resolved=resolveWorld(project.territorialEntities,storage.records,storage.geometries,month).byId.get('RUS');
    if (!resolved||resolved.identity.properties.name!==expectedName||JSON.stringify(resolved.geometry)!==expectedGeometry)
      throw new Error('The real autosave did not retain the expected RUS identity and complete geometry');
    return {month,geometryRef:resolved.geometryRef,geometryUnchanged:true,entityCount:project.territorialEntities.length,
      archiveCount:project.geometries.length,format:saved.format,schemaVersion:saved.schemaVersion};
  }, {expectedName,expectedGeometry});
}

export async function runP9EditWorkload(page, { timeoutMs=90_000 }={}) {
  expect(await page.evaluate(()=>!!globalThis.__PANDOLAB_P9_EDIT_TEST_PROBE__?.longTaskSupported),
    'Install the P9 helper before navigation; Chromium LongTask observation is required').toBe(true);
  await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:timeoutMs});
  const original=await page.evaluate(()=>{
    const country=window.PANDOLAB_TERRITORIAL.get('RUS');
    const geometry=JSON.stringify(country.geometry);
    const polygons=country.geometry.type==='Polygon'?[country.geometry.coordinates]:country.geometry.coordinates;
    return {geometry,name:country.properties.name,polygons:polygons.length,
      coordinatePairs:polygons.flat().reduce((sum,ring)=>sum+ring.length,0),
      ids:window.PANDOLAB_TERRITORIAL.list().map(entity=>entity.id).sort(),
      undoDisabled:document.querySelector('#undoBtn').disabled,redoDisabled:document.querySelector('#redoBtn').disabled};
  });
  const source=canonicalRussia();
  expect({polygons:original.polygons,coordinatePairs:original.coordinatePairs}).toEqual({polygons:source.polygons,coordinatePairs:source.coordinatePairs});
  const runtimeGeometrySha256=createHash('sha256').update(original.geometry).digest('hex');
  await page.locator('#resetViewBtn').evaluate(button=>button.click());
  await page.locator('#flatBtn').evaluate(button=>button.click());
  expect(await page.evaluate(()=>window.PANDOLAB_TERRITORIAL.select('RUS'))).toBe(true);
  await page.evaluate(()=>globalThis.__PANDOLAB_P9_EDIT_TEST_PROBE__.begin('rus-line-preparation-and-cancel'));
  await startChildCreation(page,'RUS');
  await expect(page.locator('#modePrimaryBtn')).toBeEnabled({timeout:timeoutMs});
  await page.locator('#territorialCreateNameInput').fill('P9 러시아 경계선 시험');
  await page.locator('#modePrimaryBtn').click();
  await page.locator('#modeDirectLineMethodInput').check();
  const map=await page.locator('#map').boundingBox();expect(map).toBeTruthy();
  const coordinates=[[45,42],[45,67.35]];
  const points=await page.evaluate(coords=>coords.map(coordinate=>window.__PANDOLAB_VIEW_DEBUG__.geoToScreen(coordinate)),coordinates);
  for(const point of points)expect(point.every(Number.isFinite)&&point[0]>=0&&point[0]<map.width&&point[1]>=0&&point[1]<map.height,'The fixed line must be inside the actual map viewport').toBe(true);
  await page.mouse.move(map.x+points[0][0],map.y+points[0][1]);await page.mouse.down();
  await page.mouse.move(map.x+points[1][0],map.y+points[1][1],{steps:12});await page.mouse.up();
  await expect(page.locator('.draft-shape.cut-valid')).toHaveCount(1,{timeout:timeoutMs});
  await expect(page.locator('.draft-split-preview')).toHaveCount(2,{timeout:timeoutMs});
  for(let step=0;step<2;step++) {
    await page.locator('#modeCancelBtn').click();
    if(await page.locator('#confirmModal').isVisible())await page.locator('#confirmModalOkBtn').click();
  }
  await expect(page.locator('g.draft-vertex')).toHaveCount(0);
  await expect(page.locator('.draft-split-preview')).toHaveCount(0);
  const editWindow=await page.evaluate(()=>globalThis.__PANDOLAB_P9_EDIT_TEST_PROBE__.end('rus-line-preparation-and-cancel'));
  const cancelled=await page.evaluate(()=>({geometry:JSON.stringify(window.PANDOLAB_TERRITORIAL.get('RUS').geometry),
    ids:window.PANDOLAB_TERRITORIAL.list().map(entity=>entity.id).sort(),
    undoDisabled:document.querySelector('#undoBtn').disabled,redoDisabled:document.querySelector('#redoBtn').disabled}));
  expect(cancelled).toEqual({geometry:original.geometry,ids:original.ids,undoDisabled:original.undoDisabled,redoDisabled:original.redoDisabled});

  // Queue a real model mutation, then observe the existing serializer, IDB write
  // and checkpoint acknowledgement. Hashing/codec proof is outside that window.
  const marker=`${original.name} · P9 autosave`;
  const saveStartedAtMs=await page.evaluate(async name=>{
    globalThis.__PANDOLAB_P9_EDIT_TEST_PROBE__.begin('rus-name-autosave');
    const startedAtMs=performance.now(),result=await window.PANDOLAB_TERRITORIAL.setName('RUS',name);
    if(result?.changed!==true)throw new Error('P9 autosave command did not change the canonical model');
    return startedAtMs;
  },marker);
  let save;
  await expect.poll(async()=>!!(save=await autosaveReceipt(page,{name:marker,afterMs:saveStartedAtMs})),{timeout:timeoutMs}).toBe(true);
  await page.evaluate(()=>globalThis.__PANDOLAB_P9_EDIT_TEST_PROBE__.end('rus-name-autosave'));
  const saved=await verifySavedRussia(page,marker,original.geometry);
  const undoStartedAtMs=await page.evaluate(()=>performance.now());
  await page.locator('#undoBtn').click();
  await expect.poll(()=>page.evaluate(()=>window.PANDOLAB_TERRITORIAL.get('RUS').properties.name),{timeout:timeoutMs}).toBe(original.name);
  let restored;
  await expect.poll(async()=>!!(restored=await autosaveReceipt(page,{name:original.name,afterMs:undoStartedAtMs})),{timeout:timeoutMs}).toBe(true);
  const restoredSaved=await verifySavedRussia(page,original.name,original.geometry);
  // Drain queued observer delivery after the timed windows have ended.
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));
  const observed=await readP9EditWorkload(page);
  const requests=observed.requests.filter(request=>request.stage==='rus-line-preparation-and-cancel'&&request.workerUrl.includes('map-edit-worker.js'));
  const cut=requests.filter(request=>request.operation==='territorial-cut'&&request.status==='responded'&&request.ok);
  expect(cut.length,'At least one real successful territorial-cut Worker request/result is required').toBeGreaterThan(0);
  expect(cut.every(request=>request.responseOperation===request.operation&&Number.isFinite(request.roundTripMs)&&Number.isFinite(request.workerDurationMs))).toBe(true);
  expect(observed.errors).toEqual([]);
  const frames=editWindow.frameIntervals;
  expect(frames.length,'At least five actual rAF intervals are required during the editing window; no idle frames are appended').toBeGreaterThanOrEqual(5);
  expect(frames.every(frame=>Number.isFinite(frame.durationMs)&&frame.durationMs>0)).toBe(true);
  const longTasks=observed.longTasks.filter(task=>task.startMs>=editWindow.startMs&&task.startMs<editWindow.endMs);
  return {schema:'pando-p9-rus-edit-workload-v1',input:{canonicalSource:source,runtimeGeometrySha256,
    coordinatePairs:original.coordinatePairs,polygons:original.polygons,lineCoordinates:coordinates,pointerSteps:12},
    metrics:{editFrameP95Ms:percentile(frames.map(frame=>frame.durationMs),.95),
      editLongTaskTotalMs:longTasks.reduce((sum,task)=>sum+task.durationMs,0),
      editLongestTaskMs:Math.max(0,...longTasks.map(task=>task.durationMs)),
      editWorkerRoundTripP95Ms:percentile(cut.map(request=>request.roundTripMs),.95),
      editWorkerComputeP95Ms:percentile(cut.map(request=>request.workerDurationMs),.95),
      autosavePersistMs:save.metric.durationMs,autosaveEndToEndMs:save.metric.atMs-saveStartedAtMs},
    editWindow,frameIntervalsMs:frames.map(frame=>frame.durationMs),longTasks,allObservedLongTasks:observed.longTasks,
    workerRequests:requests,allObservedRequests:observed.requests,
    save:{...save,proof:saved},restore:{...restored,proof:restoredSaved},
    cancellation:{geometryUnchanged:true,entityIdsUnchanged:true,historyAvailabilityUnchanged:true},
    scope:'Existing full-resolution RUS detailed-line preparation and actual two-stage UI cancellation; successful territorial-cut request/result RTT measured on the main-page clock; Worker duration uses its own reported timer. Autosave persist includes canonical build, actual IDB write and checkpoint acknowledgement; end-to-end also includes queue delay. Verification decoding and Undo cleanup are outside compared save timing.',
    limitations:['Worker RTT includes main-thread serialization/dispatch/delivery; it is not isolated Worker CPU time.','LongTask entries are the Chromium main-page API observations; absence is meaningful only with the required installed observer.','No project-file download/export or Worker/WASM/process/GPU memory measurement.']};
}
