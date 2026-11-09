// Read-only source-evidence audit. Project-specific probes are input adapters;
// the publication and evidence contracts are shared by all source profiles.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {isAbsolute,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {auditBaikonurHistoricSceneAvailability} from '../gis/probe-baikonur-1994-landsat.mjs';
import {probePlanetaryBaikonur} from '../gis/probe-baikonur-planetary-landsat.mjs';
import {verifyBaikonurLeaseExclusionSource} from '../gis/verify-baikonur-lease-exclusions.mjs';

export const SOURCE_EVIDENCE_PROFILES = Object.freeze([
  'historic-scenes','signed-source-access','lease-exclusions',
]);
const ensure = (condition, message) => assert.ok(condition, message);
const text = value => typeof value === 'string' ? value : '';
const bounded = value => text(value).slice(0, 256);

export function summarizeSourceEvidence(profile, evidence) {
  ensure(SOURCE_EVIDENCE_PROFILES.includes(profile), 'Unknown source-evidence profile');
  ensure(evidence && typeof evidence === 'object' && !Array.isArray(evidence),
    'Source evidence must be a record');
  const raw = JSON.stringify(evidence);
  // Evidence is never permitted to carry signed URLs or service tokens.
  ensure(!/[?&](?:sig|se|sv|sp|token|sas|subscription-key)=/i.test(raw),
    'Signed source URL would leak into a permanent audit');
  if (profile === 'historic-scenes') {
    ensure(evidence.appliedPublishedGeometry === false &&
      evidence.legalHistoricRightBankVerified === false &&
      evidence.originalDatumVerified === false, 'Unapproved historic geometry claim');
    ensure(Array.isArray(evidence.records) && evidence.records.length,
      'No historic source observations');
    return {
      profile,readOnly:true,geometryPublished:false,
      observations:evidence.records.map(row => {
        ensure(Array.isArray(row.pair) && row.pair.length === 2 &&
          Number.isSafeInteger(row.year) && row.year > 1800 &&
          Array.isArray(row.candidates), 'Invalid historic source observation');
        ensure(row.candidates.every(item=>item.verifiedPixels===false &&
          item.siteCloudCoverNotEstablished===true), 'Unverified satellite pixels claimed');
        return {pair:row.pair.map(bounded),year:row.year,
          status:bounded(row.status),scenesScanned:row.scenesScanned??0,
          selectedSceneIds:row.candidates.map(item=>bounded(item.sceneId))};
      }),
    };
  }
  if (profile === 'signed-source-access') {
    ensure(evidence.tokenOrSignedUrlSaved === false &&
      evidence.imagePixelsDownloaded === false &&
      evidence.geometryPublished === false &&
      evidence.rightBankReconstructed === false, 'Unsafe signed-source audit claim');
    ensure(Array.isArray(evidence.sections) && evidence.sections.length,
      'No independent access observations');
    return {
      profile,readOnly:true,geometryPublished:false,
      observations:evidence.sections.map(row => ({
        pair:bounded(row.treatyPointPair),
        result:bounded(row.result),
        candidates:row.candidateSceneCount??0,
        access:bounded(row.signedPixelReadTestStatus),
        failureClass:bounded(row.failureClass)||null,
      })),
    };
  }
  ensure(evidence.type === 'FeatureCollection' &&
    Array.isArray(evidence.features) && evidence.features.length,
    'No verified reference geometry');
  ensure(evidence.properties?.geometryForRuntime === false &&
    evidence.properties?.coordinateDatumVerified === false &&
    evidence.properties?.rightBankSegmentsIndependentlySurveyed === false,
    'Legal review was promoted to an unverified runtime boundary');
  ensure(Array.isArray(evidence.diagnostics?.crossings) &&
    evidence.diagnostics.crossings.length === 0 &&
    Array.isArray(evidence.diagnostics?.intersections) &&
    evidence.diagnostics.intersections.length === 0,
    'Official reference boundaries intersect');
  return {
    profile,readOnly:true,geometryPublished:false,
    observations:{referenceFeatures:evidence.features.length,
      effectiveDate:bounded(evidence.properties.effectiveDate),
      approximateReturnedAreaKm2:evidence.properties.returnedPlotsAreaSqKm},
  };
}
export async function runSourceEvidenceAudit(profile, {readHistoric=auditBaikonurHistoricSceneAvailability,
    readAccess=probePlanetaryBaikonur, readExclusions=verifyBaikonurLeaseExclusionSource}={}) {
  ensure(SOURCE_EVIDENCE_PROFILES.includes(profile), 'Unknown source-evidence profile');
  const evidence=profile==='historic-scenes'?await readHistoric():
    profile==='signed-source-access'?await readAccess():await readExclusions();
  return summarizeSourceEvidence(profile,evidence);
}
async function main(argv) {
  ensure(argv.length===4 && argv[0]==='--scope' && argv[2]==='--output',
    'Usage: --scope PROFILE --output NEW_EVIDENCE_JSON');
  const output=resolve(argv[3]),repo=resolve(fileURLToPath(new URL('../../',import.meta.url)));
  const relativePath=relative(repo,output);
  ensure(isAbsolute(argv[3]) && (relativePath==='..'||relativePath.startsWith('..'+sep)),
    'Evidence output must be an absolute path outside the source checkout');
  const result=await runSourceEvidenceAudit(argv[1]);
  writeFileSync(output,JSON.stringify({schema:'pando-source-evidence-audit-v1',...result},null,2)+'\n',{flag:'wx'});
  console.log('SOURCE_EVIDENCE_AUDIT='+JSON.stringify({
    profile:result.profile,readOnly:result.readOnly,geometryPublished:result.geometryPublished,
    observationCount:Array.isArray(result.observations)?result.observations.length:
      result.observations.referenceFeatures}));
}
if (process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
