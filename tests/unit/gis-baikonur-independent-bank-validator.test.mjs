import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBaikonurBankCandidate} from '../../tools/gis/validate-baikonur-independent-banks.mjs';
test('missing candidate is rejected',()=>{
  assert.throws(()=>validateBaikonurBankCandidate(null),/FeatureCollection/);
});
test('unverified coordinate datum is rejected',()=>{
  assert.throws(()=>validateBaikonurBankCandidate({type:'FeatureCollection',features:[],properties:{openStreetMapDataUsed:false}}),/datum/);
});

import {ANCHORS,decimalDegrees} from '../../tools/gis/baikonur-official-reference.mjs';
import {verifyBaikonurLeaseExclusionSource,EFFECTIVE_DATE}
  from '../../tools/gis/verify-baikonur-lease-exclusions.mjs';
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
