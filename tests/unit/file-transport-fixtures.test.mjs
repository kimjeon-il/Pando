import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {createBrowserFileAccessFixture,createNativeFileAccessFixture,fixtureProjectFile} from '../helpers/file-transport-fixtures.mjs';

const {Blob}=globalThis;
const root=new URL('../../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');

test('file transport fixture ownership stays centralized',()=>{
  const helper=read('tests/helpers/file-transport-fixtures.mjs');
  assert.match(helper,/createBrowserFileAccess/);
  assert.match(helper,/createNativeStorage/);
  assert.match(helper,/DOCUMENT_TRANSFER_COMMANDS/);
  assert.match(helper,/DOCUMENT_TRANSFER_LIMITS/);
  assert.doesNotMatch(helper,/\b(?:encodeBytes|decodeBytes)\b/,'Native fixture must not reuse production byte codecs');
  const consumers=[
    'tests/unit/file-access-contract.test.mjs',
    'apps/editor/tests/native-storage.test.mjs',
    'tests/unit/file-controller-mode.test.mjs',
    'tests/unit/file-menu-routes.test.mjs',
  ];
  for(const path of consumers){
    const source=read(path);
    assert.match(source,/file-transport-fixtures\.mjs/,path+' must use the shared file transport fixture');
    assert.doesNotMatch(source,/function\s+(?:simulatedNative|browserFixture|nativeFixture)\b/,path+' recreates a transport fixture');
    assert.doesNotMatch(source,/const\s+input\s*=\s*\(\)\s*=>\s*\(\{listeners:/,path+' recreates browser input listeners');
  }
});


test('shared fixtures exercise Browser and Native transport boundaries',async()=>{
  const browser=createBrowserFileAccessFixture({productMode:'viewer',autoPick:false});
  browser.access.bind({onProjectFile(){},onError:error=>{throw error;}});
  const pending=browser.access.openProjectFile();
  browser.fire('project','success',[fixtureProjectFile()]);
  const selected=await pending;
  assert.equal(selected.cancelled,false);
  assert.equal(selected.file.name,'project.gpkg');
  browser.access.dispose();

  const native=createNativeFileAccessFixture();
  native.set('project','success');
  const opened=await native.access.openProjectFile();
  assert.equal(opened.cancelled,false);
  assert.equal(opened.file.name,'project.gpkg');
  const destination=await native.access.prepareProjectSave();
  const receipt=await destination.write(new Blob(['native-project']));
  assert.equal(receipt.downloaded,false);
  assert.equal(native.writes.length,1);
});
