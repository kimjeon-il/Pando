import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareCountryStroke, countryStrokeTransferables } from '../../assets/js/modules/country-stroke-preparation.js';
import { buildGpuStrokeInstances } from '../../assets/js/modules/gpu-stroke-geometry.js';
import { createRingHitTester } from '../../assets/js/modules/ring-hit-test.js';
import { decodeCountryMesh } from '../../assets/js/modules/country-mesh-codec.js';

test('Worker preparation preserves exact stroke instances and owner layout', () => {
  const startsEnds = new Float32Array([0, 0, 1, 0, 1, 0, 1, 1, 10, 0, 11, 0]);
  const ownerRanges = { A: { first: 0, count: 2 }, B: { first: 2, count: 1 } };
  const expected = buildGpuStrokeInstances(startsEnds, null, ownerRanges);
  const mesh = { positions: new Int32Array([0, 0, 1e6, 0, 1e6, 1e6, 10e6, 0, 11e6, 0]), countryIndices: new Uint16Array([0, 0, 0, 1, 1]), lineIndices: new Uint32Array([0, 1, 1, 2, 3, 4]) };
  const actual = prepareCountryStroke(mesh, ['A', 'B']);
  for (const key of Object.keys(expected)) assert.deepEqual(actual[key], expected[key], key);
  assert.deepEqual(actual.startsEnds, startsEnds);
  const transfers = countryStrokeTransferables(actual);
  assert.equal(new Set(transfers).size, 3);
  const clone = structuredClone(actual, { transfer: transfers });
  assert.equal(actual.instances.byteLength, 0);
  assert.deepEqual(clone.instances, expected.instances);
});

test('canonical hit testing reads rings without normalizing or copying', () => {
  const ring = [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]];
  const tester = createRingHitTester(() => { throw new Error('canonical ring must not normalize'); });
  for (let i = 0; i < 1000; i += 1) assert.equal(tester.contains([1, 1], ring), true);
  assert.equal(tester.contains([3, 1], ring), false);
  assert.equal(tester.contains([0, 1], ring), true);
  assert.equal(tester.stats().preparationCount, 1);
  tester.invalidate({ coordinates: [ring] });
  tester.contains([1, 1], ring);
  assert.equal(tester.stats().preparationCount, 2);
});

test('open ring normalization is cached, not repeated for hover', () => {
  let calls = 0;
  const ring = [[0, 0], [2, 0], [0, 2]];
  const tester = createRingHitTester(raw => { calls += 1; return [...raw.map(p => p.slice()), raw[0].slice()]; });
  assert.equal(tester.contains([0.5, 0.5], ring), true);
  assert.equal(tester.contains([0.6, 0.5], ring), true);
  assert.equal(calls, 1);
  assert.throws(() => decodeCountryMesh(new ArrayBuffer(4)), /Invalid country mesh/);
});
