import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectOpenAdapter} from '../../../src/document/project-open-adapter.js';
import {createProjectDomain} from '../../../src/document/project-domain.js';

test('builtin and GeoPackage readers yield one replacement envelope without sharing parsers',async()=>{
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

test('both readers share one Core replacement and identical Viewer presentation/rollback',async()=>{
 const before={documentId:'before'},file={documentId:'gpkg',format:'pandolab-project-state'};
 let document=before,fail=false;
 const events=[],captures=[];
 const domain=createProjectDomain({productMode:'viewer',readBuiltinSelectionCatalogs:()=>[],
  documentModel:{snapshot:()=>document},
  commandOwner:{
   state:()=>({epoch:1}),captureReplacement:async()=>{captures.push(document);return captures.length;},
   validateImport:async value=>JSON.parse(value),
   load:async bytes=>{document=JSON.parse(bytes);events.push('file-load');},
   loadBaseline:async()=>{document={documentId:'builtin'};events.push('builtin-load');},
   rollbackReplacement:async id=>{document=captures[id-1];events.push('rollback');},
   releaseReplacement:async()=>events.push('release'),
  },
  replaceSnapshot:async(_project,opts)=>{events.push(['present',opts.reason,opts.generation]);
   if(fail)throw Error('present failed');return true;},
  restoreReplacement:async()=>events.push('restore'),
  invalidateProject:()=>events.push('invalidate'),
 });
 assert.equal(await domain.open(async()=>file,{source:'project',presentation:'default'}),true);
 assert.equal(document.documentId,'gpkg');
 assert.equal(await domain.open(async()=>({baselineId:4,setup:{sourceMode:'builtin'}}),{source:'builtin',presentation:'default'}),true);
 assert.equal(document.documentId,'builtin');
 fail=true;
 await assert.rejects(domain.open(async()=>file,{source:'project'}),/present failed/);
 assert.equal(document.documentId,'builtin','file failure restores accepted builtin');
 await assert.rejects(domain.open(async()=>({baselineId:4,setup:{sourceMode:'builtin'}}),{source:'builtin'}),/present failed/);
 assert.equal(document.documentId,'builtin','builtin failure restores accepted builtin');
 assert.equal(events.filter(v=>Array.isArray(v)&&v[0]==='present').length,4);
 assert.equal(events.filter(v=>v==='rollback').length,2);
 assert.equal(events.filter(v=>v==='restore').length,2);
 assert.equal(events.filter(v=>v==='release').length,4);
});
