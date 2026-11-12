import test from 'node:test';
import assert from 'node:assert/strict';
import {cutGutterTiles,regionalOrigin,regionalBlockWindow} from '../../../scripts/terrain-experiment/gutter-fixture.mjs';
import {inspectFixtureCoverage} from '../../../scripts/terrain-experiment/fixture-coverage.mjs';
import {globePixelToLonLat} from '../../../scripts/terrain-experiment/viewer-screen-space.mjs';

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

test('expanded regional blocks include conservative Viewer visibility for all comparison regions',()=>{
  for(const [lon,lat] of [[102,28],[100,15],[5.5,53]]){
    const [x0,y0,x1,y1]=regionalBlockWindow(lon,lat);
    for(const size of [512,1024]){
      const levels=[{id:4,width:21600,height:10800,tileSize:1024,columns:22,rows:11},
        {id:5,width:43200,height:21600,tileSize:size,columns:Math.ceil(43200/size),rows:Math.ceil(21600/size)}];
      const availableKeys=new Set();
      for(let y=y0/size;y<y1/size;y++)for(let x=x0/size;x<x1/size;x++)availableKeys.add(`5/${x}-${y}`);
      const report=inspectFixtureCoverage({manifest:{levels,gutter:1},availableKeys,center:[lon,lat],viewport:[1280,752],scale:10570.56});
      assert.deepEqual(report.missingKeys,[],`${lon},${lat},${size}`);
    }
  }
});

test('representative camera views fit within centered 2x2 source regions',()=>{
  for(const [sourceLon,sourceLat,cameraLon] of [[102,28,102],[100,15,100],[4,53,5.5]]){
    const side=1024,x=regionalOrigin(Math.floor((sourceLon+180)*120),side,{alignWorld:true,block2:true});
    const y=regionalOrigin(Math.floor((90-sourceLat)*120),side,{alignWorld:true,block2:true});
    const lon=cameraLon*Math.PI/180,lat=sourceLat*Math.PI/180;
    const frame={translate:[640,376],scale:10570.56,rowX:[-Math.sin(lon),Math.cos(lon),0],
      rowY:[Math.sin(lat)*Math.cos(lon),Math.sin(lat)*Math.sin(lon),-Math.cos(lat)],
      rowZ:[Math.cos(lat)*Math.cos(lon),Math.cos(lat)*Math.sin(lon),Math.sin(lat)]};
    for(let ix=0;ix<=16;ix++)for(let iy=0;iy<=16;iy++){
      const [pointLon,pointLat]=globePixelToLonLat(frame,ix*80,iy*47);
      const px=(pointLon+180)*120,py=(90-pointLat)*120;
      assert.ok(px>=x+1&&px<=x+2047&&py>=y+1&&py<=y+2047,`${sourceLon},${sourceLat} viewport exceeds fixture`);
    }
  }
});
