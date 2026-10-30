import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {writeBalancedTrainingOrder} from '../../tools/reference-analysis/training-order.mjs';

test('balanced order refuses invalid groups and preserves existing output',async t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-order-'));t.after(()=>rmSync(root,{recursive:true}));
  const output=join(root,'order.bin');writeFileSync(output,'keep');
  await assert.rejects(writeBalancedTrainingOrder({datasets:[['a']],epoch:0,seed:1,output,torchLibrary:root}),/exists/);
  assert.equal(readFileSync(output,'utf8'),'keep');
  await assert.rejects(writeBalancedTrainingOrder({datasets:[['']],epoch:0,seed:1,output:join(root,'new.bin'),torchLibrary:root}),/group/);
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
