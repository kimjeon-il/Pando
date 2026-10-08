import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {audit,dataRelative,groupOf,duplicateStats,parseGitDataTree,parseGitHubTree} from '../../tools/audit-legacy-gis-assets.mjs';

test('parse tracked blob inventory using Git metadata, not guessed filenames',()=>{
  const a=Buffer.from('100644 blob '+'a'.repeat(40)+' 12\tassets/data/test.json\0');
  assert.equal(parseGitDataTree(a).get('test.json').bytes,12);
  assert.throws(()=>parseGitDataTree(Buffer.from('malformed\0')),/Invalid git/);
});
test('GitHub exact tree metadata accepts complete trees and rejects truncated or missing size',()=>{
  const tree={truncated:false,tree:[{type:'blob',path:'assets/data/file.bin',size:99,sha:'a'.repeat(40)},
    {type:'tree',path:'assets/data/directory',sha:'b'.repeat(40)}]};
  assert.equal(parseGitHubTree(tree).get('file.bin').bytes,99);
  assert.throws(()=>parseGitHubTree({...tree,truncated:true}),/truncated/);
  assert.throws(()=>parseGitHubTree({...tree,tree:[{type:'blob',
    path:'assets/data/broken.bin',sha:'a'.repeat(40)}]}),/metadata/);
});
test('sibling hydro manifests resolve only inside dataset',()=>{
  assert.equal(dataRelative('hydro/v0.13.1/manifest.json','../v0.13.0/shards/s0.bin'),
    'hydro/v0.13.0/shards/s0.bin');
  assert.throws(()=>dataRelative('hydro/v0.13.1/manifest.json','../../../secret'),/traversal/);
  assert.throws(()=>dataRelative('hydro/v0.13.1/manifest.json','https://example.test/path'),/Unsafe/);
});
test('group versions and content-addressed objects without conflating them',()=>{
  assert.equal(groupOf('terrain/v0.12.0/4/1-1.webp'),'terrain/v0.12.0');
  assert.equal(groupOf('hydro/v0.13.0/metadata-detail.json.gz'),'hydro/v0.13.0');
  assert.equal(groupOf('world-mesh-preview-v0.35.0.bin.gz'),'world-mesh-preview/v0.35.0');
  assert.equal(groupOf('world/objects/a.bin.gz'),'world/content-addressed');
  assert.equal(groupOf('territorial-entities/source/countries/foo.json'),null);
});
test('duplicate bytes count is checkout cost, never Git storage saving',()=>{
  const x=new Map([['x',{sha:'a',bytes:10}],['y',{sha:'a',bytes:10}],['z',{sha:'b',bytes:3}]]);
  assert.deepEqual({groups:duplicateStats(x).identicalBlobGroups,bytes:duplicateStats(x).nominalRepeatedFileBytes},
    {groups:1,bytes:10});
});
function fixture(callback){
  const root=mkdtempSync(join(tmpdir(),'pando-stage6-audit-'));
  function put(path,body){
    const full=join(root,path);mkdirSync(dirname(full),{recursive:true});
    writeFileSync(full,typeof body==='string'?body:JSON.stringify(body,null,2)+'\n');
  }
  try{
    put('assets/data/world/current.json',{schema:'pandolab-world-bundle',
      source:{url:'territorial-entities/generated/current-world.geojson'},
      assets:{previewCountries:{url:'world/objects/p.gzip',compressedBytes:1}},
      compatibility:{sharedBoundaries:{preview:'countries-preview-shared-v0.34.0.json.gz'}}});
    put('assets/data/world/build-input.json',{canonicalSource:'territorial-entities/generated/current-world.geojson',
      legacyPreviewManifest:'world-preview-v0.36.0.json',
      sharedBoundaries:{preview:'countries-preview-shared-v0.34.0.json.gz'}});
    put('assets/data/world-preview-v0.36.0.json',{version:'0.36.0',
      assets:{previewCountries:{url:'countries-preview-v0.36.0.geojson.gz',compressedBytes:1}}});
    put('assets/data/world-preview-v0.35.0.json',{version:'0.35.0',
      assets:{previewCountries:{url:'countries-preview-v0.35.0.geojson.gz',compressedBytes:1}}});
    for(const path of ['assets/data/territorial-entities/generated/current-world.geojson',
      'assets/data/territorial-entities/generated/v2/index.json',
      'assets/data/places/manifest.json','assets/data/world/objects/p.gzip',
      'assets/data/countries-preview-v0.36.0.geojson.gz','assets/data/countries-preview-v0.35.0.geojson.gz',
      'assets/data/countries-preview-shared-v0.34.0.json.gz',
      'assets/data/hydro/v0.13.0/index.bin.gz','assets/data/hydro/v0.13.0/shards/s0.bin',
      'assets/data/terrain/v0.12.6/0/0-0.webp',
      'assets/data/terrain/v0.12.0/0/0-0.webp'])put(path,'x');
    put('assets/data/hydro/v0.13.1/manifest.json',{index:{url:'../v0.13.0/index.bin.gz',bytes:1},
      metadata:{core:{url:'metadata-core.json.gz',bytes:1},detail:{url:'../v0.13.0/shards/s0.bin',bytes:1}},
      shards:[{id:0,url:'../v0.13.0/shards/s0.bin',bytes:1}]});
    put('assets/data/hydro/v0.13.1/metadata-core.json.gz','x');
    put('assets/data/terrain/v0.12.6/manifest.json',{urlTemplate:'terrain/v0.12.6/{level}/{column}-{row}.webp',
      levels:[{id:0,columns:1,rows:1}]});
    put('assets/data/terrain/v0.12.0/manifest.json',{urlTemplate:'terrain/v0.12.0/{level}/{column}-{row}.webp',
      levels:[{id:0,columns:1,rows:1}]});
    put('.github/workflows/legacy-exclusion.yml','sparse-checkout:\n  !/assets/data/terrain/v0.12.0/**\n');
    put('assets/js/modules/app-environment.js',"(HYDRO_DATA_VERSION = '0.13.1');");
    put('assets/js/modules/terrain-manifest.js',"export const TERRAIN_RASTER_VERSION = '0.12.6';");
    put('scripts/generate-build-metadata.mjs',"'assets/data/hydro/v0.13.1/manifest.json';\n'assets/data/terrain/v0.12.6/manifest.json';");
    execFileSync('git',['init','-q',root]);
    execFileSync('git',['-C',root,'-c','user.name=Test','-c','user.email=test@example.com','add','-A']);
    execFileSync('git',['-C',root,'-c','user.name=Test','-c','user.email=test@example.com','commit','-qm','fixture']);
    return callback({root,put});
  }finally{rmSync(root,{recursive:true,force:true});}
}
test('full audit retains active hydro parent and current raster, while flagging old raster for review',()=>fixture(({root})=>{
  const a=audit(root);
  assert.equal(a.passed,true);
  assert.equal(a.metadata.terrainTiles,1);
  assert.equal(a.metadata.currentHydroVersion,'0.13.1');
  assert.equal(a.groups.find(x=>x.group==='hydro/v0.13.0').classification,'retain-active-or-native');
  assert.equal(a.groups.find(x=>x.group==='terrain/v0.12.0').classification,'archive-review-not-delete-ready');
  assert.equal(a.groups.find(x=>x.group==='countries-preview/v0.36.0').classification,'retain-active-or-native');
  assert.equal(a.groups.find(x=>x.group==='countries-preview/v0.35.0').classification,'archive-review-not-delete-ready');
}));
test('broken active dependency fails before any removal',()=>fixture(({root,put})=>{
  put('assets/data/hydro/v0.13.1/manifest.json',{index:{url:'../v0.13.0/missing.bin.gz',bytes:1},
    metadata:{core:{url:'metadata-core.json.gz',bytes:1},detail:{url:'../v0.13.0/shards/s0.bin',bytes:1}},
    shards:[{id:0,url:'../v0.13.0/shards/s0.bin',bytes:1}]});
  // The index is read from the worktree but tracked paths are read from the immutable HEAD.
  const a=audit(root);
  assert.equal(a.passed,false);
  assert.match(a.errors.join('\n'),/Missing tracked dependency/);
}));
