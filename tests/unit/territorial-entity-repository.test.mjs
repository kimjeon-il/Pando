import { executeTerritorialTestCommand,testCoreProject, initializeTestTerritorialState } from '../helpers/timeline-project.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerritorialFeature } from "../../shared/frontend/js/modules/territorial-units.js";
import { createTerritorialEntityStore } from "../../shared/frontend/js/modules/territorial-entity-store.js";
import { createTerritorialEntityRepository } from "../../shared/frontend/js/modules/territorial-entity-repository.js";
const entity=(id,entityKind,options={})=>createTerritorialFeature({id,entityKind,geometry:{type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[1,0],[0,0]]]},...options});
async function fixture() {
 const state={stateRevision:0,territorialEntities:[entity('A','general',{color:'#123456',metadata:{capital:'capital'}}),entity('B','general'),entity('S','general',{parentId:'A'}),entity('T','general',{parentId:'S'}),entity('U','general',{parentId:'A'}),entity('R','regional',{}),entity('I','regional')]};
 await initializeTestTerritorialState(state);
const store=createTerritorialEntityStore({ documentModel:testCoreProject(state).documentModel,commandOwner:testCoreProject(state).client }); return {state,store,repo:createTerritorialEntityRepository({entityStore:store})};
}
test('common read projection protects metadata while sharing canonical geometry',async ()=>{
 const {state,repo}=await fixture();const a=repo.get('A');assert.equal(a.geometry,state.territorialEntities[0].geometry);
 assert.throws(()=>{a.properties.metadata.capital='changed';},TypeError);
 assert.throws(()=>{a.properties.style.color='#abcdef';},TypeError);
 assert.equal(state.territorialEntities[0].properties.metadata.capital,'capital');assert.equal(state.territorialEntities[0].properties.style.color,'#123456');
});
test('one hierarchy API resolves nested general objects and independent regional roots',async ()=>{
 const {repo}=await fixture();assert.deepEqual(repo.children('A').map(x=>x.id),['S','U']);assert.equal(repo.parent('T').id,'S');
 assert.deepEqual(repo.ancestors('T').map(x=>x.id),['S','A']);assert.deepEqual(repo.descendants('A').map(x=>x.id),['S','U','T']);
 assert.deepEqual(repo.siblings('S').map(x=>x.id),['U']);assert.equal(repo.root('T').id,'A');
 assert.equal(repo.root('R').id,'R');assert.equal(repo.root('I').id,'I');
 assert.deepEqual(repo.list({rootId:'A'}).map(x=>x.id),['A','S','T','U']);
 assert.equal(repo.get('missing'),null);
});
test('Store publication and project revision invalidate cached lists and hierarchy roots',async ()=>{
 const {state,repo}=await fixture();const first=repo.get('A');assert.equal(repo.get('A'),first);assert.equal(repo.list(),repo.list());
 await executeTerritorialTestCommand(state,'territorial.metadata',{id:'A',field:'name',value:'renamed',valuePresent:true});
 assert.notEqual(repo.get('A'),first);assert.equal(repo.get('A').properties.name,'renamed');
 await executeTerritorialTestCommand(state,'territorial.parent',{id:'S',parentId:'B'});assert.equal(repo.root('T').id,'B');
 const before=repo.get('A');await executeTerritorialTestCommand(state,'territorial.metadata',{id:'A',field:'notes',value:'changed',valuePresent:true});
 assert.notEqual(repo.get('A'),before);
});
test('duplicate identity, cycles and missing parents fail visibly',async ()=>{
 const {state,repo}=await fixture();const before=testCoreProject(state).project.snapshot(),initial=repo.list();
 const admit=features=>testCoreProject(state).project.admit(before,{features,preserveCursor:true});
 await assert.rejects(admit([entity('same','general'),entity('same','regional')]),/duplicate|중복/i);
 await assert.rejects(admit([entity('X','general',{parentId:'Y'}),entity('Y','general',{parentId:'X'})]),/cycle|cyclic|parent|순환/i);
 await assert.rejects(admit([entity('X','general',{parentId:'missing'})]),/parent|존재하지/i);
 assert.equal(testCoreProject(state).project.snapshot(),before);assert.equal(repo.list(),initial);
 assert.equal(repo.root('T').id,'A');assert.equal(repo.get('X'),null);
});
