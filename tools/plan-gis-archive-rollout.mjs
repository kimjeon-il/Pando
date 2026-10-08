#!/usr/bin/env node
// Stage 8 planning only. No writes to GitHub refs, GitHub Pages settings, or assets.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {audit,parseGitHubTree,groupOf} from './audit-legacy-gis-assets.mjs';
import {collectEvidence,assess} from './audit-legacy-release-consumers.mjs';

const WEB_REPOSITORY='kimjeon-il/Pando';
const APP_REPOSITORY='kimjeon-il/PandoEditor';
export const PAGES_PUBLISHED_SITE_LIMIT_BYTES=1000000000;
const fail=(condition,message)=>{if(!condition)throw Error(message);};
const gitSha=s=>typeof s==='string'&&/^[0-9a-f]{40}$/.test(s);
const dataPath=x=>'assets/data/'+x;
const unique=items=>[...new Set(items)];
const asObject=map=>Object.fromEntries(map);

function isGitTree(tree){
  return !!(tree&&tree.truncated===false&&Array.isArray(tree.tree));
}
export function normalizeGitTree(input){
  fail(isGitTree(input),'Full non-truncated Git tree required');
  const result=new Map();
  for(const item of input.tree){
    if(item.type!=='blob')continue;
    fail(typeof item.path==='string'&&gitSha(item.sha)&&Number.isSafeInteger(item.size)&&item.size>=0,
      'Invalid Git tree metadata: '+item.path);
    fail(!result.has(item.path),'Duplicate tracked Git path '+item.path);
    result.set(item.path,{sha:item.sha,bytes:item.size});
  }
  return result;
}
export function buildDeletionLock(stage6,stage8Tree){
  fail(stage6?.passed===true&&gitSha(stage6.gitHead),'Verified stage 6 input required');
  const rows=stage6.groups.filter(x=>x.classification==='archive-review-not-delete-ready');
  const groupMap=new Map(rows.map(x=>[x.group,x]));
  fail(groupMap.size===rows.length,'Duplicate archive candidate groups');
  const files=[],totals=new Map();
  for(const [path,entry] of stage8Tree){
    if(!path.startsWith('assets/data/'))continue;
    const name=path.slice('assets/data/'.length);
    const group=groupOf(name);
    if(!groupMap.has(group))continue;
    files.push({path,gitBlob:entry.sha,bytes:entry.bytes,group,
      restore:{repository:WEB_REPOSITORY,commit:stage6.gitHead,path}});
    const record=totals.get(group)||{files:0,bytes:0};
    record.files++;record.bytes+=entry.bytes;totals.set(group,record);
  }
  files.sort((a,b)=>a.path.localeCompare(b.path));
  const errors=[];
  for(const group of rows){
    const found=totals.get(group.group)||{files:0,bytes:0};
    if(found.files!==group.files||found.bytes!==group.bytes)
      errors.push('Archive lock differs from stage6 for '+group.group+
        ': '+found.files+' files, '+found.bytes+' bytes');
  }
  fail(!errors.length,errors.join('; '));
  return {schema:'pandolab-gis-archive-delete-lock',version:1,sourceCommit:stage6.gitHead,
    groups:rows.length,totalFiles:files.length,
    totalBytes:files.reduce((s,x)=>s+x.bytes,0),files};
}
export function compareWebBranches(lock,branches){
  fail(branches.length>0,'No Web branches');
  const paths=lock.files;
  const out=[];
  for(const b of branches){
    fail(typeof b.name==='string'&&gitSha(b.sha)&&b.tree instanceof Map,
      'Invalid pinned Web branch');
    let identical=0,absent=0,different=0;
    const mismatches=[];
    const groups=new Map();
    for(const f of paths){
      const blob=b.tree.get(f.path);
      if(!blob){absent++;continue;}
      if(blob.sha===f.gitBlob&&blob.bytes===f.bytes){identical++;
        const prior=groups.get(f.group)||{files:0,bytes:0};prior.files++;prior.bytes+=f.bytes;
        groups.set(f.group,prior);
      }else{different++;if(mismatches.length<30)
        mismatches.push({path:f.path,expected:f.gitBlob,actual:blob.sha,actualBytes:blob.bytes});}
    }
    out.push({branch:b.name,expectedHead:b.sha,identical,absent,different,
      candidatePathsForBranch:identical+different,
      mismatchSamples:mismatches,
      presentGroups:groups.size,
      // Future cleanup must explicitly use the recorded branch head as a lease.
      requireLease:true});
  }
  return out;
}
export function pagesSizeBudget(mainTree,siteSource){
  fail(mainTree instanceof Map,'Pinned Pages source tree required');
  const bytesWhere=pred=>[...mainTree].reduce((s,[path,m])=>s+(pred(path)?m.bytes:0),0);
  const dataBytes=bytesWhere(p=>p.startsWith('assets/data/'));
  const assetsBytes=bytesWhere(p=>p.startsWith('assets/'));
  const allTrackedBytes=bytesWhere(()=>true);
  return {source:siteSource,limitBytes:PAGES_PUBLISHED_SITE_LIMIT_BYTES,
    dataBytes,assetsBytes,allTrackedBytes,
    assetDataOnlyAlreadyOverLimit:dataBytes>PAGES_PUBLISHED_SITE_LIMIT_BYTES,
    lowerBoundOverageBytes:Math.max(0,dataBytes-PAGES_PUBLISHED_SITE_LIMIT_BYTES),
    marginToLimitBytes:PAGES_PUBLISHED_SITE_LIMIT_BYTES-dataBytes,
    caveat:'Tracked asset bytes are not a complete deployed-site inventory, but dataBytes alone is a valid size lower bound for a full-copy site'};
}
export function planRelease(stage6,stage7,lock,webBranches,budget,{appBranchHeads=[]}={}){
  fail(stage6?.passed===true&&stage7?.passed===true,'Verified stage 6/7 reports required');
  fail(lock?.totalFiles>0&&lock.totalBytes>0,'No immutable deletion lock');
  fail(stage7.candidateFiles===lock.totalFiles&&stage7.candidateBytes===lock.totalBytes,
    'Stage 7 release evidence and exact deletion manifest disagree');
  const branchNames=new Set(webBranches.map(b=>b.branch));
  const appNames=new Set(appBranchHeads.map(b=>b.name));
  const invalidBranchRows=webBranches.filter(b=>b.different>0||!gitSha(b.expectedHead));
  const pagesSource=budget.source;
  const blockers=[];
  if(pagesSource?.branch!=='main'||pagesSource?.path!=='/')
    blockers.push({code:'PAGES_SOURCE_UNEXPECTED',detail:'Current Pages source not verified as main /'});
  if(budget.assetDataOnlyAlreadyOverLimit)
    blockers.push({code:'PAGES_1GB_LIMIT',detail:'Full tracked assets/data payload already exceeds the published-site 1GB ceiling'});
  if(webBranches.length!==stage7.branchCoverage.web||branchNames.size!==webBranches.length)
    blockers.push({code:'WEB_BRANCH_COVERAGE',detail:'Web branch coverage mismatch'});
  if(appBranchHeads.length!==stage7.branchCoverage.app||appNames.size!==appBranchHeads.length)
    blockers.push({code:'APP_BRANCH_COVERAGE',detail:'App branch coverage mismatch'});
  if(invalidBranchRows.length)
    blockers.push({code:'CROSS_BRANCH_GIT_BLOB_DRIFT',detail:'At least one proposed deletion path has a different Git Blob on a Web branch'});
  if(stage7.deleteReadyFiles!==0)blockers.push({code:'STAGE7_UNEXPECTED_APPROVAL',detail:'Stage 7 unexpectedly indicates deletable paths'});
  if(stage7.appReleases?.count>0)
    blockers.push({code:'PAST_NATIVE_RELEASES_UNVERIFIED',detail:'Native release ZIP/EXE payloads not completely checked'});
  blockers.push({code:'FULL_URL_SHA_PARITY_MISSING',detail:'All archived public URLs and response bytes must be verified after a validated cutover'});
  blockers.push({code:'NO_POST_CUTOVER_DEPLOYMENT',detail:'Actions-source cutover has not been performed, nor post-cutover smoke-tested'});
  blockers.push({code:'EXPLICIT_DELETION_APPROVAL_REQUIRED',detail:'Deleting across branches needs a separate explicit approval and lease-locked commits'});
  const ordered=[
    {phase:1,title:'Freeze source evidence and release package',required:'Record exact source SHA, candidate file Blob SHA and all branch heads'},
    {phase:2,title:'Resolve Pages capacity and immutable origin routing',required:'Produce a supported <=1GB Pages artifact retaining every required old URL, or obtain an explicitly approved alternative URL contract'},
    {phase:3,title:'Build and test static deployment artifact off-line',required:'Validate runtime, all published URL paths, response bytes and manifest/source provenance'},
    {phase:4,title:'Switch Pages source and deploy with rollback prepared',required:'Use approved github-pages environment; verify old and current URLs after deployment; preserve pre-cutover release'},
    {phase:5,title:'Prepare all branch-specific deletion commits',required:'From pinned branch heads and exact path allowlist; reject drift and unrelated file changes; preserve native App payloads'},
    {phase:6,title:'Execute coordinated multi-branch cleanup',required:'Only after explicit approval, verify each ref lease, test branches, keep rollback SHA for every ref; no genuine cross-ref atomicity'},
    {phase:7,title:'Final public and native regression',required:'Reverify Pages binary URLs, Web rendering/cache, Qt/offline data and release provenance'}
  ];
  return {schema:'pandolab-gis-stage8-preflight',version:1,
    referenceWebCommit:lock.sourceCommit,
    stage6:{files:stage6.metadata.totalDataFiles,liveProtectedPaths:stage6.metadata.activeFileCount},
    stage7:{candidateGroups:stage7.candidateGroups,candidateFiles:stage7.candidateFiles,
      publicStates:stage7.states,appReleaseCount:stage7.appReleases?.count},
    pages:budget,branchInventory:{web:webBranches,app:appBranchHeads},
    lockedCandidateFiles:lock.totalFiles,lockedCandidateBytes:lock.totalBytes,
    blockers,phases:ordered,releasePreparationValid:!invalidBranchRows.length,
    eligibleForDeployment:false,eligibleForDeletion:false,
    allowAutomaticRefUpdates:false,requiresSignedOffPhasedRollout:true,
    note:'Read-only assessment. No Pages settings, source assets, branch refs or release artifacts changed.'};
}
async function api(url,token){
  const r=await fetch(url,{headers:{Authorization:'Bearer '+token,
    Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},
    signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('GitHub API '+r.status+': '+url);
  return await r.json();
}
async function loadTree(repo,sha,token){
  fail(gitSha(sha),'Full ref SHA required');
  const tree=await api('https://api.github.com/repos/'+repo+'/git/trees/'+sha+'?recursive=1',token);
  return normalizeGitTree(tree);
}
async function concurrent(items,worker,batch=5){
  const result=[];
  for(let i=0;i<items.length;i+=batch){
    result.push(...await Promise.all(items.slice(i,i+batch).map(worker)));
  }
  return result;
}
const uniqueItems=arr=>new Set(arr).size===arr.length;
async function discoverHeads(repo,token){
  const records=await api('https://api.github.com/repos/'+repo+'/branches?per_page=100',token);
  fail(Array.isArray(records)&&records.length>0&&records.length<100,'Branch list incomplete');
  const branch=records.map(x=>({name:x.name,sha:x.commit?.sha}));
  fail(uniqueItems(branch.map(x=>x.name))&&branch.every(x=>gitSha(x.sha)),'Missing or duplicated ref');
  return branch;
}
export async function generatePlan(root,{treeFile,appManifest,token}){
  fail(token&&token.length>10,'Read-only GitHub token required');
  const stage6=audit(root,{treeJson:treeFile,appManifest});
  fail(stage6.passed,'Stage 6 live-file check failed');
  const exactJson=JSON.parse(readFileSync(treeFile,'utf8'));
  const baseTree=normalizeGitTree(exactJson);
  const lock=buildDeletionLock(stage6,baseTree);
  const evidence=await collectEvidence(stage6,baseTree,token);
  const stage7=assess(stage6,evidence);
  fail(stage7.passed,'Stage 7 evidence incomplete');
  const [webHeads,appHeads]=await Promise.all([
    discoverHeads(WEB_REPOSITORY,token),discoverHeads(APP_REPOSITORY,token)
  ]);
  const webWithTrees=await concurrent(webHeads,async b=>({...b,tree:await loadTree(WEB_REPOSITORY,b.sha,token)}),4);
  const compared=compareWebBranches(lock,webWithTrees);
  const siteSource=evidence.pages?.source||null;
  fail(webHeads.some(b=>b.name==='main'),'No published main branch');
  const main=webWithTrees.find(b=>b.name==='main');
  const budget=pagesSizeBudget(main.tree,siteSource);
  const preflight=planRelease(stage6,stage7,lock,compared,budget,{appBranchHeads:appHeads});
  return {preflight,lock};
}
function opts(argv){
  const map=new Map();
  for(let i=0;i<argv.length;i+=2){
    const key=argv[i],value=argv[i+1];
    fail(['--root','--tree-json','--app-manifest','--out','--lock-out'].includes(key)&&
      value&&!value.startsWith('--')&&!map.has(key),'Unknown or invalid option '+key);
    map.set(key,value);
  }
  for(const key of ['--tree-json','--app-manifest','--out','--lock-out'])fail(map.has(key),'Missing '+key);
  return map;
}
function save(path,object){
  const target=resolve(path);mkdirSync(dirname(target),{recursive:true});
  writeFileSync(target,JSON.stringify(object,null,2)+'\n');
}
const invoked=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
  try{
    const args=opts(process.argv.slice(2));
    const {preflight,lock}=await generatePlan(resolve(args.get('--root')||'.'),
      {treeFile:resolve(args.get('--tree-json')),appManifest:resolve(args.get('--app-manifest')),
        token:process.env.GITHUB_TOKEN});
    save(args.get('--out'),preflight);save(args.get('--lock-out'),lock);
    console.log(JSON.stringify({stage8:'read-only-preflight',
      candidateGroups:lock.groups,candidateFiles:lock.totalFiles,candidateBytes:lock.totalBytes,
      pagesSource:preflight.pages.source,
      mainDataBytes:preflight.pages.dataBytes,overPages1GB:preflight.pages.assetDataOnlyAlreadyOverLimit,
      branches:{web:preflight.branchInventory.web.length,app:preflight.branchInventory.app.length},
      webRefsDrift:preflight.branchInventory.web.filter(b=>b.different>0).length,
      blockers:preflight.blockers.map(b=>b.code),
      eligibleForDeployment:false,eligibleForDeletion:false},null,2));
  }catch(error){
    console.error('Stage 8 preflight failed: '+error.stack);process.exitCode=1;
  }
}
