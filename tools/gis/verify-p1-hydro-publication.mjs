#!/usr/bin/env node
// P1: audit the entire *published* Hydro package, not a reconstruction of raw GIS inputs.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,stat,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {gunzipSync} from 'node:zlib';
import {loadCompleteHydroFeatures} from './hydro-selected-data.mjs';
import {hydroGeometryCoordinates,verifyHydroKoreaCoverage,verifyHydroManifestPolicy,verifyHydroRiverGroups} from './hydro-pack-decoder.mjs';
import {HYDRO_DATA_VERSION} from '../../shared/frontend/js/modules/physical-layer-service.js';

const codes=['af','ar','as','au','eu','gr','na','sa','si'];
const hex=/^[0-9a-f]{64}$/;
const sha=data=>createHash('sha256').update(data).digest('hex');
async function hashFile(path){
  const first=await stat(path),digest=createHash('sha256');let bytes=0;
  assert(first.isFile(),'Hydro container must be a regular file');
  for await(const chunk of createReadStream(path)){bytes+=chunk.length;digest.update(chunk);}
  const after=await stat(path);
  assert.equal(bytes,first.size,'Hydro container size changed');
  assert.equal(after.size,first.size,'Hydro container size changed');
  assert.equal(after.mtimeMs,first.mtimeMs,'Hydro container timestamp changed');
  return {bytes,sha256:digest.digest('hex')};
}
function countLakeGeometry(rows){
  let vertices=0;
  for(const {metadata,geometry} of rows){
    assert.equal(metadata.category,'lake');
    assert.equal(metadata.layerId,'lakes_natural_earth');
    assert.equal(metadata.source,'Natural Earth 5.0.0 1:10m');
    assert.equal(typeof metadata.awId,'string');
    assert(metadata.awId.length>0&&!metadata.awId.startsWith('hydro-lake:'));
    const polygons=geometry?.type==='Polygon'?[geometry.coordinates]:geometry?.type==='MultiPolygon'?geometry.coordinates:null;
    assert(Array.isArray(polygons)&&polygons.length>0,'Hydro lake must have polygon geometry');
    for(const polygon of polygons){
      assert(Array.isArray(polygon)&&polygon.length>0,'Hydro lake rings absent');
      for(const ring of polygon){
        assert(Array.isArray(ring)&&ring.length>=4,'Hydro lake ring invalid');
        assert(ring.every(point=>Array.isArray(point)&&point.length===2&&point.every(Number.isFinite)),'Hydro lake coordinates invalid');
        vertices+=ring.length;
      }
    }
  }
  assert.equal(rows.length,1355,'Published lake count changed');
  assert.equal(vertices,162852,'Published lake coordinate count changed');
  return {features:rows.length,coordinates:vertices};
}
export async function verifyPublishedHydro({directory}={}){
  assert.equal(typeof directory,'string','Explicit Hydro publication directory required');
  const root=resolve(directory),dataset=await loadCompleteHydroFeatures({directory:root,acknowledgeWholeCatalog:true});
  const {manifest,manifestBytes,features,core,packCount,logicalCount}=dataset;
  assert.equal(manifest.version,HYDRO_DATA_VERSION,'Viewer and publication Hydro versions differ');
  const delivery=verifyHydroManifestPolicy({manifest,version:HYDRO_DATA_VERSION,manifestBytes,packCount,logicalCount});
  assert.equal(manifest.sources?.hydroRivers?.length,9,'Nine source-region receipts required');
  assert.deepEqual(manifest.sources.hydroRivers.map(row=>row.datasetCode),codes);
  for(const row of manifest.sources.hydroRivers){
    assert.equal(row.files.length,4,'Complete shapefile receipt required for '+row.datasetCode);
    for(const member of row.files)assert(hex.test(member.sha256||''),'Invalid source member SHA');
  }
  const container=await hashFile(resolve(root,manifest.container.url));
  assert.equal(container.sha256,manifest.container.sha256,'Hydro container SHA differs');
  assert.equal(container.bytes,manifest.container.bytes,'Hydro container byte count differs');
  assert.equal(sha(core),manifest.metadata.core.sha256,'Compressed Hydro core SHA differs');
  const raw=gunzipSync(core,{maxOutputLength:64*1024*1024}).toString('utf8'),coreJson=JSON.parse(raw);
  assert.equal(JSON.stringify(coreJson),raw,'Hydro core JSON not canonical');
  assert.equal(coreJson.version,5);
  assert.equal(coreJson.features.length,manifest.metadata.featureCount);
  assert.equal(features.length,manifest.stats.featureCount);
  assert.equal(new Set(features.map(row=>row.metadata.fid)).size,features.length,'Repeated Hydro FID');
  assert.equal(new Set(features.map(row=>row.metadata.logicalFid)).size,manifest.stats.logicalFeatureCount,'Logical FID count differs');
  const vertices=features.reduce((sum,row)=>sum+hydroGeometryCoordinates(row.geometry),0);
  assert.equal(vertices,manifest.stats.coordinateCount,'Whole Hydro coordinate count differs');
  const rivers=features.filter(row=>row.metadata.category==='river');
  const lakes=features.filter(row=>row.metadata.category==='lake');
  assert.equal(rivers.length+lakes.length,features.length,'Unknown Hydro feature category');
  const riverAudit=verifyHydroRiverGroups(rivers);
  const koreanCoverage=verifyHydroKoreaCoverage(features);
  const lakeAudit=countLakeGeometry(lakes);
  const borderTagged=features.filter(row=>row.metadata.category==='river'&&(row.metadata.flags&1)!==0);
  assert(borderTagged.length>0,'No aligned river features');
  for(const row of borderTagged){
    assert.equal(row.metadata.flags,1,'Unexpected border flag');
    assert.match(row.metadata.source,/Natural Earth border [A-Z]{3}\/[A-Z]{3}$/,'Invalid border source attribution');
  }
  return {
    schema:'pando-p1-hydro-real-publication-v1',datasetVersion:manifest.version,sourceCategory:'published-real-data',
    container,manifestSha256:sha(await readFile(resolve(root,'manifest.json'))),
    manifestBytes,features:features.length,logicalFeatures:logicalCount,packs:packCount,coordinates:vertices,
    sourceRegions:codes,sourceMemberReceipts:36,riverFeatures:rivers.length,riverSystems:riverAudit.systems,
    lakeGeometry:lakeAudit,korea:koreanCoverage,borderTaggedFeatures:borderTagged.length,
    delivery,allPublishedResourceRangesAndHashesChecked:true,allPublishedGeometryDecoded:true,
    rawHydroRiversMembersCompared:false,originalNaturalEarthLakesCompared:false,
    originalCountryBorderGeometriesCompared:false,wholeOriginalGeneratorReproduced:false,
  };
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const {values,positionals}=parseArgs({allowPositionals:true,options:{directory:{type:'string'},output:{type:'string'}}});
    assert(!positionals.length&&values.directory&&values.output,'Usage: --directory DIR --output NEW-REPORT.json');
    const result=await verifyPublishedHydro({directory:values.directory});
    await writeFile(resolve(values.output),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
    console.log('P1_HYDRO_PUBLISHED='+JSON.stringify(result));
  }catch(error){console.error('P1 Hydro real publication validation failed: '+error.stack);process.exitCode=1;}
}
