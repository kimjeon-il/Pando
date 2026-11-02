import assert from 'node:assert/strict';
import test from 'node:test';
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
