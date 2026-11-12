import test from 'node:test';
import assert from 'node:assert/strict';
import {cutGutterTiles} from '../../../scripts/terrain-experiment/gutter-fixture.mjs';

test('512-style subdivision preserves both shared gutter pixels and core',()=>{
  const side=8,stride=side+2,rgba=Buffer.alloc(stride*stride*4);
  for(let y=0;y<stride;y++)for(let x=0;x<stride;x++){
    const i=(y*stride+x)*4;rgba[i]=x;rgba[i+1]=y;rgba[i+2]=(x*17+y)%256;rgba[i+3]=255;
  }
  const full=cutGutterTiles(rgba,side,side)[0],tiles=cutGutterTiles(rgba,side,side/2);
  assert.deepEqual(full.rgba,rgba);assert.equal(tiles.length,4);
  for(const tile of tiles)for(let y=0;y<tile.height;y++)for(let x=0;x<tile.width;x++){
    const i=(y*tile.width+x)*4,j=((tile.y+y)*stride+tile.x+x)*4;
    assert.deepEqual(tile.rgba.subarray(i,i+4),rgba.subarray(j,j+4));
  }
  for(let y=0;y<6;y++)for(let x=0;x<2;x++){
    const left=(y*6+4+x)*4,right=(y*6+x)*4;
    assert.deepEqual(tiles[0].rgba.subarray(left,left+4),tiles[1].rgba.subarray(right,right+4));
  }
});

test('rejects malformed tile sources',()=>{
  assert.throws(()=>cutGutterTiles(Buffer.alloc(16),8,4));
  assert.throws(()=>cutGutterTiles(Buffer.alloc(400),8,3));
});
