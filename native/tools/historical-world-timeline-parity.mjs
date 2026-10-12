import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const [probe, root] = process.argv.slice(2);
assert(probe && root, 'Usage: node tools/historical-world-timeline-parity.mjs <probe-exe> <world-root>');
const result = spawnSync(resolve(probe), [resolve(root)], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
assert.ifError(result.error);
assert.equal(result.status, 0, result.stderr || 'Native resolver probe failed');
const actual = JSON.parse(result.stdout);
for (const month of actual.months) month.entities.sort((a, b) => a.entityId.localeCompare(b.entityId, 'en'));
const expected = JSON.parse(readFileSync(resolve(root, 'historical-world/v1/expected-trace.json'), 'utf8'));
assert.equal(expected.schemaVersion, 1, 'Unsupported shared trace schema');
assert.deepEqual(actual.months, expected.months);
console.log(`Historical world parity: ${actual.months.length} months; native identities, source versions, parents, roots, shapes and Crimea picks match the shared trace.`);
