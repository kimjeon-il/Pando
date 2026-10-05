import assert from 'node:assert/strict';
import test from 'node:test';
import { createMapAudit } from '../../assets/js/modules/app-map-audit.js';
import { connectMapInteraction } from '../../assets/js/modules/app-connect-map-interaction.js';
import { MAP_INTERACTION_OWNER_PORTS } from '../../assets/js/modules/app-capability-ports-map-interaction.js';
import { createTerritorialFeature } from '../../assets/js/modules/territorial-units.js';
import { createTerritorialEntityRepository } from '../../assets/js/modules/territorial-entity-repository.js';

test('the application connector sends current repository entities to the audit Worker and accepts its result', t => {
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
  mapAudit.runFullMapAudit();
  assert.equal(state.audit.status, 'running');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].revision, 7);
  assert.deepEqual(requests[0].payload.countries.map(feature => feature.id), ['A']);
  assert.deepEqual(requests[0].payload.units.map(feature => feature.id), ['S', 'R']);
  assert.deepEqual(requests[0].payload.preciseAffectedIds, ['S']);

  entities = [...entities, entity('B', 'general')];
  state.stateRevision = 8;
  mapAudit.runFullMapAudit();
  assert.equal(requests[1].revision, 8);
  assert.deepEqual(requests[1].payload.countries.map(feature => feature.id), ['A', 'B']);
  workers[0].onmessage({ data: { type: 'result', requestId: requests[0].requestId, ok: true, report: { issues: [] } } });
  assert.equal(state.audit.status, 'running');
  const report = { issues: [] };
  workers[0].onmessage({ data: { type: 'result', requestId: requests[1].requestId, ok: true, report } });
  assert.equal(state.audit.status, 'ready');
  assert.strictEqual(state.audit.report, report);
});
