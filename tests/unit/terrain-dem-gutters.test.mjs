import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {demTileEdges,reconcileDemGutterPixels,reconcileDemGutterFiles} from '../../tools/gis/terrain-dem-gutters.mjs';
import {encodeNativeWebpLossless,readNativeRawWebp} from '../../tools/map-image/native-resample.mjs';

const cases=JSON.parse(await readFile(new URL('../fixtures/terrain-dem-gutters-oracle.json',import.meta.url),'utf8'));
test('gutter pixels match the frozen Python result at dateline, poles and partial tiles',async()=>{
  for(const fixture of cases){
    const tiles=new Map(fixture.inputs.map(t=>[`${t.column},${t.row}`,{width:t.width,height:t.height,data:Buffer.from(t.rgba)}]));
    const edges=new Map([...tiles].map(([key,tile])=>[key,demTileEdges(tile)]));
    const get=(column,row)=>edges.get(`${(column+fixture.columns)%fixture.columns},${row}`);
    let modified=0;
    for(const expected of fixture.output){
      const {column:c,row:r}=expected,hasNorth=r>0,hasSouth=r<fixture.rows-1;
      const result=await reconcileDemGutterPixels(tiles.get(`${c},${r}`),{
        west:get(c-1,r),east:get(c+1,r),north:get(c,Math.max(0,r-1)),south:get(c,Math.min(fixture.rows-1,r+1)),
        northWest:get(c-1,Math.max(0,r-1)),northEast:get(c+1,Math.max(0,r-1)),
        southWest:get(c-1,Math.min(fixture.rows-1,r+1)),southEast:get(c+1,Math.min(fixture.rows-1,r+1)),hasNorth,hasSouth});
      assert.deepEqual([...result.data],expected.rgba,`${c},${r}`);modified+=Number(result.modified);
    }
    assert.equal(modified,fixture.changed);
    assert.equal(fixture.stable,0);
  }
});

test('generated WebP gutters are repaired losslessly and a second pass is stable',
  {skip:!process.env.PANDO_MAP_IMAGE_ARTIFACT},async t=>{
    const root=await mkdtemp(join(tmpdir(),'dem-gutters-'));t.after(()=>rm(root,{recursive:true,force:true}));
    await mkdir(join(root,'0'));const fixture=cases[0];
    for(const tile of fixture.inputs){const image={width:tile.width,height:tile.height,data:Buffer.from(tile.rgba)};
      const encoded=await encodeNativeWebpLossless(image);await writeFile(join(root,'0',`${tile.column}-${tile.row}.webp`),encoded.data);}
    const level={id:0,columns:fixture.columns,rows:fixture.rows};
    assert.equal(await reconcileDemGutterFiles(root,level),fixture.changed);
    for(const expected of fixture.output){const bytes=await readFile(join(root,'0',`${expected.column}-${expected.row}.webp`));
      const decoded=await readNativeRawWebp(bytes);assert.deepEqual([...decoded.data],expected.rgba);}
    assert.equal(await reconcileDemGutterFiles(root,level),0);
    const preserved=await readFile(join(root,'0','0-0.webp'));
    await writeFile(join(root,'0','1-1.webp'),Buffer.from('not a webp'));
    await assert.rejects(reconcileDemGutterFiles(root,level),/webp|image|native/i);
    assert.deepEqual(await readFile(join(root,'0','0-0.webp')),preserved);
  });

test('gutter reconciliation rejects invalid inputs and cancellation',async()=>{
  assert.throws(()=>demTileEdges({width:2,height:2,data:Buffer.alloc(16)}),/bounded RGBA/);
  await assert.rejects(reconcileDemGutterFiles('.',{id:0,columns:0,rows:1}),/bounded DEM/);
  const controller=new AbortController();controller.abort();
  await assert.rejects(reconcileDemGutterFiles('.',{id:0,columns:1,rows:1},{signal:controller.signal}),{name:'AbortError'});
});
