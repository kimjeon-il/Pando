/** Sourced, ID-exact GeoNames review policies. Review never approves an inferred city. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { candidate, validateRecord, validateCandidates, sourceRows, REVIEW_ACTIONS } from './geonames-policy.mjs';

const JSON_FILE=path=>JSON.parse(readFileSync(path,'utf8'));
const WRITE=(path,value)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify(value,null,2)+'\n');};
const toMap=x=>x instanceof Map?x:new Map(Object.entries(x||{}).map(([k,v])=>[Number(k),v]));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const count=(list,key)=>{const map=new Map();for(const x of list){const k=key(x);map.set(k,(map.get(k)||0)+1);}return map;};
const ordered=x=>Object.fromEntries([...x].sort(([a],[b])=>String(a).localeCompare(String(b),'en')));
const value=x=>Array.isArray(x)?'['+x.map(y=>typeof y==='string'?JSON.stringify(y):String(y)).join(', ')+']':String(x);
export function table(headers,rows){
  const cell=x=>value(x).replace(/\|/g,'\\|').replace(/\n/g,' ');
  return ['| '+headers.map(cell).join(' | ')+' |',
    '| '+headers.map(()=>'---').join(' | ')+' |',
    ...[...rows].map(row=>'| '+row.map(cell).join(' | ')+' |')].join('\n');
}
export function applyReviewOverrides(reviews,overrides) {
  if(overrides==null)return reviews;
  if(overrides.version!==1)throw Error('Unsupported candidate review override version');
  if(overrides.sourceSha256!==reviews.source?.sha256)
    throw Error('Review override source snapshot changed; re-review required');
  if(!Array.isArray(overrides.overrides))throw Error('Review overrides must be a list');
  const merged=structuredClone(reviews),decisions=new Map((merged.decisions||[]).map(v=>[v.geonameId,v])),seen=new Set();
  for(const override of overrides.overrides){
    const id=override?.geonameId;
    if(!Number.isSafeInteger(id)||id<=0)throw Error('Invalid override ID '+id);
    if(seen.has(id))throw Error('duplicate override ID '+id);
    seen.add(id);
    const decision=decisions.get(id);
    if(!decision)throw Error('unknown review ID '+id);
    if(!REVIEW_ACTIONS.has(override.action))throw Error('Review override '+id+': unknown action '+override.action);
    const reason=override.reasonAppend??'';
    if(reason&&(typeof reason!=='string'||!reason.trim()))
      throw Error('Review override '+id+': invalid reasonAppend');
    const ref=override.coordinateCorrectionRef;
    if(ref!=null&&(typeof ref!=='string'||!ref.startsWith('reports/places/coordinate-corrections.json#')))
      throw Error('Review override '+id+': invalid coordinateCorrectionRef');
    decision.action=override.action;
    if(reason)decision.reason=decision.reason.trimEnd()+' '+reason.trim();
    if(ref!=null)decision.coordinateCorrectionRef=ref;
  }
  return merged;
}
export function refineCandidates(rows,sourceRecords,reviews) {
  validateCandidates(rows);
  if(reviews?.version!==1)throw Error('Unsupported candidate review version');
  const sources=reviews.evidenceSources||{};
  if(!sources||typeof sources!=='object'||Array.isArray(sources))
    throw Error('Review evidenceSources must be an object');
  for(const [key,source] of Object.entries(sources)){
    if(!['url','publisher','checkedAt','finding','access'].every(x=>typeof source?.[x]==='string'&&source[x].trim()))
      throw Error('Evidence '+key+': missing source provenance');
    if(!source.url.startsWith('https://'))throw Error('Evidence '+key+': expected an HTTPS source URL');
  }
  if(!Array.isArray(reviews.decisions))throw Error('Review decisions must be a list');
  const baseline=new Map(rows.map(row=>[row.geonameId,row])),raw=toMap(sourceRecords);
  const seen=new Set(),removed=new Set(),reviewed=[];
  for(const decision of reviews.decisions){
    const id=decision?.geonameId;
    if(!Number.isSafeInteger(id)||id<=0||seen.has(id))throw Error('Invalid or duplicate review ID '+id);
    seen.add(id);
    const row=raw.get(id);
    if(!row)throw Error('Review '+id+': missing source record');
    validateRecord(row,'review '+id);
    const expected=decision.expected||{};
    const required=['name','countryCode','featureCode','latitude','longitude'];
    if(required.some(field=>!Object.hasOwn(expected,field)||!same(row[field],expected[field])))
      throw Error('Review '+id+': source identity changed; re-review required');
    if(!REVIEW_ACTIONS.has(decision.action))throw Error('Review '+id+': unknown action '+decision.action);
    const evidence=decision.evidence||[];
    if(!Array.isArray(evidence)||!evidence.length||new Set(evidence).size!==evidence.length||
       evidence.some(key=>!Object.hasOwn(sources,key)))throw Error('Review '+id+': missing or unknown evidence');
    if(typeof decision.reason!=='string'||!decision.reason.trim())throw Error('Review '+id+': missing reason');
    const inBaseline=baseline.has(id),derived=candidate(row);
    if(!same(derived,baseline.get(id)||null))throw Error('Review '+id+': baseline/source mismatch');
    if(decision.action==='retain'&&!inBaseline)throw Error('Review '+id+': retain cannot promote an excluded record');
    if(decision.action==='inclusion-review'&&inBaseline)
      throw Error('Review '+id+': inclusion-review requires an excluded record');
    if(['exclude','hold'].includes(decision.action)&&inBaseline)removed.add(id);
    reviewed.push({record:{...row},action:decision.action,inBaseline,
      reason:decision.reason,evidence:[...evidence]});
  }
  return [rows.filter(row=>!removed.has(row.geonameId)).map(row=>({...row})).sort((a,b)=>a.geonameId-b.geonameId),
    reviewed.sort((a,b)=>a.record.geonameId-b.record.geonameId)];
}
const hashFile=async path=>{
  const hash=createHash('sha256');for await(const data of createReadStream(path))hash.update(data);
  return hash.digest('hex');
};
export function renderReviews(stats) {
  const actions=[...REVIEW_ACTIONS].sort();
  const changed=Object.entries(stats.changedCountries);
  const part=[
    '## 재생성 가능한 ID별 검토 결과','',
    '검토 원본: \x60'+stats.source.name+'\x60 / SHA-256 \x60'+stats.source.sha256+'\x60.','',
    table(['항목','건수'],[['1차 후보 (변경 없음)',stats.baselineCount],
      ['누적 ID별 검토',stats.reviewCount],['후보에서 확인 제외',stats.baselineExcludes],
      ['후보에서 임시 보류',stats.baselineHolds],['별도 정제 후보',stats.refinedCount],
      ['정제본 내 미검토',stats.unreviewedCount]]),'',
    '정제본은 전 세계 검증 완료 목록이 아니다. 미검토 기록은 원래 후보 그대로 남는다.',
    '\x60inclusion-review\x60는 필터 밖의 재검토 제안이며 정제본에 추가하지 않는다.','',
    table(['country','baseline','refined','excluded','held'],changed.map(([code,counts])=>[
      code,counts.baseline,counts.refined,counts.excluded,counts.held])),'',
    '### ID별 판정 근거 보존','',
    '개별 ID별 판정표는 Markdown에 중복 기재하지 않는다. 원본 ID·판정·근거와 증거 출처는 \x60candidate-review-summary.json\x60의 \x60reviewedRecords\x60/\x60evidenceSources\x60 및 \x60candidate-reviews.json\x60에 보존한다.','',
    table(['판정','검토 ID'],actions.map(action=>[action,stats.actions[action]||0])),'',
    '증거 출처 수: '+Object.keys(stats.evidenceSources).length+'개. 개별 URL·접근일·판정에 쓴 사실은 JSON에 보존한다.','',
    '검토 원장 SHA-256: \x60'+stats.reviewLedgerSha256+'\x60.','',
    '정제 파일: \x60.cache/'+stats.refinedArtifact.path+'\x60, SHA-256 \x60'+stats.refinedArtifact.sha256+'\x60.',''
  ];
  return part.join('\n');
}
export async function review(cache,reviewsPath,statsPath,reportPath,overridesPath=null){
  let reviews=JSON_FILE(reviewsPath);
  if(overridesPath)reviews=applyReviewOverrides(reviews,JSON_FILE(overridesPath));
  const source=reviews.source,meta=JSON_FILE(join(cache,source.name+'.source.json'));
  if(meta.sha256!==source.sha256)throw Error('Review source snapshot changed; re-review required');
  const targetIDs=new Set(reviews.decisions.map(d=>d.geonameId)),rows=[],sourceRecords=new Map();
  for await(const [,line] of sourceRows(source.name,cache)){
    const [row]=parseRowForReview(line);
    const included=candidate(row);
    if(included)rows.push(included);
    if(targetIDs.has(row.geonameId)){
      if(sourceRecords.has(row.geonameId))throw Error('Duplicate source review ID '+row.geonameId);
      sourceRecords.set(row.geonameId,row);
    }
  }
  const [refined,reviewed]=refineCandidates(rows,sourceRecords,reviews);
  const baseline=count(rows,r=>r.countryCode), after=count(refined,r=>r.countryCode),
    excluded=count(reviewed.filter(x=>x.inBaseline&&x.action==='exclude'),x=>x.record.countryCode),
    held=count(reviewed.filter(x=>x.inBaseline&&x.action==='hold'),x=>x.record.countryCode);
  const content=readFileSync(reportPath,'utf8');
  if(content.split('<!-- geonames-statistics:start -->').length!==2||
     content.split('<!-- geonames-statistics:end -->').length!==2)
    throw Error('Review report requires exactly one generated statistics marker pair');
  const artifact=join(cache,'refined-candidates.ndjson');
  writeFileSync(artifact,refined.map(r=>JSON.stringify(r)).join('\n')+(refined.length?'\n':''));
  const changedCountries={};
  for(const code of new Set([...excluded.keys(),...held.keys()])){
    changedCountries[code]={baseline:baseline.get(code)||0,refined:after.get(code)||0,
      excluded:excluded.get(code)||0,held:held.get(code)||0};
  }
  const stats={source,reviewLedgerSha256:await hashFile(reviewsPath),
    reviewOverridesSha256:overridesPath?await hashFile(overridesPath):null,
    baselineCount:rows.length,reviewCount:reviewed.length,refinedCount:refined.length,
    baselineExcludes:[...excluded.values()].reduce((a,b)=>a+b,0),
    baselineHolds:[...held.values()].reduce((a,b)=>a+b,0),
    actions:ordered(count(reviewed,r=>r.action)),
    unreviewedCount:refined.length-reviewed.filter(x=>x.inBaseline&&x.action==='retain').length,
    changedCountries:ordered(new Map(Object.entries(changedCountries))),
    evidenceSources:reviews.evidenceSources,reviewedRecords:reviewed,
    refinedArtifact:{path:'refined-candidates.ndjson',rows:refined.length,
      sha256:await hashFile(artifact),bytes:readFileSync(artifact).length}};
  WRITE(statsPath,stats);
  const start='<!-- geonames-statistics:start -->',end='<!-- geonames-statistics:end -->';
  const [before,rest]=content.split(start),after=rest.split(end)[1];
  writeFileSync(reportPath,before+start+'\n\n'+renderReviews(stats)+'\n'+end+after);
  return stats;
}
function parseRowForReview(line) {
  return parseRow(line);
}
import { parseRow } from './geonames-policy.mjs';
