import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CHECK_FAILURE_KINDS,diagnoseCheckFailure,summarizeCheckDiagnostics}
  from '../../../scripts/lib/check-failure-diagnostics.mjs';
import {aggregateCheckEvidence} from '../../../scripts/summarize-check-diagnostics.mjs';
import {executePlan} from '../../../scripts/run-application-checks.mjs';

test('confirmed artifact/source pin and toolchain failures are distinct from ordinary assertions',()=>{
  const examples=[
    ['PL-CORE-PREREQUISITE-STALE: compiled source is stale',CHECK_FAILURE_KINDS.ARTIFACT],
    ['WASM binary artifact stale: expected hash differs',CHECK_FAILURE_KINDS.ARTIFACT],
    ['spawn node ENOENT',CHECK_FAILURE_KINDS.ENVIRONMENT],
    ['CHECK_HISTORY: unavailable comparison SHA',CHECK_FAILURE_KINDS.ENVIRONMENT],
    ['No space left on device',CHECK_FAILURE_KINDS.ENVIRONMENT],
    ['Unknown or retired selected check: tests/unit/old.test.mjs',CHECK_FAILURE_KINDS.STALE],
    ['Missing registered test: tests/unit/deleted.test.mjs',CHECK_FAILURE_KINDS.STALE],
  ];
  for(const [message,kind] of examples){
    const result=diagnoseCheckFailure({id:'unit',status:'failed',stderr:message,exitCode:1});
    assert.equal(result.kind,kind,message);
    assert.equal(result.confidence,'confirmed');
    assert.ok(result.evidence.length>0);
  }
});

test('runtime assertions, Worker timeouts and missing modules are unconfirmed rather than auto-stale',()=>{
  for(const message of [
    "AssertionError [ERR_ASSERTION]: Expected: 2 Received: 0",
    "Error: Worker 작업이 15000ms 제한 시간을 초과했습니다.",
    "ERR_MODULE_NOT_FOUND: Cannot find module ./worker.js",
    "Error: GPU recovery awaiting-canvas did not complete",
  ]){
    const result=diagnoseCheckFailure({status:'failed',stderr:message});
    assert.equal(result.kind,CHECK_FAILURE_KINDS.UNDETERMINED,message);
    assert.equal(result.confidence,'unconfirmed');
  }
  const verified=diagnoseCheckFailure({status:'failed',stderr:'AssertionError: Expected: true Received: false'},
    {confirmedCurrentContract:true});
  assert.equal(verified.kind,CHECK_FAILURE_KINDS.FUNCTIONAL);
  assert.equal(verified.confidence,'verified-contract');
  assert.equal(diagnoseCheckFailure({status:'passed',exitCode:0}),null);
});

test('diagnostic evidence excludes URLs with bearer query tokens and retains causal rule',()=>{
  const error='Source sha256 mismatch at https://example.invalid/data?token=secret-value&auth=yes';
  const result=diagnoseCheckFailure({status:'failed',stderr:error});
  assert.equal(result.kind,CHECK_FAILURE_KINDS.ARTIFACT);
  assert.equal(result.evidence.length,1);
  assert.equal(result.evidence[0].includes('secret-value'),false);
  assert.ok(result.evidence[0].includes('[redacted]'));
});

test('unit batches inherit rooted prerequisite diagnoses but never reclassify a loose assertion',()=>{
  const repository={root:'/tmp/pando-ci-diagnostic-fixture',
    catalog:{prerequisites:{generated:{argv:['node','gen.mjs']}},groups:[]}};
  const plan={prerequisites:['generated'],commands:[],
    unitTests:['tests/unit/real.test.mjs'],unitTestPrerequisites:{
      'tests/unit/real.test.mjs':['generated']},
    browserSpecs:[],reasons:{}};
  const result=executePlan(plan,{repository,phase:'non-browser',environment:{GITHUB_ACTIONS:'true'},
    run:argv=>argv.includes('gen.mjs')
      ?{status:1,stderr:'PL-CORE-PREREQUISITE-STALE: source SHA differs'}:{status:0}});
  assert.equal(result.ok,false);
  const failing=result.results.find(row=>row.id==='generated');
  assert.equal(failing.diagnosis.kind,CHECK_FAILURE_KINDS.ARTIFACT);
  const blocked=result.results.find(row=>row.status==='blocked');
  assert.equal(blocked.diagnosis.kind,CHECK_FAILURE_KINDS.ARTIFACT);
  assert.equal(blocked.diagnosis.confidence,'inherited');
  assert.equal(result.diagnostics.counts[CHECK_FAILURE_KINDS.ARTIFACT],2);
  assert.equal(result.diagnostics.sourceCommit,null);
});

test('selected check receipts merge without fabricating success for missing failed phases',t=>{
  const dir=mkdtempSync(join(tmpdir(),'pando-diagnostic-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const sourceCommit='a'.repeat(40);
  const failed=[{id:'browser',files:['tests/browser/rendering/recovery.spec.mjs'],status:'failed',
    exitCode:1,diagnosis:diagnoseCheckFailure({status:'failed',stderr:'AssertionError: canvas pending'})}];
  const browser={status:'executed',execution:{phase:'browser'},
    plan:{comparison:{head:sourceCommit}},
    results:failed,diagnostics:summarizeCheckDiagnostics(failed,{phase:'browser',sourceCommit})};
  writeFileSync(join(dir,'application-checks-browser-1-of-1.json'),JSON.stringify(browser));
  const merged=aggregateCheckEvidence(dir,{head:sourceCommit,
    pipeline:{selection:'success',nonBrowser:'skipped',browser:'failure'}});
  assert.equal(merged.sourceCommit,sourceCommit);
  assert.equal(merged.entries.length,1);
  assert.equal(merged.entries[0].diagnosis.kind,CHECK_FAILURE_KINDS.UNDETERMINED);
  assert.equal(merged.counts[CHECK_FAILURE_KINDS.UNDETERMINED],1);
  assert.equal(merged.status,'failed-or-blocked');
  const missing=aggregateCheckEvidence(dir,{head:sourceCommit,
    pipeline:{selection:'failure',nonBrowser:'failure',browser:'failure'}});
  assert.ok(missing.entries.some(row=>row.id==='check-selection'));
  assert.ok(missing.entries.some(row=>row.id==='phase:nonBrowser'));
});

test('invalid receipts are diagnosed, not silently discarded or counted as passes',t=>{
  const dir=mkdtempSync(join(tmpdir(),'pando-invalid-diagnostic-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  writeFileSync(join(dir,'application-checks-corrupt.json'),'{} not JSON');
  const report=aggregateCheckEvidence(dir,{head:'b'.repeat(40),
    pipeline:{selection:'success',nonBrowser:'success',browser:'skipped'}});
  assert.equal(report.entries.length,1);
  assert.equal(report.entries[0].diagnosis.kind,CHECK_FAILURE_KINDS.UNDETERMINED);
  assert.equal(report.status,'failed-or-blocked');
});
