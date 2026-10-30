import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {nativeMacroAdjacency,nativeMacroDilate,nativeMacroPalette,nativeMacroVisible} from '../../tools/map-image/native-resample.mjs';

test('macro palette labels preserve nearest colour, unknowns and first palette tie',async()=>{
  const image={width:4,height:1,data:Buffer.from([255,0,0, 254,0,0, 0,0,255, 10,10,10])};
  const palette=[[1,0,0],[1,0,0],[0,0,1]];
  assert.deepEqual(await nativeMacroPalette(image,palette),Buffer.from([1,1,3,0]));
  await assert.rejects(nativeMacroPalette(image,[[1,0,0]]),/palette/i);
  await assert.rejects(nativeMacroPalette(image,[[1,0,0],[NaN,0,0]]),/palette/i);
});
test('macro visible stroke mask matches any listed signature within threshold',async()=>{
  const image={width:3,height:1,data:Buffer.from([255,0,0, 240,4,3, 0,255,0])};
  assert.deepEqual(await nativeMacroVisible(image,[[1,0,0]]),Buffer.from([1,1,0]));
  assert.deepEqual(await nativeMacroVisible(image,[[0,1,0],[1,0,0]]),Buffer.from([1,1,1]));
  await assert.rejects(nativeMacroVisible(image,[]),/palette/i);
});
test('macro color stream checks palette and RGB lengths',()=>{
  const colors=Buffer.alloc(48);colors.writeDoubleLE(1,0);colors.writeDoubleLE(1,40);
  const input=Buffer.concat([colors,Buffer.from([255,0,0,0,0,255])]);
  const args=['tools/reference-analysis/macro-masks.mjs','palette','2','1','2'];
  const result=spawnSync(process.execPath,args,{input});assert.equal(result.status,0,result.stderr.toString());
  assert.deepEqual(result.stdout,Buffer.from([1,2]));
  assert.notEqual(spawnSync(process.execPath,args,{input:input.subarray(0,-1)}).status,0);
});

test('native macro supervision distinguishes country seams and unknown gaps',async()=>{
  const width=50,height=30,labels=Buffer.alloc(width*height);
  for(let y=5;y<25;y++)for(let x=5;x<24;x++)labels[y*width+x]=1;
  for(let y=5;y<25;y++)for(let x=26;x<45;x++)labels[y*width+x]=2;
  const out=await nativeMacroAdjacency({width,height,data:labels},2);
  assert.equal(out.target[15*width+25],1);assert.equal(out.known[15*width+25],1);
  assert.equal(out.known[15*width+4],0);assert.equal(out.known[15*width+12],1);assert.equal(out.target[15*width+12],0);
  for(let y=5;y<25;y++)for(let x=26;x<45;x++)labels[y*width+x]=1;
  const same=await nativeMacroAdjacency({width,height,data:labels},2);
  assert.equal(same.target.some(Boolean),false);assert.equal(same.known[15*width+25],0);
  await assert.rejects(nativeMacroAdjacency({width,height,data:labels},0),/radius/i);
});
test('native macro dilation preserves square Pillow neighbourhood and edges',async()=>{
  const width=7,height=5,source=Buffer.alloc(width*height);source[0]=1;source[3*width+4]=1;
  const output=await nativeMacroDilate({width,height,data:source},2),expected=Buffer.alloc(source.length);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
    const sx=x+dx,sy=y+dy;if(sx>=0&&sx<width&&sy>=0&&sy<height&&source[sy*width+sx])expected[y*width+x]=1;
  }
  assert.deepEqual(output,expected);
  assert.deepEqual(await nativeMacroDilate({width:3,height:2,data:Buffer.from([0,0,0,0,0,1])},32),Buffer.alloc(6,1));
  assert.deepEqual(await nativeMacroDilate({width:1,height:1,data:Buffer.from([0])},1),Buffer.from([0]));
  await assert.rejects(nativeMacroDilate({width,height,data:Buffer.alloc(1)},2),/length/i);
});
test('macro mask stream returns both supervision planes and rejects truncated input',()=>{
  const labels=Buffer.from([1,0,2]),args=['tools/reference-analysis/macro-masks.mjs','adjacency','3','1','1'];
  const result=spawnSync(process.execPath,args,{input:labels});assert.equal(result.status,0,result.stderr.toString());
  assert.deepEqual(result.stdout,Buffer.from([0,1,0,0,1,0]));
  const invalid=spawnSync(process.execPath,args,{input:labels.subarray(0,2)});assert.notEqual(invalid.status,0);
});
