import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function makeFixture(limit=128){
  let conversions=0,ids=0;
  class MockBitmap{constructor(){this.id=++ids;this.closed=false;}close(){this.closed=true;}}
  class MockCanvas{getContext(){return {putImageData(){}};}transferToImageBitmap(){return new MockBitmap();}}
  class MockImageData{constructor(data,width,height){Object.assign(this,{data,width,height});}}
  const runtime={URL,OffscreenCanvas:MockCanvas,ImageData:MockImageData,location:{href:'https://example.test/worker.js'},
    PandoLabResourceUpdatePolicy:{resourceKey(){},resourceUpdate(){}},
    PandoLabTerrainTileSelection:{demVisiblePolicy:{byteBudget:limit},createVisibilityCache(){return {}; }},
    PandoLabCanvasTerrainDem:{convertTile({dem}){conversions++;return {land:new Uint8ClampedArray(dem.length),ocean:new Uint8ClampedArray(dem.length)};}},
    d3:{geo:{distance(){}}},postMessage(){}};
  runtime.self=runtime;vm.createContext(runtime);
  const source=readFileSync(new URL('../../../src/rendering/workers/canvas-render-core.js',import.meta.url),'utf8');
  const entry=source.replace('self.onmessage = event => {',`self.cacheFixture={
    add(key,tile){demTiles.set(key,tile);demCacheBytes+=tile.bytes;},
    apply:applyDemPresentationTheme,prune:pruneDemTiles,protect(key){terrainProtectedKeys.add(key);},
    bytes(){return demCacheBytes;},has(key){return demTiles.has(key);}
  }; self.onmessage = event => {`);
  vm.runInContext(entry,runtime);const dispose=runtime.PandoLabCanvasRenderer.install(runtime);
  function tile(){return {land:new MockBitmap(),ocean:new MockBitmap(),political:new MockBitmap(),
    raw:new Uint8ClampedArray(16),theme:'light',width:2,height:2,bytes:64,lastUsed:0};}
  return {cache:runtime.cacheFixture,tile,dispose,conversions:()=>conversions};
}

test('Canvas reuses a previously computed tile theme within its shared cache budget',()=>{
  const f=makeFixture(128),tile=f.tile();f.cache.add('0/0',tile);
  const originalLand=tile.land,originalOcean=tile.ocean;
  f.cache.apply(tile,'dark');const darkLand=tile.land;
  assert.equal(f.conversions(),1);assert.equal(f.cache.bytes(),96);
  f.cache.apply(tile,'light');assert.equal(tile.land,originalLand);assert.equal(tile.ocean,originalOcean);
  f.cache.apply(tile,'dark');assert.equal(tile.land,darkLand);assert.equal(f.conversions(),1);
  assert.equal(originalLand.closed,false);f.dispose();assert.equal(originalLand.closed,true);assert.equal(darkLand.closed,true);
});

test('Canvas drops alternate themes before evicting source tiles under memory pressure',()=>{
  const f=makeFixture(128),first=f.tile();f.cache.add('0/0',first);f.cache.protect('dem:0/0');
  f.cache.apply(first,'dark');const retained=first.alternate.land;
  const second=f.tile();f.cache.add('0/1',second);f.cache.protect('dem:0/1');f.cache.prune();
  assert.equal(f.cache.has('0/0'),true);assert.equal(f.cache.has('0/1'),true);
  assert.equal(f.cache.bytes(),128);assert.equal(retained.closed,true);assert.equal(first.alternate,null);
  f.dispose();
});

test('Canvas does not retain a theme when the cache has no spare capacity',()=>{
  const f=makeFixture(64),tile=f.tile();f.cache.add('0/0',tile);
  const old=tile.land;f.cache.apply(tile,'dark');
  assert.equal(old.closed,true);assert.equal(tile.alternate,undefined);assert.equal(f.cache.bytes(),64);
  f.cache.apply(tile,'light');assert.equal(f.conversions(),2);assert.equal(f.cache.bytes(),64);f.dispose();
});
