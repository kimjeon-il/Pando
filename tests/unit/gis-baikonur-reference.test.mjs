import { describe as contractSuite } from 'node:test';
import * as __source_dep0 from "node:assert/strict";
import * as __source_dep1 from "node:fs";
import * as __source_dep2 from "node:os";
import * as __source_dep3 from "node:path";
import * as __source_dep4 from "node:test";
import * as __source_dep5 from "../../tools/gis/baikonur-official-reference.mjs";
import * as __source_dep6 from "../../tools/gis/baikonur-2019-exclusions.mjs";
import * as __source_dep7 from "../../tools/gis/validate-baikonur-independent-banks.mjs";
import * as __source_dep8 from "../../tools/gis/verify-baikonur-lease-exclusions.mjs";
import * as __source_dep9 from "../../tools/gis/baikonur-independent-lease-candidate.mjs";

// Original feature contract: gis-baikonur-reference.test.mjs
contractSuite("gis-baikonur-reference", () => {
const assert = __source_dep0.default;
const { mkdtempSync, readFileSync, rmSync } = __source_dep1;
const { tmpdir } = __source_dep2;
const { join } = __source_dep3;
const test = __source_dep4.default;
const { ANCHORS, UNRESOLVED_BANKS, decimalDegrees, baikonurReference, writeReference } = __source_dep5;







test('treaty reference preserves 31 verified anchors and 29 unambiguous straight segments',()=>{
 const result=baikonurReference(),anchors=result.features.filter(x=>x.properties.kind==='official-anchor'),
   lines=result.features.filter(x=>x.properties.kind==='treaty-straight-segment');
 assert.equal(ANCHORS.length,31);
 assert.equal(anchors.length,31);
 assert.equal(lines.length,29);
 assert.deepEqual(anchors[0].geometry.coordinates,[63.01805556,45.70277778]);
 assert.deepEqual(anchors[16].geometry.coordinates,[63.72916667,45.73472222]);
 assert.deepEqual(anchors[30].geometry.coordinates,[63.21944444,45.6]);
 for(const [from,to] of UNRESOLVED_BANKS)
   assert.ok(!lines.some(x=>x.properties.fromPoint===from&&x.properties.toPoint===to));
 assert.ok(result.features.every(x=>['Point','LineString'].includes(x.geometry.type)));
});
test('original datum, treaty limitations and right bank remains explicitly unresolved',()=>{
 const p=baikonurReference().properties;
 assert.equal(p.openStreetMapDataUsed,false);
 assert.match(p.status,/INCOMPLETE/);
 assert.equal(p.sourceUrls.length,2);
 assert.equal(p.originalCoordinateDatum,'not explicitly verified');
 assert.deepEqual(p.rightBankNotReconstructed.map(x=>[x.fromPoint,x.toPoint]),[[17,18],[31,1]]);
 assert.equal(p.remaining.length,3);
});
test('DMS parser refuses invalid coordinates without guessing a datum',()=>{
 assert.equal(decimalDegrees('45 42 10'),45.70277778);
 for(const s of ['45 60 10','45 10 60','invalid','45 -1 1'])
   assert.throws(()=>decimalDegrees(s),/Invalid DMS/);
});
test('output is write-once and --check never modifies the original',t=>{
 const dir=mkdtempSync(join(tmpdir(),'baikonur-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const file=join(dir,'original.json');
 writeReference(file);
 const before=readFileSync(file,'utf8');
 assert.equal(writeReference(file,{check:true}).checked,true);
 assert.equal(readFileSync(file,'utf8'),before);
 assert.throws(()=>writeReference(file),/EEXIST/);
});
});

// Original feature contract: gis-baikonur-2019-exclusions.test.mjs
contractSuite("gis-baikonur-2019-exclusions", () => {
const assert = __source_dep0.default;
const test = __source_dep4.default;
const { BAIKONUR_2019_EXCLUSIONS, BAIKONUR_2019_EFFECTIVE, parseOfficialFractionalDms, baikonur2019Exclusions } = __source_dep6;



test('official 2019 exclusion polygons preserve 4/21/9/7 points',()=>{
  assert.deepEqual(Object.fromEntries(Object.entries(BAIKONUR_2019_EXCLUSIONS)
    .map(([id,rows])=>[id,rows.length])),{'1-1':4,'1-2':21,'1-3':9,'1-4':7});
  const collection=baikonur2019Exclusions();
  assert.equal(collection.properties.openStreetMapDataUsed,false);
  assert.equal(collection.features.length,4);
  assert.equal(collection.properties.unresolvedPlots.length,0);
  assert.equal(collection.properties.correctedOfficialTextDiscrepancy.plot,'1-3');
  assert.equal(collection.properties.correctedOfficialTextDiscrepancy.point,5);
  assert.equal(collection.properties.correctedOfficialTextDiscrepancy.verifiedLatitudeDms,'45 33 06,84');
  assert.equal(collection.properties.independentOfficialCrosschecks.length,2);
  const corrected=collection.features.find(x=>x.properties.plot==='1-3');
  assert(corrected);
  assert.deepEqual(corrected.geometry.coordinates[0][4], [63.299825,45.5519]);
  assert.equal(collection.properties.status,'RESEARCH_ONLY_NOT_FOR_RUNTIME');
});
test('fractional second DMS is parsed but malformed government text is not guessed',()=>{
  assert.equal(parseOfficialFractionalDms('45 44 14,16'),45.737266667);
  assert.equal(parseOfficialFractionalDms('63 01 05,00'),63.018055556);
  for(const invalid of ['45,33 06,84','45 60 00','45 01 61','-45 04 12'])
    assert.throws(()=>parseOfficialFractionalDms(invalid),/Malformed treaty DMS|out of bounds/);
});
test('closed polygons keep per-object provenance and effective dates',()=>{
  const collection=baikonur2019Exclusions();
  assert.equal(BAIKONUR_2019_EFFECTIVE,'2020-01-22');
  assert.equal(collection.properties.effectiveDate,BAIKONUR_2019_EFFECTIVE);
  for(const feature of collection.features){
    const ring=feature.geometry.coordinates[0];
    assert.deepEqual(ring.at(0),ring.at(-1));
    assert.equal(ring.length,BAIKONUR_2019_EXCLUSIONS[feature.properties.plot].length+1);
    assert.match(feature.properties.sourceUrl,/adilet\.zan\.kz/);
    assert.equal(feature.properties.geometryStatus,'research-only-unvalidated-topology');
  }
});
});

// Original feature contract: gis-baikonur-independent-bank-validator.test.mjs
contractSuite("gis-baikonur-independent-bank-validator", () => {
const test = __source_dep4.default;
const assert = __source_dep0.default;
const { validateBaikonurBankCandidate } = __source_dep7;
const { ANCHORS, decimalDegrees } = __source_dep5;
const { verifyBaikonurLeaseExclusionSource, EFFECTIVE_DATE } = __source_dep8;



test('missing candidate is rejected',()=>{
  assert.throws(()=>validateBaikonurBankCandidate(null),/FeatureCollection/);
});
test('unverified coordinate datum is rejected',()=>{
  assert.throws(()=>validateBaikonurBankCandidate({type:'FeatureCollection',features:[],properties:{openStreetMapDataUsed:false}}),/datum/);
});



const reference=(index)=>[decimalDegrees(ANCHORS[index-1][1]),decimalDegrees(ANCHORS[index-1][0])];
test('the six official non-OSM exclusions are closed, disjoint, and not on treaty straight segments',()=>{
  const collection=verifyBaikonurLeaseExclusionSource();
  assert.equal(collection.features.length,6);
  assert.deepEqual(collection.properties.excludedSettlementParcels,['tyuratam','akay']);
  assert.equal(collection.properties.effectiveDate,EFFECTIVE_DATE);
  assert.equal(collection.diagnostics.crossings.length,0);
  assert.equal(collection.diagnostics.intersections.length,0);
  assert(Math.abs(collection.properties.returnedPlotsAreaSqKm-116)<1.5);
  assert.equal(collection.properties.geometryForRuntime,false);
  assert.equal(collection.properties.coordinateDatumVerified,false);
  assert.equal(collection.properties.roadsAndRailwaysExclusionDigitized,false);
});
test('original bank chords are not to be mistaken for the independently surveyed shoreline',()=>{
  const start17=reference(17),end18=reference(18),start31=reference(31),end1=reference(1);
  const length=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
  assert(length(start17,end18)>0.2);
  assert(length(start31,end1)>0.15);
  assert.equal(verifyBaikonurLeaseExclusionSource().properties.rightBankSegmentsIndependentlySurveyed,false);
});

function incompleteCandidate(overrides={}){
  return {
    type:'FeatureCollection',
    features:[],
    properties:{
      openStreetMapDataUsed:false,
      originalDatumVerified:true,
      historicBankInterpretationVerified:true,
      bankSide:'right',
      referenceDate:'2020-01-22',
      amendment2019ExclusionsApplied:true,
      topologyWithKazakhstanVerified:true,
      roadAndRailExclusionsVerified:true,
      riverFlowDirectionVerified:true,
      sourceEvidence:[
        {kind:'official-treaty',url:'https://old.adilet.zan.kz/rus/docs/Z1900000282',sha256:'a'.repeat(64)},
        {kind:'public-domain-satellite',url:'https://science.nasa.gov/',sha256:'b'.repeat(64)},
      ],
      ...overrides,
    },
  };
}
test('pre-2020 lease version cannot falsely apply exclusions that took effect in 2020',()=>{
  const c=incompleteCandidate({referenceDate:'1994-12-10'});
  assert.throws(()=>validateBaikonurBankCandidate(c,{referenceDate:'1994-12-10'}),
    /cannot be used for an earlier legal epoch/);
});
test('missing road or rail corridor qualification rejects purported legal geometry',()=>{
  const c=incompleteCandidate({roadAndRailExclusionsVerified:false});
  assert.throws(()=>validateBaikonurBankCandidate(c),/road and rail/);
});
test('all six independently transcribed exclusion regions must be present',()=>{
  const c=incompleteCandidate();
  assert.throws(()=>validateBaikonurBankCandidate(c,{exclusionPolygons:[]}),
    /All six official lease exclusions/);
});
test('a declaration alone is never accepted without both independent riverbank lines',()=>{
  const c=incompleteCandidate();
  assert.throws(()=>validateBaikonurBankCandidate(c),
    /Both independently surveyed Syr Darya bank reaches/);
});
});

// Original feature contract: gis-baikonur-independent-lease-candidate.test.mjs
contractSuite("gis-baikonur-independent-lease-candidate", () => {
const assert = __source_dep0.default;
const test = __source_dep4.default;
const { ANCHORS, decimalDegrees } = __source_dep5;
const { makeBaikonurIndependentCandidate, polygonSelfCrossings, approximatePlanarAreaKm2 } = __source_dep9;





const anchor=n=>[decimalDegrees(ANCHORS[n-1][1]),decimalDegrees(ANCHORS[n-1][0])];
function syntheticBank(from,to){
 const a=anchor(from),b=anchor(to);
 const coords=Array.from({length:95},(_,i)=>{
   const t=i/94;return[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t+.0002*Math.sin(Math.PI*t)];
 });
 return {type:'Feature',treatyPointPair:[from,to],sourceClass:'independently-derived-USGS-Landsat-C2-L2',
   openStreetMapDataUsed:false,satelliteSceneIds:['SYNTHETIC-2019','SYNTHETIC-2025'],
   waterMaskSha256:['a'.repeat(64),'b'.repeat(64)],
   rightBankDirectionVerified:true,temporalBankConsistencyValidated:true,
   geometry:{type:'LineString',coordinates:coords}};
}
const fixtures=()=>[syntheticBank(17,18),syntheticBank(31,1)];
test('assembles all 31 government anchors and both independently shaped banks, not straight shortcuts',()=>{
 const r=makeBaikonurIndependentCandidate({bankFeatures:fixtures(),sourceRevision:'f'.repeat(40)});
 assert.equal(r.properties.status,'RESEARCH_ONLY_NOT_FOR_RUNTIME');
 assert.equal(r.properties.featureCount,5);
 assert.equal(r.features.length,5);
 const lease=r.features[0];
 assert.equal(lease.geometry.type,'Polygon');
 assert.equal(lease.properties.legalExclusionsApplied,false);
 assert.equal(lease.properties.kazakhstanSharedGeometryUpdated,false);
 assert.equal(lease.properties.openStreetMapDataUsed,false);
 assert.equal(lease.properties.bankReaches.length,2);
 assert(lease.geometry.coordinates[0].length>200);
 assert.deepEqual(lease.geometry.coordinates[0].at(0),anchor(1));
 assert.deepEqual(lease.geometry.coordinates[0].at(-1),anchor(1));
 assert(lease.properties.areaSquareKm>500);
 assert.equal(polygonSelfCrossings(lease.geometry.coordinates[0]),0);
 assert.equal(approximatePlanarAreaKm2(lease.geometry.coordinates[0]).toFixed(3),
   lease.properties.areaSquareKm.toFixed(3));
});
test('rejects single river, false time parity, OSM reuse, nonofficial vertices and detached bank',()=>{
 const draft=()=>fixtures();
 for(const mutate of [
   arr=>arr.pop(),
   arr=>arr[0].openStreetMapDataUsed=true,
   arr=>arr[0].rightBankDirectionVerified=false,
   arr=>arr[0].satelliteSceneIds=['2019-only'],
   arr=>arr[1].temporalBankConsistencyValidated=false,
   arr=>arr[1].waterMaskSha256=['a'.repeat(64),'invalid'],
   arr=>arr[1].geometry.coordinates[0]=[60.1,42.2],
   arr=>arr[0].geometry.coordinates[30]=[65.3,44.2],
 ]){
   const vals=draft();mutate(vals);
   assert.throws(()=>makeBaikonurIndependentCandidate({bankFeatures:vals,
     sourceRevision:'f'.repeat(40)}));
 }
});
test('segment-crossing diagnosis distinguishes crossing from shared endpoints',()=>{
 const v=[[0,0],[4,4],[0,4],[4,0],[0,0]];
 assert.equal(polygonSelfCrossings(v),1);
 const square=[[0,0],[0,4],[4,4],[4,0],[0,0]];
 assert.equal(polygonSelfCrossings(square),0);
});
});
