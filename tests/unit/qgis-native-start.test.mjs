import assert from 'node:assert/strict';
import {once} from 'node:events';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {packageNativeTool} from '../../tools/native-tool.mjs';
import {qgisNativeSourceFiles} from '../../tools/qgis/native-client.mjs';
import {prepareNativeProfile,startNativeQgis} from '../../tools/qgis/native-start.mjs';

test('native QGIS creates a dedicated profile and reuses its existing settings without rewriting',t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-qgis-profile-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const profilesRoot=join(root,'profiles'),artifact=join(root,'plugin');
  const path=prepareNativeProfile({profilesRoot,profile:'pando-native'},artifact);
  const text=readFileSync(path,'utf8');assert.match(text,/pando_qgis_bridge=true/);assert.match(text,/searchPathsForPlugins=/);
  assert.equal(prepareNativeProfile({profilesRoot,profile:'pando-native'},artifact),path);
  assert.equal(readFileSync(path,'utf8'),text);
});
test('native QGIS refuses unrelated profiles and unsafe values without replacing settings',t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-qgis-profile-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const settings=prepareNativeProfile({profilesRoot:root,profile:'pando-native'},join(root,'plugin'));
  writeFileSync(settings,'[Plugins]\nother=true\n');
  assert.throws(()=>prepareNativeProfile({profilesRoot:root,profile:'pando-native'},join(root,'plugin')),/profile/i);
  assert.equal(readFileSync(settings,'utf8'),'[Plugins]\nother=true\n');
  assert.throws(()=>prepareNativeProfile({profilesRoot:root,profile:'../other'},join(root,'plugin')),/profile/i);
});
test('native QGIS refuses an occupied unauthenticated port without creating a profile',async t=>{
  if(process.platform!=='win32'){t.skip('native QGIS startup is Windows-only');return;}
  const root=mkdtempSync(join(tmpdir(),'pando-qgis-start-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const sdk=join(root,'qgis'),artifact=join(root,'artifact'),binary=join(root,'pando_qgis_bridge.dll');
  mkdirSync(join(sdk,'bin'),{recursive:true});writeFileSync(join(sdk,'bin','qgis-ltr.bat'),'@exit /b 1\n');writeFileSync(binary,'test-only');
  packageNativeTool({binary,directory:artifact,root:resolve('.'),target:'qgis-native-bridge',platform:'win32',architecture:'x64',
    revision:'a'.repeat(40),runtimeVersion:'qgis-3.44.15-qt-5.15.13',sourceFiles:qgisNativeSourceFiles});
  const server=createServer(socket=>socket.once('data',()=>socket.end('{"ok":false,"error":"Authentication failed"}\n')));
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
  const profilesRoot=join(root,'profiles');
  await assert.rejects(startNativeQgis({host:'127.0.0.1',port:server.address().port,token:'secret',qgisRoot:sdk,
    profilesRoot,profile:'proof',artifactDirectory:artifact},{root:resolve('.')}),/authentication/i);
  assert.equal(existsSync(profilesRoot),false);
});
