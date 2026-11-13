import { loadNodeCore } from '../../../tools/build/load-node-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const core = await loadNodeCore();
const square = (w,s,e,n) => [[w,s],[e,s],[e,n],[w,n],[w,s]];
const area = (a,b,c) => Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;
test('shared C++ fill mesh preserves holes, dateline and both polar projections', () => {
  for (const [polygon,pole,expected] of [
    [[square(0,0,4,4),square(1,1,3,3)],0,12],
    [[[[10,10],[10,8],[10.1,6],[10,4],[10.1,2],[10,0],[20,0],[20,10],[10,10]],
      [[12,2],[12,4],[14,4],[14,2],[12,2]]],0,95.6],
    [[[ [179,-1],[-179,-1],[-179,1],[179,1],[179,-1] ]],0,4],
    ...[-1,1].map(p => [[[[-180,87*p],[-90,87*p],[0,87*p],[90,87*p],[180,87*p],[180,90*p],[-180,90*p],[-180,87*p]]],p,0]),
  ]) {
    const source=structuredClone(polygon), mesh=core.polygonBuildFillMesh(polygon,.499,true,undefined);
    assert.deepEqual(polygon,source);assert.equal(mesh.pole,pole);assert.ok(mesh.triangles.length>0);
    let sum=0;
    const edgeKey=(a,b)=>a<b?`${a},${b}`:`${b},${a}`,edges=new Map();
    const vector=([x,y])=>{const lon=x*Math.PI/180,lat=y*Math.PI/180;return [Math.cos(lat)*Math.cos(lon),Math.cos(lat)*Math.sin(lon),Math.sin(lat)];};
    for(let i=0;i<mesh.triangles.length;i+=3){
      const t=mesh.triangles.slice(i,i+3);sum+=area(...t.map(v=>mesh.parameter[v]));
      for(let e=0;e<3;e++){
        const key=edgeKey(t[e],t[(e+1)%3]);edges.set(key,(edges.get(key)||0)+1);
        const a=vector(mesh.geographic[t[e]]),b=vector(mesh.geographic[t[(e+1)%3]]);
        const dot=a.reduce((value,x,j)=>value+x*b[j],0);
        assert.ok(Math.acos(Math.min(1,Math.max(-1,dot)))*180/Math.PI<=.499);
      }
    }
    if(expected)assert.ok(Math.abs(sum-expected)<1e-8);
    assert.ok(mesh.boundaryChains.every(chain=>chain.vertices.length===chain.visible.length));
    for(const chain of mesh.boundaryChains)for(let i=0;i<chain.vertices.length;i++)
      if(chain.visible[i])assert.equal(edges.get(edgeKey(chain.vertices[i],chain.vertices[(i+1)%chain.vertices.length])),1);
  }
});
test('degenerate rings and outside holes fail visibly; cancellation crosses WASM unchanged', () => {
  for(const polygon of [[[[0,0],[1,0],[2,0],[0,0]]],[square(0,0,2,2),square(3,3,4,4)],
    [square(0,0,2,2),[[1,1],[1,1],[1,1]]]])
    assert.throws(()=>core.polygonBuildFillMesh(polygon,.499,true,undefined),error=>error.code==='PL-MESH-TRIANGULATION');
  const cancelled=Object.assign(new Error('cancelled'),{code:'PL-WORKER-CANCELLED'});let calls=0;
  assert.throws(()=>core.polygonBuildFillMesh([square(0,0,8,5)],.499,true,()=>{if(++calls===4)throw cancelled;}),error=>error===cancelled);
  assert.equal(calls,4);
});
