import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {encodeSharedToolkit, installSharedToolkit, verifySharedToolkit} from '../../tools/shared-toolkit.mjs';

const source={repository:'kimjeon-il/Pando',revision:'a'.repeat(40)};
test('shared tooling installs a pinned immutable dependency and reuses verified bytes',async()=>{
  const root=await mkdtemp(join(tmpdir(),'map-shared-'));
  try {
    const artifact=encodeSharedToolkit({source,entries:[{path:'tools/example.mjs',data:Buffer.from('export const value=42;\n')}]});
    const first=await installSharedToolkit({root,bytes:artifact.bytes,pin:artifact.pin});
    assert.equal(first.cacheHit,false);
    assert.equal((await installSharedToolkit({root,bytes:artifact.bytes,pin:artifact.pin})).cacheHit,true);
    assert.equal(await readFile(join(root,'tools/example.mjs'),'utf8'),'export const value=42;\n');
    await verifySharedToolkit(root,artifact.pin);
    await writeFile(join(root,'tools/example.mjs'),'changed');
    await assert.rejects(verifySharedToolkit(root,artifact.pin),/hash|identity/i);
    await assert.rejects(installSharedToolkit({root,bytes:artifact.bytes,pin:artifact.pin}),/hash|identity/i);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('shared tooling rejects tampering, path escape, duplicates and unsupported contracts',async()=>{
  const root=await mkdtemp(join(tmpdir(),'map-shared-'));
  try{
    const artifact=encodeSharedToolkit({source,entries:[{path:'tools/example.mjs',data:Buffer.from('ok')}]});
    await assert.rejects(installSharedToolkit({root,bytes:Buffer.from('bad'),pin:artifact.pin}),/hash|identity/i);
    await assert.rejects(installSharedToolkit({root,bytes:artifact.bytes,pin:{...artifact.pin,interfaceVersion:2}}),/interface/i);
    for(const path of ['../escape','tools/../../escape','/absolute','tools\\escape','plugins/pando-map-tools/lib/jobs.mjs'])
      assert.throws(()=>encodeSharedToolkit({source,entries:[{path,data:Buffer.from('x')}]}),/path|ownership/i);
    assert.throws(()=>encodeSharedToolkit({source,entries:[{path:'tools/a',data:Buffer.from('x')},{path:'tools/a',data:Buffer.from('x')}]}),/duplicate/i);
    await writeFile(join(root,'.shared-toolkit.lock'),'active');
    await assert.rejects(installSharedToolkit({root,bytes:artifact.bytes,pin:artifact.pin}),/EEXIST|lock/i);
  }finally{await rm(root,{recursive:true,force:true});}
});
