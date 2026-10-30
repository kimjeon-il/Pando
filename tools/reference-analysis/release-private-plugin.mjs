// Codex completion boundary. Account operations stay in the authenticated host;
// this owner binds checked source, upload arguments and read-back evidence.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,lstat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,dirname,join,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify,parseArgs} from 'node:util';
import {privatePluginEntries,privatePluginFingerprint,packagePrivatePlugin} from './package-private-plugin.mjs';
import {readPinnedSource} from './runtime-assets.mjs';
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

export async function assertPushedRevision(workspace,revision){
  check(/^[a-f0-9]{40}$/.test(revision),'A full verified commit is required');
  await exec('git',['merge-base','--is-ancestor',revision,'origin/work/ui'],{cwd:workspace});
}
async function candidateFor({revision,modelPath,workspace=root,pushed=true}){
  if(pushed)await assertPushedRevision(workspace,revision);
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
  const {collectSourceFiles}=await import('./runtime-assets.mjs');
  const paths=[...await collectSourceFiles(workspace,{revision}),...commands.flatMap(row=>row.inputs||[])];
  const checks=await runVerifiedCommands({workspace,revision,paths,commands,run});
  const after=await candidateFor({revision,modelPath,workspace,pushed:false});check(after.contentSha256===candidate.contentSha256,'Inputs changed during verification');
  return {schema:'map-toolkit-verification',codeRevision:revision,contentSha256:candidate.contentSha256,checks};
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
export async function preparePrivateRelease({revision,modelPath,verification,remote,target,workspace=root}){
  const candidate=await candidateFor({revision,modelPath,workspace});
  const plan=planPrivateRelease({target,remote,candidate,verification});if(['unchanged','verification-required'].includes(plan.status))return plan;
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
export async function inspectPrivateRelease({target,remote,archivePath,archiveReleaseId}){
  checkIdentity(target,remote);check(archiveReleaseId===remote.plugin.current_release_id,'Download the exact current release before inspecting');
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
  return {...result,...await verifyReleaseArchive(plan,archivePath)};
}
async function save(path,value){await mkdir(dirname(resolve(path)),{recursive:true});await writeFile(path,json(value));}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {values,positionals}=parseArgs({allowPositionals:true,options:{revision:{type:'string'},target:{type:'string'},model:{type:'string'},checks:{type:'string'},verification:{type:'string'},remote:{type:'string'},plan:{type:'string'},response:{type:'string'},archive:{type:'string'},'archive-release':{type:'string'},output:{type:'string'}}});
  try{
    let result;const mode=positionals[0];
    if(mode==='verify')result=await verifyReleaseChecks({revision:values.revision,modelPath:values.model,commands:await readJSON(values.checks)});
    else if(mode==='prepare')result=await preparePrivateRelease({revision:values.revision,modelPath:values.model,verification:await readJSON(values.verification),remote:await readJSON(values.remote),target:await readJSON(values.target)});
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
    if(values.output)await save(values.output,result);console.log(json(result));
  }catch(error){console.error(error);process.exitCode=1;}
}
