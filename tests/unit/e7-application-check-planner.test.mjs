import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFileSync,existsSync} from 'node:fs';
import {frontendGeneratedOwners} from '../../scripts/lib/frontend-layout.mjs';
import {loadRepository,planApplicationChecks} from '../../scripts/plan-application-checks.mjs';

test('E7 validates all active test registrations without obsolete exception rules',()=>{
  const repository=loadRepository();
  assert.equal(repository.owners.get('tests/browser/viewer-inspector.spec.mjs')?.id,'viewer');
  for(const name of ['viewer-startup-and-terrain','viewer-calendar','viewer-temporal-regressions','viewer-renderer-recovery']){
    const owner=repository.owners.get('tests/browser/'+name+'.spec.mjs');
    assert.ok(owner && owner.mode!=='manual', name);
  }
  for(const name of ['p6-5-resource-check','p6-6-desktop-performance','p6-7-narrow-performance'])
    assert.equal(repository.owners.has('tests/browser/'+name+'.spec.mjs'),false,name);
  const planned=planApplicationChecks({changedFiles:[],repository});
  assert.equal(planned.schema,'pando-application-check-plan-v1');
  assert.deepEqual(planned.changedFiles,[]);
  assert.deepEqual(planned.browserSpecs,[]);
  assert.deepEqual(planned.unitTests,[]);
  assert.deepEqual(planned.commands,[]);
  assert.deepEqual(planned.prerequisites,[]);
  assert.equal(planned.manualTests.includes('tests/browser/p6-5-resource-check.spec.mjs'),false);
  assert.ok(planned.inventory.browser>0);
  assert.ok(planned.inventory.unit>0);
});

test('R1 runtime checker executes against the shipped Web Viewer only',()=>{
  const output=execFileSync(process.execPath,['scripts/check-runtime-boundaries.mjs'],{
    cwd:fileURLToPath(new URL('../../',import.meta.url)),encoding:'utf8',timeout:120000,
  });
  assert.match(output,/Viewer runtime boundaries passed/);
  assert.match(output,/reachable modules/);
});

test('R1 generated build metadata remains owned by the canonical frontend builder',()=>{
  assert.equal(frontendGeneratedOwners['assets/js/build-meta.js'],'scripts/lib/frontend-build.mjs');
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


test('current CLI entrypoints and test inventory never reference removed regression files',()=>{
  const pkg=JSON.parse(readFileSync(new URL('../../package.json',import.meta.url),'utf8'));
  const catalog=JSON.parse(readFileSync(new URL('../../scripts/contracts/application-checks.json',import.meta.url),'utf8'));
  for(const [name,command] of Object.entries(pkg.scripts))
    for(const match of command.matchAll(/tests\/(?:unit|browser|integration)\/[\w./-]+\.(?:test|spec)\.mjs/g))
      assert.ok(existsSync(new URL('../../'+match[0],import.meta.url)),name+': '+match[0]);
  for(const binding of catalog.bindings||[])for(const file of binding.tests||[])
    if(!file.includes('*'))assert.ok(existsSync(new URL('../../'+file,import.meta.url)),'missing catalog binding: '+file);
});
