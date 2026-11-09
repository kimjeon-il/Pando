import assert from 'node:assert/strict';
import test from 'node:test';
import {SOURCE_EVIDENCE_PROFILES,summarizeSourceEvidence,runSourceEvidenceAudit}
  from '../../../tools/checks/audit-source-evidence.mjs';

test('source evidence profiles refuse publication, credentials and forged source approval',async()=>{
  assert.equal(SOURCE_EVIDENCE_PROFILES.length,3);
  const historic={appliedPublishedGeometry:false,legalHistoricRightBankVerified:false,
    originalDatumVerified:false,records:[{pair:['A','B'],year:1994,status:'available',
      scenesScanned:1,candidates:[{sceneId:'fixture',verifiedPixels:false,
        siteCloudCoverNotEstablished:true,greenBandUrl:'https://example.invalid/asset'}]}]};
  const report=await runSourceEvidenceAudit('historic-scenes',{readHistoric:async()=>historic});
  assert.deepEqual(report.observations[0].selectedSceneIds,['fixture']);
  assert.equal(report.geometryPublished,false);
  assert.equal(JSON.stringify(report).includes('greenBandUrl'),false);
  assert.throws(()=>summarizeSourceEvidence('historic-scenes',{...historic,
    legalHistoricRightBankVerified:true}),/Unapproved/);
  assert.throws(()=>summarizeSourceEvidence('historic-scenes',{...historic,
    records:[{...historic.records[0],candidates:[{verifiedPixels:true,
      siteCloudCoverNotEstablished:true}]}]}),/Unverified/);
  assert.throws(()=>summarizeSourceEvidence('historic-scenes',{...historic,
    other:'https://example.invalid/a?sig=secret'}),/Signed/);
});
test('source access audit retains only sanitized status, never signed URLs or pixels',()=>{
  const evidence={tokenOrSignedUrlSaved:false,imagePixelsDownloaded:false,
    geometryPublished:false,rightBankReconstructed:false,
    sections:[{treatyPointPair:'A-B',result:'queried',candidateSceneCount:2,
      signedPixelReadTestStatus:'cog-readable-head',signedUrl:null}]};
  const result=summarizeSourceEvidence('signed-source-access',evidence);
  assert.equal(result.observations[0].access,'cog-readable-head');
  assert.equal(JSON.stringify(result).includes('signedUrl'),false);
  assert.throws(()=>summarizeSourceEvidence('signed-source-access',
    {...evidence,imagePixelsDownloaded:true}),/Unsafe/);
});
test('official source reference remains a review, never approved runtime geometry',()=>{
  const evidence={type:'FeatureCollection',features:[{type:'Feature'}],
    properties:{geometryForRuntime:false,coordinateDatumVerified:false,
      rightBankSegmentsIndependentlySurveyed:false,effectiveDate:'2020-01-22',
      returnedPlotsAreaSqKm:116},
    diagnostics:{crossings:[],intersections:[]}};
  const result=summarizeSourceEvidence('lease-exclusions',evidence);
  assert.equal(result.observations.referenceFeatures,1);
  assert.equal(result.geometryPublished,false);
  assert.throws(()=>summarizeSourceEvidence('lease-exclusions',{...evidence,
    diagnostics:{crossings:[1],intersections:[]}}),/intersect/);
});
