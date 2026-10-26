import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {checkUSSRPartition} from '../../scripts/check-ussr-partition-native.mjs';
const target='tests/unit/gis-ussr-1922-partition-native.test.mjs';
test('USSR native test is owned before broad GIS units and selects real native prerequisites',()=>{
 const catalog=JSON.parse(readFileSync(new URL('../../scripts/contracts/application-checks.json',import.meta.url)));
 const selected=catalog.groups.find(g=>(g.testPatterns||[]).some(p=>new RegExp('^'+p.replaceAll('.','\\.').replaceAll('*','.*')+'$').test(target)));
 assert.equal(selected.id,'ussr-partition-native');assert.equal(selected.kind,'command');assert.equal(selected.gisNative,true);
 assert.ok(selected.inputs.includes(target));assert.deepEqual(selected.argv,['node','scripts/check-ussr-partition-native.mjs']);
});
test('only the recipe target is built and all three native tests receive its executable',()=>{
 const calls=[];checkUSSRPartition({root:'/fixture',env:{},platform:'linux',exists:()=>true,run:(argv,options)=>{calls.push({argv,options});return {status:0};}});
 assert.equal(calls.length,3);assert.ok(calls[0].argv.includes('-DPANDO_BUILD_TERRITORIAL_RECIPE=ON'));
 assert.deepEqual(calls[1].argv.slice(-2),['--target','pando-territorial-recipe']);
 assert.deepEqual(calls[2].argv.slice(1),['--test',target]);
 assert.equal(calls[2].options.env.PANDO_TERRITORIAL_RECIPE_BINARY,join('/fixture','build-native/territorial-recipe/pando-territorial-recipe'));
});
test('missing prerequisites and native assertion failures cannot become skipped successes',()=>{
 assert.throws(()=>checkUSSRPartition({root:'/fixture',env:{},run:()=>({status:1})}),/failed/);
 assert.throws(()=>checkUSSRPartition({root:'/fixture',env:{PANDO_TERRITORIAL_RECIPE_BINARY:'/missing'},exists:()=>false}),/missing/);
 assert.throws(()=>checkUSSRPartition({root:'/fixture',env:{PANDO_TERRITORIAL_RECIPE_BINARY:'/existing'},exists:()=>true,run:()=>({status:1})}),/failed/);
});
