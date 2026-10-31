import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readTerritorialSources,readTerritorialSource,territorialSourceRoot,updateTerritorialSource} from '../territorial-entity-sources.mjs';
import {writeLibraryOutput} from '../library-data.mjs';
import {normalizeTerritorialLibraryEntity} from '../../apps/editor/frontend/js/modules/territorial-library.js';

export const SOURCE_REFERENCE_DATE='2026-10-06';
const PRIOR_DAY='2026-10-05';
export const SOURCE_CUTS=Object.freeze([
 {id:'state:IDN',history:'state:IDN:1999-2026-after-east-timor-r1',first:'1999-10-25'},
 {id:'state:UKR',history:'state:UKR:2014-03-18-post-crimea-r1',first:'2014-03-18'},
 {id:'state:SDN',history:'state:SDN:2011-07-09-post-secession-r1',first:'2011-07-09'},
 {id:'state:SDS',history:'state:SDS:2011-07-09-independence-r1',first:'2011-07-09'},
 {id:'state:TLS',history:'state:TLS:2002-2026-independence-r1',first:'2002-05-20'},
].map(row=>Object.freeze({...row,modern:row.id+':natural-earth-5.1.1'})));
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=(yes,message)=>{if(!yes)throw Error('FALSE_SOURCE_DATE_CUT: '+message);};

export function planSourceDateConsolidation(entities,view){
 const byId=new Map(entities.map(e=>[e.entityId,e]));
 fail(view?.schemaVersion===1&&Array.isArray(view.selections),'Invalid existing world view');
 const nextView=structuredClone(view),updates=[],proof=[];
 for(const rule of SOURCE_CUTS){
  const original=byId.get(rule.id);
  fail(!!original,'Source entity missing: '+rule.id);
  fail(original.lifetime.validTo===null,'Existing state must remain extant: '+rule.id);
  const versions=original.geometryVersions;
  const historical=versions.find(v=>v.versionId===rule.history);
  const modern=versions.find(v=>v.versionId===rule.modern);
  fail(!!historical&&historical.validFrom===rule.first,
   'Historical event date must remain exact: '+rule.id);
  const selection=nextView.selections.filter(s=>s.entityId===rule.id);
  fail(selection.length===1,'Single view selection required: '+rule.id);
  const archived=original.sourceInfo?.temporalBoundaryCorrection;
  if(!modern){
   fail(historical.validTo===null&&original.metadata.representativeGeometryVersionId===rule.history
    &&selection[0].geometryVersionId===rule.history
    &&archived?.retiredVersionId===rule.modern&&archived?.referenceDate===SOURCE_REFERENCE_DATE,
    'Incomplete or mismatched prior correction: '+rule.id);
   proof.push({entityId:rule.id,already:true,retained:rule.history,geometrySha256:archived.geometrySha256});
   continue;
  }
  fail(versions.at(-2)?.versionId===rule.history&&versions.at(-1)?.versionId===rule.modern,
   'Expected consecutive historical/current source versions: '+rule.id);
  fail(historical.validTo===PRIOR_DAY&&modern.validFrom===SOURCE_REFERENCE_DATE&&modern.validTo===null,
   'Unexpected boundary interval: '+rule.id);
  fail(historical.certainty==='low'&&modern.certainty==='high','Source confidence must remain distinguishable: '+rule.id);
  fail(historical.historicalProvenance?.sourceReferenceDate===SOURCE_REFERENCE_DATE,
   'Original reference-date provenance missing: '+rule.id);
  fail(original.metadata.representativeGeometryVersionId===rule.modern
   &&selection[0].geometryVersionId===rule.modern,'Canonical view selection changed: '+rule.id);
  fail(!archived,'Already has an unrelated temporal-boundary correction: '+rule.id);
  const firstHash=sha(historical.geometry),modernHash=sha(modern.geometry);
  fail(firstHash===modernHash,'Real coordinate difference: manual review required: '+rule.id);
  const next=structuredClone(original);
  next.geometryVersions=next.geometryVersions.filter(v=>v.versionId!==rule.modern);
  const kept=next.geometryVersions.find(v=>v.versionId===rule.history);
  kept.validTo=null;
  // The low historical confidence remains: a modern outline does not prove
  // every intermediate historical boundary, even when coordinates match.
  next.metadata.representativeGeometryVersionId=rule.history;
  next.metadata.sourceOutlineReferenceDate=SOURCE_REFERENCE_DATE;
  next.sourceInfo.temporalBoundaryCorrection={
   kind:'source-reference-date-not-geopolitical-event',
   referenceDate:SOURCE_REFERENCE_DATE,
   retiredVersionId:rule.modern,
   retiredSourceId:modern.sourceId,
   retiredReferenceCertainty:modern.certainty,
   retainedVersionId:rule.history,
   retainedEventDate:rule.first,
   geometrySha256:firstHash,
   verifiedHistoricalGeometry:false,
   note:'The 2026-10-06 boundary was a source snapshot reference, not a territorial event. Identical outline coordinates are now represented by one open-ended low-certainty historical proxy. The former canonical source edition is preserved by its version ID and geometry digest in metadata and immutable archive.',
  };
  selection[0].geometryVersionId=rule.history;
  normalizeTerritorialLibraryEntity(next);
  fail(next.geometryVersions.length===original.geometryVersions.length-1,
   'Exactly one redundant edition must be removed: '+rule.id);
  fail(next.geometryVersions.every(v=>sha(v.geometry)===sha(versions.find(w=>w.versionId===v.versionId).geometry)),
   'An existing geometry was changed: '+rule.id);
  updates.push({original,next});
  proof.push({entityId:rule.id,already:false,retained:rule.history,retired:rule.modern,
   start:rule.first,end:null,sourceDate:SOURCE_REFERENCE_DATE,geometrySha256:firstHash});
 }
 fail(updates.length===0||updates.length===SOURCE_CUTS.length,
  'Partial conversion detected; do not publish a mixed dataset');
 return {already:updates.length===0,updates,view:nextView,proof};
}

function main(args){
 const apply=args.includes('--apply'),plan=args.includes('--plan');
 fail(apply!==plan,'Choose exactly one of --plan and --apply');
 const root=fileURLToPath(new URL('../../',import.meta.url));
 const viewPath=path.join(territorialSourceRoot,'views/world.json');
 const view=JSON.parse(fs.readFileSync(viewPath,'utf8'));
 const task=planSourceDateConsolidation(readTerritorialSources(),view);
 console.log('SOURCE_DATE_CUT_PLAN='+JSON.stringify({status:task.already?'already-normalized':apply?'apply':'plan',
  geometryModified:false,referenceDate:SOURCE_REFERENCE_DATE,proof:task.proof}));
 if(!apply||task.already)return;
 // All five equality, lifetime, version, representative and view checks above
 // finish before the first write. Existing scoped library writer owns writes.
 for(const {original,next} of task.updates)
  updateTerritorialSource(original.entityId,latest=>{
   fail(sha(latest)===sha(original),'Concurrent source modification: '+original.entityId);
   return next;
  });
 writeLibraryOutput(viewPath,JSON.stringify(task.view,null,2)+'\n');
 for(const spec of SOURCE_CUTS){
  const actual=readTerritorialSource(spec.id);
  fail(actual.geometryVersions.some(v=>v.versionId===spec.history&&v.validFrom===spec.first&&v.validTo===null)
   &&!actual.geometryVersions.some(v=>v.versionId===spec.modern),'Post-write interval mismatch: '+spec.id);
 }
 for(const command of ['tools/build-territorial-entity-chunks.mjs','tools/build-builtin-world.mjs'])
  execFileSync(process.execPath,[command],{cwd:root,stdio:'inherit'});
 console.log('SOURCE_DATE_CUT_APPLIED='+JSON.stringify({sourceEntities:task.updates.length,
  coordinatesEdited:0,worldViewUpdated:true,referenceDateOnly:SOURCE_REFERENCE_DATE}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2));
