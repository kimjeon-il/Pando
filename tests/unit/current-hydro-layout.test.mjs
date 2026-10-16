import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {gzipSync} from 'node:zlib';
import {manifestRoles,auditLayout} from '../../tools/check-current-hydro-layout.mjs';

const hash=x=>createHash('sha256').update(x).digest('hex');
const gitHash=x=>createHash('sha1').update(Buffer.from('blob '+x.length+'\0')).update(x).digest('hex');
const nativeTemplate=JSON.parse(readFileSync(new URL('../../native/assets/world/manifest.json',import.meta.url)));
const activeTemplate=JSON.parse(readFileSync(new URL('../../'+nativeTemplate.hydro.source.path,import.meta.url)));
const main='assets/data/hydro/test-release/';
const native='native/assets/world/hydro/test-release/';
function makeFixture(shardCount=4){
  const root=mkdtempSync(join(tmpdir(),'hydro-current-contract-'));
  const write=(p,data)=>{
    mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),data);
  };
  // Minimal valid current binary index and metadata, decoded by the actual Worker.
  const index=Buffer.alloc(20);index.writeUInt32LE(0x34495741);index.writeUInt16LE(4,4);
  const metadata=Buffer.from(JSON.stringify({version:5,features:[]}));
  const blocks=[index,metadata,metadata,...Array.from({length:shardCount},(_,i)=>Buffer.from('shard '+i))]
    .map(bytes=>gzipSync(bytes,{level:9}));
  const blob=Buffer.concat(blocks);
  let pos=0;
  const records=blocks.map(bytes=>{
    const out={url:activeTemplate.container.url,offset:pos,bytes:bytes.length,sha256:hash(bytes)};
    pos+=bytes.length;return out;
  });
  const manifest={
    ...structuredClone(activeTemplate),
    index:records[0],metadata:{core:records[1],detail:{...records[2],lazy:true}},
    shards:records.slice(3).map((r,i)=>({...r,id:i})),
    container:{...activeTemplate.container,bytes:blob.length,sha256:hash(blob),
      roles:['index','metadata-core','metadata-detail',...Array.from({length:shardCount},(_,i)=>'shard-'+i)]}
  };
  const manifestBytes=Buffer.from(JSON.stringify(manifest)+'\n');
  for(const dir of [main,native]){write(dir+manifest.container.url,blob);write(dir+'manifest.json',manifestBytes);}
  for(const file of ['hydro-shard-store.js','hydro-tile-worker.js'])write('assets/js/workers/'+file,
    readFileSync(new URL('../../assets/js/workers/'+file,import.meta.url)));
  const pin={...nativeTemplate.hydro,path:'hydro/test-release/manifest.json',version:manifest.version,
    bytes:manifestBytes.length,sha256:hash(manifestBytes),gitBlobSha:gitHash(manifestBytes),
    source:{...nativeTemplate.hydro.source,path:main+'manifest.json'}};
  const app={...structuredClone(nativeTemplate),hydro:pin};
  write('native/assets/world/manifest.json',JSON.stringify(app));
  return {root,manifest,blob,manifestBytes,pin,app,write};
}
async function fixture(run,shardCount){const f=makeFixture(shardCount);try{return await run(f);}finally{rmSync(f.root,{recursive:true,force:true});}}

test('declared shard count and offsets determine every container role',async()=>{
  for(const count of [1,4])await fixture(f=>{
    const parts=manifestRoles(f.manifest);
    assert.equal(parts.length,count+3);
    assert.equal(parts.at(-1).offset+parts.at(-1).bytes,f.blob.length);
  },count);
});

test('current native manifest selects the package and real Worker accepts exact mirrored bytes',()=>fixture(async f=>{
  const result=await auditLayout(f.root);
  assert.equal(result.passed,true);
  assert.equal(result.manifestPath,main+'manifest.json');
  assert.equal(result.activeFiles,2);
  assert.equal(result.previousFileCount,0);
  assert.equal(result.nativePinsVerified,1);
  assert.equal(result.roles.length,f.manifest.shards.length+3);
  assert.equal(result.runtime.range.ready,true);
  assert.equal(result.runtime.whole.requests.length,1);
  assert.deepEqual(readFileSync(join(f.root,main+f.manifest.container.url)),f.blob);
}));

test('obsolete native schema is rejected by the canonical native contract',()=>fixture(async f=>{
  f.write('native/assets/world/manifest.json',JSON.stringify({...f.app,version:1}));
  await assert.rejects(auditLayout(f.root),/version|schema/i);
}));

test('retired production files fail strict mode but explicit preflight reports them',()=>fixture(async f=>{
  f.write('assets/data/hydro/v0.13.0/index.bin.gz','archival left-behind');
  await assert.rejects(auditLayout(f.root),/Retired production hydro/);
  const pre=await auditLayout(f.root,{allowRetired:true});
  assert.equal(pre.previousFileCount,1);
  assert.equal(pre.strictRetirement,false);
}));

test('active package rejects undeclared files',()=>fixture(async f=>{
  f.write(main+'extra.bin','junk');
  await assert.rejects(auditLayout(f.root),/missing or undeclared files/);
}));

test('container tampering at unchanged byte length fails',()=>fixture(async f=>{
  const changed=Buffer.from(f.blob);changed[0]^=1;
  f.write(main+f.manifest.container.url,changed);
  await assert.rejects(auditLayout(f.root),/SHA-256 differs/);
}));

test('overlap, gap, missing piece and unsafe URL are rejected',()=>fixture(f=>{
  const changed=structuredClone(f.manifest);
  changed.metadata.core.offset++;
  assert.throws(()=>manifestRoles(changed),/overlapping or missing/);
  changed.metadata.core.offset--;
  changed.shards[1].bytes=0;
  assert.throws(()=>manifestRoles(changed),/overlapping or missing/);
  changed.shards[1].bytes=f.manifest.shards[1].bytes;
  changed.shards[1].url='../legacy.bin';
  assert.throws(()=>manifestRoles(changed),/overlapping or missing/);
}));

test('native pin and actual mirrored payload cannot drift from current Web bytes',()=>fixture(async f=>{
  f.write('native/assets/world/manifest.json',JSON.stringify({...f.app,hydro:{...f.pin,gitBlobSha:'0'.repeat(40)}}));
  await assert.rejects(auditLayout(f.root),/Native app hydro pin/);
  f.write('native/assets/world/manifest.json',JSON.stringify(f.app));
  const changed=Buffer.from(f.blob);changed[0]^=1;
  f.write(native+f.manifest.container.url,changed);
  await assert.rejects(auditLayout(f.root),/Native hydro container bytes differ/);
}));
