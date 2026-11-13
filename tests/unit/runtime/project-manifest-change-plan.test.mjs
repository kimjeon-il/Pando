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


test('Worker message, API and project schema consumers follow indirect fixture references',t=>{
 const root=mkdtempSync(join(tmpdir(),'pando-protocol-impact-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const put=(path,source)=>{const target=join(root,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,source);};
 const worker='src/runtime/worker-channel.js',device='src/rendering/render-device.js';
 const schema='src/document/project-state.js',fixture='tests/helpers/worker-port.mjs';
 const indirect='tests/unit/runtime/worker-indirect.test.mjs',direct='tests/unit/runtime/worker-direct.test.mjs';
 const unrelated='tests/unit/runtime/unrelated.test.mjs',project='tests/unit/document/project-fixture.test.mjs';
 put(worker,"export const messages=['ready'];");
 put(device,"export const contextRevision=1;");
 put(schema,"export const schemaVersion=14;");
 put(fixture,"export const result={type:'ready'};");
 put(indirect,"import '../../helpers/worker-port.mjs';");
 put(direct,"const packet={type:'ready'};");
 put(unrelated,"const packet={type:'unrelated'};");
 put(project,"const projectState={schemaVersion:14};");
 const catalog={schema:'pando-application-checks-v1',
  groups:[{id:'runtime',kind:'unit',testPatterns:['tests/unit/runtime/*.test.mjs'],inputs:[]},
    {id:'document',kind:'unit',testPatterns:['tests/unit/document/*.test.mjs'],inputs:[]}],
  productRoots:['src/**'],passiveInputs:[],infrastructure:[],
  contractConsumers:[
   {id:'worker-events',sources:[worker],testPatterns:['tests/unit/runtime/*.test.mjs'],
    markers:['ready'],alwaysTests:[direct]},
   {id:'render-api',sources:[device],testPatterns:['tests/unit/runtime/*.test.mjs'],
    markers:['contextRevision'],alwaysTests:[direct]},
   {id:'project-schema',sources:[schema],testPatterns:['tests/unit/document/*.test.mjs'],
    markers:['schemaVersion'],alwaysTests:[project]},
  ]};
 const repo=loadRepository(root,{catalog,libraryFiles:{}});
 const selected=planApplicationChecks({repository:repo,changedFiles:[worker]});
 assert.deepEqual(selected.unitTests,[direct,indirect]);
 assert.match(selected.reasons[indirect].join(' '),/contract:worker-events/);
 const document=planApplicationChecks({repository:repo,changedFiles:[schema]});
 assert.deepEqual(document.unitTests,[project]);
 const api=planApplicationChecks({repository:repo,changedFiles:[device]});
 assert.deepEqual(api.unitTests,[direct], 'mandatory smoke owner covers an API even when no test imports it');
 const helperChanged=planApplicationChecks({repository:repo,changedFiles:[fixture]});
 assert.deepEqual(helperChanged.unitTests,[indirect]);
 const isolated=planApplicationChecks({repository:repo,changedFiles:[unrelated]});
 assert.deepEqual(isolated.unitTests,[unrelated]);
 const invalid=structuredClone(catalog);
 invalid.contractConsumers[0].alwaysTests=['tests/unit/runtime/missing.test.mjs'];
 assert.throws(()=>loadRepository(root,{catalog:invalid,libraryFiles:{}}),/Unknown mandatory semantic contract test/);
});


test('CI native prerequisite impact excludes local-only workflow dispatch imports',t=>{
 const root=mkdtempSync(join(tmpdir(),'pando-native-dispatch-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const put=(file,value)=>{
  const target=join(root,file);
  mkdirSync(dirname(target),{recursive:true});
  writeFileSync(target,value);
 };
 const testFile='tests/unit/runtime/native-contract.test.mjs';
 const prepare='scripts/prepare-native-test-tools.mjs';
 const plan='scripts/plan-application-checks.mjs';
 const runner='scripts/run-application-checks.mjs';
 const native='tools/native/codec.cpp';
 put(testFile,"import test from 'node:test'; test('native fixture',()=>{});\n");
 put(prepare,[
  "export async function prepare() {",
  "  if (process.env.GITHUB_ACTIONS !== 'true') {",
  "    await import('./plan-application-checks.mjs');",
  "    await import('./run-application-checks.mjs');",
  "  }",
  "}",
 ].join('\n'));
 put(plan,'export const plan = true;\n');
 put(runner,'export const dispatch = true;\n');
 put(native,'int main() { return 0; }\n');
 const catalog={schema:'pando-application-checks-v1',groups:[{
  id:'native',kind:'unit',testPatterns:[testFile],inputs:[],
 }],prerequisites:{'native-codec':{
  argv:['node',prepare,'codec'],inputs:[native],
 }},unitPrerequisites:[{tests:[testFile],requires:['native-codec']}],
  productRoots:[],infrastructure:[],bindings:[]};
 const repository=loadRepository(root,{catalog,libraryFiles:{}});
 const localOnly=planApplicationChecks({repository,changedFiles:[plan,runner]});
 assert.deepEqual(localOnly.unitTests,[],
  'planner or local dispatch edits must not compile unrelated native tests');
 for(const changed of [prepare,native]) {
  const selected=planApplicationChecks({repository,changedFiles:[changed]});
  assert.deepEqual(selected.unitTests,[testFile],
   'actual native tool or source changes still select their focused contract');
 }
});
