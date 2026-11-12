import test from 'node:test';
import assert from 'node:assert/strict';
import { hydroPackAffectsCurrentView, hydroActivePackSetChanged } from '../../../src/rendering/gpu-hydro-preparation.js';

test('retained offscreen hydro uploads do not invalidate the current globe', () => {
  const active = new Set([3, 5]);
  assert.equal(hydroPackAffectsCurrentView({id:5}, active, []), true);
  assert.equal(hydroPackAffectsCurrentView({id:9}, active, []), false);
  const edit = {id:10};
  assert.equal(hydroPackAffectsCurrentView(edit, active, [edit]), true);
  assert.equal(hydroPackAffectsCurrentView({id:10}, active, [edit]), false);
});

test('duplicate active-view notifications do not initiate a redundant frame', () => {
  assert.equal(hydroActivePackSetChanged(new Set([1,4]), new Set([4,1])), false);
  assert.equal(hydroActivePackSetChanged(new Set([1,4]), new Set([1,4,7])), true);
  assert.equal(hydroActivePackSetChanged(new Set([1,4]), new Set([4])), true);
  assert.equal(hydroActivePackSetChanged(new Set(), new Set()), false);
});
