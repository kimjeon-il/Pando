#!/usr/bin/env node
// Stage 10: immutable source-ref, main-promotion, and multi-branch removal dry-run.
// Only authenticated GitHub GETs. Absolutely no git ref updates, deletes, merges or deploys.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizeGitTree} from './plan-gis-archive-rollout.mjs';

const WEB='kimjeon-il/Pando',APP='kimjeon-il/PandoEditor';
const sha40=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const check=(c,msg)=>{if(!c)throw Error(msg);};
const WEB_ALLOW=[
  /^assets\/data\/world\/(?:current\.json|build-input\.json|objects\/[^/]+)$/,
  /^assets\/js\/bootstrap\.js$/,
  /^assets\/js\/modules\/(?:app-environment|app-service-assembly|gpu-map-renderer|stored-asset-loader|world-bundle-manifest)\.js$/,
  /^assets\/js\/workers\/data-loader-worker\.js$/,
  /^scripts\/(?:generate-build-metadata|check-version)\.mjs$/,
  /^tools\/build-(?:world-bundle|world-preview|world-mesh|country-shared-boundaries)\.mjs$/,
  /^tests\/unit\/world-bundle-(?:runtime|versioning)\.test\.mjs$/,
  /^\.github\/workflows\/world-dataset-stage3-gate\.yml$/
];
const APP_ALLOW=[
  /^app\/(?:CMakeLists\.txt|editorcontroller\.cpp|physicaldatastore\.cpp|worlddataset\.(?:cpp|h))$/,
  /^assets\/world\/(?:manifest\.json|NOTICE\.md)$/,
  /^tools\/(?:lib\/world-dataset-contract|sync-world-data|verify-world-assets|verify-release-assets|world-dataset-stage4\.test|compare-territorial-library|territorial-library-crosscheck\.test)\.mjs$/,
  /^tests\/(?:physical_data_store_tests|country_label_anchor_tests)\.cpp$/,
  /^\.github\/workflows\/world-dataset-stage[45]-gate\.yml$/
];

function outcome(base,main,gis) {
  if(main===gis)return 'identical-already';
  if(base===gis)return 'main-only-change';
  if(main!==base)return 'manual-three-way-reconciliation';
  if(gis===null)return 'deletion-not-authorized';
  return 'candidate-for-selective-review';
}
export function evaluatePromotion({base,main,gis,repo}){
  check([WEB,APP].includes(repo),'Unknown promotion repo');
  const allow=repo===WEB?WEB_ALLOW:APP_ALLOW;
  const paths=[...new Set([...base.keys(),...main.keys(),...gis.keys()])].sort();
  const included=[],excluded=[],divergent=[];
  let changed=0;
  for(const path of paths){
    const old=base.get(path)?.sha||null,live=main.get(path)?.sha||null,source=gis.get(path)?.sha||null;
    if(live===source)continue;
    changed++;
    const status=outcome(old,live,source);
    const row={path,baseBlob:old,mainBlob:live,gisBlob:source,status,
      explicitReviewNeeded:true};
    if(live!==old&&source!==old)divergent.push(row);
    if(allow.some(rx=>rx.test(path))&&source!==old){
      included.push(row);
    }else if(excluded.length<90){
      excluded.push({path,reason:'unrelated-to-data-versioning-release',status});
    }
  }
  return {repo,sourceOnlyScope:'explicit-allowlist',
    changedPathCount:changed,selectedCount:included.length,selected:included,
    divergentCount:divergent.length,divergent,
    outOfScopeChangedCount:changed-included.length,
    outOfScopeSample:excluded,
    reviewRequired:included.length>0,
    automaticWholeBranchMergeAllowed:false,automaticCherryPickAllowed:false};
}
export function planWebDeletes(lock,branches){
  check(lock?.schema==='pandolab-gis-archive-delete-lock'&&Array.isArray(lock.files)&&
    lock.totalFiles===2124&&lock.totalBytes===564189000,'Exact Stage8 deletion lock required');
  check(Array.isArray(branches)&&branches.length>=2,'Missing Web branch snapshots');
  const names=new Set(),plans=[];
  for(const b of branches){
    check(typeof b.name==='string'&&sha40(b.head)&&b.tree instanceof Map,
      'Incomplete Web branch pinned snapshot');
    check(!names.has(b.name),'Duplicate branch '+b.name);names.add(b.name);
    const removes=[],divergent=[];
    let missing=0;
    for(const f of lock.files){
      const got=b.tree.get(f.path);
      if(!got){missing++;continue;}
      if(got.sha!==f.gitBlob||got.bytes!==f.bytes){
        divergent.push({path:f.path,expectedBlob:f.gitBlob,actualBlob:got.sha,
          expectedBytes:f.bytes,actualBytes:got.bytes});
        continue;
      }
      removes.push({path:f.path,gitBlob:f.gitBlob,bytes:f.bytes});
    }
    plans.push({branch:b.name,expectedHead:b.head,
      rollbackRef:b.head,exactMatchedFiles:removes.length,
      alreadyAbsentFiles:missing,divergentFiles:divergent.length,
      totalMatchedBytes:removes.reduce((s,x)=>s+x.bytes,0),
      wouldRemove:removes,
      divergedExamples:divergent.slice(0,20),
      permittedNow:false,requiresPostDeployFullURLVerification:true,
      requiresHeadLease:true});
  }
  check(names.has('main')&&names.has('work/gis'),'Missing main or GIS branch');
  return {schema:'pandolab-branch-cleanup-dryrun',version:1,
    baselineSourceCommit:lock.sourceCommit,
    candidateFiles:lock.totalFiles,candidateBytes:lock.totalBytes,
    totalBranches:plans.length,
    anyBlobDrift:plans.some(p=>p.divergentFiles>0),
    branches:plans,executed:false,destructiveOperations:0,
    gitRefTransactionAtomic:false};
}
export function judgeReadiness(stage9,promotions,cleanup,appBranches){
  check(stage9?.schema==='pandolab-stage9-pages-footprint'&&
    stage9.siteLimitBytes===1000000000,'Stage9 full URL and size audit required');
  check(cleanup?.schema==='pandolab-branch-cleanup-dryrun','Missing immutable dry run');
  const blockers=[];
  if(stage9.profiles.some(p=>p.overByBytes>0))
    blockers.push({code:'SITE_OVER_1GB',profiles:stage9.profiles.map(p=>({
      name:p.name,overByBytes:p.overByBytes}))});
  if(cleanup.anyBlobDrift)blockers.push({code:'BRANCH_ARCHIVE_DRIFT'});
  if(cleanup.totalBranches!==7)blockers.push({code:'WEB_BRANCH_SET_CHANGED',
    expected:7,actual:cleanup.totalBranches});
  if(appBranches.length!==5)blockers.push({code:'APP_BRANCH_SET_CHANGED',actual:appBranches.length});
  for(const p of promotions)if(p.divergentCount)
    blockers.push({code:p.repo===APP?'APP_THREE_WAY_CONFLICTS':'WEB_THREE_WAY_CONFLICTS',
      count:p.divergentCount,paths:p.divergent.map(x=>x.path)});
  if(promotions.some(p=>p.selected.length===0))
    blockers.push({code:'MISSING_SELECTIVE_PROMOTION_SCOPE'});
  blockers.push({code:'UNVERIFIED_URL_BODY_PARITY',
    description:'Full public asset URL body SHA-256 parity before and after migration is outstanding'});
  blockers.push({code:'PAGES_SOURCE_STILL_BRANCH',
    description:'Pages deployment source remains main /; Actions deployment/rollback not configured'});
  blockers.push({code:'QT_REGRESSION_OPEN',
    description:'Stage 5 app Qt controller integration contains four unresolved failed tests'});
  blockers.push({code:'APP_RELEASE_ARTIFACTS_UNREVIEWED',
    description:'23 historical native release artifacts not fully inspected'});
  blockers.push({code:'EXPLICIT_RELEASE_APPROVAL_PENDING'});
  return {schema:'pandolab-integrated-release-readiness',version:1,
    stage9Sites:stage9.profiles,webBranchCount:cleanup.totalBranches,appBranchCount:appBranches.length,
    promotionScopes:promotions.map(p=>({repo:p.repo,selectedCount:p.selectedCount,
      excludedCount:p.outOfScopeChangedCount,manualConcurrentEdits:p.divergentCount,
      wholeBranchMergeAllowed:false})),
    historicalAssets:cleanup.candidateFiles,
    blocked:!!blockers.length,blockers,
    approvedForPagesTransition:false,approvedForDelete:false,approvedForMainMerge:false,
    completionState:'PREPARED_NOT_ACTIVATED',
    stepOrder:['Select and review only version-management paths for main',
      'Resolve app 3-way conflicts, native Qt regressions and historical release dependencies',
      'Produce approved <=1GB site without removing live functions or old asset URLs',
      'Build a verified immutable archive artifact; compare full URL path and response body SHA-256',
      'Approve GitHub Pages source/Actions cutover with recovery rehearsal',
      'Move Web refs separately using expected-head leases; never assume cross-branch atomicity',
      'Reverify old public URLs and Web/App native offline behavior']};
}
async function getJson(url,token){
  const r=await fetch(url,{headers:{Authorization:'Bearer '+token,
    Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},
    signal:AbortSignal.timeout(25000)});
  check(r.ok,'GET failed '+r.status+' '+url);
  return r.json();
}
const api=(repo,suffix)=>'https://api.github.com/repos/'+repo+'/'+suffix;
async function listHeads(repo,token){
  const rows=await getJson(api(repo,'branches?per_page=100'),token);
  check(Array.isArray(rows)&&rows.length>0&&rows.length<100,'Branch pagination incomplete '+repo);
  return rows.map(b=>{check(sha40(b.commit?.sha),'Missing branch sha: '+b.name);
    return{name:b.name,head:b.commit.sha};});
}
async function getTrees(repo,items,token){
  const results=[];
  for(let i=0;i<items.length;i+=4){
    const batch=await Promise.all(items.slice(i,i+4).map(async b=>({...b,
      tree:normalizeGitTree(await getJson(api(repo,'git/trees/'+b.head+'?recursive=1'),token))})));
    results.push(...batch);
  }
  return results;
}
async function getMergeBase(repo,mainSha,gisSha,token){
  const compare=await getJson(api(repo,'compare/'+mainSha+'...'+gisSha),token);
  const base=compare.merge_base_commit?.sha;
  check(sha40(base),'No deterministic Git merge-base');
  return{base,behind:compare.behind_by,ahead:compare.ahead_by};
}
function save(path,value){
  const file=resolve(path);mkdirSync(dirname(file),{recursive:true});
  writeFileSync(file,JSON.stringify(value,null,2)+'\n');
}
function opts(argv){
  const expected=new Set(['--stage9','--lock','--out','--promotions-out','--deletions-out']);
  const result=new Map();
  for(let i=0;i<argv.length;i+=2){
    check(expected.has(argv[i])&&argv[i+1]&&!argv[i+1].startsWith('--')&&
      !result.has(argv[i]),'Bad argument '+argv[i]);
    result.set(argv[i],argv[i+1]);
  }
  for(const k of expected)check(result.has(k),'Missing '+k);
  return result;
}
const invoked=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
  try{
    const args=opts(process.argv.slice(2)),token=process.env.GITHUB_TOKEN;
    check(token?.length>10,'Read-only GitHub token required');
    const stage9=JSON.parse(readFileSync(resolve(args.get('--stage9')),'utf8'));
    const lock=JSON.parse(readFileSync(resolve(args.get('--lock')),'utf8'));
    const [webHeads,appHeads]=await Promise.all([listHeads(WEB,token),listHeads(APP,token)]);
    const [webTrees,appTrees]=await Promise.all([getTrees(WEB,webHeads,token),getTrees(APP,appHeads,token)]);
    const branch=(rows,name)=>{const item=rows.find(x=>x.name===name);
      check(!!item,'Missing release branch '+name);return item;};
    const [webMerge,appMerge]=await Promise.all([
      getMergeBase(WEB,branch(webTrees,'main').head,branch(webTrees,'work/gis').head,token),
      getMergeBase(APP,branch(appTrees,'main').head,branch(appTrees,'work/gis').head,token)]);
    const [webBase,appBase]=await Promise.all([
      getJson(api(WEB,'git/trees/'+webMerge.base+'?recursive=1'),token),
      getJson(api(APP,'git/trees/'+appMerge.base+'?recursive=1'),token)]);
    const scopes=[
      evaluatePromotion({repo:WEB,base:normalizeGitTree(webBase),
        main:branch(webTrees,'main').tree,gis:branch(webTrees,'work/gis').tree}),
      evaluatePromotion({repo:APP,base:normalizeGitTree(appBase),
        main:branch(appTrees,'main').tree,gis:branch(appTrees,'work/gis').tree})
    ];
    const dryrun=planWebDeletes(lock,webTrees);
    const readiness=judgeReadiness(stage9,scopes,dryrun,appTrees);
    save(args.get('--out'),{...readiness,sourceHeads:{
      web:webHeads,app:appHeads},mergeBases:{web:webMerge,app:appMerge}});
    save(args.get('--promotions-out'),scopes);
    save(args.get('--deletions-out'),dryrun);
    console.log(JSON.stringify({valid:true,status:readiness.completionState,
      branchCounts:{web:webTrees.length,app:appTrees.length},
      mainPromotions:readiness.promotionScopes,
      historicalAssets:dryrun.candidateFiles,
      deleteDriftBranches:dryrun.branches.filter(x=>x.divergentFiles>0).map(x=>x.branch),
      sourceHeads:{web:branch(webTrees,'work/gis').head,app:branch(appTrees,'work/gis').head},
      blockerCodes:readiness.blockers.map(x=>x.code),
      actualPublish:false,actualDelete:false,actualMerge:false},null,2));
  }catch(error){
    console.error('Integrated release transaction preparation failed: '+error.stack);
    process.exitCode=1;
  }
}
