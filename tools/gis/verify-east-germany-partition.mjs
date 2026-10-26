#!/usr/bin/env node
/** Read-only DDR 1989 archival geometry and canonical Germany partition verification.
 * Metric area, intersection and shared-coast vertices belong to native GEOS/PROJ.
 */
import {spawnSync} from 'node:child_process';
import {readFileSync,existsSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

export const ROOT=fileURLToPath(new URL('../../',import.meta.url));
export const DDR=resolve(ROOT,'assets/data/territorial-entities/source/countries/state-deutsche-demokratische-republik.json');
export const CANONICAL=resolve(ROOT,'assets/data/countries-ne-5.1.1.geojson');
export const LIMITS=Object.freeze({
  minimumAreaKm2:108000,maximumAreaKm2:109000,
  maximumOutsideKm2:0.000001,
  maximumOverlapKm2:0.001,
  maximumPuzzleKm2:0.001,
});
const requireValue=(value,message)=>{if(!value)throw Error(message);};
const sha256=buffer=>createHash('sha256').update(buffer).digest('hex');
export function immutableDDRRecord(data){
  requireValue(data?.entityId==='state:deutsche-demokratische-republik',
    'Unexpected historical entity ID');
  requireValue(data.names?.en==='German Democratic Republic'
    &&data.names?.ko==='독일 민주공화국'
    &&data.names?.de==='Deutsche Demokratische Republik',
    'DDR official names changed');
  requireValue(JSON.stringify([...data.alternateNames].sort())===
    JSON.stringify(['동독','East Germany','DDR','GDR','Ostdeutschland'].sort()),
    'DDR historical alternative names changed');
  requireValue(data.lifetime?.validFrom==='1949-10-07'
    &&data.lifetime?.validTo==='1990-10-02'
    &&data.metadata?.dissolutionDate==='1990-10-03'
    &&data.metadata?.referenceDate==='1989-04-25',
    'DDR historical legal dates changed');
  requireValue(data.instantiation?.mode==='territory-replacement'
    &&data.instantiation?.countryUpdates?.DEU?.name==='독일 연방공화국',
    'DDR source instantiation policy changed');
  requireValue(data.geometryVersions?.length===1
    &&data.geometryVersions[0].geometry?.type==='MultiPolygon',
    'DDR approved 1989 MultiPolygon version missing');
  requireValue(Buffer.byteLength(JSON.stringify(data))<6*1024*1024,
    'DDR source no longer respects original 6 MiB size budget');
  return data.geometryVersions[0].geometry;
}
export function canonicalGermanCountry(world){
  requireValue(world?.type==='FeatureCollection'
    &&Array.isArray(world.features),'Canonical Natural Earth source missing');
  const features=world.features.filter(x=>x.id==='DEU');
  requireValue(features.length===1
    &&['Polygon','MultiPolygon'].includes(features[0].geometry?.type),
    'Exactly one canonical DEU outline is required');
  return features[0].geometry;
}
export function validatePartitionProof(proof){
  requireValue(proof?.schemaVersion===1
    &&proof.passed===true
    &&proof.sharedVerticesFromCanonical===true
    &&Number.isInteger(proof.sharedVertexCount)
    &&proof.sharedVertexCount>0,
    'Native geometry is not an exact reviewed German source partition');
  for(const key of ['areaKm2','outsideKm2','overlapKm2','puzzleDifferenceKm2'])
    requireValue(Number.isFinite(proof[key])&&proof[key]>=0,
      'Unexpected GEOS/PROJ historical metric: '+key);
  requireValue(proof.areaKm2>=LIMITS.minimumAreaKm2
    &&proof.areaKm2<=LIMITS.maximumAreaKm2
    &&proof.outsideKm2<=LIMITS.maximumOutsideKm2
    &&proof.overlapKm2<=LIMITS.maximumOverlapKm2
    &&proof.puzzleDifferenceKm2<=LIMITS.maximumPuzzleKm2,
    'DDR canonical partition violates reviewed GEOS area budgets');
  return proof;
}
export function verifyNativeEastGermanyPartition({
  original=DDR,canonical=CANONICAL,binary=process.env.PANDO_TERRITORIAL_RECIPE_BINARY,
}={}){
  requireValue(binary&&existsSync(binary),'Standalone native historical GEOS/PROJ executable required');
  const originalBytes=readFileSync(original),canonicalBytes=readFileSync(canonical);
  const originalSha=sha256(originalBytes),canonicalSha=sha256(canonicalBytes);
  const candidate=immutableDDRRecord(JSON.parse(originalBytes));
  const reference=canonicalGermanCountry(JSON.parse(canonicalBytes));
  const scope=mkdtempSync(join(tmpdir(),'pando-historical-ddr-partition-'));
  try{
    const input=join(scope,'input.json');
    writeFileSync(input,JSON.stringify({candidate,canonical:reference,limits:LIMITS}),{flag:'wx'});
    const result=spawnSync(binary,['--audit-partition',input],{
      encoding:'utf8',maxBuffer:1024*1024,
    });
    requireValue(!result.error&&result.status===0,
      'Native DDR partition failed: '+(result.stderr||result.error?.message||result.status));
    const metrics=validatePartitionProof(JSON.parse(result.stdout));
    requireValue(sha256(readFileSync(original))===originalSha
      &&sha256(readFileSync(canonical))===canonicalSha,
      'Source geometry changed during GEOS partition verification');
    return {schema:'pando-historical-ddr-geos-canonical-v1',
      historicEntityId:'state:deutsche-demokratische-republik',
      referenceDate:'1989-04-25',
      sourceSha256:originalSha,canonicalSha256:canonicalSha,
      metrics,sourceBytesUnchanged:true,
      historicalBoundaryAccuracyNotSurveyed:true};
  } finally {rmSync(scope,{recursive:true,force:true});}
}
export function main(argv=process.argv.slice(2)){
  if(argv.length!==0)throw Error('Usage: node tools/gis/verify-east-germany-partition.mjs');
  const output=verifyNativeEastGermanyPartition();
  console.log('DDR_1989_NATIVE_PARTITION='+JSON.stringify(output));
  return output;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main();}catch(error){console.error('ddr-native-partition: '+error.message);process.exitCode=1;}
}
