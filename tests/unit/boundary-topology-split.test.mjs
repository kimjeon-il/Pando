import '../helpers/spherical-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBoundaryTopologyFromSegments } from "../../shared/frontend/js/modules/boundary-topology.js";

const raw = (featureId, segmentIndex, a, b) => ({
  featureId, polygonIndex: 0, ringIndex: 0,
  segmentIndex, endVertexIndex: segmentIndex + 1,
  a, b, interiorSide: 1,
});

test('compiled C++ splits a long shared edge against uneven neighboring vertices', () => {
  const source = [
    raw('A',0,[0,0],[2,0]), raw('B',0,[2,0],[1,0]),
    raw('B',1,[1,0],[0,0]),
  ];
  const before = structuredClone(source);
  const topology = buildBoundaryTopologyFromSegments(source);
  const shared = [...topology.segments.values()].filter(segment => segment.kind === 'shared');
  assert.equal(shared.length, 2);
  assert.ok(shared.every(segment => [...segment.ownerIds].sort().join('|') === 'A|B'));
  assert.deepEqual(shared.map(segment => [segment.a,segment.b]), [
    [[0,0],[1,0]], [[1,0],[2,0]],
  ]);
  const joint = topology.nodes.get('1,0');
  assert.deepEqual([...joint.ownerIds], ['B','A']);
  assert.equal(joint.virtualRefs.length, 1);
  assert.equal(joint.virtualRefs[0].featureId,'A');
  assert.equal(joint.virtualRefs[0].t,.5);
  assert.deepEqual(source,before);
});
test('a short dateline edge cannot share the long route through Greenwich',()=>{
  const source = [
    raw('L',0,[-179,20],[179,20]),
    raw('R',0,[-179,20],[0,20]),
    raw('R',1,[0,20],[179,20]),
  ];
  const topology=buildBoundaryTopologyFromSegments(source);
  const shared=[...topology.segments.values()].filter(segment=>segment.kind==='shared');
  assert.equal(shared.length,0);
  assert.ok(topology.nodes.get('0,20').virtualRefs.every(ref=>ref.featureId!=='L'));
});
test('the compiled candidate scan respects custom precision and epsilon',()=>{
  const source=[raw('A',0,[0,0],[1,0]),raw('B',0,[1,0],[0,0])];
  const topology=buildBoundaryTopologyFromSegments(source,{precision:5,epsilon:1e-7});
  assert.equal(topology.precision,5);
  assert.equal([...topology.segments.values()].filter(s=>s.kind==='shared').length,1);
  assert.deepEqual(buildBoundaryTopologyFromSegments([],{}).segments.size,0);
});
