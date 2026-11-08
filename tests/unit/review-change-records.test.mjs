import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeTemporalInterval } from "../../src/document/temporal.js";
import {
  REVIEW_BUNDLE_SCHEMA_VERSION, REVIEW_DATA_REPOSITORY,
  createReviewBundle, normalizeReviewBundle, appendReviewEvent, reviewState,
  serializeReviewBundle, indexReviewHistory,
} from "../../src/document/review-change-records.js";

const fixture = () => JSON.parse(readFileSync(new URL('../fixtures/review/e2-synthetic-review.json', import.meta.url), 'utf8'));
const validation = (overrides = {}) => ({
  eventId: 'validation-001', type: 'validated', at: '2026-11-02T01:01:00.000Z',
  actor: {kind:'ci', id:'github-actions'},
  checks: ['schema','temporal','source-integrity','geometry-topology','parent-graph']
    .map(name => ({ name, outcome:'passed' })),
  codeRevision:'d'.repeat(40),
  reportPath:'reports/development/ui/review-records/synthetic-checks.json',
  ...overrides,
});
const decision = (type, overrides = {}) => ({
  eventId:type+'-001',type,at:'2026-11-02T01:02:00.000Z',
  actor:{kind:'human',id:'reviewer-fixture'},...overrides,
});
const adoption = (overrides = {}) => ({
  eventId:'applied-001', type:'applied', at:'2026-11-02T01:03:00.000Z',
  actor:{kind:'ci',id:'github-actions'},
  appliedRevision:'e'.repeat(40),
  reportPath:'reports/development/ui/review-records/synthetic-adoption.json',
  ...overrides,
});
const invalid = (value, pattern, code='PL-REVIEW-SCHEMA') =>
  assert.throws(()=>normalizeReviewBundle(value), error => error?.code===code && pattern.test(error.message),
    'Expected '+code+': '+pattern);
const check = (mutation,pattern,code) => {const input=fixture();mutation(input);invalid(input,pattern,code);};

test('E2 canonical fixture is a standalone, deeply frozen, non-mutating review sidecar',()=>{
  const source=fixture(),original=structuredClone(source);
  const bundle=createReviewBundle(source.proposal);
  assert.deepEqual(source,original);
  assert.deepEqual(bundle,normalizeReviewBundle(source));
  assert.equal(bundle.schemaVersion,REVIEW_BUNDLE_SCHEMA_VERSION);
  assert.equal(bundle.proposal.dataset.repository,REVIEW_DATA_REPOSITORY);
  assert.equal(reviewState(bundle).status,'pending');
  assert.equal(bundle.proposal.changes.length,5);
  assert.equal(bundle.proposal.changes[0].validFrom,'1914-07-15');
  assert.equal(bundle.proposal.changes[0].validTo,'1914-08');
  assert.ok(Object.isFrozen(bundle));
  assert.ok(Object.isFrozen(bundle.proposal.changes[0].before));
  assert.ok(Object.isFrozen(bundle.proposal.dataset));
  assert.notEqual(bundle.proposal,source.proposal);
  source.proposal.changes[0].after.versionId='mutated';
  assert.equal(bundle.proposal.changes[0].after.versionId,'new-version');
  assert.deepEqual(normalizeReviewBundle(JSON.parse(serializeReviewBundle(bundle))),bundle);
});

test('E2 separate historical precision uses the existing Core temporal owner',()=>{
  const source=fixture(),b=normalizeReviewBundle(source);
  assert.equal(b.proposal.comparisonMonth,'1914-07');
  assert.deepEqual(normalizeTemporalInterval('1914-07','1915-02').validFrom,'1914-07');
  assert.deepEqual(b.proposal.changes.at(-1).after,{validFrom:'1914-07',validTo:null});
  check(x=>{x.proposal.comparisonMonth='1914-07-31';},/month/);
  check(x=>{x.proposal.changes[0].validFrom='1914-02-30';},/날짜|invalid/i);
  check(x=>{x.proposal.changes[0].validFrom='1915';x.proposal.changes[0].validTo='1914';},/interval|valid|종료|날짜|range|before|start/i);
  check(x=>{x.proposal.changes[0].validFrom=undefined;},/temporal|validFrom/i);
  check(x=>{x.proposal.comparisonMonth=undefined;},/month|null/i);
});

test('E2 review captures source entities and immutable version/hash pointers, never geometry bytes',()=>{
  const b=normalizeReviewBundle(fixture()),[geometry]=b.proposal.changes;
  assert.equal(geometry.sourceEntityId,'state:EXAMPLE_A');
  assert.deepEqual(Object.keys(geometry.before),['versionId','sha256']);
  assert.equal(geometry.after.sha256,'e'.repeat(64));
  assert.equal(b.proposal.changes[2].after.sha256,'f'.repeat(64));
  check(x=>{x.proposal.changes[0].sourceEntityId='A';},/external catalog/);
  check(x=>{x.proposal.changes[0].after.coordinates=[1,2];},/unsupported/);
  check(x=>{x.proposal.changes[2].after='data:image/svg+xml;base64,AAAA';},/plain object/);
  check(x=>{x.proposal.changes[0].after.sha256='0x123';},/SHA-256/);
  check(x=>{x.proposal.changes[1].field='names.ko.nickname';},/formal/);
  check(x=>{x.proposal.changes[1].after='이전 정식 명칭';},/difference/);
  check(x=>{x.proposal.changes[0].before=x.proposal.changes[0].after;},/difference/);
});

test('E2 evidence paths and independent report SHA must resolve by explicit identity',()=>{
  const b=normalizeReviewBundle(fixture());
  assert.equal(b.proposal.evidence[0].reportPath,'reports/borders/reconstruction/synthetic-1914-boundary.md');
  check(x=>{x.proposal.evidence[0].reportPath='../../.git/config.md';},/Evidence/);
  check(x=>{x.proposal.evidence[0].reportPath='reports/development/ui/../bad.json';},/Evidence/);
  check(x=>{x.proposal.evidence[0].reportPath='reports/development/ui/payload.svg';},/Evidence/);
  check(x=>{x.proposal.evidence[0].revision='current';},/40-character/);
  check(x=>{x.proposal.changes[0].evidenceIds=['missing'];},/unknown evidence/);
  check(x=>{x.proposal.changes[0].evidenceIds=['research-map','research-map'];},/duplicate/);
  check(x=>{x.proposal.evidence.push({...x.proposal.evidence[0]});},/duplicate/);
  check(x=>{x.proposal.dataset.candidateRevision=x.proposal.dataset.baseRevision;},/distinct/);
  check(x=>{x.proposal.dataset.repository='other/repo';},/external library/);
});

test('E2 unknown wire fields, duplicate change slots, and malformed UTC timestamps fail closed',()=>{
  check(x=>{x.editorUndoStack=[];},/unsupported/);
  check(x=>{x.proposal.projectSchemaVersion=14;},/unsupported/);
  check(x=>{x.proposal.changes[0].editorObjectId='random-instance';},/unsupported/);
  check(x=>{x.proposal.changes.push({...x.proposal.changes[0]});},/duplicate/);
  check(x=>{x.proposal.createdAt='2026-02-30T01:00:00.000Z';},/UTC/);
  check(x=>{x.proposal.createdAt='2026-11-02T10:00:00+09:00';},/UTC/);
  check(x=>{x.proposal.supersedesProposalId=x.proposal.proposalId;},/supersede/);
  check(x=>{x.proposal.evidence[0].reportPath='reports/development/ui/%2e%2e/escape.json';},/Evidence/);
});

test('E2 validation, human approval, and independent application form an immutable audit chain',()=>{
  let b=createReviewBundle(fixture().proposal);
  b=appendReviewEvent(b,validation());
  assert.equal(reviewState(b).status,'validated');
  const snapshot=b, before=serializeReviewBundle(b);
  b=appendReviewEvent(b,decision('approved'));
  assert.equal(reviewState(b).status,'approved');
  assert.equal(serializeReviewBundle(snapshot),before);
  b=appendReviewEvent(b,adoption());
  assert.deepEqual({status:reviewState(b).status,appliedRevision:reviewState(b).appliedRevision},
    {status:'applied',appliedRevision:'e'.repeat(40)});
  assert.equal(b.events.length,3);
  assert.ok(b.events.every(Object.isFrozen));
  assert.equal(b.proposal.createdBy,'ai');
  const automatic=structuredClone(fixture());automatic.proposal.createdBy='automation';
  assert.equal(normalizeReviewBundle(automatic).proposal.createdBy,'automation');
  check(x=>{x.proposal.createdBy='anonymous';},/creator/);
  assert.deepEqual(fixture().events,[]);
  assert.deepEqual(normalizeReviewBundle(JSON.parse(serializeReviewBundle(b))),b);
});

test('E2 an unverified or failed proposal cannot be approved, applied or claimed as published',()=>{
  const initial=createReviewBundle(fixture().proposal);
  assert.throws(()=>appendReviewEvent(initial,decision('approved')),{code:'PL-REVIEW-TRANSITION'});
  assert.throws(()=>appendReviewEvent(initial,adoption()),{code:'PL-REVIEW-TRANSITION'});
  const skipped=appendReviewEvent(initial,validation({checks:validation().checks.map(x=>({
    ...x,outcome:x.name==='geometry-topology'?'not-run':'passed'
  }))}));
  assert.equal(reviewState(skipped).status,'blocked');
  assert.throws(()=>appendReviewEvent(skipped,decision('approved')),{code:'PL-REVIEW-TRANSITION'});
  const failed=appendReviewEvent(initial,validation({checks:validation().checks.map(x=>({
    ...x,outcome:x.name==='temporal'?'failed':'passed'
  }))}));
  assert.equal(reviewState(failed).status,'blocked');
  const retried=appendReviewEvent(failed,validation({eventId:'validation-002',at:'2026-11-02T01:02:00.000Z'}));
  assert.equal(reviewState(retried).status,'validated');
  const approved=appendReviewEvent(retried,decision('approved',{at:'2026-11-02T01:03:00.000Z'}));
  assert.throws(()=>appendReviewEvent(approved,validation({eventId:'validation-003',at:'2026-11-02T01:04:00.000Z'})),
    {code:'PL-REVIEW-TRANSITION'});
  const changes=appendReviewEvent(initial,decision('changes-requested',{reason:'근거 부족'}));
  assert.equal(reviewState(changes).status,'needs-revision');
  assert.throws(()=>appendReviewEvent(changes,validation()),{code:'PL-REVIEW-TRANSITION'});
  const rejected=appendReviewEvent(initial,decision('rejected',{reason:'잘못된 날짜'}));
  assert.equal(reviewState(rejected).status,'rejected');
  assert.throws(()=>appendReviewEvent(rejected,adoption()),{code:'PL-REVIEW-TRANSITION'});
});

test('E2 required validation slots, origin roles, chronology, and receipts are enforced',()=>{
  const first=createReviewBundle(fixture().proposal);
  assert.throws(()=>appendReviewEvent(first,validation({checks:validation().checks.slice(0,-1)})),/mandatory check/);
  assert.throws(()=>appendReviewEvent(first,validation({checks:validation().checks.concat(validation().checks[0])})),/duplicate/);
  assert.throws(()=>appendReviewEvent(first,validation({actor:{kind:'human',id:'u'}})),/CI actor/);
  assert.throws(()=>appendReviewEvent(first,validation({codeRevision:'HEAD'})),/40-character/);
  const verified=appendReviewEvent(first,validation());
  assert.throws(()=>appendReviewEvent(verified,decision('approved',{at:'2026-11-02T00:50:00.000Z'})),
    {code:'PL-REVIEW-TRANSITION'});
  assert.throws(()=>appendReviewEvent(verified,decision('approved',{actor:{kind:'ci',id:'bot'}})),/human actor/);
  const accepted=appendReviewEvent(verified,decision('approved'));
  assert.throws(()=>appendReviewEvent(accepted,adoption({appliedRevision:'work/gis'})),/40-character/);
  assert.throws(()=>appendReviewEvent(accepted,adoption({actor:{kind:'human',id:'u'}})),/CI actor/);
  assert.throws(()=>appendReviewEvent(accepted,adoption({reportPath:'https://example.com/a.json'})),/Evidence/);
  const applied=appendReviewEvent(accepted,adoption());
  assert.throws(()=>appendReviewEvent(applied,adoption({eventId:'applied-002',at:'2026-11-02T01:04:00.000Z'})),
    {code:'PL-REVIEW-TRANSITION'});
  assert.throws(()=>appendReviewEvent(verified,validation()),/Duplicate review event ID/);
});

test('E2 chronology stays sidecar-only and deterministic across independent proposal bundles',()=>{
  const x=createReviewBundle(fixture().proposal);
  const second=fixture().proposal;
  second.proposalId='fixture-review-002';
  second.createdAt='2026-11-02T01:00:01.000Z';
  second.supersedesProposalId=x.proposal.proposalId;
  second.dataset.baseRevision='b'.repeat(40);
  second.dataset.candidateRevision='e'.repeat(40);
  second.changes=second.changes.slice(0,1);
  second.changes[0].after={versionId:'revised-version',sha256:'f'.repeat(64)};
  const y=createReviewBundle(second);
  const rows=indexReviewHistory([y,x]);
  assert.equal(rows.length,6);
  assert.deepEqual(rows,indexReviewHistory([x,y]));
  assert.equal(rows[0].sourceEntityId,'state:EXAMPLE_A');
  assert.equal(rows[0].proposalId,'fixture-review-001');
  assert.deepEqual(rows.filter(row=>row.kind==='geometry').map(row=>row.proposalId),
    ['fixture-review-001','fixture-review-002']);
  assert.ok(Object.isFrozen(rows[0]));
  assert.ok(Object.isFrozen(rows[0].evidenceIds));
  assert.throws(()=>indexReviewHistory([x,x]),/Duplicate proposalId/);
  assert.equal(indexReviewHistory([]).length,0);
});
