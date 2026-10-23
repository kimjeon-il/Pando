#!/usr/bin/env node
// Individual source object boundary for the native historical geometry recipe engine.
// All coordinate construction, topology, projection and winding live in C++.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const defaultRecipe = path.join(root, 'tools/historical-library/east-germany-1989.recipe.json');

export function verifySourceHashes(recipe, repositoryRoot = root) {
  for (const [sourceId, source] of Object.entries(recipe.sources)) {
    if (!source.sha256) throw new Error(`Missing pinned source SHA-256: ${sourceId}`);
    const sourcePath = path.join(repositoryRoot, source.path);
    const bytes = readFileSync(sourcePath).toString('utf8').replaceAll('\r\n', '\n');
    const actual = createHash('sha256').update(bytes).digest('hex').toUpperCase();
    if (actual !== source.sha256.toUpperCase()) {
      throw new Error(`Source SHA-256 mismatch for ${sourceId}: expected ${source.sha256}, got ${actual}`);
    }
  }
}

export function replaceRecipeGeometry(entity, recipe, geometry) {
  assert.equal(geometry?.type, 'MultiPolygon', 'C++ recipe output must be MultiPolygon');
  assert.ok(Array.isArray(geometry.coordinates) && geometry.coordinates.length > 0,
    'C++ recipe output is empty');
  assert.equal(entity.entityId, recipe.entityId, 'Recipe target identity mismatch');
  const versions = entity.geometryVersions.filter((version) => version.versionId === recipe.id);
  assert.equal(versions.length, 1, 'Recipe target version mismatch');
  assert.equal(versions[0].validFrom, recipe.referenceDate, 'Recipe target date mismatch');
  assert.equal(versions[0].validTo, recipe.referenceDate, 'Recipe target date mismatch');
  const provenance = recipe.resultSource;
  const importedId = entity.sourceInfo?.importProvenance?.versionIds?.[recipe.id];
  return {
    ...entity,
    geometryVersions: entity.geometryVersions.map((version) => version.versionId !== recipe.id ? version : {
      ...version,
      geometry,
      ...(provenance ? { sourceId: provenance.id, notes: provenance.notes,
        boundarySupplement: recipe.boundarySupplement } : {}),
    }),
    ...(provenance ? {sourceInfo: {
      ...entity.sourceInfo,
      title: provenance.title, license: provenance.license, notes: provenance.notes,
      sources: [...(entity.sourceInfo.sources || []).filter(source =>
        !provenance.sources.some(added => added.url === source.url)), ...provenance.sources],
      geometryRecipes: entity.sourceInfo.geometryRecipes.map(record =>
        [recipe.id, importedId].includes(record.id) ? {...record, sourceId: provenance.id, notes: provenance.notes} : record),
    }} : {}),
  };
}

export function sameRecipeGeometryWithinProjectionRounding(actual, expected) {
  if (actual?.type !== 'MultiPolygon' || expected?.type !== 'MultiPolygon') return false;
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index]))
    return false;
  const sameCoordinates = (left, right) => {
    if (typeof left === 'number' && typeof right === 'number')
      return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= 2e-12;
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => sameCoordinates(value, right[index]));
  };
  return sameCoordinates(actual.coordinates, expected.coordinates);
}

function parseArguments(argv) {
  let recipePath = defaultRecipe;
  let check = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--check') check = true;
    else if (argv[index] === '--recipe' && argv[index + 1]) recipePath = path.resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return { recipePath, check };
}

export function run(argv = process.argv.slice(2)) {
  const { recipePath, check } = parseArguments(argv);
  const recipe = JSON.parse(readFileSync(recipePath, 'utf8'));
  verifySourceHashes(recipe);
  const binary = process.env.PANDO_TERRITORIAL_RECIPE_BINARY;
  if (!binary || !existsSync(binary)) {
    throw new Error('PANDO_TERRITORIAL_RECIPE_BINARY must name a built pando-territorial-recipe executable');
  }
  const result = spawnSync(binary, [root, recipePath], {
    cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`C++ territorial recipe failed: ${result.stderr || result.error?.message || result.status}`);
  }
  if (result.stderr) process.stderr.write(result.stderr);
  const geometry = JSON.parse(result.stdout);
  const outputPath = path.join(root, recipe.output);
  const original = JSON.parse(readFileSync(outputPath, 'utf8'));
  const candidate = replaceRecipeGeometry(original, recipe, geometry);
  if (check) {
    const stored = original.geometryVersions.find((version) => version.versionId === recipe.id).geometry;
    assert.ok(sameRecipeGeometryWithinProjectionRounding(geometry, stored),
      `Historical library geometry is stale: ${recipe.output}`);
    const comparable = replaceRecipeGeometry(candidate, recipe, stored);
    assert.deepEqual(comparable, original, `Historical library metadata is stale: ${recipe.output}`);
  } else {
    writeFileSync(outputPath, `${JSON.stringify(candidate, null, 2)}\n`);
  }
  process.stdout.write(JSON.stringify({ geometryVersion: recipe.id,
    componentCount: geometry.coordinates.length, output: recipe.output, check }) + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { run(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
