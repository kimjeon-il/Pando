import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const native = process.env.PANDO_HYDRO_CONNECTIVITY_BINARY;
function fixture() {
  const parts = {
    1: [{ fid: 1, part: 0, points: [[0, 0], [1, 0]], aligned: false, system: '10' }],
    2: [{ fid: 2, part: 0, points: [[1.002, 0], [2, 0]], aligned: true, system: '10' }],
    3: [{ fid: 3, part: 0, points: [[0, 1], [1, 0]], aligned: false, system: '10' }],
  };
  const raw = {
    1: { region: 'eu', next: 2, start: [0, 0], end: [1, 0] },
    2: { region: 'eu', next: 0, start: [1, 0], end: [2, 0] },
    3: { region: 'eu', next: 2, start: [0, 1], end: [1, 0] },
  };
  return { parts, raw, region: 'eu' };
}
function run(input) {
  assert.ok(native, 'PANDO_HYDRO_CONNECTIVITY_BINARY must be set in native CI');
  const result = spawnSync(native, [], { input: JSON.stringify(input), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
const nativeTest = (name, fn) => test(name, { skip: !native }, fn);

nativeTest('converging tributaries share one aligned downstream port', () => {
  const input = fixture(), untouched = structuredClone(input);
  const result = run(input);
  assert.equal(result.changes.length, 2);
  assert.deepEqual(result.parts['1'][0].points.at(-1), [1.002, 0]);
  assert.deepEqual(result.parts['3'][0].points.at(-1), [1.002, 0]);
  assert.deepEqual(result.parts['2'][0].points[0], [1.002, 0]);
  assert.deepEqual(result.changes.map(row => row.fid), [1, 3]);
  assert.deepEqual(result.changes.map(row => row.sources), [[1, 3], [1, 3]]);
  assert.deepEqual(input, untouched);
  assert.deepEqual(run({ ...input, parts: result.parts }).changes, []);
});
nativeTest('aligned upstream anchor moves non-aligned downstream entry', () => {
  const input = fixture();
  input.parts['1'][0].aligned = true;
  input.parts['2'][0].aligned = false;
  const result = run(input);
  assert.deepEqual(result.parts['2'][0].points[0], [1, 0]);
  assert.deepEqual(result.parts['1'][0].points.at(-1), [1, 0]);
  assert.equal(result.changes.length, 1);
});
nativeTest('mismatched originals, conflicting border anchors, long gaps and systems never repair', () => {
  for (const mode of ['source', 'borders', 'distance', 'system']) {
    const input = fixture();
    if (mode === 'source') input.raw['1'].end = [0.9, 0];
    if (mode === 'borders') input.parts['1'][0].aligned = true;
    if (mode === 'distance') input.parts['2'][0].points[0] = [1.5, 0];
    if (mode === 'system') input.parts['3'][0].system = 'other';
    const result = run(input);
    assert.deepEqual(result.changes, [], mode);
    assert.deepEqual(result.parts, input.parts, mode);
  }
});
nativeTest('region gate blocks accidental cross-region repair', () => {
  const input = fixture(); input.region = 'as';
  const result = run(input);
  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.parts, input.parts);
});
nativeTest('out-of-order split reaches retain unique entry and exit ports', () => {
  const input = fixture();
  input.parts['2'] = [
    { fid: 2, part: 1, points: [[1.5, 0], [2, 0]], aligned: true, system: '10' },
    { fid: 2, part: 0, points: [[1.002, 0], [1.5, 0]], aligned: true, system: '10' },
  ];
  const result = run(input);
  assert.equal(result.changes.length, 2);
  assert.deepEqual(result.parts['1'][0].points.at(-1), [1.002, 0]);
  assert.deepEqual(result.parts['2'][0].points[0], [1.5, 0]);
  assert.deepEqual(result.parts['2'][1].points[0], [1.002, 0]);
});
nativeTest('microdegree quantization produces exact identical confluence coordinates', () => {
  const input = fixture();
  input.parts['2'][0].points[0] = [1.000001, 0];
  const result = run(input);
  assert.deepEqual(result.parts['1'][0].points.at(-1), [1.000001, 0]);
  assert.deepEqual(result.parts['3'][0].points.at(-1), [1.000001, 0]);
});
nativeTest('reject malformed source geometry instead of emitting partial output', () => {
  const input = fixture();
  input.parts['2'][0].points[0] = [181, 0];
  const result = spawnSync(native, [], { input: JSON.stringify(input), encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid Hydro coordinate/);
  assert.equal(result.stdout, '');
});
