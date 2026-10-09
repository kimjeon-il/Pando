import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyWeb,verifyApp} from '../../tools/check-retired-hydro.mjs';
const sha='a'.repeat(40),webManifest='b'.repeat(40),webBin='c'.repeat(40);
const blob=(path,hash=sha,size=200)=>({path,sha:hash,size,type:'blob'});
const active=[
  blob('assets/data/hydro/v0.13.2/manifest.json',webManifest),
  blob('assets/data/hydro/v0.13.2/hydro.bin',webBin,11974120),
];
const baseline={truncated:false,tree:active};
const web={truncated:false,tree:[...active,blob('tools/restore-archival-hydro.py')]};
test('only two current Hydro files are valid with historical restoration present',()=>{
  const result=verifyWeb(web,baseline);
  assert.equal(result.activeFiles,2);
  assert.equal(result.retiredFiles,0);
  assert.equal(result.valid,true);
});
test('both earlier retirement generations are forbidden',()=>{
  for(const version of ['v0.12.6','v0.13.0','v0.13.1']){
    const path='assets/data/hydro/'+version+'/index.bin.gz';
    const result=verifyWeb({...web,tree:[...web.tree,blob(path)]},baseline);
    assert.equal(result.valid,false,version);
    assert.equal(result.retiredFiles,1,version);
  }
});
test('missing, modified or undocumented active binary is rejected',()=>{
  assert.equal(verifyWeb({...web,tree:web.tree.filter(x=>
    x.path!=='assets/data/hydro/v0.13.2/hydro.bin')},baseline).valid,false);
  assert.equal(verifyWeb({...web,tree:web.tree.map(x=>
    x.path.endsWith('v0.13.2/manifest.json')?{...x,sha:sha}:x)},baseline).valid,false);
  assert.equal(verifyWeb({...web,tree:[...web.tree,
    blob('assets/data/hydro/v0.13.2/stale-copy.bin')]},baseline).valid,false);
  assert.equal(verifyWeb({...web,tree:web.tree.filter(x=>
    x.path!=='tools/restore-archival-hydro.py')},baseline).valid,false);
});
test('all native v1/v2 pins and exact container must match current web',()=>{
  const world={schema:'pandoeditor-world-dataset',version:1,hydro:{
    path:'hydro/v0.13.2/manifest.json',version:'0.13.2',gitBlobSha:webManifest}};
  const current={truncated:false,tree:[
    blob('assets/world/hydro/v0.13.2/manifest.json',webManifest),
    blob('assets/world/hydro/v0.13.2/hydro.bin',webBin,11974120),
  ]};
  assert.equal(verifyApp(current,world,webManifest,webBin).valid,true);
  assert.equal(verifyApp(current,{...world,version:2},webManifest,webBin).valid,true);
  assert.equal(verifyApp(current,{...world,hydro:{...world.hydro,gitBlobSha:sha}},webManifest,webBin).valid,false);
  assert.equal(verifyApp({...current,tree:current.tree.map(x=>x.path.endsWith('/hydro.bin')?
    {...x,sha}:x)},world,webManifest,webBin).valid,false);
  assert.equal(verifyApp({...current,tree:[...current.tree,
    blob('assets/world/hydro/v0.13.1/manifest.json')]},world,webManifest,webBin).valid,false);
});
