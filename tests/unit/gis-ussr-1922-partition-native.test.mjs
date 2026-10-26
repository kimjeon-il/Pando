import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

const binary=process.env.PANDO_TERRITORIAL_RECIPE_BINARY;
const ring=(w,s,e,n)=>[[w,s],[e,s],[e,n],[w,n],[w,s]];
const polygon=(w,s,e,n)=>({type:'Polygon',coordinates:[ring(w,s,e,n)]});
const children=()=>[polygon(0,0,1,1),polygon(1,0,2,1),polygon(0,1,1,2),polygon(1,1,2,2)];
const audit=(t,request)=>{
 assert.ok(binary,'PANDO_TERRITORIAL_RECIPE_BINARY is required');
 const dir=mkdtempSync(join(tmpdir(),'ussr-partition-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const input=join(dir,'input.json');
 writeFileSync(input,JSON.stringify(request));
 const p=spawnSync(binary,['--audit-ussr-1922-partition',input],{
   encoding:'utf8',maxBuffer:1024*1024});
 assert.equal(p.status,0,p.stderr);
 assert.equal(readFileSync(input,'utf8'),JSON.stringify(request));
 return JSON.parse(p.stdout);
};
test('four disjoint founding republics exactly cover the 1922 parent',t=>{
 const result=audit(t,{parent:polygon(0,0,2,2),children:children()});
 assert.equal(result.passed,true);
 assert.equal(result.founderCount,5);
 assert.equal(result.parentMinusChildrenSquareDegrees,0);
 assert.equal(result.childrenMinusParentSquareDegrees,0);
 assert.equal(result.largestRepublicOverlapSquareDegrees,0);
 assert.equal(result.republicPairOverlaps.length,6);
});
test('the parent boundary mismatch cannot be waived by matching child areas',t=>{
 const result=audit(t,{parent:polygon(0,0,2.1,2),children:children()});
 assert.equal(result.passed,false);
 assert.ok(result.parentMinusChildrenSquareDegrees>0);
});
test('an overlapping republic cannot be disguised by an otherwise covered parent',t=>{
 const parts=children();
 parts[1]=polygon(0.9,0,2,1);
 const result=audit(t,{parent:polygon(0,0,2,2),children:parts});
 assert.equal(result.passed,false);
 assert.ok(result.largestRepublicOverlapSquareDegrees>0);
});
