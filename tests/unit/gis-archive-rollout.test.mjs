import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeGitTree,buildDeletionLock,compareWebBranches,pagesSizeBudget,planRelease,
  PAGES_PUBLISHED_SITE_LIMIT_BYTES} from '../../tools/plan-gis-archive-rollout.mjs';

const sha=n=>String(n).repeat(40).slice(0,40);
const trees=(...parts)=>new Map(parts.map(([path,bytes,s])=>[path,{bytes,sha:s}]));
const asGitTree=arr=>({truncated:false,tree:arr.map(([path,size,id])=>({
  path,size,sha:id,type:'blob',mode:'100644'}))});
const candidate=(name,files,bytes)=>({group:name,classification:'archive-review-not-delete-ready',
  files,bytes});
const fixture=()=>{
  const s={passed:true,gitHead:sha(1),metadata:{totalDataFiles:100,activeFileCount:30},
    groups:[candidate('terrain/v0.12.0',2,105),candidate('hydro/v0.12.2',1,50),
      {group:'terrain/v0.12.6',classification:'retain-active-or-native',files:1,bytes:400}]};
  const t=trees(
    ['assets/data/terrain/v0.12.0/manifest.json',5,sha(2)],
    ['assets/data/terrain/v0.12.0/0/0-0.webp',100,sha(3)],
    ['assets/data/hydro/v0.12.2/manifest.json',50,sha(4)],
    ['assets/data/terrain/v0.12.6/manifest.json',400,sha(5)]);
  const lock=buildDeletionLock(s,t);
  const stage7={passed:true,candidateFiles:3,candidateBytes:155,candidateGroups:2,
    branchCoverage:{web:2,app:1},deleteReadyFiles:0,appReleases:{count:2},
    states:{'retain-public-asset-url':{groups:2,files:3,bytes:155}}};
  const mainTree=trees(...[...t].map(([p,m])=>[p,m.bytes,m.sha]));
  const web=[{name:'main',sha:sha(6),tree:mainTree},
    {name:'work/gis',sha:sha(7),tree:t}];
  const appHeads=[{name:'main',sha:sha(8)}];
  return {s,t,lock,stage7,web,appHeads};
};
test('truncated branch trees are rejected; binary bytes never need checkout',()=>{
  const valid=asGitTree([['assets/data/hydro/v0.12.2/manifest.json',10,sha(9)]]);
  assert.equal(normalizeGitTree(valid).size,1);
  assert.throws(()=>normalizeGitTree({...valid,truncated:true}),/non-truncated/);
  assert.throws(()=>normalizeGitTree(asGitTree([['x',4,'badsha']])),/Invalid Git tree/);
});
test('lock contains only stage6 archive candidates and exact immutable restore references',()=>{
  const {s,t}=fixture();
  const lock=buildDeletionLock(s,t);
  assert.equal(lock.groups,2);assert.equal(lock.totalFiles,3);assert.equal(lock.totalBytes,155);
  assert.ok(lock.files.every(x=>x.restore.commit===s.gitHead));
  assert.equal(lock.files.some(x=>x.path.endsWith('v0.12.6/manifest.json')),false);
  assert.ok(lock.files.every(x=>x.gitBlob.length===40));
});
test('tampered candidate total is never silently accepted',()=>{
  const {s,t}=fixture();
  s.groups[0].bytes++;
  assert.throws(()=>buildDeletionLock(s,t),/differs from stage6/);
});
test('a different Git Blob on one branch blocks whole cleanup wave',()=>{
  const {lock,web}=fixture();
  web[0].tree.set('assets/data/hydro/v0.12.2/manifest.json',{sha:sha(9),bytes:50});
  const result=compareWebBranches(lock,web);
  assert.equal(result[0].different,1);
  assert.equal(result[1].different,0);
  assert.equal(result[0].requireLease,true);
});
test('untracked candidate on a branch is reported absent, not proposed as a deletion',()=>{
  const {lock,web}=fixture();
  web[0].tree.delete('assets/data/hydro/v0.12.2/manifest.json');
  const result=compareWebBranches(lock,web);
  assert.equal(result[0].absent,1);
  assert.equal(result[0].different,0);
  assert.equal(result[0].candidatePathsForBranch,2);
});
test('Pages site fails with only assets/data exceeding the 1GB cap',()=>{
  const tree=trees(['assets/data/terrain/v0.12.0/4/1.webp',
    PAGES_PUBLISHED_SITE_LIMIT_BYTES+1,sha(2)]);
  const p=pagesSizeBudget(tree,{branch:'main',path:'/'});
  assert.equal(p.assetDataOnlyAlreadyOverLimit,true);
  assert.equal(p.lowerBoundOverageBytes,1);
  assert.equal(p.dataBytes,PAGES_PUBLISHED_SITE_LIMIT_BYTES+1);
});
test('report is read-only and includes exact budget and branch refs',()=>{
  const {s,t,lock,stage7,web,appHeads}=fixture();
  const branches=compareWebBranches(lock,web);
  const pages=pagesSizeBudget(t,{branch:'main',path:'/'});
  const p=planRelease(s,stage7,lock,branches,pages,{appBranchHeads:appHeads});
  assert.equal(p.releasePreparationValid,true);
  assert.equal(p.eligibleForDeployment,false);
  assert.equal(p.eligibleForDeletion,false);
  assert.equal(p.allowAutomaticRefUpdates,false);
  assert.equal(p.phases.length,7);
  assert.ok(p.blockers.some(x=>x.code==='PAST_NATIVE_RELEASES_UNVERIFIED'));
  assert.ok(p.blockers.some(x=>x.code==='CURRENT_URL_SHA_PARITY_MISSING'));
});
test('current Pages wrong source is blocked even when file blobs match',()=>{
  const {s,t,lock,stage7,web,appHeads}=fixture();
  const p=planRelease(s,stage7,lock,compareWebBranches(lock,web),
    pagesSizeBudget(t,{branch:'work/gis',path:'/'}),{appBranchHeads:appHeads});
  assert.ok(p.blockers.some(x=>x.code==='PAGES_SOURCE_UNEXPECTED'));
});
test('branch completeness and drift both block transition',()=>{
  const {s,t,lock,stage7,web,appHeads}=fixture();
  web[0].tree.set('assets/data/hydro/v0.12.2/manifest.json',{sha:sha(9),bytes:50});
  const p=planRelease(s,stage7,lock,compareWebBranches(lock,web).slice(0,1),
    pagesSizeBudget(t,{branch:'main',path:'/'}),{appBranchHeads:appHeads});
  assert.equal(p.releasePreparationValid,false);
  assert.ok(p.blockers.some(x=>x.code==='CROSS_BRANCH_GIT_BLOB_DRIFT'));
  assert.ok(p.blockers.some(x=>x.code==='WEB_BRANCH_COVERAGE'));
  assert.equal(p.eligibleForDeletion,false);
});
test('stage7 evidence must match immutable filename/byte totals',()=>{
  const {s,t,lock,stage7,web,appHeads}=fixture();
  stage7.candidateFiles=4;
  assert.throws(()=>planRelease(s,stage7,lock,compareWebBranches(lock,web),
    pagesSizeBudget(t,{branch:'main',path:'/'}),{appBranchHeads:appHeads}),/disagree/);
});
