import assert from 'node:assert/strict';
import test from 'node:test';
import {replaceBoundaryChain,readBoundaryChain} from "../../../tools/build/build-korean-boundaries.mjs";
const base={type:'Polygon',coordinates:[[[0,0],[1,-0.1],[2,0],[2,2],[1,2],[1,2],[0,2],[0,0]],[[0.2,0.5],[0.3,0.5],[0.3,0.6],[0.2,0.5]]]};
for(const reversed of [false,true])test('bounded shared arc preserves unrelated coordinates; reversed='+reversed,()=>{
 const input=structuredClone(base);if(reversed)input.coordinates[0].reverse();
 const before=structuredClone(input),replacement=[[0,0],[1,-0.05],[2,0]];
 const result=replaceBoundaryChain(input,[0,0],[2,0],replacement,[1,-0.1]);
 assert.deepEqual(input,before,'input remains immutable');
 assert.deepEqual(readBoundaryChain(result,[0,0],[2,0],[1,-0.05]),replacement);
 const expected=structuredClone(before);expected.coordinates[0]=expected.coordinates[0].map(p=>p[0]===1&&p[1]===-0.1?[1,-0.05]:p);
 assert.deepEqual(result,expected,'all remaining coordinates, duplicate pair, hole, winding and ring start stay exact');
});
test('bounded shared arc crossing the ring seam preserves its original start',()=>{
 const input=structuredClone(base),r=input.coordinates[0];r.pop();input.coordinates[0]=[...r.slice(1),r[0],r[1]];
 const result=replaceBoundaryChain(input,[0,0],[2,0],[[0,0],[1,-0.1],[1.5,-0.05],[2,0]],[1,-0.1]);
 assert.deepEqual(result.coordinates[0][0],input.coordinates[0][0]);
 assert.deepEqual(result.coordinates[0],[[1,-0.1],[1.5,-0.05],[2,0],[2,2],[1,2],[1,2],[0,2],[0,0],[1,-0.1]]);
 assert.deepEqual(result.coordinates[1],input.coordinates[1]);
});
