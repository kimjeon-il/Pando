import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

test('training proof refuses incomplete requests and existing checkpoints',t=>{
  const binary=process.env.PANDO_REFERENCE_TRAINING_PROOF_BINARY;assert(binary,'Native proof executable required');
  const directory=mkdtempSync(join(tmpdir(),'pando-resume-refusal-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const checkpoint=join(directory,'keep.pt');writeFileSync(checkpoint,'preserve checkpoint');
  for(const [args,message] of [[[],/Usage/],[['cpu','weights','tile','overview','position','target','valid',checkpoint,'8'],/already exists/]]){
    const result=spawnSync(binary,args,{encoding:'utf8',timeout:15000});assert.equal(result.error,undefined);assert.equal(result.status,1);assert.match(result.stderr,message);
  }
  assert.equal(readFileSync(checkpoint,'utf8'),'preserve checkpoint');
});
