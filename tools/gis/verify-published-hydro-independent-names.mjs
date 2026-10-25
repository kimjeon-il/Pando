/** Immutable Hydro v0.13.2 publication audit: already reviewed 42 systems, 31 still OSM-matched. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readHydroMetadataSection } from '../inventory-osm-hydronyms.mjs';
import { validateIndependentHydronyms } from './hydro-independent-name-policy.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const check = (ok, message) => {if(!ok)throw Error(message);};
export function verifyPublishedHydro(manifest,bundle,archiveBytes,reviewBytes,expected={}) {
  check(manifest?.version==='0.13.2' && manifest.schema==='pandolab-water-shards-v5',
    'Published Hydro v0.13.2 required');
  check(Buffer.isBuffer(bundle) && bundle.length===manifest.container?.bytes &&
    hash(bundle)===manifest.container.sha256, 'Hydro published bundle SHA/bytes differ');
  check(Buffer.isBuffer(archiveBytes)&&Buffer.isBuffer(reviewBytes) &&
    archiveBytes.equals(reviewBytes) &&
    hash(archiveBytes)===manifest.sources?.independentHydronymReplacements?.sha256 &&
    manifest.sources.independentHydronymReplacements.geometryChanged===false,
    'Published independent review original bytes differ');
  const reviews=validateIndependentHydronyms(JSON.parse(reviewBytes));
  const ids=Object.keys(reviews);
  check(ids.length===42 && manifest.sources.independentHydronymReplacements.replacedSystems===42,
    'Published independent system count differs');
  const segments=[manifest.index,manifest.metadata.core,manifest.metadata.detail,...manifest.shards];
  let offset=0;
  for(const seg of segments) {
    check(seg.url===manifest.container.url && Number.isSafeInteger(seg.offset) &&
      Number.isSafeInteger(seg.bytes) && seg.bytes>0 && seg.offset===offset &&
      offset+seg.bytes<=bundle.length &&
      hash(bundle.subarray(offset,offset+seg.bytes))===seg.sha256,
      'Published Hydro segment offset/hash/order differs');
    offset+=seg.bytes;
  }
  check(offset===bundle.length && manifest.stats.compressedBytes===bundle.length,
    'Published bundle has undeclared trailing bytes');
  const core=readHydroMetadataSection(bundle,manifest.metadata.core);
  const detail=readHydroMetadataSection(bundle,manifest.metadata.detail);
  check(core.length===manifest.metadata.featureCount && detail.length===core.length,
    'Hydro feature count changed');
  const byFid=new Map(detail.map(x=>[x.fid,x])),found=new Set(),osm=new Set();
  check(byFid.size===detail.length && new Set(core.map(x=>x.fid)).size===core.length,
    'Hydro feature IDs repeated');
  let fragments=0;
  for(const row of core) {
    const det=byFid.get(row.fid);
    check(det, 'Missing Hydro detail FID '+row.fid);
    if(row.category!=='river')continue;
    const id=String(row.systemId||''),review=reviews[id];
    if(!review) {
      if((det.osmRelationIds||[]).length)osm.add(id);
      continue;
    }
    check(row.awId==='hydro-system:'+id && row.name===review.nameKo &&
      row.mainstemNameKo===review.nameKo,'Published approved Hydro name differs: '+id);
    const expectedUrls=[...new Set(review.independentSources.map(x=>x.url))];
    check(JSON.stringify(det.independentSourceUrls)===JSON.stringify(expectedUrls) &&
      !(det.osmRelationIds||[]).length &&
      !String(det.source||'').includes('OSM waterway names'),
    'Published independent Hydro source detail differs: '+id);
    found.add(id);fragments++;
  }
  check(found.size===42 && ids.every(id=>found.has(id)),'Published independent systems missing');
  const remaining=manifest.stats.osmWaterwayMatchCount;
  check(osm.size===remaining && manifest.sources.osmWaterways.matchedSystems===remaining &&
    manifest.sources.nameEnrichment.osmMatches===remaining &&
    manifest.sources.hydroRivers.reduce((sum,x)=>sum+x.osmMatches,0)===remaining,
  'Remaining OSM system or region count differs');
  if(expected.fragments!=null)check(fragments===expected.fragments,'Independent fragment count differs');
  if(expected.osm!=null)check(remaining===expected.osm,'Remaining OSM count differs');
  return {schema:'pando-hydro-published-independent-proof-v1',
    bundleSha256:hash(bundle),indexSha256:manifest.index.sha256,
    geometryShardSha256:manifest.shards.map(s=>s.sha256),
    reviewedSystems:found.size,reviewedFragments:fragments,
    remainingOsmSystems:remaining,featureCount:core.length,
    reviewSha256:hash(archiveBytes),
    geometryModified:false,publishedDataModified:false};
}
export function main(argv=process.argv.slice(2)){
  const map=new Map();
  for(let i=0;i<argv.length;i+=2){
    if(!['--manifest','--bundle','--archive-review','--current-review','--output'].includes(argv[i]) ||
      !argv[i+1]||map.has(argv[i]))throw Error('Invalid Hydro publication audit arguments');
    map.set(argv[i],resolve(argv[i+1]));
  }
  check(map.size===5,'Five explicit input/output paths required');
  const output=map.get('--output');
  check(![...map].filter(([k])=>k!=='--output').some(([,v])=>v===output),
    'Output must not overwrite verified source');
  const report=verifyPublishedHydro(JSON.parse(readFileSync(map.get('--manifest'),'utf8')),
    readFileSync(map.get('--bundle')),readFileSync(map.get('--archive-review')),
    readFileSync(map.get('--current-review')),{fragments:1895,osm:31});
  writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log('HYDRO_CURRENT_INDEPENDENT_PROOF='+JSON.stringify(report));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main();}catch(error){console.error('hydro-published-audit: '+error.message);process.exitCode=1;}
}
