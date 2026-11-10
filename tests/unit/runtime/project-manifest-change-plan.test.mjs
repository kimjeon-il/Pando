import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {loadRepository,planApplicationChecks} from '../../../scripts/plan-application-checks.mjs';

test('included startup group preserves both feature selectors and schedules startup once',t=>{
 const root=mkdtempSync(join(tmpdir(),'pando-included-checks-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const files={startup:'tests/browser/runtime/startup.spec.mjs',viewer:'tests/browser/runtime/viewer.spec.mjs',rendering:'tests/browser/rendering/rendering.spec.mjs'};
 const groups=Object.entries(files).map(([id,file])=>({id,kind:'browser',testPatterns:[file],inputs:[`src/${id}.js`],requires:[],...(id==='startup'?{}:{includes:['startup']})}));
 groups[0].inputs=['src/viewer.js','src/rendering.js'];
 for(const file of Object.values(files)){mkdirSync(dirname(join(root,file)),{recursive:true});writeFileSync(join(root,file),'');}
 mkdirSync(join(root,'src'),{recursive:true});for(const id of Object.keys(files))writeFileSync(join(root,`src/${id}.js`),'');
 const catalog={schema:'pando-application-checks-v1',groups,productRoots:[],infrastructure:[],bindings:[]};
 const repository=loadRepository(root,{catalog,libraryFiles:{}});
 for(const selected of [['viewer'],['rendering'],['viewer','rendering']]){
  const plan=planApplicationChecks({repository,groups:selected});
  assert.equal(plan.browserSpecs.filter(file=>file===files.startup).length,1);
  for(const id of selected)assert.ok(plan.browserSpecs.includes(files[id]));
 }
 for(const file of ['src/viewer.js','src/rendering.js'])assert.ok(planApplicationChecks({repository,changedFiles:[file]}).browserSpecs.includes(files.startup));
 const invalid=structuredClone(catalog);invalid.groups[1].includes=['missing'];
 assert.throws(()=>loadRepository(root,{catalog:invalid,libraryFiles:{}}),/Unknown included check group/);
 const cyclic=structuredClone(catalog);cyclic.groups[0].includes=['viewer'];
 assert.throws(()=>loadRepository(root,{catalog:cyclic,libraryFiles:{}}),/Cyclic check group inclusion/);
});

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
