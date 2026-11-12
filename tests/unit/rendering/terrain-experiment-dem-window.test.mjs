import test from 'node:test';
import assert from 'node:assert/strict';
import {readDemWindowTiled} from '../../../scripts/terrain-experiment/dem-window.mjs';

test('bounded reads reconstruct a wide DEM window without gaps or duplicate pixels',async()=>{
  const calls=[];
  const reader={async read([x0,y0,x1,y1]){
    calls.push([x0,y0,x1,y1]);const bytes=Buffer.alloc((x1-x0)*(y1-y0)*4);let i=0;
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++,i+=4)bytes.writeInt32LE(y*1000+x,i);
    return bytes;
  }};
  const bytes=await readDemWindowTiled(reader,[2,3,13,6],4);
  assert.equal(calls.length,3);assert.equal(bytes.length,11*3*4);
  for(let y=0;y<3;y++)for(let x=0;x<11;x++)assert.equal(bytes.readInt32LE((y*11+x)*4),(y+3)*1000+x+2);
  await assert.rejects(()=>readDemWindowTiled(reader,[0,0,2,2],0));
});

test('bounded reads split both axes when a region exceeds a single native request',async()=>{
  const calls=[];
  const reader={async read([x0,y0,x1,y1]){
    calls.push([x0,y0,x1,y1]);const bytes=Buffer.alloc((x1-x0)*(y1-y0)*4);let i=0;
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++,i+=4)bytes.writeInt32LE(y*1000+x,i);
    return bytes;
  }};
  const bytes=await readDemWindowTiled(reader,[2,3,13,9],4,12);
  assert.ok(calls.every(([x0,y0,x1,y1])=>(x1-x0)*(y1-y0)<=12));
  assert.ok(calls.length>3);
  for(let y=0;y<6;y++)for(let x=0;x<11;x++)assert.equal(bytes.readInt32LE((y*11+x)*4),(y+3)*1000+x+2);
});
