import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluatePromotion,planWebDeletes,judgeReadiness} from '../../tools/plan-gis-release-transactions.mjs';

const sha=n=>String(n).repeat(40).slice(0,40);
const tree=(...files)=>new Map(files.map(([p,s,b=5])=>[p,{sha:s,bytes:b}]));
const locked=()=>({schema:'pandolab-gis-archive-delete-lock',version:1,
  sourceCommit:sha(9),totalFiles:2124,totalBytes:564189000,
  files:Array.from({length:2124},(_,i)=>({
    path:'assets/data/hydro/v0.12.2/packs/p'+i+'.bin.gz',
    gitBlob:sha(i%9+1),
    bytes:i===0?564186877:1,group:'hydro/v0.12.2'
  }))});
const exampleBranches=lock=>{
 const all=new Map(lock.files.map(f=>[f.path,{sha:f.gitBlob,bytes:f.bytes}]));
 return ['main','work/gis','work/ui','work/objects','work/places','work/hydro-names',
   'tmp/fetch-north-schleswig-west'].map((name,i)=>({name,head:sha(i+1),tree:new Map(all)}));
};
test('web main promotion is strictly allowlisted; historical GIS studies remain excluded',()=>{
 const base=tree(['assets/js/workers/data-loader-worker.js',sha(1)],
  ['tools/historical-library/land-borders/germany-1914.geojson',sha(1)]);
 const main=new Map(base),gis=tree(
  ['assets/js/workers/data-loader-worker.js',sha(2)],
  ['tools/historical-library/land-borders/germany-1914.geojson',sha(3)],
  ['assets/data/world/current.json',sha(4)]);
 const p=evaluatePromotion({base,main,gis,repo:'kimjeon-il/Pando'});
 assert.equal(p.selectedCount,2);
 assert.equal(p.outOfScopeChangedCount,1);
 assert.equal(p.divergentCount,0);
 assert.equal(p.automaticWholeBranchMergeAllowed,false);
 assert.ok(p.selected.some(x=>x.path==='assets/data/world/current.json'));
});
test('divergent app world dataset files require three-way manual resolution',()=>{
 const base=tree(['app/worlddataset.cpp',sha(1)],['app/physicaldatastore.cpp',sha(1)]);
 const main=tree(['app/worlddataset.cpp',sha(2)],['app/physicaldatastore.cpp',sha(1)]);
 const gis=tree(['app/worlddataset.cpp',sha(3)],['app/physicaldatastore.cpp',sha(4)]);
 const result=evaluatePromotion({base,main,gis,repo:'kimjeon-il/PandoEditor'});
 assert.equal(result.selectedCount,2);
 assert.equal(result.divergentCount,1);
 assert.equal(result.divergent[0].status,'manual-three-way-reconciliation');
 assert.equal(result.automaticCherryPickAllowed,false);
});
test('all seven web heads get immutable rollback anchors and only exact files',()=>{
 const lock=locked(),branches=exampleBranches(lock);
 const plan=planWebDeletes(lock,branches);
 assert.equal(plan.totalBranches,7);assert.equal(plan.anyBlobDrift,false);
 assert.equal(plan.branches[0].exactMatchedFiles,2124);
 assert.equal(plan.branches[0].rollbackRef,branches[0].head);
 assert.equal(plan.branches[0].permittedNow,false);
 assert.equal(plan.executed,false);assert.equal(plan.destructiveOperations,0);
});
test('absent files are ignored rather than inserted into a delete commit',()=>{
 const lock=locked(),branches=exampleBranches(lock);
 branches[2].tree.delete(lock.files[2].path);
 const plan=planWebDeletes(lock,branches);
 assert.equal(plan.branches[2].alreadyAbsentFiles,1);
 assert.equal(plan.branches[2].exactMatchedFiles,2123);
 assert.equal(plan.anyBlobDrift,false);
});
test('any different data Blob on any web branch blocks multi-branch removal',()=>{
 const lock=locked(),branches=exampleBranches(lock);
 branches[1].tree.get(lock.files[0].path).sha=sha(6);
 const plan=planWebDeletes(lock,branches);
 assert.equal(plan.anyBlobDrift,true);
 assert.equal(plan.branches[1].divergentFiles,1);
 assert.equal(plan.branches[1].permittedNow,false);
});
test('duplicate branch plans, invalid heads and unapproved deletion lock are rejected',()=>{
 const lock=locked(),branches=exampleBranches(lock);
 assert.throws(()=>planWebDeletes(lock,[branches[0],branches[0]]),/Duplicate branch/);
 assert.throws(()=>planWebDeletes({...lock,totalFiles:5},branches),/Exact current remaining archive inventory/);
 assert.throws(()=>planWebDeletes(lock,[{name:'main',head:'bad',tree:new Map()},branches[1]]),/Incomplete/);
});
test('readiness reports both Pages overage and native regression blockers',()=>{
 const lock=locked(),branches=exampleBranches(lock);
 const cleanup=planWebDeletes(lock,branches);
 const stage9={schema:'pandolab-stage9-pages-footprint',siteLimitBytes:1000000000,
  profiles:[{name:'main',overByBytes:47586364},{name:'GIS',overByBytes:70012175}]};
 const scopes=[{repo:'kimjeon-il/Pando',selected:[{path:'assets/js/workers/data-loader-worker.js'}],
   selectedCount:1,outOfScopeChangedCount:200,divergentCount:0,divergent:[]},
   {repo:'kimjeon-il/PandoEditor',selected:[{path:'app/worlddataset.cpp'}],
   selectedCount:1,outOfScopeChangedCount:100,divergentCount:1,
   divergent:[{path:'app/worlddataset.cpp'}]}];
 const a=judgeReadiness(stage9,scopes,cleanup,Array.from({length:5},(_,i)=>({name:'app-'+i})));
 assert.equal(a.blocked,true);
 assert.equal(a.approvedForPagesTransition,false);
 assert.equal(a.approvedForDelete,false);
 assert.equal(a.approvedForMainMerge,false);
 assert.equal(a.completionState,'PREPARED_NOT_ACTIVATED');
 assert.ok(a.blockers.some(x=>x.code==='SITE_OVER_1GB'));
 assert.ok(a.blockers.some(x=>x.code==='APP_THREE_WAY_CONFLICTS'));
 assert.ok(a.blockers.some(x=>x.code==='EXPLICIT_RELEASE_APPROVAL_PENDING'));
});
test('short branch coverage is a release blocker, never a silent partial cleanup',()=>{
 const lock=locked(),cleanup=planWebDeletes(lock,exampleBranches(lock).slice(0,3));
 const stage9={schema:'pandolab-stage9-pages-footprint',siteLimitBytes:1000000000,
  profiles:[{overByBytes:0}]};
 const scopes=[{repo:'kimjeon-il/Pando',selected:[{}],selectedCount:1,
    outOfScopeChangedCount:0,divergentCount:0,divergent:[]},
   {repo:'kimjeon-il/PandoEditor',selected:[{}],selectedCount:1,
    outOfScopeChangedCount:0,divergentCount:0,divergent:[]}];
 const r=judgeReadiness(stage9,scopes,cleanup,[{}]);
 assert.ok(r.blockers.some(x=>x.code==='WEB_BRANCH_SET_CHANGED'));
 assert.ok(r.blockers.some(x=>x.code==='APP_BRANCH_SET_CHANGED'));
 assert.equal(r.approvedForMainMerge,false);
});
