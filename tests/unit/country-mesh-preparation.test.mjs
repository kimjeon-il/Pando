import '../helpers/spherical-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import "../../shared/frontend/js/workers/gpu-mesh-core.js";
import { createCountryMeshPreparation } from "../../shared/frontend/js/modules/country-mesh-preparation.js";
const engine = globalThis.PandoLabGpuMeshCore;
const shape = (id, size = 2) => ({ id, geometry: { type: 'Polygon', coordinates: [[[0,0],[size,0],[size,2],[0,2],[0,0]]] } });
const context = { throwIfCancelled() {} };
test('prepared country parts keep exact engine output and reuse only unchanged shapes', async () => {
  const store = createCountryMeshPreparation({ engine });
  const features = [shape('A'), shape('B', 3)];
  const first = await store.build(features, context);
  const expected = engine.buildGpuMeshFeatures(features);
  for (const [key, value] of Object.entries(expected)) {
    if (ArrayBuffer.isView(value)) assert.deepEqual(first[key], value, key);
  }
  assert.deepEqual(first.strokeOwnerRanges, expected.strokeOwnerRanges);
  const copied = structuredClone(first, { transfer: [first.positions.buffer] });
  assert.equal(first.positions.byteLength, 0);
  const second = await store.build([shape('renamed', 3), shape('A')], context);
  assert.equal(second.preparation.builtCount, 0); assert.equal(second.preparation.reusedCount, 2);
  assert.deepEqual(second.countryIds, ['renamed', 'A']);
  assert.equal(second.positions.length, copied.positions.length);
  const changed = await store.build([shape('A', 4), shape('B', 3)], context);
  assert.equal(changed.preparation.builtCount, 1); assert.equal(changed.preparation.reusedCount, 1);
});
test('cache budget and cancellation stay bounded between geometry jobs', async () => {
  const tiny = createCountryMeshPreparation({ engine, byteBudget: 1 });
  await tiny.build([shape('A')], context);
  assert.equal((await tiny.build([shape('A')], context)).preparation.builtCount, 1);
  let cancelled = false;
  const store = createCountryMeshPreparation({ engine,
    yieldTask: async () => { cancelled = true; } });
  await assert.rejects(store.build([shape('A')], { throwIfCancelled() { if (cancelled) throw Error('cancelled'); } }), /cancelled/);
});

test('empty country slots retain their ranges and full-world bounds', async () => {
  const store = createCountryMeshPreparation({ engine });
  const features = [{ id: 'empty', geometry: null }, shape('A')];
  const mesh = await store.build(features, context);
  const expected = engine.buildGpuMeshFeatures(features);
  for (const key of ['countryTriangleRanges', 'countryBoundaryRanges', 'countryBounds', 'countryBoundsFlags']) assert.deepEqual(mesh[key], expected[key]);
});
