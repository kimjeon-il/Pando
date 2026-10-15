// P2: trace committed build inputs and generated artifacts before scheduling expensive compilers.
// Only the existing owners (shared-core packaging and remaining Qt JS adapters)
// may write their declared outputs; this planner never repairs a mismatch by changing a contract.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changedPaths } from './p1-plan-remote-checks.mjs';
import { sharedSourceManifest } from '../tools/package-shared-core-assets.mjs';

export const root=fileURLToPath(new URL('../',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceEncoding=bytes=>Buffer.from(new TextDecoder('utf-8',{fatal:true})
  .decode(bytes).replace(/\r\n/g,'\n'));

export const OUTPUTS=Object.freeze({
  wasm:Object.freeze(['assets/wasm/pandoeditor-core.js','assets/wasm/pandoeditor-core.wasm',
    'assets/wasm/pandoeditor-core.manifest.json']),
  geometry:Object.freeze(['native/assets/geometry/current/','native/resources/current_geometry.qrc'])
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
  const manifest=attempt(()=>json(rootDir,'assets/wasm/pandoeditor-core.manifest.json'));
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
    if(entry?.file!==filename||!matches(rootDir,'assets/wasm/'+filename,entry?.sha256))
      reasons.push(name+' bytes/hash');
  }
  return {needed:reasons.length>0,reasons,sourceSha256:currentSource.sourceSha256};
}

export function generatedStatus(rootDir,kind,manifestPath) {
  const manifest=attempt(()=>json(rootDir,manifestPath));
  const reasons=[];
  if(kind==='geometry'&&(manifest?.schemaVersion!==2 || manifest?.sourceEncoding!=='UTF-8 LF'))
    reasons.push('invalid geometry manifest');
  if(!Array.isArray(manifest?.files)||manifest.files.length===0)
    reasons.push('missing input dependency list');
  for(const entry of manifest?.files||[]) {
    if(!matches(rootDir,entry.path,entry.sha256,{text:true}))
      reasons.push('source: '+entry.path);
  }
  if(kind==='geometry') {
    if(!Array.isArray(manifest?.artifacts)||manifest.artifacts.length===0)
      reasons.push('missing geometry artifact dependency list');
    for(const entry of manifest?.artifacts||[]) {
      if(!matches(rootDir,entry.path,entry.sha256,{text:true}))
        reasons.push('artifact: '+entry.path);
    }
    // QRC and header are generated in lockstep with the manifest; checking their
    // content deterministically remains the generator's --check responsibility.
    if(!attempt(()=>read(rootDir,'native/resources/current_geometry.qrc')))
      reasons.push('Qt resources missing');
  }
  return {needed:reasons.length>0,reasons,inputs:manifest?.files?.length||0};
}

export function selectJobs({wasm,geometry},changed=[],manual='auto') {
  if(!['auto','all','wasm','geometry','verify'].includes(manual))
    throw Error('P2_INVALID_SCOPE: '+manual);
  // On the first installation or a change to this controller, force compilation
  // and generator checks once to prove the pipeline is executable. The committed
  // outputs are changed only if their *bytes* differ.
  const bootstrap=changed.some(p=>[
    '.github/workflows/generated-artifacts-p2.yml',
    'scripts/p2-artifact-plan.mjs','tests/unit/p2-artifact-plan.test.mjs',
    'cmake/P2NativeBuildReceipt.cmake'].includes(p));
  const forced=bootstrap||manual==='all';
  const wasmDefinitionChanged=changed.some(p=>[
    'tools/package-shared-core-assets.mjs','CMakeLists.txt','CMakePresets.json'].includes(p));
  const geometryDefinitionChanged=changed.some(p=>
    p==='native/resources/current_geometry.qrc'||
    p==='native/tools/m97/cut-kernel-generate.mjs'||
    p.startsWith('native/assets/geometry/current/'));
  return {
    wasm:forced||manual==='wasm'||(manual==='auto'&&(wasm.needed||wasmDefinitionChanged)),
    geometry:forced||manual==='geometry'||(manual==='auto'&&(geometry.needed||geometryDefinitionChanged)),
    bootstrap,
    verifyOnly:manual==='verify'
  };
}

// Fail closed on unexpected generator output, even when no Python, C++ or JS
// application files were edited by the workflow.
export function assertSafeGeneratedPaths(changed, enabled) {
  for(const path of changed) {
    const allowed=Object.entries(OUTPUTS).some(([kind,patterns])=>
      enabled[kind]&&patterns.some(p=>p.endsWith('/')?path.startsWith(p):path===p));
    if(!allowed)throw Error('P2_UNEXPECTED_GENERATED_FILE: '+path);
  }
  return true;
}

export function plan(rootDir=root,{changes=[],manual='auto'}={}) {
  const statuses={
    wasm:wasmStatus(rootDir),
    geometry:generatedStatus(rootDir,'geometry','native/assets/geometry/current/manifest.json')
  };
  return {statuses,...selectJobs(statuses,changes,manual)};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const difference=changedPaths({base:process.env.PANDO_P2_BASE_SHA||''});
  const result=plan(root,{changes:difference.paths,manual:process.env.PANDO_P2_SCOPE||'auto'});
  if(process.argv.includes('--check')&&(result.statuses.wasm.needed||
     result.statuses.geometry.needed))
    throw Error('P2_GENERATED_ARTIFACT_STALE: '+JSON.stringify(result.statuses));
  if(process.argv.includes('--validate-staged')) {
    const staged=execFileSync('git',['diff','--cached','--name-only','-z'],{cwd:root})
      .toString('utf8').split('\0').filter(Boolean);
    assertSafeGeneratedPaths(staged, {
      wasm:process.env.PANDO_P2_WASM==='true',
      geometry:process.env.PANDO_P2_GEOMETRY==='true'
    });
    console.log('P2 validated generated output scope: '+JSON.stringify(staged));
  }
  if(process.argv.includes('--github-output')) {
    assert.ok(process.env.GITHUB_OUTPUT,'GITHUB_OUTPUT required');
    const pins=json(root,'config/toolchain-versions.json');
    appendFileSync(process.env.GITHUB_OUTPUT,[
      ...['wasm','geometry'].map(k=>k+'='+String(result[k])),
      'cmake_version='+pins.cmake,
      'emscripten_version='+pins.emscripten,
      'emsdk_ref='+pins.emsdkCommit
    ].join('\n')+'\n');
  }
  console.log(JSON.stringify({scope:process.env.PANDO_P2_SCOPE||'auto',
    status:result.statuses,selected:{wasm:result.wasm,geometry:result.geometry,
      bootstrap:result.bootstrap},
    changedPaths:difference.paths,diffFallback:difference.fallback},null,2));
}
