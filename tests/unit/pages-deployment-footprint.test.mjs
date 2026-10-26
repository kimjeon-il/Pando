import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeGitTree} from '../../tools/lib/git-tree.mjs';
import {pinnedWorldPaths,validateArchiveLock,buildPublicationProfile,finalStage9Plan} from '../../tools/plan-pages-deployment-footprint.mjs';

const sha=n=>String(n).repeat(40).slice(0,40);
function sample(){
  const tree=new Map(),put=(path,bytes,gitBlob=sha(1))=>tree.set(path,{bytes,sha:gitBlob});
  put('index.html',200);put('.nojekyll',0);
  put('assets/js/gis-io.js',200);
  put('assets/js/vendor/gdal/gdal3WebAssembly.wasm',28219835);
  put('assets/js/vendor/gdal/gdal3WebAssembly.data',11595145);
  put('assets/js/workers/data-loader-worker.js',2000);
  put('assets/css/app.css',40);put('assets/fonts/regular.woff2',1000);
  put('assets/data/hydro/v0.13.0/index.bin.gz',100);
  put('assets/data/hydro/v0.13.1/manifest.json',150);
  put('assets/data/hydro/v0.13.2/manifest.json',150);
  put('assets/data/hydro/v0.13.2/hydro.bin',400);
  put('assets/data/terrain-preview/v0.13.3-p2/manifest.json',100);
  put('assets/data/terrain-preview/v0.13.3-p2/0/0-0.webp',150);
  put('assets/data/territorial-entities/generated/v2/index.json',200);
  put('assets/data/territorial-entities/generated/v2/state-USA.json.gz',300);
  put('assets/data/territorial-entities/generated/current-world.geojson',12000000);
  put('assets/data/world/objects/countries-sha256-hash.bin.gz',1000);
  put('assets/data/places/manifest.json',108);
  put('assets/data/world-preview-v0.36.0.json',300);
  put('assets/data/countries-preview-v0.36.0.geojson.gz',200);
  put('assets/data/countries-canonical-v0.33.0.pcg.gz',200);
  put('assets/data/country-label-anchors-v0.10.1.json',108);
  put('assets/data/countries-preview-shared-v0.34.0.json.gz',100);
  put('assets/data/countries-canonical-shared-v0.34.0.json.gz',100);
  const old=['assets/data/hydro/v0.12.2/manifest.json','assets/data/terrain/v0.12.0/0/0-0.webp'];
  put(old[0],200,sha(2));put(old[1],800,sha(3));
  // Published without serving these private generator inputs.
  put('assets/data/territorial-entities/source/countries/foo.json',50000000);
  put('assets/data/hydro/rivers_base.geojson',15000000);
  put('reports/places/study.geojson',10000000);
  const lock={schema:'pandolab-gis-archive-delete-lock',version:1,sourceCommit:sha(4),
    groups:2,totalFiles:2,totalBytes:1000,
    files:[{path:old[0],gitBlob:sha(2),bytes:200,group:'hydro/v0.12.2'},
      {path:old[1],gitBlob:sha(3),bytes:800,group:'terrain/v0.12.0'}]};
  const required=['assets/data/world-preview-v0.36.0.json',
    'assets/data/countries-preview-v0.36.0.geojson.gz',
    'assets/data/countries-canonical-v0.33.0.pcg.gz'];
  return {tree,lock,required,old};
}
test('current preview and world bundle pin every source and asset URL',()=>{
  const preview={version:'0.36.0',source:'territorial-entities/generated/current-world.geojson',
    assets:{previewCountries:{url:'countries-preview-v0.36.0.geojson.gz'}}};
  const bundle={schema:'pandolab-world-bundle',schemaVersion:1,
    source:{url:'territorial-entities/generated/current-world.geojson'},
    assets:{canonicalCountryPacket:{url:'world/objects/countries-canonical-sha256-hash.pcg.gz'}}};
  const paths=pinnedWorldPaths(preview,bundle);
  for(const path of ['.nojekyll','assets/data/world/current.json',
    'assets/data/countries-preview-v0.36.0.geojson.gz',
    'assets/data/world/objects/countries-canonical-sha256-hash.pcg.gz',
    'assets/data/territorial-entities/generated/current-world.geojson'])assert.ok(paths.includes(path),path);
});
test('reject untrusted manifest paths and incomplete current world bundles',()=>{
  const preview={version:'0.36.0',assets:{test:{url:'safe.bin'}}};
  const bundle={schema:'pandolab-world-bundle',schemaVersion:1,
    source:{url:'source.geojson'},assets:{test:{url:'world/objects/safe.bin'}}};
  assert.throws(()=>pinnedWorldPaths({...preview,assets:{test:{url:'../../secrets'}}},bundle),/Invalid tracked/);
  assert.throws(()=>pinnedWorldPaths(preview,{...bundle,source:{url:'../../secrets'}}),/Invalid tracked/);
  assert.throws(()=>pinnedWorldPaths(preview,{...bundle,source:null}),/Invalid current world bundle/);
});
test('profile includes old URLs, GDAL engine and all generated library files',()=>{
  const {tree,lock,required}=sample();
  const r=buildPublicationProfile(tree,lock,required);
  assert.equal(r.archive.files,2);
  assert.equal(r.protectedFeatures.fullGDALRuntime,true);
  assert.equal(r.protectedFeatures.gdalRuntimeBytes,39814980);
  assert.ok(r.fileManifest.some(x=>x.path.endsWith('/state-USA.json.gz')));
  assert.ok(r.fileManifest.some(x=>x.path==='assets/data/world/objects/countries-sha256-hash.bin.gz'));
  assert.ok(r.excluded['territorial-source-build-only'].bytes===50000000);
  assert.ok(r.excluded['hydro-name-and-build-sources'].bytes===15000000);
  assert.equal(r.diagnosticOnlyAlternatives[0].wouldKeepAllCriticalWebFunctions,true);
  assert.equal(r.diagnosticOnlyAlternatives[1].wouldBreakGISImport,true);
});
test('failure to include any hard pinned world path stops publication',()=>{
  const {tree,lock,required}=sample();
  tree.delete('assets/data/countries-canonical-v0.33.0.pcg.gz');
  assert.throws(()=>buildPublicationProfile(tree,lock,required),/Missing verified-world-pin/);
});
test('missing GDAL WebAssembly blocks a claim of full GIS import',()=>{
  const {tree,lock,required}=sample();
  tree.delete('assets/js/vendor/gdal/gdal3WebAssembly.wasm');
  assert.throws(()=>buildPublicationProfile(tree,lock,required),/Mandatory Web runtime/);
});
test('missing terrain or historical catalog index blocks artifact',()=>{
  const {tree,lock,required}=sample();
  tree.delete('assets/data/territorial-entities/generated/v2/index.json');
  assert.throws(()=>buildPublicationProfile(tree,lock,required),/Mandatory Web runtime/);
});
test('size gate uses *uncompressed listed files*, never packed tar.gz size',()=>{
  const {tree,lock,required}=sample();
  tree.set('assets/data/terrain-preview/v0.13.3-p2/0/0-0.webp',{sha:sha(9),bytes:1000000001});
  const p=buildPublicationProfile(tree,lock,required);
  assert.equal(p.budget.withinLimit,false);
  assert.equal(p.budget.overByBytes,p.budget.includedBytes-1000000000);
  assert.equal(p.diagnosticOnlyAlternatives[1].approvedForDeployment,false);
});
test('stage8 immutable archive list fails if one public URL file differs',()=>{
  const {tree,lock}=sample();
  const main=new Map(tree),gis=new Map(tree);
  const many=Array.from({length:2124},(_,i)=>({
    path:'assets/data/hydro/v0.12.2/packs/p'+i+'.bin.gz',
    gitBlob:sha(2),bytes:i===0?564186877:1,group:'group-'+(i%26)
  }));
  lock.groups=26;lock.files=many;lock.totalFiles=2124;lock.totalBytes=564189000;
  for(const e of many){main.set(e.path,{bytes:e.bytes,sha:e.gitBlob});
    gis.set(e.path,{bytes:e.bytes,sha:e.gitBlob});}
  assert.equal(validateArchiveLock(lock,main,gis).verifiedBothTrees,true);
  gis.get(many[5].path).sha=sha(8);
  assert.throws(()=>validateArchiveLock(lock,main,gis),/Locked URL path differs/);
});
test('post-cutover and destructive cleanup remain unauthorized even if under limit',()=>{
  const {lock}=sample();
  const rows={archive:{files:2124},budget:{includedBytes:20,overByBytes:0}};
  const x=finalStage9Plan({...rows,name:'main'},{...rows,name:'gis'},
    {...lock,totalFiles:2124},{mainSha:sha(1),gisSha:sha(2)});
  assert.equal(x.eligibleForPagesCutover,false);
  assert.equal(x.eligibleForLegacyDeletion,false);
  assert.equal(x.writesPerformed,false);
  assert.equal(x.profiles.every(p=>p.eligibleForDeployment===false),true);
});
test('truncated remote tree or missing manifest is never accepted',()=>{
  assert.throws(()=>normalizeGitTree({truncated:true,tree:[]}),/non-truncated/);
  const {tree,lock,required}=sample();tree.delete('index.html');
  assert.throws(()=>buildPublicationProfile(tree,lock,required),/Bootstrap or mandatory URL coverage incomplete/);
});
