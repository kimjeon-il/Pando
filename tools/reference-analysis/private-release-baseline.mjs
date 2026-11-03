// One explicit, content-proven transition for the native source omission.
// Never treat a saved receipt as authorization: derive it from actual bytes.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {privatePluginFingerprint} from './package-private-plugin.mjs';

const skill='skills/pando-map-analysis/',seed=skill+'runtime/workspace/',runtime=skill+'runtime.json';
const additions=['tools/cpp/map-image/macro-mask.h','tools/cpp/map-image/training-scan.h','tools/cpp/map-image/training-tile.h',
  'tools/cpp/reference-analysis/condition-sampling.h','tools/cpp/reference-analysis/training-photometry.h','tools/cpp/reference-analysis/CPYTHON-LICENSE'];
const hash=b=>createHash('sha256').update(b).digest('hex');
const json=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
const check=(ok,message)=>assert.ok(ok,message);
const owned=p=>p==='plugin.json'||p==='release.json'||p.startsWith(skill);
const read=(files,path)=>{check(files.has(path),'Missing baseline payload: '+path);return JSON.parse(files.get(path));};
const row=([path,data])=>({path,bytes:data.length,sha256:hash(data)});
export const baselineInventory=files=>[...files].map(row).sort((a,b)=>a.path.localeCompare(b.path));
export function baselineEntryMap(entries){
  const files=new Map();for(const {path,data}of entries){
    check(typeof path==='string'&&!path.includes('\\')&&![...path].some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127)&&!path.split('/').some(p=>!p||p==='.'||p==='..'),'Invalid baseline path');
    check(!files.has(path),'Duplicate candidate path: '+path);check(Buffer.isBuffer(data),'Candidate payload bytes required');files.set(path,data);
  }return files;
}
function normalized(files){
  return new Map([...files].map(([path,data])=>{
    if(path==='plugin.json'){const v=JSON.parse(data);delete v.version;data=json(v);}
    if(path===runtime){const v=JSON.parse(data);delete v.codeRevision;data=json(v);}
    return [path,data];
  }));
}
function comparePayload(a,b,message){
  assert.deepEqual([...a.keys()].sort(),[...b.keys()].sort(),message+' inventory');
  for(const [path,bytes]of a)check(bytes.equals(b.get(path)),message+': '+path);
}
function catalogue(files,revision){
  const value=read(files,runtime);check(value.schemaVersion===2&&value.codeRevision===revision,'Runtime source revision mismatch');
  check(Array.isArray(value.files),'Runtime catalogue required');
  const seen=new Set();for(const entry of value.files){
    check(!seen.has(entry.path),'Duplicate catalogue path');seen.add(entry.path);
    const bytes=files.get(seed+entry.path);check(bytes&&entry.bytes===bytes.length&&entry.sha256===hash(bytes),'Catalogue payload mismatch: '+entry.path);
    assert.deepEqual(Object.keys(entry).sort(),['bytes','path','sha256'],'Unexpected catalogue fields');
  }
  assert.deepEqual([...seen].sort(),[...files.keys()].filter(p=>p.startsWith(seed)).map(p=>p.slice(seed.length)).sort(),'Catalogue inventory mismatch');
  return value;
}
export function verifyNativeSourceBaseline({target,remote,archiveFiles,archiveReleaseId,previousCandidate,candidate,branch,producerSha256}){
  const p=remote?.plugin;
  check(p?.plugin_id===target?.pluginId&&p?.name==='map-toolkit'&&p.scope==='USER'&&p.discoverability==='PRIVATE','Original private plugin identity required');
  check(archiveReleaseId&&archiveReleaseId===p.current_release_id,'Exact current archive release required');
  check(branch==='work/gis','Native source baseline requires work/gis');
  check(/^[a-f0-9]{64}$/.test(producerSha256||''),'Producer hash required');
  check(remote.complete===true&&Array.isArray(remote.files)&&archiveFiles instanceof Map,'Complete authenticated inventory and archive required');
  const inventory=new Map();for(const entry of remote.files){check(!inventory.has(entry.path),'Duplicate remote inventory path');inventory.set(entry.path,entry.size_bytes);}
  assert.deepEqual([...archiveFiles.keys()].sort(),[...inventory.keys()].sort(),'Full account archive inventory mismatch');
  for(const [path,bytes]of archiveFiles){check(Buffer.isBuffer(bytes)&&bytes.length===inventory.get(path),'Account archive size mismatch: '+path);}
  for(const path of ['plugin.json','.codex-plugin/plugin.json','release.json']){
    check(typeof remote.contents?.[path]==='string','Authenticated manifest/receipt text required');
    assert.deepEqual(read(archiveFiles,path),JSON.parse(remote.contents[path]),'Authenticated manifest/receipt mismatch: '+path);
  }
  const receipt=read(archiveFiles,'release.json'),root=read(archiveFiles,'plugin.json'),legacy=read(archiveFiles,'.codex-plugin/plugin.json');
  check(receipt.schema==='map-toolkit-release'&&!receipt.baselineTransition,'Original release receipt required; transition replay forbidden');
  for(const manifest of [root,legacy])check(manifest.name==='map-toolkit'&&manifest.version===p.version,'Current manifest identity/version mismatch');
  check(receipt.version===p.version&&/^[a-f0-9]{64}$/.test(receipt.verificationSha256||''),'Current release receipt invalid');
  const accountOwned=[...archiveFiles].filter(([path])=>owned(path)).map(([path,data])=>({path,data}));
  check(privatePluginFingerprint(accountOwned)===receipt.contentSha256,'Current receipt content fingerprint mismatch');
  for(const value of [previousCandidate,candidate]){
    check(/^[a-f0-9]{40}$/.test(value?.codeRevision||''),'Full candidate source revision required');
    check(value.dataRevision===receipt.dataRevision&&value.modelSha256===receipt.modelSha256,'Candidate data/model identity changed');
  }
  check(previousCandidate.codeRevision===receipt.codeRevision&&candidate.codeRevision!==receipt.codeRevision,'Previous candidate source revision mismatch');
  const before=baselineEntryMap(previousCandidate.entries),after=baselineEntryMap(candidate.entries);
  check(!before.has('release.json')&&!before.has('.codex-plugin/plugin.json'),'Candidate must exclude account metadata');
  comparePayload(normalized(before),normalized(after),'Candidate payload mismatch');
  check(privatePluginFingerprint(previousCandidate.entries)===privatePluginFingerprint(candidate.entries),'Candidate fingerprint mismatch');
  const oldCatalog=catalogue(archiveFiles,receipt.codeRevision),newCatalog=catalogue(before,receipt.codeRevision);
  catalogue(after,candidate.codeRevision);
  const newOnly=[...before.keys()].filter(path=>!archiveFiles.has(path)).sort(),allowed=additions.map(path=>seed+path).sort();
  assert.deepEqual(newOnly,allowed,'Exactly the six native source additions are required');
  for(const path of additions)check(!oldCatalog.files.some(row=>row.path===path),'Native repair already present');
  const filtered={...newCatalog,files:newCatalog.files.filter(row=>!additions.includes(row.path))};
  assert.deepEqual(filtered,oldCatalog,'Only six exact catalogue additions are allowed');
  const existing=new Map([...archiveFiles].filter(([path])=>owned(path)&&path!=='release.json'));
  const repaired=new Map([...before].filter(([path])=>!allowed.includes(path)));
  repaired.set(runtime,json(filtered));existing.set(runtime,json(oldCatalog));
  comparePayload(normalized(existing),normalized(repaired),'Existing payload/manifest changed');
  const retainedFiles=baselineInventory(new Map([...archiveFiles].filter(([path])=>!owned(path)&&path!=='.codex-plugin/plugin.json')));
  return {schema:'map-toolkit-native-source-baseline',schemaVersion:1,pluginId:p.plugin_id,expectedReleaseId:p.current_release_id,branch,
    previousRevision:receipt.codeRevision,codeRevision:candidate.codeRevision,producerSha256,
    inventorySha256:hash(json(baselineInventory(archiveFiles))),candidateSha256:hash(json(baselineInventory(normalized(after)))),
    contentSha256:privatePluginFingerprint(candidate.entries),previousReceiptSha256:hash(archiveFiles.get('release.json')),
    manifestSha256:Object.fromEntries(['plugin.json','.codex-plugin/plugin.json'].map(path=>[path,hash(archiveFiles.get(path))])),
    addedPaths:allowed,retainedFiles};
}

export function verifyBaselinePackage({candidate,actualFiles,proof,version,legacyManifest,receipt,includeRetained=false}){
  const expected=baselineEntryMap(candidate.entries);
  check(hash(json(baselineInventory(normalized(expected))))===proof.candidateSha256,'Proved candidate changed before packaging');
  check(privatePluginFingerprint(candidate.entries)===proof.contentSha256,'Proved candidate fingerprint changed');
  expected.set('plugin.json',json({...read(expected,'plugin.json'),version}));
  expected.set('.codex-plugin/plugin.json',json({...legacyManifest,version}));
  expected.set('release.json',json(receipt));
  const retained=includeRetained?proof.retainedFiles:[];
  assert.deepEqual([...actualFiles.keys()].sort(),[...expected.keys(),...retained.map(row=>row.path)].sort(),'Final package inventory mismatch');
  for(const [path,bytes]of expected){
    // The account service may reserialize its two manifests. No field change is allowed.
    if(['plugin.json','.codex-plugin/plugin.json'].includes(path))assert.deepEqual(read(actualFiles,path),JSON.parse(bytes),'Final manifest configuration mismatch');
    else check(bytes.equals(actualFiles.get(path)),'Final package payload mismatch: '+path);
  }
  check(read(actualFiles,runtime).codeRevision===proof.codeRevision&&receipt.codeRevision===proof.codeRevision,'Final runtime source revision mismatch');
  for(const row of retained){const bytes=actualFiles.get(row.path);check(bytes.length===row.bytes&&hash(bytes)===row.sha256,'Retained account payload changed: '+row.path);}
  const entries=[...actualFiles].filter(([path])=>owned(path)).map(([path,data])=>({path,data}));
  check(privatePluginFingerprint(entries)===proof.contentSha256,'Final package fingerprint mismatch');
  return {checkedFiles:actualFiles.size,inventorySha256:hash(json(baselineInventory(actualFiles)))};
}
