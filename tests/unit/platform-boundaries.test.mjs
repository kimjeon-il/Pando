import assert from 'node:assert/strict';
import test from 'node:test';
import { createTerritorialApplicationService } from "../../apps/editor/frontend/js/modules/territorial-service.js";
import { createEditingDomain } from "../../apps/editor/frontend/js/modules/editing-domain.js";
import { createProjectSession } from "../../shared/frontend/js/modules/project-session.js";
import { normalizeLayerPresentation } from "../../shared/frontend/js/modules/layer-presentation.js";
import { createGeometryPreviewState } from "../../apps/editor/frontend/js/modules/geometry-preview.js";
import { createAtomicMapStateController } from "../../shared/frontend/js/modules/map-state-transition.js";
import { createSaveStateController } from "../../apps/editor/frontend/js/modules/save-state-controller.js";
import { DISTRIBUTION_RENDER_MODES } from "../../shared/frontend/js/modules/distribution-model.js";
import {createNodeSelection} from '../helpers/core-selection.mjs';

test('territorial service rejects a missing ID provider at its composition boundary', () => {
  assert.throws(() => createTerritorialApplicationService({
    entityRepository: {get(){}},commandOwner:{executeCommand(){}},
  }), /ID allocator/);
});

test('selection publishes the prior selection without a second mutable owner', async t => {
  const changes = [];
  const fixture=await createNodeSelection({genericIds:['a','b'],labelIds:[],distributionIds:[],onSelectionChanged:(next, reason, previous) => {
    changes.push({ next: next.selection, previous, reason });
  }});t.after(()=>fixture.dispose());const domain=fixture.domain;
  const a = { domain: 'generic', type: 'feature', id: 'a' };
  const b = { domain: 'generic', type: 'feature', id: 'b' };
  await domain.replace(a);
  await domain.replace(b);
  await domain.replace(b); // no-op must not notify
  await domain.resetProject(1);
  assert.equal(changes.length, 3);
  assert.equal(changes[0].previous?.primaryKey, null);
  assert.equal(changes[1].previous, changes[0].next);
  assert.equal(changes[2].previous, changes[1].next);
  assert.equal(changes[2].next.primaryKey, null);
});

test('editing domain requires paired frame scheduling from its platform owner', () => {
  assert.throws(() => createEditingDomain(), /requestFrame/);
  assert.throws(() => createEditingDomain({ draftServices: { requestFrame() {} } }), /cancelFrame/);
  assert.throws(() => createEditingDomain({ draftServices: { requestFrame() {},cancelFrame() {} } }),/error reporter/);
  const domain = createEditingDomain({ commandOwner: { draftApply() { throw new Error('No draft action is used in this wiring test.'); },
    subscribeTransitions: () => () => {},state: () => null },draftServices: { requestFrame() {},cancelFrame() {},reportOperationError() {} } });
  assert.equal(domain.snapshot().phase, 'idle');
  domain.dispose();
});

test('project session reads the current selection owner across replacement and reset without storing a second selection', async t => {
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
  const first=await createNodeSelection({genericIds:[],labelIds:[],distributionIds:[]});t.after(()=>first.dispose());
  domains.selectionDomain=first.domain;
  await domains.selectionDomain.replace({ domain: 'territorial', type: 'entity', id: 'A' });
  assert.equal(owner.state.selected, domains.selectionDomain.primary());
  assert.equal(owner.state.selected.id, 'A');
  await domains.selectionDomain.replace({ domain: 'territorial', type: 'entity', id: 'B' });
  assert.equal(owner.state.selected.id, 'B');
  assert.throws(() => { owner.state.selected = null; }, TypeError);
  assert.equal(owner.state.selected.id, 'B');
  await domains.selectionDomain.resetProject(1);
  assert.equal(owner.state.selected, null);
  domains.selectionDomain.dispose();
  domains.selectionDomain = null;
  assert.equal(owner.state.selected, null);
  const second=await createNodeSelection({genericIds:['C'],labelIds:[],distributionIds:[]});t.after(()=>second.dispose());
  domains.selectionDomain=second.domain;
  await domains.selectionDomain.replace({ domain: 'generic', type: 'feature', id: 'C' });
  assert.equal(owner.state.selected.id, 'C');
  domains.selectionDomain.dispose();
});
