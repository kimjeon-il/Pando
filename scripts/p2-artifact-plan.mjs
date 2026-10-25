// P2: trace committed build inputs and generated artifacts before scheduling expensive compilers.
// Only the existing owners (shared-core packaging)
// may write their declared outputs; this planner never repairs a mismatch by changing a contract.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changedPaths } from './p1-plan-remote-checks.mjs';
import { sharedSourceManifest } from '../tools/package-shared-core-assets.mjs';
import { graphStatus, artifactGraph, ownsPath, RECEIPT_PATH, stageArtifacts, publishArtifacts, artifactEvidence } from './lib/p2-artifact-graph.mjs';

export const root=fileURLToPath(new URL('../',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceEncoding=bytes=>Buffer.from(new TextDecoder('utf-8',{fatal:true})
  .decode(bytes).replace(/\r\n/g,'\n'));

export const OUTPUTS=Object.freeze({
  wasm:Object.freeze(['shared/frontend/static/wasm/pandoeditor-core.js','shared/frontend/static/wasm/pandoeditor-core.wasm',
    'shared/frontend/static/wasm/pandoeditor-core.manifest.json'])
});

function absolute(rootDir,p) {
  assert.equal(typeof p,'string','source path required');
  const target=resolve(rootDir,p),rel=relative(resolve(rootDir),target);
  assert.ok(rel && rel !== '..' && !rel.startsWith('..'+sep) && !isAbsolute(rel),
    'P2_UNSAFE_INPUT_PATH: '+p);
  return target;
}
function read(rootDir,p) {return readFileSync(absolute(rootDir,p));}
function json(rootDir,p) {return JSON.parse(read(rootDir,p).toString('utf8'));}
function attempt(f) {try{return f()}catch{return null}}
function matches(rootDir,p,expected,{text=false}={}) {
  if(!/^[a-f0-9]{64}$/i.test(expected||''))return false;
  const bytes=attempt(()=>read(rootDir,p));
  return bytes!==null && sha(text?sourceEncoding(bytes):bytes)===expected;
}

export function wasmStatus(rootDir=root,pin=null) {
  const config=pin||json(rootDir,'config/toolchain-versions.json');
  const manifest=attempt(()=>json(rootDir,'shared/frontend/static/wasm/pandoeditor-core.manifest.json'));
  const currentSource=sharedSourceManifest(rootDir);
  const reasons=[];
  if(manifest?.schema!=='pandoeditor-core-wasm'||manifest.abiVersion!==1)
    reasons.push('manifest/ABI');
  if(manifest?.sourceSha256!==currentSource.sourceSha256)
    reasons.push('source fingerprint');
  if(manifest?.compiler?.name!=='emscripten'||manifest?.compiler?.version!==config.emscripten)
    reasons.push('compiler pin');
  if(!Array.isArray(manifest?.inputs)||JSON.stringify(manifest.inputs)!==JSON.stringify(currentSource.inputs))
    reasons.push('source dependency manifest');
  for(const name of ['js','wasm']) {
    const entry=manifest?.assets?.[name];
    const filename=name==='js'?'pandoeditor-core.js':'pandoeditor-core.wasm';
    if(entry?.file!==filename||!matches(rootDir,'shared/frontend/static/wasm/'+filename,entry?.sha256))
      reasons.push(name+' bytes/hash');
  }
  return {needed:reasons.length>0,reasons,sourceSha256:currentSource.sourceSha256};
}

export function selectJobs({wasm},changed=[],manual='auto') {
  if(!['auto','all','wasm','verify'].includes(manual))
    throw Error('P2_INVALID_SCOPE: '+manual);
  // Controller changes are covered by orchestration tests. They do not alter
  // compiled input identity and must not force an otherwise unchanged compiler.
  const bootstrap=changed.some(p=>[
    '.github/workflows/generated-artifacts-p2.yml',
    'scripts/p2-artifact-plan.mjs','tests/unit/p2-artifact-plan.test.mjs',
    'cmake/P2NativeBuildReceipt.cmake'].includes(p));
  const forced=manual==='all';
  const wasmDefinitionChanged=changed.some(p=>[
    'tools/package-shared-core-assets.mjs','CMakeLists.txt','CMakePresets.json'].includes(p));
  return {
    wasm:forced||manual==='wasm'||(manual==='auto'&&(wasm.needed||wasmDefinitionChanged)),
    bootstrap,
    verifyOnly:manual==='verify'
  };
}

// Fail closed on unexpected generator output, even when no Python, C++ or JS
// application files were edited by the workflow.
export function assertSafeGeneratedPaths(changed, enabled, rootDir=null) {
  const families=rootDir?artifactGraph(rootDir).filter(f=>enabled[f.id]):[];
  for(const path of changed) {
    const allowed=Object.entries(OUTPUTS).some(([kind,patterns])=>
      enabled[kind]&&patterns.some(p=>p.endsWith('/')?path.startsWith(p):path===p));
    if(!allowed&&!families.some(f=>ownsPath(f,path))&&!(path===RECEIPT_PATH&&families.length))throw Error('P2_UNEXPECTED_GENERATED_FILE: '+path);
  }
  return true;
}

export function assertArtifactsCurrent(statuses,selected=Object.keys(statuses)) {
  for(const kind of selected) {
    assert.ok(Object.hasOwn(statuses,kind),'P2_INVALID_SCOPE: '+kind);
    if(statuses[kind].needed)throw Error('P2_GENERATED_ARTIFACT_STALE: '+kind+' '+JSON.stringify(statuses[kind].reasons));
  }
}

export function plan(rootDir=root,{changes=[],manual='auto',families=[]}={}) {
  const statuses={
    wasm:wasmStatus(rootDir)
  };
  const jobs=selectJobs(statuses,changes,manual);
  const graph=graphStatus(rootDir,{wasm:statuses.wasm,requested:families,force:manual==='all'});
  return {statuses:{...statuses,...graph.statuses},...jobs,
    selectedFamilies:manual==='wasm'||manual==='verify'?[]:graph.selectedFamilies,
    blockedFamilies:manual==='wasm'?[]:graph.blockedFamilies};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);
  const value=name=>{const index=args.indexOf(name);if(index<0)return undefined;assert.ok(args[index+1]&&!args[index+1].startsWith('--'),'Missing '+name);return args[index+1];};
  const families=(value('--families')||process.env.PANDO_P2_FAMILIES||'').split(',').filter(Boolean);
  const options={families,expectedSourceSha:value('--expected-source-sha'),stageDir:value('--stage-dir'),
    expectedRemoteSha:value('--expected-remote-sha'),branch:value('--branch')};
  if(args.includes('--stage'))console.log(JSON.stringify(await stageArtifacts(root,options),null,2));
  else if(args.includes('--publish')) {
    assert.ok(options.expectedRemoteSha&&options.branch,'Publish requires remote SHA and branch');
    console.log(JSON.stringify(publishArtifacts(root,options),null,2));
  } else if(args.includes('--evidence'))console.log(JSON.stringify(artifactEvidence(root,{
    resultSha:value('--result-sha'),expectedSourceSha:options.expectedSourceSha,evidenceFile:value('--evidence-file')}),null,2));
  else {
    const manual=process.env.PANDO_P2_SCOPE||'auto';
    const changes=manual==='verify'?[]:changedPaths({base:process.env.PANDO_P2_BASE_SHA||''}).paths;
    const result=plan(root,{changes,manual,families});
    if(args.includes('--check')) {
      const scope=process.env.PANDO_P2_SCOPE||'all';
      const selected=families.length?families:scope==='wasm'?['wasm']:['wasm',...artifactGraph(root).filter(f=>!f.manual).map(f=>f.id)];
      assertArtifactsCurrent(result.statuses,selected);
    }
    if(args.includes('--validate-staged')) {
      const staged=execFileSync('git',['diff','--cached','--name-only','-z'],{cwd:root})
        .toString('utf8').split('\0').filter(Boolean);
      assertSafeGeneratedPaths(staged,{wasm:process.env.PANDO_P2_WASM==='true',...Object.fromEntries(families.map(id=>[id,true]))},root);
      console.log('P2 validated generated output scope: '+JSON.stringify(staged));
    }
    if(args.includes('--github-output')) {
      assert.ok(process.env.GITHUB_OUTPUT,'GITHUB_OUTPUT required');
      const pins=json(root,'config/toolchain-versions.json');
      appendFileSync(process.env.GITHUB_OUTPUT,[
        'wasm='+String(result.wasm),
        'selected_families='+JSON.stringify(result.selectedFamilies),
        'blocked_families='+JSON.stringify(result.blockedFamilies),
        'pnpm_version='+pins.pnpm,
        'cmake_version='+pins.cmake,
        'emscripten_version='+pins.emscripten,
        'emsdk_ref='+pins.emsdkCommit
      ].join('\n')+'\n');
    }
    console.log(JSON.stringify({scope:process.env.PANDO_P2_SCOPE||'auto',
      status:result.statuses,selected:{wasm:result.wasm,families:result.selectedFamilies,
        bootstrap:result.bootstrap},blocked:result.blockedFamilies,
      changedPaths:difference.paths,diffFallback:difference.fallback},null,2));
  }
}
