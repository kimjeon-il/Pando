import assert from 'node:assert/strict';
import test from 'node:test';
import { createGenericFeatureService } from "../../apps/editor/frontend/js/modules/generic-feature-service.js";
import { createDistributionService } from "../../apps/editor/frontend/js/modules/distribution-service.js";

for (const create of [createGenericFeatureService, createDistributionService]) {
  test(`${create.name} requires the single Core command owner and read projection`, () => {
    assert.throws(() => create({}), /read model/);
    assert.throws(() => create({ documentModel: { list() {}, snapshot() {} } }), /command owner/);
  });
  test(`${create.name} propagates transport failure instead of acknowledging a change`, async () => {
    const failure = Object.assign(new Error('Worker stopped'), { code: 'PL-CORE-DISPOSED' });
    const service = create({ documentModel: { list: () => [], snapshot: () => ({}) },
      commandOwner: { executeCommand: async () => { throw failure; } } });
    const operation = create === createGenericFeatureService ? service.add({ id: 'one' }) : service.createLayer({ id: 'one' });
    await assert.rejects(operation, error => error === failure);
  });
}
