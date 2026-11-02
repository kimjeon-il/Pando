import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import test from 'node:test';
import {
  ORIGINAL_OSM_SYSTEM_IDS,auditHydroOsm,auditOsmCreditRemoval,
} from '../../tools/gis/audit-osm-credit-removal.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
function sample({osm=true,source='HydroRIVERS 1.0 · OSM waterway names'}={}){
  const core=[{fid:1,category:'river',systemId:'40475481',awId:'hydro-system:40475481',
    name:'금강',mainstemNameKo:'금강',fragmentIndex:0}];
  const detail=[{fid:1,source,...(osm?{osmRelationIds:[12345]}:{}),
    ...(!osm&&source==='HydroRIVERS 1.0'?{independentSourceUrls:['https://www.naturalearthdata.com/']}:{}),
  }];
  const bytes=[
    Buffer.from('INDEX'),gzipSync(Buffer.from(JSON.stringify({version:5,features:core})),{mtime:0}),
    gzipSync(Buffer.from(JSON.stringify({version:5,features:detail})),{mtime:0}),
    Buffer.from('GEOMETRY'),
  ];
  let offset=0;
  const rows=bytes.map(buffer=>{const spec={url:'hydro.bin',offset,bytes:buffer.length,sha256:sha(buffer)};offset+=buffer.length;return spec;});
  const bundle=Buffer.concat(bytes),n=osm||/OSM waterway names/.test(source)?1:0;
  const manifest={schema:'pandolab-water-shards-v5',version:'0.13.2',container:{url:'hydro.bin',bytes:bundle.length,sha256:sha(bundle)},
    index:rows[0],metadata:{core:rows[1],detail:rows[2],featureCount:1},shards:[rows[3]],
    stats:{osmWaterwayMatchCount:n},sources:{osmWaterways:{matchedSystems:n},
      nameEnrichment:{osmMatches:n},hydroRivers:[{datasetCode:'as',osmMatches:n}]}};
  return {manifest,bundle};
}
const official=Object.freeze({
  openStreetMapDataUsed:false,sourceType:'independent-official-and-surveyed-riverbank',
  treatyAnchorCount:31,independentlyDigitizedRightBankSegments:2,
  amendment2019ExclusionsApplied:true,geometrySha256:'a'.repeat(64),
  independentSourceUrls:['https://old.adilet.zan.kz/rus/docs/Z1900000282',
    'https://portal.baikonuradm.ru/index.php?mod=npb1&npbid=38'],
});

test('the 31 original OSM waterway identities are stable and deduplicated',()=>{
  assert.equal(ORIGINAL_OSM_SYSTEM_IDS.length,31);
  assert.equal(new Set(ORIGINAL_OSM_SYSTEM_IDS).size,31);
});
test('current Hydro OSM metadata blocks removing map credit',()=>{
  const hydro=auditHydroOsm(...Object.values(sample()));
  assert.deepEqual(hydro.remainingSystemIds,['40475481']);
  const result=auditOsmCreditRemoval({hydro,baikonur:official});
  assert.equal(result.safeToRemoveMainMapOsmCredit,false);
  assert.match(result.blockers.join(' / '),/Hydro OSM systems/);
});
test('a missing Baikonur riverbank/exclusions proof blocks even a clean Hydro bundle',()=>{
  const {manifest,bundle}=sample({osm:false,source:'HydroRIVERS 1.0'});
  const hydro=auditHydroOsm(manifest,bundle);
  assert.equal(hydro.remainingCount,0);
  assert.equal(auditOsmCreditRemoval({hydro}).safeToRemoveMainMapOsmCredit,false);
  assert.equal(auditOsmCreditRemoval({hydro,baikonur:{
    ...official,independentlyDigitizedRightBankSegments:1,
  }}).safeToRemoveMainMapOsmCredit,false);
  assert.equal(auditOsmCreditRemoval({hydro,baikonur:official}).safeToRemoveMainMapOsmCredit,true);
});
test('corrupt source range, SHA and source counts are rejected',()=>{
  const {manifest,bundle}=sample();
  assert.throws(()=>auditHydroOsm(manifest,Buffer.from('broken')),/SHA or size/);
  manifest.sources.hydroRivers[0].osmMatches=0;
  assert.throws(()=>auditHydroOsm(manifest,bundle),/account mismatch/);
});
test('metadata-only OSM removal cannot retain the old OSM dataset/source declaration',()=>{
  const {manifest,bundle}=sample({osm:false,source:'HydroRIVERS 1.0'});
  manifest.dataset='HydroRIVERS 1.0 systems · OSM waterway names';
  manifest.sources.osmWaterways.file='osm-waterway-ko-v0.13.0.json';
  const audit=auditHydroOsm(manifest,bundle);
  assert.equal(audit.remainingCount,0);
  assert.equal(audit.staleManifestOsmSource,true);
  const result=auditOsmCreditRemoval({hydro:audit,baikonur:official});
  assert.equal(result.safeToRemoveMainMapOsmCredit,false);
  assert.match(result.blockers.join(' / '),/Hydro manifest still declares/);
});
test('OSM source labels or independent URL contamination cannot be papered over',()=>{
  const {manifest,bundle}=sample({osm:false,source:'HydroRIVERS 1.0 · OSM waterway names'});
  const hydro=auditHydroOsm(manifest,bundle);
  assert.equal(hydro.remainingCount,1);
  assert.equal(hydro.inconsistentLabels.length,1);
});
