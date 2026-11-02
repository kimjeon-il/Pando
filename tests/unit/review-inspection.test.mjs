import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash,webcrypto} from 'node:crypto';
import {
  inspectReviewEvidence,reviewObjectMapRef,reviewValueText,reviewEvidenceUrl,
  reviewChangeKey,correctionRequest,reviewEvidenceForObject,
} from '../../shared/frontend/js/modules/review-inspection.js';
import {readReviewEvidenceFiles} from '../../shared/frontend/js/modules/review-evidence-files.js';
import {appendReviewEvent} from '../../shared/frontend/js/modules/review-change-records.js';
import {buildReviewPreviewPaths} from '../../apps/viewer/js/modules/viewer-review-panel.js';

const source=()=>JSON.parse(readFileSync(new URL('../fixtures/review/e2-synthetic-review.json',import.meta.url),'utf8'));
const sha=value=>createHash('sha256').update(value).digest('hex');
function filesModel(){
  const bundle=source(),diff={
    schemaVersion:1,dataset:structuredClone(bundle.proposal.dataset),
    comparisonMonth:bundle.proposal.comparisonMonth,
    indexChangedEntities:2,totalChangedEntities:2,
    scope:{batchIndex:1,batchCount:1,complete:true},
    selectedAtComparisonMonth:5,issues:[],nonMapMetadata:[],readObjects:[],
    changes:bundle.proposal.changes.map(({evidenceIds,...change})=>change),
  };
  const verification={schemaVersion:1,kind:'e3-source-revision-verification',
    dataset:structuredClone(diff.dataset),comparisonMonth:diff.comparisonMonth,codeRevision:'f'.repeat(40),
    sourceHashCheck:'passed',changedEntities:2,totalChangedEntities:2,
    scope:structuredClone(diff.scope),modeledChanges:diff.changes.length,
    coverage:'modeled',historicalAccuracy:'not-verified',
    issues:[],checks:[{name:'source-integrity',outcome:'passed'},
      {name:'temporal',outcome:'passed'},{name:'schema',outcome:'passed'},
      {name:'geometry-topology',outcome:'not-run'},{name:'parent-graph',outcome:'not-run'}],
    note:'Original geometry not automatically verified.',
  };
  return {bundle,diff,verification};
}
function mockFile(name,value) {
  const raw=Buffer.from(JSON.stringify(value,null,2)+'\n');
  return {name,size:raw.length,raw,async arrayBuffer(){return raw;}};
}
function completeFiles(){
  const {bundle,diff,verification}=filesModel();
  const files=[mockFile('e3-source-diff.json',diff),mockFile('e3-verification.json',verification),
    mockFile('e3-pending-proposal.json',bundle)];
  const manifest={schemaVersion:1,kind:'e3-generated-revision-evidence',
    dataset:structuredClone(diff.dataset),scope:structuredClone(diff.scope),
    proposalId:bundle.proposal.proposalId,
    files:files.map(x=>({name:x.name,sha256:sha(x.raw),bytes:x.size}))};
  return [...files,mockFile('e3-output-manifest.json',manifest)];
}
const invalid=(fn,pattern)=>assert.throws(fn,err=>err?.code==='PL-REVIEW-INSPECTION'
  &&pattern.test(err.message));

test('E4 inspects matching E2/E3 proposal, scoped diff, unverified checks and source links',()=>{
  const {bundle,diff,verification}=filesModel();
  const sourceBefore=structuredClone(bundle),diffBefore=structuredClone(diff);
  const inspection=inspectReviewEvidence({proposal:bundle,diff,verification});
  assert.equal(inspection.entities.length,2);
  assert.equal(inspection.state.status,'pending');
  assert.equal(inspection.diff.changes.length,5);
  assert.equal(inspection.verification.checks.at(-1).outcome,'not-run');
  assert.equal(inspection.entities[0].sourceEntityId,'state:EXAMPLE_A');
  assert.equal(inspection.entities[0].count,4);
  assert.deepEqual(bundle,sourceBefore);
  assert.deepEqual(diff,diffBefore);
  assert.match(reviewValueText('geometry',diff.changes[0].before),/SHA-256/);
  assert.match(reviewValueText('lifetime',diff.changes[4].after),/1914-07/);
  assert.equal(reviewValueText('flag',null),'해당 버전 없음');
  assert.deepEqual(reviewEvidenceForObject(inspection,'state:EXAMPLE_A').map(x=>x.id),
    ['research-map','research-meta']);
  assert.deepEqual(reviewEvidenceForObject(inspection,'state:EXAMPLE_B').map(x=>x.id),['research-meta']);
  const url=reviewEvidenceUrl(bundle.proposal.evidence[0]);
  assert.equal(url,'https://github.com/kimjeon-il/PandoLab-library-data/blob/'
    +'c'.repeat(40)+'/reports/borders/reconstruction/synthetic-1914-boundary.md');
});

test('E4 rejects forged change content, mismatched SHA, badge status and dishonest coverage',()=>{
  const valid=filesModel(),version=structuredClone(valid.bundle);
  version.proposal.dataset.candidateRevision='9'.repeat(40);
  invalid(()=>inspectReviewEvidence({proposal:version,diff:valid.diff,verification:valid.verification}),/버전/);
  const mismatch=structuredClone(valid.bundle);
  mismatch.proposal.changes[0].after.sha256='0'.repeat(64);
  invalid(()=>inspectReviewEvidence({proposal:mismatch,diff:valid.diff}),/일치하지/);
  const tooFew=structuredClone(valid.bundle);tooFew.proposal.changes.pop();
  invalid(()=>inspectReviewEvidence({proposal:tooFew,diff:valid.diff}),/건수/);
  const badVerification=structuredClone(valid.verification);badVerification.historicalAccuracy='verified';
  invalid(()=>inspectReviewEvidence({proposal:valid.bundle,diff:valid.diff,verification:badVerification}),/검증/);
  const partial=structuredClone(valid.diff);partial.scope={batchIndex:1,batchCount:3,complete:false};
  const forged=structuredClone(valid.verification);forged.scope=structuredClone(partial.scope);
  invalid(()=>inspectReviewEvidence({diff:partial,verification:forged}),/배치/);
  const duplicate=structuredClone(valid.diff);duplicate.changes.push(duplicate.changes[0]);
  invalid(()=>inspectReviewEvidence({diff:duplicate}),/중복/);
  const badRef=structuredClone(valid.bundle.proposal.evidence[0]);
  badRef.reportPath='reports/borders/../../../fake.md';
  invalid(()=>reviewEvidenceUrl(badRef),/링크/);
});

test('E4 distinguishes a matching source identity from a project instance ID',()=>{
  const entity={id:'random-instance-1',properties:{sourceEntityId:'state:EXAMPLE_A'}};
  const project={territorialEntities:[entity]};
  assert.deepEqual(reviewObjectMapRef(project,'state:EXAMPLE_A'),
    {domain:'territorial',type:'entity',id:'random-instance-1'});
  assert.equal(reviewObjectMapRef(project,'state:EXAMPLE_B'),null);
  assert.equal(reviewObjectMapRef({territorialEntities:[entity,structuredClone(entity)]},'state:EXAMPLE_A'),null);
  assert.deepEqual(reviewObjectMapRef({territorialEntities:[{id:'state:EXAMPLE_A'}]},'state:EXAMPLE_A'),
    {domain:'territorial',type:'entity',id:'state:EXAMPLE_A'});
});

test('E4 exports only a bounded local correction draft, not an E2 approval event',()=>{
  const inspection=inspectReviewEvidence({...filesModel(),proposal:filesModel().bundle});
  const change=inspection.diff.changes[0];
  const before=structuredClone(inspection.diff);
  const request=correctionRequest({inspection,sourceEntityId:change.sourceEntityId,change,
    kind:'date',reason:'2008년 조약 효력일과 도형 구간이 맞지 않는지 재검증 필요',
    createdAt:'2026-11-02T02:00:00.000Z'});
  assert.equal(request.status,'local-draft');
  assert.equal(request.kind,'pandolab-review-correction-draft');
  assert.equal(request.proposalId,inspection.proposal.proposal.proposalId);
  assert.equal(request.change.validFrom,change.validFrom);
  assert.equal(request.issueKind,'date');
  assert.equal(request.dataset.baseRevision,inspection.diff.dataset.baseRevision);
  assert.equal(Object.hasOwn(request,'events'),false);
  assert.deepEqual(inspection.diff,before);
  invalid(()=>correctionRequest({inspection,sourceEntityId:change.sourceEntityId,change,
    kind:'date',reason:'short',createdAt:'2026-11-02T02:00:00.000Z'}),/8/);
  invalid(()=>correctionRequest({inspection,sourceEntityId:'state:NOT_IN_DIFF',change,
    kind:'date',reason:'충분히 구체적인 변경 요청',createdAt:'2026-11-02T02:00:00.000Z'}),/대상/);
  assert.equal(reviewChangeKey(change),JSON.stringify([
    change.sourceEntityId,change.kind,change.field,change.validFrom,change.validTo]));
});

test('E4 treats sidecar approval as unverified recorded status, never a GitHub authorization',()=>{
  const m=filesModel();
  const v={eventId:'ci-1',type:'validated',at:'2026-11-02T02:00:00.000Z',
    actor:{kind:'ci',id:'runner'},codeRevision:'a'.repeat(40),
    reportPath:'reports/development/ui/test/verification.json',
    checks:m.verification.checks.filter(x=>x.name!=='geometry-topology'&&x.name!=='parent-graph')
      .concat([{name:'geometry-topology',outcome:'passed'},{name:'parent-graph',outcome:'passed'}])};
  m.bundle=appendReviewEvent(m.bundle,v);
  m.bundle=appendReviewEvent(m.bundle,{eventId:'human-1',type:'approved',
    at:'2026-11-02T02:01:00.000Z',actor:{kind:'human',id:'u-1'}});
  assert.equal(inspectReviewEvidence({proposal:m.bundle,diff:m.diff,verification:m.verification}).state.status,'approved');
  assert.equal(m.verification.checks.find(x=>x.name==='geometry-topology').outcome,'not-run');
});

test('E4 verifies all manifest file bytes, rejects mismatches and imports atomically',async()=>{
  const files=completeFiles();
  const imported=await readReviewEvidenceFiles(files,{subtle:webcrypto.subtle});
  assert.equal(imported.checksumVerified,true);
  assert.equal(imported.inspection.entities.length,2);
  const without=await readReviewEvidenceFiles(files.slice(0,3),{subtle:webcrypto.subtle});
  assert.equal(without.checksumVerified,false);
  const altered=completeFiles();altered[0]=mockFile(altered[0].name,{...JSON.parse(altered[0].raw),comparisonMonth:'1914-08'});
  await assert.rejects(readReviewEvidenceFiles(altered,{subtle:webcrypto.subtle}),/SHA-256/);
  await assert.rejects(readReviewEvidenceFiles([...files,files[0]],{subtle:webcrypto.subtle}),/1~4/);
  const absent=completeFiles().filter(x=>x.name!=='e3-pending-proposal.json');
  await assert.rejects(readReviewEvidenceFiles(absent,{subtle:webcrypto.subtle}),/누락/);
  await assert.rejects(readReviewEvidenceFiles([mockFile('evil.json',{hi:true})],
    {subtle:webcrypto.subtle}),/지원하지/);
});


test('E4 before-after previews have one frame even across the antimeridian and require no D3',()=>{
  const old={type:'Polygon',coordinates:[[[179,10],[-179,10],[-179,11],[179,11],[179,10]]]};
  const next={type:'Polygon',coordinates:[[[179,10],[-178,10],[-178,11],[179,11],[179,10]]]};
  const paths=buildReviewPreviewPaths({before:old,after:next});
  assert.ok(paths.before.startsWith('M'));
  assert.ok(paths.after.startsWith('M'));
  assert.notEqual(paths.before,paths.after);
  const oldXs=Array.from(paths.before.matchAll(/(?:M|L)(\d+\.\d+) /g),x=>Number(x[1]));
  assert.equal(oldXs.length,5);
  assert.ok(oldXs.every(x=>x>=10&&x<=310));
  assert.ok(Math.max(...oldXs)-Math.min(...oldXs)<296);
  assert.ok(Object.isFrozen(paths));
  assert.equal(buildReviewPreviewPaths({before:null,after:next}).before,null);
  assert.throws(()=>buildReviewPreviewPaths({before:null,after:null}),/표시할/);
  assert.throws(()=>buildReviewPreviewPaths({before:{...old,coordinates:[[[179,110],[1,110],[2,120],[179,110]]]},after:next}),/경위도/);
});

test('E4 review owner uses only declared template controls, including correction type',()=>{
  const owner=readFileSync(new URL('../../apps/viewer/js/modules/viewer-review-panel.js',import.meta.url),'utf8');
  const html=readFileSync(new URL('../../apps/viewer/templates/index.html',import.meta.url),'utf8');
  const refs=[...owner.matchAll(/\bget\('([^']+)'\)/g)].map(x=>x[1])
    .filter(x=>x.startsWith('review')||x==='mobileReviewBtn');
  assert.ok(refs.length>20,'E4 DOM integration check must cover the real panel');
  for(const id of new Set(refs))assert.ok(html.includes('id="'+id+'"'),'missing review control: '+id);
  assert.match(owner,/get\('reviewIssueKind'\)/);
});
