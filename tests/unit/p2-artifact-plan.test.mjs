import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, symlinkSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import { sharedSourceManifest } from "../../tools/build/package-shared-core-assets.mjs";
import {libraryMaterializedRoot,libraryReportRoot,librarySharedCheckout} from "../../tools/data/library-context.mjs";
import {withLibraryOutputs} from "../../tools/data/library-runtime.mjs";
import {publishContent,linkContent} from "../../tools/data/library-content.mjs";
import {reportPath} from "../../tools/data/report-paths.mjs";
import { wasmStatus, selectJobs, assertSafeGeneratedPaths,
  plan, assertArtifactsCurrent } from '../../scripts/p2-artifact-plan.mjs';
import { graphStatus, stageArtifacts, publishArtifacts, artifactEvidence, assertBranchState,
  RECEIPT_PATH,artifactGraph } from '../../scripts/lib/p2-artifact-graph.mjs';
import * as artifactOwners from '../../scripts/lib/p2-artifact-graph.mjs';
import { publishGeneratedArtifacts,publishP2FromWorkflow,archiveGeneratedLibraryOutputs,assertP2LibraryPublicationBase } from '../../scripts/p2-publish-artifacts.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
test('P2 isolates the generated work branch from a newer source-library work/gis branch',()=>{
  const pin='2fc08b781d9dc6a7709b6ac75c5a05ff3d935bff',gis='8beb97cca9992ae2099ab0ce19dca4d62f10961a';
  const proposed=assertP2LibraryPublicationBase({pinnedRevision:pin,
    checkoutHead:pin,targetBranch:'work/remote-only',targetRemote:null});
  assert.deepEqual(proposed,{branch:'work/remote-only',base:pin,creatingTarget:true});
  assert.equal(proposed.creatingTarget,true,'explicit creation requires full refs/heads destination');
  // Only target-branch movement matters. A newer work/gis source (gis) must
  // never be overwritten or silently imported when P2 creates its branch.
  assert.notEqual(gis,pin);
  assert.equal(assertP2LibraryPublicationBase({pinnedRevision:pin,
    checkoutHead:pin,targetBranch:'work/remote-only',targetRemote:pin}).creatingTarget,false);
  for(const options of [
    {pinnedRevision:pin,checkoutHead:gis,targetBranch:'work/remote-only',targetRemote:null},
    {pinnedRevision:pin,checkoutHead:pin,targetBranch:'work/remote-only',targetRemote:gis},
    {pinnedRevision:pin,checkoutHead:pin,targetBranch:'work/gis',targetRemote:gis},
  ]) assert.throws(()=>assertP2LibraryPublicationBase(options),/P2_LIBRARY_BASE_NOT_PINNED|P2_LIBRARY_TARGET_ADVANCED/);
  assert.throws(()=>assertP2LibraryPublicationBase({pinnedRevision:pin,
    checkoutHead:pin,targetBranch:'main',targetRemote:null}),/P2_LIBRARY_TARGET_BRANCH_INVALID/);
});

test('builtin country family replaces the retired aggregate throughout the artifact graph',()=>{
 const root=fileURLToPath(new URL('../../',import.meta.url)),graph=artifactGraph(root);
 const family=graph.find(row=>row.id==='builtin-world');
 assert.ok(family);assert.equal(graph.some(row=>row.id==='historical-world'||row.dependencies.includes('historical-world')),false);
 assert.deepEqual(family.outputs,['assets/data/builtin-world/generated/v1/']);
 for(const command of [...family.generate,...family.validate])assert.ok(readFileSync(join(root,command[1])).length);
 for(const consumer of family.consumers)assert.ok(readFileSync(join(root,consumer)).length);
 assert.ok(graph.find(row=>row.id==='prepared-mesh').dependencies.includes('builtin-world'));
 assert.equal(graph.some(row=>row.id==='build-metadata'),false);
});
function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'pando-p2-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const put=(p,b)=>{const file=join(root,p);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,b);};
  const get=p=>readFileSync(join(root,p));
  put('config/toolchain-versions.json',JSON.stringify({emscripten:'6.0.3'}));
  put('config/generated-artifacts.json',JSON.stringify({schema:'pandolab-generated-artifact-graph',schemaVersion:1,families:[]}));
  put('shared/CMakeLists.txt','project(Shared)\n');
  put('shared/core/src/calc.cpp','int calc=1;\n');
  const identity=sharedSourceManifest(root);
  put('assets/wasm/pandoeditor-core.js','export default()=>{};\n');
  put('assets/wasm/pandoeditor-core.wasm',Buffer.from([0,97,115,109,1,0,0,0]));
  put('assets/wasm/pandoeditor-core.manifest.json',JSON.stringify({
    schema:'pandoeditor-core-wasm',abiVersion:1,sourceSha256:identity.sourceSha256,
    compiler:{name:'emscripten',version:'6.0.3'},inputs:identity.inputs,
    assets:{
      js:{file:'pandoeditor-core.js',sha256:digest(get('assets/wasm/pandoeditor-core.js'))},
      wasm:{file:'pandoeditor-core.wasm',sha256:digest(get('assets/wasm/pandoeditor-core.wasm'))}
    }
  }));
  return {root,put,get};
}
test('current coherent source, generated bytes and dependency lists skip all compilers',t=>{
  const f=fixture(t), result=plan(f.root);
  assert.deepEqual(['wasm'].map(k=>result[k]),[false]);
  assert.equal(result.statuses.wasm.sourceSha256,sharedSourceManifest(f.root).sourceSha256);
});
test('a changed C++ input only invalidates its compiled WASM pair',t=>{
  const f=fixture(t);f.put('shared/core/src/calc.cpp','int calc=2;\n');
  const p=plan(f.root);
  assert.equal(p.wasm,true);
  assert.match(p.statuses.wasm.reasons.join(';'),/source fingerprint/);
});
test('missing or corrupted WASM runtime cannot be called up to date',t=>{
  const f=fixture(t);f.put('assets/wasm/pandoeditor-core.wasm','corrupt');
  assert.equal(wasmStatus(f.root).needed,true);
  assert.match(wasmStatus(f.root).reasons.join(';'),/wasm bytes\/hash/);
});
test('shared reference calculation edits invalidate WASM',t=>{
  const f=fixture(t);f.put('shared/core/src/referenceimage.cpp','int reference=1;\n');
  assert.equal(plan(f.root).wasm,true);
});
test('scope overrides are explicit and controller changes do not rebuild current WASM',()=>{
  const fresh={wasm:{needed:false}};
  assert.deepEqual(['wasm'].map(k=>selectJobs(fresh,[], 'auto')[k]),[false]);
  assert.equal(selectJobs(fresh,['.github/workflows/generated-artifacts-p2.yml']).bootstrap,true);
  assert.equal(selectJobs(fresh,['.github/workflows/generated-artifacts-p2.yml']).wasm,false);
  assert.equal(selectJobs(fresh,['scripts/p2-artifact-plan.mjs']).wasm,false);
  assert.equal(selectJobs(fresh,[],'wasm').wasm,true);
  assert.equal(selectJobs(fresh,[],'all').wasm,true);
  assert.deepEqual(['wasm'].map(k=>selectJobs(fresh,[], 'verify')[k]),[false]);
  assert.throws(()=>selectJobs(fresh,[],'unsupported'),/P2_INVALID_SCOPE/);
});
test('publishing is limited to declared generated artifacts, not source or test fixtures',()=>{
  assertSafeGeneratedPaths(['assets/wasm/pandoeditor-core.js'],{wasm:true});
  assert.throws(()=>assertSafeGeneratedPaths(['shared/core/src/project.cpp'],{wasm:true}),/P2_UNEXPECTED_GENERATED_FILE/);
  assert.throws(()=>assertSafeGeneratedPaths(['assets/wasm/pandoeditor-core.wasm'],{wasm:false}),/P2_UNEXPECTED_GENERATED_FILE/);
  assert.throws(()=>assertSafeGeneratedPaths(['tests/fixtures/geometry/cut-corpus.json'],{geometry:true}),/P2_UNEXPECTED_GENERATED_FILE/);
});

test('current output verification fails closed for any selected artifact',()=>{
  assertArtifactsCurrent({wasm:{needed:false}});
  assert.throws(()=>assertArtifactsCurrent({wasm:{needed:true,reasons:['source']}}),/P2_GENERATED_ARTIFACT_STALE: wasm/);
  assert.throws(()=>assertArtifactsCurrent({wasm:{needed:false}},['retired']),/P2_INVALID_SCOPE/);
});

function graphFixture(t) {
  const f=fixture(t);
  const git=(...args)=>execFileSync('git',args,{cwd:f.root,stdio:['ignore','pipe','pipe']}).toString('utf8').trim();
  git('init','-q');git('config','user.email','test@example.invalid');git('config','user.name','P2 fixture');
  f.put('.gitignore','build-native/\n');
  f.put('tools/generate.mjs',`import fs from 'node:fs';\nconst [id,input]=process.argv.slice(2);fs.mkdirSync('out',{recursive:true});fs.writeFileSync('out/'+id+'.txt',fs.readFileSync(input,'utf8')+' generated');\n`);
  f.put('tools/check.mjs',`import fs from 'node:fs';import assert from 'node:assert/strict';assert.match(fs.readFileSync(process.argv[2],'utf8'),/generated$/);\n`);
  const family=(id,input,dependencies=[])=>({id,dependencies,inputs:[input],outputs:['out/'+id+'.txt'],tools:['node'],consumers:['consumer/'+id],
    generate:[['node','tools/generate.mjs',id,input]],validate:[['node','tools/check.mjs','out/'+id+'.txt']]});
  const families=[family('a','input/a.txt'),family('b','out/a.txt',['a']),family('c','input/c.txt')];
  f.put('input/a.txt','source-a');f.put('input/c.txt','source-c');
  for(const id of ['a','b','c'])f.put('out/'+id+'.txt','old');
  const config=()=>f.put('config/generated-artifacts.json',JSON.stringify({schema:'pandolab-generated-artifact-graph',schemaVersion:1,families}));
  config();
  const commit=()=>{git('add','.');git('commit','-qm','fixture');return git('rev-parse','HEAD');};
  const head=commit();
  return {...f,git,head,commit,families,config};
}
async function publishFixture(f,stageDir='build-native/p2/initial') {
  const expectedSourceSha=f.git('rev-parse','HEAD');
  const staged=await stageArtifacts(f.root,{families:['a','b','c'],expectedSourceSha,stageDir});
  publishArtifacts(f.root,{stageDir,expectedSourceSha});
  return staged;
}

const integrationPresentationChanges=[
  'src/rendering/gpu-canvas-scene-packets.js',
  'src/rendering/gpu-canvas-worker.js',
  'src/rendering/map-renderer-composition.js',
  'src/data/physical-resources.js',
  'src/rendering/country-mesh-zoom-policy.js',
  'src/rendering/workers/canvas-render-worker.js',
  'src/map/map-input-presentation.js',
  'src/rendering/gpu-map-renderer.js',
  'scripts/r4d-check-retired-tests.mjs',
  'tests/unit/map-input-controller.test.mjs',
  '.github/workflows/viewer-functional-p6-2.yml',
  '.github/workflows/integration-read-model-p6.yml',
  '.github/workflows/e7-final-readonly-regression.yml',
  '.github/workflows/web-pages.yml',
  '.github/workflows/shared-core.yml',
  'eslint.config.js',
  '.github/workflows/viewer-preview.yml',
  'scripts/run-boundary-revision-comparison.mjs',
  'scripts/lib/library-preparation-wait.mjs',
  'scripts/frontend-dev-server.mjs',
  'scripts/check-renderer-v2.mjs',
  'scripts/lib/renderer-v2-architecture.mjs',
  'scripts/contracts/territorial-storage-access.json',
  'scripts/lib/territorial-storage-audit.mjs',
  'tools/cpp/validate-country-geometry.cpp',
  'tools/cpp/country-properties.h',
  'scripts/p2-artifact-plan.mjs',
  'tests/unit/p2-artifact-plan.test.mjs',
];
const staleDataFamilyIds=['territorial','current-world','builtin-world','world-mesh',
  'world-preview','world-bundle','shared-boundaries','prepared-mesh','places'];
const nativeValidationChanges=[
  'src/rendering/country-mesh-zoom-policy.js',
  'src/rendering/workers/canvas-render-worker.js',
  'scripts/p2-publish-artifacts.mjs',
  '.github/workflows/generated-artifacts-p2.yml',
  'docs/architecture/p7-ci-nonbrowser-recovery.md',
  'scripts/check-territorial-library.mjs',
  'scripts/lib/late-soviet-check.mjs',
  '.github/actions/native-test-prerequisites/action.yml',
  'scripts/lib/native-test-prerequisites.mjs',
  'scripts/prepare-native-test-tools.mjs',
  '.github/workflows/viewer-functional-p6-1.yml',
  '.github/workflows/application-architecture.yml',
  '.github/workflows/ui-architecture.yml',
  '.github/workflows/place-runtime.yml',
  '.github/workflows/shared-core.yml',
  '.devcontainer/devcontainer.json',
  '.devcontainer/setup-remote.sh',
  '.devcontainer/start-preview.sh',
  '.devcontainer/acceptance.sh',
  'scripts/remote-only-doctor.mjs',
  'scripts/lib/check-changes.mjs',
  'playwright.codespaces.config.js',
  'tests/unit/remote-only-contract.test.mjs',
  'tests/unit/codespaces-acceptance-contract.test.mjs',
];
function nativeValidationFixture(t) {
  const f=fixture(t);
  f.put('tools/generate.mjs','export const generator=1;\n');
  f.put('tools/check.mjs','export const validator=1;\n');
  f.put('input/data.json','original');
  const families=staleDataFamilyIds.map(id=>({id,dependencies:[],inputs:['input/data.json'],outputs:['out/'+id+'.txt'],
    tools:[],generate:[['node','tools/generate.mjs']],validate:[['node','tools/check.mjs']]}));
  const config=()=>f.put('config/generated-artifacts.json',JSON.stringify({schema:'pandolab-generated-artifact-graph',schemaVersion:1,families}));
  config();for(const id of staleDataFamilyIds)f.put('out/'+id+'.txt','existing generated output');
  artifactOwners.recordArtifactReceipts(f.root,{families:staleDataFamilyIds,sourceSha:'a'.repeat(40)});
  f.put('input/data.json','previously changed data');
  return {...f,families,config};
}

test('CI-only pushes leave existing stale data diagnostics without scheduling generation',t=>{
  const f=nativeValidationFixture(t),before=graphStatus(f.root);
  assert.deepEqual(before.selectedFamilies,staleDataFamilyIds);
  for(const path of nativeValidationChanges){
    const result=plan(f.root,{changes:[path],event:'push'});
    assert.equal(result.dataGenerationDeferred,true,path);
    assert.deepEqual(result.selectedFamilies,[],path);assert.equal(result.wasm,false,path);
    for(const id of staleDataFamilyIds){
      assert.equal(result.statuses[id].needed,true,id);
      assert.deepEqual(result.statuses[id].reasons,before.statuses[id].reasons,id);
      assert.equal(result.statuses[id].inputFingerprint,before.statuses[id].inputFingerprint,id);
    }
  }
});

test('CI-only exemptions never override declared generation ownership',t=>{
  const f=nativeValidationFixture(t),path='scripts/lib/native-test-prerequisites.mjs';
  f.put(path,'export const tool=1;\n');
  for(const kind of ['input','generator','output']){
    f.families[0].inputs=['input/data.json'];f.families[0].outputs=['out/territorial.txt'];
    f.put('tools/generate.mjs','export const generator=1;\n');
    if(kind==='input')f.families[0].inputs.push(path);
    if(kind==='output')f.families[0].outputs.push(path);
    if(kind==='generator')f.put('tools/generate.mjs','import "../'+path+'";\n');
    f.config();
    const result=plan(f.root,{changes:[path],event:'push'});
    assert.equal(result.dataGenerationDeferred,false,kind);
    assert.deepEqual(result.selectedFamilies,staleDataFamilyIds,kind);
  }
});

function staleDataFixture(t) {
  const f=graphFixture(t),template=f.families[0];
  f.families.splice(0,f.families.length,...staleDataFamilyIds.map(id=>({
    ...template,id,outputs:['out/'+id+'.txt'],
    generate:[['node','tools/generate.mjs',id,'input/a.txt']],
    validate:[['node','tools/check.mjs','out/'+id+'.txt']],
  })));
  f.config();
  for(const id of staleDataFamilyIds)f.put('out/'+id+'.txt','source-a generated');
  artifactOwners.recordArtifactReceipts(f.root,{families:staleDataFamilyIds,sourceSha:f.head});
  f.put('input/a.txt','previously changed data input');
  return f;
}

test('auto validation/presentation-only push leaves nine stale data families unselected',t=>{
  const f=staleDataFixture(t),before=graphStatus(f.root);
  assert.deepEqual(before.selectedFamilies,staleDataFamilyIds);
  const result=plan(f.root,{changes:integrationPresentationChanges,event:'push'});
  assert.deepEqual(result.selectedFamilies,[]);
  assert.deepEqual(result.blockedFamilies,[]);
  assert.equal(result.wasm,false);
  assert.equal(result.dataGenerationDeferred,true);
  for(const id of staleDataFamilyIds) {
    assert.equal(result.statuses[id].needed,true,id);
    assert.equal(result.statuses[id].selected,false,id);
    assert.deepEqual(result.statuses[id].reasons,before.statuses[id].reasons,id);
    assert.equal(result.statuses[id].inputFingerprint,before.statuses[id].inputFingerprint,id);
    assert.equal(result.statuses[id].outputFingerprint,before.statuses[id].outputFingerprint,id);
  }
  assert.throws(()=>assertArtifactsCurrent(result.statuses,staleDataFamilyIds),
    /P2_GENERATED_ARTIFACT_STALE: territorial/);
});

test('auto presentation guard preserves actual generator, data input and pin changes',t=>{
  for(const path of ['tools/generate.mjs','input/a.txt','config/library-data.json',
    'config/generated-artifacts.json','config/toolchain-versions.json']) {
    const f=staleDataFixture(t);
    assert.deepEqual(plan(f.root,{changes:[...integrationPresentationChanges,path],event:'push'}).selectedFamilies,
      staleDataFamilyIds,path);
  }
});

test('auto presentation guard gives declared input, generator closure and output ownership priority',t=>{
  for(const kind of ['input','input-prefix','pattern-input','deleted-prefix-input',
    'generator','validator','output','output-prefix','external-source']) {
    const f=staleDataFixture(t);
    const path=['generator','validator'].includes(kind)?'src/map/map-input-presentation.js'
      :kind.startsWith('output')?'.github/workflows/viewer-functional-p6-2.yml':'tests/fixtures/generator-input.json';
    f.put(path,'{}');
    if(kind==='input')f.families[0].inputs.push(path);
    if(['input-prefix','deleted-prefix-input'].includes(kind))f.families[0].inputs.push('tests/fixtures/');
    if(kind==='pattern-input')f.families[0].inputs.push({prefix:'tests/fixtures/',pattern:'generator-input\\.json$'});
    if(kind==='generator')f.put('tools/generate.mjs',f.get('tools/generate.mjs')+'\nimport "../'+path+'";\n');
    if(kind==='validator')f.put('tools/check.mjs',f.get('tools/check.mjs')+'\nimport "../'+path+'";\n');
    if(kind==='output')f.families[0].outputs.push(path);
    if(kind==='output-prefix')f.families[0].outputs.push('.github/workflows/');
    if(kind==='deleted-prefix-input'||kind==='output-prefix')rmSync(join(f.root,path));
    if(kind==='external-source')f.families[0].externalSources=[{
      path,source:'https://example.invalid/pinned.json',version:'1',sha256:digest(f.get(path))}];
    f.config();
    const before=graphStatus(f.root),result=plan(f.root,{changes:[...integrationPresentationChanges,path],event:'push'});
    assert.equal(result.dataGenerationDeferred,false,kind);
    assert.deepEqual(result.selectedFamilies,before.selectedFamilies,kind);
    assert.deepEqual(result.blockedFamilies,before.blockedFamilies,kind);
  }
});

test('auto presentation guard keeps manual modes, explicit families and unknown comparisons unchanged',t=>{
  const f=staleDataFixture(t);
  for(const event of ['workflow_dispatch','local','']) {
    assert.deepEqual(plan(f.root,{changes:integrationPresentationChanges,event}).selectedFamilies,
      staleDataFamilyIds,event);
  }
  assert.deepEqual(plan(f.root,{changes:[],event:'push'}).selectedFamilies,staleDataFamilyIds);
  const all=plan(f.root,{changes:integrationPresentationChanges,event:'push',manual:'all'});
  assert.deepEqual(all.selectedFamilies,staleDataFamilyIds);assert.equal(all.wasm,true);
  const wasm=plan(f.root,{changes:integrationPresentationChanges,event:'push',manual:'wasm'});
  assert.deepEqual(wasm.selectedFamilies,[]);assert.equal(wasm.wasm,true);
  const verify=plan(f.root,{changes:integrationPresentationChanges,event:'push',manual:'verify'});
  assert.deepEqual(verify.selectedFamilies,[]);assert.equal(verify.verifyOnly,true);
  assert.deepEqual(plan(f.root,{changes:integrationPresentationChanges,event:'push',families:['territorial']}).selectedFamilies,
    ['territorial']);
});

test('auto presentation guard does not change a required WASM rebuild or its data publication',t=>{
  const f=staleDataFixture(t);f.put('shared/core/src/calc.cpp','int calc=2;\n');
  const result=plan(f.root,{changes:integrationPresentationChanges,event:'push'});
  assert.equal(result.wasm,true);
  assert.match(result.statuses.wasm.reasons.join(';'),/source fingerprint/);
  assert.deepEqual(result.selectedFamilies,staleDataFamilyIds);
});

test('graph regeneration follows downstream dependencies and preserves unrelated families',async t=>{
  const f=graphFixture(t);await publishFixture(f);f.commit();
  assert.deepEqual(graphStatus(f.root).selectedFamilies,[]);
  f.put('input/a.txt','changed');
  const plan=graphStatus(f.root);
  assert.deepEqual(plan.selectedFamilies,['a','b']);
  assert.ok(plan.statuses.b.reasons.some(reason=>reason.includes('upstream')));
  assert.equal(plan.statuses.c.needed,false);
  assert.match(plan.statuses.a.inputs['input/a.txt'],/^[a-f0-9]{64}$/);
  assert.deepEqual(plan.statuses.a.consumers,['consumer/a']);
});

test('corrupt output and missing pinned GIS input fail visibly without a download',async t=>{
  const f=graphFixture(t);await publishFixture(f);f.commit();
  f.put('out/a.txt','corrupt');
  assert.match(graphStatus(f.root).statuses.a.reasons.join(';'),/output bytes\/hash/);
  f.families.push({id:'gis',manual:true,dependencies:[],inputs:[],outputs:['out/gis.bin'],generate:[],validate:[],
    externalSources:[{path:'external/source.tif',source:'https://example.invalid/pinned.tif',version:'1',sha256:'a'.repeat(64)}]});
  f.config();
  const result=graphStatus(f.root,{requested:['gis']});
  assert.equal(result.statuses.gis.selected,false);
  assert.match(result.statuses.gis.blocked.join(';'),/missing or mismatched external source/);
});

test('stage validates actual outputs and does not alter live bytes until publish',async t=>{
  const f=graphFixture(t),stageDir='build-native/p2/staged';
  const staged=await stageArtifacts(f.root,{families:['a','b','c'],expectedSourceSha:f.head,stageDir});
  assert.equal(f.get('out/a.txt').toString(),'old');
  assert.ok(staged.paths.includes(RECEIPT_PATH));
  const result=publishArtifacts(f.root,{stageDir,expectedSourceSha:f.head});
  assert.equal(f.get('out/b.txt').toString(),'source-a generated generated');
  assert.ok(result.changedPaths.includes('out/b.txt'));
  const final=f.commit(),evidence=artifactEvidence(f.root,{resultSha:final,expectedSourceSha:f.head,evidenceFile:'build-native/p2/evidence.json'});
  assert.equal(evidence.resultSha,final);assert.deepEqual(evidence.intermediateSourceShas,[f.head]);
  assert.deepEqual(graphStatus(f.root).selectedFamilies,[]);
});

test('unchanged regeneration does not copy files or update provenance just to create a commit',async t=>{
  const f=graphFixture(t);await publishFixture(f);const head=f.commit();
  const stageDir='build-native/p2/no-change';
  const staged=await stageArtifacts(f.root,{families:['a','b','c'],expectedSourceSha:head,stageDir});
  assert.deepEqual(staged.paths,[]);
  assert.deepEqual(publishArtifacts(f.root,{stageDir,expectedSourceSha:head}).changedPaths,[]);
  assert.equal(f.git('status','--porcelain'),'');
});

test('failed validation, unexpected output, and dirty source cannot publish partial generations',async t=>{
  const f=graphFixture(t);
  f.put('input/a.txt','dirty');
  await assert.rejects(stageArtifacts(f.root,{families:['a','b','c'],expectedSourceSha:f.head,stageDir:'build-native/p2/dirty'}),/P2_DIRTY_SOURCE_CHECKOUT/);
  const head=f.commit();
  await assert.rejects(stageArtifacts(f.root,{families:['a','b','c'],expectedSourceSha:head,stageDir:'build-native/p2/failed',
    run:()=>{throw Error('validator failed');}}),/validator failed/);
  assert.equal(f.get('out/a.txt').toString(),'old');
  await assert.rejects(stageArtifacts(f.root,{families:['a','b','c'],expectedSourceSha:head,stageDir:'build-native/p2/outside',
    run:(_command,cwd)=>writeFileSync(join(cwd,'input/a.txt'),'unexpected')}),/P2_UNEXPECTED_GENERATED_FILE/);
  assert.equal(f.get('input/a.txt').toString(),'dirty');
});

test('remote movement aborts publication and partial write failure restores all old bytes',async t=>{
  const f=graphFixture(t),stageDir='build-native/p2/rollback';
  await stageArtifacts(f.root,{families:['a','b','c'],expectedSourceSha:f.head,stageDir});
  assert.throws(()=>publishArtifacts(f.root,{stageDir,expectedSourceSha:f.head,guard:()=>{throw Error('P2_REMOTE_BRANCH_CHANGED');}}),/P2_REMOTE_BRANCH_CHANGED/);
  assert.equal(f.get('out/a.txt').toString(),'old');
  assert.throws(()=>publishArtifacts(f.root,{stageDir,expectedSourceSha:f.head,beforeWrite:(_p,index)=>{if(index===1)throw Error('disk failure');}}),/disk failure/);
  for(const id of ['a','b','c'])assert.equal(f.get('out/'+id+'.txt').toString(),'old');
  publishArtifacts(f.root,{stageDir,expectedSourceSha:f.head});
  assert.equal(f.get('out/a.txt').toString(),'source-a generated');
});

test('a changed source SHA is rejected before publication',t=>{
  const f=graphFixture(t);
  f.put('input/a.txt','changed source');
  const changed=f.commit();assert.notEqual(changed,f.head);
  assert.throws(()=>assertBranchState(f.root,{expectedSourceSha:f.head}),/P2_LOCAL_SOURCE_CHANGED/);
});

function remoteFixture(t,{failValidation=false}={}) {
  const f=graphFixture(t);
  if(failValidation) {
    f.families[1].validate=[['node','tools/fail.mjs']];
    f.put('tools/fail.mjs',"throw Error('Web validation failed');\n");
    f.config();f.commit();
  }
  const remote=join(f.root,'build-native/p2/remote.git');
  mkdirSync(dirname(remote),{recursive:true});f.git('init','--bare','-q',remote);
  f.git('--git-dir',remote,'config','core.logAllRefUpdates','true');
  f.git('branch','-M','work/objects');f.git('remote','add','origin',remote);
  f.git('push','-q','origin','HEAD:refs/heads/work/objects');
  return {...f,remote,source:f.git('rev-parse','HEAD'),remoteHead:()=>f.git('ls-remote','origin','refs/heads/work/objects').split(/\s/)[0]};
}

test('publication commits WASM then Web and writes the remote once at the final SHA',async t=>{
  const f=remoteFixture(t);
  f.put('assets/wasm/pandoeditor-core.js','export default()=>({regenerated:true});\n');
  const manifest=JSON.parse(f.get('assets/wasm/pandoeditor-core.manifest.json'));
  manifest.assets.js.sha256=digest(f.get('assets/wasm/pandoeditor-core.js'));
  f.put('assets/wasm/pandoeditor-core.manifest.json',JSON.stringify(manifest));
  const result=await publishGeneratedArtifacts(f.root,{expectedSourceSha:f.source,branch:'work/objects',wasmBuilt:true,
    beforeFinalGuard:()=>assert.equal(f.remoteHead(),f.source,'intermediate commits must remain local')});
  assert.deepEqual(result.commits.map(c=>c.phase),['wasm','web']);
  assert.equal(f.remoteHead(),result.resultSha);
  const receipt=JSON.parse(f.get(RECEIPT_PATH));
  for(const id of ['a','b','c'])assert.equal(receipt.families[id].sourceSha,result.commits[0].sha);
  const updates=f.git('--git-dir',f.remote,'reflog','show','--format=%H','refs/heads/work/objects').split('\n');
  assert.equal(updates.length,2,'one initial fixture push and one final publication');
  assert.equal(JSON.parse(f.get(result.evidenceFile)).resultSha,result.resultSha);
});

test('Web validation failure keeps a successful local WASM commit off the remote',async t=>{
  const f=remoteFixture(t,{failValidation:true});
  f.put('assets/wasm/pandoeditor-core.js','export default()=>({regenerated:true});\n');
  const manifest=JSON.parse(f.get('assets/wasm/pandoeditor-core.manifest.json'));
  manifest.assets.js.sha256=digest(f.get('assets/wasm/pandoeditor-core.js'));
  f.put('assets/wasm/pandoeditor-core.manifest.json',JSON.stringify(manifest));
  await assert.rejects(publishGeneratedArtifacts(f.root,{expectedSourceSha:f.source,branch:'work/objects',wasmBuilt:true}),/Command failed/);
  assert.notEqual(f.git('rev-parse','HEAD'),f.source,'WASM was committed locally before Web validation');
  assert.equal(f.remoteHead(),f.source,'failed Web outputs cannot publish the intermediate WASM commit');
  for(const id of ['a','b','c'])assert.equal(f.get('out/'+id+'.txt').toString(),'old');
});

test('wasm-only publication does not generate or claim unrecorded data families',async t=>{
  const f=remoteFixture(t);
  assert.deepEqual(plan(f.root,{manual:'wasm'}).selectedFamilies,[]);
  const result=await publishGeneratedArtifacts(f.root,{scope:'wasm',expectedSourceSha:f.source,branch:'work/objects',wasmBuilt:true});
  assert.equal(result.pushed,false);assert.equal(f.get('out/a.txt').toString(),'old');
  const evidence=JSON.parse(f.get(result.evidenceFile));
  assert.deepEqual(evidence.families,{});assert.deepEqual(evidence.verifiedScope,['wasm']);
  assert.ok(evidence.wasm.assets.wasm.sha256);
});

test('verify scope checks current manifests and generator validators without commits or pushes',async t=>{
  const f=remoteFixture(t);
  await assert.rejects(publishGeneratedArtifacts(f.root,{scope:'verify',expectedSourceSha:f.source,branch:'work/objects'}),/P2_GENERATED_ARTIFACT_STALE/);
  const published=await publishGeneratedArtifacts(f.root,{expectedSourceSha:f.source,branch:'work/objects'});
  const verified=await publishGeneratedArtifacts(f.root,{scope:'verify',expectedSourceSha:published.resultSha,branch:'work/objects'});
  assert.equal(verified.resultSha,published.resultSha);assert.equal(verified.pushed,false);assert.deepEqual(verified.commits,[]);
  assert.deepEqual(verified.verifiedScope,['wasm','a','b','c']);
});

test('a concurrent remote commit survives the final publication guard',async t=>{
  const f=remoteFixture(t);let concurrent;
  await assert.rejects(publishGeneratedArtifacts(f.root,{expectedSourceSha:f.source,branch:'work/objects',
    beforeFinalGuard:()=>{
      concurrent=f.git('commit-tree',f.git('rev-parse',f.source+'^{tree}'),'-p',f.source,'-m','another author');
      f.git('push','-q','origin',concurrent+':refs/heads/work/objects');
    }}),/P2_REMOTE_BRANCH_CHANGED/);
  assert.equal(f.remoteHead(),concurrent);
  assert.notEqual(f.remoteHead(),f.git('rev-parse','HEAD'));
});


test('frontend metadata and HTML are derived outputs rather than Git publication families',()=>{
 const graph=artifactGraph(fileURLToPath(new URL('../../',import.meta.url)));
 for(const family of graph)for(const output of family.outputs)assert.equal(['index.html','apps/editor/editor.html','assets/js/build-meta.js'].includes(output),false);
});

test('world bundle ownership follows the current manifest rather than every cached object', t => {
  const f=fixture(t);
  f.put('assets/data/world/build-input.json',JSON.stringify({legacyPreviewManifest:'legacy.json'}));
  f.put('assets/data/legacy.json',JSON.stringify({assets:{},sharedBoundaries:{}}));
  f.put('assets/data/world/current.json',JSON.stringify({assets:{packet:{url:'world/objects/current.bin'}}}));
  f.put('assets/data/world/objects/current.bin','current');
  f.put('assets/data/world/objects/retired.bin','retired');
  f.put('config/generated-artifacts.json',JSON.stringify({schema:'pandolab-generated-artifact-graph',schemaVersion:1,
    families:[{id:'world-bundle',resolve:'world-bundle',outputs:['assets/data/world/current.json']}]}));
  const family=artifactGraph(f.root)[0];
  assert.deepEqual(family.outputs,['assets/data/world/current.json','assets/data/world/objects/current.bin']);
  assert.deepEqual(Object.keys(graphStatus(f.root).statuses['world-bundle'].outputs),family.outputs);
});

test('artifact receipts refresh only the validated family and preserve dirty-source provenance', t => {
  const f=fixture(t);
  f.put('config/generated-artifacts.json',JSON.stringify({schema:'pandolab-generated-artifact-graph',schemaVersion:1,
    families:[{id:'current',outputs:['out/current.bin']}]}));
  f.put('out/current.bin','current');
  f.put(RECEIPT_PATH,JSON.stringify({schema:'pandolab-generated-artifact-receipt',schemaVersion:1,
    families:{unrelated:{sourceSha:'old',outputs:{'old.bin':'old'}}}}));
  artifactOwners.recordArtifactReceipts(f.root,{families:['current'],sourceSha:'a'.repeat(40),sourceDirty:true});
  const receipt=JSON.parse(f.get(RECEIPT_PATH));
  assert.deepEqual(receipt.families.unrelated,{sourceSha:'old',outputs:{'old.bin':'old'}});
  assert.equal(receipt.families.current.sourceDirty,true);
  assert.equal(graphStatus(f.root).statuses.current.needed,false);
  f.put('config/generated-artifacts.json',JSON.stringify({schema:'pandolab-generated-artifact-graph',schemaVersion:1,
    families:[{id:'current',outputs:['out/missing.bin']}]}));
  assert.throws(()=>artifactOwners.recordArtifactReceipts(f.root,{families:['current'],sourceSha:'a'.repeat(40)}),/P2_MISSING_RECEIPT_OUTPUT/);
  assert.deepEqual(JSON.parse(f.get(RECEIPT_PATH)),receipt,'failed recording preserves the old receipt');
});


test('staging excludes private data cache and baselines existing external mounts',async t=>{
  const f=graphFixture(t), revision='a'.repeat(40);
  f.put('.gitignore','build-native/\n.library-data/\nassets/data/\nreports/\n');
  f.put('config/library-data.json',JSON.stringify({repository:'example/data',revision,mounts:['assets/data','reports']}));
  const head=f.commit();
  const staged=await stageArtifacts(f.root,{families:['a'],expectedSourceSha:head,stageDir:'build-native/p2/external',
    prepareData:({root})=>{
      const materialized=join(libraryMaterializedRoot(root),'assets/data');
      const reports=libraryReportRoot(root);
      mkdirSync(materialized,{recursive:true});mkdirSync(reports,{recursive:true});mkdirSync(join(root,'assets'),{recursive:true});
      writeFileSync(join(materialized,'existing.bin'),'existing runtime');
      writeFileSync(join(libraryMaterializedRoot(root),'.complete'),revision);
      writeFileSync(join(libraryMaterializedRoot(root),'.cache-owner.json'),JSON.stringify({schema:'pando-shared-runtime-v1',owner:'main',revision,files:{}}));
      writeFileSync(join(reports,'existing.md'),'existing evidence');
      writeFileSync(join(root,'.library-data/private-cache'),'not a product file');
      symlinkSync(materialized,join(root,'assets/data'),process.platform==='win32'?'junction':'dir');
      symlinkSync(reports,join(root,'reports'),process.platform==='win32'?'junction':'dir');
    }});
  assert.ok(staged.paths.includes('out/a.txt'));
  assert.equal(staged.paths.some(path=>path.startsWith('.library-data/')||path==='assets/data/existing.bin'||path==='reports/existing.md'),false);
});

test('report ownership bookkeeping is excluded while unexpected logical reports are rejected',async t=>{
 const f=graphFixture(t);
 const run=(command,cwd)=>{
  execFileSync(process.execPath,command.slice(1),{cwd,stdio:'pipe'});
  for(const path of ['reports/.variants/original','reports/.edits/owner/draft.md','reports/.owners.json']){
   mkdirSync(dirname(join(cwd,path)),{recursive:true});writeFileSync(join(cwd,path),'library ownership bytes');
  }
 };
 const staged=await stageArtifacts(f.root,{families:['a'],expectedSourceSha:f.head,stageDir:'build-native/p2/report-controls',run});
 assert.deepEqual(staged.paths.filter(p=>p.startsWith('reports/')),[]);
 await assert.rejects(stageArtifacts(f.root,{families:['a'],expectedSourceSha:f.head,stageDir:'build-native/p2/unowned-report',run:(command,cwd)=>{
  run(command,cwd);mkdirSync(join(cwd,'reports/development'),{recursive:true});writeFileSync(join(cwd,'reports/development/unexpected.md'),'unique report');
 }}),/P2_UNEXPECTED_GENERATED_FILE: reports\/development\/unexpected.md/);
});

test('receipt and publication writes detach readonly data and retain the original shared bytes',async t=>{
 const f=graphFixture(t),revision='a'.repeat(40),output='assets/data/example/out.json';
 f.families[0].outputs=[output];f.config();f.put('.gitignore','build-native/\n.library-data/\n/assets/data\n');
 f.put('config/library-data.json',JSON.stringify({repository:'example/data',revision,mounts:['assets/data']}));
 const setup=root=>{
  const shared=librarySharedCheckout(root),view=libraryMaterializedRoot(root),files={};
  for(const [path,text]of [[output,'old'],[RECEIPT_PATH,JSON.stringify({schema:'pandolab-generated-artifact-receipt',schemaVersion:1,families:{}})]]){
   const blob=publishContent(shared,Buffer.from(text));linkContent(shared,blob.sha256,join(view,path));files[path]={sha256:blob.sha256,bytes:Buffer.byteLength(text),storage:'shared'};
  }
  writeFileSync(join(view,'.cache-owner.json'),JSON.stringify({schema:'pando-shared-runtime-v1',owner:'main',revision,files}));writeFileSync(join(view,'.complete'),revision);
  mkdirSync(join(root,'assets'),{recursive:true});symlinkSync(join(view,'assets/data'),join(root,'assets/data'),process.platform==='win32'?'junction':'dir');
  return{shared,view,files};
 };
 const original=setup(f.root),head=f.commit(),stageDir='build-native/p2/readonly';
 assert.equal(f.git('ls-files','--','assets/data'),'','the external data mount must remain untracked on every platform');
 await stageArtifacts(f.root,{families:['a'],expectedSourceSha:head,stageDir,prepareData:({root})=>setup(root),run:(command,cwd)=>{
  if(command[1]==='tools/generate.mjs')withLibraryOutputs({root:cwd,paths:[join(cwd,output)]},()=>writeFileSync(join(cwd,output),'source-a generated'));
  else assert.equal(readFileSync(join(cwd,output),'utf8'),'source-a generated');
 }});
 assert.throws(()=>publishArtifacts(f.root,{stageDir,expectedSourceSha:head,beforeWrite:(_path,index)=>{if(index===1)throw Error('interrupted publication');}}),/interrupted publication/);
 assert.equal(readFileSync(join(f.root,output),'utf8'),'old');
 publishArtifacts(f.root,{stageDir,expectedSourceSha:head});
 assert.equal(readFileSync(join(f.root,output),'utf8'),'source-a generated');
 for(const [path,row]of Object.entries(original.files)){
  const blob=join(original.shared,'.pando-store/blobs',row.sha256);
  assert.equal(readFileSync(blob).length,row.bytes);assert.equal(statSync(blob).mode&0o200,0);
  assert.notEqual(statSync(join(f.root,path)).ino,statSync(blob).ino);
 }
});
test('mounted publication stages only the stored pin and excludes unrelated writable data',t=>{
 const f=graphFixture(t),before={repository:'example/data',revision:'a'.repeat(40),mounts:['assets/data']};
 f.put('config/library-data.json',JSON.stringify(before));const view=libraryMaterializedRoot(f.root);mkdirSync(view,{recursive:true});
 writeFileSync(join(view,'.cache-owner.json'),JSON.stringify({files:{'assets/data/selected.bin':{storage:'private'},'assets/data/unrelated.bin':{storage:'private'}}}));
 const calls=[],revision='b'.repeat(40),result=archiveGeneratedLibraryOutputs(f.root,['assets/data/selected.bin'],{
  store(options){calls.push(options);f.put('config/library-data.json',JSON.stringify({...before,revision}));return revision;},
  prepare(options){assert.deepEqual(options,{root:f.root,fetch:false});},
 });
 assert.deepEqual(result.changedPaths,['config/library-data.json']);assert.equal(result.libraryRevision,revision);
 assert.deepEqual(calls,[{root:f.root,push:true,prefixes:['assets/data/selected.bin']}]);
 f.put('config/library-data.json',JSON.stringify(before));writeFileSync(join(view,'.cache-owner.json'),JSON.stringify({files:{'assets/data/territorial-entities/source/unfinished.json':{storage:'private'}}}));
 assert.throws(()=>archiveGeneratedLibraryOutputs(f.root,['assets/data/territorial-entities/generated/v2/index.json'],{store(){throw Error('must not archive WIP');}}),/P2_UNRELATED_RUNTIME_WIP/);
});

test('result evidence verifies mounted output from the committed library pin, not mutable views or archive HEAD',t=>{
 const f=graphFixture(t),checkout=join(f.root,'.library-data/repository'),output='assets/data/example.bin';
 mkdirSync(checkout,{recursive:true});
 const dataGit=(...args)=>execFileSync('git',args,{cwd:checkout,stdio:'pipe'}).toString().trim();
 dataGit('init','-q');dataGit('config','user.email','fixture@example.invalid');dataGit('config','user.name','Fixture');
 const bytes=Buffer.from('validated generated bytes'),receipt=Buffer.from(JSON.stringify({families:{a:{sourceSha:f.head,outputs:{[output]:digest(bytes)}}}}));
 const entries={};
 for(const [path,content]of [[output,bytes],[RECEIPT_PATH,receipt]]){
  const stored='archive/blobs/'+digest(content)+'.bin';mkdirSync(dirname(join(checkout,stored)),{recursive:true});writeFileSync(join(checkout,stored),content);
  entries[path]={stored,encoding:'identity',bytes:content.length,sha256:digest(content)};
 }
 writeFileSync(join(checkout,'archive/index.json'),JSON.stringify({files:entries}));
 dataGit('add','.');dataGit('commit','-qm','validated archive');const revision=dataGit('rev-parse','HEAD');
 f.put('.gitignore','build-native/\n.library-data/\nassets/data/\n');
 f.put('config/library-data.json',JSON.stringify({repository:'example/data',revision,mounts:['assets/data']}));
 const resultSha=f.commit();
 f.put(output,'uncommitted runtime bytes');
 writeFileSync(join(checkout,entries[output].stored),'corrupt newer archive bytes');dataGit('add','.');dataGit('commit','-qm','newer unrelated archive');
 const evidence=artifactEvidence(f.root,{resultSha,expectedSourceSha:f.head,evidenceFile:'build-native/p2/pinned-evidence.json',families:['a']});
 assert.equal(evidence.libraryRevision,revision);assert.deepEqual(evidence.verifiedScope,['wasm','a']);
 f.put('config/library-data.json',JSON.stringify({repository:'example/data',revision:dataGit('rev-parse','HEAD'),mounts:['assets/data']}));
 const corrupted=f.commit();
 assert.throws(()=>artifactEvidence(f.root,{resultSha:corrupted,expectedSourceSha:f.head,evidenceFile:'build-native/p2/corrupt-evidence.json',families:['a']}),/corrupt/);
});

test('report fingerprints follow the owner read view when originals are stored only as variants',t=>{
 const f=graphFixture(t),checkout=join(f.root,'.library-data/repository'),logical='reports/places/tier1-major-cities-batch01.json',bytes=Buffer.from('{"records":[]}\n');
 mkdirSync(join(checkout,'reports/places'),{recursive:true});mkdirSync(join(checkout,'archive'),{recursive:true});
 const dataGit=(...args)=>execFileSync('git',args,{cwd:checkout,stdio:'pipe'}).toString().trim();
 dataGit('init','-q');dataGit('config','user.email','fixture@example.invalid');dataGit('config','user.name','Fixture');
 writeFileSync(join(checkout,logical),bytes);
 writeFileSync(join(checkout,'archive/index.json'),JSON.stringify({reportLayout:'subjects-v1',files:{[logical]:{stored:logical,encoding:'identity',bytes:bytes.length,sha256:digest(bytes)}}}));
 dataGit('add','.');dataGit('commit','-qm','report edition');const revision=dataGit('rev-parse','HEAD');
 rmSync(join(checkout,logical));
 f.put('.gitignore','build-native/\n.library-data/\nreports/\n');
 f.put('config/library-data.json',JSON.stringify({repository:'example/data',revision,mounts:['reports']}));
 symlinkSync(join(checkout,'reports'),join(f.root,'reports'),process.platform==='win32'?'junction':'dir');
 f.families[0].inputs=[{prefix:'reports/places/',pattern:'batch01\\.json$'}];f.config();
 const view=reportPath('reports/places',{root:f.root,access:'read'});
 assert.equal(readFileSync(join(view,'tier1-major-cities-batch01.json'),'utf8'),bytes.toString());
 const status=graphStatus(f.root).statuses.a;
 assert.deepEqual(status.inputs,{[logical]:digest(bytes)});
});


function workflowRemoteFixture(t) {
  const f=graphFixture(t),remote=mkdtempSync(join(tmpdir(),'pando-p2-remote-'));
  t.after(()=>rmSync(remote,{recursive:true,force:true}));
  execFileSync('git',['init','--bare','-q',remote]);
  f.git('branch','-M','work/objects');
  f.git('remote','add','origin',remote);
  f.git('push','-q','-u','origin','HEAD:refs/heads/work/objects');
  return f;
}

test('P2 skips a superseded CI source only if the remote head is a fast-forward',async t=>{
  const f=workflowRemoteFixture(t),source=f.git('rev-parse','HEAD');
  f.git('commit','--allow-empty','-qm','newer source commit');
  const advanced=f.git('rev-parse','HEAD');
  f.git('push','-q','origin','HEAD:refs/heads/work/objects');
  f.git('checkout','-q','--detach',source);
  const result=await publishP2FromWorkflow(f.root,{scope:'auto',expectedSourceSha:source,branch:'work/objects'});
  assert.equal(result.superseded,true);
  assert.equal(result.pushed,false);
  assert.equal(result.supersededBy,advanced);
  assert.deepEqual(result.verifiedScope,[]);
  assert.equal(f.git('rev-parse','HEAD'),source,'obsolete source must remain untouched');
  assert.match(f.git('ls-remote','origin','refs/heads/work/objects'),new RegExp('^'+advanced));
});

test('P2 never disguises a remote history rewrite as superseded success',async t=>{
  const f=workflowRemoteFixture(t),source=f.git('rev-parse','HEAD');
  f.git('checkout','--orphan','unrelated');
  f.git('commit','--allow-empty','-qm','unrelated history');
  f.git('push','--force','-q','origin','HEAD:refs/heads/work/objects');
  f.git('checkout','-q','--detach',source);
  await assert.rejects(
    ()=>publishP2FromWorkflow(f.root,{scope:'auto',expectedSourceSha:source,branch:'work/objects'}),
    /P2_REMOTE_BRANCH_CHANGED_NON_FAST_FORWARD/
  );
  assert.equal(f.git('rev-parse','HEAD'),source);
});
