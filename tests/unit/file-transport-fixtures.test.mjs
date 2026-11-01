import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const root=new URL('../../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');

test('file transport fixture ownership stays centralized',()=>{
  const helper=read('tests/helpers/file-transport-fixtures.mjs');
  assert.match(helper,/createBrowserFileAccess/);
  assert.match(helper,/createNativeStorage/);
  assert.match(helper,/DOCUMENT_TRANSFER_COMMANDS/);
  assert.match(helper,/DOCUMENT_TRANSFER_LIMITS/);
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
