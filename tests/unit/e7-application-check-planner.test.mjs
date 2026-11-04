import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {frontendGeneratedOwners} from '../../scripts/lib/frontend-layout.mjs';
import {loadRepository,planApplicationChecks} from '../../scripts/plan-application-checks.mjs';

test('E7 validates all test registrations without reparsing retired editor imports on a no-change commit',()=>{
  const repository=loadRepository();
  assert.equal(repository.owners.get('tests/browser/windows-review-e5.spec.mjs')?.id,'viewer');
  for(const name of ['p6-5-resource-check','p6-6-desktop-performance','p6-7-narrow-performance']){
    assert.equal(repository.owners.get('tests/browser/'+name+'.spec.mjs')?.mode,'manual');
  }
  const planned=planApplicationChecks({changedFiles:[],repository});
  assert.equal(planned.schema,'pando-application-check-plan-v1');
  assert.deepEqual(planned.changedFiles,[]);
  assert.deepEqual(planned.browserSpecs,[]);
  assert.deepEqual(planned.unitTests,[]);
  assert.deepEqual(planned.commands,[]);
  assert.deepEqual(planned.prerequisites,[]);
  assert.equal(planned.manualTests.includes('tests/browser/p6-5-resource-check.spec.mjs'),true);
  assert.ok(planned.inventory.browser>0);
  assert.ok(planned.inventory.unit>0);
});

test('R1 runtime checker executes against the shipped Viewer and Windows reviewer',()=>{
  const output=execFileSync(process.execPath,['scripts/check-runtime-boundaries.mjs'],{
    cwd:fileURLToPath(new URL('../../',import.meta.url)),encoding:'utf8',timeout:120000,
  });
  assert.match(output,/Viewer\/Windows runtime boundaries passed/);
  assert.match(output,/reachable modules/);
});

test('R1 generated build metadata remains owned by the canonical frontend builder',()=>{
  assert.equal(frontendGeneratedOwners['assets/js/build-meta.js'],'scripts/lib/frontend-build.mjs');
});

test('retired Windows verification script changes select current reviewer checks',()=>{
  const repository=loadRepository();
  for(const path of ['apps/editor/verify-windows.ps1','apps/editor/verify-world-windows.ps1']) {
    const plan=planApplicationChecks({changedFiles:[path],repository});
    assert.ok(plan.commands.includes('app-small-stage'),path);
  }
  assert.throws(()=>planApplicationChecks({changedFiles:['apps/editor/unknown-contract.xyz'],repository}),/Unclassified product change/);
});

test('P3 application runner preserves caller environment while enforcing native prerequisite policy',async()=>{
  const {executePlan}=await import('../../scripts/run-application-checks.mjs');
  const repo={root:fileURLToPath(new URL('../../',import.meta.url)),catalog:{
    prerequisites:{},groups:[
      {id:'probe',kind:'command',argv:['node','dummy-probe'],requires:[]},
      {id:'native-probe',kind:'command',argv:['node','dummy-native'],requires:[],gisNative:true}
    ]
  }};
  const plan={prerequisites:[],commands:['probe'],unitTests:[],browserSpecs:[],changedFiles:[]};
  const calls=[];
  executePlan(plan,{repository:repo,phase:'non-browser',
    environment:{PATH:'pinned-runner-path',GITHUB_ACTIONS:'true',PANDO_REMOTE_ONLY:'1'},
    run:(argv,options)=>{calls.push({argv,options});return {status:0};}});
  assert.equal(calls.length,1);
  assert.equal(calls[0].options.env.PATH,'pinned-runner-path');
  assert.equal(calls[0].options.env.GITHUB_ACTIONS,'true');
  assert.equal(calls[0].options.env.PANDO_REMOTE_ONLY,'1');
  let invoked=0, dispatched=0;
  const nativePlan={...plan,commands:['native-probe']};
  executePlan(nativePlan,{repository:repo,phase:'non-browser',
    environment:{PANDO_REMOTE_ONLY:'1'},
    remote:()=>{dispatched++;return {ok:true,results:[]};},
    run:()=>{invoked++;return {status:0};}});
  assert.equal(invoked,0,'native work is blocked before subprocess execution');
  assert.equal(dispatched,1,'native selection is routed to CI');
});
