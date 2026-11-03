import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

const root=new URL('../../',import.meta.url);
const run=(...args)=>execFileSync(process.execPath,args,{cwd:root,encoding:'utf8'});
test('R4-D does not schedule archived editor-only suites as current product tests',()=>{
 const unit=run('scripts/run-active-tests.mjs','unit','--list').split('\n');
 const browser=run('scripts/run-active-tests.mjs','browser','--list').split('\n');
 for(const file of ['tests/unit/application-composition.test.mjs',
  'tests/unit/capability-ports-contract.test.mjs','tests/unit/edit-preview-handoff.test.mjs'])
  assert.ok(!unit.includes(file),file);
 for(const file of ['tests/browser/editor-workspace.spec.mjs',
  'tests/browser/radio-row-consistency.spec.mjs'])
  assert.ok(!browser.includes(file),file);
 for(const file of ['tests/unit/r4c-spatial-boundaries.test.mjs',
  'tests/unit/r4b-data-module-boundaries.test.mjs'])
  assert.ok(unit.includes(file),'lost canonical GIS regression: '+file);
 assert.ok(browser.includes('tests/browser/button-consistency.spec.mjs'),
  'Viewer button regression was wrongly registered as retired');
});
test('R4-D executable audit preserves real GIS contracts and retires obsolete CI',()=>{
 const result=JSON.parse(run('scripts/r4d-check-retired-tests.mjs','--check'));
 assert.equal(result.ok,true);
 assert.equal(result.remainingLegacySourceCount,103);
 assert.equal(result.removedWorkflowCount,11);
 assert.equal(result.retiredTestCount,0);
});
test('R4-D does not mistake archive staging for application production',()=>{
 const pkg=JSON.parse(readFileSync(new URL('../../package.json',import.meta.url),'utf8'));
 assert.match(pkg.scripts['test:unit'],/run-active-tests\.mjs unit/);
 assert.match(pkg.scripts['test:browser'],/run-active-tests\.mjs browser/);
});
