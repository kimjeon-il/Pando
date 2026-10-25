import assert from 'node:assert/strict';
import test from 'node:test';
import { loadVerifiedCore } from '../helpers/node-core-wasm-loader.mjs';
import { validateGeometry } from "../../shared/frontend/js/modules/geometry-validation.js";
import { inspectTopologyPreviewFeatures } from "../../shared/frontend/js/modules/project-preview-topology.js";

const box=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]];
const feature=(coordinates,type='Polygon',id='shape')=>({type:'Feature',id,properties:{},geometry:{type,coordinates}});
const engine=loadVerifiedCore();
async function inspect(features,options={}) {
  const core=await engine;
  return inspectTopologyPreviewFeatures(features,{validateGeometry,
    clipper:{intersection:(...inputs)=>core.polygonOperation('intersection',inputs,false)},...options});
}
function hasRepairPoint(issue) {
  const points=issue.points||[issue.point];
  assert.ok(points.length&&points.every(p=>Array.isArray(p)&&p.length>=2&&p.slice(0,2).every(Number.isFinite)));
}

test('strict preview rejects hole containment, nesting and cross-ring defects with repair coordinates',async()=>{
  const cases=[
    feature([box(0,0,10,10),box(11,1,1,1)]),
    feature([box(0,0,10,10),box(1,1,7,7),box(2,2,1,1)]),
    feature([box(0,0,10,10),box(1,1,4,4),box(3,3,4,4)]),
    feature([box(0,0,10,10),box(0,2,3,3)]),
    // Two isolated shell contacts disconnect the polygon interior.
    feature([box(0,0,10,10),[[0,5],[5,2],[10,5],[5,8],[0,5]]]),
  ];
  for(const value of cases){
    assert.deepEqual(validateGeometry(value),[],'individual rings are valid in this fixture');
    const issues=await inspect([value]);assert.ok(issues.length);issues.forEach(hasRepairPoint);
    assert.deepEqual(issues[0].ids,['shape']);
  }
});

test('strict preview rejects overlapping or line-touching MultiPolygon components',async()=>{
  for(const coordinates of [
    [[box(0,0,4,4)],[box(1,1,1,1)]],
    [[box(0,0,4,4)],[box(3,3,4,4)]],
    [[box(0,0,4,4)],[box(4,1,2,2)]],
  ]){
    const issues=await inspect([feature(coordinates,'MultiPolygon')]);
    assert.ok(issues.length);issues.forEach(hasRepairPoint);
  }
});

test('strict preview preserves valid holes, isolated touches and an island inside a hole',async()=>{
  const cases=[
    feature([box(0,0,10,10),box(2,2,2,2)]),
    feature([box(0,0,10,10),[[0,5],[2,4],[2,6],[0,5]]]),
    feature([box(0,0,10,10),box(1,1,2,2),box(3,3,2,2)]),
    feature([[box(0,0,10,10),box(2,2,6,6)],[box(3,3,2,2)]],'MultiPolygon'),
    feature([[box(0,0,2,2)],[box(2,2,2,2)]],'MultiPolygon'),
    // Three rings meeting at one contact point must not look like a cycle.
    feature([box(0,0,10,10),[[0,5],[2,3],[2,4],[0,5]],[[0,5],[2,6],[2,7],[0,5]]]),
  ];
  for(const value of cases)assert.deepEqual(await inspect([value]),[]);
});

test('inter-feature overlap keeps the 1e-14 area threshold and ancestor exemption',async()=>{
  const left=feature([box(0,0,1,1)],'Polygon','a');
  const tiny=feature([box(1-1e-8,1-1e-8,1,1)],'Polygon','b');
  assert.deepEqual(await inspect([left,tiny]),[]);
  const overlap=feature([box(1-1e-6,1-1e-6,1,1)],'Polygon','b');
  const issues=await inspect([left,overlap]);assert.equal(issues[0].reason,'overlap');hasRepairPoint(issues[0]);
  assert.deepEqual(await inspect([left,overlap],{unitParents:new Map([['b','a']])}),[]);
});

test('empty multipolygon is rejected even when there are no rings to validate',async()=>{
  const issues=await inspect([feature([],'MultiPolygon')]);
  assert.equal(issues[0].reason,'empty-geometry');
});
