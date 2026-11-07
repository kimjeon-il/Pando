import { describe as contractSuite } from 'node:test';
import * as __dep0 from "node:assert/strict";
import * as __dep1 from "node:test";
import * as __dep2 from "../../shared/frontend/js/modules/file-access-contract.js";
import * as __dep3 from "../../shared/frontend/js/modules/file-controller.js";
import * as __dep4 from "../helpers/file-transport-fixtures.mjs";
import * as __dep5 from "node:fs";

// Original feature contract: file-access-contract.test.mjs
contractSuite("file-access-contract", () => {
const assert = __dep0.default;
const test = __dep1.default;
const { assertFileAccessPort, assertProjectFileSelection, FILE_ACCESS_REQUIRED_METHODS } = __dep2;

test('file access contract requires only Viewer project opening',()=>{
  const access={openProjectFile(){}};
  assert.deepEqual(FILE_ACCESS_REQUIRED_METHODS.viewer,['openProjectFile']);
  assert.equal(assertFileAccessPort(access,{productMode:'viewer'}),access);
  assert.throws(()=>assertFileAccessPort(access,{productMode:'editor'}),/viewer/i);
  assert.throws(()=>assertFileAccessPort({},{productMode:'viewer'}),/openProjectFile/);
  for(const name of ['bind','dispose'])assert.throws(()=>assertFileAccessPort({...access,[name]:true},{productMode:'viewer'}),new RegExp(name));
});

test('project selections require a named file unless cancelled',()=>{
  assert.equal(assertProjectFileSelection({cancelled:true}).cancelled,true);
  assert.throws(()=>assertProjectFileSelection({cancelled:false,file:new Blob(['x'])}),/named File/);
  assert.equal(assertProjectFileSelection({cancelled:false,file:new File(['x'],'project.gpkg')}).file.name,'project.gpkg');
});
});

// Original feature contract: file-controller-mode.test.mjs
contractSuite("file-controller-mode", () => {
const test = __dep1.default;
const assert = __dep0.default;
const { createFileController } = __dep3;
const { createBrowserFileAccessFixture } = __dep4;

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
});

// Original feature contract: file-transport-fixtures.test.mjs
contractSuite("file-transport-fixtures", () => {
const assert = __dep0.default;
const { readFileSync } = __dep5;
const test = __dep1.default;
const { createBrowserFileAccessFixture, fixtureProjectFile } = __dep4;

const root=new URL('../../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');

test('file transport fixture ownership stays centralized',()=>{
  const helper=read('tests/helpers/file-transport-fixtures.mjs');
  assert.match(helper,/createBrowserFileAccess/);
  // The file-controller contract now lives in this consolidated suite.
  // Inspect the real current module rather than a retired test filename.
  const consumers=[new URL(import.meta.url)];
  for(const path of consumers){
    const source=readFileSync(path,'utf8');
    assert.match(source,/file-transport-fixtures\.mjs/,path+' must use the shared file transport fixture');
    assert.doesNotMatch(source,/function\s+(?:simulatedNative|browserFixture|nativeFixture)\b/,path+' recreates a transport fixture');
    assert.doesNotMatch(source,/const\s+input\s*=\s*\(\)\s*=>\s*\(\{listeners:/,path+' recreates browser input listeners');
  }
});


test('shared fixture exercises the browser file access boundary',async()=>{
  const browser=createBrowserFileAccessFixture({productMode:'viewer',autoPick:false});
  browser.access.bind({onProjectFile(){},onError:error=>{throw error;}});
  const pending=browser.access.openProjectFile();
  browser.fire('project','success',[fixtureProjectFile()]);
  const selected=await pending;
  assert.equal(selected.cancelled,false);
  assert.equal(selected.file.name,'project.gpkg');
  browser.access.dispose();

});
});
