import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareLSIBTripoint } from '../../tools/gis/lsib-screen-native.mjs';

const fixtures = JSON.parse(await readFile(new URL('../fixtures/lsib-tripoint-oracle.json', import.meta.url), 'utf8'));

function assertEquivalent(actual, expected) {
  assert.deepEqual(actual.geometries, expected.geometries);
  assert.equal(actual.sections.length, expected.sections.length);
  for (let i = 0; i < actual.sections.length; i++) {
    const a = actual.sections[i], e = expected.sections[i];
    assert.deepEqual(Object.keys(a).sort(), Object.keys(e).sort());
    for (const key of Object.keys(e)) {
      if (typeof e[key] === 'number') assert.ok(Math.abs(a[key] - e[key]) < 1e-10, `${i}.${key}: ${a[key]} vs ${e[key]}`);
      else assert.deepEqual(a[key], e[key]);
    }
  }
}

for (const fixture of fixtures) test(`tripoint: ${fixture.name}`, async () => {
  const input = structuredClone(fixture);
  if (fixture.error) await assert.rejects(prepareLSIBTripoint(input), { code: 'LSIB_TRIPOINT_REJECTED', message: fixture.error });
  else assertEquivalent(await prepareLSIBTripoint(input), fixture.expected);
  assert.deepEqual(input, fixture);
});

test('tripoint: selected AUT/LIE/CHE source matches the Python result', { skip: !process.env.PANDO_LSIB_TRIPOINT_ORACLE }, async () => {
  const fixture = JSON.parse(await readFile(process.env.PANDO_LSIB_TRIPOINT_ORACLE, 'utf8'));
  assertEquivalent(await prepareLSIBTripoint(fixture), fixture.expected);
});
