import { normalizeReviewBundle, reviewState, indexReviewHistory, REVIEW_DATA_REPOSITORY }
  from "./review-change-records.js";

const sha = /^[0-9a-f]{40}$/, digest = /^[0-9a-f]{64}$/;
const types = Object.freeze({
  geometry:'국경·영토 형상', name:'국명', flag:'국기', parent:'상위 객체', lifetime:'존속기간',
});
const correctionKinds = Object.freeze(['geometry','date','attribute','source','other']);
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const sorted = (a,b) => a<b?-1:a>b?1:0;
const invalid = detail => {throw Object.assign(new TypeError(detail),{code:'PL-REVIEW-INSPECTION'});};

function dataIdentity(dataset) {
  if (!dataset || dataset.repository !== REVIEW_DATA_REPOSITORY
    || !sha.test(dataset.baseRevision || '') || !sha.test(dataset.candidateRevision || '')
    || dataset.baseRevision === dataset.candidateRevision)
    invalid('검수 자료의 원본/후보 데이터 SHA가 올바르지 않습니다.');
  return dataset;
}
export const reviewChangeTypeLabels = types;
export function reviewChangeKey(change) {
  return JSON.stringify([change.sourceEntityId,change.kind,change.field,change.validFrom,change.validTo]);
}
export function reviewValueText(kind,value) {
  if(value === null) return '해당 버전 없음';
  if(kind === 'geometry') return '형상 '+value.versionId+' · SHA-256 '+value.sha256;
  if(kind === 'flag') return '국기 이미지 SHA-256 '+value.sha256;
  if(kind === 'lifetime') return (value.validFrom??'시작 미정')+' ~ '+(value.validTo??'종료 없음');
  return String(value);
}
function validDiff(diff) {
  if (!diff || diff.schemaVersion!==1 || !Array.isArray(diff.changes)
    || !Array.isArray(diff.issues) || !Array.isArray(diff.readObjects)
    || !Number.isSafeInteger(diff.indexChangedEntities) || diff.indexChangedEntities<0
    || !Number.isSafeInteger(diff.selectedAtComparisonMonth)
    || diff.selectedAtComparisonMonth<0 || diff.selectedAtComparisonMonth>diff.changes.length)
    invalid('E3 변경 파일의 필수 정보가 누락됐습니다.');
  dataIdentity(diff.dataset);
  if(diff.comparisonMonth!==null && !/^\d{4}-\d{2}$/.test(diff.comparisonMonth||''))
    invalid('E3 비교 월은 정확한 YYYY-MM 또는 null이어야 합니다.');
  if(diff.scope && (!Number.isSafeInteger(diff.scope.batchIndex)||diff.scope.batchIndex<1
    || !Number.isSafeInteger(diff.scope.batchCount)||diff.scope.batchCount<diff.scope.batchIndex
    || typeof diff.scope.complete!=='boolean'))invalid('E3 배치 범위가 잘못됐습니다.');
  if(diff.scope && diff.scope.complete!== (diff.scope.batchCount===1))
    invalid('E3 배치 완료 표시가 비교 범위와 다릅니다.');
  if(diff.totalChangedEntities!==undefined && (!Number.isSafeInteger(diff.totalChangedEntities)
    || diff.totalChangedEntities<diff.indexChangedEntities))invalid('E3 전체 변경 객체 수가 잘못됐습니다.');
  const found=new Set();
  for(const row of diff.changes){
    if(!row || !/^state:[A-Za-z0-9_-]+$/.test(row.sourceEntityId||'')
      || !Object.hasOwn(types,row.kind)||typeof row.field!=='string'
      || !Object.hasOwn(row,'before') || !Object.hasOwn(row,'after')
      || !Object.hasOwn(row,'validFrom') || !Object.hasOwn(row,'validTo'))
      invalid('E3 변경 객체의 필드가 잘못됐습니다.');
    const key=reviewChangeKey(row);
    if(found.has(key))invalid('E3 변경 슬롯이 중복됐습니다.');
    found.add(key);
  }
  const receiptKeys=new Set();
  for(const row of diff.readObjects){
    const resource=row?.resource;
    if(!row||!/^state:[A-Za-z0-9_-]+$/.test(row.sourceEntityId||'')
      || !sha.test(row.revision||'') || !digest.test(row.sha256||'')
      || ![diff.dataset.baseRevision,diff.dataset.candidateRevision].includes(row.revision)
      ||!resource||typeof resource.url!=='string'||!/^[-A-Za-z0-9_./]+$/.test(resource.url)
      ||resource.url.startsWith('/')||resource.url.split('/').some(p=>!p||p==='.'||p==='..')
      ||!['identity','gzip'].includes(resource.encoding)||!digest.test(resource.sha256||'')
      ||![resource.compressedBytes,resource.decodedBytes].every(n=>Number.isSafeInteger(n)&&n>0&&n<=16*1024*1024))
      invalid('E3 원본 객체 참조가 올바르지 않습니다.');
    const versions=new Set();
    if(!Array.isArray(row.geometryResources))invalid('E3 좌표 자원 참조가 없습니다.');
    for(const geometry of row.geometryResources){
      const r=geometry?.resource;
      if(typeof geometry?.versionId!=='string'||!geometry.versionId||versions.has(geometry.versionId)||!digest.test(geometry.sha256||'')
        ||!r||typeof r.url!=='string'||!/^[-A-Za-z0-9_./]+$/.test(r.url)||r.url.startsWith('/')||r.url.split('/').some(p=>!p||p==='.'||p==='..')
        ||!['identity','gzip'].includes(r.encoding)||!digest.test(r.sha256||'')
        ||![r.compressedBytes,r.decodedBytes].every(n=>Number.isSafeInteger(n)&&n>0&&n<=16*1024*1024))invalid('E3 좌표 자원 참조가 올바르지 않습니다.');
      versions.add(geometry.versionId);
    }
    const key=row.sourceEntityId+':'+row.revision;
    if(receiptKeys.has(key))invalid('E3 원본 객체 참조가 중복됐습니다.');
    receiptKeys.add(key);
  }
  return diff;
}
function validVerification(verification,diff) {
  if(!verification) return null;
  if(verification.schemaVersion!==1 || verification.kind!=='e3-source-revision-verification'
    || verification.historicalAccuracy!=='not-verified'
    || verification.sourceHashCheck!=='passed' || !Array.isArray(verification.checks)
    || !Array.isArray(verification.issues) || verification.modeledChanges!==diff.changes.length
    || verification.changedEntities!==diff.indexChangedEntities
    || !same(verification.dataset,diff.dataset)
    || verification.comparisonMonth!==diff.comparisonMonth
    || !same(verification.issues,diff.issues)
    || (diff.scope && !same(verification.scope,diff.scope)))
    invalid('E3 검증 결과가 변경 파일과 일치하지 않습니다.');
  if(verification.coverage==='modeled' && diff.scope && !diff.scope.complete)
    invalid('부분 배치를 전체 검증 완료로 표시할 수 없습니다.');
  for(const check of verification.checks)
    if(!check || !['source-integrity','temporal','schema','geometry-topology','parent-graph'].includes(check.name)
      || !['passed','failed','not-run'].includes(check.outcome))
      invalid('E3 검증 상태가 올바르지 않습니다.');
  return verification;
}
function validProposal(proposal,diff) {
  if(!proposal)return null;
  const bundle=normalizeReviewBundle(proposal);
  if(!same(bundle.proposal.dataset,diff.dataset) || bundle.proposal.comparisonMonth!==diff.comparisonMonth
    || bundle.proposal.changes.length!==diff.changes.length)
    invalid('E2 제안과 E3 변경 파일의 데이터 버전 또는 변경 건수가 다릅니다.');
  const proposalRows=new Map(bundle.proposal.changes.map(x=>[reviewChangeKey(x),x]));
  for(const row of diff.changes){
    const reference=proposalRows.get(reviewChangeKey(row));
    if(!reference || !same(reference.before,row.before)||!same(reference.after,row.after))
      invalid('E2 제안의 수정 전후 내용이 E3 변경 원문과 일치하지 않습니다.');
  }
  return bundle;
}
/** Only typed local inputs. No API endpoint, app project mutation or implicit approval. */
export function inspectReviewEvidence({diff,proposal=null,verification=null,manifest=null}={}) {
  const normalizedDiff=validDiff(diff);
  const bundle=validProposal(proposal,normalizedDiff);
  const report=validVerification(verification,normalizedDiff);
  if(manifest && (manifest.schemaVersion!==1||manifest.kind!=='e3-generated-revision-evidence'
    || !same(manifest.dataset,normalizedDiff.dataset)
    || !Array.isArray(manifest.files)
    || manifest.proposalId!==(bundle?.proposal.proposalId??null)
    || (normalizedDiff.scope && !same(manifest.scope,normalizedDiff.scope))))
    invalid('E3 산출물 목록이 비교 자료와 일치하지 않습니다.');
  const rows=bundle?indexReviewHistory([bundle]):normalizedDiff.changes.map(x=>({
    ...x,proposalId:null,status:'pending',evidenceIds:[],
    baseRevision:normalizedDiff.dataset.baseRevision,candidateRevision:normalizedDiff.dataset.candidateRevision,
  }));
  const lookup=new Map();
  for(const row of rows){
    const list=lookup.get(row.sourceEntityId)||[];
    list.push(row);
    lookup.set(row.sourceEntityId,list);
  }
  const entities=[...lookup].sort(([a],[b])=>sorted(a,b)).map(([sourceEntityId,changes])=>Object.freeze({
    sourceEntityId,count:changes.length,changes:Object.freeze([...changes]),
    kinds:Object.freeze([...new Set(changes.map(x=>x.kind))].sort()),
  }));
  return Object.freeze({
    diff:normalizedDiff,proposal:bundle,verification:report,manifest,
    entities:Object.freeze(entities),
    state:bundle?reviewState(bundle):Object.freeze({status:'pending',proposalId:null,validation:null}),
  });
}
export function reviewObjectMapRef(project,sourceEntityId) {
  if(!/^state:[A-Za-z0-9_-]+$/.test(sourceEntityId||''))return null;
  const entities=project?.territorialEntities;
  if(!Array.isArray(entities))return null;
  const matched=entities.filter(row=>row?.id===sourceEntityId
    || row?.properties?.sourceEntityId===sourceEntityId);
  if(matched.length!==1)return null;
  return Object.freeze({domain:'territorial',type:'entity',id:matched[0].id});
}
export function reviewEvidenceUrl(ref) {
  if(!ref||!sha.test(ref.revision||'')||typeof ref.reportPath!=='string'
    || !/^reports\/(?:borders|development|hydro|places|terrain|map-analysis)\/[A-Za-z0-9_./-]+\.(md|json)$/.test(ref.reportPath)
    || ref.reportPath.split('/').some(x=>x==='..'||x==='.'||!x))
    invalid('보고서 링크의 리비전 또는 경로가 유효하지 않습니다.');
  return 'https://github.com/kimjeon-il/PandoLab-library-data/blob/'+ref.revision+'/'+ref.reportPath;
}
export function correctionRequest({inspection,sourceEntityId,change,kind,reason,createdAt}={}) {
  if(!inspection?.diff||!inspection.entities.some(x=>x.sourceEntityId===sourceEntityId))
    invalid('오류 요청 대상이 검수 자료에 없습니다.');
  if(!correctionKinds.includes(kind))invalid('오류 유형을 선택해야 합니다.');
  if(typeof reason!=='string'||reason.trim().length<8||reason.trim().length>3000)
    invalid('수정 요청 이유를 8~3000자로 작성해야 합니다.');
  if(typeof createdAt!=='string'||Number.isNaN(Date.parse(createdAt))
    ||new Date(createdAt).toISOString()!==createdAt)invalid('오류 요청 생성 시각이 올바르지 않습니다.');
  const entry=inspection.diff.changes.find(row=>row.sourceEntityId===sourceEntityId
    &&reviewChangeKey(row)===reviewChangeKey(change));
  if(!entry)invalid('요청한 변경 항목을 원본 데이터에서 찾을 수 없습니다.');
  return Object.freeze({
    schemaVersion:1,kind:'pandolab-review-correction-draft',status:'local-draft',
    createdAt,proposalId:inspection.proposal?.proposal.proposalId??null,
    dataset:Object.freeze({...inspection.diff.dataset}),sourceEntityId,
    issueKind:kind,change:Object.freeze({
      kind:entry.kind,field:entry.field,validFrom:entry.validFrom,validTo:entry.validTo,
    }),reason:reason.trim(),
    notice:'Local correction request only. Not an E2 review event, GitHub issue, approval or data modification.',
  });
}

/** The whole selected source entity is backed by these immutable report records. */
export function reviewEvidenceForObject(inspection,sourceEntityId){
  const bundle=inspection?.proposal;
  if(!bundle)return Object.freeze([]);
  const ids=new Set(bundle.proposal.changes.filter(x=>x.sourceEntityId===sourceEntityId)
    .flatMap(x=>x.evidenceIds));
  return Object.freeze(bundle.proposal.evidence.filter(x=>ids.has(x.id)));
}
