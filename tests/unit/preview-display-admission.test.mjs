import assert from 'node:assert/strict';
import test from 'node:test';
import * as previewPolicy from '../../assets/js/modules/project-preview-policy.js';
import { validateGeometry } from '../../assets/js/modules/geometry-validation.js';
import { inspectTopologyPreviewFeatures } from '../../assets/js/modules/project-preview-topology.js';
import '../../assets/js/modules/polygon-clipping-core.js';

const inspectCandidate = features => inspectTopologyPreviewFeatures(features, { validateGeometry, clipper: globalThis.polygonClipping });
const admit = (source, candidate) => previewPolicy.validatePreviewDisplay(source, candidate, { inspectCandidate });

const row = (id, ring) => ({ id, geometry: { type: 'Polygon', coordinates: [ring] } });
const base = [[0,0],[1,0],[1,1],[0.5,1.0001],[0,1],[0,0]];
const simplified = [[0,0],[1,0],[1,1],[0,1],[0,0]];

test('display admission measures removed vertices at the maximum simplified scale', () => {
  const result = admit([row('A', base)], [row('A', simplified)]);
  assert.equal(result?.valid, true);
  assert.ok(result.maxErrorPx > 0 && result.maxErrorPx < 0.002);
});

test('coarse, shifted, missing-island and mismatched-source derivatives are not display eligible', () => {
  const coarse = base.map(([x,y]) => [x, y > 1 ? 1.1 : y]);
  assert.equal(admit([row('A', coarse)], [row('A', simplified)]).valid, false);
  const shifted = simplified.map(([x,y])=>[x+0.001,y]);
  assert.equal(admit([row('A', base)], [row('A', shifted)]).valid, false);
  const island = {id:'A',geometry:{type:'MultiPolygon',coordinates:[[base],[[[2,2],[3,2],[3,3],[2,2]]]]}};
  assert.equal(admit([island], [row('A', simplified)]).valid, false);
  assert.equal(admit([row('A', base)], [row('B', simplified)]).valid, false);
});

test('display admission preserves input and accepts rotated rings while rejecting changed winding', () => {
  const source=[row('A',base)], candidate=[row('A',[[1,1],[0,1],[0,0],[1,0],[1,1]])];
  const before=JSON.stringify([source,candidate]);
  assert.equal(admit(source,candidate).valid,true);
  assert.equal(admit(source,[row('A',[...simplified].reverse())]).valid,false);
  assert.equal(JSON.stringify([source,candidate]),before);
});

test('a hole cannot become an independent island, and self crossing is rejected', () => {
  const outer = [[0,0],[4,0],[4,4],[0,4],[0,0]], hole = [[1,1],[1,2],[2,2],[2,1],[1,1]];
  assert.equal(admit([{id:'A',geometry:{type:'Polygon',coordinates:[outer,hole]}}],
    [{id:'A',geometry:{type:'MultiPolygon',coordinates:[[outer],[hole]]}}]).valid,false);
  const cross = [[0,0],[1,1],[0,1],[1,0],[0,0]];
  assert.equal(admit([row('A',cross)],[row('A',cross)]).valid,false);
});

test('two owners must simplify a shared arc identically', () => {
  const a = row('A',[[0,0],[1,0],[1.0001,.5],[1,1],[0,1],[0,0]]);
  const b = row('B',[[1,0],[2,0],[2,1],[1,1],[1.0001,.5],[1,0]]);
  const sa = row('A',[[0,0],[1,0],[1,1],[0,1],[0,0]]);
  const sb = row('B',[[1,0],[2,0],[2,1],[1,1],[1,0]]);
  assert.equal(admit([a,b],[sa,b]).valid,false);
  assert.equal(admit([a,b],[sa,sb]).valid,true);
});

test('collinear lon/lat vertices are not interchangeable with a distant great-circle edge', () => {
  const ring = [[0,60],[45,60],[90,60],[90,50],[0,50],[0,60]];
  const result = admit([row('A',ring)],[row('A',ring.filter((_,i)=>i!==1))]);
  assert.equal(result.valid,false);
  assert.equal(result.reason,'screen-error');
  assert.ok(result.maxErrorPx>80);
});

test('paired land keeps unowned islands and holes and follows the country retention decisions', () => {
  const island = [[[2,2],[3,2],[3,3],[2,2]]];
  const land = {type:'MultiPolygon',coordinates:[[base],island]};
  const result = previewPolicy.validateMapSurfacePreview?.([row('A',base)],[row('A',simplified)], [land], {inspectCandidate});
  assert.equal(result?.valid,true);
  assert.deepEqual(result.landGeometries,[{type:'MultiPolygon',coordinates:[[simplified],island]}]);
  assert.deepEqual(land.coordinates,[[base],island], 'land canonical source remains independent from project objects');
});
