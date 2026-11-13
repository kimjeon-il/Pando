import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {auditWorkflowCheckOwners,auditWorkflowInventory} from '../../../tools/checks/audit-workflow-check-owners.mjs';
import {scheduleViewerPreview} from '../../../scripts/viewer-preview-plan.mjs';
import {readFileSync} from 'node:fs';
import YAML from 'yaml';
import {fileURLToPath} from 'node:url';
import {assertNoTrackedLibraryAssets} from '../../../scripts/check-world-archive-closure.mjs';

test('preview delegates only unfiltered automatic pushes to the canonical application workflow',()=>{
 const applicationWorkflow=YAML.parse(readFileSync(new URL('../../../.github/workflows/application-architecture.yml',import.meta.url),'utf8'));
 const selection={preview:true,browser:true,contracts:true};
 for(const branch of ['work/ui','work/gis','work/objects','work/places','work/remote-only']){
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

test('every workflow has one current, opt-in, or historical owner without fixed counts',()=>{
 const dir=new URL('../../../.github/workflows/',import.meta.url);
 const manifest=new URL('../../../scripts/contracts/workflow-inventory.json',import.meta.url);
 const catalog=JSON.parse(readFileSync(manifest,'utf8'));
 const result=auditWorkflowInventory(fileURLToPath(dir),fileURLToPath(manifest));
 assert.equal(result.ok,true,JSON.stringify(result.issues));
 assert.deepEqual(result.counts,{
  continuous:Object.keys(catalog.continuous).length,
  manual:catalog.manual.length,historical:catalog.historical.length,
 });
 assert.equal(result.workflowCount,Object.values(result.counts).reduce((a,b)=>a+b,0));
 assert.equal(result.canonicalApplication,'application-architecture.yml');
});

test('workflow inventory rejects new unclassified files and opt-in auto events',t=>{
 const dir=mkdtempSync(join(tmpdir(),'pando-inventory-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const manifest=join(dir,'inventory.json');
 const put=(name,body)=>writeFileSync(join(dir,name+'.yml'),body);
 const write=manual=>writeFileSync(manifest,JSON.stringify({
  schema:'pando-workflow-inventory-v1',canonicalApplication:'application-architecture.yml',
  continuous:{'application-architecture.yml':'current application checks'},
  manual,historical:[],
 }));
 put('application-architecture','on:\n  push:\n    branches: [main]\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo check\n');
 put('review','on:\n  workflow_dispatch:\njobs:\n  audit:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo audit\n');
 write(['review.yml']);
 assert.equal(auditWorkflowInventory(dir,manifest).ok,true);
 put('review','on:\n  push:\n    branches: [main]\n  workflow_dispatch:\njobs:\n  audit:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo audit\n');
 assert.match(JSON.stringify(auditWorkflowInventory(dir,manifest).issues),/automatic triggers/);
 write([]);
 assert.match(JSON.stringify(auditWorkflowInventory(dir,manifest).issues),/missing from canonical inventory/);
});

test('consolidated terrain and world archive contracts are opt-in wrappers around canonical checks',()=>{
 const root=new URL('../../../',import.meta.url);
 const read=path=>readFileSync(new URL(path,root),'utf8');
 const inventory=JSON.parse(read('scripts/contracts/workflow-inventory.json'));
 const catalog=JSON.parse(read('scripts/contracts/application-checks.json'));
 for(const file of Object.keys(inventory.delegatedToCanonical)){
  assert.ok(inventory.manual.includes(file));
  const parsed=YAML.parse(read('.github/workflows/'+file));
  assert.deepEqual(Object.keys(parsed.on),['workflow_dispatch'],
    file+' must not silently duplicate automatic application checks');
 }
 const historical='terrain-v014-main-integration-gate.yml';
 assert.ok(inventory.historical.includes(historical));
 assert.deepEqual(Object.keys(YAML.parse(read('.github/workflows/'+historical)).on),['workflow_dispatch']);
 for(const id of ['viewer-runtime-identity','world-archive-source-boundary']){
  assert.ok(catalog.groups.some(group=>group.id===id&&group.kind==='command'));
 }
 const boundTests=new Set(catalog.bindings.flatMap(binding=>binding.tests||[]));
 for(const file of [
  'tests/unit/rendering/terrain-tile-selection-shared.test.mjs',
  'tests/unit/rendering/canvas-terrain-independence.test.mjs',
  'tests/unit/rendering/gpu-base-scene-order.test.mjs',
  'tests/unit/data/map-project-manifest.test.mjs',
  'tests/unit/data/frontend-runtime-closure.test.mjs',
 ])assert.ok(boundTests.has(file),'Missing canonical test binding: '+file);
});

test('external GIS runtime assets cannot be committed into the application repository',()=>{
 assert.equal(assertNoTrackedLibraryAssets([]),true);
 assert.throws(()=>assertNoTrackedLibraryAssets(['assets/data/terrain/synthetic-tile.bin']),/tracked/);
 assert.throws(()=>assertNoTrackedLibraryAssets(['assets/data/hydro/part.bin']),/tracked/);
 assert.throws(()=>assertNoTrackedLibraryAssets(null),/Invalid/);
});
