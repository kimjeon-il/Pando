import assert from 'node:assert/strict';
import test from 'node:test';
import { compareObservations, normalizeGeometry, classifyResult, evaluateGates } from '../../tools/parity/contract.mjs';

const polygon = { type: 'Polygon', coordinates: [[[0, 0], [3, 0], [3, 2], [0, 0]]] };
test('reports exact stage and field for ownership, selection, history, dirty and coordinate changes', () => {
  const expected = { steps: [{ owner: 'A', primary: 'A', undo: 1, dirty: true, geometry: polygon }] };
  for (const [key, value] of [['owner', 'B'], ['primary', null], ['undo', 2], ['dirty', false]]) {
    const app = structuredClone(expected); app.steps[0][key] = value;
    const rows = compareObservations(expected, app, expected);
    assert.ok(rows.some(row => row.path === `/steps/0/${key}` && row.app === value));
  }
  const app = structuredClone(expected); app.steps[0].geometry.coordinates[0][1][0] += 1e-12;
  assert.ok(compareObservations(expected, app, expected).some(row => row.path.endsWith('/coordinates/0/1/0')));
});
test('both implementations giving the same wrong result still fails the independent expectation', () => {
  assert.equal(compareObservations({ owner: 'B' }, { owner: 'B' }, { owner: 'A' }).length, 1);
});
test('missing, null, array order and extra fields are not hidden', () => {
  assert.equal(compareObservations({}, { value: null }, {}).length, 1);
  assert.equal(compareObservations([1, 2], [2, 1], [1, 2]).length, 2);
  assert.equal(compareObservations({ extra: 1 }, { extra: 1 }, {}).length, 1);
});
test('geometry equivalence is opt-in and never rounds coordinates or removes holes', () => {
  const rotated = { type: 'Polygon', coordinates: [[[3, 2], [3, 0], [0, 0], [3, 2]]] };
  assert.notDeepEqual(polygon, rotated);
  const policy = { ringStart: true, ringDirection: true, holeOrder: true, polygonOrder: true };
  assert.deepEqual(normalizeGeometry(polygon, policy), normalizeGeometry(rotated, policy));
  assert.deepEqual(normalizeGeometry(rotated, {}), rotated);
  const moved = structuredClone(polygon); moved.coordinates[0][1][0] += 1e-12;
  assert.notDeepEqual(normalizeGeometry(moved, policy), normalizeGeometry(polygon, policy));
  const holed = structuredClone(polygon); holed.coordinates.push([[1, .2], [2, .2], [2, .4], [1, .2]]);
  assert.notDeepEqual(normalizeGeometry(holed, policy), normalizeGeometry(polygon, policy));
  assert.throws(() => normalizeGeometry({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 1]]] }, policy), /closed/);
});
test('known differences match exact observations; expanded or resolved differences require review', () => {
  const differences = compareObservations({ value: 1 }, { value: 2 }, { value: 1 });
  const known = { differences, reason: 'Recorded baseline difference', caseId: 'case-1' };
  assert.equal(classifyResult('case-1', differences, known), 'KNOWN_DIFFERENCE');
  assert.equal(classifyResult('case-1', compareObservations({ value: 1 }, { value: 3 }, { value: 1 }), known), 'FAIL');
  assert.equal(classifyResult('case-2', differences, known), 'FAIL');
  assert.equal(classifyResult('case-1', [], known), 'FAIL');
});
test('regression and complete parity gates cannot mistake skipped, partial, stale or known results for parity', () => {
  const context = { complete: true, provenanceVerified: true, unclassifiedPaths: [] };
  assert.deepEqual(evaluateGates([{ status: 'PASS' }], context), { regression: 'PASS', behavioral: 'PASS' });
  assert.deepEqual(evaluateGates([{ status: 'KNOWN_DIFFERENCE' }], context), { regression: 'PASS', behavioral: 'BLOCKED' });
  for (const status of ['NOT_RUN', 'UNSUPPORTED', 'ERROR', 'FAIL']) {
    assert.deepEqual(evaluateGates([{ status }], context), { regression: 'BLOCKED', behavioral: 'BLOCKED' });
  }
  assert.equal(evaluateGates([{ status: 'PASS' }], { ...context, complete: false }).behavioral, 'BLOCKED');
  assert.equal(evaluateGates([{ status: 'PASS' }], { ...context, provenanceVerified: false }).regression, 'BLOCKED');
  assert.equal(evaluateGates([{ status: 'PASS' }], { ...context, unclassifiedPaths: ['core/new.cpp'] }).regression, 'BLOCKED');
  assert.equal(evaluateGates([], context).behavioral, 'BLOCKED');
});
