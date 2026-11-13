#!/usr/bin/env node
/** Ephemeral Actions-only fixed-repository executor. --check is entirely offline. */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {fileURLToPath} from 'node:url';
import {inspectCanonicalInputs} from './lib/library-auto-inputs.mjs';
import {deriveAutomaticRuntime} from './lib/library-auto-runtime.mjs';
import {validateAutoPublicationReceipt,reconcileLibraryData} from './lib/library-auto-publication.mjs';
import {createGithubPages} from './lib/library-auto-github.mjs';
import {libraryCheckout,decodeArchiveEntry} from "../tools/data/library-context.mjs";
import {prepareLibraryData} from "../tools/data/library-runtime.mjs";
import {storeLibraryData} from "../tools/data/library-store.mjs";
import {RECEIPT_PATH,artifactGraph,ownsPath} from './lib/p2-artifact-graph.mjs';
const APP='kimjeon-il/Pando',DATA='kimjeon-il/PandoLab-library';
const CONFIG='config/library-data.json',FIXTURE='tests/fixtures/builtin-modern-interval-baseline.json';
const FAMILIES=Object.freeze(['territorial','current-world','world-mesh','world-country-packet','world-bundle','shared-boundaries','builtin-world','prepared-mesh']);
const SHA=/^(?!0{40}$)[a-f0-9]{40}$/;
const hash=b=>createHash('sha256').update(b).digest('hex');
function fail(code){throw Object.assign(Error(code),{code});}
function assertDedicatedJob(env,branch){
 if(env.GITHUB_ACTIONS!=='true')fail('GITHUB_ACTIONS_REQUIRED');
 if(env.GITHUB_REPOSITORY!==APP||env.GITHUB_JOB!=='sync'||env.GITHUB_WORKFLOW_REF!==`${APP}/.github/workflows/library-data-auto-sync.yml@refs/heads/${branch}`)fail('DEDICATED_JOB_REQUIRED');
}
export function parseAutomaticEnvironment(env){
 if(env.GITHUB_ACTIONS!=='true')fail('GITHUB_ACTIONS_REQUIRED');
 const branch=env.LIBRARY_AUTO_BRANCH,dataSha=env.LIBRARY_AUTO_DATA_SHA;
 if(!['main','work/gis'].includes(branch))fail('INVALID_DATA_BRANCH');
 if(!SHA.test(dataSha||''))fail('INVALID_DATA_SHA');
 const productionEnabled=env.LIBRARY_AUTO_PRODUCTION_ENABLED==='true';
 if(branch==='main'&&!productionEnabled)fail('MAIN_PRODUCTION_DISABLED');
 assertDedicatedJob(env,branch);
 if(!env.GITHUB_TOKEN||!env.PANDOLAB_LIBRARY_WRITE_TOKEN)fail('AUTH_MISSING');
 const requestedDataSha=env.GITHUB_EVENT_NAME==='push'?env.LIBRARY_AUTO_REQUEST_DATA_SHA:null;
 if(env.GITHUB_EVENT_NAME==='push'&&(branch!=='work/gis'||!SHA.test(requestedDataSha||'')||requestedDataSha!==dataSha))fail('INVALID_WORK_GIS_REQUEST');
 return {branch,dataSha,productionEnabled,requestedDataSha};
}
export function assertAppPaths(paths){if(paths.some(p=>![CONFIG,FIXTURE].includes(p)))fail('UNEXPECTED_APP_PATH');}
export function compareCandidateOutputs(expected,actual){
 const keys=o=>Object.keys(o).sort();
 if(JSON.stringify(keys(expected))!==JSON.stringify(keys(actual))||keys(expected).some(p=>expected[p]!==actual[p]))fail('CANDIDATE_OUTPUT_MISMATCH');
}
function defaultGit(root,args){try{return execFileSync('git',args,{cwd:root,env:{...process.env,GIT_NO_LAZY_FETCH:'1'},maxBuffer:64*1024*1024,stdio:['ignore','pipe','pipe']});}catch(error){error.autoOperation='git:'+args[0];throw error;}}
export function automaticFailureDetails(error,env=process.env){
 const redact=value=>{let s=String(value||'');for(const key of ['GITHUB_TOKEN','PANDOLAB_LIBRARY_WRITE_TOKEN'])if(env[key])s=s.split(env[key]).join('[REDACTED]');return s.replace(/https?:\/\/[^\s]+/g,'[URL]').slice(0,3000);};
 return {code:error.code||'AUTOMATIC_SYNC_FAILED',operation:error.autoOperation||'reconcile',phase:error.autoPhase||null,name:error.name||'Error',message:redact(error.message),stderr:redact(error.stderr),frames:String(error.stack||'').split('\n').slice(1).filter(s=>/\/(scripts|tools)\//.test(s)).slice(0,5).map(redact)};
}
function branchGuard(settings){return settings.branch==='main'&&!settings.productionEnabled;}
export function createAutomaticAdapters({root,env=process.env,settings,io={}}){
 if(env.GITHUB_ACTIONS!=='true')fail('GITHUB_ACTIONS_REQUIRED');
 if(branchGuard(settings))fail('MAIN_PRODUCTION_DISABLED');
 assertDedicatedJob(env,settings.branch);
 const git=(cwd,args)=>Buffer.from((io.git||defaultGit)(cwd,args));
 const text=(cwd,args)=>git(cwd,args).toString().trim();
 const dataRoot=(io.libraryCheckout||libraryCheckout)(root),branch=settings.branch;
 const origin=(cwd,repo)=>{const url=text(cwd,['remote','get-url','origin']);if(![`https://github.com/${repo}.git`,`https://github.com/${repo}`,`git@github.com:${repo}.git`].includes(url))fail('REMOTE_NOT_ALLOWLISTED');};
 const heads=()=>{origin(root,APP);origin(dataRoot,DATA);const result={};for(const [name,cwd] of [['app',root],['data',dataRoot]]){text(cwd,['fetch','--no-tags','origin',`refs/heads/${branch}`]);result[name]=text(cwd,['rev-parse','FETCH_HEAD']);if(!SHA.test(result[name]))fail('INVALID_REMOTE_HEAD');}return result;};
 const blob=(rev,p)=>git(dataRoot,['show',`${rev}:${p}`]);
 const json=(rev,p)=>JSON.parse(blob(rev,p));
 const config=appSha=>JSON.parse(git(root,['show',`${appSha}:${CONFIG}`]));
 const archive=rev=>json(rev,'archive/index.json');
 const archived=(rev,p)=>{const entry=archive(rev).files[p];if(!entry)fail('MISSING_ARCHIVED_FILE');return (io.decodeArchiveEntry||decodeArchiveEntry)(dataRoot,entry,rev,{fetch:false});};
 const github=io.github||createGithubPages({token:env.GITHUB_TOKEN,verifyLive:io.verifyLive});
 let prepared=null,derived=null,stored=null,latest=null;
 function generator(appSha){const files=text(root,['ls-tree','-r','--name-only',appSha,'--','tools','scripts/lib/library-auto-inputs.mjs','scripts/lib/library-auto-runtime.mjs','scripts/lib/p2-artifact-graph.mjs','config/generated-artifacts.json','config/toolchain-versions.json','src']);return hash(Buffer.concat(files.split('\n').filter(Boolean).sort().flatMap(p=>[Buffer.from(p+'\0'),git(root,['show',`${appSha}:${p}`]),Buffer.from('\0')])));}
 async function inspect(){
  const h=heads();latest=h;
  if(settings.requestedDataSha&&h.data!==settings.requestedDataSha&&h.data!==stored)fail('REQUEST_DATA_HEAD_MOVED');
  // Outdated source events are notifications, never overwrite the latest head.
  text(dataRoot,['merge-base','--is-ancestor',settings.dataSha,h.data]);
  if(text(root,['rev-parse','HEAD'])!==h.app||text(root,['branch','--show-current'])!==branch)fail('APP_CHECKOUT_NOT_CURRENT');
  const c=config(h.app);if(c.repository!==DATA||!SHA.test(c.revision))fail('INVALID_BASELINE_CONFIG');
  text(dataRoot,['merge-base','--is-ancestor',c.revision,h.data]);
  const id=generator(h.app),baseArchive=archive(c.revision),nextArchive=archive(h.data);
  const differences=Object.keys({...baseArchive.files,...nextArchive.files}).filter(p=>{const a=baseArchive.files[p],b=nextArchive.files[p];return !a||!b||a.sha256!==b.sha256||a.bytes!==b.bytes;});
  // Obtain source projection without granting trust to changed runtime files.
  // Runtime descriptors are temporarily replaced solely for source inspection;
  // all real differences below still require independent official output proof.
  const sourcePath=p=>p.startsWith('assets/data/territorial-entities/source/');
  const runtimeChanges=differences.filter(p=>!p.startsWith('reports/')&&!sourcePath(p));
  const masked={...nextArchive,files:{...nextArchive.files}};
  for(const p of runtimeChanges){if(baseArchive.files[p])masked.files[p]=baseArchive.files[p];else delete masked.files[p];}
  const changedPaths=git(dataRoot,['diff','--name-only','-z','--no-renames',c.revision,h.data,'--']).toString().split('\0').filter(Boolean);
  const projection=inspectCanonicalInputs({changedPaths,revision:h.data,baselineRevision:c.revision,readBlob:(rev,p)=>rev===h.data&&p==='archive/index.json'?Buffer.from(JSON.stringify(masked)):blob(rev,p)});
  let receipt=null;try{receipt=JSON.parse(archived(h.data,RECEIPT_PATH)).autoPublication;}catch(error){if(nextArchive.files[RECEIPT_PATH]&&error.code!=='ENOENT')throw error;}
  let completed=null;
  const token=JSON.stringify(h);
  const pinned=h.data===c.revision;
  if(receipt){
   if(receipt.inputFingerprint!==projection.inputFingerprint||receipt.generatorIdentity!==id){if(runtimeChanges.length)fail('STALE_RUNTIME_RECEIPT');receipt=null;}
   else await validateAutoPublicationReceipt(receipt,{inputFingerprint:projection.inputFingerprint,generatorIdentity:id,readOutput:p=>archived(h.data,p)});
  }
  if(projection.noop&&runtimeChanges.length===0&&!receipt)return {unchanged:true,token};
  if(projection.noop&&runtimeChanges.length===0&&receipt){
   const baselineReceipt=JSON.parse(archived(c.revision,RECEIPT_PATH)).autoPublication;
   await validateAutoPublicationReceipt(baselineReceipt,{inputFingerprint:projection.inputFingerprint,generatorIdentity:id,readOutput:p=>archived(c.revision,p)});
   completed={inputFingerprint:projection.inputFingerprint,generatorIdentity:id,dataSha:c.revision};
  }
  if(pinned&&receipt)completed={inputFingerprint:receipt.inputFingerprint,generatorIdentity:receipt.generatorIdentity,dataSha:h.data};
  if(!pinned&&receipt&&derived?.candidate===h.data){completed={inputFingerprint:projection.inputFingerprint,generatorIdentity:id,dataSha:h.data};}
  if(stored===h.data)completed={inputFingerprint:projection.inputFingerprint,generatorIdentity:id,dataSha:h.data};
  prepared={h,c,id,projection,changedPaths,runtimeChanges,nextArchive,receipt,token};
  let run=null;
  if(completed&&c.revision===completed.dataSha){
   if(branch==='main'){const evidence=await github.verify(h.app,{dataSha:completed.dataSha});if(evidence.run)run={dataSha:completed.dataSha,appSha:h.app,status:evidence.status,target:'production'};}
   else run={dataSha:completed.dataSha,appSha:h.app,status:'verified',target:'preview'};
  }
  return {desired:{dataRepository:DATA,dataBranch:branch,dataSha:h.data,appRepository:APP,appBranch:branch,appSha:h.app,production:branch==='main',inputFingerprint:projection.inputFingerprint,generatorIdentity:id,supported:true},completed,available:{pinnedDataSha:c.revision,run},token};
 }
 async function assertCurrent(token){if(JSON.stringify(heads())!==token)fail('HEAD_MOVED');}
 async function deriveAndStore(plan,token){
  await assertCurrent(token);const p=prepared;
  const regenerationOnly=p.projection.noop;
  if(regenerationOnly&&!p.receipt)fail('UNSUPPORTED_RUNTIME_EDITS');
  const runtimeProjection=regenerationOnly?{...p.projection,requiredFamilies:[...FAMILIES]}:p.projection;
  if(text(root,['status','--porcelain=v1','--untracked-files=all']))fail('DIRTY_APP_CHECKOUT');
  if(text(dataRoot,['status','--porcelain=v1','--untracked-files=all']))fail('DIRTY_DATA_CHECKOUT');
  if(text(dataRoot,['branch','--show-current'])!==branch)fail('DATA_BRANCH_MISMATCH');
  text(dataRoot,['merge-base','--is-ancestor','HEAD',p.h.data]);
  text(dataRoot,['merge','--ff-only',p.h.data]);
  (io.prepareLibraryData||prepareLibraryData)({root,fetch:false,purpose:'viewer-legacy'});
  const result=await (io.deriveAutomaticRuntime||deriveAutomaticRuntime)({root,inputProjection:runtimeProjection,regenerationOnly,inputDataSha:p.h.data,expectedAppSha:p.h.app,expectedDataSha:p.c.revision,branch,generatorIdentity:p.id,stageDir:'build-native/p2/automatic'});
  await assertCurrent(token);
  derived={candidate:p.h.data,result,fixtureHash:hash(readFileSync(resolve(root,FIXTURE)))};
  if(p.runtimeChanges.length){
   if(!p.receipt)fail('UNVERIFIED_RUNTIME_EDITS');
   // Compare exact full expected output inventory, not only candidate-listed hashes.
   const graph=(io.artifactGraph||artifactGraph)(root).filter(f=>result.autoReceipt.families.includes(f.id));
   const actual={};for(const path of Object.keys(p.nextArchive.files).filter(path=>path!==RECEIPT_PATH&&graph.some(f=>ownsPath(f,path))))actual[path]=hash(archived(p.h.data,path));
   compareCandidateOutputs(result.autoReceipt.outputs,actual);
   const allowed=new Set([...Object.keys(result.autoReceipt.outputs),...result.changedPaths,RECEIPT_PATH]);
   if(p.runtimeChanges.some(path=>!allowed.has(path)))fail('UNKNOWN_RUNTIME_EDIT');
   // Confirm canonical inspection against real descriptors after proof.
   inspectCanonicalInputs({changedPaths:p.changedPaths,revision:p.h.data,baselineRevision:p.c.revision,readBlob:blob,verifiedGeneratedPaths:p.runtimeChanges});
   return;
  }
  const removed=result.changedPaths.filter(path=>path!==FIXTURE&&!result.sourcePaths.includes(path)&&path!==RECEIPT_PATH&&!Object.hasOwn(result.autoReceipt.outputs,path));
  const prefixes=[...new Set([...Object.keys(result.autoReceipt.outputs),...result.sourcePaths,...removed,RECEIPT_PATH])];
  console.log(JSON.stringify({phase:'store-start',inputDataSha:p.h.data}));
  stored=(io.storeLibraryData||storeLibraryData)({root,push:true,prefixes,removePaths:removed,expectedRevision:p.h.data,expectedBranch:branch});
  console.log(JSON.stringify({phase:'store-complete',dataSha:stored}));
  const after=heads();if(after.app!==p.h.app||after.data!==stored)fail('HEAD_MOVED');
 }
 async function connect(plan,token){
  await assertCurrent(token);const p=prepared;
  const target=plan.expected.outputDataSha;
  if(!SHA.test(target||''))fail('INVALID_CONNECT_REVISION');
  // Read published pin from Git HEAD, never the owner-modified working config.
  const c=config(p.h.app);
  if(!derived||![stored,derived.candidate].includes(target)||hash(readFileSync(resolve(root,FIXTURE)))!==derived.fixtureHash)fail('UNVERIFIED_APP_FIXTURE');
  const working=JSON.parse(readFileSync(resolve(root,CONFIG)));
  if(![c.revision,target].includes(working.revision))fail('WORKING_PIN_CHANGED');
  working.revision=c.revision;if(!isDeepStrictEqual(working,c))fail('WORKING_CONFIG_CHANGED');
  c.revision=target;
  writeFileSync(resolve(root,CONFIG),JSON.stringify(c,null,2)+'\n');
  const dirty=text(root,['diff','--name-only']).split('\n').filter(Boolean);assertAppPaths(dirty);
  const staged=text(root,['diff','--cached','--name-only']).split('\n').filter(Boolean);if(staged.length)fail('PREEXISTING_INDEX_CHANGES');
  text(root,['add','--',CONFIG,FIXTURE]);
  assertAppPaths(text(root,['diff','--cached','--name-only']).split('\n').filter(Boolean));
  await assertCurrent(token);
  text(root,['-c','user.name=Pando automatic data publisher','-c','user.email=library-publisher@users.noreply.github.com','commit','-m',`Connect complete library data ${target}`]);
  text(root,['push','origin',`HEAD:refs/heads/${branch}`]);
  const h=heads();if(h.app!==text(root,['rev-parse','HEAD'])||h.data!==target)fail('HEAD_MOVED');
 }
 const traced=(phase,fn)=>async(...args)=>{try{return await fn(...args);}catch(error){error.autoPhase=phase;(io.reportFailure||console.error)(JSON.stringify(automaticFailureDetails(error,env)));throw error;}};
 return {inspect:traced('inspect',inspect),assertCurrent,deriveAndStore:traced('deriveAndStore',deriveAndStore),connect:traced('connect',connect),deploy:async(plan,token)=>{await assertCurrent(token);return github.dispatch(plan.expected.appSha,{productionEnabled:settings.productionEnabled,branch});},verify:async plan=>branch==='main'?github.verify(plan.expected.appSha,{dataSha:plan.expected.outputDataSha}):{status:'verified'},get latest(){return latest;}};
}
export async function runAutomaticSync({root=resolve(fileURLToPath(new URL('../',import.meta.url))),env=process.env,check=false,io={}}={}){
 if(check){const policy=JSON.parse(readFileSync(resolve(root,'docs/policies/library-publication.json'),'utf8'));if(Object.keys(policy).length!==1||typeof policy.productionEnabled!=='boolean')fail('INVALID_AUTOMATIC_POLICY');return {status:'checked',productionEnabled:policy.productionEnabled};}
 if(env.GITHUB_ACTIONS!=='true')fail('GITHUB_ACTIONS_REQUIRED');
 const policy=JSON.parse(Buffer.from((io.git||defaultGit)(root,['show','HEAD:docs/policies/library-publication.json'])).toString());
 if(Object.keys(policy).length!==1||typeof policy.productionEnabled!=='boolean')fail('INVALID_AUTOMATIC_POLICY');
 const settings=parseAutomaticEnvironment({...env,LIBRARY_AUTO_PRODUCTION_ENABLED:policy.productionEnabled===true?env.LIBRARY_AUTO_PRODUCTION_ENABLED:'false'});
 const adapters=createAutomaticAdapters({root,env,settings,io});
 const initial=await adapters.inspect();if(initial.unchanged)return {status:'unchanged'};
 const request=Object.fromEntries(['dataRepository','dataBranch','dataSha','appRepository','appBranch','appSha','production'].map(k=>[k,initial.desired[k]]));
 return reconcileLibraryData({request,policy:{productionEnabled:settings.productionEnabled},adapters});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);if(args.some(x=>x!=='--check')){console.error('Unsupported arguments');process.exitCode=2;}else runAutomaticSync({check:args.includes('--check')}).then(result=>{console.log(JSON.stringify(result));if(['incomplete','blocked'].includes(result.status))process.exitCode=1;}).catch(error=>{console.error(JSON.stringify(automaticFailureDetails(error)));process.exitCode=1;});
}

