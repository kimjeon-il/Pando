import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {isolatedTestWorkspace} from "../../helpers/check-workspace-fixture.mjs";
import {dirname,join} from 'node:path';
import {loadRepository} from "../../../scripts/plan-application-checks.mjs";
import {executePlan as executeCiPlan} from "../../../scripts/run-application-checks.mjs";
import {nativeTestCapacity,prepareNativeTestTool} from "../../../scripts/prepare-native-test-tools.mjs";

import {packageNativeTool} from "../../../tools/build/native-tool.mjs";

import {selectNativeBuilds,pinnedToolchain} from "../../../scripts/lib/check-changes.mjs";

const ciNativeTestCapacity=(ids,options)=>nativeTestCapacity(ids,{...options,environment:{GITHUB_ACTIONS:'true'}});
const ciPrepareNativeTestTool=(id,options)=>prepareNativeTestTool(id,{...options,environment:{GITHUB_ACTIONS:'true'}});

function fixture(t) {
  const root=isolatedTestWorkspace(t,'pando-native-checks-');
  const put=(path,source='')=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),source);};
  put('tests/unit/image.test.mjs');put('tests/unit/plain.test.mjs');put('scripts/prepare.mjs');
  const catalog={schema:'pando-application-checks-v1',groups:[{id:'unit',kind:'unit',testPatterns:['tests/unit/**/*.test.mjs']}],
    prerequisites:{image:{argv:['node','scripts/prepare.mjs','image'],env:{PANDO_IMAGE_ARTIFACT:'{root}/build-native/image/artifact'}}},
    unitPrerequisites:[{tests:['tests/unit/image.test.mjs'],requires:['image']}],productRoots:['tests/**','scripts/**']};
  return {root,put,catalog,repository:()=>loadRepository(root,{catalog})};
}

const executePlan=(plan,options)=>executeCiPlan(plan,{...options,environment:{GITHUB_ACTIONS:'true'}});

test('Windows local native preparation requests CI without invoking installer or compiler',async t=>{
 const f=fixture(t),calls=[];
 f.put('scripts/contracts/application-checks.json',JSON.stringify(f.catalog));
 const result=await prepareNativeTestTool('map-image',{root:f.root,platform:'win32',environment:{},run:()=>assert.fail('local compilation'),remote:request=>{calls.push(request.selection);return {ok:true};}});
 assert.equal(result.ok,true);assert.deepEqual(calls,[{unitTests:[],browserSpecs:[],commands:[],prerequisites:['native-map-image']}]);
 await assert.rejects(nativeTestCapacity(['map-image'],{root:f.root,platform:'win32',environment:{},probe:()=>assert.fail('local tool probe')}),/Local native SDK installation is disabled/);
});

test('failed native preparation blocks its original tests, continues unrelated tests and fails the run',()=>{
  const repository={root:'/fixture',catalog:{groups:[],prerequisites:{image:{argv:['node','prepare.mjs']}}}};
  const plan={prerequisites:['image'],commands:[],browserSpecs:[],unitTests:['tests/unit/image.test.mjs','tests/unit/plain.test.mjs'],
    unitTestPrerequisites:{'tests/unit/image.test.mjs':['image']}};
  const calls=[];
  const result=executePlan(plan,{repository,run:(argv)=>{calls.push(argv);return {status:argv.includes('prepare.mjs')?3:0};}});
  assert.equal(result.ok,false);
  assert.ok(result.results.some(row=>row.id==='unit'&&row.status==='blocked'&&row.files?.includes('tests/unit/image.test.mjs')));
  assert.equal(calls.some(argv=>argv.includes('tests/unit/image.test.mjs')),false);
  assert.equal(calls.filter(argv=>argv.includes('tests/unit/plain.test.mjs')).length,1);
  assert.equal(result.results.some(row=>row.status==='skipped'),false);
});

test('shared native dependencies prepare once and their explicit environments reach only dependent batches',()=>{
  const repository={root:'/fixture',catalog:{groups:[],prerequisites:{
    image:{argv:['node','prepare.mjs','image'],env:{PANDO_IMAGE_ARTIFACT:'{root}/build-native/image/artifact'}},
    preview:{argv:['node','prepare.mjs','preview'],requires:['image'],env:{PANDO_PREVIEW_ARTIFACT:'{root}/build-native/preview/artifact'}}}}};
  const plan={prerequisites:['image','preview'],commands:[],browserSpecs:[],unitTests:['tests/unit/image.test.mjs','tests/unit/preview.test.mjs','tests/unit/plain.test.mjs'],
    unitTestPrerequisites:{'tests/unit/image.test.mjs':['image'],'tests/unit/preview.test.mjs':['preview']}};
  const calls=[];const result=executePlan(plan,{repository,run:(argv,options)=>{calls.push({argv,env:options.env});return {status:0};}});
  assert.equal(result.ok,true);
  assert.equal(calls.filter(row=>row.argv.join(' ')==='node prepare.mjs image').length,1);
  const preparation=calls.find(row=>row.argv.join(' ')==='node prepare.mjs preview');
  assert.equal(preparation.env.PANDO_IMAGE_ARTIFACT,'/fixture/build-native/image/artifact');
  assert.equal(preparation.env.PANDO_PREVIEW_ARTIFACT,'/fixture/build-native/preview/artifact');
  const preview=calls.find(row=>row.argv.includes('tests/unit/preview.test.mjs'));
  assert.equal(preview.env.PANDO_IMAGE_ARTIFACT,'/fixture/build-native/image/artifact');
  assert.equal(preview.env.PANDO_PREVIEW_ARTIFACT,'/fixture/build-native/preview/artifact');
  const plain=calls.find(row=>row.argv.includes('tests/unit/plain.test.mjs'));
  assert.equal(plain.env.PANDO_PREVIEW_ARTIFACT,process.env.PANDO_PREVIEW_ARTIFACT);
});

test('unknown or missing native test requirements fail catalog validation',t=>{
  const f=fixture(t);f.catalog.unitPrerequisites[0].requires=['unknown'];
  assert.throws(()=>f.repository(),/Missing prerequisite/);
  f.catalog.unitPrerequisites[0].requires=['image'];f.catalog.unitPrerequisites[0].tests=['tests/unit/missing.test.mjs'];
  assert.throws(()=>f.repository(),/Missing registered.*test/);
});

test('a native unit prerequisite failure does not block a browser with independent prerequisites',()=>{
  const repository={root:'/fixture',catalog:{groups:[],prerequisites:{image:{argv:['node','prepare.mjs']},generated:{argv:['node','metadata.mjs']}}}};
  const plan={prerequisites:['image','generated'],commands:[],unitTests:[],browserSpecs:['tests/browser/view.spec.mjs'],browserPrerequisites:['generated']};
  const calls=[];const result=executePlan(plan,{repository,run:argv=>{calls.push(argv);return {status:argv.includes('prepare.mjs')?1:0};}});
  assert.equal(result.ok,false);
  assert.equal(calls.some(argv=>argv.includes('tests/browser/view.spec.mjs')),true);
});

function packagedFixture(t) {
  const f=fixture(t);
  f.put('source.cpp','int original=1;\n');f.put('pando-map-image','bounded manifest verification fixture');
  f.put('tools/map-image/native-resample.mjs',"export const mapImageSourceFiles=['source.cpp'];\n");
  const directory=join(f.root,'build-native/map-image/artifact');
  packageNativeTool({root:f.root,binary:join(f.root,'pando-map-image'),directory,target:'map-image',platform:'linux',architecture:'x64',
    revision:'a'.repeat(40),sourceFiles:['source.cpp']});
  return {...f,directory};
}

test('an existing exact-source native artifact is reused without rebuilding or downloading',async t=>{
  const f=packagedFixture(t),calls=[];
  const result=await ciPrepareNativeTestTool('map-image',{root:f.root,platform:'linux',architecture:'x64',run:argv=>calls.push(argv)});
  assert.equal(result.status,'reused');assert.deepEqual(calls,[]);
});

test('changed native source or binary bytes fail closed without replacing the existing artifact',async t=>{
  const f=packagedFixture(t),calls=[];
  f.put('source.cpp','int changed=2;\n');
  await assert.rejects(ciPrepareNativeTestTool('map-image',{root:f.root,platform:'linux',architecture:'x64',run:argv=>calls.push(argv)}),/Native tool source mismatch/);
  f.put('source.cpp','int original=1;\n');writeFileSync(join(f.directory,'pando-map-image'),'changed binary');
  await assert.rejects(ciPrepareNativeTestTool('map-image',{root:f.root,platform:'linux',architecture:'x64',run:argv=>calls.push(argv)}),/Native tool binary hash\/size mismatch/);
  assert.deepEqual(calls,[]);
});

test('a changed pinned SDK archive is rejected before extraction or compilation',async t=>{
  const f=fixture(t),calls=[];f.put('build-native/map-pdf/mupdf-sdk.zip','wrong archive');
  await assert.rejects(ciPrepareNativeTestTool('mupdf',{root:f.root,platform:'linux',architecture:'x64',run:argv=>calls.push(argv)}),/Native SDK archive SHA-256 mismatch/);
  assert.deepEqual(calls,[]);
});

test('no selected native preparation does not require SDK capacity or a filesystem probe',async()=>{
  assert.deepEqual(await ciNativeTestCapacity([],{root:'/nonexistent-unselected-native-root'}),
    {tools:false,recipeEnvironment:false,gdalEnvironment:false,additionalBytes:0});
});

test('an incorrect prepared pinned source fails before download or replacement',async t=>{
  const f=fixture(t),path='assets/data/countries-ne-5.1.1.geojson';
  f.put(path,'different source');
  await assert.rejects(ciPrepareNativeTestTool('german-natural-earth',{root:f.root,platform:'linux',architecture:'x64'}),/Prepared native test source differs/);
  assert.equal(readFileSync(join(f.root,path),'utf8'),'different source');
});


test('toolchain pins agree with Node and frozen package manager',()=>{
  const pinned=pinnedToolchain();
  assert.ok(pinned.cmake);
  assert.ok(pinned.emscripten);
  assert.match(pinned.emsdkCommit,/^[a-f0-9]{40}$/);
  assert.throws(()=>pinnedToolchain(process.cwd(),'0.0.0'),/PINNED_TOOLCHAIN_NODE_MAJOR/);
});
test('Core and GIS changes select native builds without repeating WASM publication',()=>{
  const core=selectNativeBuilds(['src/document/native/src/document.cpp']);
  assert.deepEqual(core,{core:true,gis:false,wasm:false});
  assert.deepEqual(selectNativeBuilds(['tools/cpp/hydro/connectivity.cpp']),
    {core:false,gis:true,wasm:false});
  assert.deepEqual(selectNativeBuilds(['CMakePresets.json']),
    {core:true,gis:true,wasm:false});
  assert.deepEqual(selectNativeBuilds(['.devcontainer/start-preview.sh','README.md']),
    {core:false,gis:false,wasm:false});
});
test('canonical geometry suites request their native build after phase-suite absorption',()=>{
  for(const name of ['polygon-geometry','gis-math-contract','annex-slivers'])
    assert.deepEqual(selectNativeBuilds([`tests/unit/geometry/${name}.test.mjs`]),
      {core:false,gis:true,wasm:false});
});
test('manual native targets are focused and invalid targets fail closed',()=>{
  assert.deepEqual(selectNativeBuilds([],'native-core'),{core:true,gis:false,wasm:false});
  assert.deepEqual(selectNativeBuilds([],'native-gis'),{core:false,gis:true,wasm:false});
  assert.deepEqual(selectNativeBuilds([],'native-all'),{core:true,gis:true,wasm:false});
  assert.throws(()=>selectNativeBuilds([],'unknown'),/Unknown native build scope/);
});
