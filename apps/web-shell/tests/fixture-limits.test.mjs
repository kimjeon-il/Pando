import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertSmallProject } from '../fixture-limits.js';
import { tinyFixture } from '../fixture.mjs';

test('allows the real tiny fixture and rejects oversized geometry before admission', () => {
  const { project } = tinyFixture();
  assert.equal(assertSmallProject(project), project);
  project.geometries[0].geojson.coordinates[0] = Array.from({ length: 101 }, (_, index) => [index, 0]);
  assert.throws(() => assertSmallProject(project), /100/);
});
