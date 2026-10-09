import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTree,legacyInventory,compareLegacy,normalizeActiveReference,activeClosure,
  classify,codePaths,parseGrep,decide,VERSIONS} from '../../tools/plan-legacy-hydro-retirement.mjs';

const SHA='a'.repeat(40);
const blob=(path,size=100)=>({type:'blob',path,sha:SHA,size});
const tree=rows=>normalizeTree({truncated:false,tree:rows});
const oldManifests=VERSIONS.map(v=>blob('assets/data/hydro/'+v+'/manifest.json'));
test('never accept truncated trees or invalid size',()=>{
  assert.throws(()=>normalizeTree({truncated:true,tree:[]}),/non-truncated/);
  assert.throws(()=>tree([blob('bad',-1)]),/Invalid blob metadata/);
});
test('inventory is exact per file and uses actual Git metadata',()=>{
  const full=tree([...oldManifests,blob('assets/data/hydro/v0.12.2/packs/a.bin',400)]);
  const original=legacyInventory(full);
  assert.equal(original.fileCount,6);assert.equal(original.byteCount,900);
  assert.equal(compareLegacy(original,full).identical,true);
  assert.equal(compareLegacy(original,tree(oldManifests)).identical,false);
  assert.equal(compareLegacy(original,tree([...oldManifests,blob('assets/data/hydro/v0.12.2/packs/a.bin',401)])).identical,false);
  assert.equal(compareLegacy(original,tree([...oldManifests,{...blob('assets/data/hydro/v0.12.2/packs/a.bin',400),sha:'b'.repeat(40)}])).identical,false);
});
test('active data can reference only v0.13.0 or v0.13.1 paths',()=>{
  assert.equal(normalizeActiveReference('../v0.13.0/shards/s1.bin'),
    'assets/data/hydro/v0.13.0/shards/s1.bin');
  assert.throws(()=>normalizeActiveReference('../v0.12.6/shards/s1.bin'),/obsolete/);
  const a=(url)=>({url,bytes:100,sha256:'b'.repeat(64)});
  const doc={version:'0.13.1',schema:'pandolab-water-shards-v5',
    index:a('../v0.13.0/index.bin.gz'),
    metadata:{core:a('metadata-core.json.gz'),
      detail:a('../v0.13.0/metadata-detail.json.gz')},
    shards:[0,1,2].map(i=>a('../v0.13.0/shards/s'+i+'.bin'))};
  assert.equal(activeClosure(doc).size,6);
  doc.shards[0].url='../v0.12.4/shards/s0.bin';
  assert.throws(()=>activeClosure(doc),/obsolete/);
});
test('historical report input is protected but output-only is not',()=>{
  assert.equal(classify('tools/report-hydro-v0124.py','load_features("v0.12.3")','v0.12.3').kind,'historical-input');
  assert.equal(classify('tools/repack-water-v0125.py','src=hydro/v0.12.4','v0.12.4').kind,'historical-input');
  assert.equal(classify('tools/repack-water-v0125.py','output=hydro/v0.12.5','v0.12.5').kind,'obsolete-generator-output');
  assert.equal(classify('assets/js/modules/hydro-loader.js','hydro/v0.12.6','v0.12.6').kind,'unexpected-consumer');
  assert.equal(classify('tools/build-physical-data.py','v0.12.6 physical map','v0.12.6').kind,'other-version-domain');
});
test('code scan excludes binary data and flags unscanned large source files',()=>{
  const selected=codePaths(tree([blob('tools/a.py'),blob('assets/js/modules/b.js'),
    blob('assets/data/hydro/v0.12.5/manifest.json'),
    blob('tools/large.py',2000000)]));
  assert.deepEqual(selected.files,['assets/js/modules/b.js','tools/a.py']);
  assert.equal(selected.unscanned.length,1);
  assert.equal(selected.unscanned[0].class,'source');
});
test('git grep lines keep exact repo source and version',()=>{
  const matches=parseGrep(SHA+':tools/report-hydro-v0124.py:103:load_features("v0.12.3")\n'+
    SHA+':tools/repack-water-v0125.py:190:output=hydro/v0.12.5\n',SHA);
  assert.equal(matches.length,2);
  assert.equal(matches[0].kind,'historical-input');
  assert.equal(matches[1].kind,'obsolete-generator-output');
});
test('aggregate candidate and deferred counts without deleting',()=>{
  const baseline=legacyInventory(tree(oldManifests));
  const refs=[classify('tools/report-hydro-v0124.py','load_features("v0.12.3")','v0.12.3'),
    classify('tools/repack-water-v0125.py','source v0.12.4','v0.12.4'),
    classify('tools/repack-water-v0125.py','output v0.12.5','v0.12.5')];
  const result=decide(baseline,refs);
  assert.equal(result.candidateFiles,3);
  assert.equal(result.holdFiles,2);
});

test('CI sparse-checkout exclusions and in-memory fixtures are not live hydro consumers',()=>{
  assert.equal(classify('.github/workflows/world-dataset-stage3-gate.yml',
    '            !/assets/data/hydro/v0.12.3/**','v0.12.3').kind,
    'sparse-checkout-exclusion');
  assert.equal(classify('tests/unit/gis-archive-rollout.test.mjs',
    "const fixture='assets/data/hydro/v0.12.2/manifest.json';",'v0.12.2').kind,
    'synthetic-unit-test-reference');
});
