import test from 'node:test';
import assert from 'node:assert/strict';
import {assertFileAccessPort,FILE_ACCESS_REQUIRED_METHODS} from '../../shared/frontend/js/modules/file-access-contract.js';
import {createBrowserFileAccessFixture} from '../helpers/file-transport-fixtures.mjs';
const {File,Blob}=globalThis;

test('file access method ownership comes from the canonical shared contract',async()=>{
 const {createFileController}=await import('../../shared/frontend/js/modules/file-controller.js');
 for(const productMode of ['viewer','editor']){
  const required=FILE_ACCESS_REQUIRED_METHODS[productMode];
  const fileAccess=Object.fromEntries(required.map(name=>[name,()=>{}]));
  const options={productMode,elements:{},fileAccess,reportOperationError(){}};
  assert.equal(assertFileAccessPort(fileAccess,{productMode}),fileAccess);
  assert.doesNotThrow(()=>createFileController(options));
  for(const name of required)assert.throws(()=>assertFileAccessPort({...fileAccess,[name]:null},{productMode}),new RegExp(name));
  for(const name of ['bind','dispose'])assert.throws(()=>assertFileAccessPort({...fileAccess,[name]:true},{productMode}),new RegExp(name));
 }
});

test('both products read project files through the common project transaction; viewer exposes no edit actions',async()=>{
 const {createFileController}=await import("../../shared/frontend/js/modules/file-controller.js");
 for(const productMode of ['viewer','editor']){
  const file=new File(['current'],'current.gpkg'),project={format:'current'};
  const fixture=createBrowserFileAccessFixture({productMode,autoPick:false,projectFiles:()=>[file]}),events=fixture.events,elements=fixture.elements;
  const controller=createFileController({productMode,elements,fileAccess:fixture.access,
   projectDomain:{open:async read=>{events.push('transaction');return read();}},
   readProject:async value=>{assert.equal(value,file);events.push('read');return project;},
   onFiles:async()=>assert.fail('project files must not enter GIS import'),reportOperationError:error=>assert.fail(error.message)});
  controller.bind();
  const cancelled=controller.openProjectPicker();
  fixture.fire('project','cancel');assert.equal(await cancelled,false);
  const pending=controller.openProjectPicker();
  fixture.fire('project','success',[file]);
  assert.equal(await pending,project);
  assert.equal(elements.projectInput.value,'');
  assert.deepEqual(events.slice(-3),['transaction','read','focus']);
  if(productMode==='viewer')for(const name of ['saveProject','saveExportFile','openPicker'])assert.equal(name in controller,false);
  const abandoned=controller.openProjectPicker();
  controller.dispose();assert.equal(await abandoned,false);assert.deepEqual(elements.projectInput.listeners,{});
 }
});

test('browser save cancellation precedes encoding and a successful writer closes before save confirmation',async()=>{
 const {createFileController}=await import('../../shared/frontend/js/modules/file-controller.js');
 const fixture=createBrowserFileAccessFixture({productMode:'editor'}),events=fixture.events;
 fixture.setSaveMode('cancel');
 const controller=createFileController({productMode:'editor',elements:fixture.elements,fileAccess:fixture.access,
  projectDomain:{save:async write=>{events.push('encode');await write(new Blob(['project']));events.push('saved');return true;}},reportOperationError:error=>assert.fail(error.message)});
 assert.equal(await controller.saveProject(),false);assert.deepEqual(events,['picker']);
 fixture.setSaveMode('success');assert.equal(await controller.saveProject(),true);assert.deepEqual(events,['picker','picker','encode','write','close','saved']);
 controller.dispose();
});
