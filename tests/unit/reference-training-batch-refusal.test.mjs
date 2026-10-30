import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

test('native training batch rejects invalid requests and preserves an existing checkpoint',t=>{
  const binary=process.env.PANDO_REFERENCE_BATCH_BINARY;assert.ok(binary,'A built native training batch is required');
  const root=mkdtempSync(join(tmpdir(),'pando-batch-'));t.after(()=>rmSync(root,{recursive:true}));
  const output=join(root,'checkpoint.pt');writeFileSync(output,'preserve unique checkpoint');
  assert.throws(()=>execFileSync(binary,[],{stdio:'pipe'}));
  const common=['cpu','warm',join(root,'weights.safetensors'),output,'0','20261023','2','0.0001',join(root,'order.bin'),'none','0',join(root,'sample')];
  assert.throws(()=>execFileSync(binary,common,{stdio:'pipe'}));
  assert.equal(readFileSync(output,'utf8'),'preserve unique checkpoint');
  const bad=[...common];bad[1]='unknown';bad[3]=join(root,'new.pt');
  assert.throws(()=>execFileSync(binary,bad,{stdio:'pipe'}));
});
