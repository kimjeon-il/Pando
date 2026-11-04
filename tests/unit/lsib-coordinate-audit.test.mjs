import test from 'node:test';import assert from 'node:assert/strict';
import {targetCoordinateKeys,indexLsibCoordinates,auditLsibGeometry,coordinateChainHash} from '../../tools/gis/lsib-coordinate-audit.mjs';
const ref={properties:{ID:'line',CC1_GENC3:'AAA',CC2_GENC3:'BBB',STATUS:'International Boundary'},geometry:{type:'LineString',coordinates:[[0,0],[1,0],[2,0],[3,0],[4,0]]}};
const polygon=points=>({type:'Polygon',coordinates:[[...points,[4,3],[0,3],points[0]]]});
function audit(g,digits=null){return auditLsibGeometry(g,indexLsibCoordinates([ref],targetCoordinateKeys([g],digits),{digits}));}
test('consecutive original coordinates match in either ring direction',()=>{
 const points=[[0,0],[1,0],[2,0],[3,0],[4,0]],a=audit(polygon(points)),b=audit(polygon([...points].reverse()));
 assert.equal(a.chains.filter(x=>x.kind==='consecutive-original-chain').length,1);assert.equal(a.chains[0].vertices,5);assert.equal(a.chains[0].coordinateHash,b.chains[0].coordinateHash);assert.equal(a.chains[0].exactNumeric,true);
});
test('retained subset is not called unchanged original detail; isolated contacts do not count',()=>{
 const x=audit(polygon([[0,0],[2,0],[4,0]]));assert.equal(x.chains[0].kind,'retained-original-subsequence');assert.equal(x.chains.some(x=>x.kind==='consecutive-original-chain'),false);
 assert.equal(audit(polygon([[0,0],[4,0]])).chains.length,0);assert.equal(audit(polygon([[0,0],[.5,1]])).chains.length,0);
});
test('rounding correspondence is separate from strict numeric identity and Monaco is excluded',()=>{
 const g=polygon([[0.00000001,0],[1.00000001,0],[2.00000001,0]]);assert.equal(audit(g).chains.length,0);const r=audit(g,6);assert.equal(r.chains[0].normalization,'decimal-6');assert.equal(r.chains[0].exactNumeric,false);
 const m={...ref,properties:{...ref.properties,CC2_GENC3:'MCO'}};assert.equal(indexLsibCoordinates([m],targetCoordinateKeys([g])).parts.size,0);assert.equal(coordinateChainHash([[1,0],[2,0]]),coordinateChainHash([[2,0],[1,0]]));
});

test('ordered retained anchors survive inserted target points without becoming an exact chain',()=>{
 const g=polygon([[0,0],[.5,.1],[2,0],[2.5,.1],[4,0]]),r=audit(g);
 assert.equal(r.chains.some(c=>c.kind==='consecutive-original-chain'),false);
 assert.equal(r.chains[0].kind,'retained-original-subsequence');assert.equal(r.chains[0].retainedOriginalVertices,3);assert.equal(r.chains[0].vertices,5);assert.equal(r.chains[0].insertedOrDifferentVertices,2);
});

test('ring rotation and reversal cannot split a three-vertex original chain at the closing seam',()=>{
 const open=[[0,0],[1,0],[2,0],[4,3],[0,3]];let expected;
 for(let n=0;n<open.length;n++)for(const reverse of[false,true]){let p=[...open.slice(n),...open.slice(0,n)];if(reverse)p.reverse();const r=audit({type:'Polygon',coordinates:[[...p,p[0]]]});assert.equal(r.chains.length,1);assert.equal(r.chains[0].vertices,3);expected??=r.chains[0].coordinateHash;assert.equal(r.chains[0].coordinateHash,expected);}
});
