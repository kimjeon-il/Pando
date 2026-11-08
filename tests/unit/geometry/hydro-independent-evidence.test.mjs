import { describe as contractSuite } from 'node:test';
import * as __hydro_dep0 from "node:assert/strict";
import * as __hydro_dep1 from "node:test";
import * as __hydro_dep2 from "../../../tools/gis/hydro-independent-name-policy.mjs";
import * as __hydro_dep3 from "node:child_process";
import * as __hydro_dep4 from "node:crypto";
import * as __hydro_dep5 from "node:fs";
import * as __hydro_dep6 from "node:url";
import * as __hydro_dep7 from "node:os";
import * as __hydro_dep8 from "node:path";
import * as __hydro_dep9 from "../../../tools/gis/verify-independent-river-point-anchors.mjs";
import * as __hydro_dep10 from "../../../tools/gis/hydro-point-screen-native.mjs";
import * as __hydro_dep11 from "node:zlib";
import * as __hydro_dep12 from "../../../tools/gis/verify-published-hydro-independent-names.mjs";
contractSuite("hydro-independent-evidence", () => {
const assert = __hydro_dep0.default;
const test = __hydro_dep1.default;
const { verifyStationEvidence, verifyNaturalEarthEvidence, verifyYarraEvidence } = __hydro_dep2;

test('station evidence requires exact station identity and bounded measured distances',()=>{
  const ids=['70816878','70819626'],review={},proof={candidateSystems:{},stationRows:[]};
  for(const id of ids){review[id]={officialStationEvidence:{stationIds:[id],maximumMatchingStationDistanceKm:0.5,nearestDifferentBasinStationKm:25}};
    proof.candidateSystems[id]={candidateName:id,criteriaSatisfied:true,maxMatchingStationDistanceKm:0.5,nearestDifferentBasinStationKm:25};proof.stationRows.push({station:id,independentHydrography:id});}
  verifyStationEvidence(proof,review);
  const bad=structuredClone(proof);bad.stationRows[0].station='other';assert.throws(()=>verifyStationEvidence(bad,review),/station/i);
  const distant=structuredClone(proof);distant.candidateSystems[ids[0]].maxMatchingStationDistanceKm=0.6;assert.throws(()=>verifyStationEvidence(distant,review),/distance/i);
});
test('Natural Earth evidence rejects missing, changed or competing candidates',()=>{
  const review={replacements:[{systemId:'1',naturalEarth:{name:'A',sampleCoverage:.8},conservativeMainstemReview:{otherNamedNECoverage:.1}}]};
  const evidence={items:[{systemId:'1',naturalEarthCandidates:[{name:'A',nameKo:'가',sampleCoverage:.8,meanDistanceDegrees:.01},{name:'B',nameKo:'나',sampleCoverage:.1}]}]};
  verifyNaturalEarthEvidence(review,evidence);
  const bad=structuredClone(evidence);bad.items[0].naturalEarthCandidates[1].sampleCoverage=.2;
  assert.throws(()=>verifyNaturalEarthEvidence(review,bad),/competing/i);
  const missing=structuredClone(evidence);missing.items[0].naturalEarthCandidates=[];assert.throws(()=>verifyNaturalEarthEvidence(review,missing),/candidate/i);
});
test('Natural Earth evidence checks cross-border, partial and confluence rules',()=>{
  const row=(name,coverage,distance=.01)=>({name,nameKo:name,sampleCoverage:coverage,meanDistanceDegrees:distance});
  const cases=[
    [{systemId:'1',naturalEarth:{name:'A',sampleCoverage:.4},crossBorderNameReview:{strongestOtherNENameCoverage:.2}},[row('A',.4),row('B',.2)]],
    [{systemId:'1',naturalEarth:{name:'A',sampleCoverage:.8},partialExistingNameReview:{strongestOtherNENameCoverage:.05}},[row('A',.8),row('B',.05)]],
    [{systemId:'1',naturalEarth:{name:'A',sampleCoverage:.6},basinConfluenceReview:{namedTributaryNE:'B',tributarySampleCoverage:.2}},[row('A',.6),row('B',.2)]],
    [{systemId:'1',naturalEarth:{name:'A',sampleCoverage:.71},independentBasinRename:{namedTributaryNE:'B',tributarySampleCoverage:.2}},[row('A',.71),row('B',.2)]],
  ];
  for(const [entry,candidates] of cases){const review={replacements:[entry]},evidence={items:[{systemId:'1',naturalEarthCandidates:candidates}]};
    verifyNaturalEarthEvidence(review,evidence);
    const changed=structuredClone(evidence);changed.items[0].naturalEarthCandidates[1].sampleCoverage+=.1;
    assert.throws(()=>verifyNaturalEarthEvidence(review,changed));
  }
});
test('Yarra comparison requires the recorded source, license and directional metrics',()=>{
  const recorded={sourceGeoJSONSha256:'abc',hydroMainstemSamples:10,within1kmHydroToGovernment:.9,within1kmGovernmentToHydro:.8,p90DistanceKm:2};
  const review={replacements:[{systemId:'50798885',officialGovernmentVectorEvidence:recorded}]};
  const proof={source:{sourceGeoJSONSha256:'abc',license:'CC BY 4.0'},hydroSamplesToNamedGovernmentRiver:{samples:10,within1km:.9,p90DistanceKm:2},governmentSamplesToHydroMainstem:{within1km:.8}};
  verifyYarraEvidence(proof,review);
  assert.throws(()=>verifyYarraEvidence({...proof,source:{...proof.source,license:'unknown'}},review),/license/i);
});
});
contractSuite("hydro-independent-name-policy", () => {
const assert = __hydro_dep0.default;
const { spawnSync } = __hydro_dep3;
const { createHash } = __hydro_dep4;
const { readFileSync } = __hydro_dep5;
const { fileURLToPath } = __hydro_dep6;
const test = __hydro_dep1.default;
const { loadIndependentHydronyms, validateIndependentHydronyms } = __hydro_dep2;

const path = fileURLToPath(new URL("../../../tools/gis/hydro-independent-name-replacements.json", import.meta.url));
const cli = fileURLToPath(new URL("../../../tools/gis/hydro-independent-name-policy.mjs", import.meta.url));
const original = readFileSync(path);
const payload = JSON.parse(original);
const originalHash = createHash('sha256').update(original).digest('hex');
const rows = () => loadIndependentHydronyms(path);
const changed = (id, mutate) => {
  const data = structuredClone(payload);
  mutate(data.replacements.find(row => row.systemId === id));
  return data;
};
test('reject OSM/Overpass URL, missing Korean name and insufficient mainstem coverage', () => {
  for (const mutate of [
    row => { row.independentSources[0].url = 'https://www.openstreetmap.org/relation/1'; },
    row => { row.nameKo = ''; },
    row => { row.naturalEarth.sampleCoverage = 0.22; },
  ]) assert.throws(() => validateIndependentHydronyms(changed('10047863', mutate)));
});
test('USGS corroboration requires near stations and independent basin separation', () => {
  for (const mutate of [
    row => { row.officialStationEvidence.maximumMatchingStationDistanceKm = 15; },
    row => { row.officialStationEvidence.nearestDifferentBasinStationKm = 0.2; },
    row => { row.independentSources = row.independentSources.slice(0, 1); },
  ]) assert.throws(() => validateIndependentHydronyms(changed('70819626', mutate)));
});
test('conservative, partial, confluence and renamed basin reviews reject unsupported edits', () => {
  for (const [id, mutate] of [
    ['20336821', row => { row.conservativeMainstemReview.otherNamedNECoverage = 0.4; }],
    ['20336821', row => { row.nameKo = '오데르강'; }],
    ['20386022', row => { row.partialExistingNameReview.strongestOtherNENameCoverage = 0.4; }],
    ['20386022', row => { row.naturalEarth.sampleCoverage = 0.2; }],
    ['20498112', row => { row.basinConfluenceReview.tributarySampleCoverage = 0.01; }],
    ['20498112', row => { row.nameKo = '오데르강'; }],
    ['20265844', row => { row.independentBasinRename.tributarySampleCoverage = 0.1; }],
    ['20265844', row => { row.independentBasinRename.method = 'auto-bbox-rename'; }],
    ['20265844', row => { row.independentSources = row.independentSources.filter(s => s.kind !== 'government-ministry-geography'); }],
  ]) assert.throws(() => validateIndependentHydronyms(changed(id, mutate)), id);
});
test('state vector and cross-border review must retain licence, independent sources and verified geometry', () => {
  for (const [id, mutate] of [
    ['50798885', row => { row.officialGovernmentVectorEvidence.within1kmHydroToGovernment = 0.12; }],
    ['50798885', row => { row.officialGovernmentVectorEvidence.sourceGeoJSONSha256 = 'x'.repeat(64); }],
    ['50798885', row => { row.independentSources = row.independentSources.slice(0, 2); }],
    ['20597827', row => { row.nameKo = '오데르강'; }],
    ['20597827', row => { row.crossBorderNameReview.strongestOtherNENameCoverage = 0.5; }],
    ['20597827', row => { row.independentSources = row.independentSources.filter(s => s.kind !== 'government-crossborder-hydrology'); }],
  ]) assert.throws(() => validateIndependentHydronyms(changed(id, mutate)), id);
});
test('old OSM-only IDs remain unverified and rejected by the policy', () => {
  const result = rows();
  for (const id of ['41023100', '20773860', '41182380', '41386179'])
    assert.equal(Object.hasOwn(result, id), false);
});
test('Node CLI returns the same approved mapping without changing its input JSON', () => {
  const result = spawnSync(process.execPath, [cli, '--input', path], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), rows());
  assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), originalHash);
});
});
contractSuite("hydro-independent-point-screen", () => {
const assert = __hydro_dep0.default;
const { spawnSync } = __hydro_dep3;
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = __hydro_dep5;
const { tmpdir } = __hydro_dep7;
const { join, resolve } = __hydro_dep8;
const test = __hydro_dep1.default;
const { buildIndependentPointScreen } = __hydro_dep9;
const { windowsHydroRuntime } = __hydro_dep10;

const ids=['20071308','20075401','20456598','20532766','20540915'];
function fixture(){return {manifest:{version:'0.13.2'},features:ids.map(id=>({metadata:{systemId:id,role:'mainstem'},
  geometry:{type:'LineString',coordinates:[[25,64],[25.1,64.1]]}}))};}
test('independent Hydro screen preserves source attribution and delegates bounded geometry to native code',async()=>{
  const input=fixture(),before=structuredClone(input),calls=[];
  const result=await buildIndependentPointScreen(input,async request=>{
    calls.push(request);return {lineLengthsMeters:[123456.7],points:request.points.map((point,index)=>({distanceMeters:index?1062.5:1234.4,nearestLonLat:point}))};
  });
  assert.deepEqual(input,before);assert.equal(result.schema,'pando-independent-hydronym-point-screen-v1');
  assert.equal(result.nameIdentityVerified,false);assert.equal(result.geometryCopiedToRuntime,false);
  assert.deepEqual(result.items.map(row=>row.systemId),ids);assert.deepEqual(calls.map(row=>row.crs),['EPSG:32635','EPSG:32635','EPSG:32640','EPSG:32638','EPSG:32638']);
  assert.equal(result.items[0].mainstemTotalLengthKm,123.457);
  const point=result.items[0].pointChecks.finnish_nls_oulujoki;
  assert.equal(point.closestHydroMainstemKm,1.234);assert.deepEqual(point.nearestHydroLonLat,[25.56374,64.99977]);
  assert.match(point.source,/finto\.fi/);assert.match(point.sourceType,/National Land Survey/);
  assert.equal(result.items[0].pointChecks.finnish_nls_siikajoki.closestHydroMainstemKm,1.062);
});
test('independent Hydro screen refuses an existing output before reading input or launching a native tool',t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-hydro-screen-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const output=join(root,'existing.json');writeFileSync(output,'preserve');
  const result=spawnSync(process.execPath,[resolve('tools/gis/verify-independent-river-point-anchors.mjs'),
    '--decoded',join(root,'missing.json'),'--output',output],{encoding:'utf8',windowsHide:true});
  assert.notEqual(result.status,0);assert.match(result.stderr,/exists/i);assert.equal(readFileSync(output,'utf8'),'preserve');
});
test('Windows Hydro point screen requires the matching GEOS, PROJ and projection data',t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-hydro-runtime-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  for(const path of ['etc/setup','bin','share/proj'])mkdirSync(join(root,path),{recursive:true});
  for(const path of ['bin/geos_c.dll','bin/proj_9.dll','share/proj/proj.db'])writeFileSync(join(root,path),'fixture');
  const database=join(root,'etc/setup/installed.db');
  writeFileSync(database,'geos geos-3.15.0-1.tar.bz2 0\nproj9-runtime proj9-runtime-9.8.1-1.tar.bz2 0\nproj-runtime-data proj-runtime-data-9.8.1-1.tar.bz2 0\n');
  assert.equal(windowsHydroRuntime(root).bin,join(root,'bin'));
  writeFileSync(database,'geos geos-3.14.0-1.tar.bz2 0\n');assert.throws(()=>windowsHydroRuntime(root),/version mismatch/i);
});
test('independent Hydro screen rejects wrong baseline, missing systems and invalid native receipts',async()=>{
  const valid=fixture();
  await assert.rejects(buildIndependentPointScreen({...valid,manifest:{version:'other'}},()=>{}),/0\.13\.2/);
  await assert.rejects(buildIndependentPointScreen({...valid,features:valid.features.slice(1)},()=>{}),/missing mainstem/i);
  await assert.rejects(buildIndependentPointScreen(valid,async()=>({lineLengthsMeters:[],points:[]})),/native.*result/i);
});
});
contractSuite("hydro-published-independent", () => {
const assert = __hydro_dep0.default;
const { createHash } = __hydro_dep4;
const { readFileSync } = __hydro_dep5;
const { gzipSync } = __hydro_dep11;
const test = __hydro_dep1.default;
const { verifyPublishedHydro } = __hydro_dep12;

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const original=readFileSync(new URL("../../../tools/gis/hydro-independent-name-replacements.json",import.meta.url));
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
test('tampered bundle, original source or regional accounting must fail closed',()=>{
  const f=fixture(),bad=Buffer.from(f.bundle);bad[0]^=1;
  assert.throws(()=>verifyPublishedHydro(f.manifest,bad,original,original),/SHA/);
  assert.throws(()=>verifyPublishedHydro(f.manifest,f.bundle,Buffer.from('{}'),original),/original bytes/);
  f.manifest.sources.hydroRivers[0].osmMatches=0;
  assert.throws(()=>verifyPublishedHydro(f.manifest,f.bundle,original,original),/region count/);
});
});
