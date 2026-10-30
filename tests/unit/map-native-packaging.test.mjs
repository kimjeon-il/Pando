import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {packageNativeTool} from '../../tools/native-tool.mjs';
import {collectMapImageArtifacts,mapImageSourceFiles} from '../../tools/map-image/native-resample.mjs';

test('private map package includes both verified platform binaries and rejects changed bytes',t=>{
  const root=mkdtempSync(join(tmpdir(),'map-native-package-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const workspace=resolve('.'),linux=join(root,'linux'),windows=join(root,'windows');
  for(const [platform,dir,name] of [['linux',linux,'pando-map-image'],['win32',windows,'pando-map-image.exe']]){
    const file=join(root,name);writeFileSync(file,'synthetic '+platform);
    packageNativeTool({binary:file,directory:dir,root:workspace,target:'map-image',platform,architecture:'x64',
      revision:'a'.repeat(40),sourceFiles:mapImageSourceFiles});
  }
  const entries=collectMapImageArtifacts({workspace,linuxDirectory:linux,windowsDirectory:windows});
  assert.deepEqual(entries.map(e=>e.path).sort(),[
    'build-native/map-image/linux-x64/native-tool.manifest.json','build-native/map-image/linux-x64/pando-map-image',
    'build-native/map-image/win32-x64/native-tool.manifest.json','build-native/map-image/win32-x64/pando-map-image.exe']);
  const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  assert.equal(collectMapImageArtifacts({workspace,linuxDirectory:linux,windowsDirectory:windows,revision}).length,4);
  writeFileSync(join(linux,'pando-map-image'),'tampered');
  assert.throws(()=>collectMapImageArtifacts({workspace,linuxDirectory:linux,windowsDirectory:windows}),/hash|size/i);
});
