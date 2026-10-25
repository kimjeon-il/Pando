import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {sharedCalculationCore} from "../shared/frontend/js/modules/temporal.js";
import {normalizeTerritorialLibraryEntity} from "../apps/editor/frontend/js/modules/territorial-library.js";
import {entityFileName,territorialSourceRoot} from './territorial-entity-sources.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function applyLsibSupplement(candidate,{root=territorialSourceRoot,check=false}={}){
  if(candidate.schemaVersion!==1 || candidate.sourceId!=='dos-lsib-11.4' || !candidate.changes?.length)throw new Error('Invalid LSIB candidate');
  const selections=new Map(JSON.parse(fs.readFileSync(path.join(root,'views/world.json'),'utf8')).selections.map(row=>[row.entityId,row.geometryVersionId]));
  const writes=[];
  for(const change of candidate.changes){
    if(typeof change.sourceId!=='string'||!change.sourceId.length||!Array.isArray(change.sourceAttributions))throw new Error('Candidate source provenance is required');
    const file=path.join(root,'countries',entityFileName(change.entityId));
    const before=fs.readFileSync(file);
    if(!/^[a-f0-9]{64}$/.test(change.inputFileSha256)||sha(before)!==change.inputFileSha256)throw new Error(`LSIB source changed after candidate calculation: ${change.entityId}`);
    const entity=JSON.parse(before);
    const version=entity.geometryVersions.find(row=>row.versionId===change.geometryVersionId);
    if(!version || version.versionId!==selections.get(entity.entityId)||version.validTo!==null)throw new Error(`Historical source must not be overwritten: ${change.entityId}`);
    const geometry=sharedCalculationCore.normalizePolygonGeometry(change.geometry);
    if(!geometry || !geometry.coordinates.length)throw new Error(`Failed C++ geometry normalization: ${change.entityId}`);
    version.geometry=geometry;
    version.sourceId=change.sourceId;
    version.modernBoundarySupplement=change.supplement;
    entity.sourceInfo={...entity.sourceInfo,sourceId:version.sourceId,
      title:change.supplement.coastline==='reviewed-ign-replacement'
        ?'Reviewed land boundaries and IGN high-water coastline with existing attribution'
        :'Existing coastlines and attribution with reviewed land boundary sections',
      sourceAttributions:[...new Map([...(entity.sourceInfo.sourceAttributions??[]),...change.sourceAttributions].map(row=>[row.sourceId,row])).values()],
      geometrySha256:sha(JSON.stringify(geometry))};
    normalizeTerritorialLibraryEntity(entity);
    writes.push({file,bytes:`${JSON.stringify(entity,null,2)}\n`});
  }
  // Validate the complete multi-country candidate before writing any counterpart.
  if(!check)for(const {file,bytes} of writes)fs.writeFileSync(file,bytes);
  return {countries:writes.length,applied:!check};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const at=process.argv.indexOf('--candidate');
  if(at<0)throw new Error('--candidate is required');
  const candidate=JSON.parse(fs.readFileSync(process.argv[at+1],'utf8'));
  console.log(JSON.stringify(applyLsibSupplement(candidate,{check:process.argv.includes('--check')})));
}
