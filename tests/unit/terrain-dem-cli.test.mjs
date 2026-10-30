import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {promisify} from 'node:util';
import test from 'node:test';
import {extractTerrainPreviewTile} from '../../tools/gis/terrain-preview-grid.mjs';
import {encodeNativeWebpLossless} from '../../tools/map-image/native-resample.mjs';

const exec=promisify(execFile),sha=data=>createHash('sha256').update(data).digest();
test('DEM verifier checks pinned synthetic source, tiles, reference and tint without writing them',{
  skip:!process.env.PANDO_TERRAIN_DEM_CHECK_DIRECTORY||!process.env.PANDO_MAP_IMAGE_ARTIFACT||!process.env.PANDO_GDAL_LOCATIONINFO,
},async t=>{
  const root=await mkdtemp(join(tmpdir(),'terrain-dem-check-'));t.after(()=>rm(root,{recursive:true}));
  const output=join(root,'dem');await mkdir(join(output,'5'),{recursive:true});
  const level={id:5,width:3,height:3,columns:2,rows:2,tileSize:2},data=Buffer.alloc(36);
  for(let i=0;i<9;i++)data.set([46,226,4,255],i*4);
  const world={width:3,height:3,data},aggregate=createHash('sha256');
  for(let row=0;row<2;row++)for(let column=0;column<2;column++){
    const path=`5/${column}-${row}.webp`,tile=extractTerrainPreviewTile(world,level,column,row);
    const bytes=(await encodeNativeWebpLossless(tile)).data;await writeFile(join(output,path),bytes);
    aggregate.update(path).update(sha(bytes));
  }
  const tintData=Buffer.alloc(4096*2048*4,255),tint=(await encodeNativeWebpLossless({width:4096,height:2048,data:tintData})).data;
  await writeFile(join(output,'tint.webp'),tint);aggregate.update(sha(tint));
  const etopo=resolve('tests/fixtures/terrain-dem/synthetic-elevation.tif'),source=await readFile(etopo);
  const manifest={version:'0.13.3',representation:'dem-relief-v1',shade:{quantizationStep:4},levels:[level],
    sources:[{sha256:sha(source).toString('hex')}],tint:{sha256:sha(tint).toString('hex')},assetsSha256:aggregate.digest('hex')};
  await writeFile(join(output,'manifest.json'),JSON.stringify(manifest));
  const args=[resolve('tools/verify-terrain-dem.mjs'),'--etopo',etopo,'--output',output,'--reference-output',output];
  const result=JSON.parse((await exec(process.execPath,args,{windowsHide:true,maxBuffer:1024*1024})).stdout);
  assert.equal(result.verified,true);assert.equal(result.levels[0].tiles,4);
  assert.deepEqual(await readFile(etopo),source);
  manifest.sources[0].sha256='0'.repeat(64);await writeFile(join(output,'manifest.json'),JSON.stringify(manifest));
  await assert.rejects(exec(process.execPath,args,{windowsHide:true}),/source checksum/i);
});
