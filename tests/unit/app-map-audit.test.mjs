import assert from 'node:assert/strict';
import test from 'node:test';
import { createMapAudit } from "../../apps/editor/frontend/js/modules/app-map-audit.js";
import { connectMapInteraction } from "../../apps/editor/frontend/js/modules/app-connect-map-interaction.js";
import { MAP_INTERACTION_OWNER_PORTS } from "../../apps/editor/frontend/js/modules/app-capability-ports-map-interaction.js";
import { createTerritorialFeature } from "../../shared/frontend/js/modules/territorial-units.js";
import { createTerritorialEntityRepository } from "../../shared/frontend/js/modules/territorial-entity-repository.js";
import { WORKER_RPC_PROTOCOL, WORKER_RPC_PROTOCOL_VERSION } from "../../shared/frontend/js/modules/worker-rpc.js";

test('the application connector sends current repository entities to the audit Worker and accepts its result', async t => {
  const previousWorker = globalThis.Worker;
  t.after(() => {
    if (previousWorker === undefined) delete globalThis.Worker;
    else globalThis.Worker = previousWorker;
  });
  const requests = [], workers = [];
  globalThis.Worker = class {
    constructor() { workers.push(this); }
    postMessage(message) { requests.push(structuredClone(message)); }
  };
  const geometry = { type: 'Polygon', coordinates: [[[0, 0], [0, 5], [5, 5], [5, 0], [0, 0]]] };
  const entity = (id, entityKind, options = {}) => createTerritorialFeature({ id, entityKind, geometry, ...options });
  let entities = [entity('A', 'general'), entity('S', 'general', { parentId: 'A' }), entity('R', 'regional')];
  const entityRepository = createTerritorialEntityRepository({ getEntities: () => entities });
  const state = { stateRevision: 7, countryVisualPhase: 'canonical', historyDirtyEntityIds: new Set(['S']), distributionEntries: [] };
  const mapAudit = createMapAudit();
  const owners = Object.fromEntries(Object.keys(MAP_INTERACTION_OWNER_PORTS)
    .map(name => [name, name === 'mapAudit' ? mapAudit : { connect() {} }]));
  connectMapInteraction({
    ...owners,
    ports: {
      domains: { renderingDomain: { invalidateEditingOverlays() {} } },
      feedback: { reportOperationError() {}, setActionStatus() {} },
      lifecycleUi: { mapDebug: { renderPanel() {} } },
      platform: { runtimeAssetUrl: file => file },
      projectState: { state },
      territorialModel: { entityRepository },
    },
  });
  mapAudit.initializeGeometryValidationWorker();
  const first=mapAudit.runFullMapAudit();
  assert.equal(state.audit.status, 'running');
  const auditRequests=()=>requests.filter(message=>message.type==='request');
  assert.equal(auditRequests().length, 1);
  assert.equal(auditRequests()[0].projectRevision, 7);
  assert.equal(auditRequests()[0].operation, 'geometry.audit');
  assert.deepEqual(auditRequests()[0].payload.countries.map(feature => feature.id), ['A']);
  assert.deepEqual(auditRequests()[0].payload.units.map(feature => feature.id), ['S', 'R']);
  assert.deepEqual(auditRequests()[0].payload.preciseAffectedIds, ['S']);

  entities = [...entities, entity('B', 'general')];
  state.stateRevision = 8;
  const second=mapAudit.runFullMapAudit();
  assert.equal(auditRequests()[1].projectRevision, 8);
  assert.deepEqual(auditRequests()[1].payload.countries.map(feature => feature.id), ['A', 'B']);
  const response=(request,report)=>({ rpc:WORKER_RPC_PROTOCOL,protocolVersion:WORKER_RPC_PROTOCOL_VERSION,
    type:'result',requestId:request.requestId,operation:request.operation,projectRevision:request.projectRevision,
    ok:true,result:report,timing:{durationMs:1} });
  workers[0].onmessage({ data: response(auditRequests()[0], { issues: [] }) });
  await first;
  assert.equal(state.audit.status, 'running');
  const report = { issues: [] };
  workers[0].onmessage({ data: response(auditRequests()[1], report) });
  await second;
  assert.equal(state.audit.status, 'ready');
  assert.strictEqual(state.audit.report, report);
});
