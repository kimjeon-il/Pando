import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {geometryTrace,clippingTrace} from '../../tools/parity/geometry.mjs';
test('current geographic containment preserves exact input coordinates and ring order', () => {
  const cases=JSON.parse(readFileSync(new URL('../fixtures/portability/geometry-containment.json',import.meta.url)));
  const before=structuredClone(cases);
  assert.deepEqual(geometryTrace(cases),cases.map(row=>row.expected));
  assert.deepEqual(cases,before);
});
test('current clipping matches literal rectangular, hole and exact-coordinate results',()=>{
  const cases=JSON.parse(readFileSync(new URL('../fixtures/portability/geometry-clipping.json',import.meta.url)));
  assert.deepEqual(clippingTrace(cases),cases.map(row=>row.expected));
});
