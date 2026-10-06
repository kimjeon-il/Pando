import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';

// Static editing fixture, not a change to historical dates in production data.
// The real loader verifies these actual gzip bytes and the matching index hash.
export async function routeStaticCatalogSource(page,entityId){
  const root=new URL('../../../assets/data/territorial-entities/',import.meta.url);
  const file=entityId.replace(':','-');
  const entity=JSON.parse(fs.readFileSync(new URL(`source/${file}.json`,root),'utf8'));
  if(entity.geometryVersions.length!==1)throw new Error('Static fixture requires one snapshot');
  entity.lifetime={validFrom:null,validTo:null};
  Object.assign(entity.geometryVersions[0],{validFrom:null,validTo:null});
  const decoded=Buffer.from(JSON.stringify(entity)),stored=gzipSync(decoded),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
  const index=JSON.parse(fs.readFileSync(new URL('generated/v2/index.json',root),'utf8'));
  const entry=index.entities.find(e=>e.entityId===entityId);
  Object.assign(entry,{lifetime:entity.lifetime,validFrom:null,validTo:null,compressedBytes:stored.length,decodedBytes:decoded.length,sha256:sha(stored)});
  entry.geometryVersions=entity.geometryVersions.map(({geometry,...version})=>version);
  const indexBytes=Buffer.from(JSON.stringify(index)),spec={encoding:'identity',compressedBytes:indexBytes.length,decodedBytes:indexBytes.length,sha256:sha(indexBytes)};
  await page.route('**/assets/js/build-meta.js*',async route=>{
    const response=await route.fetch();
    await route.fulfill({response,body:`${await response.text()}\nglobalThis.PANDOLAB_BUILD_META=Object.freeze({...globalThis.PANDOLAB_BUILD_META,territorialIndex:${JSON.stringify(spec)}});`});
  });
  await page.route('**/territorial-entities/generated/v2/index.json*',route=>route.fulfill({body:indexBytes,contentType:'application/json'}));
  await page.route(`**/territorial-entities/generated/v2/${file}.json.gz*`,route=>route.fulfill({body:stored,contentType:'application/gzip'}));
}
