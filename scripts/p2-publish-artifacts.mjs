// P2's existing publication transaction: compile/ABI checks run in the workflow,
// then locally commit WASM -> Web -> native outputs before one guarded push.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, OUTPUTS, wasmStatus, assertArtifactsCurrent, assertSafeGeneratedPaths } from './p2-artifact-plan.mjs';
import { artifactGraph, graphStatus, stageArtifacts, publishArtifacts, assertBranchState,
  artifactEvidence, verifyArtifactFamilies } from './lib/p2-artifact-graph.mjs';

const git=(cwd,args)=>execFileSync('git',args,{cwd,maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe']}).toString('utf8').trim();
const paths=(cwd,args)=>git(cwd,[...args,'-z']).split('\0').filter(Boolean);
const validWorkBranch = branch => /^work\/[a-z0-9][a-z0-9-]{0,63}$/.test(branch);

function commitOutputs(cwd,changed,families,message) {
  if(!changed.length)return false;
  assertSafeGeneratedPaths(changed,Object.fromEntries(families.map(id=>[id,true])),cwd);
  git(cwd,['add','-A','--',...changed]);
  git(cwd,['diff','--cached','--check']);
  const staged=paths(cwd,['diff','--cached','--name-only']);
  assertSafeGeneratedPaths(staged,Object.fromEntries(families.map(id=>[id,true])),cwd);
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
      // Native provenance names the actual committed Web bytes. At most one Web
      // phase and one native phase are necessary; never retry generators forever.
      for(let phase=0;phase<2;++phase) {
        const selection=graphStatus(cwd,{force:scope==='all'&&phase===0});
        assert.deepEqual(selection.blockedFamilies,[],'P2_BLOCKED_GENERATION');
        const families=selection.selectedFamilies;
        if(!families.length) {
          assert.deepEqual(selection.deferredFamilies,[],'P2_UNRESOLVED_DEFERRED_FAMILIES');break;
        }
        const sourceSha=git(cwd,['rev-parse','HEAD']),stageDir=stagePrefix+'-'+phase;
        await stageArtifacts(cwd,{families,expectedSourceSha:sourceSha,stageDir});
        const publication=publishArtifacts(cwd,{stageDir,expectedSourceSha:sourceSha,
          expectedRemoteSha:expectedSourceSha,branch});
        if(commitOutputs(cwd,publication.changedPaths,families,'build(p2): publish verified '+families.join(', ')))
          commits.push({phase:families.some(id=>selection.graph.find(f=>f.id===id).afterWebCommit)?'native':'web',
            sha:git(cwd,['rev-parse','HEAD']),families});
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
