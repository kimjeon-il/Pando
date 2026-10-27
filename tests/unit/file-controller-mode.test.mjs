import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserFileAccess} from '../../shared/frontend/js/modules/browser-file-access.js';
const {File}=globalThis;

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
