import test from 'node:test';
import assert from 'node:assert/strict';
import { createGisDomain } from "../../apps/editor/frontend/js/modules/gis-domain.js";
import { createMapAudit } from "../../apps/editor/frontend/js/modules/app-map-audit.js";
import { createGpuMeshWorkerJobs } from "../../shared/frontend/js/modules/gpu-mesh-worker-jobs.js";

function workerHarness() {
  const sent = [];
  const worker = { postMessage: message => sent.push(structuredClone(message)), terminate() {} };
  return { worker, sent, reply(result, request = sent.at(-1)) {
    worker.onmessage({ data: { ...request, type: 'result', ok: true, result } });
  } };
}

test('river RPC carries generation and rejects late results after a project change', async () => {
  const h = workerHarness(); let generation = 2;
  const gis = createGisDomain({ projectDomain: { getGeneration: () => generation }, riverPartitionWorkerFactory: () => h.worker });
  const first = gis.computeRiverPartition({ donors: [] });
  assert.equal(h.sent[0].operation, 'river.partition');
  h.reply({ candidates: [] });
  assert.deepEqual(await first, { candidates: [] });
  const late = gis.computeRiverPartition({ donors: [] });
  generation++;
  h.reply({ candidates: ['old'] });
  await assert.rejects(late, { category: 'STALE_RESULT' });
  const cancelled = gis.computeRiverPartition({ donors: [] });
  gis.cancelRiverPartition();
  await assert.rejects(cancelled, { category: 'CANCELLED' });
  gis.dispose();
});

test('audit RPC publishes reports and clear prevents late report publication', async t => {
  const h = workerHarness();
  const previous = globalThis.Worker;
  globalThis.Worker = function () { return h.worker; };
  t.after(() => { if (previous === undefined) delete globalThis.Worker; else globalThis.Worker = previous; });
  const state = { stateRevision: 2, audit: {}, historyDirtyEntityIds: new Set() };
  const audit = createMapAudit();
  audit.connect({ platform: { runtimeAssetUrl: x => x }, projectState: { state },
    territorialModel: { entityRepository: { list: () => [] } },
    lifecycleUi: { mapDebug: { renderPanel() {} } }, domains: {},
    feedback: { setActionStatus() {}, reportOperationError(error) { throw error; } } });
  audit.initializeGeometryValidationWorker();
  const first = audit.runFullMapAudit();
  assert.equal(h.sent[0].operation, 'geometry.audit');
  h.reply({ issues: [], revision: 2 }); await first;
  assert.equal(state.audit.status, 'ready');
  const next = audit.runFullMapAudit(); const request = h.sent.at(-1);
  audit.clearMapAudit(); h.reply({ issues: ['old'] }, request); await next;
  assert.equal(state.audit.status, 'idle'); assert.equal(state.audit.report, null);
});

test('mesh patch RPC preserves renderer token and installs current buffers', async () => {
  const h = workerHarness(); let installed;
  const owner = createGpuMeshWorkerJobs({ createWorker: () => h.worker,
    isCurrent: entry => entry.payload.token === 7 && entry.geometryRevision === 4,
    onMesh: mesh => { installed = mesh; } });
  const ticket = owner.enqueue({ jobKey: 'patch', geometryRevision: 4, targetRevision: 4, payload: { token: 7, features: [] } });
  await new Promise(resolve => setTimeout(resolve, 0));
  h.reply({ positions: new ArrayBuffer(8) }); await ticket.promise;
  assert.equal(installed.positions.byteLength, 8); assert.equal(owner.outputBytes(), 8);
  owner.cancelAll();
});
