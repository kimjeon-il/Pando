import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyWeb,verifyApp} from '../../tools/check-retired-hydro.mjs';
const sha='a'.repeat(40),webManifest='b'.repeat(40);
const blob=(path,hash=sha,size=200)=>({path,sha:hash,size,type:'blob'});
const baseItems=[
  blob('assets/data/hydro/v0.13.0/manifest.json'),
  blob('assets/data/hydro/v0.13.0/index.bin.gz'),
  blob('assets/data/hydro/v0.13.0/metadata-core.json.gz'),
  blob('assets/data/hydro/v0.13.0/metadata-detail.json.gz'),
  ...[0,1,2].map(i=>blob('assets/data/hydro/v0.13.0/shards/s'+i+'.bin')),
  blob('assets/data/hydro/v0.13.1/manifest.json',webManifest),
  blob('assets/data/hydro/v0.13.1/metadata-core.json.gz'),
];
const baseline={truncated:false,tree:baseItems};
const current={truncated:false,tree:[...baseItems,blob('tools/restore-archival-hydro.py')]};
test('all retired files absent and exact shared active binaries present',()=>{
  const r=verifyWeb(current,baseline);
  assert.equal(r.retiredFiles,0);assert.equal(r.activeFiles,9);
  assert.equal(r.valid,true);
});
test('an old hydro shard accidentally reintroduced must fail',()=>{
  const r=verifyWeb({...current,tree:[...current.tree,
    blob('assets/data/hydro/v0.12.6/shards/s1.bin')]},baseline);
  assert.equal(r.valid,false);assert.equal(r.retiredFiles,1);
});
test('missing or modified active dataset fails',()=>{
  assert.equal(verifyWeb({...current,tree:current.tree.filter(x=>
    x.path!=='assets/data/hydro/v0.13.0/index.bin.gz')},baseline).valid,false);
  assert.equal(verifyWeb({...current,tree:current.tree.map(x=>
    x.path==='assets/data/hydro/v0.13.1/manifest.json'?{...x,sha:'c'.repeat(40)}:x)},baseline).valid,false);
});
test('active release cannot have extra undocumented files',()=>{
  const r=verifyWeb({...current,tree:[...current.tree,
    blob('assets/data/hydro/v0.13.0/stale-copy.bin')]},baseline);
  assert.equal(r.valid,false);
});
test('native v1 and v2 pins stay valid without embedding retired files',()=>{
  const m={schema:'pandoeditor-world-dataset',version:1,
    hydro:{path:'hydro/v0.13.1/manifest.json',gitBlobSha:webManifest}};
  const tree={truncated:false,tree:[blob('assets/world/hydro/v0.13.1/manifest.json',webManifest)]};
  assert.equal(verifyApp(tree,m,webManifest).valid,true);
  assert.equal(verifyApp(tree,{...m,version:2},webManifest).valid,true);
  assert.equal(verifyApp(tree,{...m,hydro:{...m.hydro,gitBlobSha:sha}},webManifest).valid,false);
  assert.equal(verifyApp({...tree,tree:[...tree.tree,
    blob('assets/world/hydro/v0.12.4/shards/s0.bin')]},m,webManifest).valid,false);
});
