import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const binary = process.argv[2];
assert.ok(binary, 'Compiled calculation driver required');
// Ring starts and independent polygon ordering do not change geometry.
const canonical = multi => multi.map(poly => poly.map(ring => {
 const points=ring.slice(0,-1);let first=0;
 for(let i=1;i<points.length;i++)if(points[i][0]<points[first][0]||(points[i][0]===points[first][0]&&points[i][1]<points[first][1]))first=i;
 return points.slice(first).concat(points.slice(0,first));
}).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
for (const kind of ['polygon','cut','river']) {
 const cases=JSON.parse(readFileSync(new URL('../../fixtures/geometry/calculation-contracts/'+kind+'.json',import.meta.url),'utf8'));
 const output=execFileSync(binary,[],{input:cases.map(row=>JSON.stringify({kind,input:row.input})).join('\n')+'\n',encoding:'utf8',timeout:30000,maxBuffer:64*1024*1024}).trim().split('\n').map(JSON.parse);
 assert.equal(output.length,cases.length);
 for(let i=0;i<cases.length;i++) {
  const actual=output[i],expected=cases[i].expected;
  if(kind==='polygon'&&expected.result){assert.equal(actual.error,undefined,cases[i].id);assert.deepEqual(canonical(actual.result),canonical(expected.result),cases[i].id);}
  else {if(kind==='river'&&actual.result?.diagnostics)delete actual.result.diagnostics.computeMs;assert.deepEqual(actual,expected,cases[i].id);}
 }
 console.log(kind+': '+cases.length+' current native contracts passed');
}
const invalid=JSON.parse(execFileSync(binary,[],{input:JSON.stringify({kind:'polygon',input:{operation:'invalid',operands:[]}})+'\n',encoding:'utf8',timeout:5000}));
assert.equal(typeof invalid.error,'string');
