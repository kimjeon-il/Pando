import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {composeNativeTerrainPreview,rasterizeNativeTerrainLand} from '../../tools/gis/terrain-preview-native.mjs';

const binary=process.env.PANDO_TERRAIN_PREVIEW_BINARY;
const cases=JSON.parse(readFileSync('tests/fixtures/terrain-preview-kernel.json','utf8'));
const masks=JSON.parse(readFileSync('tests/fixtures/terrain-land-mask.json','utf8'));
const physicalMasks=JSON.parse(readFileSync('tests/fixtures/physical-land-mask-oracle.json','utf8'));
test('frozen preview slopes, coasts and polar rows agree with Canvas DEM conversion',()=>{
  const context={self:{}};
  vm.runInNewContext(readFileSync('shared/frontend/js/workers/canvas-terrain-dem-core.js','utf8'),context);
  const convert=context.self.PandoLabCanvasTerrainDem.convertTile;
  for(const row of cases.filter(item=>item.name.startsWith('latitude-'))){
    const tint=[];for(let i=0;i<row.tint.length;i+=3)tint.push(...row.tint.slice(i,i+3),255);
    const west=-180+(row.x+1)*360/row.levelWidth,north=90-(row.y+1)*180/row.levelHeight;
    const options={dem:Uint8ClampedArray.from(row.dem),width:row.width,height:row.height,tint:Uint8ClampedArray.from(tint),
      tintWidth:row.tintWidth,tintHeight:row.tintHeight,bounds:[west,north,west+5*360/row.levelWidth,north-5*180/row.levelHeight],
      pixelWidth:5,pixelHeight:5,levelWidth:row.levelWidth,levelHeight:row.levelHeight};
    const actual=convert(options);
    for(let i=0;i<row.width*row.height;i++){
      const rgba=row.land[i]?actual.land:actual.ocean;
      for(let channel=0;channel<3;channel++)assert.ok(Math.abs(row.expected[i*4+channel]-rgba[i*4+channel])<=2,row.name);
      assert.ok(Math.abs(row.expected[i*4+3]-actual.political[i*4])<=2,row.name);
    }
  }
});
function encode(row){
  const header=Buffer.alloc(56);header.write('PDTERR01',0,'ascii');
  for(const [i,value] of [row.width,row.height,row.tintWidth,row.tintHeight].entries())header.writeUInt32LE(value,8+i*4);
  for(const [i,value] of [row.x,row.y,row.levelWidth,row.levelHeight].entries())header.writeDoubleLE(value,24+i*8);
  return Buffer.concat([header,Buffer.from(row.dem),Buffer.from(row.tint),Buffer.from(row.land)]);
}
test('native terrain preview matches frozen Python pixels for slopes, ocean, wrap and polar rows', {skip:!binary},()=>{
  for(const row of cases){const input=encode(row),result=spawnSync(binary,[],{input,maxBuffer:16*1024*1024});
    assert.equal(result.status,0,`${row.name}: ${result.stderr}`);assert.deepEqual(result.stdout,Buffer.from(row.expected),row.name);}
});
test('native terrain preview rejects truncated input, invalid dimensions and nonopaque DEM',{skip:!binary},()=>{
  const input=encode(cases[0]);
  for(const bad of [input.subarray(0,input.length-1),(()=>{const copy=Buffer.from(input);copy.writeUInt32LE(0,8);return copy;})(),
    (()=>{const copy=Buffer.from(input);copy[56+3]=0;return copy;})()]){
    const result=spawnSync(binary,[],{input:bad});assert.equal(result.status,1);assert.equal(result.stdout.length,0);assert(result.stderr.length>0);
  }
});
test('native land mask preserves dateline wrapping, holes and overlapping polygons',{skip:!binary},()=>{
  for(const row of masks){const result=spawnSync(binary,['mask'],{input:JSON.stringify(row),maxBuffer:2*1024*1024});
    assert.equal(result.status,0,`${row.name}: ${result.stderr}`);assert.deepEqual(result.stdout,Buffer.from(row.expectedBase64,'base64'),row.name);}
});
test('native land mask rejects invalid geometry and dimensions without partial output',{skip:!binary},()=>{
  const invalid=structuredClone(masks[0]);invalid.countries.features[0].geometry.coordinates[0][0][0]=181;
  const empty=structuredClone(masks[0]);empty.width=0;
  for(const input of [invalid,empty]){const result=spawnSync(binary,['mask'],{input:JSON.stringify(input)});
    assert.equal(result.status,1);assert.equal(result.stdout.length,0);assert(result.stderr.length>0);}
});
test('native physical land mask fills holes and matches Python at the dateline',{skip:!binary},()=>{
  for(const row of physicalMasks){const result=spawnSync(binary,['mask'],{input:JSON.stringify(row),maxBuffer:2*1024*1024});
    assert.equal(result.status,0,`${row.name}: ${result.stderr}`);assert.deepEqual(result.stdout,Buffer.from(row.expectedBase64,'base64'),row.name);}
});
test('native physical mask discards a subpixel polygon copy outside the date line',{skip:!binary},()=>{
  const row=JSON.parse(readFileSync('tests/fixtures/physical-land-mask-edge-oracle.json','utf8'));
  const result=spawnSync(binary,['mask'],{input:JSON.stringify(row),maxBuffer:2*1024*1024});
  assert.equal(result.status,0,String(result.stderr));
  assert.equal(createHash('sha256').update(result.stdout).digest('hex'),row.expectedSha256);
  assert.equal(result.stdout[75*720],0);
});
test('native physical composite matches Pillow gutters and all alpha values',{skip:!binary},()=>{
  const row=JSON.parse(readFileSync('tests/fixtures/physical-gutter-composite-oracle.json','utf8'));
  const alpha=JSON.parse(readFileSync('tests/fixtures/physical-gutter-alpha-oracle.json','utf8'));
  const cases=[...row.cases,alpha],frames=cases.map(value=>Buffer.from(value.frame,'base64'));
  const result=spawnSync(binary,['physical-composite-stream'],{input:Buffer.concat(frames),maxBuffer:1024*1024});
  assert.equal(result.status,0,String(result.stderr));
  assert.deepEqual(result.stdout,Buffer.concat(cases.map(value=>Buffer.from(value.expected,'base64'))));
  const frame=frames[0],truncated=spawnSync(binary,['physical-composite-stream'],{input:frame.subarray(0,frame.length-1)});
  assert.notEqual(truncated.status,0);assert.equal(truncated.stdout.length,0);
});
test('physical composite relay exits when native input is invalid even if stdin stays open',
  {skip:!process.env.PANDO_TERRAIN_PREVIEW_DIRECTORY},async()=>{
    const child=spawn(process.execPath,['tools/gis/terrain-preview-native.mjs','--physical-composite-stream'],{stdio:['pipe','ignore','pipe'],windowsHide:true});
    const done=new Promise((accept,reject)=>{child.once('error',reject);child.once('close',(code)=>accept(code));});
    child.stdin.on('error',()=>{});child.stdin.write(Buffer.alloc(24));
    let timer;const timeout=new Promise(accept=>{timer=setTimeout(()=>accept(null),3000);});
    const code=await Promise.race([done,timeout]);clearTimeout(timer);
    if(code===null)child.kill();
    assert.notEqual(code,null,'relay must stop after the native engine rejects its input');
    assert.notEqual(code,0);
  });
test('terrain preview interface validates pixel buffers before starting the native tool',async()=>{
  const row=cases[0];await assert.rejects(composeNativeTerrainPreview({...row,dem:Buffer.alloc(1),tint:Buffer.from(row.tint),land:Buffer.from(row.land)}),/buffer/i);
  await assert.rejects(rasterizeNativeTerrainLand({...masks[0],width:0}),/inputs/i);
});
test('source-bound terrain preview interface preserves all frozen pixel cases',{
  skip:!process.env.PANDO_TERRAIN_PREVIEW_DIRECTORY,
},async()=>{
  for(const row of cases){const output=await composeNativeTerrainPreview({...row,dem:Buffer.from(row.dem),tint:Buffer.from(row.tint),land:Buffer.from(row.land)},
    {directory:process.env.PANDO_TERRAIN_PREVIEW_DIRECTORY});assert.deepEqual(output,Buffer.from(row.expected),row.name);}
  for(const row of masks){const output=await rasterizeNativeTerrainLand(row,{directory:process.env.PANDO_TERRAIN_PREVIEW_DIRECTORY});
    assert.deepEqual(output,Buffer.from(row.expectedBase64,'base64'),row.name);}
});
