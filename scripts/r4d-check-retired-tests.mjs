// R4-D: test and CI retirement gate, with a report of remaining R4-E bridges.
// It inspects repository files only and does not delete or rewrite GIS source data.
import {readdirSync,readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadRepository} from './plan-application-checks.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const read=path=>readFileSync(resolve(root,path),'utf8');
const exists=path=>existsSync(resolve(root,path));
const repo=loadRepository(root);
const manifest=JSON.parse(read('docs/development/r4-source-pruning.json'));
const errors=[];
const fail=message=>errors.push(message);
const retiredWorkflowNames=[
  'editor-ui-p8-acceptance','editor-ui-p8-final-regression','editor-ui-p8-hydro-diagnostic',
  'editor-ui-p8-isolated-repro','editor-ui-p8-targeted-repro','p8-annex-focused',
  'p8-hydro-focused','integration-ui-objects-20261016',
  'integration-windows-web-shell-20261016','p6-preflight','soviet-memory-cycle'
];
for(const name of retiredWorkflowNames)if(exists('.github/workflows/'+name+'.yml'))
  fail('Obsolete editor workflow is still executable: '+name);
const legacySources=(directory)=>{
  if(!exists(directory))return [];
  return readdirSync(resolve(root,directory),{withFileTypes:true})
    .flatMap(item=>item.isDirectory()?legacySources(directory+'/'+item.name):[directory+'/'+item.name]);
};
const editorSources=legacySources('apps/editor/frontend').filter(file=>/\.(?:m?js|html)$/.test(file));
if(editorSources.length!==manifest.remainingSourceCount)
  fail('R4-D expected '+manifest.remainingSourceCount+' archived sources, found '+editorSources.length);
const expectedActive=[
 'tests/browser/button-consistency.spec.mjs','tests/browser/viewer-review-e4.spec.mjs',
 'tests/browser/windows-review-e5.spec.mjs','tests/unit/r4c-spatial-boundaries.test.mjs',
 'tests/unit/r4b-data-module-boundaries.test.mjs','tests/unit/gis-math-contract.test.mjs'
];
for(const test of expectedActive){
  if(!exists(test)||['retired','manual'].includes(repo.owners.get(test)?.mode))
    fail('Current Viewer/GIS regression was retired: '+test);
}
const expectedRetired=[
 'tests/browser/editor-workspace.spec.mjs','tests/browser/radio-row-consistency.spec.mjs',
 'tests/unit/application-composition.test.mjs','tests/unit/capability-ports-contract.test.mjs',
 'tests/unit/edit-preview-handoff.test.mjs','tests/unit/territorial-property-controller.test.mjs'
];
for(const test of expectedRetired)if(exists(test)&&repo.owners.get(test)?.mode!=='retired')
  fail('Historical editor-only regression remains active: '+test);
const oldTestNames=[
 'edit-preview-handoff.test.mjs','map-editing-foundation.test.mjs',
 'edit-preparation.test.mjs','land-relations-presentation.test.mjs',
 'territorial-library-controller.test.mjs'
];
for(const file of ['.github/workflows/r4-editor-pruning-validation.yml',
  '.github/workflows/remote-preview-p3.yml','.github/workflows/generated-artifacts-p2.yml']){
 const content=read(file);
 for(const stale of oldTestNames)if(content.includes('tests/unit/'+stale))
   fail('Active workflow '+file+' still executes obsolete editor test '+stale);
}
const archived=[],active=[];
for(const file of repo.tests){
 const body=repo.read(file);
 if(!/(?:apps\/editor\/frontend\/js\/|helpers\/editor-entry\.mjs)/.test(body))continue;
 (repo.owners.get(file)?.mode==='retired'?archived:active).push(file);
}
for(const canonical of ['tools/gis/geometry-metrics.js','tools/gis/geometry-validation.js',
 'tools/gis/country-import-merge.js','tools/gis/territorial-batch-calculation.js',
 'tools/gis/territory-component-plan.js','tools/gis/country-geometry-calculator.js']){
 if(!exists(canonical))fail('R4-D lost canonical spatial adapter: '+canonical);
}
const result={schema:'pandolab-r4d-test-ci-audit-v1',ok:!errors.length,
 remainingLegacySourceCount:editorSources.length,
 removedWorkflowCount:retiredWorkflowNames.length,
 retiredTestCount:[...repo.owners.values()].filter(x=>x.mode==='retired').length,
 activeLegacyTestReferences:active.length,retiredLegacyTestReferences:archived.length,
 activeLegacyTestPaths:active,errors};
console.log(JSON.stringify(result,null,2));
if(process.argv.includes('--check')&&errors.length)process.exitCode=1;
