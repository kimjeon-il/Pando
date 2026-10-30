import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cp,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {corpusFingerprint,trainingFileIdentity} from '../../tools/reference-analysis/training-evidence.mjs';

test('corpus fingerprint matches the original for one or two corpora and includes source bytes',async t=>{
  const root=await mkdtemp(join(tmpdir(),'pando-corpus-fingerprint-'));t.after(()=>rm(root,{recursive:true}));
  await cp('tests/fixtures/reference-corpus-fingerprint',root,{recursive:true});
  const path=join(root,'corpus.json');
  assert.throws(()=>trainingFileIdentity(path,{maxBytes:1}),/budget|bounded/i);
  assert.match(trainingFileIdentity(path,{maxBytes:Number.MAX_SAFE_INTEGER}),/^[a-f0-9]{64}$/);
  assert.equal(await corpusFingerprint(path),'461bf7ceff20c355c1809436fbced736e040c38ca1603844d1c93ba2e3c8a0e3');
  assert.equal(await corpusFingerprint(path,path),'e079930b10851a833853563202854c12d046b91a56ecc0c145f5e268c7e9069e');
  await writeFile(join(root,'source.pdf'),'changed');
  assert.notEqual(await corpusFingerprint(path),'461bf7ceff20c355c1809436fbced736e040c38ca1603844d1c93ba2e3c8a0e3');
  await writeFile(join(root,'annotation.json'),JSON.stringify({origin:'macro-vector-supervision',sourcePdf:'../outside'}));
  await assert.rejects(corpusFingerprint(path),/path|source/i);
});
test('fingerprint stream preserves original single and combined corpus hashes',()=>{
  const path='tests/fixtures/reference-corpus-fingerprint/corpus.json',args=['tools/reference-analysis/training-evidence.mjs','--fingerprint-stream'];
  for(const [auxiliary,expected] of [[null,'461bf7ceff20c355c1809436fbced736e040c38ca1603844d1c93ba2e3c8a0e3'],
    [path,'e079930b10851a833853563202854c12d046b91a56ecc0c145f5e268c7e9069e']]){
    const result=spawnSync(process.execPath,args,{input:JSON.stringify({manifest:path,auxiliary}),encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).fingerprint,expected);
  }
});
