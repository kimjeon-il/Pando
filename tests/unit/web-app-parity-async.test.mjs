import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {asyncTrace} from '../../tools/parity/async.mjs';
test('controlled worker completion observes commit, cancel, stale revision, replacement and failure', {timeout:5000}, async () => {
  const cases=JSON.parse(readFileSync(new URL('../fixtures/portability/async-lifecycle.json',import.meta.url)));
  assert.deepEqual(await asyncTrace(cases),cases.map(row=>row.expected));
});
