import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { sameRecipeGeometryWithinProjectionRounding } from '../../tools/build-territorial-geometry.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const recipePath = path.join(root, 'tools/historical-library/east-germany-1989.recipe.json');
const recipe = JSON.parse(readFileSync(recipePath, 'utf8'));
const lineage = JSON.parse(readFileSync(path.join(root, recipe.output), 'utf8'));
const oracle = lineage.geometryVersions.find((version) => version.versionId === recipe.id)?.geometry;
const binary = process.env.PANDO_TERRITORIAL_RECIPE_BINARY;

function comparisonSummary(actual, expected) {
  const summary = { numberDifferences: 0, maximumCoordinateDifference: 0, differencesAbove1eMinus10: 0, structuralDifferences: [] };
  const visit = (left, right, path) => {
    if (typeof left === 'number' && typeof right === 'number') {
      const difference = Math.abs(left - right);
      if (difference) summary.numberDifferences += 1;
      summary.maximumCoordinateDifference = Math.max(summary.maximumCoordinateDifference, difference);
      if (difference > 1e-10) summary.differencesAbove1eMinus10 += 1;
      return;
    }
    if (Array.isArray(left) && Array.isArray(right)) {
      if (left.length !== right.length && summary.structuralDifferences.length < 8)
        summary.structuralDifferences.push(`${path}.length: ${left.length} vs ${right.length}`);
      for (let index = 0; index < Math.min(left.length, right.length); index += 1)
        visit(left[index], right[index], `${path}[${index}]`);
      return;
    }
    if (left && right && typeof left === 'object' && typeof right === 'object') {
      const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
      for (const key of keys) visit(left[key], right[key], `${path}.${key}`);
      return;
    }
    if (!Object.is(left, right) && summary.structuralDifferences.length < 8)
      summary.structuralDifferences.push(`${path}: ${String(left)} vs ${String(right)}`);
  };
  visit(actual, expected, 'geometry');
  return summary;
}

test('pinned DDR recipe inputs and source geometry oracle are present', () => {
  assert.ok(oracle, 'DDR geometry oracle is missing');
  assert.equal(oracle.type, 'MultiPolygon');
  for (const [sourceId, source] of Object.entries(recipe.sources)) {
    const bytes = readFileSync(path.join(root, source.path)).toString('utf8').replaceAll('\r\n', '\n');
    const actual = createHash('sha256').update(bytes).digest('hex').toUpperCase();
    assert.equal(actual, source.sha256, `${sourceId} source bytes changed`);
  }
});

test('C++ DDR recipe preserves every component and coordinate within projection rounding', {
  skip: !binary || !existsSync(binary) ? 'Set PANDO_TERRITORIAL_RECIPE_BINARY to the built C++ target' : false,
}, () => {
  const result = spawnSync(binary, [root, recipePath], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const actual = JSON.parse(result.stdout);
  assert.ok(sameRecipeGeometryWithinProjectionRounding(actual, oracle),
    JSON.stringify(comparisonSummary(actual, oracle)));
});
