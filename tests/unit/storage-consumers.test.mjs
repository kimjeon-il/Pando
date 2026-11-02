import test from 'node:test';
import assert from 'node:assert/strict';
import {isStorageConsumer,storageConsumersFromProcesses} from '../../tools/worktree-storage.mjs';
import {previewGeneratedCleanup} from '../../tools/worktree-generated.mjs';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('retiring Emscripten executables block storage cleanup regardless of process name',()=>{
 for(const Name of ['node.exe','python.exe','clang.exe','clang++.exe'])assert.equal(isStorageConsumer({Name,ExecutablePath:`D:\\build\\toolchains\\emsdk-6.0.3\\upstream\\bin\\${Name}`,CommandLine:Name}),true);
 assert.equal(isStorageConsumer({Name:'node.exe',ExecutablePath:'D:/build/toolchains/emsdk-6.0.3/node/node.exe'}),true);
 assert.equal(isStorageConsumer({Name:'python.exe',ExecutablePath:'D:/dev/worktrees/ui/build-native/python/python.exe'}),false);
 assert.equal(isStorageConsumer({Name:'node.exe',ExecutablePath:'D:/build/toolchains/emsdk-6.0.30/node/node.exe'}),false);
 assert.equal(isStorageConsumer({Name:'python.exe',ExecutablePath:'C:/Python/python.exe',CommandLine:'python "D:\\build\\toolchains\\emsdk-6.0.3\\upstream\\emscripten\\emcc.py" input.cpp'}),true);
 assert.equal(isStorageConsumer({Name:'python.exe',ExecutablePath:'C:/Python/python.exe',CommandLine:'python D:/build/toolchains/emsdk-6.0.30/upstream/emscripten/emcc.py'}),false);
});
test('external SDK installer blocks retirement of its child runtime directories',t=>{
 const root=mkdtempSync(join(tmpdir(),'pando-sdk-consumer-'));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'emsdk-6.0.3/upstream'),{recursive:true});writeFileSync(join(root,'emsdk-6.0.3/upstream/tool'),'runtime');
 const consumers=storageConsumersFromProcesses([{Name:'python.exe',ExecutablePath:'C:/Python/python.exe',CommandLine:'python D:/build/toolchains/emsdk-6.0.3/emsdk.py install 6.0.3'}]);
 assert.equal(consumers.length,1);assert.throws(()=>previewGeneratedCleanup({roots:[root],compilerScopes:[{root,kind:'toolchains'}],requests:[{root,path:'emsdk-6.0.3/upstream',action:'delete',reason:'retired installation'}],consumers}),/consumer/i);
});
test('existing native, browser, Java and application development consumers remain protected',()=>{
 for(const row of [{Name:'cargo.exe'},{Name:'java.exe',CommandLine:'java gradle'},{Name:'msedgewebview2.exe',CommandLine:'PandoLab profile'},{Name:'node.exe',CommandLine:'node tests/browser/server.mjs'},{Name:'node.exe',CommandLine:'node tools/build-map.mjs'}])assert.equal(isStorageConsumer(row),true);
 for(const row of [{Name:'node.exe',CommandLine:'node unrelated.mjs'},{Name:'java.exe',CommandLine:'java unrelated.jar'},{Name:'msedge.exe',CommandLine:'edge normal-profile'}])assert.equal(isStorageConsumer(row),false);
});
