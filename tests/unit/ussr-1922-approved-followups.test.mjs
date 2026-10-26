import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {FOUNDER_IDS,MEMBER_HASHES,MASTER,DISPLAY} from '../../tools/gis/replay-ussr-1922-countries.mjs';
import {APPROVED_DATA_PIN,BASE_APPROVED_DATA_PIN,CENTRAL_ASIA_DATA_PIN,PROOFS,CORRECTED_IDS,geometryHash,
  readApprovedCorrectionReports,verifyApprovedFollowups}
 from '../../tools/gis/audit-ussr-1922-approved-followups.mjs';
const shape=i=>({type:'MultiPolygon',coordinates:[[[[i,0],[i+1,0],[i+1,1],[i,0]]]]});
const fixture=()=>{
 const approved={type:'FeatureCollection',features:FOUNDER_IDS.map((id,i)=>({
   id,geometry:shape(i),properties:{source:i},
 }))};
 const countries=Object.fromEntries(FOUNDER_IDS.map((id,i)=>[id,{
   entityId:id,parentEntityId:i?'state:soviet-union':null,
   lifetime:{validFrom:'1922-12-30',validTo:i===4?'1936-12-04':'1991-12-25'},
   sourceInfo:{approved1922:{masterSha256:MEMBER_HASHES[MASTER],
     displaySha256:MEMBER_HASHES[DISPLAY]}},
   geometryVersions:[{versionId:id+':1922-12-30-reviewed-v2',
     validFrom:'1922-12-30',validTo:'1925-05-12',
     geometry:shape(i),sourceProperties:{source:i},
     reviewedMasterSha256:MEMBER_HASHES[MASTER],displaySha256:MEMBER_HASHES[DISPLAY]}],
 }]));
 for(let i=0;i<4;i++)countries[FOUNDER_IDS[i]].geometryVersions[0].geometry=shape(i+8);
 const pairs=CORRECTED_IDS.map(id=>{
   const original=approved.features.find(f=>f.id===id);
   const from=geometryHash(original.geometry),to=geometryHash(
     countries[id].geometryVersions[0].geometry);
   return {entityId:id,sourceVersionId:id+':1922-12-30-reviewed-v2',
     sourceBeforeSha256:from,sourceAfterSha256:to,otherPeriodsUnchanged:true};
 });
 const dniesterPairs=[pairs[0],pairs[2]].map(row=>({...row,sourceAfterSha256:
   createHash('sha256').update(row.entityId).digest('hex')}));
 for(const row of pairs){
   const d=dniesterPairs.find(x=>x.entityId===row.entityId);
   if(d)row.sourceBeforeSha256=d.sourceAfterSha256;
 }
 const europeManifest={validFrom:'1922-12-30',validTo:'1925-05-12',
   entities:pairs.map(row=>({versionId:row.sourceVersionId,
     source_valid:true,compiled_valid:true,
     compiled_outside_local_delta_difference_area_deg2:0})),
   guards:{preserved:true}};
 const guards={Finland_modern_original_count:137,
   Finland_modern_vertices_preserved:true,
   coasts:{south1397_1406_exact_subsequence:true,
     north2152_2154_exact_subsequence:true},
   shared_poland:[0,1,2].map(i=>({
     shared_new_poland_boundary_missing_from_USSR_degree_length:0,
     missing_from_republic_degree_length:0,entity:i}))};
 const reports={dniester:{entities:dniesterPairs,
     romaniaChanged:false,otherCountriesRecomputed:false},
   dniesterManifest:{sameDeltaForBothEntities:true,
     validation:{sameDeltaForSourceAndBuiltin:true,RomaniaNewOverlapArea:0}},
   europe:{entities:pairs,romaniaChanged:false,otherCountriesRecomputed:false,
     preparedMeshPolicy:'Keep content-addressed old meshes'},
   europeManifest,guards};
 reports.centralAsia={baseDataRevision:BASE_APPROVED_DATA_PIN,
   validFrom:'1922-12-30',validTo:'1925-05-12',
   entities:FOUNDER_IDS.slice(0,2).map((id,i)=>{
     const before=geometryHash(countries[id].geometryVersions[0].geometry);
     countries[id].geometryVersions[0].geometry=shape(i+20);
     return {entityId:id,sourceVersionId:id+':1922-12-30-reviewed-v2',
       validFrom:'1922-12-30',validTo:'1925-05-12',
       sourceBeforeSha256:before,sourceAfterSha256:geometryHash(countries[id].geometryVersions[0].geometry),
       otherPeriodsUnchanged:true,lifetimeUnchanged:true,outsideScopeUnchanged:true,
       waterDatasetsUnchanged:true,europeGeometryUnchanged:true};
   })};
 reports.bukhara={baseDataRevision:CENTRAL_ASIA_DATA_PIN,
   validFrom:'1922-12-30',validTo:'1925-05-12',segments:['Bukhara'],
   entities:reports.centralAsia.entities.map((r,i)=>{
     countries[r.entityId].geometryVersions[0].geometry=shape(i+30);
     return {...r,sourceBeforeSha256:r.sourceAfterSha256,
       sourceAfterSha256:geometryHash(countries[r.entityId].geometryVersions[0].geometry),
       priorThreeSegmentsUnchanged:true};
   })};
 const partition={schemaVersion:1,passed:true,founderCount:5,
   parentMinusChildrenSquareDegrees:0,childrenMinusParentSquareDegrees:0,
   largestRepublicOverlapSquareDegrees:0,maximumAllowedSquareDegrees:1e-10,
   republicPairOverlaps:Array.from({length:6},()=>({overlapSquareDegrees:0}))};
 return {approved,countries,reports,partition};
};
test('validated corrections preserve all four 1922 revisions and the untouched fifth founder',()=>{
 const f=fixture(),baseline=structuredClone(f.countries);
 const result=verifyApprovedFollowups(f);
 assert.equal(result.status,'approved-followups-verified');
 assert.equal(result.correctedFounders,4);
 assert.equal(result.unchangedFounders,1);
 assert.equal(result.parentRepublicPartition.passed,true);
 assert.deepEqual(f.countries,baseline,'A geometry auditor must be read-only');
});
test('missing an intermediate Dniester revision is a broken lineage',()=>{
 const f=fixture();f.reports.europe.entities[0].sourceBeforeSha256='0'.repeat(64);
 assert.throws(()=>verifyApprovedFollowups(f),/correction chain/);
});
test('even a valid geometry with a different current hash is unapproved',()=>{
 const f=fixture();f.countries[FOUNDER_IDS[2]].geometryVersions[0].geometry.coordinates[0][0][0][0]+=.01;
 assert.throws(()=>verifyApprovedFollowups(f),/does not match approved European/);
});
test('a parent-child gap, overlap, or accidental earlier founding blocks publication',()=>{
 const f=fixture();f.partition.passed=false;
 assert.throws(()=>verifyApprovedFollowups(f),/gaps or overlaps/);
 const g=fixture();g.countries[FOUNDER_IDS[0]].lifetime.validFrom='1922-01-01';
 assert.throws(()=>verifyApprovedFollowups(g),/must not exist before/);
});
test('archival document names alone do not constitute verified approval',async()=>{
 const bytes=Object.fromEntries(Object.keys(PROOFS).map(k=>[k,Buffer.from(k)]));
 const receipt=Object.fromEntries(Object.entries(PROOFS).map(([key,value])=>
   [value.path,{stored:value.path,encoding:'identity',bytes:value.bytes,
     sha256:value.sha256}]));
 const index={files:receipt};
 await assert.rejects(readApprovedCorrectionReports(index,APPROVED_DATA_PIN,{
   readRemote:async url=>bytes[Object.keys(PROOFS).find(k=>url.endsWith(PROOFS[k].path))],
 }),/SHA-256/);
 await assert.rejects(readApprovedCorrectionReports(index,'0'.repeat(40),{
   readRemote:async()=>Buffer.from('fake'),
 }),/unreviewed data revision/);
});

test('Central Asian approval is an exact successor of Europe for USSR and RSFSR only',()=>{
 const f=fixture();const result=verifyApprovedFollowups(f);
 assert.ok(result.correctionSequence.includes('2026-10-26-central-asia-approved'));
 for(const mutate of [
  f=>{f.reports.centralAsia.entities[0].sourceBeforeSha256='0'.repeat(64);},
  f=>{f.reports.centralAsia.entities.pop();},
  f=>{f.reports.centralAsia.entities.push(structuredClone(f.reports.centralAsia.entities[0]));},
  f=>{f.reports.centralAsia.entities[1].entityId=FOUNDER_IDS[2];},
  f=>{f.reports.centralAsia.entities[0].validTo='1925-05-13';},
  f=>{f.reports.centralAsia.baseDataRevision='0'.repeat(40);},
  f=>{delete f.reports.centralAsia;},
 ]){const candidate=fixture();mutate(candidate);assert.throws(()=>verifyApprovedFollowups(candidate),/Central Asian/);}
});
test('all Central Asian locked-scope guards are mandatory and a European rollback fails',()=>{
 for(const guard of ['otherPeriodsUnchanged','lifetimeUnchanged','outsideScopeUnchanged','waterDatasetsUnchanged','europeGeometryUnchanged']){
  for(const value of [false,undefined]){const f=fixture();f.reports.centralAsia.entities[0][guard]=value;assert.throws(()=>verifyApprovedFollowups(f),/Central Asian/);}
 }
 const f=fixture();f.countries[FOUNDER_IDS[0]].geometryVersions[0].geometry=shape(8);
 assert.throws(()=>verifyApprovedFollowups(f),/Bukhara/);
});

test('Bukhara is a separately pinned successor and cannot erase the prior three segments',()=>{
 const f=fixture();assert.equal(verifyApprovedFollowups(f).correctionSequence.at(-1),'2026-10-26-bukhara-approved');
 const changes=[
  f=>{delete f.reports.bukhara;},
  f=>{f.reports.bukhara.baseDataRevision=BASE_APPROVED_DATA_PIN;},
  f=>{f.reports.bukhara.entities.pop();},
  f=>{f.reports.bukhara.entities[1]=structuredClone(f.reports.bukhara.entities[0]);},
  f=>{f.reports.bukhara.entities[1].entityId=FOUNDER_IDS[2];},
  f=>{f.reports.bukhara.entities[0].sourceBeforeSha256=f.reports.europe.entities[0].sourceAfterSha256;},
  f=>{f.countries[FOUNDER_IDS[0]].geometryVersions[0].geometry=shape(20);},
  f=>{f.reports.bukhara.entities[0].validTo='1925-05-13';},
 ];
 for(const key of ['otherPeriodsUnchanged','lifetimeUnchanged','outsideScopeUnchanged','waterDatasetsUnchanged','europeGeometryUnchanged','priorThreeSegmentsUnchanged'])
  changes.push(f=>{f.reports.bukhara.entities[0][key]=false;});
 for(const mutate of changes){const f=fixture();mutate(f);assert.throws(()=>verifyApprovedFollowups(f),/Bukhara/);}
});
