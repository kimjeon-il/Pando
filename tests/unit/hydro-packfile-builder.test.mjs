import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildHydroPackfile,ROLES } from '../../tools/build-hydro-packfile.mjs';

const sha=x=>createHash('sha256').update(x).digest('hex');
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'hydro-builder-'));
 t.after(()=>rmSync(dir,{force:true,recursive:true}));
 const source=join(dir,'v0.13.1'),old=join(dir,'v0.13.0'),output=join(dir,'output');
 mkdirSync(source);mkdirSync(old);
 const original=ROLES.map((name,i)=>{
  const data=Buffer.from('source-'+name),file='part-'+i+'.bin';
  const current=i%2===1;writeFileSync(join(current?source:old,file),data);
  return {url:current?file:'../v0.13.0/'+file,bytes:data.length,sha256:sha(data),
    ...(i>=3?{id:i-3}:{})};
 });
 const manifest={version:'0.13.1',schema:'pandolab-water-shards-v5',format:{pack:4},
 index:original[0],metadata:{core:original[1],detail:{...original[2],lazy:true}},
 shards:original.slice(3),cache:{name:'before'},stats:{compressedBytes:0}};
 writeFileSync(join(source,'manifest.json'),JSON.stringify(manifest));
 return {source,output,original,manifest};
}
test('packing is lossless, ordered, deterministic and source preserving',t=>{
 const f=fixture(t);const r=buildHydroPackfile(f);
 const manifest=JSON.parse(readFileSync(join(f.output,'manifest.json')));
 const binary=readFileSync(join(f.output,'hydro.bin'));
 assert.equal(r.containerSha256,sha(binary));
 assert.equal(manifest.container.bytes,binary.length);
 assert.deepEqual(manifest.container.roles,ROLES);
 let cursor=0;
 for(const [i,v] of [manifest.index,manifest.metadata.core,manifest.metadata.detail,...manifest.shards].entries()){
  assert.equal(v.offset,cursor);assert.equal(v.url,'hydro.bin');
  assert.equal(sha(binary.subarray(cursor,cursor+v.bytes)),f.original[i].sha256);
  cursor+=v.bytes;
 }
 assert.equal(cursor,binary.length);
 assert.equal(buildHydroPackfile({...f,check:true}).status,'checked');
 assert.deepEqual(JSON.parse(readFileSync(join(f.source,'manifest.json'))),f.manifest);
});
test('packfile refuses corrupt inputs, drift, and unsafe paths',t=>{
 const f=fixture(t);
 assert.throws(()=>buildHydroPackfile({...f,check:true}),/differs from committed/);
 assert.throws(()=>buildHydroPackfile({source:f.source,output:f.source}),/must differ/);
 buildHydroPackfile(f);
 writeFileSync(join(f.output,'hydro.bin'),'changed');
 assert.throws(()=>buildHydroPackfile({...f,check:true}),/differs from committed/);
 writeFileSync(join(f.source,'part-1.bin'),'tampered');
 assert.throws(()=>buildHydroPackfile(f),/SHA-256 mismatch/);
});
