import { describe as contractSuite } from 'node:test';
import * as __project_dep0 from "node:test";
import * as __project_dep1 from "node:assert/strict";
import * as __project_dep2 from "../../../src/data/file-access-contract.js";
import * as __project_dep3 from "../../../src/ui/file-controller.js";
import * as __project_dep4 from "../../helpers/file-transport-fixtures.mjs";

import * as __project_dep6 from "../../../src/document/project-domain.js";
contractSuite("file-access-contract", () => {
const { describe : contractSuite } = __project_dep0;
const __dep0 = __project_dep1;
const __dep1 = __project_dep0;
const __dep2 = __project_dep2;
const __dep3 = __project_dep3;
const __dep4 = __project_dep4;

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
  assert.throws(()=>assertProjectFileSelection({cancelled:false,file:new globalThis.Blob(['x'])}),/named File/);
  assert.equal(assertProjectFileSelection({cancelled:false,file:new globalThis.File(['x'],'project.gpkg')}).file.name,'project.gpkg');
});
});
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
  const file=new globalThis.File(['current'],'current.gpkg'),project={format:'current'};
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
contractSuite("file-transport-fixtures", () => {
const assert = __dep0.default;

const test = __dep1.default;
const { createBrowserFileAccessFixture, fixtureProjectFile } = __dep4;

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
});
contractSuite("project-product-surface", () => {
const test = __project_dep0.default;
const assert = __project_dep1.default;
const { createProjectDomain } = __project_dep6;

test('project domains require explicit product mode and only editors register mutation/persistence APIs',()=>{
 assert.throws(()=>createProjectDomain({}),/product mode/i);
 const options={commandOwner:{state:()=>({epoch:1})},documentModel:{snapshot:()=>({}),projectWorld:value=>value}};
 for(const productMode of ['viewer','editor']){
  const domain=createProjectDomain({productMode,...options});
  for(const key of ['snapshot','state','resolveWorld','open','load','getGeneration','admitSelectionCatalog','admitPresentationCatalog','dispose'])assert.equal(typeof domain[key],'function',key);
  for(const key of ['createProject','executeCommand','prepareCommand','confirmCandidate','cancelCandidate','labelGestureApply','save','undo','redo','buildFileSnapshot','buildAutosave'])assert.equal(key in domain,productMode==='editor',key);
  for(const key of ['configureProject','comparisonMonth','comparisonHighlight','comparisonResult','setComparisonMonth','resolveComparison','highlightComparison'])assert.equal(key in domain,false,key);
 }
});


test('read-only project domain exposes queries without mutation commands',()=>{
 const options={productMode:'editor',readOnly:true,commandOwner:{state:()=>({epoch:1})},documentModel:{snapshot:()=>({}),projectWorld:x=>x}};
 const domain=createProjectDomain(options);
 for(const key of ['snapshot','resolveWorld','open','inspectImport','prepareTemporalBuiltin'])assert.equal(typeof domain[key],'function',key);
 for(const key of ['createProject','executeCommand','save','undo','redo','buildFileSnapshot','buildAutosave','prepareImport'])assert.equal(key in domain,false,key);
 assert.throws(()=>createProjectDomain({...options,productMode:'viewer',readOnly:false}),/read-only/i);
 domain.dispose();
});
});
