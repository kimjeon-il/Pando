import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {createBrowserFileAccessFixture,fixtureProjectFile} from '../helpers/file-transport-fixtures.mjs';

const root=new URL('../../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');

test('file transport fixture ownership stays centralized',()=>{
  const helper=read('tests/helpers/file-transport-fixtures.mjs');
  assert.match(helper,/createBrowserFileAccess/);
  const consumers=[
    'tests/unit/file-controller-mode.test.mjs',
  ];
  for(const path of consumers){
    const source=read(path);
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
