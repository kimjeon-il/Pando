import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {encodeSharedToolkit, installSharedToolkit, verifySharedToolkit,retireSharedToolkit} from '../../tools/shared-toolkit.mjs';

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
test('explicit pinned retirement permits an upgrade and protects active leases and modified files',async()=>{
  const root=await mkdtemp(join(tmpdir(),'map-upgrade-'));
  try{
    const a=encodeSharedToolkit({source,entries:[{path:'tools/example.mjs',data:Buffer.from('old')}]});
    const b=encodeSharedToolkit({source:{...source,revision:'b'.repeat(40)},entries:[{path:'tools/example.mjs',data:Buffer.from('new')}]});
    await installSharedToolkit({root,bytes:a.bytes,pin:a.pin});
    await assert.rejects(installSharedToolkit({root,bytes:b.bytes,pin:b.pin}),/identity/);
    const {mkdir}=await import('node:fs/promises');await mkdir(join(root,'.shared-toolkit-leases'));
    const lease=join(root,'.shared-toolkit-leases',process.pid+'-abc.json');
    await writeFile(lease,JSON.stringify({pid:process.pid}));
    await assert.rejects(retireSharedToolkit({root,pin:a.pin}),/in use/);
    assert.equal(await readFile(join(root,'tools/example.mjs'),'utf8'),'old');
    await rm(lease);await writeFile(join(root,'tools/example.mjs'),'user change');
    await assert.rejects(retireSharedToolkit({root,pin:a.pin}),/modified/);
    await writeFile(join(root,'tools/example.mjs'),'old');
    assert.equal((await retireSharedToolkit({root,pin:a.pin})).logicalBytes,3);
    await installSharedToolkit({root,bytes:b.bytes,pin:b.pin});
    assert.equal(await readFile(join(root,'tools/example.mjs'),'utf8'),'new');
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
