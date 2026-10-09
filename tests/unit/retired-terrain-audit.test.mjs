import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeWebTree,verifyNativeTerrainManifest} from '../../tools/check-retired-terrain.mjs';

const blob=(path,sha,size)=>({path,sha,size,type:'blob'});
const policy=blob('docs/data-url-retention-policy.md','d0549afe76a41d27a69a6fb66d18be89c11cbc93',1268);
const module=blob('assets/js/modules/terrain-manifest.js','419ca1b7e155eb2cd7c81f0ef57a5732084b9416',4697);
const live=Array.from({length:335},(_,i)=>blob('assets/data/terrain/v0.12.6/4/'+i+'-0.webp',
  'a'.repeat(40),i===0?367620534:1));

test('seven branch retirement gate accepts exact current raster and policy',()=>{
  const a=summarizeWebTree([policy,module,...live]);
  assert.equal(a.retiredFiles,0);
  assert.equal(a.currentFiles,335);
  assert.equal(a.currentBytes,367620868);
  assert.equal(a.valid,true);
});
test('any old v0.12.0 tile reintroduced invalidates source',()=>{
  const a=summarizeWebTree([policy,module,...live,
    blob('assets/data/terrain/v0.12.0/manifest.json','c'.repeat(40),1471)]);
  assert.equal(a.retiredFiles,1);
  assert.equal(a.valid,false);
});
test('current terrain tile count and byte sum are strict',()=>{
  assert.equal(summarizeWebTree([policy,module,...live.slice(0,-1)]).valid,false);
  assert.equal(summarizeWebTree([policy,module,...live.map((x,i)=>i?x:{...x,size:x.size+1})]).valid,false);
});
test('policy and worker runtime must retain their reviewed Git Blobs',()=>{
  assert.equal(summarizeWebTree([module,...live]).valid,false);
  assert.equal(summarizeWebTree([policy,{...module,sha:'b'.repeat(40)},...live]).valid,false);
});
test('native app v1/v2 both pin only currently distributed v0.12.6',()=>{
  const a={schema:'pandoeditor-world-dataset',version:1,terrain:{path:'terrain/v0.12.6/manifest.json'}};
  assert.equal(verifyNativeTerrainManifest(a),true);
  assert.equal(verifyNativeTerrainManifest({...a,version:2,terrain:{...a.terrain,
    source:{path:'assets/data/terrain/v0.12.6/manifest.json'}}}),true);
  assert.equal(verifyNativeTerrainManifest({...a,terrain:{path:'terrain/v0.12.0/manifest.json'}}),false);
  assert.equal(verifyNativeTerrainManifest({...a,terrain:{...a.terrain,
    source:{path:'assets/data/terrain/v0.12.0/manifest.json'}}}),false);
});
