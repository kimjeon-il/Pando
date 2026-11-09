import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 createProjectReader,normalizeProjectReader,adaptProjectReadResult,
 projectOpenReceipt,projectOpenCancelledReceipt,
} from '../../../src/data/project-open-adapter.js';
import {createProjectDomain} from '../../../src/document/project-domain.js';

test('builtin and GeoPackage readers adapt to the same immutable admission contract',()=>{
 const reader=async()=>({format:'pandolab-project-state',documentId:'file-1'});
 const file=createProjectReader({source:'project',read:reader});
 const builtin=createProjectReader({source:'builtin',read:async()=>({baselineId:7,setup:{}})});
 assert.equal(file.readPhase,'eager');
 assert.equal(builtin.readPhase,'queued');
 assert.equal(normalizeProjectReader(reader).source,'project');
 assert.equal(normalizeProjectReader(file),file);
 assert.equal(normalizeProjectReader(builtin),builtin);
 const received=adaptProjectReadResult(file,{format:'pandolab-project-state',documentId:'file-1'});
 const native=adaptProjectReadResult(builtin,{baselineId:7,setup:{}});
 assert.equal(received.format,native.format);
 assert.equal(received.admission,'document');
 assert.equal(native.admission,'core-source');
 assert.equal(received.reason,'load');
 assert.equal(native.reason,'builtin');
 assert.ok(Object.isFrozen(native));
 assert.ok(Object.isFrozen(received));
 assert.equal(adaptProjectReadResult(builtin,null),null);
 assert.throws(()=>adaptProjectReadResult(builtin,{format:'pandolab-project-state'}),/prepared C\+\+ source/);
 assert.throws(()=>normalizeProjectReader(builtin,{source:'project'}),/conflicts/);
 assert.throws(()=>normalizeProjectReader(()=>{},{source:'foreign'}),/Unknown/);
 assert.throws(()=>createProjectReader({source:'builtin',read:null}),/requires/);
 const completed=projectOpenReceipt({readResult:received,accepted:true,
  document:{documentId:'file-1'},generation:2});
 assert.deepEqual({accepted:completed.accepted,source:completed.source,reason:completed.reason,
  documentId:completed.documentId,generation:completed.generation},
  {accepted:true,source:'project',reason:'load',documentId:'file-1',generation:2});
 const canceled=projectOpenCancelledReceipt(builtin);
 assert.equal(completed.format,'pandolab-project-open-receipt');
 assert.equal(canceled.format,completed.format);
 assert.equal(canceled.accepted,false);assert.equal(canceled.documentId,null);
});

test('both readers use one C++ replacement and rollback lifecycle without inherited source refs',async()=>{
 const events=[],old={format:'pandolab-project-state',documentId:'initial',territorialEntities:[]};
 let doc=old,captured=null,fail=false;
 const commandOwner={
  state:()=>({epoch:1}),
  captureReplacement:async()=>{captured=doc;events.push('capture');return 11;},
  loadBaseline:async(id)=>{assert.equal(id,7);events.push('baseline');doc={...old,documentId:'builtin-cpp'};},
  validateImport:async raw=>{events.push('validate-import');return JSON.parse(raw);},
  load:async raw=>{events.push('file-load');doc=JSON.parse(raw);},
  selectionCatalogLoad:async(domain,refs)=>{events.push('selection-'+domain);assert.deepEqual(refs,[]);},
  rollbackReplacement:async()=>{events.push('rollback');doc=captured;},
  releaseReplacement:async()=>{events.push('release');},
 };
 const domain=createProjectDomain({
  productMode:'viewer',readBuiltinSelectionCatalogs:()=>[{domain:'placeBuiltin',refs:[{id:'stale'}]}],
  commandOwner,documentModel:{snapshot:()=>doc},
  replaceSnapshot:async(_snapshot,{reason})=>{events.push('present-'+reason);if(fail)throw Error('render failed');return true;},
  restoreReplacement:async()=>events.push('restore'),
  onProjectReset:async event=>events.push(event.reason),
 });
 const builtin=createProjectReader({source:'builtin',read:async()=>({baselineId:7,setup:{}})});
 const b=await domain.openProject(builtin);
 assert.equal(b.accepted,true);assert.equal(b.documentId,'builtin-cpp');
 assert.equal(b.source,'builtin');assert.equal(b.reason,'builtin');
 assert.equal(b.generation,1);assert.equal(b.contentProject,null);
 assert.deepEqual(events,['capture','project-builtin','baseline','selection-placeBuiltin','present-builtin','release']);
 const file={...old,documentId:'file-cpp',projectSetup:{sourceMode:'builtin'}};
 const imported=createProjectReader({source:'project',read:async()=>file});
 fail=true;
 await assert.rejects(domain.openProject(imported),/render failed/);
 assert.equal(doc.documentId,'builtin-cpp');
 assert.equal(domain.activeContentProject(),null);
 assert.ok(events.includes('rollback'));assert.ok(events.includes('restore'));
 fail=false;
 const receipt=await domain.openProject(imported);
 assert.equal(receipt.accepted,true);assert.equal(receipt.documentId,'file-cpp');
 assert.equal(receipt.reason,'load');assert.equal(receipt.generation,4);
 assert.equal(receipt.contentProject,null,'imported builtin-mode file cannot acquire default resources');
 assert.equal(domain.activeContentProject(),null);
 assert.equal(await domain.open(imported),true,'legacy boolean interface keeps one pipeline');
 domain.dispose();
});

test('a superseded eager GeoPackage read never starts another Core replacement',async()=>{
 let release,entered;const waiting=new Promise(resolve=>{release=resolve;});
 const begun=new Promise(resolve=>{entered=resolve;});
 let replaced=0;
 const doc={format:'pandolab-project-state',documentId:'doc-start'};
 const domain=createProjectDomain({
  productMode:'viewer',documentModel:{snapshot:()=>doc},readBuiltinSelectionCatalogs:()=>[],
  commandOwner:{
   state:()=>({epoch:1}),
   validateImport:async raw=>JSON.parse(raw),
   captureReplacement:async()=>1,
   load:async()=>{replaced++;},
   selectionCatalogLoad:async()=>{},
   releaseReplacement:async()=>{},
  },replaceSnapshot:()=>true,
 });
 const first=createProjectReader({source:'project',read:async()=>{entered();await waiting;return doc;}});
 const stale=domain.openProject(first);await begun;
 const latest=domain.openProject(createProjectReader({source:'project',read:async()=>doc}));
 release();
 assert.equal((await stale).accepted,false);
 const result=await latest;
 assert.equal(result.accepted,true);
 assert.equal(replaced,1,'stale read cannot reach the C++ replacement transaction');
 domain.dispose();
});

test('Viewer uses the common project receipt, preserving separate input parsers',()=>{
 const viewer=readFileSync(new URL('../../../src/app/viewer-composition.js',import.meta.url),'utf8');
 assert.match(viewer,/projectDomain\.openProject\(reader,options\)/);
 assert.match(viewer,/const outcome=await projectDomain\.openProject\(reader,options\)/);
 assert.match(viewer,/const presentedGeneration=outcome\.generation;/);
 assert.match(viewer,/createProjectReader\(\{source:'builtin'/);
 assert.match(viewer,/createProjectReader\(\{source:'project',read:reader\}\)/);
 assert.match(viewer,/readProjectFile\(file\)/);
 assert.doesNotMatch(viewer,/projectDomain\.open\(reader,options\)/);
});
