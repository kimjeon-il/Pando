import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {distributionTrace} from '../../tools/parity/distribution.mjs';
test('current distribution calculation matches explicit range and alpha contracts',()=>{
  const corpus=JSON.parse(readFileSync(new URL('../fixtures/portability/distribution-scale.json',import.meta.url)));
  for(const row of corpus)assert.deepEqual(distributionTrace(row.input),row.expected,row.id);
});
