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
