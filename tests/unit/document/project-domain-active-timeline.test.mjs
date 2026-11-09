import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectDomain} from '../../../src/document/project-domain.js';

const documentFor=(documentId,range=null)=>({
 format:'pandolab-project-state',documentId,
 mapProjectIdentity:{projectId:'default-world',manifestSha256:'a'.repeat(64),
  dataRevision:'data-'+'b'.repeat(32)},
 projectSetup:{initialMonth:'2020-01',timelineRange:range,sourceMode:'builtin'},
 territorialEntities:[],
});

test('file and manifest project adoption share a C++ document scope and expose the accepted timeline range',async()=>{
 let accepted=documentFor('seed'),checkpoint,failed=false;
 const readmitted=[],views=[];
 const commandOwner={
  state:()=>({epoch:3,timelineCursor:'2020-01'}),
  validateImport:async raw=>JSON.parse(raw),
  captureReplacement:async()=>{checkpoint=accepted;return 11;},
  load:async raw=>{accepted=JSON.parse(raw);},
  loadBaseline:async()=>{accepted=documentFor('manifest-document');},
  rollbackReplacement:async()=>{accepted=checkpoint;},
  releaseReplacement:async()=>{},
  selectionCatalogLoad:async(domain,refs)=>readmitted.push([domain,refs]),
 };
 const project=createProjectDomain({productMode:'viewer',commandOwner,
  readBuiltinSelectionCatalogs:()=>[{domain:'placeBuiltin',refs:[{id:'old-place'}]},
    {domain:'hydroBuiltin',refs:[{id:'old-river'}]}],
  documentModel:{snapshot:()=>accepted},
  replaceSnapshot:async(_document,{reason})=>{
    views.push(reason);
    if(failed)throw Error('view presentation failed');
    return true;
  },
  restoreReplacement:async()=>views.push('restore'),
 });
 assert.equal(project.activeProject(),null);
 const range={start:'2010-01',end:'2020-12'};
 assert.equal(await project.open(async()=>documentFor('gpkg-document',range),{source:'project'}),true);
 assert.equal(project.activeProject().source,'project');
 assert.equal(project.activeProject().projectId,'default-world');
 assert.equal(project.activeProject().documentId,'gpkg-document');
 assert.deepEqual(project.timelineNavigation().range,range);
 assert.equal(project.timelineNavigation().month,'2020-01');
 assert.doesNotThrow(()=>project.requireTimelineMonth('2019-12'));
 assert.throws(()=>project.requireTimelineMonth('2021-01'),/탐색 기간 밖/);
 assert.deepEqual(readmitted,[['placeBuiltin',[]],['hydroBuiltin',[]]]);
 const oldScope=project.activeProjectScope();
 assert.equal(await project.open(async()=>({baselineId:2,setup:{sourceMode:'builtin'}}),{source:'builtin'}),true);
 assert.equal(project.activeProject().source,'builtin');
 assert.equal(project.activeProject().documentId,'manifest-document');
 assert.notEqual(project.activeProjectScope(),oldScope);
 assert.equal(project.timelineNavigation().range,null);
 const rollbackScope=project.activeProjectScope();
 failed=true;
 await assert.rejects(project.open(async()=>documentFor('failed-file'),{source:'project'}),/view presentation failed/);
 assert.equal(project.activeProject().documentId,'manifest-document');
 assert.equal(project.activeProject().source,'builtin');
 assert.notEqual(project.activeProjectScope(),rollbackScope,'rollback changes the session generation');
 assert.deepEqual(views,['load','builtin','load','restore']);
 project.dispose();
});
