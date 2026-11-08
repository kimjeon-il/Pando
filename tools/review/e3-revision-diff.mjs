import {createHash} from 'node:crypto';
import {
  parseTemporal, normalizeTemporalInterval, temporalIntervalsOverlap,
  temporalContains, temporalMonthEnd, compareTemporal, compareTemporalKeys, temporalFollowingDay,
} from "../../src/document/temporal.js";
import {normalizeTerritorialLibraryEntity} from '../gis/territorial-library.js';
import {createReviewBundle, REVIEW_DATA_REPOSITORY} from "../../src/document/review-change-records.js";

export const E3_DIFF_SCHEMA_VERSION = 1;
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[a-z][a-z0-9_-]*:[A-Za-z0-9_-]+$/;
const NAME_FIELDS = ['names.ko.common','names.ko.formal','names.en.common','names.en.formal'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (a,b) => JSON.stringify(a)===JSON.stringify(b);
const cmp=(a,b)=>a<b?-1:a>b?1:0;
function invalid(message) {throw Object.assign(new Error(message),{code:'PL-E3-REVISION'});}
const sorted = items=>[...items].sort(cmp);
const plain = x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const validPeriod=period=>{
  if(!plain(period)||!Object.hasOwn(period,'validFrom')||!Object.hasOwn(period,'validTo'))invalid('Source interval must have both temporal endpoints.');
  for(const x of [period.validFrom,period.validTo])if(x!==null&&typeof x!=='string')invalid('Non-string temporal source endpoint.');
  const normalized=normalizeTemporalInterval(period.validFrom,period.validTo);
  return {validFrom:normalized.validFrom,validTo:normalized.validTo};
};
function cover(outer,inner) {
  return (outer.validFrom===null||inner.validFrom!==null
    &&compareTemporal(outer.validFrom,inner.validFrom,{leftBoundary:'start',rightBoundary:'start'})<=0)
    &&(outer.validTo===null||inner.validTo!==null
    &&compareTemporal(outer.validTo,inner.validTo,{leftBoundary:'end',rightBoundary:'end'})>=0);
}
function overlaps(left,right){return temporalIntervalsOverlap(left,right);}
function dayKey(value,edge){return value==null?null:parseTemporal(value,{nullable:false})[edge==='start'?'startKey':'endKey'];}
function lower(a,b){if(a===null)return -1;if(b===null)return 1;return compareTemporalKeys(a,b);}
function upper(a,b){if(a===null)return 1;if(b===null)return -1;return compareTemporalKeys(a,b);}
function continuousCoverage(target,candidates) {
  const rows=candidates.filter(row=>overlaps(target,row)).sort((a,b)=>lower(dayKey(a.validFrom,'start'),dayKey(b.validFrom,'start')));
  if(!rows.length||!cover({validFrom:rows[0].validFrom,validTo:null},{validFrom:target.validFrom,validTo:null}))return false;
  let end=dayKey(rows[0].validTo,'end');
  for(const row of rows.slice(1)){
    const start=dayKey(row.validFrom,'start'),next=end==null?null:temporalFollowingDay(end);
    if(next!==null&&start!==null&&compareTemporalKeys(start,next)>0)return false;
    const later=dayKey(row.validTo,'end');
    if(upper(later,end)>0)end=later;
  }
  return cover({validFrom:null,validTo:end==null?null:rows.findLast(row=>dayKey(row.validTo,'end')!==null&&compareTemporalKeys(dayKey(row.validTo,'end'),end)===0)?.validTo??null}, {validFrom:null,validTo:target.validTo});
}
const issue=(entityId,code,detail)=>({sourceEntityId:entityId,code,detail});
function edition(versions, entity, field) {
  if(field==='geometry'){
    return versions.map(v=>({...validPeriod(v),value:{versionId:v.versionId,sha256:sha256(Buffer.from(JSON.stringify(v.geometry)))}}));
  }
  if(field==='flag'){
    const history=entity.metadata?.flagHistory;
    return Array.isArray(history)&&history.length?history.map(v=>({...validPeriod(v),value:flagArtwork(v,entity)}))
      :[{validFrom:null,validTo:null,value:flagArtwork({policy:'default'},entity)}];
  }
  const editions=Array.isArray(entity.nameVersions)&&entity.nameVersions.length?entity.nameVersions:
    [{validFrom:null,validTo:null,names:entity.names}];
  const [,lang,role]=field.split('.');
  return editions.map(v=>({...validPeriod(v),value:readName(v.names,lang,role)}));
}
function readName(names,lang,role) {
  const entry=names?.[lang];
  if(entry==null)return null;
  if(typeof entry==='string')return role==='common'?entry:null;
  if(plain(entry))return typeof entry[role]==='string'&&entry[role].trim()?entry[role]:null;
  invalid('Unexpected stored territorial name edition.');
}
function flagArtwork(edition,entity){
  const data=edition?.flagDataUrl||entity.metadata?.defaultFlagDataUrl;
  if(edition?.policy==='default'||!edition?.flagDataUrl){
    if(!data)return null;
    return {unresolvedAsset:data};
  }
  if(typeof data!=='string'||!/^data:image\/svg\+xml;base64,[A-Za-z0-9+/]+={0,2}$/.test(data))
    return {unresolvedAsset:'unsupported flag artwork encoding'};
  const raw=Buffer.from(data.slice('data:image/svg+xml;base64,'.length),'base64');
  if(!raw.length)return {unresolvedAsset:'empty flag artwork'};
  return {sha256:sha256(raw)};
}
function asFlag(value) {
  if(value===null)return null;
  return value.sha256?{sha256:value.sha256}:undefined;
}
function seriesDiff(entityId,kind,field,before,after,problems){
  const out=[];
  for(const row of after) {
    const matches=before.filter(v=>cover(v,row));
    if(matches.length>1||matches.length===0&&before.some(v=>overlaps(v,row))) {
      problems.push(issue(entityId,'unaligned-interval',kind+' '+field+' candidate validity intersects more than one prior interval; no inferred day boundary.'));
      continue;
    }
    const prior=matches.length?matches[0].value:null;
    if(same(prior,row.value))continue;
    const old=kind==='flag'?asFlag(prior):prior;
    const next=kind==='flag'?asFlag(row.value):row.value;
    if(old===undefined||next===undefined) {
      problems.push(issue(entityId,'unresolved-flag-artwork','Flag has a default/unsupported external artwork reference; cannot attest artwork SHA-256.'));
      continue;
    }
    out.push({sourceEntityId:entityId,kind,field,validFrom:row.validFrom,validTo:row.validTo,before:old,after:next});
  }
  for(const row of before) {
    if(continuousCoverage(row,after))continue;
    if(after.some(candidate=>overlaps(candidate,row))) {
      problems.push(issue(entityId,'coverage-gap',kind+' '+field+' previous validity not fully covered by candidate. Requires independent interval alignment.'));
      continue;
    }
    const old=kind==='flag'?asFlag(row.value):row.value;
    if(old===undefined){
      problems.push(issue(entityId,'unresolved-flag-artwork','Cannot fingerprint removed flag asset.'));
      continue;
    }
    if(old!==null)out.push({sourceEntityId:entityId,kind,field,validFrom:row.validFrom,validTo:row.validTo,before:old,after:null});
  }
  return out;
}
function enumMetadataDifferences(before,after){
  const top=['schemaVersion','entityKind','lineageId','alternateNames','instantiation','sourceInfo'];
  const changed=top.filter(key=>!same(before?.[key],after?.[key]));
  const metaBefore=before?.metadata||{},metaAfter=after?.metadata||{};
  for(const key of new Set([...Object.keys(metaBefore),...Object.keys(metaAfter)]))
    if(key!=='flagHistory'&&key!=='defaultFlagDataUrl'&&!same(metaBefore[key],metaAfter[key]))changed.push('metadata.'+key);
  if(!same(before?.names,after?.names))changed.push('names (undated fallback/aliases)');
  if(!same(before?.nameVersions,after?.nameVersions))changed.push('nameVersions (editions)');
  return changed;
}
/** Return actual source-level changes only; none of these records changes GIS data. */
export function diffTerritorialEntities(beforeInput,afterInput,{sourceEntityId}={}) {
  const sample=afterInput||beforeInput;
  const id=sourceEntityId||sample?.entityId;
  if(!ID.test(id||'')||!id.startsWith('state:'))invalid('E3 must use a canonical state source entity ID.');
  if(beforeInput&&beforeInput.entityId!==id||afterInput&&afterInput.entityId!==id)invalid('Source entity ID mismatch.');
  if(beforeInput)normalizeTerritorialLibraryEntity(beforeInput);
  if(afterInput)normalizeTerritorialLibraryEntity(afterInput);
  const issues=[],changes=[],metadataChanges=enumMetadataDifferences(beforeInput,afterInput);
  const zero={lifetime:null,parentEntityId:'',geometryVersions:[],names:{},metadata:{}};
  const old=beforeInput||zero,next=afterInput||zero;
  if(!same(old.lifetime,next.lifetime))
    changes.push({sourceEntityId:id,kind:'lifetime',field:'lifetime',validFrom:null,validTo:null,
      before:beforeInput?validPeriod(old.lifetime):null,after:afterInput?validPeriod(next.lifetime):null});
  if(old.parentEntityId!==next.parentEntityId)changes.push({sourceEntityId:id,kind:'parent',field:'parentEntityId',validFrom:null,validTo:null,
    before:old.parentEntityId||null,after:next.parentEntityId||null});
  changes.push(...seriesDiff(id,'geometry','geometry',edition(old.geometryVersions,old,'geometry'),edition(next.geometryVersions,next,'geometry'),issues));
  for(const field of NAME_FIELDS)
    changes.push(...seriesDiff(id,'name',field,edition([],old,field),edition([],next,field),issues));
  // Default artwork paths are only asset references and cannot be represented
  // as verified content hashes until the data owner resolves their actual bytes.
  if(!same(old.metadata?.flagHistory,next.metadata?.flagHistory)
    ||old.metadata?.defaultFlagDataUrl!==next.metadata?.defaultFlagDataUrl)
    changes.push(...seriesDiff(id,'flag','metadata.flagHistory',edition([],old,'flag'),edition([],next,'flag'),issues));
  const key=row=>JSON.stringify([row.sourceEntityId,row.kind,row.field,row.validFrom,row.validTo]);
  const deDup=new Set();
  const order={lifetime:0,parent:1,name:2,flag:3,geometry:4};
  const unique=changes.filter(x=>{const k=key(x);if(deDup.has(k)){issues.push(issue(id,'duplicate-interval','Overlapping edits share the same E2 logical slot.'));return false;}deDup.add(k);return true;});
  unique.sort((a,b)=>order[a.kind]-order[b.kind]||cmp(a.field,b.field)||cmp(a.validFrom||'',b.validFrom||'')||cmp(a.validTo||'',b.validTo||''));
  return {sourceEntityId:id,changes:unique,issues,metadataChanges};
}
function validateIndex(value){
  if(!plain(value)||value.schemaVersion!==1||!plain(value.entities))invalid('Source content index schema 1 is required.');
  for(const [id,digest] of Object.entries(value.entities))
    if(!ID.test(id)||!DIGEST.test(digest))invalid('Invalid library index entity digest: '+id);
  return value;
}
export function revisionIndexDiff(baseIndex,candidateIndex){
  const left=validateIndex(baseIndex).entities,right=validateIndex(candidateIndex).entities;
  return sorted(new Set([...Object.keys(left),...Object.keys(right)])).filter(id=>left[id]!==right[id])
    .map(sourceEntityId=>({sourceEntityId,beforeDigest:left[sourceEntityId]??null,afterDigest:right[sourceEntityId]??null}));
}
/** E3 reads the exact immutable object bytes, never an app-rendered GeoJSON. */
export function collectRevisionDiff({baseRevision,candidateRevision,baseIndex,candidateIndex,readEntity,comparisonMonth=null,maxEntities=50,batchIndex=null}){
  if(!SHA.test(baseRevision)||!SHA.test(candidateRevision)||baseRevision===candidateRevision)invalid('Two distinct exact data Git commits are required.');
  if(typeof readEntity!=='function')invalid('Source object reader is mandatory.');
  if(comparisonMonth!==null){
    const point=parseTemporal(comparisonMonth,{nullable:false});
    if(point.precision!=='month'||point.canonical!==comparisonMonth)invalid('Comparison must use an exact month cursor.');
  }
  const allChanged=revisionIndexDiff(baseIndex,candidateIndex);
  if(!Number.isInteger(maxEntities)||maxEntities<1||maxEntities>200)
    invalid('Source revision budget must be an integer between 1 and 200.');
  const batchCount=Math.max(1,Math.ceil(allChanged.length/maxEntities));
  if(batchIndex!==null&&(!Number.isInteger(batchIndex)||batchIndex<1||batchIndex>batchCount))
    invalid('Requested batch-index is not inside the complete source revision range.');
  if(batchIndex===null&&batchCount>1)
    invalid('Source revision exceeds the entity budget; provide --batch-index=1..'+batchCount+' to cover every object.');
  const changed=batchIndex===null?allChanged:allChanged.slice((batchIndex-1)*maxEntities,batchIndex*maxEntities);
  const changes=[],issues=[],nonMapMetadata=[],readHashes=[];
  for(const row of changed){
    if(!row.sourceEntityId.startsWith('state:')) {
      issues.push(issue(row.sourceEntityId,'unsupported-object-domain','This review records only country source entities; historical water/other records need their own canonical contract.'));
      continue;
    }
    const before=row.beforeDigest?readEntity({revision:baseRevision,entityId:row.sourceEntityId,digest:row.beforeDigest}):null;
    const after=row.afterDigest?readEntity({revision:candidateRevision,entityId:row.sourceEntityId,digest:row.afterDigest}):null;
    for(const [value,expected,revision] of [[before,row.beforeDigest,baseRevision],[after,row.afterDigest,candidateRevision]]) {
      if(expected===null)continue;
      if(!value||!Buffer.isBuffer(value.bytes)||sha256(value.bytes)!==expected)invalid('Source content hash mismatch: '+row.sourceEntityId+'@'+revision);
      const resource=value.resource;
      if(!resource||typeof resource.url!=='string'||!/^[-A-Za-z0-9_./]+$/.test(resource.url)
        ||resource.url.startsWith('/')||resource.url.split('/').some(p=>!p||p==='.'||p==='..')
        ||!['identity','gzip'].includes(resource.encoding)||!DIGEST.test(resource.sha256||'')
        ||!Number.isSafeInteger(resource.compressedBytes)||resource.compressedBytes<1
        ||resource.decodedBytes!==value.bytes.length)invalid('Source transport receipt is required: '+row.sourceEntityId);
      readHashes.push({sourceEntityId:row.sourceEntityId,revision,sha256:expected,resource});
    }
    const diff=diffTerritorialEntities(before?JSON.parse(before.bytes.toString('utf8')):null,
      after?JSON.parse(after.bytes.toString('utf8')):null,{sourceEntityId:row.sourceEntityId});
    changes.push(...diff.changes);issues.push(...diff.issues);
    if(diff.metadataChanges.length)nonMapMetadata.push({sourceEntityId:row.sourceEntityId,fields:diff.metadataChanges});
  }
  const seen=new Set();
  for(const c of changes){const key=JSON.stringify([c.sourceEntityId,c.kind,c.field,c.validFrom,c.validTo]);if(seen.has(key))invalid('Cross-entity duplicate logical E2 change key.');seen.add(key);}
  const selectedMonthEnd=comparisonMonth?temporalMonthEnd(comparisonMonth):null;
  const selectedChanges=selectedMonthEnd?changes.filter(row=>row.validFrom===null&&row.validTo===null
    ||temporalContains(row,selectedMonthEnd.canonical)):changes;
  return Object.freeze({schemaVersion:E3_DIFF_SCHEMA_VERSION,dataset:{repository:REVIEW_DATA_REPOSITORY,
      baseRevision,candidateRevision},comparisonMonth,
    totalChangedEntities:allChanged.length,indexChangedEntities:changed.length,
    scope:{batchIndex:batchIndex??1,batchCount,complete:batchCount===1},readObjects:readHashes,
    changes,issues,nonMapMetadata,selectedAtComparisonMonth:selectedChanges.length});
}
/** A candidate is pending even when source comparisons have no schema errors. */
export function createPendingRevisionReview(diff,{proposalId,createdAt,createdBy='automation',evidence}={}){
  if(!diff?.changes?.length||diff.issues.length)invalid('Cannot generate E2 proposal for empty, incomplete or ambiguous source differences.');
  if(!evidence||typeof evidence.reportPath!=='string'||!SHA.test(evidence.revision||''))
    invalid('A Git-revision-pinned report must be explicitly verified before proposing review.');
  return createReviewBundle({proposalId,createdAt,createdBy,dataset:diff.dataset,
    comparisonMonth:diff.comparisonMonth,supersedesProposalId:null,
    evidence:[{id:'research-evidence',reportPath:evidence.reportPath,revision:evidence.revision}],
    changes:diff.changes.map(row=>({...row,evidenceIds:['research-evidence']}))});
}
export function verificationSummary(diff,{codeRevision=null}={}){
  if(codeRevision!==null&&!SHA.test(codeRevision))invalid('Code evidence must pin one exact commit.');
  const kinds=new Set(diff.changes.map(c=>c.kind));
  const checks=[{name:'source-integrity',outcome:'passed'},{name:'temporal',outcome:diff.issues.length?'not-run':'passed'},
    {name:'schema',outcome:diff.issues.length?'not-run':'passed'}];
  if(kinds.has('geometry'))checks.push({name:'geometry-topology',outcome:'not-run'});
  if(kinds.has('parent'))checks.push({name:'parent-graph',outcome:'not-run'});
  const covered=diff.issues.length===0&&diff.indexChangedEntities===new Set(diff.readObjects.map(x=>x.sourceEntityId)).size;
  return Object.freeze({schemaVersion:1,kind:'e3-source-revision-verification',
    dataset:diff.dataset,comparisonMonth:diff.comparisonMonth,codeRevision,
    sourceHashCheck:'passed',changedEntities:diff.indexChangedEntities,
    totalChangedEntities:diff.totalChangedEntities,scope:diff.scope,
    modeledChanges:diff.changes.length,coverage:covered?(diff.scope.complete?'modeled':'scoped'):'partial',
    historicalAccuracy:'not-verified',checks,issues:diff.issues,
    note:'Git index/content hashes and C++ temporal/schema validation do not certify historical evidence or shared-border topology. No automated approval or application.'});
}
