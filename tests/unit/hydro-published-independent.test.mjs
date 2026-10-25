import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import { verifyPublishedHydro } from '../../tools/gis/verify-published-hydro-independent-names.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const original=readFileSync(new URL('../../tools/gis/hydro-independent-name-replacements.json',import.meta.url));
function fixture() {
  const reviews=JSON.parse(original).replacements;
  const core=reviews.map((r,i)=>({fid:i+1,category:'river',systemId:r.systemId,
    awId:'hydro-system:'+r.systemId,name:r.nameKo,mainstemNameKo:r.nameKo}));
  const detail=reviews.map((r,i)=>({fid:i+1,source:'HydroRIVERS 1.0',
    independentSourceUrls:[...new Set(r.independentSources.map(x=>x.url))]}));
  core.push({fid:43,category:'river',systemId:'999',name:'Other'});
  detail.push({fid:43,source:'HydroRIVERS',osmRelationIds:[501]});
  const bytes=[Buffer.from('INDEX'),
    gzipSync(JSON.stringify({version:5,features:core}),{mtime:0}),
    gzipSync(JSON.stringify({version:5,features:detail}),{mtime:0}),Buffer.from('SHARD')];
  let offset=0;const specs=bytes.map(b=>{const x={url:'hydro.bin',offset,bytes:b.length,sha256:sha(b)};offset+=b.length;return x;});
  const bundle=Buffer.concat(bytes);
  const manifest={version:'0.13.2',schema:'pandolab-water-shards-v5',
    container:{url:'hydro.bin',bytes:bundle.length,sha256:sha(bundle)},
    index:specs[0],metadata:{core:specs[1],detail:specs[2],featureCount:43},shards:[specs[3]],
    stats:{compressedBytes:bundle.length,osmWaterwayMatchCount:1},
    sources:{independentHydronymReplacements:{sha256:sha(original),replacedSystems:42,geometryChanged:false},
      osmWaterways:{matchedSystems:1},nameEnrichment:{osmMatches:1},
      hydroRivers:[{osmMatches:1}]}};
  return {bundle,manifest};
}
test('42 independently sourced names and immutable index/shard SHA are validated',()=>{
  const f=fixture();
  const proof=verifyPublishedHydro(f.manifest,f.bundle,original,original,{fragments:42,osm:1});
  assert.equal(proof.reviewedSystems,42);
  assert.equal(proof.reviewedFragments,42);
  assert.equal(proof.remainingOsmSystems,1);
  assert.equal(proof.indexSha256,sha(Buffer.from('INDEX')));
});
test('tampered bundle, original source or regional accounting must fail closed',()=>{
  const f=fixture(),bad=Buffer.from(f.bundle);bad[0]^=1;
  assert.throws(()=>verifyPublishedHydro(f.manifest,bad,original,original),/SHA/);
  assert.throws(()=>verifyPublishedHydro(f.manifest,f.bundle,Buffer.from('{}'),original),/original bytes/);
  f.manifest.sources.hydroRivers[0].osmMatches=0;
  assert.throws(()=>verifyPublishedHydro(f.manifest,f.bundle,original,original),/region count/);
});
