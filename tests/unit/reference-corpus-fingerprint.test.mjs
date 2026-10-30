import assert from 'node:assert/strict';
import {cp,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {corpusFingerprint} from '../../tools/reference-analysis/training-evidence.mjs';

test('corpus fingerprint matches the original for one or two corpora and includes source bytes',async t=>{
  const root=await mkdtemp(join(tmpdir(),'pando-corpus-fingerprint-'));t.after(()=>rm(root,{recursive:true}));
  await cp('tests/fixtures/reference-corpus-fingerprint',root,{recursive:true});
  const path=join(root,'corpus.json');
  assert.equal(await corpusFingerprint(path),'461bf7ceff20c355c1809436fbced736e040c38ca1603844d1c93ba2e3c8a0e3');
  assert.equal(await corpusFingerprint(path,path),'e079930b10851a833853563202854c12d046b91a56ecc0c145f5e268c7e9069e');
  await writeFile(join(root,'source.pdf'),'changed');
  assert.notEqual(await corpusFingerprint(path),'461bf7ceff20c355c1809436fbced736e040c38ca1603844d1c93ba2e3c8a0e3');
  await writeFile(join(root,'annotation.json'),JSON.stringify({origin:'macro-vector-supervision',sourcePdf:'../outside'}));
  await assert.rejects(corpusFingerprint(path),/path|source/i);
});
