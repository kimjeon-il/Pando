import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {loadRepository,planApplicationChecks} from '../../../scripts/plan-application-checks.mjs';

test('a new project manifest is inventoried and selects only its registered focused tests',t=>{
 const root=mkdtempSync(join(tmpdir(),'pando-project-plan-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const put=(path,value)=>{const target=join(root,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,value);};
 const project='projects/alternate-world/manifest.json';
 const check='tests/unit/data/map-project-manifest.test.mjs';
 put(project,'{}');put(check,"import test from 'node:test'; test('stub',()=>{});\n");
 const catalog={schema:'pando-application-checks-v1',groups:[{
  id:'unit',kind:'unit',testPatterns:['tests/unit/**/*.test.mjs'],inputs:[],requires:[],
 }],productRoots:['projects/**'],bindings:[{tests:[check],inputs:['projects/**/manifest.json']}],
 infrastructure:[],passiveInputs:[]};
 const repository=loadRepository(root,{catalog,libraryFiles:{}});
 assert.ok(repository.files.includes(project),'project manifests must appear in the reverse dependency index');
 const plan=planApplicationChecks({changedFiles:[project],repository});
 assert.deepEqual(plan.unitTests,[check]);
 assert.deepEqual(plan.browserSpecs,[]);
 assert.deepEqual(plan.commands,[]);
 assert.ok(plan.reasons[check].includes(project));
});


test('overlapping unit groups and direct bindings schedule one test invocation',t=>{
 const root=mkdtempSync(join(tmpdir(),'pando-check-dedupe-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const put=(path,value)=>{const target=join(root,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,value);};
 const project='projects/alternate-world/manifest.json',unit='tests/unit/data/map-project-manifest.test.mjs';
 put(project,'{}');put(unit,"import test from 'node:test'; test('stub',()=>{});\n");
 const groups=['first','second'].map(id=>({id,kind:'unit',testPatterns:['tests/unit/**/*.test.mjs'],inputs:['projects/**'],requires:[]}));
 const repository=loadRepository(root,{catalog:{schema:'pando-application-checks-v1',groups,
  productRoots:['projects/**'],bindings:[{tests:[unit],inputs:['projects/**/manifest.json']}],
  infrastructure:[],passiveInputs:[]},libraryFiles:{}});
 const plan=planApplicationChecks({changedFiles:[project],repository});
 assert.deepEqual(plan.unitTests,[unit],'one test entry despite multiple matching owners');
});
