import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { calculateReferenceImage } from '../../plugins/pando-map-tools/lib/analysis/core.mjs';
import { buildReferenceImageCalibrationWarp, buildReferenceImageProjectiveWarpFromQuad, buildReferenceImageMesh } from '../../plugins/pando-map-tools/lib/analysis/georef.mjs';

function close(actual, expected, path = '') {
  if (typeof expected === 'number') { assert.ok(Math.abs(actual - expected) < 1e-10, path); return; }
  if (Array.isArray(expected)) { assert.equal(actual.length, expected.length, path); expected.forEach((value, index) => close(actual[index], value, path + '[' + index + ']')); return; }
  if (expected && typeof expected === 'object') { for (const [key, value] of Object.entries(expected)) close(actual[key], value, path + '.' + key); return; }
  assert.equal(actual, expected, path);
}

test('shared native and Web calibration retain frozen pre-port geometry fixtures', () => {
  const cases = JSON.parse(readFileSync(new URL('../../tests/fixtures/shared-core/reference-calibration.json', import.meta.url)));
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

test('prepared projection retains invalid-point behavior and immutable mesh results', () => {
  const warp = buildReferenceImageProjectiveWarpFromQuad([[10, 40], [20, 40], [20, 30], [10, 30]]);
  assert.equal(warp.ok, true);
  assert.equal(warp.project([NaN, 0]), null);
  assert.equal(warp.project([0, Infinity]), null);
  assert.equal(warp.project(null), null);
  const first = buildReferenceImageMesh(warp, { columns: 3, rows: 2 });
  const again = buildReferenceImageMesh(warp, { columns: 3, rows: 2 });
  assert.deepEqual(first, again);
  assert.equal(first.vertices.length, 12);
  assert.ok(Object.isFrozen(first.vertices[0].coordinate));
  assert.throws(() => { first.vertices[0].coordinate[0] = 999; }, TypeError);
  assert.deepEqual(warp.project([0, 0]), first.vertices[0].coordinate);
});

test('immutable mesh layout reuse never reuses coordinates from another warp', () => {
  const a = buildReferenceImageProjectiveWarpFromQuad([[10,40],[20,40],[20,30],[10,30]]);
  const b = buildReferenceImageProjectiveWarpFromQuad([[30,40],[40,40],[40,30],[30,30]]);
  const options = { columns: 3, rows: 2 };
  const first = buildReferenceImageMesh(a, options), second = buildReferenceImageMesh(b, options);
  assert.deepEqual(first.triangles, second.triangles);
  assert.deepEqual(first.vertices.map(v=>v.uv), second.vertices.map(v=>v.uv));
  assert.notDeepEqual(first.vertices.map(v=>v.coordinate), second.vertices.map(v=>v.coordinate));
  assert.throws(()=>{second.triangles[0][0]=999;},TypeError);
  assert.throws(()=>{second.vertices[0].uv[0]=999;},TypeError);
  assert.deepEqual(first, buildReferenceImageMesh(a, options));
});

test('disabled linear constraints do not change the calibration result', () => {
  const cases = JSON.parse(readFileSync(new URL('../../tests/fixtures/shared-core/reference-calibration.json', import.meta.url)));
  for(const {input} of cases) {
    const plain = {...input,linearConstraints:[]};
    const disabled = {...plain,linearConstraints:[{id:'ignored',enabled:false,image:[[0,0],[1,1]],coordinates:[[0,0],[5,5]]}]};
    assert.deepEqual(calculateReferenceImage('calibrationWarp', plain), calculateReferenceImage('calibrationWarp', disabled));
  }
});
