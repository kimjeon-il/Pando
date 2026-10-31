import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareLSIBCoast } from '../../tools/gis/lsib-screen-native.mjs';

const cases = JSON.parse(await readFile(new URL('../fixtures/lsib-coast-oracle.json', import.meta.url), 'utf8'));
for (const fixture of cases) test(`coast: ${fixture.name}`, async () => {
  const input = structuredClone(fixture);
  if (fixture.error) await assert.rejects(prepareLSIBCoast(input), { code: 'LSIB_COAST_REJECTED', message: fixture.error });
  else assert.deepEqual(await prepareLSIBCoast(input), fixture.expected);
  assert.deepEqual(input, fixture);
});
