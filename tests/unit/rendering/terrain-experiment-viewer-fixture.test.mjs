import test from 'node:test';
import assert from 'node:assert/strict';
import {makeViewerFixtureManifest,experimentCenter} from '../../../scripts/terrain-experiment/viewer-fixture.mjs';

const hash='a'.repeat(64);
function inputs(){
  const levels=Array.from({length:6},(_,id)=>({id,width:1350*2**id,height:675*2**id,tileSize:1024,columns:1,rows:1}));
  const source={version:'0.14.0',levels,tiles:{'0/0-0.webp':{bytes:3,sha256:hash},'5/0-0.webp':{bytes:4,sha256:hash}},
    assetsSha256:hash,urlTemplate:'terrain/v0.14.0/{level}/{column}-{row}.webp',
    packaging:{sourcePath:'terrain/v0.14.0/manifest.json'},shade:{quantizationStep:4},elevation:{quantization:{}}};
  const records=[];
  for(const x of [1024,2048])for(const y of [2048,3072])for(const tileSize of [512,1024])
    for(let dy=0;dy<1024;dy+=tileSize)for(let dx=0;dx<1024;dx+=tileSize)
      records.push({region:'southwest-china',level:5,window:[x,y,x+1024,y+1024],offset:[dx,dy],width:tileSize+2,height:tileSize+2,
        tileSize,gutter:1,webpBytes:42,webpSha256:hash,file:`tile-${x}-${y}-${dx}-${dy}-${tileSize}.webp`});
  return {source,fixture:{schema:'pando-terrain-gutter-webp-v1',sourceSha256:hash,records}};
}

test('regional A1/B fixtures keep lower LODs but fail closed outside Q1 coverage',()=>{
  const {source,fixture}=inputs(),before=JSON.stringify(source);
  const a=makeViewerFixtureManifest(source,fixture,1024),b=makeViewerFixtureManifest(source,fixture,512);
  assert.equal(JSON.stringify(source),before);
  assert.equal(a.tiles.size,4);assert.equal(b.tiles.size,16);
  assert.ok(a.manifest.tiles['0/0-0.webp']);assert.equal(a.manifest.tiles['5/0-0.webp'],undefined);
  assert.equal(a.manifest.levels[5].tileSize,1024);assert.equal(b.manifest.levels[5].tileSize,512);
  assert.equal(a.manifest.version,'0.15.0');assert.notEqual(a.manifest.assetsSha256,b.manifest.assetsSha256);
  assert.deepEqual(a.center,b.center);assert.deepEqual(a.center,[102,28]);
});

test('rejects incomplete or inconsistent candidate inventory',()=>{
  const {source,fixture}=inputs();fixture.records.splice(fixture.records.findIndex(record=>record.tileSize===512),1);
  assert.throws(()=>makeViewerFixtureManifest(source,fixture,512),/Incomplete/);
});

test('selects only the requested regional tile inventory',()=>{
  const {source,fixture}=inputs();
  fixture.records.push(...fixture.records.map(record=>({...record,region:'thai-lowland'})));
  const selected=makeViewerFixtureManifest(source,fixture,512,'thai-lowland');
  assert.equal(selected.tiles.size,16);assert.equal(selected.manifest.experiment.region,'thai-lowland');
  assert.throws(()=>makeViewerFixtureManifest(source,fixture,512,'unknown-region'),/Incomplete/);
});

test('accepts a complete expanded 5x3 regional fixture',()=>{
  const {source,fixture}=inputs();fixture.records=[];
  for(let y=2048;y<2048+3072;y+=1024)for(let x=1024;x<1024+5120;x+=1024)
    for(const tileSize of [512,1024])for(let dy=0;dy<1024;dy+=tileSize)for(let dx=0;dx<1024;dx+=tileSize)
      fixture.records.push({region:'southwest-china',level:5,window:[x,y,x+1024,y+1024],offset:[dx,dy],width:tileSize+2,height:tileSize+2,
        tileSize,gutter:1,webpBytes:42,webpSha256:hash,file:`tile-${x}-${y}-${dx}-${dy}-${tileSize}.webp`});
  assert.equal(makeViewerFixtureManifest(source,fixture,1024).tiles.size,15);
  assert.equal(makeViewerFixtureManifest(source,fixture,512).tiles.size,60);
});

test('all measured regions have one shared Viewer camera center',()=>{
  assert.deepEqual(experimentCenter('himalaya'),[86,28]);
  assert.deepEqual(experimentCenter('netherlands-coast'),[5.5,53]);
  assert.throws(()=>experimentCenter('unknown-region'),/no fixed camera/);
});
