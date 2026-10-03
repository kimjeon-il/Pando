import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerritorialFeature } from '../../assets/js/modules/territorial-units.js';
import { createTerritorialEntityStore } from '../../assets/js/modules/territorial-entity-store.js';
import { createTerritorialEntityRepository } from '../../assets/js/modules/territorial-entity-repository.js';
const entity=(id,unitType,options={})=>createTerritorialFeature({id,unitType,geometry:{type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[1,0],[0,0]]]},...options});
function fixture() {
 const state={stateRevision:0,territorialEntities:[entity('A','country',{color:'#123456',metadata:{capital:'capital'}}),entity('B','country'),entity('S','subunit',{parentId:'A'}),entity('T','subunit',{parentId:'S'}),entity('U','subunit',{parentId:'A'}),entity('R','region',{associatedCountryId:'B'}),entity('I','region')]};
 const store=createTerritorialEntityStore({getState:()=>state}); return {state,store,repo:createTerritorialEntityRepository({entityStore:store})};
}
test('common read projection detaches metadata while sharing canonical geometry',()=>{
 const {state,repo}=fixture();const a=repo.get('A');assert.equal(a.geometry,state.territorialEntities[0].geometry);
 a.properties.metadata.capital='changed';a.properties.style.color='#abcdef';assert.equal(state.territorialEntities[0].properties.metadata.capital,'capital');assert.equal(state.territorialEntities[0].properties.style.color,'#123456');
});
test('one hierarchy API resolves nested units and independent region association',()=>{
 const {repo}=fixture();assert.deepEqual(repo.children('A').map(x=>x.id),['S','U']);assert.equal(repo.parent('T').id,'S');
 assert.deepEqual(repo.ancestors('T').map(x=>x.id),['S','A']);assert.deepEqual(repo.descendants('A').map(x=>x.id),['S','U','T']);
 assert.deepEqual(repo.siblings('S').map(x=>x.id),['U']);assert.equal(repo.root('T').id,'A');assert.equal(repo.administrativeCountry('T').id,'A');
 assert.equal(repo.administrativeCountry('R').id,'B');assert.equal(repo.administrativeCountry('I'),null);
 assert.deepEqual(repo.list({administrativeCountryId:'A'}).map(x=>x.id),['A','S','T','U']);
 assert.equal(repo.get('missing'),null);
});
test('Store publication and project revision invalidate cached lists and country membership',()=>{
 const {state,store,repo}=fixture();const first=repo.get('A');assert.equal(repo.get('A'),first);assert.equal(repo.list(),repo.list());
 store.setField('country','A','name','renamed');assert.notEqual(repo.get('A'),first);assert.equal(repo.get('A').properties.name,'renamed');
 store.setField('subunit','S','parentId','B');assert.equal(repo.administrativeCountry('T').id,'B');
 const before=repo.get('A');state.stateRevision++;assert.notEqual(repo.get('A'),before);
});
test('duplicate identity, cycles and missing parents fail visibly',()=>{
 const {state,repo}=fixture();state.territorialEntities=[entity('same','country'),entity('same','region')];assert.throws(()=>repo.list(),/중복/);
 state.territorialEntities=[entity('X','subunit',{parentId:'Y'}),entity('Y','subunit',{parentId:'X'})];assert.throws(()=>repo.ancestors('X'),/순환/);assert.throws(()=>repo.descendants('X'),/순환/);assert.throws(()=>repo.administrativeCountry('X'),/순환/);
 state.territorialEntities=[entity('X','subunit',{parentId:'missing'})];assert.throws(()=>repo.parent('X'),/존재하지/);assert.throws(()=>repo.administrativeCountry('X'),/부모/);
});
