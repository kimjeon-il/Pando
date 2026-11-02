import assert from 'node:assert/strict';
import test from 'node:test';
import {buildFrontendIndex} from '../../scripts/lib/frontend-layout.mjs';
import {worldFixture} from '../../apps/editor/tests/helpers/world-fixture.mjs';

test('stage fixture derives transitive runtime modules from the frontend closure',async t=>{
  const {root}=await worldFixture(t);
  const index=buildFrontendIndex(root);
  for(const path of [
    'assets/js/modules/runtime-context.js',
    'assets/js/modules/platform-runtime.js',
    'assets/js/modules/platform-ports.js',
    'assets/js/modules/file-access-contract.js',
  ])assert.ok(index.has(path),'missing staged fixture source '+path);
});
