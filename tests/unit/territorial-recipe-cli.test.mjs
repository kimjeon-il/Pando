import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { replaceRecipeGeometry, verifySourceHashes } from '../../tools/build-territorial-geometry.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const recipe = JSON.parse(readFileSync(path.join(root, 'tools/historical-library/east-germany-1989.recipe.json'), 'utf8'));
const lineage = JSON.parse(readFileSync(path.join(root, recipe.output), 'utf8'));

test('native recipe launcher checks every pinned source before generation', () => {
  assert.doesNotThrow(() => verifySourceHashes(recipe, root));
  assert.throws(() => verifySourceHashes({ sources: { changed: {
    ...recipe.sources.amtNeuhaus, sha256: '0'.repeat(64),
  } } }, root), /Source SHA-256 mismatch for changed/);
});

test('native recipe launcher changes only the selected geometry version', () => {
  const geometry = { type: 'MultiPolygon', coordinates: [[[[0, 0], [0, 1], [1, 0], [0, 0]]]] };
  const before = structuredClone(lineage);
  const result = replaceRecipeGeometry(lineage, recipe, geometry);
  const target = result.entities.find((entity) => entity.entityId === recipe.entityId);
  const version = target.geometryVersions.find((item) => item.versionId === recipe.id);
  assert.deepEqual(version.geometry, geometry);
  assert.deepEqual(lineage, before, 'candidate generation must not mutate the source');
  version.geometry = before.entities.find((entity) => entity.entityId === recipe.entityId)
    .geometryVersions.find((item) => item.versionId === recipe.id).geometry;
  assert.deepEqual(result, before, 'all curated identities, metadata, other versions and relations must survive');
});
