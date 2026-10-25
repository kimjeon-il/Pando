// P2's existing publication transaction: compile/ABI checks run in the workflow,
// then locally commit WASM and Web outputs before one guarded push.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, OUTPUTS, wasmStatus, assertArtifactsCurrent, assertSafeGeneratedPaths } from './p2-artifact-plan.mjs';
import { artifactGraph, graphStatus, stageArtifacts, publishArtifacts, assertBranchState,
  artifactEvidence, verifyArtifactFamilies } from './lib/p2-artifact-graph.mjs';
import {libraryConfig,libraryCheckout,libraryMaterializedRoot,storeLibraryData,prepareLibraryData} from '../tools/library-data.mjs';

const git=(cwd,args)=>execFileSync('git',args,{cwd,maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe']}).toString('utf8').trim();
const paths=(cwd,args)=>git(cwd,[...args,'-z']).split('\0').filter(Boolean);
const validWorkBranch = branch => /^work\/[a-z0-9][a-z0-9-]{0,63}$/.test(branch);

// Archive validated mounted outputs through their storage owner. Application
// Git receives only the paired revision, never the mounted payload itself.
export function archiveGeneratedLibraryOutputs(cwd,changed,{store=storeLibraryData,prepare=prepareLibraryData}={}){
  if(!existsSync(resolve(cwd,'config/library-data.json')))return{changedPaths:changed,libraryRevision:null};
  const before=libraryConfig(cwd),mounted=path=>before.mounts.some(mount=>mount!=='reports'&&(path===mount||path.startsWith(mount+'/')));
  const runtime=changed.filter(mounted);if(!runtime.length)return{changedPaths:changed,libraryRevision:null};
  const prefixes=[...new Set(runtime.map(path=>path.startsWith('assets/data/territorial-entities/')?'assets/data/territorial-entities':path))];
  const record=JSON.parse(readFileSync(resolve(libraryMaterializedRoot(cwd),'.cache-owner.json'))),selected=new Set(runtime);
  for(const [path,file]of Object.entries(record.files))if(file.storage==='private'&&!selected.has(path)&&prefixes.some(prefix=>path===prefix||path.startsWith(prefix+'/')))throw Error('P2_UNRELATED_RUNTIME_WIP: '+path);
  if(store===storeLibraryData){
    const checkout=libraryCheckout(cwd),index=JSON.parse(readFileSync(resolve(checkout,'archive/index.json')));
    const remote=git(checkout,['ls-remote','origin','refs/heads/'+index.branch]).split(/\s/)[0];
    assert.equal(git(checkout,['rev-parse','HEAD']),remote,'P2_LIBRARY_BASE_NOT_REMOTE: preserve pending history before choosing a clean published base');
    const pinned=JSON.parse(git(checkout,['show',before.revision+':archive/index.json']));
    for(const path of new Set([...Object.keys(index.files),...Object.keys(pinned.files)]))if(!path.startsWith('reports/')&&!prefixes.some(prefix=>path===prefix||path.startsWith(prefix+'/')))assert.equal(index.files[path]?.sha256,pinned.files[path]?.sha256,'P2_LIBRARY_BASE_RUNTIME_CHANGED: '+path);
  }
  const revision=store({root:cwd,push:true,prefixes}),after=libraryConfig(cwd);
  assert.equal(after.revision,revision,'P2_LIBRARY_PIN_NOT_STORED');
  assert.deepEqual({...after,revision:before.revision},before,'P2_UNEXPECTED_LIBRARY_CONFIG_CHANGE');
  prepare({root:cwd,fetch:false});
  return{changedPaths:[...changed.filter(path=>!mounted(path)),'config/library-data.json'],libraryRevision:revision};
}

function commitOutputs(cwd,changed,families,message) {
  if(!changed.length)return false;
  assertSafeGeneratedPaths(changed,Object.fromEntries(families.map(id=>[id,true])),cwd);
  const archived=archiveGeneratedLibraryOutputs(cwd,changed);
  git(cwd,['add','-A','--',...archived.changedPaths]);
  git(cwd,['diff','--cached','--check']);
  const staged=paths(cwd,['diff','--cached','--name-only']);
  assertSafeGeneratedPaths(staged.filter(path=>!(archived.libraryRevision&&path==='config/library-data.json')),Object.fromEntries(families.map(id=>[id,true])),cwd);
  if(!staged.length)return false;
  git(cwd,['commit','-m',message+' [skip ci]']);return true;
}

export async function publishGeneratedArtifacts(cwd=root,{
  scope='auto',expectedSourceSha,branch,wasmBuilt=false,
  baseSha='',
  stagePrefix='build-native/p2/publication',evidenceFile='build-native/p2/artifact-evidence.json',
  beforeFinalGuard=()=>{},
}={}) {
  assert.ok(['auto','wasm','all','verify'].includes(scope),'P2_INVALID_SCOPE: '+scope);
  assert.ok(validWorkBranch(branch),'P2_WORK_BRANCH_REQUIRED: '+branch);
  assertBranchState(cwd,{expectedSourceSha,expectedRemoteSha:expectedSourceSha,branch});
  if(!/^[a-f0-9]{40}$/.test(baseSha)||/^0+$/.test(baseSha)) {
    try {baseSha=git(cwd,['rev-parse',expectedSourceSha+'^']);}
    catch {baseSha=expectedSourceSha;}
  }
  assertArtifactsCurrent({wasm:wasmStatus(cwd)});
  const dataFamilies=artifactGraph(cwd).filter(f=>!f.manual).map(f=>f.id);
  const commits=[];
  if(scope==='verify') {
    assert.equal(git(cwd,['status','--porcelain=v1','--untracked-files=all']),'','P2_DIRTY_VERIFICATION_CHECKOUT');
    const current=graphStatus(cwd);
    assertArtifactsCurrent(current.statuses,dataFamilies);
    await verifyArtifactFamilies(cwd,dataFamilies);
  } else {
    const modified=[...new Set([
      ...paths(cwd,['diff','--name-only','HEAD']),
      ...paths(cwd,['ls-files','--others','--exclude-standard']),
    ])];
    assertSafeGeneratedPaths(modified,{wasm:wasmBuilt},cwd);
    if(wasmBuilt&&commitOutputs(cwd,OUTPUTS.wasm,['wasm'],'build(p2): publish verified shared WASM'))
      commits.push({phase:'wasm',sha:git(cwd,['rev-parse','HEAD'])});
    assert.equal(git(cwd,['status','--porcelain=v1','--untracked-files=all']),'','P2_DIRTY_SOURCE_CHECKOUT');
    if(scope!=='wasm') {
      const selection=graphStatus(cwd,{force:scope==='all'});
      assert.deepEqual(selection.blockedFamilies,[],'P2_BLOCKED_GENERATION');
      const families=selection.selectedFamilies;
      if(families.length) {
        if(process.env.GITHUB_ACTIONS==='true'&&existsSync(resolve(cwd,'config/library-data.json'))&&!process.env.PANDOLAB_LIBRARY_WRITE_TOKEN)throw Error('P2_LIBRARY_WRITE_TOKEN_REQUIRED: configure the storage-repository-only Actions secret before generation');
        const sourceSha=git(cwd,['rev-parse','HEAD']),stageDir=stagePrefix+'-web';
        await stageArtifacts(cwd,{families,expectedSourceSha:sourceSha,stageDir});
        const publication=publishArtifacts(cwd,{stageDir,expectedSourceSha:sourceSha,
          expectedRemoteSha:expectedSourceSha,branch});
        if(commitOutputs(cwd,publication.changedPaths,families,'build(p2): publish verified '+families.join(', ')))
          commits.push({phase:'web',sha:git(cwd,['rev-parse','HEAD']),families});
      }
      assertArtifactsCurrent(graphStatus(cwd).statuses,dataFamilies);
    }
  }
  const resultSha=git(cwd,['rev-parse','HEAD']);
  const evidence=artifactEvidence(cwd,{resultSha,expectedSourceSha,evidenceFile,
    families:scope==='wasm'?[]:dataFamilies});
  // This is the only remote write. A normal fast-forward push also protects the
  // small race between ls-remote and push; force/lease pushes are never used.
  await beforeFinalGuard({resultSha,commits});
  assertBranchState(cwd,{expectedSourceSha:resultSha,expectedRemoteSha:expectedSourceSha,branch});
  let pushed=false;
  if(scope!=='verify'&&resultSha!==expectedSourceSha) {
    git(cwd,['push','origin','HEAD:refs/heads/'+branch]);pushed=true;
  }
  return {sourceSha:expectedSourceSha,resultSha,baseSha,branch,scope,pushed,commits,
    verifiedScope:evidence.verifiedScope,evidenceFile};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const result=await publishGeneratedArtifacts(root,{scope:process.env.PANDO_P2_SCOPE||'auto',
    expectedSourceSha:process.env.GITHUB_SHA,branch:process.env.GITHUB_REF_NAME,
    wasmBuilt:process.env.PANDO_P2_WASM==='true',baseSha:process.env.PANDO_P2_BASE_SHA||''});
  if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,'result_sha='+result.resultSha+'\nbase_sha='+result.baseSha+'\npushed='+result.pushed+'\n');
  if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `P2 source: \`${result.sourceSha}\`\n\nVerified result: \`${result.resultSha}\`\n\n`+
    `Scope: ${result.verifiedScope.join(', ')}. Remote push: ${result.pushed}.\n`);
  console.log(JSON.stringify(result,null,2));
}
