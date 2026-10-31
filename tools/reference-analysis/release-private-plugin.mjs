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
import {privatePluginEntries,privatePluginFingerprint,packagePrivatePlugin} from './package-private-plugin.mjs';
import {readPinnedSource,collectSourceFiles} from './runtime-assets.mjs';
import {frontendWasmRoot} from '../../scripts/lib/frontend-layout.mjs';
import {zipMembers,zipMemberChunks} from '../lib/geonames-zip.mjs';

const exec=promisify(execFile),root=fileURLToPath(new URL('../../',import.meta.url));
const hash=value=>createHash('sha256').update(value).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const readJSON=async path=>JSON.parse(await readFile(path,'utf8'));
const check=(condition,message)=>assert.ok(condition,message);
const owned=path=>path==='plugin.json'||path==='release.json'||path.startsWith('skills/pando-map-analysis/');
function safePath(path){check(typeof path==='string'&&!path.includes('\\')&&!isAbsolute(path)&&!path.split('/').some(part=>!part||part==='.'||part==='..'),'Invalid release file path');return path;}

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
  return {status:'verified',pluginId:plan.pluginId,releaseId:remote.plugin.current_release_id,version:plan.version,codeRevision:plan.codeRevision,contentSha256:plan.contentSha256};
}
export function recordPrivateUpload({plan,response}){
  check(!response?.isError&&response?.status==='updated','Successful upload response required; keep the prepared candidate on failure');
  check(response.plugin_id===plan.pluginId&&response.scope==='USER'&&response.discoverability==='PRIVATE','Uploaded plugin identity changed');
  check(response.current_release_id&&response.current_release_id!==plan.expectedReleaseId&&response.version===plan.version,'Uploaded release/version mismatch');
  return {...plan,status:'uploaded-unverified',uploadedReleaseId:response.current_release_id};
}

export async function assertPushedRevision(workspace,revision,{branch='work/ui'}={}){
  check(/^[a-f0-9]{40}$/.test(revision),'A full verified commit is required');
  check(['work/ui','work/gis'].includes(branch),'Explicit supported plugin source branch required');
  await exec('git',['merge-base','--is-ancestor',revision,'refs/remotes/origin/'+branch],{cwd:workspace});
}
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
    'docs/historical-border-reconstruction-policy.md',...commands.flatMap(row=>row.inputs||[])];
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
export async function preparePrivateRelease({revision,modelPath,verification,remote,target,workspace=root,branch}){
  const candidate=await candidateFor({revision,modelPath,workspace,branch});
  const plan=planPrivateRelease({target,remote,candidate,verification});if(['unchanged','verification-required'].includes(plan.status))return plan;
  if(remote.contents?.['release.json']){
    const previous=JSON.parse(remote.contents['release.json']);
    await assertReleaseAncestor(workspace,previous.codeRevision,revision);
  }
  const pendingPath=target.directory+'.release.json';
  if(existsSync(pendingPath)){
    const pending=await readJSON(pendingPath);
    check(pending.contentSha256===plan.contentSha256&&pending.expectedReleaseId===plan.expectedReleaseId
      &&pending.verificationSha256===plan.verificationSha256,'Pending release changed; reconcile the current release before retiring its scoped artifacts');
    check(hash(await readFile(pending.archive))===pending.archiveSha256,'Pending archive changed');
    return pending;
  }
  const legacyManifest=JSON.parse(remote.contents['.codex-plugin/plugin.json']||'null');
  check(legacyManifest?.name==='map-toolkit','Read the existing compatibility manifest before update');
  const result=await packagePrivatePlugin({revision,modelPath,workspace,directory:target.directory,version:plan.version,legacyManifest,release:{
    schema:'map-toolkit-release',codeRevision:revision,dataRevision:candidate.dataRevision,modelSha256:candidate.modelSha256,
    contentSha256:candidate.contentSha256,verificationSha256:plan.verificationSha256}});
  const manifests=Object.fromEntries(await Promise.all(['plugin.json','.codex-plugin/plugin.json'].map(async path=>[path,await readJSON(join(result.directory,path))])));
  const pending={...plan,manifests,files:result.files,archive:result.archive,archiveBytes:result.archiveBytes,archiveSha256:result.archiveSha256,
    upload:{plugin_id:plan.pluginId,expected_release_id:plan.expectedReleaseId,archive:result.archive,delete_paths:plan.deletePaths}};
  await save(pendingPath,pending);return pending;
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
async function archiveIndex(path){
  const members=await zipMembers(path),byName=new Map();
  for(const member of members){const name=member.name.endsWith('/')?member.name.slice(0,-1):member.name;safePath(name);check(!byName.has(name),'Duplicate remote archive path');byName.set(name,member);}
  const rootManifest=[...byName.keys()].filter(name=>name==='plugin.json'||name.endsWith('/plugin.json'));
  const prefix=byName.has('plugin.json')?'':rootManifest.filter(name=>name.split('/').length===2).map(name=>name.slice(0,-11))[0];
  check(prefix!==undefined,'Remote archive root manifest missing');
  return {byName,prefix};
}
async function isGzipArchive(path){
  const file=await open(path,'r');try{const magic=Buffer.alloc(2);await file.read(magic,0,2,0);return magic[0]===0x1f&&magic[1]===0x8b;}finally{await file.close();}
}
async function readTarFiles(path,inventory){
  // The host returns tar.gz even for a ZIP upload. Use the existing system tar
  // as a read-only decoder; -O never extracts paths into the filesystem.
  const listing=await exec('tar',['-tf',path],{encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});
  const names=listing.stdout.split(/\r?\n/).filter(Boolean),prefix=names.includes('plugin.json')?'':
    names.filter(name=>name.split('/').length===2&&name.endsWith('/plugin.json')).map(name=>name.slice(0,-11))[0];
  check(prefix!==undefined,'Account archive root manifest missing');
  const sizes=new Map(inventory.map(row=>[prefix+safePath(row.path),row.size_bytes])),seen=new Set(),selected=[];
  for(const name of names){
    safePath(name.endsWith('/')?name.slice(0,-1):name);
    check(!seen.has(name),'Duplicate account archive path');seen.add(name);
    if(sizes.has(name))selected.push(name);
  }
  for(const name of sizes.keys())check(seen.has(name),'Account archive file missing: '+name);
  let total=0;for(const bytes of sizes.values()){check(Number.isSafeInteger(bytes)&&bytes>=0&&bytes<=64*1024*1024,'Invalid account archive file size');total+=bytes;}
  check(total<=128*1024*1024,'Account archive exceeds bounded verification size');
  const {stdout}=await exec('tar',['-xOf',path,'--',...selected],{encoding:null,windowsHide:true,maxBuffer:total+1024*1024});
  check(stdout.length===total,'Account archive size mismatch');
  const result=new Map();let at=0;for(const name of selected){const bytes=sizes.get(name);result.set(name.slice(prefix.length),stdout.subarray(at,at+bytes));at+=bytes;}
  return result;
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
  return {...result,...await verifyReleaseArchive({...plan,archiveFiles:remote.files},archivePath)};
}
async function save(path,value){await mkdir(dirname(resolve(path)),{recursive:true});await writeFile(path,json(value));}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {values,positionals}=parseArgs({allowPositionals:true,options:{revision:{type:'string'},branch:{type:'string'},target:{type:'string'},model:{type:'string'},checks:{type:'string'},verification:{type:'string'},remote:{type:'string'},plan:{type:'string'},response:{type:'string'},archive:{type:'string'},'archive-release':{type:'string'},output:{type:'string'}}});
  try{
    let result;const mode=positionals[0];
    if(mode==='verify')result=await verifyReleaseChecks({revision:values.revision,modelPath:values.model,commands:await readJSON(values.checks)});
    else if(mode==='prepare')result=await preparePrivateRelease({revision:values.revision,modelPath:values.model,verification:await readJSON(values.verification),remote:await readJSON(values.remote),target:await readJSON(values.target),branch:values.branch});
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
