import assert from 'node:assert/strict';
import test from 'node:test';
import { loadVerifiedCore } from '../helpers/node-core-wasm-loader.mjs';

const box = (x, y, w, h) => [[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]]];
test('shared polygon operation owns multi-operand union, holes and empty intersection', async () => {
  const core = await loadVerifiedCore();
  const a = box(0,0,2,2), b = box(1,0,2,2);
  const union = core.polygonOperation('union', [a,b], false);
  assert.deepEqual(union, [[[[0,0],[3,0],[3,2],[0,2],[0,0]]]]);
  const hole = core.polygonOperation('difference', [box(0,0,5,5),box(1,1,1,1)], false);
  assert.equal(hole.length,1);
  assert.equal(hole[0].length,2);
  assert.deepEqual(core.polygonOperation('intersection',[a,box(10,10,1,1)],false),[]);
  assert.deepEqual(a,box(0,0,2,2));
});


test('WASM wrapping preserves the current baseline and explicit winding corrections', async () => {
  const { readFileSync } = await import('node:fs');
  const core = await loadVerifiedCore();
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/p6/wrapping-baseline.json', import.meta.url)));
  const corrections = new Map(JSON.parse(readFileSync(new URL('../fixtures/p6/wrapping-corrections.json', import.meta.url))).cases.map(row => [row.id, row.expected]));
  for (const row of fixture.cases.filter(row => row.operation === 'wrap')) {
    assert.deepEqual(JSON.parse(core.wrapPolygonGeometry(JSON.stringify(row.input))), corrections.get(row.id) ?? row.expected, row.id);
  }
});

test('cut and wrapping failures retain technical JavaScript errors', async () => {
  const core = await loadVerifiedCore();
  assert.throws(() => core.wrapPolygonGeometry('{'), error => error instanceof Error && error.code === 'PL-GEOMETRY-CALCULATION');
  assert.throws(() => new core.PreparedCutGeometry('{'), error => error instanceof Error && error.code === 'PL-CUT-CALCULATION');
});

test('subdivided wide shells and holes have canonical winding and preserve planar area', async () => {
  const { readFileSync } = await import('node:fs');
  const core = await loadVerifiedCore();
  const baseline = JSON.parse(readFileSync(new URL('../fixtures/p6/wrapping-baseline.json', import.meta.url))).cases;
  const corrections = JSON.parse(readFileSync(new URL('../fixtures/p6/wrapping-corrections.json', import.meta.url))).cases;
  const area = geometry => (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates)
    .reduce((sum, polygon) => sum + polygon.reduce((part, ring, index) => part + (index ? -1 : 1)
      * Math.abs(ring.slice(1).reduce((value, point, i) => value + ring[i][0] * point[1] - point[0] * ring[i][1], 0) / 2), 0), 0);
  for (const row of corrections) {
    const old = baseline.find(old => old.id === row.id), input = old.input;
    const before = structuredClone(input);
    const result = row.operation === 'wrap' ? JSON.parse(core.wrapPolygonGeometry(JSON.stringify(input))) : core.normalizePolygonGeometry(input, true);
    assert.deepEqual(result, row.expected, row.id);
    assert.equal(core.hasCanonicalPolygonWinding(result), true, row.id);
    assert.equal(core.hasCanonicalPolygonWinding(old.expected), false, row.id + ' corrects a formerly invalid result');
    assert.equal(area(result), area(old.expected), row.id + ' preserves area');
    assert.deepEqual(input, before);
  }
});
