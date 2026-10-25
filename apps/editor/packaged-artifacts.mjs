import {buildNativeOnCI,inspectWindowsBinary} from './native-producer.mjs';
import { mkdir, readFile, stat, unlink, rm } from 'node:fs/promises';
import {openSync,closeSync,writeFileSync} from 'node:fs';
import {discardDeadLibraryLock} from '../../tools/library-data.mjs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { validateShellProfile } from './stage.mjs';
import { storageSettings,installNativeArtifactView } from '../../tools/worktree-storage.mjs';
import {containedPath,atomicStorageJSON,contentFiles} from '../../tools/library-content.mjs';
import {nativeInputIdentity,verifyNativeBundle} from './native-contract.mjs';

const shell = fileURLToPath(new URL('./', import.meta.url));
const exists = path => stat(path).then(() => true, () => false);
export function assertOrdinaryBuild(info) {
  if (typeof info.verification !== 'boolean') throw Error('Native build identity is missing; rebuild the ordinary offline app.');
  if (info.verification) throw Error('A verification binary cannot replace the ordinary offline app.');
  if (info.executionMode === 'development') throw Error('A development binary cannot replace the offline app.');
  if (info.profile !== 'map-data') throw Error('An ordinary offline artifact must use the map-data profile.');
}
export function assertVerificationBuild(info) {
  if (info.verification !== true) throw Error('This check requires an explicit verification build.');
}
export function selectNativeRun(runs,{head,workflowId,repository,title,artifactName,artifactsByRun}){
  return runs.find(run=>run.head_sha===head&&run.workflow_id===workflowId&&run.head_repository?.full_name===repository
    &&(run.display_title===title||(run.event==='push'&&run.status==='completed'&&artifactName&&artifactsByRun?.get(run.id)?.some(a=>a.name===artifactName&&!a.expired))))||null;
}
export async function fetchNativeArtifact({root=resolve(shell,'../..'),platform='windows',mode='development',testNative=false,pollMs=5000,timeoutMs=65*60*1000,github}={}){
  const identity=nativeInputIdentity(root,{platform,mode}),settings=storageSettings(root);
  if(!settings)throw Error('Application shared storage activation is required');
  const pin=JSON.parse(await readFile(resolve(root,'config/native-artifacts.json'),'utf8'));
  if(!/^[\w.-]+\/[\w.-]+$/.test(pin.repository)||pin.workflow!=='remote-development-p1.yml')throw Error('Invalid native build repository/workflow');
  const pointer=resolve(root,'.library-data/native-artifacts.json');
  if(!testNative&&await exists(pointer)){
    const binding=JSON.parse(await readFile(pointer,'utf8'))[platform+'-'+mode];
    if(binding?.nativeInputSha256===identity.sha256){const manifest=verifyNativeBundle(binding.directory,identity,pin);return{directory:binding.directory,manifest,cached:true};}
  }
  const sharedDirectory=containedPath(settings.cacheRoot,'native/'+identity.sha256);
  if(!testNative&&await exists(join(sharedDirectory,'native-artifact.json'))){
    const manifest=verifyNativeBundle(sharedDirectory,identity,pin);
    const directory=installNativeArtifactView({root,source:sharedDirectory,manifest,settings});return{directory,manifest,cached:true};
  }
  const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:16*1024**2}).trim();
  const owned=new Set([...Object.keys(identity.inputs),'apps/editor/native-contract.mjs','apps/editor/packaged-artifacts.mjs','apps/editor/package.json','.github/workflows/remote-development-p1.yml']);
  const dirty=[...git(['diff','--name-only','HEAD','-z']).split('\0'),...git(['ls-files','--others','--exclude-standard','-z']).split('\0')].filter(p=>owned.has(p));
  const committedLibrary=JSON.parse(git(['show','HEAD:config/library-data.json'])),localLibrary=JSON.parse(await readFile(resolve(root,'config/library-data.json'),'utf8'));
  if(dirty.length||committedLibrary.repository!==localLibrary.repository)throw Error('Commit and push native/build inputs before requesting CI: '+dirty.join(', '));
  const head=git(['rev-parse','HEAD']),branch=git(['branch','--show-current']);
  if(!/^(main|work\/[\w-]+)$/.test(branch)||git(['ls-remote','origin','refs/heads/'+branch]).split(/\s/)[0]!==head)throw Error('Current native source commit must exist on the matching remote branch');
  const gh=github||((args)=>execFileSync('gh',args,{encoding:'utf8',windowsHide:true,maxBuffer:16*1024**2,timeout:60000}));
  const api=endpoint=>{
    for(let attempt=0;;attempt++)try{return JSON.parse(gh(['api','--hostname','github.com','--method','GET',endpoint]));}
    catch(error){if(attempt>=2||!(['UNKNOWN','EAGAIN','ETIMEDOUT'].includes(error.code)||/HTTP (?:429|502|503)|connection.*reset/i.test(String(error.stderr||''))))throw error;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,100*(attempt+1));}
  };
  const workflow=api(`repos/${pin.repository}/actions/workflows/${pin.workflow}`),title=`Native ${testNative?'tests ':''}${platform} ${mode} ${head}`;
  let minimumId=0,minimumAttempt=0,artifact,retriedArtifact=false;
  const artifactName=`native-${platform}-${mode}-${head}`,artifactsByRun=new Map();
  const find=()=>{
    const runs=api(`repos/${pin.repository}/actions/workflows/${workflow.id}/runs?head_sha=${head}&per_page=30`).workflow_runs.filter(r=>r.id>=minimumId);
    if(!testNative&&mode==='development')for(const run of runs)if(run.event==='push'&&run.status==='completed'&&!artifactsByRun.has(run.id))artifactsByRun.set(run.id,api(`repos/${pin.repository}/actions/runs/${run.id}/artifacts?per_page=100`).artifacts);
    const expected={head,workflowId:workflow.id,repository:pin.repository,title,artifactName,artifactsByRun};
    return selectNativeRun(runs.filter(r=>r.event==='push'),expected)||selectNativeRun(runs.filter(r=>r.event!=='push'),expected);
  };
  let run=find();
  if(!run||run.status==='completed'&&run.conclusion!=='success'){
    if(testNative&&platform!=='windows')throw Error('Native unit tests run on Windows; Android runtime verification is a separate device workflow');
    minimumId=run?run.id+1:0;gh(['workflow','run',pin.workflow,'--repo',pin.repository,'--ref',branch,'-f','scope='+(testNative?'native-tests':'native'),'-f','native_platform='+platform,'-f','native_mode='+mode]);run=null;
  }
  const deadline=Date.now()+timeoutMs;let last='';
  while(Date.now()<deadline){
    run=find();if(run){const status=run.status+(run.conclusion?'/'+run.conclusion:'');if(status!==last){console.error('Native CI '+run.html_url+': '+status);last=status;}
      if(run.status==='completed'&&(run.run_attempt||1)>=minimumAttempt){
        if(run.event!=='push'&&run.conclusion!=='success')throw Error('Native CI failed: '+run.html_url);
        const name=artifactName,artifacts=artifactsByRun.get(run.id)||api(`repos/${pin.repository}/actions/runs/${run.id}/artifacts?per_page=100`).artifacts;
        artifact=artifacts.find(a=>a.name===name&&!a.expired);if(artifact)break;
        if(run.conclusion!=='success')throw Error('Native CI failed: '+run.html_url);
        if(retriedArtifact)throw Error('CI succeeded without its required native artifact: '+run.html_url);
        minimumAttempt=(run.run_attempt||1)+1;retriedArtifact=true;gh(['run','rerun',String(run.id),'--repo',pin.repository]);
      }
    }
    await new Promise(r=>setTimeout(r,pollMs));
  }
  if(!run||!artifact)throw Error('Native CI is still running; retry to resume the same request');
  const disk=await statfsForDownload(settings.cacheRoot),peak=artifact.size_in_bytes*3;
  if(peak>=1024**3&&disk<peak+5*1024**3)throw Error('Native artifact download requires peak plus 5GiB headroom');
  const download=containedPath(settings.cacheRoot,`native-downloads/${run.id}-${platform}-${mode}`),owner=download+'.owner.json';
  await mkdir(resolve(download,'..'),{recursive:true});
  const lock=owner+'.lock';containedPath(settings.cacheRoot,lock);discardDeadLibraryLock(lock);let fd;
  try{fd=openSync(lock,'wx');}catch(error){throw Error('Native download is leased by another process',{cause:error});}
  try{
    writeFileSync(fd,JSON.stringify({pid:process.pid,root}));
    let previous;
    if(await exists(owner)){
      previous=JSON.parse(await readFile(owner,'utf8'));if(previous.runId!==run.id||previous.repository!==pin.repository||previous.head!==head)throw Error('Pending native download belongs to another source');
    }else{if(await exists(download))throw Error('Unknown native download directory must be preserved');previous={runId:run.id,repository:pin.repository,head,phase:'downloading'};atomicStorageJSON(owner,previous);}
    let manifest;
    if(previous.phase==='verified')manifest=verifyNativeBundle(download,identity,pin);
    else if(previous.phase==='downloading'){
      // This phase owns only a disposable incomplete transfer, never an installed view.
      if(await exists(download)){contentFiles(download);await rm(download,{recursive:true});}
      await mkdir(download,{recursive:true});gh(['run','download',String(run.id),'--repo',pin.repository,'--name',artifactName,'--dir',download]);
      manifest=verifyNativeBundle(download,identity,pin);atomicStorageJSON(owner,{...previous,phase:'verified'});
    }else throw Error('Unknown native download phase must be preserved');
    if(manifest.sourceCommit!==head)throw Error('Downloaded artifact provenance differs from its trusted CI run');
    const directory=installNativeArtifactView({root,source:download,manifest,settings});
    verifyNativeBundle(directory,identity,pin);contentFiles(download);
    await rm(download,{recursive:true});await unlink(owner);
    return{directory,manifest:verifyNativeBundle(directory,identity,pin),runUrl:run.html_url,cached:false};
  }finally{closeSync(fd);await unlink(lock);}
}
async function statfsForDownload(path){const {statfs}=await import('node:fs/promises');const s=await statfs(path);return s.bavail*s.bsize;}


async function main() {
  const option=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);
  const inspect=option('verify-binary');
  if(inspect){assertVerificationBuild(inspectWindowsBinary(resolve(inspect)));return;}
  const mode=option('mode')||'development';
  validateShellProfile(process.env.PANDOLAB_SHELL_PROFILE||'map-data',mode==='verification');
  if(process.argv.includes('--ci-build')){
    console.log(JSON.stringify(await buildNativeOnCI({platform:option('platform'),mode,test:process.argv.includes('--test-native')})));return;
  }
  if(!process.argv.includes('--fetch'))throw Error('Use --fetch --platform=windows|android --mode=development|offline|verification. Native compilation is CI-only.');
  const result=await fetchNativeArtifact({platform:option('platform')||'windows',mode,testNative:process.argv.includes('--test-native')});
  console.log(process.argv.includes('--path-only')?result.directory:JSON.stringify(result));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
