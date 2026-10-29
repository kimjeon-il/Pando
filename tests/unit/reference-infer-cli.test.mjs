import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

const binary=process.env.PANDO_REFERENCE_INFER_BINARY;
test('reference inference rejects missing inputs and invalid devices before producing logits',()=>{
  assert(binary,'PANDO_REFERENCE_INFER_BINARY must identify the native executable');
  for(const [args,expected] of [[[],/Usage/],[['other','weights','tile','overview','position'],/Device/]]){
    const result=spawnSync(binary,args,{encoding:'utf8',timeout:15000});
    assert.equal(result.error,undefined,`Inference command failed to exit: ${args.join(' ')}`);
    assert.equal(result.status,1);assert.match(result.stderr,expected);assert.equal(result.stdout,'');
  }
});
