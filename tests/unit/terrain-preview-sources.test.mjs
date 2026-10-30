import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {readPinnedTerrainAsset,validateTerrainPreviewSources} from '../../tools/gis/terrain-preview-sources.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('terrain preview source contract rejects duplicate or mismatched pins',()=>{
  const countries=Buffer.from('{"type":"FeatureCollection","features":[]}'),bytes=Buffer.from('tint'),digest=sha(bytes);
  const dem={version:'0.13.3',representation:'dem-relief-v1',levels:[{id:0,rows:1,columns:1},{id:1,rows:1,columns:1}],tint:{sha256:digest}};
  const inventory={assets:['terrain/v0.13.0/0/0-0.webp','terrain/v0.13.0/1/0-0.webp','terrain/v0.13.3/tint.webp']
    .map(path=>({path,bytes:bytes.length,sha256:digest}))};
  const source={dem,inventory,countryBytes:countries,landMaskSha256:sha(countries)};
  assert.equal(validateTerrainPreviewSources(source).assets.size,3);
  const duplicated=structuredClone(inventory);duplicated.assets.push(duplicated.assets[0]);
  assert.throws(()=>validateTerrainPreviewSources({...source,inventory:duplicated}),/pins/i);
  assert.throws(()=>validateTerrainPreviewSources({...source,landMaskSha256:'0'.repeat(64)}),/mask/i);
  const changed=structuredClone(dem);changed.tint.sha256='0'.repeat(64);
  assert.throws(()=>validateTerrainPreviewSources({...source,dem:changed}),/tint/i);
});
test('pinned terrain cache verifies bytes and refuses changes or path escape',async t=>{
  const cache=await mkdtemp(join(tmpdir(),'pando-terrain-cache-'));t.after(()=>rm(cache,{recursive:true}));
  const body=Buffer.from('source bytes'),spec={bytes:body.length,sha256:sha(body)},path='terrain/0.webp',url='https://example.test/source';
  let requests=0;const fetcher=async()=>{requests++;return new Response(body);};
  assert.deepEqual(await readPinnedTerrainAsset({cache,path,url,spec,fetcher}),body);
  assert.deepEqual(await readPinnedTerrainAsset({cache,path,url,spec,fetcher}),body);assert.equal(requests,1);
  await writeFile(join(cache,path),'changed');await assert.rejects(readPinnedTerrainAsset({cache,path,url,spec,fetcher}),/differs/i);
  assert.equal(await readFile(join(cache,path),'utf8'),'changed');
  await assert.rejects(readPinnedTerrainAsset({cache,path:'../outside',url,spec,fetcher}),/scope|path/i);
  const controller=new AbortController();controller.abort();
  await assert.rejects(readPinnedTerrainAsset({cache,path:'other.webp',url,spec,fetcher,signal:controller.signal}),/abort/i);
});
