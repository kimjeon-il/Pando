// Codex completion boundary. Account operations stay in the authenticated host;
// this owner binds checked source, upload arguments and read-back evidence.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,lstat,open} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,dirname,join,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify,parseArgs} from 'node:util';
import {privatePluginEntries,privatePluginFingerprint,packagePrivatePlugin,assertPushedPluginRevision,compatibilityManifest} from './package-private-plugin.mjs';
import {readPinnedSource,collectSourceFiles} from './runtime-assets.mjs';
import {frontendWasmRoot} from '../../scripts/lib/frontend-layout.mjs';
import {zipMembers,zipMemberChunks} from '../lib/geonames-zip.mjs';
import {verifyNativeSourceBaseline,verifyBaselinePackage,baselineEntryMap,baselineInventory} from './private-release-baseline.mjs';

const exec=promisify(execFile),root=fileURLToPath(new URL('../../',import.meta.url));
const hash=value=>createHash('sha256').update(value).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const readJSON=async path=>JSON.parse(await readFile(path,'utf8'));
const check=(condition,message)=>assert.ok(condition,message);
const producerPaths=['tools/reference-analysis/release-private-plugin.mjs','tools/reference-analysis/package-private-plugin.mjs',
  'tools/reference-analysis/private-release-baseline.mjs','tools/reference-analysis/runtime-assets.mjs'];
const owned=path=>path==='plugin.json'||path==='release.json'||path.startsWith('skills/pando-map-analysis/');
function safePath(path){check(typeof path==='string'&&!path.includes('\\')&&![...path].some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127)&&!isAbsolute(path)&&!path.split('/').some(part=>!part||part==='.'||part==='..'),'Invalid release file path');return path;}

export function nextReleaseVersion(source,current){
  const parse=value=>{check(/^\d+\.\d+\.\d+$/.test(value),'Invalid release version');return value.split('.').map(Number);};
  const a=parse(source),b=parse(current);
  for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]>b[i]?source:[b[0],b[1],b[2]+1].join('.');
  return [b[0],b[1],b[2]+1].join('.');
}
function checkIdentity(target,remote){
  const p=remote?.plugin;
  check(p?.plugin_id===target.pluginId&&p.name==='map-toolkit','Plugin identity mismatch');
  check(p.scope==='USER'&&p.discoverability==='PRIVATE','Original private personal plugin required');
  check(remote.complete===true&&Array.isArray(remote.files),'Complete remote inventory required');
  for(const row of remote.files)safePath(row.path);
}
export function planPrivateRelease({target,remote,candidate,verification}){
  checkIdentity(target,remote);
  check(verification?.schema==='map-toolkit-verification'&&verification.codeRevision===candidate.codeRevision
    &&verification.contentSha256===candidate.contentSha256,'Matching verification required');
  check(verification.checks?.length>0&&verification.checks.every(row=>row.exitCode===0),'Successful verification checks required');
  const previous=remote.contents?.['release.json']?JSON.parse(remote.contents['release.json']):null;
  const verifiedCurrent=target.verifiedRelease?.releaseId===remote.plugin.current_release_id;
  if(verifiedCurrent&&target.verifiedRelease.contentSha256===candidate.contentSha256)
    return {status:'unchanged',pluginId:target.pluginId,releaseId:remote.plugin.current_release_id};
  if(!verifiedCurrent&&previous?.contentSha256===candidate.contentSha256)
    return {status:'verification-required',pluginId:target.pluginId,releaseId:remote.plugin.current_release_id};
  const next=new Set(candidate.files.map(row=>safePath(row.path)));
  return {schema:'map-toolkit-release-plan',status:'prepared',pluginId:target.pluginId,expectedReleaseId:remote.plugin.current_release_id,
    version:nextReleaseVersion(candidate.version,remote.plugin.version),codeRevision:candidate.codeRevision,
    contentSha256:candidate.contentSha256,dataRevision:candidate.dataRevision,modelSha256:candidate.modelSha256,
    verificationSha256:hash(json(verification)),deletePaths:remote.files.map(row=>row.path).filter(path=>owned(path)&&!next.has(path)&&path!=='release.json'),
    files:candidate.files};
}
export function verifyPrivateRelease({plan,remote}){
  checkIdentity({pluginId:plan.pluginId},remote);
  check(plan.uploadedReleaseId&&remote.plugin.current_release_id===plan.uploadedReleaseId&&remote.plugin.current_release_id!==plan.expectedReleaseId
    &&remote.plugin.version===plan.version,'Uploaded release/version is not current');
  for(const path of ['plugin.json','.codex-plugin/plugin.json']){
    const m=JSON.parse(remote.contents?.[path]||'null');
    check(m?.name==='map-toolkit'&&m.version===plan.version,'Remote manifest identity/version mismatch');
    check(plan.manifests?.[path],'Expected manifest contract missing');
    assert.deepEqual(m,plan.manifests[path],'Remote manifest behavior/configuration mismatch: '+path);
  }
  const receipt=JSON.parse(remote.contents?.['release.json']||'null');
  for(const key of ['codeRevision','contentSha256','dataRevision','modelSha256','verificationSha256','version'])check(receipt?.[key]===plan[key],'Remote release receipt mismatch: '+key);
  const paths=new Set(remote.files.map(row=>row.path));
  for(const path of plan.deletePaths)check(!paths.has(path),'Retired file remains: '+path);
  for(const row of plan.files)check(paths.has(row.path),'Uploaded file missing: '+row.path);
  if(plan.baselineTransition){
    assert.deepEqual(receipt,plan.baselineReceipt,'Remote baseline receipt mismatch');
    const expected=[...plan.files,...plan.baselineTransition.retainedFiles];
    check(paths.size===remote.files.length,'Duplicate remote inventory path');
    assert.deepEqual([...paths].sort(),expected.map(row=>row.path).sort(),'Complete baseline inventory mismatch');
    const actual=new Map(remote.files.map(row=>[row.path,row.size_bytes]));
    for(const row of expected)if(!plan.manifests[row.path])check(actual.get(row.path)===row.bytes,'Remote baseline inventory size mismatch');
  }
  return {status:'verified',pluginId:plan.pluginId,releaseId:remote.plugin.current_release_id,version:plan.version,codeRevision:plan.codeRevision,contentSha256:plan.contentSha256};
}
export function recordPrivateUpload({plan,response}){
  check(!response?.isError&&response?.status==='updated','Successful upload response required; keep the prepared candidate on failure');
  check(response.plugin_id===plan.pluginId&&response.scope==='USER'&&response.discoverability==='PRIVATE','Uploaded plugin identity changed');
  check(response.current_release_id&&response.current_release_id!==plan.expectedReleaseId&&response.version===plan.version,'Uploaded release/version mismatch');
  return {...plan,status:'uploaded-unverified',uploadedReleaseId:response.current_release_id};
}

export const assertPushedRevision=assertPushedPluginRevision;
export async function assertReleaseAncestor(workspace,currentRevision,revision){
  check(/^[a-f0-9]{40}$/.test(currentRevision)&&/^[a-f0-9]{40}$/.test(revision),'Full plugin revisions are required');
  await exec('git',['merge-base','--is-ancestor',currentRevision,revision],{cwd:workspace});
}
async function candidateFor({revision,modelPath,workspace=root,pushed=true,branch}){
  if(pushed)await assertPushedRevision(workspace,revision,{branch});
  const candidate=await privatePluginEntries({revision,modelPath,workspace});
  return {...candidate,contentSha256:privatePluginFingerprint(candidate.entries),files:candidate.entries.map(row=>({path:row.path,bytes:row.data.length,sha256:hash(row.data)}))};
}
async function assertWorkingInputs(workspace,revision,paths){
  const names=[...new Set(paths)];
  // Git's configured text normalization accepts Windows line endings, while
  // still rejecting actual source changes and uncommitted test inputs.
  for(const path of names){safePath(path);await readPinnedSource(workspace,revision,path);check(!(await lstat(join(workspace,path))).isSymbolicLink(),'Validation input is a link');}
  const diff=await exec('git',['diff','--name-only',revision,'--',...names],{cwd:workspace});
  check(!diff.stdout.trim(),'Validation inputs differ from the committed snapshot: '+diff.stdout.trim());
}
export async function verifyReleaseChecks({revision,modelPath,commands,workspace=root,run=exec}){
  const candidate=await candidateFor({revision,modelPath,workspace,pushed:false});
  const paths=await releaseInputPaths(workspace,revision,commands);
  const checks=await runVerifiedCommands({workspace,revision,paths,commands,run});
  const after=await candidateFor({revision,modelPath,workspace,pushed:false});check(after.contentSha256===candidate.contentSha256,'Inputs changed during verification');
  return {schema:'map-toolkit-verification',codeRevision:revision,contentSha256:candidate.contentSha256,checks};
}
export async function releaseInputPaths(workspace=root,revision,commands){
  return [...await collectSourceFiles(workspace,{revision}),
    ...['pandoeditor-core.js','pandoeditor-core.wasm','pandoeditor-core.manifest.json'].map(name=>frontendWasmRoot+'/'+name),
    'docs/historical-border-reconstruction-policy.md',...producerPaths,...commands.flatMap(row=>row.inputs||[])];
}
export async function runVerifiedCommands({workspace,revision,paths,commands,run=exec}){
  check(Array.isArray(commands)&&commands.length>0,'Explicit focused checks required');
  await assertWorkingInputs(workspace,revision,paths);
  const checks=[];
  for(const command of commands){
    check(command.inputs?.length>0&&typeof command.command==='string'&&Array.isArray(command.args),'Check command and explicit input scope required');
    const result=await run(command.command,command.args,{cwd:workspace,windowsHide:true,maxBuffer:8*1024*1024});
    checks.push({command:command.command,args:command.args,inputs:command.inputs,exitCode:0,outputSha256:hash((result.stdout||'')+(result.stderr||''))});
  }
  await assertWorkingInputs(workspace,revision,paths);
  return checks;
}
export async function preparePrivateRelease({revision,modelPath,verification,remote,target,workspace=root,branch,rebaselineArchive,archiveReleaseId}){
  check(Boolean(rebaselineArchive)===Boolean(archiveReleaseId),'Explicit rebaseline archive and exact archive release must be supplied together');
  const candidate=await candidateFor({revision,modelPath,workspace,branch});
  const plan=planPrivateRelease({target,remote,candidate,verification});if(['unchanged','verification-required'].includes(plan.status))return plan;
  let baselineTransition;
  if(rebaselineArchive){
    await assertWorkingInputs(workspace,revision,producerPaths);
    const previous=JSON.parse(remote.contents?.['release.json']||'null');check(previous,'Current release receipt required');
    const previousCandidate=await candidateFor({revision:previous.codeRevision,modelPath,workspace,pushed:false});
    const archiveFiles=await readPrivateReleaseArchive(rebaselineArchive,remote.files);
    const producerSha256=hash(json(await Promise.all(producerPaths.map(async path=>[path,hash(await readPinnedSource(workspace,revision,path))]))));
    baselineTransition=verifyNativeSourceBaseline({target,remote,archiveFiles,archiveReleaseId,previousCandidate,candidate,branch,producerSha256});
    check(plan.deletePaths.length===0,'Native source transition cannot delete paths');
  }else if(remote.contents?.['release.json']){
    const previous=JSON.parse(remote.contents['release.json']);
    await assertReleaseAncestor(workspace,previous.codeRevision,revision);
  }
  const legacyManifest=JSON.parse(remote.contents['.codex-plugin/plugin.json']||'null');
  check(legacyManifest?.name==='map-toolkit','Read the existing compatibility manifest before update');
  const receipt={schema:'map-toolkit-release',codeRevision:revision,dataRevision:candidate.dataRevision,modelSha256:candidate.modelSha256,
    contentSha256:candidate.contentSha256,verificationSha256:plan.verificationSha256,...(baselineTransition?{baselineTransition}:{}),version:plan.version};
  const pendingPath=target.directory+'.release.json';
  if(existsSync(pendingPath)){
    const pending=await readJSON(pendingPath),archive=resolve(target.directory)+'.zip';
    check(pending.archive===archive,'Pending archive destination changed');
    const archiveBytes=await readFile(archive),archiveSha256=hash(archiveBytes);
    const expected=baselineEntryMap(candidate.entries),outer={...JSON.parse(expected.get('plugin.json')),version:plan.version};
    const manifests={'plugin.json':outer,'.codex-plugin/plugin.json':compatibilityManifest(legacyManifest,outer,{preserve:Boolean(baselineTransition)})};
    for(const [path,value]of Object.entries(manifests))expected.set(path,Buffer.from(json(value)));
    expected.set('release.json',Buffer.from(json(receipt)));
    const files=baselineInventory(expected),actualFiles=await readPrivateReleaseArchive(archive,files.map(row=>({path:row.path,size_bytes:row.bytes})));
    for(const row of files)check(hash(actualFiles.get(row.path))===row.sha256,'Pending payload differs from current candidate: '+row.path);
    if(baselineTransition)verifyBaselinePackage({candidate,actualFiles,proof:baselineTransition,version:plan.version,legacyManifest,receipt});
    return restorePreparedPlan({pending,plan,archive,archiveBytes:archiveBytes.length,archiveSha256,files,manifests,
      baselineTransition,baselineReceipt:baselineTransition?receipt:undefined});
  }
  const result=await packagePrivatePlugin({revision,modelPath,workspace,directory:target.directory,version:plan.version,legacyManifest,
    preserveLegacyManifest:Boolean(baselineTransition),branch,release:receipt});
  if(baselineTransition){
    const actualFiles=await readPrivateReleaseArchive(result.archive,result.files.map(row=>({path:row.path,size_bytes:row.bytes})));
    verifyBaselinePackage({candidate,actualFiles,proof:baselineTransition,version:plan.version,legacyManifest,receipt});
  }
  const manifests=Object.fromEntries(await Promise.all(['plugin.json','.codex-plugin/plugin.json'].map(async path=>[path,await readJSON(join(result.directory,path))])));
  const pending={...plan,manifests,files:result.files,archive:result.archive,archiveBytes:result.archiveBytes,archiveSha256:result.archiveSha256,
    ...(baselineTransition?{baselineTransition,baselineReceipt:receipt}:{}),
    upload:{plugin_id:plan.pluginId,expected_release_id:plan.expectedReleaseId,archive:result.archive,delete_paths:plan.deletePaths}};
  await save(pendingPath,pending);return pending;
}
export function restorePreparedPlan({pending,plan,archive,archiveBytes,archiveSha256,files,manifests,baselineTransition,baselineReceipt}){
  const upload={plugin_id:plan.pluginId,expected_release_id:plan.expectedReleaseId,archive,delete_paths:plan.deletePaths};
  for(const [key,value]of Object.entries(plan))if(key!=='files')assert.deepEqual(pending[key],value,'Pending release metadata changed: '+key);
  for(const [key,value]of Object.entries({archive,archiveBytes,archiveSha256,manifests,baselineTransition,baselineReceipt,upload}))
    assert.deepEqual(pending[key],value,'Pending release metadata changed: '+key);
  assert.deepEqual([...pending.files].sort((a,b)=>a.path.localeCompare(b.path)),files,'Pending file inventory changed');
  return {...plan,manifests,files,archive,archiveBytes,archiveSha256,...(baselineTransition?{baselineTransition,baselineReceipt}:{}),upload};
}
export function verifyBaselineReadback(plan,files){
  const candidate={entries:[...files].filter(([path])=>owned(path)&&path!=='release.json').map(([path,data])=>({path,data}))};
  return verifyBaselinePackage({candidate,actualFiles:files,proof:plan.baselineTransition,version:plan.version,
    legacyManifest:plan.manifests['.codex-plugin/plugin.json'],receipt:plan.baselineReceipt,includeRetained:true});
}
export async function verifyReleaseArchive(plan,path){
  if(await isGzipArchive(path)){
    const files=await readTarFiles(path,plan.archiveFiles||plan.files.map(row=>({path:row.path,size_bytes:row.bytes})));
    for(const row of plan.files){
      const bytes=files.get(row.path);check(bytes,'Remote archive file missing: '+row.path);
      if(plan.manifests?.[row.path])assert.deepEqual(JSON.parse(bytes.toString('utf8')),plan.manifests[row.path],'Archive manifest configuration mismatch');
      else check(bytes.length===row.bytes&&hash(bytes)===row.sha256,'Remote archive hash mismatch: '+row.path);
    }
    return {checkedFiles:plan.files.length};
  }
  const {byName,prefix}=await archiveIndex(path);
  let checked=0;
  for(const row of plan.files){
    const member=byName.get(prefix+row.path);check(member,'Remote archive file missing: '+row.path);
    const digest=createHash('sha256'),chunks=[];let bytes=0;for await(const chunk of zipMemberChunks(path,member)){digest.update(chunk);bytes+=chunk.length;if(plan.manifests?.[row.path])chunks.push(chunk);}
    if(plan.manifests?.[row.path])assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString('utf8')),plan.manifests[row.path],'Archive manifest configuration mismatch');
    else check(bytes===row.bytes&&digest.digest('hex')===row.sha256,'Remote archive hash mismatch: '+row.path);
    checked++;
  }
  return {checkedFiles:checked};
}
async function zipAttributes(path,members){
  // Release-only type inspection. Do not change the canonical runtime ZIP reader
  // (its exact payload is one of the baseline transition's protected bytes).
  const file=await open(path,'r');
  const read=async(size,at)=>{const b=Buffer.alloc(size);let done=0;while(done<size){const r=await file.read(b,done,size-done,at+done);check(r.bytesRead>0,'Truncated ZIP type metadata');done+=r.bytesRead;}return b;};
  const u64=(b,at)=>{const n=b.readBigUInt64LE(at);check(n<=BigInt(Number.MAX_SAFE_INTEGER),'Oversized ZIP metadata');return Number(n);};
  try{
    const {size}=await file.stat(),length=Math.min(size,65557),tail=await read(length,size-length);let end=-1;
    for(let i=tail.length-22;i>=0;i--)if(tail.readUInt32LE(i)===0x06054b50&&i+22+tail.readUInt16LE(i+20)===tail.length){end=i;break;}
    check(end>=0,'ZIP type directory missing');let bytes=tail.readUInt32LE(end+12),at=tail.readUInt32LE(end+16);
    if(bytes===0xffffffff||at===0xffffffff||tail.readUInt16LE(end+10)===65535){
      const locator=await read(20,size-length+end-20);check(locator.readUInt32LE(0)===0x07064b50,'ZIP64 type locator missing');
      const record=await read(56,u64(locator,8));check(record.readUInt32LE(0)===0x06064b50,'ZIP64 type directory missing');bytes=u64(record,40);at=u64(record,48);
    }
    check(bytes<=8*1024*1024&&at+bytes<=size,'ZIP type directory exceeds budget');
    const central=await read(bytes,at),result=[];let cursor=0;
    for(const member of members){
      check(cursor+46<=central.length&&central.readUInt32LE(cursor)===0x02014b50,'Invalid ZIP type entry');
      const n=central.readUInt16LE(cursor+28),extra=central.readUInt16LE(cursor+30),comment=central.readUInt16LE(cursor+32);
      check(cursor+46+n+extra+comment<=central.length&&central.toString('utf8',cursor+46,cursor+46+n)===member.name,'ZIP type directory changed');
      let localAt=central.readUInt32LE(cursor+42);
      if(localAt===0xffffffff){
        let at=cursor+46+n,found=false;const end=at+extra;
        while(at+4<=end){const id=central.readUInt16LE(at),length=central.readUInt16LE(at+2);at+=4;check(at+length<=end,'Invalid ZIP local offset metadata');
          if(id===1){let offset=at;if(central.readUInt32LE(cursor+24)===0xffffffff)offset+=8;if(central.readUInt32LE(cursor+20)===0xffffffff)offset+=8;
            check(offset+8<=at+length,'Missing ZIP64 local offset');localAt=u64(central,offset);found=true;break;}at+=length;}
        check(found,'Missing ZIP64 local offset');
      }
      const local=await read(30,localAt);check(local.readUInt32LE(0)===0x04034b50,'ZIP local header missing');
      check(local.readUInt16LE(6)===central.readUInt16LE(cursor+8)&&local.readUInt16LE(8)===member.method,'ZIP local header flags/method mismatch');
      const localName=await read(local.readUInt16LE(26),localAt+30);
      check(localName.equals(central.subarray(cursor+46,cursor+46+n)),'ZIP local name/path mismatch');
      check(localAt+30+localName.length+local.readUInt16LE(28)===member.dataAt,'ZIP local data boundary mismatch');
      result.push(central.readUInt32LE(cursor+38));cursor+=46+n+extra+comment;
    }check(cursor===central.length,'ZIP type inventory mismatch');return result;
  }finally{await file.close();}
}
async function archiveIndex(path){
  const members=await zipMembers(path,{maxCentral:8*1024*1024}),attributes=await zipAttributes(path,members),byName=new Map();
  for(const [index,member]of members.entries()){
    const externalAttributes=attributes[index];
    const directory=member.name.endsWith('/'),name=directory?member.name.slice(0,-1):member.name,type=(externalAttributes>>>16)&0xf000;
    safePath(name);check(!byName.has(name),'Duplicate remote archive path');
    check(type===0||type===(directory?0x4000:0x8000),'Archive entry must be a regular file or directory');
    check(directory||!(externalAttributes&0x10),'Archive directory type mismatch');
    byName.set(name,{...member,directory});
  }
  const rootManifest=[...byName.keys()].filter(name=>name==='plugin.json'||name.endsWith('/plugin.json'));
  const prefix=byName.has('plugin.json')?'':rootManifest.filter(name=>name.split('/').length===2).map(name=>name.slice(0,-11))[0];
  check(prefix!==undefined,'Remote archive root manifest missing');
  return {byName,prefix};
}
async function isGzipArchive(path){
  const file=await open(path,'r');try{const magic=Buffer.alloc(2);await file.read(magic,0,2,0);return magic[0]===0x1f&&magic[1]===0x8b;}finally{await file.close();}
}
async function readTarFiles(path,inventory,{complete=false}={}){
  // Literal, numeric-owner listings require GNU tar. Git for Windows supplies
  // it; the Windows system bsdtar does not implement this contract. -O never
  // extracts account archive paths into the filesystem.
  const tar=process.platform==='win32'
    ? resolve((await exec('git',['--exec-path'],{encoding:'utf8',windowsHide:true})).stdout.trim(),'../../../usr/bin/tar.exe')
    : 'tar';
  const env=process.platform==='win32'?Object.fromEntries([
    ...Object.entries(process.env).filter(([key])=>key.toLowerCase()!=='path'),
    ['PATH',dirname(tar)+';'+(process.env.PATH||process.env.Path||'')],
  ]):process.env;
  const listing=await exec(tar,['--force-local','--quoting-style=literal','-tf',path],{env,encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});
  const details=await exec(tar,['--force-local','--numeric-owner','--quoting-style=literal','-tvf',path],{env,encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});
  const headers=details.stdout.trimEnd().split('\n'),types=headers.map(line=>line[0]);
  const names=listing.stdout.split(/\r?\n/).filter(Boolean),prefix=names.includes('plugin.json')?'':
    names.filter(name=>name.split('/').length===2&&name.endsWith('/plugin.json')).map(name=>name.slice(0,-11))[0];
  check(prefix!==undefined,'Account archive root manifest missing');
  check(types.length===names.length,'Invalid account archive path or type listing');
  const sizes=new Map(inventory.map(row=>[prefix+safePath(row.path),row.size_bytes])),seen=new Set(),selected=[],regular=[],actualSizes=new Map();
  check(sizes.size===inventory.length,'Duplicate account inventory path');
  for(const [index,name]of names.entries()){
    const normalized=name.endsWith('/')?name.slice(0,-1):name;safePath(normalized);
    check(!seen.has(normalized),'Duplicate account archive path');seen.add(normalized);
    check(['-','d'].includes(types[index]),'Archive entry must be a regular file or directory');
    if(types[index]==='d'){check(!sizes.has(name),'Expected file is a directory');continue;}
    const match=/^\S+\s+\d+\/\d+\s+(\d+)\s/.exec(headers[index]);check(match,'Invalid archive member size metadata');
    const bytes=Number(match[1]);check(Number.isSafeInteger(bytes)&&bytes>=0&&bytes<=64*1024*1024,'Invalid archive member size');
    actualSizes.set(name,bytes);regular.push(name);
    if(sizes.has(name)){check(sizes.get(name)===bytes,'Account archive member size mismatch: '+name);selected.push(name);}
  }
  for(const name of sizes.keys())check(regular.includes(name),'Account archive file missing: '+name);
  if(complete)assert.deepEqual(regular.sort(),[...sizes.keys()].sort(),'Complete account archive inventory mismatch');
  let total=0;for(const name of selected){const bytes=actualSizes.get(name);check(Number.isSafeInteger(bytes)&&bytes>=0&&bytes<=64*1024*1024,'Invalid account archive file size');total+=bytes;}
  check(total<=128*1024*1024,'Account archive exceeds bounded verification size');
  const {stdout}=await exec(tar,['--force-local','-xOf',path,'--',...selected],{env,encoding:null,windowsHide:true,maxBuffer:total+1024*1024});
  check(stdout.length===total,'Account archive size mismatch');
  const result=new Map();let at=0;for(const name of selected){const bytes=actualSizes.get(name);result.set(name.slice(prefix.length),stdout.subarray(at,at+bytes));at+=bytes;}
  return result;
}
export async function readPrivateReleaseArchive(path,inventory){
  if(await isGzipArchive(path))return readTarFiles(path,inventory,{complete:true});
  const {byName,prefix}=await archiveIndex(path),result=new Map();
  const names=[...byName].filter(([,member])=>!member.directory).map(([name])=>name);
  check(new Set(inventory.map(row=>row.path)).size===inventory.length,'Duplicate account inventory path');
  assert.deepEqual(names.sort(),inventory.map(row=>prefix+safePath(row.path)).sort(),'Complete account archive inventory mismatch');
  let total=0;for(const row of inventory){
    const member=byName.get(prefix+row.path);check(Number.isSafeInteger(row.size_bytes)&&row.size_bytes>=0&&row.size_bytes<=64*1024*1024,'Invalid archive file size');
    check(member.uncompressed===row.size_bytes,'Archive member size mismatch');total+=row.size_bytes;check(total<=128*1024*1024,'Archive exceeds verification byte limit');
    const chunks=[];for await(const chunk of zipMemberChunks(path,member))chunks.push(chunk);result.set(row.path,Buffer.concat(chunks));
  }return result;
}
export async function inspectPrivateRelease({target,remote,archivePath,archiveReleaseId}){
  checkIdentity(target,remote);check(archiveReleaseId===remote.plugin.current_release_id,'Download the exact current release before inspecting');
  if(await isGzipArchive(archivePath)){
    const files=await readTarFiles(archivePath,remote.files);
    return {releaseId:remote.plugin.current_release_id,contentSha256:privatePluginFingerprint([...files].filter(([path])=>owned(path)).map(([path,data])=>({path,data})))};
  }
  const {byName,prefix}=await archiveIndex(archivePath),entries=[];
  for(const row of remote.files){
    if(!owned(row.path)||row.path==='release.json')continue;
    const member=byName.get(prefix+row.path);check(member,'Current archive file missing: '+row.path);
    check(member.uncompressed<=64*1024*1024,'Oversized current plugin member');
    const chunks=[];for await(const chunk of zipMemberChunks(archivePath,member))chunks.push(chunk);
    entries.push({path:row.path,data:Buffer.concat(chunks)});
  }
  return {releaseId:remote.plugin.current_release_id,contentSha256:privatePluginFingerprint(entries)};
}
export async function completePrivateRelease({plan,remote,archivePath}){
  const result=verifyPrivateRelease({plan,remote});
  check(archivePath,'Downloaded exact-release archive required for byte verification');
  if(plan.baselineTransition)return {...result,...verifyBaselineReadback(plan,await readPrivateReleaseArchive(archivePath,remote.files))};
  return {...result,...await verifyReleaseArchive({...plan,archiveFiles:remote.files},archivePath)};
}
async function save(path,value){await mkdir(dirname(resolve(path)),{recursive:true});await writeFile(path,json(value));}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {values,positionals}=parseArgs({allowPositionals:true,options:{revision:{type:'string'},branch:{type:'string'},target:{type:'string'},model:{type:'string'},checks:{type:'string'},verification:{type:'string'},remote:{type:'string'},plan:{type:'string'},response:{type:'string'},archive:{type:'string'},'archive-release':{type:'string'},'rebaseline-archive':{type:'string'},output:{type:'string'}}});
  try{
    let result;const mode=positionals[0];
    if(mode==='verify')result=await verifyReleaseChecks({revision:values.revision,modelPath:values.model,commands:await readJSON(values.checks)});
    else if(mode==='prepare')result=await preparePrivateRelease({revision:values.revision,modelPath:values.model,verification:await readJSON(values.verification),remote:await readJSON(values.remote),target:await readJSON(values.target),branch:values.branch,rebaselineArchive:values['rebaseline-archive'],archiveReleaseId:values['archive-release']});
    else if(mode==='uploaded'){
      result=recordPrivateUpload({plan:await readJSON(values.plan),response:await readJSON(values.response)});
      await save(result.archive.replace(/\.zip$/,'')+'.release.json',result);
    }
    else if(mode==='inspect'){
      const target=await readJSON(values.target);
      result=await inspectPrivateRelease({target,remote:await readJSON(values.remote),archivePath:values.archive,archiveReleaseId:values['archive-release']});
      await save(values.target,{...target,verifiedRelease:result});
    }
    else if(mode==='confirm'){
      result=await completePrivateRelease({plan:await readJSON(values.plan),remote:await readJSON(values.remote),archivePath:values.archive});
      check(values.target,'Local target settings are required to retain verified release identity');
      const target=await readJSON(values.target);check(target.pluginId===result.pluginId,'Target identity changed');
      await save(values.target,{...target,verifiedRelease:{releaseId:result.releaseId,contentSha256:result.contentSha256}});
    }
    else throw Error('Use verify, prepare, uploaded, inspect or confirm with explicit scoped inputs');
    if(values.output)await save(values.output,result);
    console.log(json(values.output?Object.fromEntries(['status','codeRevision','version','contentSha256','archiveBytes','checkedFiles'].filter(key=>result[key]!==undefined).map(key=>[key,result[key]])):result));
  }catch(error){
    if(positionals[0]==='verify'&&values.output)await save(values.output,{schema:'map-toolkit-verification',status:'failed',codeRevision:values.revision,checks:[{exitCode:1}],error:error.message});
    console.error(error);process.exitCode=1;
  }
}

export {verifyNativeSourceBaseline,verifyBaselinePackage} from "./private-release-baseline.mjs";
