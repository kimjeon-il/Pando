import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createNodeCoreProject } from '../helpers/core-project.mjs';

const seed=() => JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json',import.meta.url),'utf8'));
test('direct hydro/label metadata and deletion commands preserve complete C++ document/history ownership',async () => {
  const initial=seed(),owner=await createNodeCoreProject(initial),hydro=initial.hydroEdits[0],label=initial.labels[0];
  const call=(commandId,domain,id,payload,extra={})=>owner.project.executeCommand({
    commandId,targets:[{domain,id}],payload,...extra,
  });
  async function hydroName(value){
    const result=await call('hydro.metadata','hydro',hydro.id,{id:hydro.id,field:'name',value});
    assert.equal(result.ok,true);
    return result.changed;
  }
  async function removeHydro(){
    const result=await call('hydro.edit','hydro',hydro.id,{domain:'hydro',id:hydro.id,value:null,create:false});
    assert.equal(result.ok,true);
    return result.changed;
  }
  async function labelName(value){
    const before=owner.documentModel.get({domain:'label',id:label.id});
    const result=await call('label.edit','label',label.id,
      {domain:'label',id:label.id,value:{...before,name:value},create:false},
      {expectedEpoch:owner.project.state().epoch});
    assert.equal(result.ok,true);
    return result.changed;
  }
  async function removeLabel(){
    const result=await call('label.edit','label',label.id,{domain:'label',id:label.id,value:null,create:false});
    assert.equal(result.ok,true);
    return result.changed;
  }
  try {
    assert.equal(await hydroName(hydro.properties.name),false);
    assert.equal(owner.client.state().stateRevision,0);assert.equal(owner.client.state().canUndo,false);
    assert.equal(await hydroName('  raw H  '),true);
    assert.equal(owner.documentModel.get({ domain: 'hydro',id: hydro.id }).properties.name,'  raw H  ');
    assert.equal(owner.client.state().stateRevision,1);assert.equal(owner.client.state().documentDirty,true);
    assert.equal(owner.client.state().presentationDirty,false);
    assert.equal(await removeHydro(),true);assert.equal(owner.documentModel.get({ domain: 'hydro',id: hydro.id }),null);
    assert.equal(owner.client.state().stateRevision,1);assert.equal(owner.client.state().presentationDirty,false);
    assert.equal(await owner.project.undo(),true);
    assert.equal(owner.documentModel.get({ domain: 'hydro',id: hydro.id }).properties.name,'  raw H  ');
    assert.equal(await labelName('  raw label  '),true);
    assert.equal(owner.documentModel.get({ domain: 'label',id: label.id }).name,'  raw label  ');
    assert.equal(owner.client.state().stateRevision,1);assert.equal(owner.client.state().presentationDirty,false);
    assert.equal(await removeLabel(),true);assert.equal(owner.documentModel.get({ domain: 'label',id: label.id }),null);
    assert.equal(Object.hasOwn(owner.documentModel.snapshot().labelSettings,`label:${label.id}`),false);
    assert.equal(owner.client.state().stateRevision,1);assert.equal(await owner.project.undo(),true);
    assert.equal(owner.documentModel.get({ domain: 'label',id: label.id }).name,'  raw label  ');
    assert.equal(await owner.project.undo(),true);assert.deepEqual(owner.documentModel.list('label'),initial.labels);
    assert.equal(await owner.project.undo(),true);assert.deepEqual(owner.documentModel.snapshot(),initial);
    assert.deepEqual(JSON.parse(await owner.client.storageSnapshot()),initial);
    assert.equal(owner.client.state().documentDirty,false);assert.equal(owner.client.state().presentationDirty,false);
  } finally { owner.dispose(); }
});
