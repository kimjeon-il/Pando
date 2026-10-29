import assert from 'node:assert/strict';
import test from 'node:test';
import {verifyStationEvidence,verifyNaturalEarthEvidence,verifyYarraEvidence} from '../../tools/gis/hydro-independent-name-policy.mjs';

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
