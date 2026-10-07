import assert from 'node:assert/strict';
import test from 'node:test';
import { createTerritorialApplicationService } from '../../assets/js/modules/territorial-service.js';
import { createEditingDomain } from '../../assets/js/modules/editing-domain.js';
import { createSelectionDomain } from '../../assets/js/modules/selection-domain.js';
import * as projectState from '../../assets/js/modules/project-state.js';
import { createStaticTerritorialSnapshot } from '../../assets/js/modules/territorial-entity-store.js';
import { createTerritorialFeature } from '../../assets/js/modules/territorial-units.js';
import { normalizeGenericFeatureCollection } from '../../assets/js/modules/generic-feature-service.js';
import { createProjectSession } from '../../assets/js/modules/app-project-session.js';
import { normalizeLayerPresentation } from '../../assets/js/modules/layer-presentation.js';
import { createGeometryPreviewState } from '../../assets/js/modules/geometry-preview.js';
import { createAtomicMapStateController } from '../../assets/js/modules/map-state-transition.js';
import { createSaveStateController } from '../../assets/js/modules/save-state-controller.js';
import { DISTRIBUTION_RENDER_MODES } from '../../assets/js/modules/distribution-model.js';

test('territorial service rejects a missing ID provider at its composition boundary', () => {
  assert.throws(() => createTerritorialApplicationService({
    entityStore: {}, entityRepository: {}, commandPipeline: { runMutation() {} },
  }), /createId/);
});

test('history restoration prepares and validates a detached candidate outside UI composition', () => {
  assert.equal(typeof projectState.prepareEditableProjectSnapshot, 'function');
  const snapshot = { ...createStaticTerritorialSnapshot([createTerritorialFeature({
    id: 'A', entityKind: 'general', name: 'Alpha', geometry: {
      type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,1],[0,0]]],
    },
  })]), hydroEdits: [], genericFeatures: [], distributionLayers: [], distributionEntries: [] };
  const before = structuredClone(snapshot);
  const options = { normalizeHydroEditCollection: values => values, normalizeGenericFeatureCollection };
  const candidate = projectState.prepareEditableProjectSnapshot(snapshot, options);
  assert.deepEqual(snapshot, before);
  candidate.territorialEntities[0].properties.name = 'Edited';
  assert.equal(snapshot.territorialEntities[0].properties.name, 'Alpha');
  const invalid = structuredClone(snapshot);
  invalid.timelineRecords.geometryBindings[0].geometryRef.id = 'missing';
  assert.throws(() => projectState.prepareEditableProjectSnapshot(invalid, options));
  assert.deepEqual(snapshot, before);
});

test('selection publishes the prior selection without a second mutable owner', () => {
  const changes = [];
  const domain = createSelectionDomain({ onSelectionChanged: (next, reason, previous) => {
    changes.push({ next: next.selection, previous, reason });
  } });
  const a = { domain: 'generic', type: 'feature', id: 'a' };
  const b = { domain: 'generic', type: 'feature', id: 'b' };
  domain.replace(a);
  domain.replace(b);
  domain.replace(b); // no-op must not notify
  domain.resetProject(1);
  assert.equal(changes.length, 3);
  assert.equal(changes[0].previous?.primaryKey, null);
  assert.equal(changes[1].previous, changes[0].next);
  assert.equal(changes[2].previous, changes[1].next);
  assert.equal(changes[2].next.primaryKey, null);
});

test('editing domain requires paired frame scheduling from its platform owner', () => {
  assert.throws(() => createEditingDomain(), /requestFrame/);
  assert.throws(() => createEditingDomain({ draftServices: { requestFrame() {} } }), /cancelFrame/);
  const domain = createEditingDomain({ draftServices: { requestFrame() {}, cancelFrame() {} } });
  assert.equal(domain.snapshot().phase, 'idle');
  domain.dispose();
});

test('project session reads the current selection owner across replacement and reset without storing a second selection', () => {
  const domains = { selectionDomain: null };
  const owner = createProjectSession();
  owner.connect({
    domains,
    readiness: { DATA_READINESS: { PREVIEW: 'preview' } },
    applicationConstantsA: { DISTRIBUTION_RENDER_MODES },
    modelValidation: { normalizeLayerPresentation },
    physicalConfig: { PHYSICAL_DATASET: 'fixture' },
    applicationFactories: { createGeometryPreviewState },
    uiFactoriesA: { createAtomicMapStateController },
    uiFactoriesB: { createSaveStateController },
  });
  owner.initializeMapWorkScheduler();
  assert.equal(owner.state.selected, null);
  const selected = Object.getOwnPropertyDescriptor(owner.state, 'selected');
  assert.equal(typeof selected.get, 'function');
  assert.equal(selected.set, undefined);
  assert.equal(Object.hasOwn(selected, 'value'), false);
  domains.selectionDomain = createSelectionDomain();
  domains.selectionDomain.replace({ domain: 'territorial', type: 'entity', id: 'A' });
  assert.equal(owner.state.selected, domains.selectionDomain.primary());
  assert.equal(owner.state.selected.id, 'A');
  domains.selectionDomain.replace({ domain: 'territorial', type: 'entity', id: 'B' });
  assert.equal(owner.state.selected.id, 'B');
  assert.throws(() => { owner.state.selected = null; }, TypeError);
  assert.equal(owner.state.selected.id, 'B');
  domains.selectionDomain.resetProject(1);
  assert.equal(owner.state.selected, null);
  domains.selectionDomain.dispose();
  domains.selectionDomain = null;
  assert.equal(owner.state.selected, null);
  domains.selectionDomain = createSelectionDomain();
  domains.selectionDomain.replace({ domain: 'generic', type: 'feature', id: 'C' });
  assert.equal(owner.state.selected.id, 'C');
  domains.selectionDomain.dispose();
});
