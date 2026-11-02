import test from 'node:test';
import assert from 'node:assert/strict';
import {assertTerritorialStorageScope,runtimeStoreIndex} from '../../tools/library-data.mjs';
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
