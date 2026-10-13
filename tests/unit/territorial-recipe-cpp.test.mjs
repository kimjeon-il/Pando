import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const recipePath = path.join(root, 'tools/historical-library/east-germany-1989.recipe.json');
const recipe = JSON.parse(readFileSync(recipePath, 'utf8'));
const lineage = JSON.parse(readFileSync(path.join(root, recipe.output), 'utf8'));
const oracle = lineage.entities
  .find((entity) => entity.entityId === recipe.entityId)
  ?.geometryVersions.find((version) => version.versionId === recipe.id)?.geometry;
const binary = process.env.PANDO_TERRITORIAL_RECIPE_BINARY;

test('pinned DDR recipe inputs and source geometry oracle are present', () => {
  assert.ok(oracle, 'DDR geometry oracle is missing');
  assert.equal(oracle.type, 'MultiPolygon');
  for (const [sourceId, source] of Object.entries(recipe.sources)) {
    const bytes = readFileSync(path.join(root, source.path)).toString('utf8').replaceAll('\r\n', '\n');
    const actual = createHash('sha256').update(bytes).digest('hex').toUpperCase();
    assert.equal(actual, source.sha256, `${sourceId} source bytes changed`);
  }
});

test('C++ DDR recipe exactly reproduces every oracle component and coordinate', {
  skip: !binary || !existsSync(binary) ? 'Set PANDO_TERRITORIAL_RECIPE_BINARY to the built C++ target' : false,
}, () => {
  const result = spawnSync(binary, [root, recipePath], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.deepEqual(JSON.parse(result.stdout), oracle);
});
