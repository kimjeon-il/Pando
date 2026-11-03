import assert from 'node:assert/strict';
import test from 'node:test';
import {assertFileAccessPort,assertProjectFileSelection,FILE_ACCESS_REQUIRED_METHODS} from '../../shared/frontend/js/modules/file-access-contract.js';

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
