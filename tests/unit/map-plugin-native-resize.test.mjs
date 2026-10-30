import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {crc32,inflateSync} from 'node:zlib';
import test from 'node:test';
import {pngRaster,raster,resizeRaster} from '../../plugins/pando-map-tools/lib/raster.mjs';

test('map plugin resizes RGBA without starting its Python raster adapter',async()=>{
  process.env.PANDO_MAP_PYTHON=resolve('definitely-missing-python');
  const data=Buffer.alloc(7*5*4),alphas=[0,1,2,127,254,255];
  for(let y=0;y<5;y++)for(let x=0;x<7;x++)for(let c=0;c<4;c++)
    data[(y*7+x)*4+c]=c<3?(x*37+y*19+c*73+x*y*11)%256:alphas[(x+y*7)%6];
  const actual=await resizeRaster({width:7,height:5,data},[3,2]);
  assert.deepEqual(actual.data,readFileSync('tests/fixtures/map-image/rgba-7x5-to-3x2.raw'));
});

test('map plugin rotates RGBA pixels clockwise without Python',async()=>{
  process.env.PANDO_MAP_PYTHON=resolve('definitely-missing-python');
  const pixels=Buffer.from([1,2,3,0, 4,5,6,127, 7,8,9,255, 10,11,12,1, 13,14,15,254, 16,17,18,255]);
  for(const [degrees,width,height,order] of [[0,3,2,[0,1,2,3,4,5]],[90,2,3,[3,0,4,1,5,2]],
    [180,3,2,[5,4,3,2,1,0]],[270,2,3,[2,5,1,4,0,3]]]){
    const actual=await raster({action:'rotate',width:3,height:2,degrees},pixels);
    assert.deepEqual([actual.width,actual.height],[width,height]);
    assert.deepEqual(actual.data,Buffer.concat(order.map(i=>pixels.subarray(i*4,i*4+4))));
  }
  await assert.rejects(raster({action:'rotate',width:3,height:2,degrees:45},pixels),/rotation/i);
});

test('map plugin encodes PNG with exact RGBA pixels without Python',async()=>{
  process.env.PANDO_MAP_PYTHON=resolve('definitely-missing-python');
  const pixels=Buffer.from([1,2,3,0, 4,5,6,127, 7,8,9,255, 10,11,12,1, 13,14,15,254, 16,17,18,255]);
  const png=await pngRaster({width:3,height:2,data:pixels});
  assert.deepEqual(png.subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]));
  let cursor=8,header,ended=false;const chunks=[];
  while(cursor<png.length){
    const n=png.readUInt32BE(cursor),type=png.subarray(cursor+4,cursor+8),body=png.subarray(cursor+8,cursor+8+n);
    assert.equal(body.length,n);assert.equal(png.readUInt32BE(cursor+8+n),crc32(Buffer.concat([type,body])));
    if(type.toString()==='IHDR')header=body;
    if(type.toString()==='IDAT')chunks.push(body);
    if(type.toString()==='IEND')ended=true;
    cursor+=n+12;
  }
  assert.equal(cursor,png.length);assert.ok(ended&&header&&chunks.length);
  assert.deepEqual([header.readUInt32BE(0),header.readUInt32BE(4),header[8],header[9]],[3,2,8,6]);
  const raw=inflateSync(Buffer.concat(chunks)),decoded=Buffer.alloc(pixels.length),stride=12;
  const paeth=(a,b,c)=>{const p=a+b-c,da=Math.abs(p-a),db=Math.abs(p-b),dc=Math.abs(p-c);return da<=db&&da<=dc?a:db<=dc?b:c;};
  for(let y=0;y<2;y++)for(let x=0;x<stride;x++){
    const filter=raw[y*(stride+1)],at=y*stride+x,left=x>=4?decoded[at-4]:0,up=y?decoded[at-stride]:0,upperLeft=y&&x>=4?decoded[at-stride-4]:0;
    assert.ok(filter<=4);const prediction=[0,left,up,Math.floor((left+up)/2),paeth(left,up,upperLeft)][filter];
    decoded[at]=(raw[y*(stride+1)+1+x]+prediction)&255;
  }
  assert.deepEqual(decoded,pixels);
});

test('native PNG compresses smooth map pixels without excessive expansion',async()=>{
  process.env.PANDO_MAP_PYTHON=resolve('definitely-missing-python');
  const width=128,height=96,data=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4;data[i]=(x*3+y)%256;data[i+1]=(x+y*5)%256;data[i+2]=(x*7+y*11)%256;data[i+3]=(x*9+y*13)%256;
  }
  const png=await pngRaster({width,height,data});
  assert.ok(png.length<5000,`Smooth fixture encoded to ${png.length} bytes; the original encoder used 1328`);
});
