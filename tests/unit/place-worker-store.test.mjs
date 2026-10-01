import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { placeView } from '../helpers/place-view.mjs';
import { createPlaceWorkerStore, readPlaceResponse } from '../../assets/js/modules/place-worker-store.js';
import { normalizePlace, PLACE_LIMITS } from '../../assets/js/modules/place-contract.js';
import { encodePlaceTile } from '../../assets/js/modules/place-codec.js';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const records = Array.from({ length: 20 }, (_, i) => normalizePlace({ source: 'synthetic', sourceId: String(i), name: `서울 ${i}`, coordinates: [127 + i / 100, 37], kind: 'city', minZoom: 0, priority: i }));
function fixture() {
  const bytes = new Uint8Array(encodePlaceTile(records));
  const row = { shard: 's', offset: 0, length: bytes.length, sha256: sha256(bytes) };
  const manifest = { version: 1, revision: 'test', stages: [{ id: 0, minZoom: 0, columns: 1, rows: 1 }], tiles: { '0/0-0': row }, shards: { s: { url: 's.bin', bytes: bytes.length } }, search: { '서울': [{ ...row, first: '서울', last: '서울\uffff' }] } };
  return { bytes, manifest };
}
test('Worker queries wrapped tile window and returns bounded canonical records', async () => {
  const { bytes, manifest } = fixture(); let requests = 0;
  const store = createPlaceWorkerStore({ manifest, fetchBytes: async () => { requests++; return bytes; } });
  const a = await store.queryViewport(placeView({ projection: 'flat', threshold: 10, flatCenter: [180, 0], width: 400, height: 400, scale: 1000 }));
  const b = await store.queryViewport(placeView({ projection: 'flat', threshold: 10, flatCenter: [-180, 0], width: 400, height: 400, scale: 1000 }));
  assert.equal(a.signature, b.signature); assert.equal(a.records.length, 0); assert.equal(requests, 1);
  const visible=await store.queryViewport(placeView({projection:'flat',threshold:10,flatCenter:[127,37],width:400,height:400,scale:1000}));
  assert.equal(visible.records.length,20);assert.equal(visible.records[0].priority,19);
  assert.equal((await store.search('서울 19')).records[0].name, '서울 19');
  assert.equal(store.stats().cachedTiles, 1);
});
test('Worker cache evicts by combined byte budget and never caches oversized tile data', async () => {
  const { bytes, manifest } = fixture();
  const store = createPlaceWorkerStore({ manifest, cacheBytes: bytes.length + 1, fetchBytes: async () => bytes });
  await store.queryViewport(placeView({ threshold: 1 })); assert.ok(store.stats().cacheBytes <= bytes.length + 1);
  const bad = createPlaceWorkerStore({ manifest, fetchBytes: async () => new Uint8Array(PLACE_LIMITS.shardBytes + 1) });
  await assert.rejects(bad.queryViewport(placeView({ threshold: 1 })), /length|budget/u);
  assert.equal(bad.stats().cacheBytes, 0);
});
test('Worker cancellation stops fetching and failures propagate with place operation context', async () => {
  const { manifest } = fixture(); const store = createPlaceWorkerStore({ manifest, fetchBytes: async () => { throw new Error('offline'); } });
  await assert.rejects(store.queryViewport(placeView({ threshold: 1 })), /offline/u);
  await assert.rejects(store.queryViewport(placeView({ threshold: 1 }), { throwIfCancelled() { throw Object.assign(new Error('cancelled'), { name: 'AbortError' }); } }), /cancelled/u);
});
test('Worker validates manifest budgets before allocating or fetching', () => {
  const { manifest } = fixture();
  assert.throws(() => createPlaceWorkerStore({ manifest: { ...manifest, shards: { s: { url: 's.bin', bytes: PLACE_LIMITS.shardBytes + 1 } } } }));
  assert.throws(() => createPlaceWorkerStore({ manifest: { ...manifest, version: 2 } }));
  assert.throws(() => createPlaceWorkerStore({ manifest: { ...manifest, tiles: { '0/0-0': { ...manifest.tiles['0/0-0'], sha256: '' } } } }), /hash/u);
});
test('viewport culling happens before candidate cap so offscreen priority cannot starve visible places',async()=>{
  const offscreen=Array.from({length:20},(_,i)=>normalizePlace({source:'synthetic',sourceId:`off-${i}`,name:'Offscreen',kind:'city',coordinates:[120,30],priority:100}));
  const visible=normalizePlace({source:'synthetic',sourceId:'visible',name:'Visible',kind:'city',coordinates:[0,0],priority:1});
  const bytes=new Uint8Array(encodePlaceTile([...offscreen,visible]));
  const {manifest}=fixture();manifest.shards.s.bytes=bytes.length;manifest.tiles['0/0-0'].length=bytes.length;manifest.tiles['0/0-0'].sha256=sha256(bytes);manifest.search={};
  const store=createPlaceWorkerStore({manifest,fetchBytes:async()=>bytes});
  const result=await store.queryViewport(placeView({projection:'flat',threshold:10,flatCenter:[0,0],width:400,height:400,scale:1000}));
  assert.deepEqual(result.records.map(record=>record.id),[visible.id]);
  assert.ok(store.stats().peakWorkingRecords <= PLACE_LIMITS.candidates+4*PLACE_LIMITS.tileRecords);
});
test('dense overscan tiles cannot consume the cap ahead of an on-screen place',async()=>{
  const manifest={version:1,revision:'dense',stages:[{id:0,minZoom:0,columns:512,rows:1}],tiles:{},shards:{},search:{}};
  const shards=new Map();
  for(const [x,lon] of [[253,-2.1],[254,-1.3],[256,0],[257,1.3],[258,2.1]]){
    const records=Array.from({length:lon===0?1:512},(_,i)=>normalizePlace({source:'synthetic',sourceId:`${x}-${i}`,name:'Place',kind:'city',coordinates:[lon,0],priority:lon===0?1:100}));
    const bytes=new Uint8Array(encodePlaceTile(records));shards.set(String(x),bytes);
    manifest.shards[x]={url:String(x),bytes:bytes.length};manifest.tiles[`0/${x}-0`]={shard:String(x),offset:0,length:bytes.length,sha256:sha256(bytes)};
  }
  const store=createPlaceWorkerStore({manifest,fetchBytes:async spec=>shards.get(spec.url)});
  const result=await store.queryViewport(placeView({scale:16000}));
  assert.deepEqual(result.records.map(record=>record.sourceId),['256-0']);
  assert.ok(result.peakWorkingRecords<=PLACE_LIMITS.candidates+4*PLACE_LIMITS.tileRecords);
});
test('canonical projection preserves date-line and rolled polar visibility while excluding globe rectangle overscan',async()=>{
  for(const {view,coordinates,expected} of [
    {view:{flatCenter:[179,0]},coordinates:[[-179,0],[160,0]],expected:'0'},
    {view:{projection:'globe',rotation:[0,0,0],scale:500,height:100},coordinates:[[0,0],[20,20],[180,0]],expected:'0'},
    {view:{projection:'globe',rotation:[0,-90,40],scale:500},coordinates:[[0,90],[0,-90]],expected:'0'},
  ]){
    const records=coordinates.map((coordinates,i)=>normalizePlace({source:'synthetic',sourceId:String(i),name:'Place',kind:'capital',coordinates,minZoom:0}));
    const bytes=new Uint8Array(encodePlaceTile(records));const {manifest}=fixture();manifest.shards.s.bytes=bytes.length;manifest.tiles['0/0-0'].length=bytes.length;manifest.tiles['0/0-0'].sha256=sha256(bytes);manifest.search={};
    const store=createPlaceWorkerStore({manifest,fetchBytes:async()=>bytes});
    const result=await store.queryViewport(placeView(view));
    assert.deepEqual(result.records.map(record=>record.sourceId),[expected]);
  }
});
test('decoded cache accounts every string field including worst-case Unicode metadata',async()=>{
  const records=Array.from({length:4},(_,i)=>normalizePlace({source:'s'.repeat(32),sourceId:'🗺'.repeat(127)+i,name:'🗺'.repeat(256),kind:'capital',coordinates:[0,0],countryCode:'🗺'.repeat(8),featureCode:'🗺'.repeat(32)}));
  const bytes=new Uint8Array(encodePlaceTile(records));const {manifest}=fixture();manifest.shards.s.bytes=bytes.length;manifest.tiles['0/0-0'].length=bytes.length;manifest.tiles['0/0-0'].sha256=sha256(bytes);manifest.search={};
  const store=createPlaceWorkerStore({manifest,fetchBytes:async()=>bytes});
  await store.queryViewport(placeView());
  const conservativeBytes=records.reduce((sum,record)=>sum+512+Object.values(record).reduce((size,value)=>size+(typeof value==='string'?value.length*2:0),0),bytes.length);
  assert.ok(store.stats().cacheBytes>=conservativeBytes);
});
test('dense visible tiles enforce candidate, working-set and LRU cache budgets on repeated queries', async () => {
  const manifest={version:1,revision:'dense-visible',stages:[{id:0,minZoom:0,columns:4,rows:1}],tiles:{},shards:{},search:{}};
  const shards=new Map();
  for(let x=0;x<4;x++) {
    const records=Array.from({length:512},(_,i)=>normalizePlace({source:'synthetic',sourceId:`${x}-${i}`,name:'Visible',kind:'capital',coordinates:[-135+x*90,0],priority:x*512+i}));
    const bytes=new Uint8Array(encodePlaceTile(records));shards.set(String(x),bytes);
    manifest.shards[x]={url:String(x),bytes:bytes.length};manifest.tiles[`0/${x}-0`]={shard:String(x),offset:0,length:bytes.length,sha256:sha256(bytes)};
  }
  const store=createPlaceWorkerStore({manifest,cacheBytes:400000,fetchBytes:async spec=>shards.get(spec.url)});
  for(let i=0;i<3;i++) {
    const result=await store.queryViewport(placeView({threshold:10,width:1000,height:600,scale:100}));
    assert.equal(result.records.length,PLACE_LIMITS.candidates);
    assert.equal(result.records[0].priority,2047);
    assert.ok(result.cacheBytes<=400000);
    assert.ok(result.peakWorkingRecords<=PLACE_LIMITS.candidates+4*PLACE_LIMITS.tileRecords);
  }
  assert.ok(store.stats().evictions>0);
});
test('response limits stop oversized bodies, including missing Content-Length', async () => {
  await assert.rejects(readPlaceResponse(new Response(new Uint8Array(10),{headers:{'Content-Length':'10'}}),9),/budget/u);
  let cancelled=false;
  const body=new globalThis.ReadableStream({start(controller){controller.enqueue(new Uint8Array(10));},cancel(){cancelled=true;}});
  await assert.rejects(readPlaceResponse(new Response(body),9),/budget/u);
  assert.equal(cancelled,true);
});
test('range responses must identify the requested offset and complete shard size', async t => {
  const {manifest,bytes}=fixture();
  t.mock.method(globalThis,'fetch',async()=>new Response(bytes,{status:206,headers:{'Content-Range':`bytes 1-${bytes.length}/${bytes.length+1}`}}));
  const store=createPlaceWorkerStore({manifest});
  await assert.rejects(store.queryViewport(placeView({flatCenter:[127,37]})),/range/u);
  assert.equal(store.stats().cacheBytes,0);
});

test('valid range metadata still rejects corrupted tile bytes', async t => {
  const { manifest, bytes } = fixture();
  const corrupted = Uint8Array.from(bytes);
  corrupted[corrupted.length - 1] ^= 1;
  t.mock.method(globalThis, 'fetch', async () => new Response(corrupted, {
    status: 206,
    headers: { 'Content-Range': `bytes 0-${bytes.length - 1}/${bytes.length}` },
  }));
  const store = createPlaceWorkerStore({ manifest });
  await assert.rejects(store.queryViewport(placeView({ flatCenter: [127, 37] })), /tile hash/u);
  assert.equal(store.stats().cacheBytes, 0);
});
