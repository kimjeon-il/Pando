import test from 'node:test';
import assert from 'node:assert/strict';

test('both products read project files through the common project transaction; viewer exposes no edit actions',async()=>{
 const {createFileController}=await import("../../shared/frontend/js/modules/file-controller.js");
 for(const productMode of ['viewer','editor']){
  const events=[],input={dataset:{},click(){events.push('picker');},addEventListener(){}};
  const file={name:'current.gpkg'},project={format:'current'};
  const controller=createFileController({productMode,elements:{projectInput:input,projectOpen:{id:'open',focus(){events.push('focus');}}},
   projectDomain:{open:async read=>{events.push('transaction');return read();}},
   readProject:async value=>{assert.equal(value,file);events.push('read');return project;},
   onFiles:async()=>assert.fail('project files must not enter GIS import'),reportOperationError:error=>assert.fail(error.message)});
  await controller.openProjectPicker();
  input.files=[];assert.equal(await controller.handleChange({target:input}),false);
  await controller.openProjectPicker();
  input.files=[file];input.value='selected';
  assert.equal(await controller.handleChange({target:input}),project);
  assert.equal(input.value,'');
  assert.deepEqual(events.slice(-3),['transaction','read','focus']);
  if(productMode==='viewer')for(const name of ['saveProject','saveExportFile','openPicker'])assert.equal(name in controller,false);
 }
});
