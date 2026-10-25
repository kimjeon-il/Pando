import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readTerritorialSources,updateTerritorialSource} from '../territorial-entity-sources.mjs';
import {normalizeTerritorialLibraryEntity} from "../../apps/editor/frontend/js/modules/territorial-library.js";

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const previousDay=day=>{const value=new Date(day+'T00:00:00Z');value.setUTCDate(value.getUTCDate()-1);return value.toISOString().slice(0,10);};
const appendNote=(version,note)=>{if(!(version.notes||'').includes(note))version.notes=((version.notes||'')+' '+note).trim();};
function removePrecision(value){
 if(Array.isArray(value))return value.map(removePrecision);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value)
  .filter(([key])=>key!=='datePrecision'&&key!=='geometryDatePrecision').map(([key,child])=>[key,removePrecision(child)]));
 return value;
}

export function planSovietTransitions(input,transitions){
 if(transitions.schemaVersion!==1||transitions.rows.length!==15)throw new Error('Fifteen approved transitions are required');
 const entities=new Map(input.map(entity=>[entity.entityId,removePrecision(structuredClone(entity))]));
 const original=new Map(input.map(entity=>[entity.entityId,entity]));
 const sourceShapes=new Set(input.flatMap(entity=>entity.geometryVersions.map(version=>hash(version.geometry))));
 for(const row of transitions.rows){
  const republic=entities.get(row.republicId),independent=entities.get(row.independentId);
  if(!republic||!independent||republic.parentEntityId!=='state:soviet-union'||independent.parentEntityId)throw new Error('Unexpected transition identity: '+row.independentId);
  if(independent.lifetime.validFrom&&independent.lifetime.validFrom!==row.day)throw new Error('An existing independent period must be reviewed: '+row.independentId);
  const end=previousDay(row.day);
  republic.lifetime.validTo=end;independent.lifetime.validFrom=row.day;
  const late=republic.geometryVersions.find(version=>version.versionId.endsWith(':1991-r1'));
  if(!late)throw new Error('Missing existing late-Soviet coordinates: '+row.republicId);
  // Reuse the existing approximation for the1990 transition reference year,
  // not for the entire SSR lifetime. Year precision is in the endpoint itself.
  if(row.independentId==='state:LTU'){
   late.validFrom='1990';
   appendNote(late,'Existing1991 approximation reused for the1990 transition reference year, ending1990-03-10. The year endpoint describes admitted approximate coverage, not a border-creation event or a reconstruction of the entire SSR era.');
  }
  late.validTo=end;
  for(const recipe of republic.sourceInfo.geometryRecipes||[])if(recipe.id.endsWith(':1991-r1')){
   recipe.validFrom=late.validFrom;recipe.validTo=end;recipe.notes=late.notes;
  }
  const meaning={date:row.day,criterion:row.criterion,sources:row.sources,
   scope:'Existing Soviet-republic and post-transition catalog phases; not a claim that earlier national statehood did not exist.',
   republicEndRule:'The day before the user-approved transition; distinct from abolition of the Soviet-era name.'};
  republic.sourceInfo.periodTransition=meaning;independent.sourceInfo.periodTransition=meaning;
  const selected=independent.geometryVersions.find(version=>version.versionId===independent.metadata.representativeGeometryVersionId);
  if(!selected)throw new Error('Missing representative coordinates: '+row.independentId);
  if(row.independentId==='state:RUS'||row.independentId==='state:KAZ'){
   const event=row.independentId==='state:RUS'?transitions.crimea:transitions.baikonur;
   selected.validFrom=event.day;
   if(selected.certainty==='high')selected.certainty='medium';
   appendNote(selected,'Existing coordinates reused from this macro display transition; later survey-level boundary detail is not independently established here.');
   selected.historicalProvenance={...selected.historicalProvenance,periodSources:event.sources,
    scope:row.independentId==='state:RUS'?'Existing Crimea display convention; no determination of internationally recognised sovereignty.':'Lease display subdivision; Kazakhstan sovereignty is unchanged. Existing modern lease outline remains approximate for the treaty era.'};
   const versionId=row.independentId+':post-soviet-existing-coordinates';
   const before={...structuredClone(late),versionId,validFrom:row.day,validTo:previousDay(event.day),
    notes:'Existing late-Soviet coordinates reused for the post-transition macro outline; no coordinate reconstruction performed.',
    historicalProvenance:{sourceEntityId:row.republicId,sourceGeometryVersionId:late.versionId,periodSources:event.sources}};
   const existing=independent.geometryVersions.find(version=>version.versionId===versionId);
   if(existing){if(hash(existing.geometry)!==hash(before.geometry))throw new Error('Existing post-transition coordinates differ');Object.assign(existing,before);}
   else independent.geometryVersions.unshift(before);
  }else if(!selected.validFrom){
   selected.validFrom=row.day;
   if(selected.certainty==='high')selected.certainty='medium';
   selected.historicalProvenance={...selected.historicalProvenance,sourceEntityId:row.republicId,
    sourceGeometryVersionId:late.versionId,evidenceStatus:'provisional',
    scope:'Existing Natural Earth-derived macro outline reused after the approved political transition; not an independent survey of every historical border or coast.'};
  }
 }
 const lease=entities.get('state:KAB');
 for(const version of lease.geometryVersions)if(!version.validFrom)version.validFrom=transitions.baikonur.day;
 lease.sourceInfo.periodTransition={date:transitions.baikonur.day,criterion:'Baikonur lease entry into force; geometry/lease representation only, not independence or a sovereignty transfer.',sources:transitions.baikonur.sources};
 for(const entity of entities.values()){
  normalizeTerritorialLibraryEntity(entity);
  for(const version of entity.geometryVersions)if(!sourceShapes.has(hash(version.geometry)))throw new Error('New coordinates are forbidden: '+entity.entityId);
  for(const old of original.get(entity.entityId).geometryVersions){
   const current=entity.geometryVersions.find(version=>version.versionId===old.versionId);
   if(!current||hash(current.geometry)!==hash(old.geometry))throw new Error('Existing coordinates changed: '+old.versionId);
  }
 }
 return [...entities.values()];
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const option=name=>{const at=process.argv.indexOf(name);if(at<0||!process.argv[at+1])throw new Error(name+' is required');return path.resolve(process.argv[at+1]);};
 const transitions=JSON.parse(fs.readFileSync(option('--transitions'),'utf8'));
 const report=option('--report-directory');fs.mkdirSync(report,{recursive:true});
 const before=readTerritorialSources(),after=planSovietTransitions(before,transitions);
 const changed=after.filter((entity,i)=>JSON.stringify(entity)!==JSON.stringify(before[i]));
 const planned=changed.map(entity=>({entityId:entity.entityId,lifetime:entity.lifetime,
  versions:entity.geometryVersions.map(({geometry,...version})=>({...version,geometrySha256:hash(geometry)}))}));
 fs.writeFileSync(path.join(report,'application-plan.json'),JSON.stringify({schemaVersion:1,changed:planned},null,2)+'\n');
 const policyPath=new URL('../../assets/data/historical-world/policy.json',import.meta.url);
 const policy=JSON.parse(fs.readFileSync(policyPath));
 for(const row of transitions.rows){
  const independent=after.find(entity=>entity.entityId===row.independentId);
  const rule={targetEntityId:'state:soviet-union',priorityEntityId:row.independentId,
   validFrom:row.day,validTo:'1991',basis:{sourceEntityId:row.independentId,geometryVersionIds:independent.geometryVersions.map(version=>version.versionId)}};
  const at=policy.replacements.findIndex(previous=>previous.targetEntityId===rule.targetEntityId&&previous.priorityEntityId===rule.priorityEntityId);
  if(at<0)policy.replacements.push(rule);else policy.replacements[at]=rule;
 }
 // Preserve the already adopted Karabakh display convention when its former
 // union parent is replaced by the independent Azerbaijan phase.
 const karabakh=policy.replacements.find(rule=>rule.targetEntityId==='state:soviet-union'&&rule.priorityEntityId==='state:nagorno-karabakh');
 if(!karabakh)throw new Error('Existing Karabakh display policy must be reviewed before applying transitions');
 const inherited={...structuredClone(karabakh),targetEntityId:'state:AZE',
  validFrom:transitions.rows.find(row=>row.independentId==='state:AZE').day};
 const inheritedAt=policy.replacements.findIndex(rule=>rule.targetEntityId===inherited.targetEntityId&&rule.priorityEntityId===inherited.priorityEntityId);
 if(inheritedAt<0)policy.replacements.push(inherited);else policy.replacements[inheritedAt]=inherited;
 // Apply this candidate through the existing library storage owner's writer;
 // this tool must never change a shared/read-only runtime inode directly.
 fs.writeFileSync(path.join(report,'policy-candidate.json'),JSON.stringify(policy,null,2)+'\n');
 if(process.argv.includes('--plan-only')){
  console.log('Planned '+changed.length+' source updates and parent display policy; no mounted data changed.');
  process.exit(0);
 }
 for(let i=0;i<changed.length;i++){
  const entity=changed[i];updateTerritorialSource(entity.entityId,current=>{
   if(hash(current)!==hash(before.find(previous=>previous.entityId===entity.entityId)))throw new Error('Source changed during application: '+entity.entityId);
   return entity;
  });
  if(i%25===0)console.log('Applied '+(i+1)+'/'+changed.length+' source metadata/period changes');
 }
 console.log('Applied '+changed.length+' objects; existing coordinates and USSR parent lifetime preserved. Policy candidate is ready for the library writer.');
}
