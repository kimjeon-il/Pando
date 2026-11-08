import { describe as contractSuite } from 'node:test';
import * as __library_dep0 from "node:test";
import * as __library_dep1 from "node:assert/strict";
import * as __library_dep2_context from "../../tools/data/library-context.mjs";
import * as __library_dep2_reports from "../../tools/data/library-reports.mjs";
import * as __library_dep2_runtime from "../../tools/data/library-runtime.mjs";
import * as __library_dep2_publication from "../../tools/data/library-report-publication.mjs";
import * as __library_dep2_store from "../../tools/data/library-store.mjs";
const __library_dep2={...__library_dep2_context,...__library_dep2_reports,...__library_dep2_runtime,...__library_dep2_publication,...__library_dep2_store};

// Original feature contract: library-data-scope.test.mjs
contractSuite("library-data-scope", () => {
const test = __library_dep0.default;
const assert = __library_dep1.default;
const { assertTerritorialStorageScope, runtimeStoreIndex } = __library_dep2;
const base='assets/data/territorial-entities';
const index=()=>({entities:[{entityId:'state:RUS',file:'state-RUS.json.gz',sha256:'same'}],views:[{id:'world:catalog',selections:[]}]});
test('world view source is paired with generated index, not a nonexistent country chunk',()=>{const i=index();assert.doesNotThrow(()=>assertTerritorialStorageScope([base+'/generated/v2/index.json',base+'/source/views/world.json'],i,i));});
test('world view source still requires its generated index and supported view',()=>{const i=index();assert.throws(()=>assertTerritorialStorageScope([base+'/source/views/world.json'],i,i),/paired index/);assert.throws(()=>assertTerritorialStorageScope([base+'/generated/v2/index.json',base+'/source/views/world.json'],{...i,views:[]},i),/world view/);});
test('changed world view cannot publish without its source',()=>{const i=index(),next={...i,views:[{id:'world:catalog',selections:[{entityId:'state:RUS'}]}]};assert.throws(()=>assertTerritorialStorageScope([base+'/generated/v2/index.json'],next,i),/paired world view source/);});
test('country source/chunk/index pairing and unknown source rejection remain strict',()=>{const i=index(),next={...i,entities:[{...i.entities[0],sha256:'changed'}]};assert.throws(()=>assertTerritorialStorageScope([base+'/generated/v2/index.json'],next,i),/source, chunk and index/);assert.throws(()=>assertTerritorialStorageScope([base+'/generated/v2/index.json',base+'/source/views/evil.json'],i,i),/paired source/);});

test('runtime storage preserves current report additions, edits and removals without importing newer runtime',()=>{
 const pinned={schemaVersion:1,files:{'assets/data/old':{sha256:'pinned'},'reports/edited':{sha256:'old'},'reports/removed':{sha256:'old'}}};
 const current={schemaVersion:1,files:{'assets/data/old':{sha256:'unreviewed'},'assets/data/new':{sha256:'unreviewed'},'reports/edited':{sha256:'new'},'reports/added':{sha256:'added'}}};
 const before=JSON.stringify({pinned,current});
 assert.deepEqual(runtimeStoreIndex(pinned,current).files,{'assets/data/old':{sha256:'pinned'},'reports/edited':{sha256:'new'},'reports/added':{sha256:'added'}});
 assert.equal(JSON.stringify({pinned,current}),before);
});
});

// Original feature contract: library-data-expected-revision.test.mjs
contractSuite("library-data-expected-revision", () => {
const test = __library_dep0.default;
const assert = __library_dep1.default;
const libraryData = __library_dep2;

const expectedRevision = 'a'.repeat(40);
const otherRevision = 'b'.repeat(40);

test('expected revision guard rejects malformed revisions', () => {
  assert.equal(typeof libraryData.assertExpectedLibraryRevision, 'function');
  for (const invalid of ['', 'a'.repeat(39), 'a'.repeat(41), 'g'.repeat(40), null, 123]) {
    assert.throws(() => libraryData.assertExpectedLibraryRevision({ expectedRevision: invalid, head: invalid, remote: invalid }), /40.*hex/i);
  }
});

test('expected revision guard rejects a changed checkout HEAD', () => {
  assert.equal(typeof libraryData.assertExpectedLibraryRevision, 'function');
  assert.throws(() => libraryData.assertExpectedLibraryRevision({ expectedRevision, head: otherRevision, remote: expectedRevision }), /checkout HEAD.*expected revision/i);
});

test('expected revision guard rejects a changed remote publication branch', () => {
  assert.equal(typeof libraryData.assertExpectedLibraryRevision, 'function');
  assert.throws(() => libraryData.assertExpectedLibraryRevision({ expectedRevision, head: expectedRevision, remote: otherRevision }), /remote work\/gis.*expected revision/i);
});

test('expected revision guard permits identical checkout and remote revisions', () => {
  assert.equal(typeof libraryData.assertExpectedLibraryRevision, 'function');
  assert.doesNotThrow(() => libraryData.assertExpectedLibraryRevision({ expectedRevision, head: expectedRevision, remote: expectedRevision }));
});

test('omitted expected revision preserves unguarded storage behavior', () => {
  assert.equal(typeof libraryData.assertExpectedLibraryRevision, 'function');
  assert.doesNotThrow(() => libraryData.assertExpectedLibraryRevision({ head: otherRevision, remote: expectedRevision }));
});

test('storeLibraryData rejects malformed expected revision before preparing storage', () => {
  assert.throws(() => libraryData.storeLibraryData({ root: new URL('./missing-library-root/', import.meta.url).pathname, prefixes: ['assets/data'], expectedRevision: 'invalid' }), /40.*hex/i);
});

test('expected branch permits explicit main and rejects arbitrary or mismatched branch',()=>{
 assert.doesNotThrow(()=>libraryData.assertExpectedLibraryRevision({expectedRevision,expectedBranch:'main',branch:'main',head:expectedRevision,remote:expectedRevision}));
 assert.throws(()=>libraryData.assertExpectedLibraryRevision({expectedRevision,expectedBranch:'evil',head:expectedRevision,remote:expectedRevision}),/branch/i);
 assert.throws(()=>libraryData.assertExpectedLibraryRevision({expectedRevision,expectedBranch:'main',branch:'work/gis',head:expectedRevision,remote:expectedRevision}),/branch/i);
});
});
