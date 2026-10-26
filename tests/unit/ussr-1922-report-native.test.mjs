import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {APPROVED_DATA_PIN,PROOFS} from '../../tools/gis/audit-ussr-1922-approved-followups.mjs';
import {ARCHIVED,ARCHIVE_BASE,parseReceipt,verifyArchivedReports,
 buildCompactReport} from '../../tools/gis/report-ussr-1922-caspian.mjs';
import {FOUNDER_IDS,USSR_ZIP_SHA} from '../../tools/gis/replay-ussr-1922-countries.mjs';
import {ARCHIVE_SHA} from '../../tools/gis/verify-approved-caspian-network.mjs';
const receipt=()=>{
  const entities=FOUNDER_IDS.map((id,i)=>({entityId:id,
    geosTopologicalEquals:i===4,suitableForAutomaticReapplication:i===4,
    areaDifferenceSquareDegrees:i===4?0:i*0.2+0.1,
    boundaryHausdorffDegrees:i===4?0:0.15}));
  return {
    countries:{schema:'pando-ussr-1922-sources-verified-audit-v1',
      zipSha256:USSR_ZIP_SHA,evidenceComputed:true,libraryDataMutated:false,
      automaticSourceReplacementApproved:false,founders:5,entities,
      nonEquivalentFounders:4,status:'source-geometry-difference-blocked'},
    network:{schema:'pando-c1-approved-1922-caspian-network-v1',
      archiveSha256:ARCHIVE_SHA,featureCount:266,nonEndpointCrossings:0,
      topologyVerified:true,sourceBytesUnchanged:true,
      historicalAreaOrSovereigntyApproved:false},
    display:{schema:'pando-approved-caspian-display-native-candidate-v1',
      original:{archiveSha256:ARCHIVE_SHA,networkFeatures:266,waterHoles:68},
      metrics:{holesBefore:68,holesAfter:68,nonEndpointIntersections:0,
        verticesBefore:21771,verticesAfter:7063},
      status:'review-only-not-approved-for-runtime',sourceZipUnchanged:true},
    physical:{schema:'pando-1922-caspian-physical-replay-v1',
      referenceDate:'1922-12-30',validFrom:'1922-12-30',validTo:'1925-05-12',
      modernPhysicalLandUnchanged:true,publishedHistoricalAssetsUnchanged:true,
      runtimePromoted:false,publishedGeometryDifferenceSquareDegrees:0,
      metrics:{unchangedFarPolygonCount:4250,unchangedFarGeometryPreserved:true,
        fullLandValid:false,modernFullLandValid:false,
        preexistingGlobalInvalidityPreserved:true,
        patchedLandValid:true,localLandValid:true,historicalWaterHoles:68,
        modernWaterAreaKm2:396307,historicalWaterAreaKm2:430881,
        outsideRegionDifferenceSquareDegrees:0,
        publishedSymmetricDifferenceSquareDegrees:0}},
  };
};
const archived=Object.entries(ARCHIVED).map(([file,r])=>({
  path:ARCHIVE_BASE+file,...r,
}));
test('one native receipt is accepted, truncated or duplicated receipts rejected',()=>{
  assert.deepEqual(parseReceipt('CHECK={"passed":true}\n','CHECK'),{passed:true});
  assert.throws(()=>parseReceipt('CHECK={}\nCHECK={}','CHECK'),/exactly one/);
  assert.throws(()=>parseReceipt('CHECK=broken','CHECK'),SyntaxError);
});
test('published source differences remain explicitly blocked in a compact report',()=>{
  const r=buildCompactReport(receipt(),archived);
  assert.equal(r.json.countries.topologicalDiscrepancies.length,4);
  assert.equal(r.json.allHistoricalBorderReplacementsApproved,false);
  assert.equal(r.json.runtimePromoted,false);
  assert.match(r.markdown,/4개가 승인 원본과 위상적으로 불일치/);
  assert.match(r.markdown,/caspian-comparison-10m.png/);
  assert.match(r.markdown,/기존 GEOS 유효성 결함/);
});
test('a fully verified approved 1922 descendant supersedes, but never deletes, the original ZIP comparison',()=>{
  const c=receipt();
  c.corrections={
    schema:'pando-ussr-1922-approved-descendant-audit-v1',
    status:'approved-followups-verified',pinnedDataRevision:
      APPROVED_DATA_PIN,
    canonicalPublishedVersionVerified:true,originalZipWasNotOverwritten:true,
    sourceObjectsMutated:false,runtimePromotionPerformed:false,
    correctedFounders:4,unchangedFounders:1,
    verifiedReportReceipts:Object.values(PROOFS).map(r=>({...r})),
    parentRepublicPartition:{passed:true,founderCount:5},
    correctionSequence:['2026-10-23-reviewed-ZIP','2026-10-25-dniester','2026-10-25-europe'],
    entities:FOUNDER_IDS.map((id,i)=>({
      entityId:id,approvedCorrection:i!==4,sourceGeometryVerified:true,
      validFrom:'1922-12-30',validTo:'1925-05-12',
    })),
  };
  const report=buildCompactReport(c,archived);
  assert.equal(report.json.countries.unresolvedCanonicalGeometryIssues,0);
  assert.equal(report.json.countries.topologicalDiscrepancies.length,4);
  assert.equal(report.json.countries.status,'approved-followups-verified');
  assert.match(report.markdown,/미해결 위상 오류는 0건/);
  for(const mutate of [
    x=>x.corrections.verifiedReportReceipts.pop(),
    x=>{x.corrections.verifiedReportReceipts[0].sha256='0'.repeat(64);},
    x=>{x.corrections.verifiedReportReceipts[0].bytes+=1;},
    x=>{x.corrections.verifiedReportReceipts[0]=structuredClone(x.corrections.verifiedReportReceipts[1]);},
  ]){const altered=structuredClone(c);mutate(altered);assert.throws(()=>buildCompactReport(altered,archived),/five fully verified/);}
  const forged=structuredClone(c);
  forged.corrections.parentRepublicPartition.passed=false;
  assert.throws(()=>buildCompactReport(forged,archived),/five fully verified/);
});
test('contradictory or waived native source evidence cannot generate reports',()=>{
  const c=receipt();c.countries.nonEquivalentFounders=0;
  assert.throws(()=>buildCompactReport(c,archived),/inconsistent/);
  const d=receipt();d.network.featureCount=265;
  assert.throws(()=>buildCompactReport(d,archived),/266-reach/);
  const e=receipt();e.physical.metrics.outsideRegionDifferenceSquareDegrees=0.01;
  assert.throws(()=>buildCompactReport(e,archived),/differs/);
  const f=receipt();f.physical.runtimePromoted=true;
  assert.throws(()=>buildCompactReport(f,archived),/publication semantics/);
});
test('archived physical maps and report content must match pinned receipts, not names alone',async()=>{
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from('image')]);
  const txt=Buffer.from('record');
  const blobs={'map.png':png,'README.md':txt};
  const sha=data=>createHash('sha256').update(data).digest('hex');
  const expected=Object.fromEntries(Object.entries(blobs).map(([f,b])=>[f,{sha256:sha(b),bytes:b.length}]));
  const index={files:Object.fromEntries(Object.entries(expected).map(([f,r])=>[
    ARCHIVE_BASE+f,{...r,encoding:'identity',stored:ARCHIVE_BASE+f}]))};
  const revision='a'.repeat(40);
  const found=await verifyArchivedReports(index,revision,
    async p=>blobs[p.split('/').at(-1)],expected);
  assert.equal(found.length,2);
  const altered={...blobs,'map.png':Buffer.from('not a png')};
  await assert.rejects(verifyArchivedReports(index,revision,
    async p=>altered[p.split('/').at(-1)],expected),/SHA-256/);
  index.files[ARCHIVE_BASE+'map.png'].stored='archive/blobs/wrong';
  await assert.rejects(verifyArchivedReports(index,revision,async p=>blobs[p],
    expected),/receipt differs/);
});
