/* global process, URL, structuredClone, console */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const executable = process.argv[2];
assert.ok(executable, 'Compiled river_partition_probe path required');
const root = new URL('../../', import.meta.url);
const frozen = await import(new URL('tests/fixtures/shared-core/web-m97/lifecycle-source/assets/js/modules/river-territory-partition.js', root));
const clipperContext = { globalThis: {} };
vm.createContext(clipperContext);
vm.runInContext(fs.readFileSync(new URL('assets/js/vendor/polygon-clipping.min.js', root), 'utf8'), clipperContext);
const clipper = clipperContext.polygonClipping || clipperContext.globalThis.polygonClipping;
assert.ok(clipper, 'Frozen polygon oracle required');
const cases = JSON.parse(fs.readFileSync(new URL('tests/fixtures/shared-core/web-m972-river/synthetic-cases.json', root), 'utf8'));
const result = spawnSync(executable, [], { input: cases.map(row => JSON.stringify(row)).join('\n') + '\n', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
assert.equal(result.status, 0, result.stderr);
const actual = result.stdout.trim().split('\n').map(line => JSON.parse(line));
assert.equal(actual.length, cases.length);
for (let index = 0; index < cases.length; index += 1) {
  const row = cases[index], input = structuredClone(row.request);
  for (const donorIndex of row.liveDonorIndices || []) {
    const donor = input.donors[donorIndex];
    donor.geometryRevision = String(donor.countryId || '') + ':' + JSON.stringify(donor.geometry.coordinates || []);
  }
  const before = JSON.stringify(input);
  const expected = frozen.buildRiverTerritoryPartitions({ ...input, clipper });
  delete expected.diagnostics.computeMs;
  const received = actual[index];
  assert.equal(received.error, undefined, row.name + ': ' + received.error);
  delete received.result.diagnostics.computeMs;
  assert.deepEqual(received.result, expected, row.name + ': raw result');
  assert.deepEqual(received.composed, frozen.composeRiverBoundaryTerritoryComponents({
    components: row.components || [], candidates: expected.candidates, donorResults: expected.donorResults,
  }), row.name + ': composition');
  assert.equal(JSON.stringify(input), before, row.name + ': input unchanged');
}
console.log(`River C++ parity: ${cases.length} frozen synthetic cases passed.`);
