// The P2 planner's data-family graph and transactional staging. Generators retain
// ownership of formats; this module records dependencies and publishes bytes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync,
  renameSync, unlinkSync, writeFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import { libraryConfig, libraryCheckout, decodeArchiveEntry, libraryReportRoot, libraryMaterializedRoot, prepareLibraryData, withLibraryOutputs } from '../../tools/library-data.mjs';
import {reportPath} from '../../tools/report-paths.mjs';

export const GRAPH_PATH='config/generated-artifacts.json';
export const RECEIPT_PATH='assets/data/generated-artifacts/p2-manifest.json';
const WASM_OUTPUTS=['shared/frontend/static/wasm/pandoeditor-core.js','shared/frontend/static/wasm/pandoeditor-core.wasm','shared/frontend/static/wasm/pandoeditor-core.manifest.json'];
const sha=b=>createHash('sha256').update(b).digest('hex');
const canonical=value=>JSON.stringify(value);
const normalize=p=>p.replaceAll('\\','/');
const git=(root,args)=>execFileSync('git',args,{cwd:root,maxBuffer:32*1024*1024}).toString('utf8').trim();
const json=(root,p)=>JSON.parse(readFileSync(safePath(root,p),'utf8'));
const optionalJson=(root,p)=>existsSync(safePath(root,p))?json(root,p):null;
function writeJson(root,p,value) {const path=safePath(root,p);mkdirSync(dirname(path),{recursive:true});withLibraryOutputs({root,paths:[path]},()=>writeFileSync(path,JSON.stringify(value,null,2)+'\n'));}

export function safePath(root,p) {
  assert.ok(typeof p==='string'&&p&&!isAbsolute(p)&&!p.includes('\\')&&!p.includes('\0'),'P2_UNSAFE_PATH: '+p);
  const target=resolve(root,p), rel=relative(resolve(root),target);
  assert.ok(rel&&rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel),'P2_UNSAFE_PATH: '+p);
  let cursor=target;
  while(cursor!==resolve(root)) {
    if(existsSync(cursor)&&lstatSync(cursor).isSymbolicLink()) {
      const configured=existsSync(resolve(root,'config/library-data.json'))?libraryConfig(root):null;
      assert.ok(configured,'P2_SYMLINK_PATH: '+p);
      const mount=normalize(relative(root,cursor));
      const expected=mount==='reports'?libraryReportRoot(root):resolve(libraryMaterializedRoot(root),mount);
      assert.ok(configured?.mounts.includes(mount)&&realpathSync(cursor)===realpathSync(expected),'P2_SYMLINK_PATH: '+p);
    }
    cursor=dirname(cursor);
  }
  return target;
}
function inputPath(root,p) {
  return p.startsWith('reports/')&&existsSync(resolve(root,'config/library-data.json'))
    ?reportPath(p.replace(/\/$/,''),{root,access:'read'}):safePath(root,p);
}
function files(root,p,path=safePath(root,p)) {
  if(!existsSync(path))return [];
  if(!statSync(path).isDirectory())return [p];
  return readdirSync(path).filter(name=>p!=='reports'||!name.startsWith('.')).sort().flatMap(name=>files(root,p.replace(/\/$/,'')+'/'+name,resolve(path,name)));
}
function expand(root,selectors,{source=false}={}) {
  const selectedFiles=p=>files(root,p,source?inputPath(root,p):safePath(root,p));
  return [...new Set(selectors.flatMap(value=>{
    if(typeof value==='string')return value.endsWith('/')?selectedFiles(value):[value];
    return selectedFiles(value.prefix).filter(p=>new RegExp(value.pattern).test(p));
  }))].sort();
}
function hashes(root,paths,{source=false}={}) {
  return Object.fromEntries(paths.map(p=>{
    const path=source?inputPath(root,p):safePath(root,p);
    if(!existsSync(path))return [p,null];
    let bytes=readFileSync(path);
    if(source&&/\.(?:[cm]?js|json|geojson|txt|py|ya?ml|cmake)$/.test(p))bytes=Buffer.from(bytes.toString('utf8').replaceAll('\r\n','\n'));
    return [p,sha(bytes)];
  }));
}
// Follow literal module imports of each existing owner; non-module inputs are
// explicit descriptors. This does not import or execute generators while planning.
function moduleClosure(root,entrypoints) {
  const seen=new Set();
  const visit=p=>{
    if(seen.has(p))return;
    seen.add(p);
    if(!/\.[cm]?js$/.test(p)||!existsSync(safePath(root,p)))return;
    const text=readFileSync(safePath(root,p),'utf8');
    const pattern=/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;
    for(const match of text.matchAll(pattern)) {
      if(match[1].startsWith('node:'))continue;
      if(!match[1].startsWith('.')) {
        // Installed dependencies are inherited from the enclosing checkout's
        // node_modules; pin their resolution without copying that directory.
        for(const lock of ['package.json','pnpm-lock.yaml','pnpm-workspace.yaml'])seen.add(lock);
        continue;
      }
      const child=normalize(relative(root,resolve(dirname(safePath(root,p)),match[1])));
      safePath(root,child);visit(child);
    }
  };
  entrypoints.forEach(visit);return [...seen].sort();
}
function provenance(value,items=[]) {
  if(!value||typeof value!=='object')return items;
  if(value.sha256&&(value.file||value.url||value.path))items.push({
    source:value.url||value.path||value.file,sha256:value.sha256,
    ...(value.version?{version:value.version}:{})});
  for(const child of Object.values(value))if(typeof child==='object')provenance(child,items);
  return items;
}

export function artifactGraph(root) {
  const graph=json(root,GRAPH_PATH);
  assert.equal(graph.schema,'pandolab-generated-artifact-graph');assert.equal(graph.schemaVersion,1);
  const families=graph.families.map(input=>{
    const f=structuredClone(input);
    f.inputs??=[];f.outputs??=[];f.dependencies??=[];f.generate??=[];f.validate??=[];
    if(f.resolve?.startsWith('world-')||f.resolve==='shared-boundaries') {
      const seed=json(root,'assets/data/world/build-input.json');
      const manifest='assets/data/'+seed.legacyPreviewManifest;
      const legacy=json(root,manifest);
      if(f.resolve==='world-mesh') {
        f.outputs.push('assets/data/'+legacy.assets.canonicalMesh.url);
        // The manifest is also written by preview generation. Only its path
        // selection affects this owner, avoiding an output->input cycle.
        f.layout={canonicalMesh:legacy.assets.canonicalMesh.url};
      } else if(f.resolve==='world-preview') {
        f.outputs.push(manifest,...['canonicalCountryPacket','previewCountries','previewMesh'].map(k=>'assets/data/'+legacy.assets[k].url));
        f.inputs.push('assets/data/'+legacy.assets.labelAnchors.url);
        f.layout={manifest,assets:Object.fromEntries(Object.entries(legacy.assets).map(([k,v])=>[k,v.url]))};
      } else if(f.resolve==='world-bundle') {
        const current=json(root,'assets/data/world/current.json');
        f.outputs.push(...Object.values(current.assets).map(asset=>'assets/data/'+asset.url));
      } else f.outputs.push(...Object.values(seed.sharedBoundaries).map(p=>'assets/data/'+p));
    }
    if(f.resolve==='hydro'||f.resolve==='terrain') {
      const manifest=f.resolve==='hydro'?'assets/data/hydro/v0.13.2/manifest.json':'assets/data/terrain-preview/v0.13.3-p2/manifest.json';
      f.outputs.push(dirname(manifest).replaceAll('\\','/')+'/');
      f.provenance=provenance(json(root,manifest).sources);
    }

    f.outputs=[...new Set(f.outputs)].sort();
    f.sources=moduleClosure(root,[...f.generate,...f.validate].filter(c=>c[0]==='node').map(c=>c[1]));
    return f;
  });
  const byId=new Map(families.map(f=>[f.id,f]));
  assert.equal(byId.size,families.length,'P2_DUPLICATE_FAMILY');
  const ordered=[], visiting=new Set(),done=new Set();
  function visit(id) {
    if(id==='wasm'||done.has(id))return;
    assert.ok(byId.has(id),'P2_UNKNOWN_DEPENDENCY: '+id);
    assert.ok(!visiting.has(id),'P2_CYCLIC_DEPENDENCY: '+id);
    visiting.add(id);byId.get(id).dependencies.forEach(visit);visiting.delete(id);
    done.add(id);ordered.push(byId.get(id));
  }
  families.forEach(f=>visit(f.id));return ordered;
}

export function graphStatus(root,{wasm=null,requested=[],force=false}={}) {
  const graph=artifactGraph(root), receipt=optionalJson(root,RECEIPT_PATH), pins=json(root,'config/toolchain-versions.json');
  const statuses={},byId=new Map(graph.map(f=>[f.id,f]));
  requested.forEach(id=>assert.ok(byId.has(id),'P2_INVALID_FAMILY: '+id));
  for(const f of graph) {
    const inputs=hashes(root,expand(root,f.inputs,{source:true}),{source:true});
    const generatorHashes=hashes(root,f.sources,{source:true});
    const tools=Object.fromEntries((f.tools||[]).map(k=>[k,pins[k]??null]));
    const dependencies=Object.fromEntries(f.dependencies.map(id=>[id,id==='wasm'
      ?sha(canonical(hashes(root,WASM_OUTPUTS))):statuses[id].outputFingerprint]));
    const outputs=hashes(root,expand(root,f.outputs));
    const definition={...f};delete definition.sources;
    const inputFingerprint=sha(canonical({definition,inputs,generatorHashes,tools,dependencies}));
    const outputFingerprint=sha(canonical(outputs));
    const old=receipt?.families?.[f.id],reasons=[];
    if(!old)reasons.push('unrecorded generation');
    else {
      if(old.inputFingerprint!==inputFingerprint)reasons.push('inputs/generator/tool/dependency fingerprint');
      if(old.outputFingerprint!==outputFingerprint)reasons.push('output bytes/hash');
    }
    const missing=Object.entries({...inputs,...generatorHashes,...outputs}).filter(([,v])=>v===null).map(([p])=>p);
    if(!Object.keys(outputs).length)missing.push('declared outputs');
    if(missing.length)reasons.push('missing: '+missing.join(', '));
    const dependencyChanged=f.dependencies.filter(id=>id==='wasm'?wasm?.needed:statuses[id].selected);
    if(dependencyChanged.length)reasons.push('upstream: '+dependencyChanged.join(', '));
    const wanted=force||requested.includes(f.id)||dependencyChanged.length>0||(!requested.length&&reasons.length>0);
    const blocked=[...Object.entries({...inputs,...generatorHashes}).filter(([,v])=>v===null).map(([p])=>'missing input: '+p)];
    for(const source of f.externalSources||[]) {
      if(!source.path||!/^[a-f0-9]{64}$/.test(source.sha256||'')||!source.version||!source.source)blocked.push('unpinned external source: '+(source.path||source.source));
      else if(hashes(root,[source.path])[source.path]!==source.sha256)blocked.push('missing or mismatched external source: '+source.path);
    }
    if(f.blockedReason)blocked.push(f.blockedReason);
    const manualAllowed=!f.manual||requested.includes(f.id);
    statuses[f.id]={needed:reasons.length>0,selected:!!(wanted&&manualAllowed&&!blocked.length),
      blocked:wanted&&manualAllowed?blocked:[],reasons,inputFingerprint,outputFingerprint,
      inputs,generatorHashes,tools,dependencies,outputs,consumers:f.consumers||[],provenance:f.provenance||[],validation:f.validate};
  }
  return {graph,statuses,selectedFamilies:graph.filter(f=>statuses[f.id].selected).map(f=>f.id),
    blockedFamilies:graph.filter(f=>statuses[f.id].blocked.length).map(f=>({id:f.id,reasons:statuses[f.id].blocked}))};
}

// Call after the selected owners' validators pass; unrelated receipts stay intact.
export function recordArtifactReceipts(root,{families,sourceSha,sourceDirty=false}) {
  assert.match(sourceSha||'',/^[a-f0-9]{40}$/,'P2_SOURCE_SHA_REQUIRED');
  assert.ok(Array.isArray(families)&&families.length,'P2_FAMILIES_REQUIRED');
  const status=graphStatus(root,{requested:families});
  const receipt=optionalJson(root,RECEIPT_PATH)||{schema:'pandolab-generated-artifact-receipt',schemaVersion:1,families:{}};
  for(const id of families) {
    const current=status.statuses[id],old=receipt.families[id];
    assert.ok(Object.keys(current.outputs).length&&Object.values(current.outputs).every(value=>value!==null),'P2_MISSING_RECEIPT_OUTPUT: '+id);
    if(old?.inputFingerprint===current.inputFingerprint&&old?.outputFingerprint===current.outputFingerprint)continue;
    receipt.families[id]={...current,selected:undefined,blocked:undefined,reasons:undefined,needed:undefined,
      sourceSha,...(sourceDirty?{sourceDirty:true}:{})};
  }
  writeJson(root,RECEIPT_PATH,receipt);
}

export function ownsPath(f,path) {return f.outputs.some(p=>p.endsWith('/')?path.startsWith(p):p===path);}
export function assertBranchState(root,{expectedSourceSha,expectedRemoteSha,branch,remote='origin'}) {
  assert.match(expectedSourceSha||'',/^[a-f0-9]{40}$/,'P2_SOURCE_SHA_REQUIRED');
  assert.equal(git(root,['rev-parse','HEAD']),expectedSourceSha,'P2_LOCAL_SOURCE_CHANGED');
  if(expectedRemoteSha) {
    assert.match(expectedRemoteSha,/^[a-f0-9]{40}$/);
    assert.ok(branch&&!branch.startsWith('-')&&!branch.includes('..'),'P2_BRANCH_REQUIRED');
    const actual=git(root,['ls-remote',remote,'refs/heads/'+branch]).split(/\s/)[0];
    assert.equal(actual,expectedRemoteSha,'P2_REMOTE_BRANCH_CHANGED');
  }
}

export async function stageArtifacts(root,{families,expectedSourceSha,stageDir,run=runCommand,prepareData=prepareLibraryData}) {
  assertBranchState(root,{expectedSourceSha});
  assert.ok(Array.isArray(families)&&families.length,'P2_FAMILIES_REQUIRED');
  const initial=graphStatus(root,{requested:families}),byId=new Map(initial.graph.map(f=>[f.id,f]));
  for(const id of families) {
    assert.ok(!initial.statuses[id].blocked.length,'P2_BLOCKED: '+id+' '+initial.statuses[id].blocked.join('; '));
    for(const dep of byId.get(id).dependencies)if(dep!=='wasm'&&!byId.get(dep).manual&&initial.statuses[dep].needed)
      assert.ok(families.includes(dep),'P2_STALE_DEPENDENCY: '+id+' -> '+dep);
  }
  const changed=git(root,['status','--porcelain=v1','-z','--untracked-files=all']);
  // Copy only a clean tracked snapshot; preserving dirty user work means refusing
  // this operation instead of silently reading older committed input bytes.
  assert.ok(!changed,'P2_DIRTY_SOURCE_CHECKOUT');
  const stage=safePath(root,stageDir);
  assert.ok(normalize(relative(root,stage)).startsWith('build-native/p2/'),'P2_STAGE_LOCATION');
  assert.ok(!existsSync(stage),'P2_STAGE_EXISTS: choose an unused stage directory');
  const tracked=git(root,['ls-files','-z']).split('\0').filter(Boolean)
    .filter(p=>! /^(?:build-native|node_modules|\.git)\//.test(p));
  const checkout=resolve(stage,'checkout');mkdirSync(checkout,{recursive:true});
  for(const p of tracked) {
    const source=safePath(root,p),target=safePath(checkout,p);
    assert.ok(lstatSync(source).isFile(),'P2_NON_FILE_TRACKED_INPUT: '+p);
    mkdirSync(dirname(target),{recursive:true});copyFileSync(source,target);
  }
  if(existsSync(resolve(checkout,'config/library-data.json')))prepareData({root:checkout});
  const before=hashes(checkout,filesInCheckout(checkout)),selected=initial.graph.filter(f=>families.includes(f.id));
  for(const family of selected) {
    for(const command of family.generate)await run(command,checkout,{PANDO_P2_SOURCE_SHA:expectedSourceSha});
    for(const command of family.validate)await run(command,checkout,{PANDO_P2_SOURCE_SHA:expectedSourceSha});
  }
  const afterGraph=artifactGraph(checkout),owned=afterGraph.filter(f=>families.includes(f.id));
  const after=hashes(checkout,filesInCheckout(checkout));
  const changedPaths=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(p=>before[p]!==after[p]);
  for(const p of changedPaths)assert.ok(owned.some(f=>ownsPath(f,p)),'P2_UNEXPECTED_GENERATED_FILE: '+p);
  recordArtifactReceipts(checkout,{families,sourceSha:expectedSourceSha});
  if(sha(readFileSync(safePath(checkout,RECEIPT_PATH)))!==before[RECEIPT_PATH])changedPaths.push(RECEIPT_PATH);
  const publication={schema:'pandolab-p2-stage',schemaVersion:1,sourceSha:expectedSourceSha,families,
    paths:[...new Set(changedPaths)].sort(),before:hashes(root,[...new Set(changedPaths)]),after:hashes(checkout,[...new Set(changedPaths)])};
  writeJson(stage,'stage.json',publication);return publication;
}
function filesInCheckout(root) {return readdirSync(root).filter(name=>name!=='.library-data').sort().flatMap(name=>files(root,name));}
function runCommand(command,cwd,env) {
  assert.ok(command.length>=2,'P2_INVALID_COMMAND');
  const executable=command[0]==='node'?process.execPath:command[0];
  execFileSync(executable,command.slice(1),{cwd,env:{...process.env,...env},stdio:'inherit'});
}

export async function verifyArtifactFamilies(root,families,{run=runCommand}={}) {
  const status=graphStatus(root);
  const receipt=optionalJson(root,RECEIPT_PATH);
  for(const id of families) {
    const family=status.graph.find(f=>f.id===id);
    assert.ok(family,'P2_INVALID_FAMILY: '+id);
    assert.ok(!status.statuses[id].needed,'P2_GENERATED_ARTIFACT_STALE: '+id);
    for(const command of family.validate)await run(command,root,{PANDO_P2_SOURCE_SHA:receipt.families[id].sourceSha});
  }
  return families;
}

export function publishArtifacts(root,{stageDir,expectedSourceSha,expectedRemoteSha,branch,guard=assertBranchState,beforeWrite=()=>{}}) {
  const stage=safePath(root,stageDir),publication=json(stage,'stage.json'),checkout=resolve(stage,'checkout');
  assert.equal(publication.schema,'pandolab-p2-stage');assert.equal(publication.sourceSha,expectedSourceSha,'P2_STAGE_SOURCE_CHANGED');
  assert.ok(!existsSync(safePath(stage,'publish-journal.json')),'P2_UNFINISHED_PUBLICATION');
  const graph=artifactGraph(root).filter(f=>publication.families.includes(f.id));
  for(const p of publication.paths)assert.ok(p===RECEIPT_PATH||graph.some(f=>ownsPath(f,p)),'P2_UNEXPECTED_GENERATED_FILE: '+p);
  assert.deepEqual(hashes(checkout,publication.paths),publication.after,'P2_STAGE_BYTES_CHANGED');
  assert.deepEqual(hashes(root,publication.paths),publication.before,'P2_DESTINATION_CHANGED');
  guard(root,{expectedSourceSha,expectedRemoteSha,branch});
  // Entry manifests and the graph receipt become visible after their data.
  const paths=[...publication.paths].sort((a,b)=>Number(/(?:manifest|current|index)\.json$/.test(a)||a===RECEIPT_PATH)-Number(/(?:manifest|current|index)\.json$/.test(b)||b===RECEIPT_PATH));
  return withLibraryOutputs({root,paths:paths.map(path=>safePath(root,path))},()=>{
  const written=[];
  for(const p of paths)if(publication.before[p]!==null) {
    const backup=safePath(stage,'backup/'+p);mkdirSync(dirname(backup),{recursive:true});copyFileSync(safePath(root,p),backup);
  }
  writeJson(stage,'publish-journal.json',{paths,sourceSha:expectedSourceSha});
  try {
    for(const p of paths) {
      beforeWrite(p,written.length);
      const target=safePath(root,p);mkdirSync(dirname(target),{recursive:true});
      if(publication.after[p]===null)unlinkSync(target);
      else {const temp=target+'.p2-publish';assert.ok(!existsSync(temp),'P2_TEMP_EXISTS');copyFileSync(safePath(checkout,p),temp);renameSync(temp,target);}
      written.push(p);
    }
    guard(root,{expectedSourceSha,expectedRemoteSha,branch});
    assert.deepEqual(hashes(root,paths),publication.after,'P2_PUBLISHED_BYTES_CHANGED');
    unlinkSync(safePath(stage,'publish-journal.json'));
    writeJson(stage,'published.json',{...publication,published:true});
    return {changedPaths:paths,sourceSha:expectedSourceSha};
  } catch(error) {
    for(const p of written.reverse()) {
      const target=safePath(root,p);
      if(publication.before[p]===null)unlinkSync(target);
      else copyFileSync(safePath(stage,'backup/'+p),target);
    }
    unlinkSync(safePath(stage,'publish-journal.json'));throw error;
  }
  });
}

export function artifactEvidence(root,{resultSha,expectedSourceSha,evidenceFile,families=null}) {
  assert.match(resultSha||'',/^[a-f0-9]{40}$/);assert.match(expectedSourceSha||'',/^[a-f0-9]{40}$/);
  execFileSync('git',['merge-base','--is-ancestor',expectedSourceSha,resultSha],{cwd:root});
  const appCommitted=p=>execFileSync('git',['show',resultSha+':'+p],{cwd:root,maxBuffer:256*1024*1024});
  const config=git(root,['ls-tree','--name-only',resultSha,'--','config/library-data.json'])?JSON.parse(appCommitted('config/library-data.json')):null;
  const checkout=config?libraryCheckout(root):null;
  const archive=config?JSON.parse(execFileSync('git',['show',config.revision+':archive/index.json'],{cwd:checkout,maxBuffer:32*1024*1024})):null;
  const mounted=p=>config?.mounts.some(mount=>mount!=='reports'&&(p===mount||p.startsWith(mount+'/')));
  const committed=p=>{
    if(!mounted(p))return appCommitted(p);
    assert.ok(archive.files[p],'P2_RESULT_LIBRARY_PATH_MISSING: '+p);
    return decodeArchiveEntry(checkout,archive.files[p],config.revision);
  };
  const listed=mounted(RECEIPT_PATH)?archive.files[RECEIPT_PATH]:git(root,['ls-tree','--name-only',resultSha,'--',RECEIPT_PATH]);
  const receipt=listed?JSON.parse(committed(RECEIPT_PATH)):{families:{}};
  if(families!==null) {
    for(const id of families)assert.ok(receipt.families[id],'P2_MISSING_RESULT_FAMILY: '+id);
    receipt.families=Object.fromEntries(families.map(id=>[id,receipt.families[id]]));
  }
  for(const [id,entry] of Object.entries(receipt.families))for(const [path,digest] of Object.entries(entry.outputs)) {
    const bytes=committed(path);
    assert.equal(sha(bytes),digest,'P2_RESULT_OUTPUT_MISMATCH: '+id+'/'+path);
  }
  const wasmManifestBytes=committed(WASM_OUTPUTS[2]),wasmManifest=JSON.parse(wasmManifestBytes);
  assert.equal(wasmManifest.schema,'pandoeditor-core-wasm');
  const wasmAssets={};
  for(const [kind,spec] of Object.entries(wasmManifest.assets)) {
    assert.ok(['js','wasm'].includes(kind)&&spec.file==='pandoeditor-core.'+kind,'P2_WASM_ASSET_PATH');
    const bytes=committed('shared/frontend/static/wasm/'+spec.file);assert.equal(sha(bytes),spec.sha256,'P2_RESULT_WASM_MISMATCH: '+kind);
    wasmAssets[kind]={sha256:spec.sha256,bytes:bytes.length};
  }
  const evidence={schema:'pandolab-p2-result-evidence',schemaVersion:1,sourceSha:expectedSourceSha,resultSha,...(config?{libraryRevision:config.revision}:{}),
    verifiedScope:['wasm',...Object.keys(receipt.families)],
    wasm:{manifestSha256:sha(wasmManifestBytes),sourceSha256:wasmManifest.sourceSha256,assets:wasmAssets},
    intermediateSourceShas:[...new Set(Object.values(receipt.families).map(f=>f.sourceSha))],families:receipt.families};
  writeJson(root,evidenceFile,evidence);return evidence;
}
