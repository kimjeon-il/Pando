import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {checkNativeDemTile} from '../../tools/gis/terrain-dem-check.mjs';

const directory=process.env.PANDO_TERRAIN_DEM_CHECK_DIRECTORY;
const oracle=JSON.parse(readFileSync('tests/fixtures/terrain-dem-check-oracle.json','utf8'));
function tile(){return {width:3,height:3,data:Buffer.from(Array(9).fill([12,34,4,255]).flat())};}
test('DEM tile check rejects malformed inputs without invoking a native tool',async()=>{
  await assert.rejects(checkNativeDemTile({tile:{width:3,height:3,data:Buffer.alloc(3)}}),/tile/i);
  await assert.rejects(checkNativeDemTile({tile:tile(),shadeStep:0}),/shade/i);
});
test('native DEM tile check preserves opacity, shade, references and gutters',{skip:!directory},async()=>{
  const current=tile(),options={directory};await checkNativeDemTile({tile:current,shadeStep:4},options);
  const badAlpha=tile();badAlpha.data[3]=254;await assert.rejects(checkNativeDemTile({tile:badAlpha,shadeStep:4},options),/alpha/i);
  const offGrid=tile();offGrid.data[2]=3;await assert.rejects(checkNativeDemTile({tile:offGrid,shadeStep:4},options),/shade/i);
  await checkNativeDemTile({tile:offGrid,shadeStep:4,excludeNorth:true},options);
  const reference=tile();reference.data[2]=6;await checkNativeDemTile({tile:current,reference,shadeStep:4},options);
  reference.data[2]=7;await assert.rejects(checkNativeDemTile({tile:current,reference,shadeStep:4},options),/shade/i);
  reference.data[2]=4;reference.data[1]++;await assert.rejects(checkNativeDemTile({tile:current,reference,shadeStep:4},options),/elevation/i);
  const edge=Buffer.from(Array(3).fill([12,34,4,255]).flat());
  await checkNativeDemTile({tile:current,shadeStep:4,left:edge,top:edge,west:edge},options);
  const wrong=Buffer.from(edge);wrong[0]++;
  for(const field of ['left','top','west'])await assert.rejects(checkNativeDemTile({tile:current,shadeStep:4,[field]:wrong},options),/gutter/i);
});
test('native DEM tile results match the original Python verifier',{skip:!directory},async()=>{
  for(const row of oracle){const request={tile:{width:3,height:3,data:Buffer.from(row.pixels)},shadeStep:4,excludeNorth:row.excludeNorth,
    ...(row.reference?{reference:{width:3,height:3,data:Buffer.from(row.reference)}}:{})};
    if(row.expected)assert.equal(await checkNativeDemTile(request,{directory}),true,row.name);
    else await assert.rejects(checkNativeDemTile(request,{directory}),undefined,row.name);
  }
});
