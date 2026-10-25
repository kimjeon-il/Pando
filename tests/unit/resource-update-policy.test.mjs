import test from 'node:test';
import assert from 'node:assert/strict';
import * as policy from "../../shared/frontend/js/modules/resource-update-policy.js";
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const device = {};
const dependency = (changes = {}) => ({ source: 'dataset', content: 'sha256:geometry', preparation: 'mesh-v1',
  context: [device, 1], presentation: 'style:1', ...changes });

test('one dependency contract preserves equal inputs and isolates presentation and context changes', () => {
  assert.equal(typeof policy.resourceUpdate, 'function');
  const before = dependency();
  assert.deepEqual(policy.resourceUpdate(before, dependency()), { input: false, prepare: false, upload: false, present: false });
  assert.deepEqual(policy.resourceUpdate(before, dependency({ presentation: 'style:2' })), { input: false, prepare: false, upload: false, present: true });
  assert.deepEqual(policy.resourceUpdate(before, dependency({ context: [device, 2] })), { input: false, prepare: false, upload: true, present: true });
  assert.deepEqual(policy.resourceUpdate(before, dependency({ context: null })), { input: false, prepare: false, upload: true, present: true });
  assert.deepEqual(policy.resourceUpdate(before, dependency({ preparation: 'mesh-v2' })), { input: false, prepare: true, upload: true, present: true });
  assert.deepEqual(policy.resourceUpdate(before, dependency({ content: 'sha256:new' })), { input: true, prepare: true, upload: true, present: true });
});

test('initial preparation and non-GPU resources use the same contract without optional missing keys', () => {
  assert.deepEqual(policy.resourceUpdate(null, dependency({ context: null })), { input: true, prepare: true, upload: false, present: true });
  assert.throws(() => policy.resourceUpdate(null, { source: 'unknown' }), /dependency/i);
  assert.throws(() => policy.resourceUpdate(dependency(), dependency({ content: undefined })), /dependency/i);
});

test('structured dependency keys are deterministic without reference identity or property order', () => {
  assert.equal(policy.resourceKey({ b: [2, 3], a: 1 }), policy.resourceKey({ a: 1, b: [2, 3] }));
  assert.notEqual(policy.resourceKey(['a:b', 'c']), policy.resourceKey(['a', 'b:c']));
});

test('classic Workers execute the generated copy of the same policy contract', () => {
  const scope={self:{}};
  vm.runInNewContext(readFileSync(new URL('../../assets/js/workers/resource-update-policy-core.js',import.meta.url),'utf8'),scope);
  const result=scope.self.PandoLabResourceUpdatePolicy.resourceUpdate(dependency(),dependency({presentation:'changed'}));
  assert.deepEqual(JSON.parse(JSON.stringify(result)),policy.resourceUpdate(dependency(),dependency({presentation:'changed'})));
});
