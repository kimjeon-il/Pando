import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,posix} from 'node:path';
import {loadRepository,matchesPattern,planApplicationChecks} from '../../scripts/plan-application-checks.mjs';
import {executePlan} from '../../scripts/run-application-checks.mjs';
import {nativeTestCapacity,prepareNativeTestTool} from '../../scripts/prepare-native-test-tools.mjs';
import {nativeTestRecipes} from '../../scripts/lib/native-test-prerequisites.mjs';
import {packageNativeTool} from '../../tools/native-tool.mjs';
import YAML from 'yaml';

function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'pando-native-checks-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const put=(path,source='')=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),source);};
  put('tests/unit/image.test.mjs');put('tests/unit/plain.test.mjs');put('scripts/prepare.mjs');
  const catalog={schema:'pando-application-checks-v1',groups:[{id:'unit',kind:'unit',testPatterns:['tests/unit/*.test.mjs']}],
    prerequisites:{image:{argv:['node','scripts/prepare.mjs','image'],env:{PANDO_IMAGE_ARTIFACT:'{root}/build-native/image/artifact'}}},
    unitPrerequisites:[{tests:['tests/unit/image.test.mjs'],requires:['image']}],productRoots:['tests/**','scripts/**']};
  return {root,put,catalog,repository:()=>loadRepository(root,{catalog})};
}

test('selected native tests retain their files and require only their declared tool',t=>{
  const f=fixture(t),repository=f.repository();
  const native=planApplicationChecks({changedFiles:['tests/unit/image.test.mjs'],repository});
  assert.deepEqual(native.unitTests,['tests/unit/image.test.mjs']);
  assert.deepEqual(native.prerequisites,['image']);
  assert.deepEqual(native.unitTestPrerequisites,{'tests/unit/image.test.mjs':['image']});
  const plain=planApplicationChecks({changedFiles:['tests/unit/plain.test.mjs'],repository});
  assert.deepEqual(plain.unitTests,['tests/unit/plain.test.mjs']);
  assert.deepEqual(plain.prerequisites,[]);
});

test('native preparation and action changes select their declared consumers',t=>{
  const f=fixture(t),action='.github/actions/native-setup/action.yml';f.put(action,'steps: []\n');
  f.catalog.prerequisites.image.inputs=[action];
  const repository=f.repository();
  for(const file of ['scripts/prepare.mjs',action]){
    const plan=planApplicationChecks({changedFiles:[file],repository});
    assert.deepEqual(plan.unitTests,['tests/unit/image.test.mjs']);
    assert.deepEqual(plan.prerequisites,['image']);
  }
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
  const result=await prepareNativeTestTool('map-image',{root:f.root,platform:'linux',architecture:'x64',run:argv=>calls.push(argv)});
  assert.equal(result.status,'reused');assert.deepEqual(calls,[]);
});

test('changed native source or binary bytes fail closed without replacing the existing artifact',async t=>{
  const f=packagedFixture(t),calls=[];
  f.put('source.cpp','int changed=2;\n');
  await assert.rejects(prepareNativeTestTool('map-image',{root:f.root,platform:'linux',architecture:'x64',run:argv=>calls.push(argv)}),/Native tool source mismatch/);
  f.put('source.cpp','int original=1;\n');writeFileSync(join(f.directory,'pando-map-image'),'changed binary');
  await assert.rejects(prepareNativeTestTool('map-image',{root:f.root,platform:'linux',architecture:'x64',run:argv=>calls.push(argv)}),/Native tool binary hash\/size mismatch/);
  assert.deepEqual(calls,[]);
});

test('a changed pinned SDK archive is rejected before extraction or compilation',async t=>{
  const f=fixture(t),calls=[];f.put('build-native/map-pdf/mupdf-sdk.zip','wrong archive');
  await assert.rejects(prepareNativeTestTool('mupdf',{root:f.root,platform:'linux',architecture:'x64',run:argv=>calls.push(argv)}),/Native SDK archive SHA-256 mismatch/);
  assert.deepEqual(calls,[]);
});

test('no selected native preparation does not require SDK capacity or a filesystem probe',async()=>{
  assert.deepEqual(await nativeTestCapacity([],{root:'/nonexistent-unselected-native-root'}),
    {tools:false,recipeEnvironment:false,additionalBytes:0});
});

test('each application runner execution receives the same selected native setup before its tests',()=>{
  const directory=new URL('../../.github/workflows/',import.meta.url),consumers=[];
  for(const file of readdirSync(directory).filter(file=>file.endsWith('.yml'))){
    const workflow=YAML.parse(readFileSync(new URL(file,directory),'utf8'));
    for(const [id,job] of Object.entries(workflow.jobs||{})){
      const steps=job.steps||[],execution=steps.findIndex(step=>String(step.run||'').split('\n')
        .some(line=>line.includes('scripts/run-application-checks.mjs')&&!line.includes('--list')));
      if(execution<0)continue;
      const preparation=steps.findIndex(step=>step.uses==='./.github/actions/native-test-prerequisites');
      assert.ok(preparation>=0&&preparation<execution,file+' '+id);
      assert.equal(steps[preparation].with.requirements,'${{ steps.plan.outputs.native_requirements }}');
      consumers.push(file);
    }
  }
  assert.deepEqual(consumers.sort(),['application-architecture.yml','place-runtime.yml',
    'remote-development-p1.yml','remote-preview-p3.yml','ui-architecture.yml']);
});

test('native source-manifest inputs also participate in consumer selection',async()=>{
  const catalog=JSON.parse(readFileSync(new URL('../../scripts/contracts/application-checks.json',import.meta.url),'utf8'));
  for(const [id,recipe] of Object.entries(nativeTestRecipes)){
    if(!recipe.artifact)continue;
    const source=await import(new URL('../../'+recipe.artifact.sourceModule,import.meta.url));
    const inputs=catalog.prerequisites['native-'+id].inputs;
    for(const file of source[recipe.artifact.sourceExport])
      assert.ok(inputs.some(pattern=>matchesPattern(file,pattern)),id+': '+file);
  }
});

test('each compiled territorial source and recursive project header selects its nested Caspian consumer',t=>{
  const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
  const catalog=JSON.parse(read('scripts/contracts/application-checks.json'));
  const target=read('tools/cpp/CMakeLists.txt').match(/add_executable\(pando-territorial-recipe\s+([^)]*)\)/);
  assert.ok(target,'the canonical territorial target must be present');
  const pending=target[1].trim().split(/\s+/).map(path=>posix.normalize('tools/cpp/'+path)),closure=new Set();
  while(pending.length){
    const path=pending.pop();if(closure.has(path))continue;closure.add(path);
    for(const match of read(path).matchAll(/^\s*#include\s+(?:<([^>]+)>|"([^"]+)")/gm)){
      if(match[1]?.startsWith('pandoeditor/'))pending.push('shared/core/include/'+match[1]);
      else if(match[2])pending.push(posix.normalize(posix.dirname(path)+'/'+match[2]));
    }
  }
  const f=fixture(t),consumer='tests/unit/gis-caspian-pinned-native-oracle.test.mjs';f.put(consumer);
  f.catalog.prerequisites=Object.fromEntries(['native-territorial-recipe','native-caspian-oracle'].map(id=>[id,catalog.prerequisites[id]]));
  f.catalog.unitPrerequisites=[{tests:[consumer],requires:['native-caspian-oracle']}];
  for(const entry of Object.values(f.catalog.prerequisites)){
    f.put(entry.argv[1]);for(const path of entry.inputs)if(!path.includes('*'))f.put(path);
  }
  for(const path of closure)f.put(path);
  const repository=f.repository();
  for(const path of closure){
    const plan=planApplicationChecks({changedFiles:[path],repository});
    assert.deepEqual(plan.unitTests,[consumer],path);
    assert.deepEqual(plan.prerequisites,['native-caspian-oracle'],path);
  }
});

test('an incorrect prepared pinned source fails before download or replacement',async t=>{
  const f=fixture(t),path='assets/data/countries-ne-5.1.1.geojson';
  f.put(path,'different source');
  await assert.rejects(prepareNativeTestTool('german-natural-earth',{root:f.root}),/Prepared native test source differs/);
  assert.equal(readFileSync(join(f.root,path),'utf8'),'different source');
});
