import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,posix,resolve} from 'node:path';
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

test('merged required native consumers receive their catalogued preparation and batch environment',t=>{
  const catalog=JSON.parse(readFileSync(new URL('../../scripts/contracts/application-checks.json',import.meta.url),'utf8'));
  const required={
    'native-territorial-recipe':{env:'PANDO_TERRITORIAL_RECIPE_BINARY',path:'build-native/territorial-recipe/pando-territorial-recipe',tests:[
      'tests/unit/gis-german-modern-coast-native.test.mjs','tests/unit/gis-lsib-coast-native.test.mjs',
      'tests/unit/gis-lsib-spatial-native.test.mjs','tests/unit/gis-lsib-tripoint-native.test.mjs',
      'tests/unit/gis-lsib-union-native.test.mjs','tests/unit/gis-lsib-untargeted.test.mjs',
    ]},
    'native-map-image':{env:'PANDO_MAP_IMAGE_ARTIFACT',path:'build-native/map-image/artifact',tests:[
      'tests/unit/reference-training-mask-audit.test.mjs','tests/unit/terrain-dem-webp.test.mjs',
    ]},
  };
  const f=fixture(t),consumers=Object.values(required).flatMap(row=>row.tests);
  for(const file of consumers)f.put(file);
  f.catalog.prerequisites=Object.fromEntries(Object.keys(required).map(id=>[id,catalog.prerequisites[id]]));
  f.catalog.unitPrerequisites=catalog.unitPrerequisites.map(binding=>({...binding,
    tests:binding.tests.filter(pattern=>consumers.some(file=>matchesPattern(file,pattern)))})).filter(binding=>binding.tests.length);
  for(const entry of Object.values(f.catalog.prerequisites)){
    f.put(entry.argv[1]);for(const path of entry.inputs)if(!path.includes('*'))f.put(path);
  }
  const repository=f.repository();
  for(const [id,expected] of Object.entries(required))for(const file of expected.tests){
    const plan=planApplicationChecks({changedFiles:[file],repository});
    assert.deepEqual(plan.unitTests,[file]);
    assert.deepEqual(plan.unitTestPrerequisites[file],[id],file);
    const calls=[],result=executePlan(plan,{repository,run:(argv,options)=>{calls.push({argv,env:options.env});return{status:0};}});
    assert.equal(result.ok,true,file);
    const execution=calls.find(row=>row.argv.includes(file));
    assert.ok(execution,file);
    assert.equal(resolve(execution.env[expected.env]),join(f.root,expected.path),file);
  }
});

test('required DEM checks prepare their native tools and inherit only the tint fill dependency',t=>{
  const catalog=JSON.parse(readFileSync(new URL('../../scripts/contracts/application-checks.json',import.meta.url),'utf8'));
  const ids=['native-terrain-dem-gutters','native-terrain-dem-fill','native-terrain-dem-tint'];
  for(const id of ids)assert.ok(catalog.prerequisites[id],id+' must be registered');
  assert.deepEqual(catalog.prerequisites['native-terrain-dem-tint'].requires,['native-terrain-dem-fill']);
  const f=fixture(t),gutters='tests/unit/terrain-dem-gutters.test.mjs',tint='tests/unit/terrain-dem-tint.test.mjs',
    optionalFill='tests/unit/terrain-dem-fill.test.mjs',plain='tests/unit/plain.test.mjs',consumers=[gutters,tint,optionalFill,plain];
  for(const file of consumers)f.put(file);
  f.catalog.prerequisites=Object.fromEntries(ids.map(id=>[id,catalog.prerequisites[id]]));
  f.catalog.unitPrerequisites=catalog.unitPrerequisites.map(binding=>({...binding,
    tests:binding.tests.filter(pattern=>consumers.some(file=>matchesPattern(file,pattern)))})).filter(binding=>binding.tests.length);
  for(const entry of Object.values(f.catalog.prerequisites)){
    f.put(entry.argv[1]);for(const path of entry.inputs)if(!path.includes('*'))f.put(path);
  }
  const repository=f.repository(),plan=planApplicationChecks({changedFiles:consumers,repository});
  assert.deepEqual(plan.unitTests,[...consumers].sort());
  assert.deepEqual(plan.unitTestPrerequisites,{[gutters]:['native-terrain-dem-gutters'],[tint]:['native-terrain-dem-tint']});
  const calls=[],result=executePlan(plan,{repository,run:(argv,options)=>{calls.push({argv,env:options.env});return{status:0};}});
  assert.equal(result.ok,true);
  const fillAt=calls.findIndex(row=>row.argv.at(-1)==='terrain-dem-fill'),tintAt=calls.findIndex(row=>row.argv.at(-1)==='terrain-dem-tint');
  assert.ok(fillAt>=0&&fillAt<tintAt,'fill must be prepared before tint');
  assert.equal(calls.filter(row=>row.argv.at(-1)==='terrain-dem-fill').length,1);
  const expectedFill=join(f.root,'build-native/terrain-dem-encode/fill-artifact'),expectedSdk=join(f.root,'build-native/terrain-dem-gdal/sdk/lib');
  for(const execution of [calls[tintAt],calls.find(row=>row.argv.includes(tint))]){
    assert.equal(resolve(execution.env.PANDO_TERRAIN_DEM_FILL_DIRECTORY),expectedFill);
    assert.equal(resolve(execution.env.PANDO_TERRAIN_DEM_TINT_DIRECTORY),join(f.root,'build-native/terrain-dem-tint/artifact'));
    assert.equal(resolve(execution.env.LD_LIBRARY_PATH),expectedSdk);
  }
  const gutterExecution=calls.find(row=>row.argv.includes(gutters));
  assert.equal(resolve(gutterExecution.env.PANDO_TERRAIN_DEM_GUTTERS_DIRECTORY),join(f.root,'build-native/terrain-dem-gutters/artifact'));
  assert.equal(gutterExecution.env.PANDO_MAP_IMAGE_ARTIFACT,process.env.PANDO_MAP_IMAGE_ARTIFACT);
  for(const file of [gutters,optionalFill,plain]){
    const execution=calls.find(row=>row.argv.includes(file));
    assert.equal(execution.env.PANDO_TERRAIN_DEM_FILL_DIRECTORY,process.env.PANDO_TERRAIN_DEM_FILL_DIRECTORY);
    assert.equal(execution.env.PANDO_TERRAIN_DEM_TINT_DIRECTORY,process.env.PANDO_TERRAIN_DEM_TINT_DIRECTORY);
    assert.equal(execution.env.LD_LIBRARY_PATH,process.env.LD_LIBRARY_PATH);
  }
});

test('DEM GDAL setup retains the canonical pin and is requested only for its consumers',async t=>{
  const action=YAML.parse(readFileSync(new URL('../../.github/actions/native-test-prerequisites/action.yml',import.meta.url),'utf8'));
  const setup=action.runs.steps.find(step=>step.with?.['environment-name']==='pando-dem-gdal');
  assert.ok(setup,'the canonical GDAL environment must be prepared');
  assert.equal(setup.uses,'mamba-org/setup-micromamba@v3');
  assert.equal(setup.if,"steps.capacity.outputs.gdal_environment == 'true'");
  assert.equal(setup.with['create-args'],'libgdal-core=3.13.3');
  assert.equal(setup.with['init-shell'],'none');
  const f=fixture(t),calls=[],probe=argv=>{calls.push(argv);return{status:0,stdout:'3.13.3\n'};};
  const gutters=await nativeTestCapacity(['terrain-dem-gutters'],{root:f.root,probe,platform:'linux',architecture:'x64'});
  assert.equal(gutters.gdalEnvironment,false);assert.deepEqual(calls,[]);
  const tint=await nativeTestCapacity(['terrain-dem-tint','terrain-dem-fill'],{root:f.root,probe,platform:'linux',architecture:'x64'});
  assert.equal(tint.gdalEnvironment,true);assert.equal(tint.additionalBytes,0);
  assert.equal(calls.length,1);assert.deepEqual(calls[0].slice(1),['run','-n','pando-dem-gdal','gdal-config','--version']);
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
    {tools:false,recipeEnvironment:false,gdalEnvironment:false,additionalBytes:0});
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
  assert.deepEqual(consumers.sort(),['application-architecture.yml','application-architecture.yml','place-runtime.yml',
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
  await assert.rejects(prepareNativeTestTool('german-natural-earth',{root:f.root,platform:'linux',architecture:'x64'}),/Prepared native test source differs/);
  assert.equal(readFileSync(join(f.root,path),'utf8'),'different source');
});
