import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mapProjectDocumentIdentity,bindProjectDocumentIdentity} from '../../../src/data/map-project-identity.js';
import {createProjectDomain} from '../../../src/document/project-domain.js';

const baseline=JSON.parse(readFileSync(new URL('../../../projects/default-world/manifest.json',import.meta.url)));
const meta=(project=baseline)=>({mapProject:project,mapProjectManifest:{sha256:'a'.repeat(64)},
  dataRevision:'data-'+'b'.repeat(32)});
const file=identity=>({format:'pandolab-project-state',documentId:'saved-1',
  projectSetup:{sourceMode:'builtin',initialMonth:'2000-01',timelineRange:null,initialMapBounds:null},
  ...(identity===undefined?{}:{mapProjectIdentity:identity})});

test('imported project identity is persisted as a strict project-and-data receipt',()=>{
 const current=mapProjectDocumentIdentity(meta());
 assert.deepEqual(current,{projectId:'default-world',manifestSha256:'a'.repeat(64),dataRevision:'data-'+'b'.repeat(32)});
 assert.equal(bindProjectDocumentIdentity(file(current),meta()).mapProjectIdentity,current);
 assert.equal(bindProjectDocumentIdentity(file(),meta()).mapProjectIdentity.projectId,'default-world',
  'only historic default-world documents can be stamped on admission');
 for(const identity of [{...current,projectId:'other-world'},{...current,manifestSha256:'c'.repeat(64)},
   {...current,dataRevision:'data-'+'c'.repeat(32)}, {...current,unknown:true}]){
   assert.throws(()=>bindProjectDocumentIdentity(file(identity),meta()),{code:'PL-PROJECT-IDENTITY'});
 }
 const foreign={...baseline,projectId:'another-world'};
 assert.throws(()=>bindProjectDocumentIdentity(file(),meta(foreign)),{code:'PL-PROJECT-UNBOUND'});
 assert.throws(()=>bindProjectDocumentIdentity(file(current),meta(foreign)),{code:'PL-PROJECT-IDENTITY'});
});

test('foreign map file is refused before C++ replacement capture or validation',async()=>{
 const calls=[];
 const domain=createProjectDomain({productMode:'viewer',
   admitImportedProject:project=>bindProjectDocumentIdentity(project,meta()),
   commandOwner:{
     validateImport:()=>{calls.push('validate');return {};},
     captureReplacement:()=>{calls.push('capture');return 7;},
   }});
 await assert.rejects(domain.load(file({...mapProjectDocumentIdentity(meta()),projectId:'foreign'})),
   {code:'PL-PROJECT-IDENTITY'});
 assert.deepEqual(calls,[]);
 domain.dispose();
});

test('a failed imported project replacement rolls C++ back without discarding the prior state',async()=>{
 const calls=[],original={documentId:'old'},failure=new Error('failed presentation');
 let current=original;
 const domain=createProjectDomain({productMode:'viewer',
   admitImportedProject:project=>bindProjectDocumentIdentity(project,meta()),
   documentModel:{snapshot:()=>current,territorialViews:()=>[]},
   readBuiltinSelectionCatalogs:()=>[],
   commandOwner:{
     validateImport:async json=>{calls.push('validate');return JSON.parse(json);},
     captureReplacement:async()=>{calls.push('capture');return 7;},
     load:async json=>{current=JSON.parse(json);calls.push('load');},
     rollbackReplacement:async id=>{assert.equal(id,7);current=original;calls.push('rollback');},
     releaseReplacement:async id=>{assert.equal(id,7);calls.push('release');},
   },
   replaceSnapshot:()=>{calls.push('render');throw failure;},
   restoreReplacement:()=>{calls.push('restore');},
 });
 await assert.rejects(domain.load(file()),error=>error===failure);
 assert.strictEqual(current,original);
 assert.deepEqual(calls,['validate','capture','load','render','rollback','restore','release']);
 domain.dispose();
});
