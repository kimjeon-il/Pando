import '../helpers/spherical-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeSharedBoundaryContributions,
  buildCountrySharedBoundarySegments } from "../../shared/frontend/js/modules/boundary-topology.js";
import { createCountrySharedBoundaryState } from "../../shared/frontend/js/modules/country-shared-boundary-packet.js";

const ref=(featureId,segmentIndex,extra={})=>({
  featureId,polygonIndex:0,ringIndex:0,segmentIndex,...extra
});
const seg=(ownerIds,refs)=>({start:[0,0],end:[1,0],ownerIds,refs});

test('C++ contact source owner/ref aggregation is identical for cache and static assembly',()=>{
  const input=[
    seg(['A','B'],[ref('A',0),ref('B',1)]),
    seg(['B','C'],[ref('B',1,{ startT:.3 }),ref('C',0)]),
    seg(['D'],[ref('D',2)]),
  ];
  const snapshot=structuredClone(input);
  const merged=mergeSharedBoundaryContributions(input);
  assert.deepEqual(merged.ownerIds,['A','B','C','D']);
  assert.deepEqual(merged.refs,[ref('A',0),ref('B',1),ref('C',0),ref('D',2)]);
  assert.deepEqual(input,snapshot,'must not mutate cached owner/source rows');
  assert.equal(mergeSharedBoundaryContributions([input[0]]),input[0],
    'one cache contribution retains its original identity');
  assert.equal(mergeSharedBoundaryContributions([]),null);
});

test('source reference de-duplication distinguishes ring and polygon identity',()=>{
  const input=[
    seg(['L','R'],[ref('L',1),ref('R',1)]),
    seg(['L','R'],[ref('R',1),{...ref('L',1),ringIndex:1},
      {...ref('L',1),polygonIndex:1}]),
  ];
  const row=mergeSharedBoundaryContributions(input);
  assert.deepEqual(row.refs,[ref('L',1),ref('R',1),
    {...ref('L',1),ringIndex:1},{...ref('L',1),polygonIndex:1}]);
});
