import assert from 'node:assert/strict';
import test from 'node:test';
import { createTerritorialApplicationService } from "../helpers/core-command-services/territorial-service.mjs";

import { createProjectSession } from "../../shared/frontend/js/modules/project-session.js";
import { normalizeLayerPresentation } from "../../shared/frontend/js/modules/layer-presentation.js";

import { createAtomicMapStateController } from "../../shared/frontend/js/modules/map-state-transition.js";
import { createSaveStateController } from "../helpers/core-command-services/save-state-controller.mjs";
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
