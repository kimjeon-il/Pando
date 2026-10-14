import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {loadWebOracle} from '../helpers/web-oracle.mjs';
import {createNodeCoreProject} from '../helpers/core-project.mjs';

const {createHistoryService}=await loadWebOracle('assets/js/modules/history-service.js');
const environment=readFileSync(new URL('../fixtures/portability/web-9300609-hydro-create/assets/js/modules/app-environment.js',import.meta.url),'utf8');
const manifest=JSON.parse(readFileSync(new URL('../fixtures/portability/web-9300609-hydro-create/manifest.json',import.meta.url),'utf8'));
assert.equal(createHash('sha256').update(environment).digest('hex'),manifest.files.find(row=>row.path==='assets/js/modules/app-environment.js').sha256);
const limit=Number(/\(MAX_HISTORY = (\d+)\)/.exec(environment)?.[1]);
assert.equal(limit,30,'The real original application history configuration is pinned.');

test('the canonical whole-document ledger retains the original Web thirty-command Undo boundary',async t=>{
 const seed=JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json',import.meta.url),'utf8'));
 const owner=await createNodeCoreProject(seed);t.after(()=>owner.dispose());
 let name=seed.territorialEntities.find(row=>row.id==='A').properties.name;
 const history=createHistoryService({store:{history:[],historyMeta:[],future:[],futureMeta:[]},maxEntries:limit,
   snapshot:()=>({name}),restore:snapshot=>{name=snapshot.name;},normalizeMetadata:value=>value});
 for(let index=1;index<=35;++index){history.record();name='Name '+index;
   const result=await owner.project.executeCommand({commandId:'territorial.field',targets:[{domain:'territorial',id:'A'}],payload:{id:'A',field:'name',value:name}});
   assert.equal(result.ok,true);assert.equal(result.changed,true);
 }
 for(let index=0;index<limit;++index){assert.equal(history.undo(),true);assert.equal(await owner.project.undo(),true);}
 assert.equal(name,'Name 5');assert.equal(owner.documentModel.get({domain:'territorial',id:'A'}).properties.name,name);
 assert.equal(history.canUndo(),false);assert.equal(owner.project.canUndo(),false);assert.equal(await owner.project.undo(),false);
 for(let index=0;index<limit;++index){assert.equal(history.redo(),true);assert.equal(await owner.project.redo(),true);}
 assert.equal(name,'Name 35');assert.equal(owner.documentModel.get({domain:'territorial',id:'A'}).properties.name,name);assert.equal(owner.project.canRedo(),false);
});
