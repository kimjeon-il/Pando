import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectOpenAdapter} from '../../../src/document/project-open-adapter.js';

test('builtin and GeoPackage readers normalize to the same C++ replacement contract',async()=>{
 const gpkg={format:'pandolab-project-state',documentId:'user-file',territorialEntities:[]};
 const file=createProjectOpenAdapter({source:'project',read:async()=>gpkg});
 const builtin=createProjectOpenAdapter({source:'builtin',read:async()=>({baselineId:9,setup:{sourceMode:'builtin'}})});
 assert.equal(file.requiresSettledReplacement,false);
 assert.equal(builtin.requiresSettledReplacement,true);
 assert.deepEqual(await file.prepare(),{source:'project',reason:'load',value:gpkg,releaseCandidate:null});
 assert.deepEqual(await builtin.prepare(),{source:'builtin',reason:'builtin',
  value:{baselineId:9,setup:{sourceMode:'builtin'}},releaseCandidate:null});
 await assert.rejects(createProjectOpenAdapter({source:'project',read:async()=>({baselineId:9})}).prepare(),/cannot impersonate/);
 await assert.rejects(createProjectOpenAdapter({source:'builtin',read:async()=>gpkg}).prepare(),/admitted C\+\+ source/);
 assert.throws(()=>createProjectOpenAdapter({source:'invalid',read:async()=>gpkg}),/Unknown project source/);
});

test('candidate handle survives supersession and file read never claims C++ baseline',async()=>{
 const candidate={kind:'temporal-candidate',candidateId:17,sourceId:11};
 let current=true;
 const builtin=createProjectOpenAdapter({source:'builtin',read:async()=>{current=false;return candidate;}});
 const prepared=await builtin.prepare({isCurrent:()=>current});
 assert.equal(prepared.releaseCandidate,candidate);
 const file=createProjectOpenAdapter({source:'project',read:async()=>({format:'pandolab-project-state',documentId:'x'})});
 assert.equal((await file.prepare()).releaseCandidate,null);
 await assert.rejects(file.prepare({isCurrent:()=>false}),{code:'PL-CORE-STALE'});
});
