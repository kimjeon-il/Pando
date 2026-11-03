import test from 'node:test';
import assert from 'node:assert/strict';
import { createCountryPatchPresentation } from '../../shared/frontend/js/modules/gpu-country-patch-presentation.js';

test('country patch scene is held only for the current staged geometry while terrain is pending', () => {
  const owner = createCountryPatchPresentation();
  owner.begin({ eligible: true, ids: ['A'], token: 4, geometryRevision: 7, previousBaseResult: { frame: 1 } });
  assert.equal(Object.isFrozen(owner.current()), true);
  assert.equal(owner.phase(), 'waiting-mesh');
  assert.equal(owner.stage(4, 7), true);
  assert.equal(owner.canDrawOverride('A'), true);
  const ready = { geometryRevision: 7, canComposite: true, terrainAvailable: true,
    targetTileCount: 2, loadedTileCount: 1, terrainSettled: false };
  assert.equal(owner.shouldHold(ready), true);
  assert.equal(owner.heldBaseResult(), owner.current().previousBaseResult);
  assert.equal(owner.snapshot().heldFrameCount, 1);
  assert.equal(owner.shouldHold({ ...ready, geometryRevision: 8 }), false);
  assert.equal(owner.shouldHold({ ...ready, terrainSettled: true }), false);
  assert.equal(owner.promote(4, 7), true);
  assert.equal(owner.phase(), 'promoted');
  owner.retirePromoted();
  assert.equal(owner.current(), null);
});

test('country patch preservation rejects stale work and unrelated scene changes', () => {
  const owner = createCountryPatchPresentation();
  assert.equal(owner.preservesScene(() => { throw new Error('inactive scene evaluated'); }), false);
  assert.equal(owner.shouldHold({}), false);
  owner.begin({ eligible: false, ids: ['A'], token: 1, geometryRevision: 1 });
  assert.equal(owner.current(), null);
  owner.begin({ eligible: true, ids: ['A'], token: 2, geometryRevision: 2 });
  assert.equal(owner.stage(1, 2), false);
  assert.equal(owner.setIds(2, ['A', 'B']), true);
  assert.equal(owner.canDrawOverride('B'), false);
  assert.equal(owner.preservesScene(() => true), true);
  assert.equal(owner.preservesScene(() => false), false);
  owner.disablePreservation();
  assert.equal(owner.shouldHold({ geometryRevision: 2, canComposite: true, terrainAvailable: true,
    targetTileCount: 2, loadedTileCount: 1, terrainSettled: false }), false);
  assert.equal(owner.clearIfToken(1), false);
  assert.equal(owner.clearIfToken(2), true);
  assert.equal(owner.current(), null);
});
