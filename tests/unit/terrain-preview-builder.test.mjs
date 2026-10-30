import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {encodeNativeWebpLossless,readNativeRawWebp} from '../../tools/map-image/native-resample.mjs';
import {buildTerrainPreview,readTerrainPreviewFiles,verifyTerrainPreviewFiles,writeTerrainPreview} from '../../tools/gis/terrain-preview-builder.mjs';
import {validateTerrainPreviewSources} from '../../tools/gis/terrain-preview-sources.mjs';

const sha=data=>createHash('sha256').update(data).digest('hex');
test('pinned small preview produces the expected source-bound manifest and lossless tile inventory',{
  skip:!process.env.PANDO_TERRAIN_PREVIEW_DIRECTORY||!process.env.PANDO_MAP_IMAGE_ARTIFACT,
},async t=>{
  const cache=await mkdtemp(join(tmpdir(),'pando-preview-builder-'));t.after(()=>rm(cache,{recursive:true}));
  const countries=Buffer.from('{"type":"FeatureCollection","features":[]}');
  const tint=await encodeNativeWebpLossless({width:1,height:1,data:Buffer.from([100,150,200,255])});
  const tile=await encodeNativeWebpLossless({width:4,height:4,data:Buffer.from(Array(16).fill([46,224,128,255]).flat())});
  const levels=[0,1].map(id=>({id,width:2,height:2,columns:1,rows:1,tileSize:2}));
  const paths=['terrain/v0.13.0/0/0-0.webp','terrain/v0.13.0/1/0-0.webp','terrain/v0.13.3/tint.webp'];
  const bodies=[tile.data,tile.data,tint.data],assets=paths.map((path,index)=>({path,bytes:bodies[index].length,sha256:sha(bodies[index])}));
  const dem={version:'0.13.3',representation:'dem-relief-v1',levels,urlTemplate:'https://example.test/{level}/{column}-{row}.webp',
    assetsSha256:'a'.repeat(64),tint:{url:'https://example.test/tint.webp',width:1,height:1,sha256:sha(tint.data)}};
  const source=validateTerrainPreviewSources({dem,inventory:{assets},countryBytes:countries,landMaskSha256:sha(countries)});
  const fetcher=async url=>new Response(url.endsWith('tint.webp')?tint.data:tile.data);
  const result=await buildTerrainPreview({source,cache,fetcher,landMaskSha256:sha(countries)});
  assert.deepEqual(result.tiles.map(item=>item.path),['0/0-0.webp','1/0-0.webp']);
  assert.equal(result.manifest.sourceDem.landMaskSha256,sha(countries));
  assert.equal(result.manifest.sourceDem.assetsSha256,dem.assetsSha256);
  assert.equal(result.manifestBytes.toString(),JSON.stringify(result.manifest,null,2)+'\n');
  const digest=createHash('sha256');for(const output of result.tiles){
    assert.equal(result.manifest.tiles[output.path].sha256,sha(output.data));
    const decoded=await readNativeRawWebp(output.data);assert.deepEqual([decoded.width,decoded.height],[4,4]);
    digest.update(output.path+'\0').update(Buffer.from(sha(output.data),'hex'));
  }
  assert.equal(result.manifest.assetsSha256,digest.digest('hex'));
  assert.equal(result.tileBytes,result.tiles.reduce((sum,item)=>sum+item.data.length,0));
  const files=new Map([['manifest.json',result.manifestBytes],...result.tiles.map(tile=>[tile.path,tile.data])]);
  const receipt=await verifyTerrainPreviewFiles({source,files});
  assert.equal(receipt.manifestSha256,result.manifestSha256);assert.equal(receipt.tiles,2);
  const changed=new Map(files);changed.set('0/0-0.webp',Buffer.from('bad'));
  await assert.rejects(verifyTerrainPreviewFiles({source,files:changed}),/hash|identity/i);
  changed.set('extra.txt',Buffer.from('extra'));
  await assert.rejects(verifyTerrainPreviewFiles({source,files:changed}),/inventory/i);
  const output=join(cache,'output');await writeTerrainPreview({source,result,output});
  assert.deepEqual(await readFile(join(output,'manifest.json')),result.manifestBytes);
  assert.deepEqual(await verifyTerrainPreviewFiles({source,files:readTerrainPreviewFiles(output)}),receipt);
  await assert.rejects(writeTerrainPreview({source,result,output}),/exist|overwrite/i);
  await writeFile(join(output,'keep.txt'),'keep');
  await assert.rejects(verifyTerrainPreviewFiles({source,files:readTerrainPreviewFiles(output)}),/inventory/i);
  await assert.rejects(writeTerrainPreview({source,result,output}),/exist|overwrite/i);
  assert.equal(await readFile(join(output,'keep.txt'),'utf8'),'keep');
  const controller=new AbortController();controller.abort();
  await assert.rejects(buildTerrainPreview({source,cache,fetcher,landMaskSha256:sha(countries),signal:controller.signal}),/abort/i);
});
