import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {propertyTrace} from '../../tools/parity/properties.mjs';
test('real property commands preserve no-op, lock, rejection and branching history',()=>{
  const corpus=JSON.parse(readFileSync(new URL('../fixtures/portability/property-commands.json',import.meta.url)));
  assert.deepEqual(propertyTrace(corpus),corpus.operations.map(row=>row.expected));
});
