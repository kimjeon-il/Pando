import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {structureTrace} from '../../tools/parity/structure.mjs';
test('real structural commands preserve parent, cycle, lock and history rules',()=>{
  const corpus=JSON.parse(readFileSync(new URL('../fixtures/portability/structure-commands.json',import.meta.url)));
  assert.deepEqual(structureTrace(corpus),corpus.operations.map(row=>row.expected));
});
