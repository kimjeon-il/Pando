import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { calculateReferenceImage } from '../../assets/js/modules/reference-image-core.js';
import { buildReferenceImageCalibrationWarp, buildReferenceImageMesh } from '../../assets/js/modules/reference-image-georef.js';

function close(actual, expected, path = '') {
  if (typeof expected === 'number') { assert.ok(Math.abs(actual - expected) < 1e-10, path); return; }
  if (Array.isArray(expected)) { assert.equal(actual.length, expected.length, path); expected.forEach((value, index) => close(actual[index], value, path + '[' + index + ']')); return; }
  if (expected && typeof expected === 'object') { for (const [key, value] of Object.entries(expected)) close(actual[key], value, path + '.' + key); return; }
  assert.equal(actual, expected, path);
}

test('shared native and Web calibration retain frozen pre-port geometry fixtures', () => {
  const cases = JSON.parse(readFileSync(new URL('../../native/tests/fixtures/reference-calibration.json', import.meta.url)));
  for (const { input, expected } of cases) {
    const snapshot = structuredClone(input);
    const actual = calculateReferenceImage('calibration', input);
    assert.equal(actual.calibrationOk, expected.ok, input.id);
    assert.equal(actual.calibrationReason, expected.reason, input.id);
    close(actual.mesh, expected.mesh, input.id);
    const warp = buildReferenceImageCalibrationWarp({ ...input, mode: input.warpMode });
    if (warp.ok) close(buildReferenceImageMesh(warp), expected.mesh, input.id + '.adapter');
    assert.deepEqual(input, snapshot);
  }
});

test('shared capability rejects an unknown operation with its technical error code', () => {
  assert.throws(() => calculateReferenceImage('retired-operation', {}), error =>
    error.code === 'PL-REFERENCE-CALCULATION' && /Unknown reference image calculation/.test(error.message));
});

test('nonfinite image coordinates stay invalid across the WASM transport', () => {
  const result = calculateReferenceImage('normalize', [
    { id: 'nan', image: [NaN, 0], coordinate: [10, 20] },
    { id: 'infinite', image: [0, Infinity], coordinate: [10, 20] },
  ]);
  assert.deepEqual(result, []);
});
