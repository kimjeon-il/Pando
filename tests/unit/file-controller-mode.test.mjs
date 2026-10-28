import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserFileAccess} from '../../shared/frontend/js/modules/browser-file-access.js';
const {File,Blob}=globalThis;

test('file access requires product operations before binding and validates optional lifecycle methods',async()=>{
 const {createFileController}=await import('../../shared/frontend/js/modules/file-controller.js');
 for(const productMode of ['viewer','editor']){
  const required=['openProjectFile',...(productMode==='editor'?['openGisFiles','prepareProjectSave','saveExportFile']:[])];
  const fileAccess=Object.fromEntries(required.map(name=>[name,()=>{}]));
  const options={productMode,elements:{},fileAccess,reportOperationError(){}};
  assert.doesNotThrow(()=>createFileController(options));
  for(const name of required)assert.throws(()=>createFileController({...options,fileAccess:{...fileAccess,[name]:null}}),new RegExp(name));
  for(const name of ['bind','dispose'])assert.throws(()=>createFileController({...options,fileAccess:{...fileAccess,[name]:true}}),new RegExp(name));
 }
});

test('both products read project files through the common project transaction; viewer exposes no edit actions',async()=>{
 const {createFileController}=await import("../../shared/frontend/js/modules/file-controller.js");
 for(const productMode of ['viewer','editor']){
  const events=[],listeners={},input={click(){events.push('picker');},addEventListener(name,fn){listeners[name]=fn;},removeEventListener(name){delete listeners[name];}};
  const file=new File(['current'],'current.gpkg'),project={format:'current'};
  const elements={projectInput:input,projectOpen:{id:'open',focus(){events.push('focus');}}};
  const controller=createFileController({productMode,elements,fileAccess:createBrowserFileAccess({productMode,elements}),
   projectDomain:{open:async read=>{events.push('transaction');return read();}},
   readProject:async value=>{assert.equal(value,file);events.push('read');return project;},
   onFiles:async()=>assert.fail('project files must not enter GIS import'),reportOperationError:error=>assert.fail(error.message)});
  controller.bind();
  const cancelled=controller.openProjectPicker();
  input.files=[];listeners.cancel();assert.equal(await cancelled,false);
  const pending=controller.openProjectPicker();
  input.files=[file];input.value='selected';
  listeners.change();
  assert.equal(await pending,project);
  assert.equal(input.value,'');
  assert.deepEqual(events.slice(-3),['transaction','read','focus']);
  if(productMode==='viewer')for(const name of ['saveProject','saveExportFile','openPicker'])assert.equal(name in controller,false);
  const abandoned=controller.openProjectPicker();
  controller.dispose();assert.equal(await abandoned,false);assert.deepEqual(listeners,{});
 }
});

test('browser save cancellation precedes encoding and a successful writer closes before save confirmation',async()=>{
 const {createFileController}=await import('../../shared/frontend/js/modules/file-controller.js');
 const events=[],cancel=Object.assign(new Error('cancel'),{name:'AbortError'});let cancelled=true;
 const window={showSaveFilePicker:async()=>{events.push('picker');if(cancelled)throw cancel;return {createWritable:async()=>({write:async()=>events.push('write'),close:async()=>events.push('close')})};}};
 const controller=createFileController({productMode:'editor',elements:{},fileAccess:createBrowserFileAccess({productMode:'editor',window}),
  projectDomain:{save:async write=>{events.push('encode');await write(new Blob(['project']));events.push('saved');return true;}},reportOperationError:error=>assert.fail(error.message)});
 assert.equal(await controller.saveProject(),false);assert.deepEqual(events,['picker']);
 cancelled=false;assert.equal(await controller.saveProject(),true);assert.deepEqual(events,['picker','picker','encode','write','close','saved']);
 controller.dispose();
});
