import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {writeBalancedTrainingOrder} from '../../tools/reference-analysis/training-order.mjs';
import {matchingTorchLibrary} from '../../tools/reference-analysis/native-infer.mjs';

test('training order CLI requires explicit corpus and configuration',()=>{
  const result=spawnSync(process.execPath,['tools/reference-analysis/training-order.mjs'],{encoding:'utf8',timeout:10000});
  assert.equal(result.status,1);assert.match(result.stderr,/explicit/i);
});
test('combined order CLI requires explicit nonmacro auxiliary scope',()=>{
  const result=spawnSync(process.execPath,['tools/reference-analysis/training-order.mjs','--auxiliary','semap.json','--epoch','0','--seed','42'],{encoding:'utf8',timeout:10000});
  assert.equal(result.status,1);assert.match(result.stderr,/explicit nonmacro/i);
});

test('balanced order refuses invalid groups and preserves existing output',async t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-order-'));t.after(()=>rmSync(root,{recursive:true}));
  const output=join(root,'order.bin');writeFileSync(output,'keep');
  await assert.rejects(writeBalancedTrainingOrder({datasets:[['a']],epoch:0,seed:1,output,torchLibrary:root}),/exists/);
  assert.equal(readFileSync(output,'utf8'),'keep');
  await assert.rejects(writeBalancedTrainingOrder({datasets:[['']],epoch:0,seed:1,output:join(root,'new.bin'),torchLibrary:root}),/group/);
});
test('Windows standalone LibTorch SDK is identified by its own version metadata',{skip:process.platform!=='win32'},t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-torch-sdk-'));t.after(()=>rmSync(root,{recursive:true}));
  const library=join(root,'lib'),config=join(root,'share','cmake','Torch');mkdirSync(library);mkdirSync(config,{recursive:true});
  for(const file of ['torch_cpu.dll','c10.dll'])writeFileSync(join(library,file),'fixture');
  writeFileSync(join(config,'TorchConfigVersion.cmake'),'set(PACKAGE_VERSION "2.14.1")\n');
  assert.equal(matchingTorchLibrary(library,{runtimeVersion:'2.14.1'}),library);
  writeFileSync(join(config,'TorchConfigVersion.cmake'),'set(PACKAGE_VERSION "2.7.1")\n');
  assert.throws(()=>matchingTorchLibrary(library,{runtimeVersion:'2.14.1'}),/does not match/);
});
test('source-bound native sampling writes the Python balanced tile order',{
  skip:!process.env.PANDO_REFERENCE_BATCH_DIRECTORY||!process.env.PANDO_REFERENCE_TORCH_LIBRARY,
},async t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-order-native-'));t.after(()=>rmSync(root,{recursive:true}));
  const output=join(root,'order.bin');const result=await writeBalancedTrainingOrder({datasets:[['b','a','a','a','b'],['z','x','y','y']],
    epoch:0,seed:20261029,output,torchLibrary:process.env.PANDO_REFERENCE_TORCH_LIBRARY,directory:process.env.PANDO_REFERENCE_BATCH_DIRECTORY});
  const bytes=readFileSync(output);assert.equal(result.length,10);assert.equal(bytes.length,80);
  assert.deepEqual(Array.from({length:10},(_,i)=>Number(bytes.readBigUInt64LE(i*8))),[4,6,6,3,0,8,5,3,8,4]);
});
