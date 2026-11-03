import test from 'node:test';
import assert from 'node:assert/strict';
import {createFileController} from '../../shared/frontend/js/modules/file-controller.js';
import {createBrowserFileAccessFixture} from '../helpers/file-transport-fixtures.mjs';

test('Viewer file workflow rejects the retired editor product',()=>{
  const access={openProjectFile:async()=>({cancelled:true})};
  assert.throws(()=>createFileController({productMode:'editor',fileAccess:access,reportOperationError(){}}),/viewer/i);
});

test('Viewer opens a selected project through the current transaction and closes pending pickers',async()=>{
  const file=new File(['current'],'current.gpkg'),project={format:'current'};
  const fixture=createBrowserFileAccessFixture({productMode:'viewer',autoPick:false,projectFiles:()=>[file]});
  const {events,elements}=fixture;
  const controller=createFileController({productMode:'viewer',elements,fileAccess:fixture.access,
    projectDomain:{open:async read=>{events.push('transaction');return read();}},
    readProject:async value=>{assert.equal(value,file);events.push('read');return project;},
    reportOperationError:error=>assert.fail(error.message)});
  controller.bind();
  const cancelled=controller.openProjectPicker();
  fixture.fire('project','cancel');assert.equal(await cancelled,false);
  const pending=controller.openProjectPicker();
  fixture.fire('project','success',[file]);
  assert.equal(await pending,project);
  assert.equal(elements.projectInput.value,'');
  assert.deepEqual(events.slice(-3),['transaction','read','focus']);
  for(const name of ['saveProject','saveExportFile','openPicker'])assert.equal(name in controller,false);
  const abandoned=controller.openProjectPicker();
  controller.dispose();assert.equal(await abandoned,false);assert.deepEqual(elements.projectInput.listeners,{});
});
