import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {gzipSync} from 'node:zlib';
import {resolveHydroUrl,manifestRoles,inspectContracts,auditLayout} from '../../tools/check-current-hydro-layout.mjs';

const hash=x=>createHash('sha256').update(x).digest('hex');
const gitHash=x=>createHash('sha1').update(Buffer.from('blob '+x.length+'\0')).update(x).digest('hex');
const oldDir='assets/data/hydro/v0.13.0/';
const newDir='assets/data/hydro/v0.13.1/';
function fixture(){
  const root=mkdtempSync(join(tmpdir(),'active-hydro-'));
  const create=(p,data)=>{
    mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),data);
    return {url:p.split('/').slice(-1)[0],bytes:data.length,sha256:hash(data)};
  };
  const packed=(p,content)=>create(p,gzipSync(Buffer.from(content),{level:9}));
  const index=packed(oldDir+'index.bin.gz','test spatial index');
  const oldCore=packed(oldDir+'metadata-core.json.gz','test old names');
  const detail=packed(oldDir+'metadata-detail.json.gz','test shared detail');
  const shards=[0,1,2].map(i=>({...create(oldDir+'shards/s'+i+'.bin',
    Buffer.from('test shared map segment '+i)),id:i,url:'shards/s'+i+'.bin'}));
  const previous={version:'0.13.0',schema:'pandolab-water-shards-v5',
    stages:[{id:0,minZoom:6}],format:{pack:4,index:4,metadata:5},
    layers:{rivers:true},index,metadata:{featureCount:3,core:oldCore,detail},
    shards};
  const current=structuredClone(previous);current.version='0.13.1';
  const core=packed(newDir+'metadata-core.json.gz','test renamed rivers');
  current.index.url='../v0.13.0/index.bin.gz';
  current.metadata.core=core;
  current.metadata.detail.url='../v0.13.0/metadata-detail.json.gz';
  current.shards=current.shards.map(x=>({...x,url:'../v0.13.0/'+x.url}));
  writeFileSync(join(root,oldDir,'manifest.json'),JSON.stringify(previous)+'\n');
  writeFileSync(join(root,newDir,'manifest.json'),JSON.stringify(current)+'\n');
  create('assets/js/modules/app-environment.js',
    Buffer.from("HYDRO_DATA_VERSION = '0.13.1'"));
  create('scripts/generate-build-metadata.mjs',
    Buffer.from("assets/data/hydro/v0.13.1/manifest.json"));
  const manifest=readFileSync(join(root,newDir,'manifest.json'));
  const appFile=join(root,'app-manifest.json');
  const pin={schema:'pandoeditor-world-dataset',version:2,hydro:{
    path:'hydro/v0.13.1/manifest.json',version:'0.13.1',bytes:manifest.length,
    sha256:hash(manifest),gitBlobSha:gitHash(manifest)}};
  writeFileSync(appFile,JSON.stringify(pin));
  return {root,previous,current,appFile,pin};
}
function withFixture(run){
  const f=fixture();try{return run(f);}finally{rmSync(f.root,{recursive:true,force:true});}
}

test('resolve nested previous-version dependencies but never escape hydro root',()=>{
  assert.equal(resolveHydroUrl('hydro/v0.13.1/manifest.json',
    '../v0.13.0/shards/s1.bin'),'hydro/v0.13.0/shards/s1.bin');
  for(const invalid of ['/hydro/other','../../out.bin','https://bad',
    '../v0.12.6/index.bin.gz','../v0.13.0/x?hash=a','..\\v0.13.0\\x']) {
    assert.throws(()=>resolveHydroUrl('hydro/v0.13.1/manifest.json',invalid));
  }
});
test('manifest role graph reuses five physical previous assets',()=>withFixture(f=>{
  assert.equal(manifestRoles(f.current,'hydro/v0.13.1/manifest.json').size,6);
  const result=inspectContracts(f.previous,f.current);
  assert.deepEqual(result.reused.map(x=>x.role),['index','metadata-detail','shard-0','shard-1','shard-2']);
  assert.equal(result.unique.length,1);
  assert.ok(result.avoidedDuplicateBytes>0);
}));
test('shared GIS geometry cannot silently change or be duplicated',()=>withFixture(f=>{
  const copied=structuredClone(f.current);
  copied.shards[0].url='shards/s0.bin';
  assert.throws(()=>inspectContracts(f.previous,copied),/copied or changed/);
  const mismatch=structuredClone(f.current);
  mismatch.index.sha256='1'.repeat(64);
  assert.throws(()=>inspectContracts(f.previous,mismatch),/copied or changed/);
  const changed=structuredClone(f.current);
  changed.stages=[{id:1}];
  assert.throws(()=>inspectContracts(f.previous,changed),/contract changed/);
}));
test('read-only actual file audit checks bytes, gzip benchmark and native pin',()=>withFixture(f=>{
  const a=auditLayout(f.root,{appManifest:f.appFile});
  assert.equal(a.passed,true);
  assert.equal(a.binaryFilesChecked,7);
  assert.equal(a.currentReleaseFiles,2);
  assert.equal(a.previousReleaseFiles,7);
  assert.equal(a.reusedRoles.length,5);
  assert.equal(a.compressionBenchmark.length,4);
  assert.equal(a.nativePinVerified,true);
  assert.deepEqual(a.previousOrphanCandidates,[]);
}));
test('tampered data fails exact SHA-256 even when stored byte length stays equal',()=>withFixture(f=>{
  const target=join(f.root,oldDir,'shards/s0.bin');
  const original=readFileSync(target);
  writeFileSync(target,Buffer.alloc(original.length,0));
  assert.throws(()=>auditLayout(f.root),/SHA-256 mismatch/);
}));
test('unreferenced new-release binary is rejected, old-release extra is reported only',()=>withFixture(f=>{
  mkdirSync(join(f.root,newDir,'shards'),{recursive:true});
  writeFileSync(join(f.root,newDir,'shards/duplicate.bin'),'junk');
  assert.throws(()=>auditLayout(f.root),/Unreferenced binary copies/);
  rmSync(join(f.root,newDir,'shards'),{recursive:true});
  writeFileSync(join(f.root,oldDir,'legacy.bin'),'old');
  const a=auditLayout(f.root);
  assert.deepEqual(a.previousOrphanCandidates,['hydro/v0.13.0/legacy.bin']);
}));
test('native app manifest must pin the exact current bytes and Git Blob',()=>withFixture(f=>{
  writeFileSync(f.appFile,JSON.stringify({...f.pin,hydro:{...f.pin.hydro,bytes:7}}));
  assert.throws(()=>auditLayout(f.root,{appManifest:f.appFile}),/Native app pinned/);
}));
