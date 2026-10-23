import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { replaceRecipeGeometry, sameRecipeGeometryWithinProjectionRounding, verifySourceHashes }
  from '../../tools/build-territorial-geometry.mjs';

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
  const version = result.geometryVersions.find((item) => item.versionId === recipe.id);
  assert.deepEqual(version.geometry, geometry);
  assert.deepEqual(lineage, before, 'candidate generation must not mutate the source');
  version.geometry = before.geometryVersions.find((item) => item.versionId === recipe.id).geometry;
  assert.deepEqual(result, before, 'all curated identities, metadata, other versions and relations must survive');
});

test('projection rounding accepts submicroscopic drift while rejecting changed geometry', () => {
  const stored = lineage.geometryVersions.find((version) => version.versionId === recipe.id).geometry;
  const rounded = structuredClone(stored);
  rounded.coordinates[0][0][0][0] += 1e-12;
  assert.equal(sameRecipeGeometryWithinProjectionRounding(rounded, stored), true);
  rounded.coordinates[0][0][0][0] += 1e-8;
  assert.equal(sameRecipeGeometryWithinProjectionRounding(rounded, stored), false);
  rounded.coordinates[0][0].pop();
  assert.equal(sameRecipeGeometryWithinProjectionRounding(rounded, stored), false);
});

// The approved rollback must survive a later explicit recipe regeneration.
test('DDR recipe retains the original baseline and excludes rejected precision supplements', () => {
  assert.deepEqual(recipe.operations.map(operation => operation.id), [
    'east-five-states-and-berlin', 'west-berlin-mask',
    'modern-east-with-amt-neuhaus', 'gdr-candidate', 'gdr-final',
  ]);
  assert.deepEqual(Object.keys(recipe.sources).sort(), [
    'amtNeuhaus', 'berlinLand', 'berlinWall', 'canonicalCountries', 'naturalEarthAdmin1',
  ]);
  assert.equal(Object.hasOwn(recipe, 'boundarySupplement'), false);
  assert.equal(Object.hasOwn(recipe, 'resultSource'), false);
  assert.equal(recipe.output, 'assets/data/territorial-entities/source/countries/state-deutsche-demokratische-republik.json');
});

test('native recipe launcher preserves identity and curated fields while recording the selected geometry provenance', () => {
  const recipe = {
    ...JSON.parse(readFileSync(path.join(root, 'tools/historical-library/east-germany-1989.recipe.json'), 'utf8')),
    boundarySupplement: { testOnly: true },
    resultSource: {
      id: 'test-only-provenance', title: 'Test fixture', license: 'Test fixture', notes: 'Test-only source update',
      sources: [{ url: 'https://example.invalid/test-only-provenance', title: 'Test fixture' }],
    },
  };
  const geometry = { type: 'MultiPolygon', coordinates: [[[[0, 0], [0, 1], [1, 0], [0, 0]]]] };
  const before = structuredClone(lineage);
  const result = replaceRecipeGeometry(lineage, recipe, geometry);
  const version = result.geometryVersions.find((item) => item.versionId === recipe.id);
  assert.deepEqual(version.geometry, geometry);
  assert.deepEqual(lineage, before, 'candidate generation must not mutate the source');
  assert.equal(version.sourceId, recipe.resultSource.id);
  assert.deepEqual(version.boundarySupplement, recipe.boundarySupplement);
  assert.equal(result.sourceInfo.sources.filter(source=>source.url===recipe.resultSource.sources[0].url).length,1);
  assert.deepEqual(replaceRecipeGeometry(result,recipe,geometry),result,'provenance generation must be idempotent');
  for(const key of ['sourceId','notes','boundarySupplement']) {
    const original=before.geometryVersions.find((item)=>item.versionId===recipe.id);
    if(Object.hasOwn(original,key))version[key]=original[key];else delete version[key];
  }
  result.sourceInfo=before.sourceInfo;
  version.geometry = before.geometryVersions.find((item) => item.versionId === recipe.id).geometry;
  assert.deepEqual(result, before, 'all curated identities, metadata, other versions and relations must survive');
});
