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
const main='assets/data/hydro/v0.13.2/';
function makeFixture(){
  const root=mkdtempSync(join(tmpdir(),'hydro-packfile-retirement-'));
  const write=(p,data)=>{
    mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),data);
  };
  const blocks=['index','core','detail','shard0','shard1','shard2'].map(s=>
    gzipSync(Buffer.from('reproducible '+s),{level:9,mtime:0}));
  const blob=Buffer.concat(blocks);
  let pos=0;
  const records=blocks.map(bytes=>{
    const out={url:'hydro.bin',offset:pos,bytes:bytes.length,sha256:hash(bytes)};
    pos+=bytes.length;return out;
  });
  const manifest={
    version:'0.13.2',schema:'pandolab-water-shards-v5',format:{container:1},
    index:records[0],metadata:{core:records[1],detail:{...records[2],lazy:true}},
    shards:records.slice(3).map((r,i)=>({...r,id:i})),
    container:{url:'hydro.bin',bytes:blob.length,sha256:hash(blob),
      format:'byte-concatenated-subresources-v1',
      roles:['index','metadata-core','metadata-detail','shard-0','shard-1','shard-2']}
  };
  write(main+'hydro.bin',blob);
  const manifestBytes=Buffer.from(JSON.stringify(manifest)+'\n');
  write(main+'manifest.json',manifestBytes);
  write('assets/js/modules/app-environment.js',Buffer.from("HYDRO_DATA_VERSION = '0.13.2'"));
  write('scripts/generate-build-metadata.mjs',Buffer.from('assets/data/hydro/v0.13.2/manifest.json'));
  const pin={path:'hydro/v0.13.2/manifest.json',version:'0.13.2',
    bytes:manifestBytes.length,sha256:hash(manifestBytes),gitBlobSha:gitHash(manifestBytes)};
  const app={schema:'pandoeditor-world-dataset',version:1,hydro:pin};
  write('native-world.json',JSON.stringify(app));
  return {root,manifest,blob,manifestBytes,pin,app,appFile:join(root,'native-world.json'),write};
}
function fixture(run){const f=makeFixture();try{return run(f);}finally{rmSync(f.root,{recursive:true,force:true});}}
test('manifest six roles cover the exact concatenated container',()=>fixture(f=>{
  const parts=manifestRoles(f.manifest);
  assert.equal(parts.length,6);
  assert.equal(parts.at(-1).offset+parts.at(-1).bytes,f.blob.length);
}));
test('two real files, current runtime and v1 native pin pass without legacy files',()=>fixture(f=>{
  const result=auditLayout(f.root,{appManifest:[f.appFile]});
  assert.equal(result.passed,true);
  assert.equal(result.activeFiles,2);
  assert.equal(result.previousFileCount,0);
  assert.equal(result.nativePinsVerified,1);
  assert.equal(result.roles.length,6);
}));
test('v2 native pin and archived provenance fields also pass',()=>fixture(f=>{
  f.write('native-world.json',JSON.stringify({...f.app,version:2,hydro:{
    ...f.pin,source:{path:'assets/data/hydro/v0.13.2/manifest.json'}}}));
  assert.equal(auditLayout(f.root,{appManifest:f.appFile}).nativePinsVerified,1);
}));
test('retired v0.13.0/1 file must fail strict mode, but preflight may report it',()=>fixture(f=>{
  f.write('assets/data/hydro/v0.13.0/index.bin.gz','archival left-behind');
  assert.throws(()=>auditLayout(f.root),/Old production hydro/);
  const pre=auditLayout(f.root,{allowRetired:true});
  assert.equal(pre.previousFileCount,1);
  assert.equal(pre.strictRetirement,false);
}));
test('all active files must be exactly manifest plus container',()=>fixture(f=>{
  f.write(main+'extra.bin','junk');
  assert.throws(()=>auditLayout(f.root),/exactly two files/);
}));
test('tampering with container byte at original length fails',()=>fixture(f=>{
  const changed=Buffer.from(f.blob);changed[0]^=1;
  f.write(main+'hydro.bin',changed);
  assert.throws(()=>auditLayout(f.root),/SHA-256 differs/);
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
test('native app cannot silently drift from current manifest',()=>fixture(f=>{
  f.write('native-world.json',JSON.stringify({...f.app,hydro:{...f.pin,gitBlobSha:'0'.repeat(40)}}));
  assert.throws(()=>auditLayout(f.root,{appManifest:f.appFile}),/Native app hydro pin/);
}));

