import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = process.cwd();
const directory = path.join(root, 'build-native/territorial-recipe/boundary-fixture');
const binary = process.env.PANDO_TERRITORIAL_RECIPE_BINARY;
const polygon = coordinates => ({type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[coordinates]}}]});
const base = [[0,0],[10,0],[10,10],[0,10],[0,0]];
const reference = [[-5,0],[10,0],[10,2],[10.2,4],[10.2,6],[10,8],[10,10],[-5,10],[-5,0]];
function run(bounds, referencePoints=reference) {
  assert.ok(binary, 'PANDO_TERRITORIAL_RECIPE_BINARY must name the focused native generator');
  mkdirSync(directory,{recursive:true});
  for(const [name,coordinates] of [['base',base],['reference',referencePoints]])
    writeFileSync(path.join(directory,name+'.json'),JSON.stringify(polygon(coordinates)));
  const recipe={sources:Object.fromEntries(['base','reference'].map(name=>[name,{path:path.relative(root,path.join(directory,name+'.json')),crs:'EPSG:4326'}])),
    operations:[{id:'original',operation:'union',source:'base'},
      {id:'updated',operation:'boundary-supplement',input:'original',referenceSource:'reference',sections:[{id:'approved',bounds}]}]};
  const file=path.join(directory,'recipe.json');writeFileSync(file,JSON.stringify(recipe));
  return spawnSync(binary,[root,file],{encoding:'utf8'});
}
test('native boundary supplement replaces only the admitted arc and preserves the opposite boundary',()=>{
  const result=run([9,1,11,9]);
  assert.equal(result.status,0,result.stderr||result.error?.message);
  const geometry=JSON.parse(result.stdout),ring=geometry.coordinates[0][0];
  assert.ok(ring.some(([x,y])=>x===10.2&&y===4),'detailed reference arc must survive');
  assert.ok(ring.some(([x,y])=>x===0&&y===0),'original opposite boundary must survive');
  assert.ok(!ring.some(([x])=>x===-5),'reference changes outside the approved section must not leak');
  assert.deepEqual(ring[0],ring.at(-1));
});
test('native boundary supplement refuses sections without two usable shared anchors',()=>{
  const result=run([10.1,3,10.3,7]);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/No admissible boundary arc/);
});

test('native boundary supplement retains exact adopted reference doubles for shared-border clipping',()=>{
  const points=structuredClone(reference),x=10.200000000000047;
  points[3][0]=x;
  const result=run([9,1,11,9],points);
  assert.equal(result.status,0,result.stderr||result.error?.message);
  assert.ok(JSON.parse(result.stdout).coordinates[0][0].some(([longitude,latitude])=>longitude===x&&latitude===4));
});
