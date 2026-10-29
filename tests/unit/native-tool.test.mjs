import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {verifyNativeTool} from '../../tools/native-tool.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(t){
  const root=mkdtempSync(join(tmpdir(),'pando-native-proof-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const directory=join(root,'artifact');mkdirSync(directory);
  writeFileSync(join(root,'source.cpp'),'source\r\n');writeFileSync(join(directory,'tool.exe'),'test fixture bytes');
  const manifest={schemaVersion:1,target:'fixture',platform:process.platform,architecture:process.arch,revision:'a'.repeat(40),
    sourceFiles:[{path:'source.cpp',normalization:'lf',sha256:hash('source\n')}],
    files:[{path:'tool.exe',bytes:18,sha256:hash('test fixture bytes')}]};
  const save=()=>writeFileSync(join(directory,'native-tool.manifest.json'),JSON.stringify(manifest));save();
  return {root,directory,manifest,save,verify:()=>verifyNativeTool({root,directory,target:'fixture',executable:'tool.exe',sourceFiles:['source.cpp']})};
}
test('native tool verifies actual source and binary bytes independent of unrelated commits',t=>{
  const f=fixture(t);assert.equal(f.verify().binary,join(f.directory,'tool.exe'));
  writeFileSync(join(f.root,'source.cpp'),'changed\n');assert.throws(f.verify,/source/i);
});
test('native tool rejects corrupt executable and incomplete or escaping manifests',t=>{
  const f=fixture(t);writeFileSync(join(f.directory,'tool.exe'),'corrupt');assert.throws(f.verify,/binary/i);
  writeFileSync(join(f.directory,'tool.exe'),'test fixture bytes');f.manifest.sourceFiles=[];f.save();assert.throws(f.verify,/source/i);
  f.manifest.files[0].path='../tool.exe';f.save();assert.throws(f.verify,/file|path|source/i);
});
test('native tool rejects wrong platform, revision and linked executable',t=>{
  const f=fixture(t);f.manifest.platform='other';f.save();assert.throws(f.verify,/platform/i);
  f.manifest.platform=process.platform;f.manifest.revision='invalid';f.save();assert.throws(f.verify,/revision/i);
  f.manifest.revision='b'.repeat(40);f.save();
  rmSync(join(f.directory,'tool.exe'));mkdirSync(join(f.root,'outside'));symlinkSync(join(f.root,'outside'),join(f.directory,'tool.exe'),process.platform==='win32'?'junction':'dir');
  assert.throws(f.verify,/link|file/i);
});
