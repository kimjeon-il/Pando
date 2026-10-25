import assert from 'node:assert/strict';
import test from 'node:test';
import { createTerritorialDrafts } from "../../apps/editor/frontend/js/modules/app-territorial-drafts.js";
import { createTerritorialFeature } from "../../shared/frontend/js/modules/territorial-units.js";
import { OBJECT_EDITING_OWNER_PORTS } from "../../apps/editor/frontend/js/modules/app-capability-ports.js";
import { capabilityPortsForFixture } from './helpers/capability-port-fixture.mjs';

const geometry = { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 0]]] };

for (const { interval, timelineEditsEnabled } of [
  { interval: { validFrom: '1949-05-23', validTo: null }, timelineEditsEnabled: true },
  { interval: { validFrom: null, validTo: null }, timelineEditsEnabled: false },
]) {
  test(`new child has no explicit dates when parent interval is ${JSON.stringify(interval)}`, async () => {
    const parent = createTerritorialFeature({ id: 'DEU', entityKind: 'general', geometry, ...interval });
    const workflow = {
      kind: 'entity', generatedId: 'child', name: 'Child', combinedGeometry: geometry,
      sourceInfo: { context: { entityKind: 'general', parentId: parent.id }, existingId: '' },
    };
    const state = { stateRevision: 1, tool: 'draw-territorial-unit', selected: null,
      distributionEntries: [], territorySelectionSession: workflow };
    let requested;
    const owner = createTerritorialDrafts();
    owner.connect(capabilityPortsForFixture(OBJECT_EDITING_OWNER_PORTS.territorialDrafts, {
      state,
      entityRepository: { get: id => id === parent.id ? parent : null, list: () => [parent] },
      createTerritorialFeature,
      deepClone: structuredClone,
      TERRITORIAL_COVERAGE_MODES: { PARTITION: 'partition' },
      territorySelectionPreviewIsCurrent: () => true,
      mapEditClient: {
        async execute(operation, { payload }) {
          assert.equal(operation, 'territorial-edit');
          requested = payload;
          return { requestId: 1, result: { impacts: [], features: [], countryIds: [], removedIds: [],
            ownershipChanges: [], affectedIds: [] } };
        },
        discard() {},
      },
      projectDomain: { state: () => ({ epoch: 1, timelineEditsEnabled }), prepareCommand: async () => ({ ok: true, changed: false }) },
      setActionStatus() {}, setModeBanner() {}, reportOperationError(error) { throw error; },
    }));

    assert.equal(await owner.prepareTerritorialSelectionPreview(workflow, 'current'), false);
    assert.equal(requested.newFeature.properties.parentId, 'DEU');
    assert.deepEqual({ validFrom: requested.newFeature.properties.validFrom,
      validTo: requested.newFeature.properties.validTo }, { validFrom: null, validTo: null });
  });
}
