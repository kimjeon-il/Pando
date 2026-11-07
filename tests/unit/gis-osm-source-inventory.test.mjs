import { describe as contractSuite } from 'node:test';
import * as __source_dep0 from "node:assert/strict";
import * as __source_dep1 from "node:fs";
import * as __source_dep2 from "node:test";
import * as __source_dep3 from "../../tools/gis/audit-osm-credit-removal.mjs";
import * as __source_dep4 from "node:crypto";
import * as __source_dep5 from "node:zlib";

// Original feature contract: gis-osm-source-inventory.test.mjs
contractSuite("gis-osm-source-inventory", () => {
const assert = __source_dep0.default;
const { readFileSync } = __source_dep1;
const test = __source_dep2.default;
const { ORIGINAL_OSM_SYSTEM_IDS } = __source_dep3;





const read=path=>JSON.parse(readFileSync(new URL('../../'+path,import.meta.url),'utf8'));
const file='tools/gis/osm-independent-river-source-inventory.json';
test('all 31 OSM linked Hydro systems have a non-promoted independent-source review record',()=>{
  const audit=read(file);
  assert.equal(audit.schema,'pando-osm-hydro-independent-source-candidate-inventory-v1');
  assert.equal(audit.osmWaterwayMatchedSystems,31);
  assert.equal(audit.approvedSystems,0);
  assert.equal(audit.rows.length,31);
  assert.deepEqual(new Set(audit.rows.map(x=>x.systemId)),new Set(ORIGINAL_OSM_SYSTEM_IDS));
  assert.equal(new Set(audit.rows.map(x=>x.systemId)).size,31);
  assert(audit.rows.every(x=>x.metadataReplacementApproved===false
    &&x.independentIdentityConfirmed===false&&x.geometryChanged===false));
  assert(audit.rows.every(x=>x.namedPointCandidateUrls.every(url=>/^https:\/\//.test(url)
    &&!/openstreetmap|overpass/i.test(url))));
});
test('all reviewed IDs and names are exactly matched against the existing published source investigations',()=>{
  const audit=read(file);
  const baselines=[
    'tests/fixtures/hydro-osm-batch01-v0132-expected.json',
    'tests/fixtures/hydro-osm-batch02-default-v0132-expected.json',
    'tests/fixtures/hydro-osm-batch03-v0132-expected.json',
  ];
  for(let n=0;n<3;n++){
    const fixture=read(baselines[n]);
    for(const item of fixture.items){
      const row=audit.rows.find(r=>r.systemId===item.systemId);
      assert(row);
      assert.equal(row.auditedBatch,n+1);
      assert.equal(row.priorEvidenceFile,baselines[n]);
      assert.equal(row.currentNameKo,item.publishedNameKo||item.originalNameKo);
      if(n===2)assert.equal(row.priorScreenIdentityConfirmed,false);
    }
  }
  assert.equal(audit.rows.filter(x=>!x.namedPointCandidateUrls.length).length,8);
});
});

// Original feature contract: gis-osm-credit-retirement.test.mjs
contractSuite("gis-osm-credit-retirement", () => {
const assert = __source_dep0.default;
const { createHash } = __source_dep4;
const { gzipSync } = __source_dep5;
const test = __source_dep2.default;
const { ORIGINAL_OSM_SYSTEM_IDS, auditHydroOsm, auditOsmCreditRemoval } = __source_dep3;






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
});
