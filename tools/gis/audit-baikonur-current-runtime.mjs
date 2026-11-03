/** Read-only audit of the actual pinned KAB/KAZ historical data index.
 * Metadata truth is a prerequisite, not a substitute for geometry/topology QA.
 */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ANCHORS,UNRESOLVED_BANKS} from './baikonur-official-reference.mjs';
import {EFFECTIVE_DATE,verifyBaikonurLeaseExclusionSource}
  from './verify-baikonur-lease-exclusions.mjs';

const ensure=(ok,msg)=>{if(!ok)throw Error(msg);};
const extract=(text,pattern,label)=>{
  const m=pattern.exec(String(text||''));
  ensure(m&&Number.isFinite(Number(m[1])),label+' is absent from original map metadata');
  return Number(m[1]);
};
export function auditCurrentBaikonurRuntime(index){
  ensure(index?.schemaVersion===2&&Array.isArray(index.entities),
    'Expected complete v2 library index');
  const kab=index.entities.find(x=>x.entityId==='state:KAB');
  const kaz=index.entities.find(x=>x.entityId==='state:KAZ');
  ensure(kab&&kaz&&kab.parentEntityId==='state:KAZ',
    'KAB or Kazakhstan paired source missing');
  const kabEdition=kab.geometryVersions?.at(-1),kazEdits=kaz.geometryVersions||[];
  ensure(kabEdition&&kazEdits.length>=2,'Unverifiable current country history');
  const labels=[kabEdition.sourceId,kab.sourceInfo?.license,
    ...kazEdits.map(x=>x.sourceId),kaz.sourceInfo?.license].join(' ');
  ensure(/baikonur-treaty-osm-remade/i.test(labels)&&/OSM-derived/.test(labels),
    'Source annotation no longer matches previously audited OSM geometry');
  const modern=kabEdition.modernBoundarySupplement;
  ensure(modern?.historicalAccuracyVerified===false
    &&modern?.effectiveDateEstablished===false
    &&modern?.boundaryCertainty==='low','Historical legal accuracy is not proven');
  const description=modern.displayExclusions;
  const displayOverexcluded=extract(description,
    /display exclusion area increases ([0-9.]+) km2/,'Overlarge displayed exclusions');
  const missingSmallHoles=extract(description,
    /display holes omitted \(([0-9.]+) km2\)/,'Omitted settlement holes');
  const official=verifyBaikonurLeaseExclusionSource();
  const officialFour=official.properties.returnedPlotsAreaSqKm;
  const currentAsOf2020=kabEdition.validFrom<=EFFECTIVE_DATE
    &&(kabEdition.validTo===null||kabEdition.validTo>=EFFECTIVE_DATE);
  ensure(currentAsOf2020,'Current KAB version does not cover the 2020 legal change date');
  const datedCutover=kab.geometryVersions.some(x=>x.validFrom===EFFECTIVE_DATE);
  const kazOsmVersions=kazEdits.filter(x=>/OSM-derived/.test(
    String(x.modernBoundarySupplement?.pairing||'')
      +' '+String(x.modernBoundarySupplement?.sourceId||'')));
  return {
    schema:'pando-baikonur-current-runtime-provenance-audit-v1',
    observedMetadata:{
      kabVersionId:kabEdition.versionId,
      kabEffectiveFrom:kabEdition.validFrom,
      kazPairedOsmVersions:kazOsmVersions.length,
      isSingleKABVersionAcross2020:!datedCutover,
      originalApproximateDisplayToleranceMeters:modern.simplificationToleranceMeters,
      displayExclusionAreaOverageSqKm:displayOverexcluded,
      omittedSettlementHolesSqKm:missingSmallHoles,
      officialFourReturnParcelsAreaSqKm:officialFour,
      officialFourReturnParcelsEffectiveDate:EFFECTIVE_DATE,
      officialTreatyAnchors:ANCHORS.length,
      unresolvedRiverbankPointPairs:UNRESOLVED_BANKS,
    },
    readyForNonOsmMapReplacement:false,
    retainOsmCredit:true,
    blockers:[
      'Current KAB and KAZ polygon coordinates still derived from OSM',
      'Riverbank reaches 17-18 and 31-1 are not independently surveyed',
      'Both country geometries require a shared-exact-edge replacement',
      '2020-01-22 legal exclusions are not applied with verified dated topology',
      'Road and railway exclusion corridors are not independently reconstructed',
      'Geographic datum conversion and survey interpretation remain unverified',
    ],
    changesApplied:false,
  };
}
export function main(argv=process.argv.slice(2)){
  ensure(argv.length===2&&argv[0]==='--index',
    'Usage: --index ASSETS_DATA_TERRITORIAL_ENTITIES_GENERATED_V2_INDEX');
  return auditCurrentBaikonurRuntime(JSON.parse(readFileSync(resolve(argv[1]),'utf8')));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log('BAIKONUR_CURRENT_RUNTIME_AUDIT='+JSON.stringify(main(),null,2));}
  catch(error){console.error(error.stack);process.exitCode=1;}
}
