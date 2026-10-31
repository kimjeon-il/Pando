import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeLSIBUnion } from '../../tools/gis/lsib-screen-native.mjs';

const cases = JSON.parse(await readFile(new URL('../fixtures/lsib-union-oracle.json', import.meta.url), 'utf8'));
for (const [index, fixture] of cases.entries()) test(`line union matches Python: ${index}`, async () => {
  assert.deepEqual(await mergeLSIBUnion(fixture.geometries), fixture.expected);
});
test('line union rejects missing sources', async () => {
  await assert.rejects(mergeLSIBUnion([]), /source/);
});
