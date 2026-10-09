import test from 'node:test';
import assert from 'node:assert/strict';
import {collectWebReferences,collectAppReferences,selectSamples,assess} from '../../tools/audit-legacy-release-consumers.mjs';

const hash=n=>String(n).repeat(40).slice(0,40);
function f(tree,blobs,path,content,sha){
  tree.set(path,{sha,bytes:typeof content==='string'?Buffer.byteLength(content):3});
  if(content!==null)blobs.set(sha,typeof content==='string'?content:JSON.stringify(content));
}
function fixtureWeb(legacy){
  const tree=new Map(),blobs=new Map();
  const code=legacy?'const MANIFEST_URL = "world-preview-v" + APP_VERSION + ".json";':
    'const MANIFEST_URL = "../../data/world/current.json";';
  f(tree,blobs,'package.json',{version:'0.36.0'},hash(1));
  f(tree,blobs,'assets/js/modules/app-environment.js',
    "const HYDRO_DATA_VERSION = '0.13.1';",hash(2));
  f(tree,blobs,'assets/js/modules/terrain-manifest.js',
    "export const TERRAIN_RASTER_VERSION = '0.12.6';",hash(3));
  f(tree,blobs,'assets/js/workers/data-loader-worker.js',code,hash(4));
  const start=legacy?'assets/data/world-preview-v0.36.0.json':'assets/data/world/current.json';
  const manifest=legacy?{source:'territorial-entities/generated/current-world.geojson',
    assets:{previewCountries:{url:'countries-preview-v0.36.0.geojson.gz'}}}:
    {source:{url:'territorial-entities/generated/current-world.geojson'},
      assets:{previewCountries:{url:'world/objects/sha.json.gz'}},
      compatibility:{sharedBoundaries:{preview:'countries-preview-shared-v0.34.0.json.gz'}}};
  f(tree,blobs,start,manifest,hash(5));
  for(const p of ['territorial-entities/generated/current-world.geojson',
    'countries-preview-v0.36.0.geojson.gz',
    'world/objects/sha.json.gz','countries-preview-shared-v0.34.0.json.gz',
    'hydro/v0.13.0/index.bin.gz','hydro/v0.13.0/shards/s0.bin',
    'hydro/v0.13.1/metadata-core.json.gz','terrain/v0.12.6/0/0-0.webp']) {
      tree.set('assets/data/'+p,{sha:hash(9),bytes:3});
  }
  f(tree,blobs,'assets/data/hydro/v0.13.1/manifest.json',{
    index:{url:'../v0.13.0/index.bin.gz',bytes:3},
    metadata:{core:{url:'metadata-core.json.gz',bytes:3},detail:{url:'../v0.13.0/shards/s0.bin',bytes:3}},
    shards:[{id:0,url:'../v0.13.0/shards/s0.bin',bytes:3}]},hash(6));
  f(tree,blobs,'assets/data/terrain/v0.12.6/manifest.json',{
    urlTemplate:'terrain/v0.12.6/{level}/{column}-{row}.webp',
    levels:[{id:0,columns:1,rows:1}]},hash(7));
  return {tree,blobs};
}
test('legacy main branch retains a versioned world and transitive hydro files',()=>{
  const {tree,blobs}=fixtureWeb(true);
  const r=collectWebReferences(tree,blobs,'main');
  assert.equal(r.worldContract,'versioned-legacy');
  assert.equal(r.unknown.length,0);
  assert.ok(r.references.some(x=>x.asset==='countries-preview-v0.36.0.geojson.gz'));
  assert.ok(r.references.some(x=>x.asset==='hydro/v0.13.0/index.bin.gz'));
  assert.ok(r.references.some(x=>x.asset==='terrain/v0.12.6/0/0-0.webp'));
});
test('GIS SHA loader references bundle and compatible shared boundary',()=>{
  const {tree,blobs}=fixtureWeb(false);
  const r=collectWebReferences(tree,blobs,'work/gis');
  assert.equal(r.worldContract,'sha-bundle');
  assert.equal(r.unknown.length,0);
  assert.ok(r.references.some(x=>x.asset==='world/objects/sha.json.gz'));
  assert.ok(r.references.some(x=>x.asset==='countries-preview-shared-v0.34.0.json.gz'));
});
test('App v1 infers source path from bundled asset and checks Git blob',()=>{
  const tree=new Map(),blobs=new Map();
  const webTree=new Map([['assets/data/countries-preview-v0.33.0.geojson.gz',{sha:hash(9),bytes:9}]]);
  f(tree,blobs,'assets/world/manifest.json',{
    schema:'pandoeditor-world-dataset',version:1,
    countryPreview:{path:'countries-preview-v0.33.0.geojson.gz',gitBlobSha:hash(9),bytes:9}
  },hash(8));
  const r=collectAppReferences(tree,blobs,'main',webTree);
  assert.equal(r.unknown.length,0);assert.equal(r.referenceCount,1);
  assert.equal(r.references[0].asset,'countries-preview-v0.33.0.geojson.gz');
});
test('App v2 uses explicit source.path instead of bundled name',()=>{
  const tree=new Map(),blobs=new Map();
  const webTree=new Map([['assets/data/countries-canonical-v0.33.0.pcg.gz',{sha:hash(9),bytes:9}]]);
  f(tree,blobs,'assets/world/manifest.json',{
    schema:'pandoeditor-world-dataset',version:2,
    countryCanonical:{path:'world/objects/h.bin',source:{path:'assets/data/countries-canonical-v0.33.0.pcg.gz'},
      gitBlobSha:hash(9),bytes:9}
  },hash(8));
  const r=collectAppReferences(tree,blobs,'work/gis',webTree);
  assert.equal(r.unknown.length,0);
  assert.equal(r.references[0].asset,'countries-canonical-v0.33.0.pcg.gz');
});
test('archive samples are real manifest and a tile/chunk from each group',()=>{
  const tree=new Map([
    ['assets/data/terrain/v0.12.0/manifest.json',{sha:hash(1),bytes:50}],
    ['assets/data/terrain/v0.12.0/0/0-0.webp',{sha:hash(2),bytes:100}],
    ['assets/data/terrain/v0.12.0/0/0-1.webp',{sha:hash(3),bytes:100}]
  ]);
  const a=selectSamples({groups:[{group:'terrain/v0.12.0',classification:'archive-review-not-delete-ready',files:3}]},tree);
  assert.equal(a.length,1);
  assert.deepEqual(a[0].samples,['terrain/v0.12.0/0/0-0.webp','terrain/v0.12.0/manifest.json']);
});
test('cross-branch consumers and public URL prevent deletion',()=>{
  const s={passed:true,gitHead:hash(1),groups:[
    {group:'hydro/v0.12.4',classification:'archive-review-not-delete-ready',files:5,bytes:400},
    {group:'terrain/v0.12.0',classification:'archive-review-not-delete-ready',files:335,bytes:2000},
    {group:'world-mesh-preview/v0.30.0',classification:'archive-review-not-delete-ready',files:1,bytes:100}
  ]};
  const evidence={schema:'pando-legacy-release-evidence',
    webBranches:[{references:[{asset:'hydro/v0.12.4/index.bin.gz',exists:true}],unknown:[]}],
    appBranches:[{references:[],unknown:[]}],appReleases:{count:2},pages:{},
    publicProbes:[{group:'terrain/v0.12.0',status:200,ok:true,url:'https://example.test/old.webp'}]};
  const r=assess(s,evidence);
  assert.equal(r.passed,true);assert.equal(r.deleteReadyFiles,0);
  assert.equal(r.groups[0].state,'retain-web-branch-consumer');
  assert.equal(r.groups[1].state,'published-legacy-url-no-retention-guarantee');
  assert.equal(r.groups[2].state,'archive-review-blocked');
  assert.equal(r.candidateFiles,341);
});
test('404 alone never means a legacy asset is safe to delete',()=>{
  const s={passed:true,gitHead:hash(1),groups:[{group:'world-mesh/v0.10.2',classification:'archive-review-not-delete-ready',
    files:1,bytes:100}]};
  const e={schema:'pando-legacy-release-evidence',webBranches:[{references:[],unknown:[]}],
    appBranches:[{references:[],unknown:[]}],appReleases:{count:0},pages:{api:'unavailable'},
    publicProbes:[{group:'world-mesh/v0.10.2',status:404,ok:false}]};
  const r=assess(s,e);
  assert.equal(r.groups[0].state,'archive-review-blocked');
  assert.equal(r.deleteReadyFiles,0);
});
test('missing pinned branch sources fail closed',()=>{
  const s={passed:true,gitHead:hash(1),groups:[]};
  const e={schema:'pando-legacy-release-evidence',webBranches:[{references:[],unknown:[{type:'source-missing'}]}],
    appBranches:[{references:[],unknown:[]}],appReleases:{count:0},pages:{},publicProbes:[]};
  assert.equal(assess(s,e).passed,false);
});
