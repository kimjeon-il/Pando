import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createNodeCoreProject} from '../helpers/core-project.mjs';

test('hydro geometry undo restores the accepted feature coordinates as well as Core history',async()=>{
  const seed=JSON.parse(await readFile(new URL('../fixtures/portability/web-document-seed.json',import.meta.url),'utf8'));
  const owner=await createNodeCoreProject(seed);
  const id='plugin-history-line',geometry={type:'LineString',coordinates:[[10,40],[11,41]]};
  try {
    const created=await owner.project.executeCommand({commandId:'hydro.edit',targets:[{domain:'hydro',id}],payload:{domain:'hydro',id,create:true,value:{type:'Feature',id,geometry,properties:{category:'river',name:'',notes:''}}}});
    assert.equal(created.ok,true,JSON.stringify(created.error));
    const edited=await owner.project.executeCommand({commandId:'hydro.geometry',targets:[{domain:'hydro',id}],payload:{id,geometry:{type:'LineString',coordinates:[[10.5,40.5],[11,41]]}}});
    assert.equal(edited.ok,true,JSON.stringify(edited.error));
    assert.notDeepEqual(owner.documentModel.get({domain:'hydro',id}).geometry,geometry);
    await owner.project.undo();
    assert.equal(owner.client.state().redoCommandId,'hydro.geometry');
    assert.deepEqual(owner.documentModel.get({domain:'hydro',id}).geometry,geometry);
  } finally {owner.dispose();}
});
