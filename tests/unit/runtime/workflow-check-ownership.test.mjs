import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {auditWorkflowCheckOwners} from '../../../tools/checks/audit-workflow-check-owners.mjs';
import {scheduleViewerPreview} from '../../../scripts/viewer-preview-plan.mjs';
import {readFileSync} from 'node:fs';
import YAML from 'yaml';

test('preview delegates only unfiltered automatic pushes to the canonical application workflow',()=>{
 const applicationWorkflow=YAML.parse(readFileSync(new URL('../../../.github/workflows/application-architecture.yml',import.meta.url),'utf8'));
 const selection={preview:true,browser:true,contracts:true};
 for(const branch of ['work/ui','work/gis','work/objects','work/places']){
  assert.ok(applicationWorkflow.on.push.branches.includes(branch));
  assert.equal(scheduleViewerPreview(selection,{branch,applicationWorkflow}).contracts,false);
  assert.equal(scheduleViewerPreview(selection,{branch,applicationWorkflow,event:'workflow_dispatch'}).contracts,true);
 }
 assert.equal(scheduleViewerPreview(selection,{branch:'work/custom',applicationWorkflow}).contracts,true);
 const filtered=structuredClone(applicationWorkflow);filtered.on.push.paths=['src/**'];
 assert.equal(scheduleViewerPreview(selection,{branch:'work/ui',applicationWorkflow:filtered}).contracts,true);
});

test('workflow ownership audit preserves independent specialized jobs and detects only exact automatic duplicates',t=>{
 const dir=mkdtempSync(join(tmpdir(),'pando-ci-owners-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const put=(name,source)=>writeFileSync(join(dir,name+'.yml'),source);
 put('shared',`on:\n  push:\n    branches: [main]\njobs:\n  checks:\n    steps:\n      - run: node --test tests/unit/data/example.test.mjs\n`);
 put('specialized',`on:\n  workflow_dispatch:\njobs:\n  native:\n    steps:\n      - run: node --test tests/unit/data/example.test.mjs\n`);
 const first=auditWorkflowCheckOwners(dir);
 assert.equal(first.workflowCount,2);assert.equal(first.automatic,1);
 assert.equal(first.manualOnly,1);assert.deepEqual(first.duplicateJobs,[]);
 assert.equal(first.multiOwnerTestCount,1);
 assert.ok(first.multiOwnerTests[0].owners.some(x=>!x.automatic));
 put('different-branch',`on:\n  push:\n    branches: [work/gis]\njobs:\n  checks:\n    steps:\n      - run: node --test tests/unit/data/example.test.mjs\n`);
 put('different-env',`on:\n  push:\n    branches: [main]\njobs:\n  checks:\n    env:\n      PANDO_CHECK_PROFILE: territory\n    steps:\n      - run: node --test tests/unit/data/example.test.mjs\n`);
 assert.deepEqual(auditWorkflowCheckOwners(dir).duplicateJobs,[],
   'different branch selectors or execution env must remain separate checks');
 put('duplicate',`on:\n  push:\n    branches: [main]\njobs:\n  checks:\n    steps:\n      - run: node --test tests/unit/data/example.test.mjs\n`);
 const second=auditWorkflowCheckOwners(dir);
 assert.equal(second.duplicateJobs.length,1);
 assert.deepEqual(second.issues,[]);
});
