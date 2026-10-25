import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeCountryMesh } from "../../shared/frontend/js/modules/country-mesh-codec.js";

test('current snapshot mesh count follows its verified header and identity list', () => {
  const buffer = new ArrayBuffer(84);
  new Uint32Array(buffer, 0, 12).set([0x434d4731, 2, 1, 0, 0, 0, 1, 5, 2, 2, 4, 1]);
  assert.equal(decodeCountryMesh(buffer, ['A']).ids[0], 'A');
  assert.throws(() => decodeCountryMesh(buffer, ['A', 'B']), /국가|identity|count/i);
});
