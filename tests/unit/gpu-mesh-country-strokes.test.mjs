import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function loadClassic(relativePath, globalName) {
  const filePath = path.join(root, relativePath);
  vm.runInThisContext(fs.readFileSync(filePath, 'utf8'), { filename: filePath });
  const value = globalThis[globalName];
  if (!value) throw new Error(`${globalName} was not initialized`);
  return value;
}

const earcut = loadClassic('assets/js/vendor/earcut.min.js', 'earcut');
const meshCore = loadClassic('assets/js/workers/gpu-mesh-core.js', 'PandoLabGpuMeshCore');

const square = (id, x) => ({
  type: 'Feature',
  id,
  properties: { name: id },
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0],
    ]],
  },
});

test('GPU mesh worker packets include stable contiguous country stroke owner ranges', () => {
  const mesh = meshCore.buildGpuMeshFeatures([
    square('AAA', 0),
    square('BBB', 3),
  ], earcut, { validate: true });

  assert.ok(mesh.strokeStartsEnds instanceof Float32Array);
  assert.equal(mesh.strokeStartsEnds.length, mesh.lineIndices.length * 2);
  assert.deepEqual(mesh.strokeOwnerRanges, {
    AAA: { first: 0, count: 4 },
    BBB: { first: 4, count: 4 },
  });

  for (const [id, range] of Object.entries(mesh.strokeOwnerRanges)) {
    const countryIndex = mesh.countryIds.indexOf(id);
    assert.ok(countryIndex >= 0);
    for (let segment = range.first; segment < range.first + range.count; segment += 1) {
      const startIndex = mesh.lineIndices[segment * 2];
      const endIndex = mesh.lineIndices[segment * 2 + 1];
      assert.equal(mesh.countryIndices[startIndex], countryIndex);
      assert.equal(mesh.countryIndices[endIndex], countryIndex);
      assert.deepEqual(
        Array.from(mesh.strokeStartsEnds.slice(segment * 4, segment * 4 + 4)),
        [
          mesh.positions[startIndex * 2] * 1e-6,
          mesh.positions[startIndex * 2 + 1] * 1e-6,
          mesh.positions[endIndex * 2] * 1e-6,
          mesh.positions[endIndex * 2 + 1] * 1e-6,
        ],
      );
    }
  }
});
