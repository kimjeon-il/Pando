import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectFixtureCoverage} from '../../../scripts/terrain-experiment/fixture-coverage.mjs';

test('preflight detects conservative visibility and budget downgrade before a Viewer run',()=>{
  const levels=size=>[
    {id:4,width:21600,height:10800,tileSize:1024,columns:22,rows:11},
    {id:5,width:43200,height:21600,tileSize:size,columns:Math.ceil(43200/size),rows:Math.ceil(21600/size)},
  ];
  const keys=size=>{
    const result=new Set();
    for(let y=6144/size;y<8192/size;y++)for(let x=32768/size;x<34816/size;x++)result.add(`5/${x}-${y}`);
    return result;
  };
  const options={center:[102,28],viewport:[1280,752],scale:10570.56};
  const large=inspectFixtureCoverage({manifest:{levels:levels(1024),gutter:1},availableKeys:keys(1024),...options});
  assert.equal(large.requestedTiles,8);
  assert.equal(large.admittedLevel,4);
  assert.ok(large.missingKeys.length>0);
  assert.equal(large.valid,false);
  const small=inspectFixtureCoverage({manifest:{levels:levels(512),gutter:1},availableKeys:keys(512),...options});
  assert.equal(small.requestedTiles,17);
  assert.equal(small.admittedLevel,5);
  assert.equal(small.missingKeys.length,3);
  assert.equal(small.valid,false);
  const complete=inspectFixtureCoverage({manifest:{levels:levels(512),gutter:1},availableKeys:new Set([...keys(512),...small.missingKeys]),...options});
  assert.equal(complete.valid,true);
});
