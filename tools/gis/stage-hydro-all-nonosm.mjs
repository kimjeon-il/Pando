/** One-shot independent-source reclassification of ALL 31 OSM-linked Hydro systems.
 * 42 earlier independently approved systems are untouched. No geometry, index or
 * non-target metadata may change. 10 unsupported hydronyms become stable neutral IDs.
 * This writes a new candidate only; it MUST NOT alter a published data pin.
 */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,dirname,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {validateIndependentHydronyms} from './hydro-independent-name-policy.mjs';
import {rewriteHydroNames} from './prepare-hydro-name-replacement-bundle.mjs';
import {auditHydroOsm,ORIGINAL_OSM_SYSTEM_IDS} from './audit-osm-credit-removal.mjs';
import {readHydroMetadataSection} from "./inventory-osm-hydronyms.mjs";

const sha=x=>createHash('sha256').update(x).digest('hex');
const check=(v,m)=>{if(!v)throw Error(m);};
const equals=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sorted=ids=>[...ids].sort((a,b)=>Number(a)-Number(b));
const regions={1:'af',2:'eu',3:'si',4:'as'};
const expectedRegional={af:2,eu:11,si:1,as:17};
const pinned='f0832dd2024cbfad8b1662410a4f189fa95bcecb56c3e3f1ad69d36af4a0c36f';
const namesFile='hydro-bulk-independent-remaining29.json';
const followupFile='hydro-followup-independent-name-replacements.json';
const baselineFile='hydro-independent-name-replacements.json';
const stageVersion='0.13.4';

function proofRecord(row,inventory){
  const record=inventory.rows.find(item=>item.systemId===row.systemId);
  check(record,'Missing independently screened system '+row.systemId);
  check(row.previousNameKo===record.currentNameKo,'Original OSM-name mismatch '+row.systemId);
  check(row.evidence.baselineGeometrySha256===inventory.pinnedBundleSha256 &&
    row.evidence.sourceScreenId===inventory.naturalEarthCrosscheckRunId &&
    row.evidence.referenceFile===record.priorEvidenceFile &&
    equals(row.evidence.namedReferenceUrls,record.namedPointCandidateUrls) &&
    equals(row.evidence.naturalEarthCandidateSampleCoverage,
      record.naturalEarthGeometryScreen.candidates.slice(0,5).map(x=>({
        name:x.name,matched:x.supportingSamples,of:81,
        coverage:x.sampleCoverage,meanDistanceDegrees:x.meanDistanceDegrees
      }))), 'Independent 81-point audit not reproduced for '+row.systemId);
  return record;
}
export function reviewRemaining29(document,inventory,followup){
  check(document?.schemaVersion===1 &&
    document?.originalHydroVersion==='0.13.2' &&
    document?.originalBundleSha256===pinned &&
    document.originalBundleSha256===inventory.pinnedBundleSha256 &&
    Array.isArray(document.substitutions) &&
    document.substitutions.length===29,'Original source or batch size changed');
  const originals=new Set(ORIGINAL_OSM_SYSTEM_IDS);
  const approved=validateIndependentHydronyms(followup);
  check(equals(sorted(Object.keys(approved)),['20773860','40423228'].sort((a,b)=>Number(a)-Number(b))),
    'Original two independently named followups changed');
  check(approved['20773860'].hydroRiversRegion==='eu' &&
    approved['40423228'].hydroRiversRegion==='as',
    'Suez and Namhangang original regional source attribution incorrect');
  const items={...approved},named=[],neutral=[];
  for(const entry of document.substitutions){
    const id=String(entry?.systemId||''),area=regions[id[0]];
    check(originals.has(id)&&!Object.hasOwn(items,id) && area
      && entry.hydroRiversRegion===area,
      'Unrecognized or region-misclassified old source '+id);
    check(entry.geometryChanged===false &&
      entry.osmNamesOrRelationsReused===false &&
      Array.isArray(entry.aliases)&&entry.aliases.length===0 &&
      Array.isArray(entry.tributaryNames)&&entry.tributaryNames.length===0 &&
      typeof entry.reviewStatement==='string'&&entry.reviewStatement.length>=50,
      'Unresolved alias, tributary or review identity '+id);
    const record=proofRecord(entry,inventory);
    const refs=entry.independentSources;
    check(Array.isArray(refs)&&refs.length>=1 &&
      refs.every(x=>x&&typeof x.url==='string'&&x.url.startsWith('https://')
        &&!/openstreetmap|overpass|example\.test/i.test(x.url)),
      'OSM or unsafe reference in independent name evidence '+id);
    if(entry.classification==='source-neutral-unnamed-hydro-system'){
      check(entry.nameKo==='미명명 수계 '+id &&
        entry.sourceLabel==='HydroRIVERS 1.0 · unnamed logical system' &&
        refs.length===1 && refs[0].url==='https://www.hydrosheds.org/products/hydrorivers',
        'Neutral fallback still carries an unverified river name '+id);
      neutral.push(id);
    }else{
      check(entry.classification==='independent-geographical-reach-name' &&
        refs.length>=2 &&
        entry.sourceLabel==='HydroRIVERS 1.0 · independently verified river names' &&
        entry.nameKo && !entry.nameKo.startsWith('미명명 수계 ') &&
        refs.some(x=>x.url!=='https://www.hydrosheds.org/products/hydrorivers'),
        'Named river has no independent geographic name evidence '+id);
      // Renames to Indus, Brahmaputra and Yom must agree with the strongest
      // public-domain Natural Earth centerline and an independent authority.
      const corrected={
        '41023100':{nameKo:'인더스강',ne:'Indus',minimum:0.6},
        '41067217':{nameKo:'브라마푸트라강',ne:'Brahmaputra',minimum:0.6},
        '41337891':{nameKo:'욤강',ne:'Yom',minimum:0.65},
      }[id];
      if(corrected) {
        const leader=record.naturalEarthGeometryScreen.candidates[0];
        check(entry.nameKo===corrected.nameKo && leader?.name===corrected.ne &&
          leader.sampleCoverage>=corrected.minimum && refs.length>=2,
          'Competing original OSM basin-name correction not grounded '+id);
      }else{
        check(entry.nameKo===entry.previousNameKo || (id==='40415850'
          &&entry.nameKo==='임진강'&&entry.previousNameKo==='림진강/임진강'),
          'New unreviewed hydronym introduced '+id);
      }
      named.push(id);
    }
    items[id]=entry;
  }
  check(named.length===19&&neutral.length===10 &&
    equals(sorted(Object.keys(items)),sorted(ORIGINAL_OSM_SYSTEM_IDS)),
    'Original 31-system OSM scope not fully eliminated');
  check(document.sourceIndependentNamedSystems===named.length &&
    document.neutralizedUnverifiedNameSystems===neutral.length,
    'Source classification count mismatch');
  const byArea={af:0,eu:0,si:0,as:0};
  for(const entry of Object.values(items))byArea[entry.hydroRiversRegion]++;
  check(equals(byArea,expectedRegional),'Original Hydro region accounting does not match published reference');
  return {substitutions:items,named,neutral,regionTotals:byArea,
    systemIds:sorted(Object.keys(items))};
}

function mapByFid(rows){
  const map=new Map(rows.map(x=>[Number(x.fid),x]));
  check(map.size===rows.length,'Duplicate FID');
  return map;
}
export function prepareAllNonOsmHydro({
  manifest,bundle,baselineBytes,followupBytes,remainingBytes,inventory
}){
  check(manifest?.version==='0.13.2'&&manifest.container?.sha256===pinned,
    'Not the exact original Hydro release');
  check(Buffer.isBuffer(bundle)&&Buffer.isBuffer(baselineBytes)
    &&Buffer.isBuffer(followupBytes)&&Buffer.isBuffer(remainingBytes),
    'Missing immutable original Hydro and review input bytes');
  check(sha(baselineBytes)===manifest.sources?.independentHydronymReplacements?.sha256 &&
    manifest.sources.independentHydronymReplacements.replacedSystems===42 &&
    Object.keys(validateIndependentHydronyms(JSON.parse(baselineBytes))).length===42,
    'Original 42 independent-name source receipt altered');
  check(inventory?.pinnedBundleSha256===pinned,'Unpinned 31-mainstem source inventory');
  const followup=JSON.parse(followupBytes);
  const remaining=JSON.parse(remainingBytes);
  const verified=reviewRemaining29(remaining,inventory,followup);
  const prior=auditHydroOsm(manifest,bundle,{baseline:true});
  check(prior.remainingCount===31,'Published baseline does not contain exactly 31 OSM systems');
  for(const region of manifest.sources.hydroRivers){
    const original=verified.regionTotals[region.datasetCode]||0;
    check(region.osmMatches===original,
      'Original per-region OSM source records differ: '+region.datasetCode);
  }
  const updated=rewriteHydroNames({
    manifest,bundle,substitutions:verified.substitutions,
    sourceName:namesFile,sourceBytes:remainingBytes,
  });
  const next=updated.manifest;
  next.version=stageVersion;
  next.dataset=String(manifest.dataset).replace('OSM waterway names',
    'independent factual river names and Hydro source-neutral unnamed systems');
  check(!next.dataset.includes('OSM'),'Former OSM source incorrectly retained in dataset label');
  next.cache.name='pandolab-water-v0.13.4-independent-'+next.metadata.core.sha256.slice(0,16);
  next.sources.osmWaterways={file:null,matchedSystems:0,license:null,sha256:null};
  next.sources.independentHydronymReplacements=structuredClone(manifest.sources.independentHydronymReplacements);
  next.sources.independentHydronymFollowup={
    file:followupFile,sha256:sha(followupBytes),replacedSystems:2,
    geometryChanged:false,baselineBundleSha256:pinned,
  };
  next.sources.independentHydronymBulk={
    file:namesFile,sha256:sha(remainingBytes),replacedSystems:29,
    independentlyNamed:19,sourceNeutralUnnamed:10,
    geometryChanged:false,baselineBundleSha256:pinned,
  };
  check(next.sources.hydroRivers.every(x=>x.osmMatches===0)
    &&next.stats.osmWaterwayMatchCount===0
    &&next.sources.nameEnrichment.osmMatches===0,'OSM regional source accounting did not reach zero');
  const audit=auditHydroOsm(next,updated.bundle);
  check(audit.remainingCount===0 &&!audit.staleManifestOsmSource &&
    audit.inconsistentLabels.length===0 &&
    audit.independentUrlOsmContamination.length===0,
    'Residual OSM detail or manifest source survived batch replacement');
  const oldCore=readHydroMetadataSection(bundle,manifest.metadata.core);
  const newCore=readHydroMetadataSection(updated.bundle,next.metadata.core);
  const oldDetail=readHydroMetadataSection(bundle,manifest.metadata.detail);
  const newDetail=readHydroMetadataSection(updated.bundle,next.metadata.detail);
  check(equals(oldCore.map(x=>x.fid),newCore.map(x=>x.fid)) &&
    equals(oldDetail.map(x=>x.fid),newDetail.map(x=>x.fid)) &&
    newCore.length===manifest.metadata.featureCount &&
    newDetail.length===oldDetail.length, 'Hydro feature IDs or count changed');
  const byOldCore=mapByFid(oldCore),byNewCore=mapByFid(newCore);
  const byOldDetail=mapByFid(oldDetail),byNewDetail=mapByFid(newDetail);
  let changed=0,changedNames=0,neutralized=0,keptOther=0,oldOsmRefs=0;
  for(const [fid,oldRow] of byOldCore){
    const current=byNewCore.get(fid),id=String(oldRow.systemId||''),
      before=byOldDetail.get(fid),after=byNewDetail.get(fid),review=verified.substitutions[id];
    check(current&&before&&after,'Hydro fragment missing');
    if(!review) {
      check(equals(oldRow,current)&&equals(before,after),
        'One of 42 independent names, another river or a lake changed');
      keptOther++;
      continue;
    }
    check(current.name===review.nameKo &&
      current.mainstemNameKo===review.nameKo &&
      !Array.isArray(after.osmRelationIds) &&
      !String(after.source||'').includes('OSM') &&
      equals(after.independentSourceUrls,
        [...new Set(review.independentSources.map(x=>x.url))]) &&
      (review.classification!=='source-neutral-unnamed-hydro-system' ||
        (!after.aliases?.length&&!after.tributaryNames?.length)),
      'Target metadata did not become OSM-independent '+id);
    check(equals(
      Object.fromEntries(Object.entries(oldRow).filter(([k])=>!['name','mainstemNameKo'].includes(k))),
      Object.fromEntries(Object.entries(current).filter(([k])=>!['name','mainstemNameKo'].includes(k)))),
      'An unrelated Hydro river attribute was changed');
    oldOsmRefs+=(before.osmRelationIds||[]).length;
    changed++;
    if(oldRow.name!==current.name)changedNames++;
    if(review.classification==='source-neutral-unnamed-hydro-system')neutralized++;
  }
  check(changed>0 && keptOther>0 &&changedNames>0 &&
    equals(manifest.shards.map(x=>x.sha256),next.shards.map(x=>x.sha256)) &&
    manifest.index.sha256===next.index.sha256 &&
    equals(manifest.container.roles,next.container.roles),
    'Hydro index/geometry or non-source identity changed');
  return {manifest:next,bundle:updated.bundle,baselineBytes,followupBytes,remainingBytes,
    proof:{
      schema:'pando-hydro-full-osm-name-retirement-v1',
      status:'FULL_HYDRO_METADATA_CANDIDATE_NOT_PUBLISHED',
      originalVersion:'0.13.2',candidateVersion:stageVersion,
      originalSha256:manifest.container.sha256,candidateSha256:next.container.sha256,
      originalIndependentCount:42,additionalNamedCount:2,
      remainingIndependentlyNamedCount:19,neutralizedUnverifiedNameCount:10,
      sourceNamesScrubbed:31,osmsInCandidate:0,
      alteredFeatureFragments:changed,renamedFeatureFragments:changedNames,
      neutralizedFeatureFragments:neutralized,
      originalOsmRelationReferenceCountRemoved:oldOsmRefs,
      unchangedOtherFeatureFragments:keptOther,
      indexUnchanged:true,geometryShardHashesUnchanged:true,
      originalIndexSha256:manifest.index.sha256,
      candidateIndexSha256:next.index.sha256,
      geometryShardSha256:next.shards.map(x=>x.sha256),
      sourceIndependentByRegion:verified.regionTotals,
      baselineReviewSha256:sha(baselineBytes),
      incrementalReviewSha256:sha(followupBytes),bulkReviewSha256:sha(remainingBytes),
      approvedSystemIds:verified.systemIds,
      namedSystemIds:verified.named,neutralizedSystemIds:verified.neutral,
      deployed:false,mainMapOsmCreditRemoved:false,
      scopeLimit:'Hydro package only. Baikonur and unrelated historical OSM-derived coastline not included.',
    }
  };
}

function safeOutsideSource(out,inputs){
  const target=resolve(out);
  check(!existsSync(target)&&!existsSync(target+'.proof.json'),
    'Candidate or proof file already exists; refuse overwrite');
  for(const source of inputs){
    const relativePath=relative(dirname(resolve(source)),target);
    check(relativePath==='..'||relativePath.startsWith('..'+sep)||isAbsolute(relativePath),
      'Candidate must be outside all input directories');
  }
  return target;
}
export function main(argv=process.argv.slice(2)){
  const required=['manifest','bundle','baseline-review','followup-review','remaining-review','inventory','output-dir'];
  const {values}=parseArgs({args:argv,options:Object.fromEntries(
    required.map(x=>[x,{type:'string'}]))});
  check(required.every(x=>typeof values[x]==='string'&&values[x].length>0),
    'Missing pinned Hydro source, both independent reviews, source inventory or output-dir');
  const paths=required.filter(x=>x!=='output-dir').map(x=>resolve(values[x]));
  const out=safeOutsideSource(values['output-dir'],paths);
  const payload=prepareAllNonOsmHydro({
    manifest:JSON.parse(readFileSync(values.manifest,'utf8')),
    bundle:readFileSync(values.bundle),
    baselineBytes:readFileSync(values['baseline-review']),
    followupBytes:readFileSync(values['followup-review']),
    remainingBytes:readFileSync(values['remaining-review']),
    inventory:JSON.parse(readFileSync(values.inventory,'utf8')),
  });
  mkdirSync(dirname(out),{recursive:true});
  mkdirSync(out);
  for(const [name,bytes] of [
    ['manifest.json',JSON.stringify(payload.manifest,null,2)+'\n'],
    ['hydro.bin',payload.bundle],
    [baselineFile,payload.baselineBytes],
    [followupFile,payload.followupBytes],
    [namesFile,payload.remainingBytes],
  ])writeFileSync(resolve(out,name),bytes,{flag:'wx'});
  writeFileSync(out+'.proof.json',JSON.stringify(payload.proof,null,2)+'\n',{flag:'wx'});
  console.log('HYDRO_ZERO_OSM_CANDIDATE='+JSON.stringify(payload.proof));
  return payload.proof;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main();}catch(error){console.error(error.stack);process.exitCode=1;}
}
