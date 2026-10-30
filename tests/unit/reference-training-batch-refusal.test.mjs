import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

test('native training batch rejects invalid requests and preserves an existing checkpoint',t=>{
  const binary=process.env.PANDO_REFERENCE_BATCH_BINARY;assert.ok(binary,'A built native training batch is required');
  const root=mkdtempSync(join(tmpdir(),'pando-batch-'));t.after(()=>rmSync(root,{recursive:true}));
  const output=join(root,'checkpoint.pt');writeFileSync(output,'preserve unique checkpoint');
  assert.throws(()=>execFileSync(binary,[],{stdio:'pipe'}));
  assert.throws(()=>execFileSync(binary,['validate','cpu',join(root,'missing.pt'),join(root,'sample')],{stdio:'pipe'}));
  const common=['cpu','warm',join(root,'weights.safetensors'),output,'0','20261023','2','0.0001',join(root,'order.bin'),'none','fp32','1','0','0',join(root,'sample')];
  assert.throws(()=>execFileSync(binary,common,{stdio:'pipe'}));
  assert.equal(readFileSync(output,'utf8'),'preserve unique checkpoint');
  const bad=[...common];bad[1]='unknown';bad[3]=join(root,'new.pt');
  assert.throws(()=>execFileSync(binary,bad,{stdio:'pipe'}));
});
test('native balanced order matches Python group coverage and rejects malformed input',()=>{
  const binary=process.env.PANDO_REFERENCE_BATCH_BINARY;assert.ok(binary,'A built native training batch is required');
  const pieces=[],number=value=>{const out=Buffer.alloc(4);out.writeUInt32LE(value);pieces.push(out);};
  const datasets=[['b','a','a','a','b'],['z','x','y','y']];number(datasets.length);
  for(const rows of datasets){number(rows.length);for(const group of rows){const bytes=Buffer.from(group);number(bytes.length);pieces.push(bytes);}}
  const input=Buffer.concat(pieces),invoke=bytes=>spawnSync(binary,['order','0','20261029'],{input:bytes,encoding:null});
  const result=invoke(input);assert.equal(result.status,0,result.stderr.toString());
  assert.equal(result.stdout.length,80);assert.deepEqual(Array.from({length:10},(_,i)=>Number(result.stdout.readBigUInt64LE(i*8))),[4,6,6,3,0,8,5,3,8,4]);
  assert.notEqual(invoke(input.subarray(0,input.length-1)).status,0);
  assert.notEqual(invoke(Buffer.concat([input,Buffer.from([1])])).status,0);
});
