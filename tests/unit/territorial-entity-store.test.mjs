import test from 'node:test';
import assert from 'node:assert/strict';
import {createTerritorialFeature,normalizeTerritorialEntities} from "../../shared/frontend/js/modules/territorial-units.js";
import {normalizeCountryFeature} from "../../shared/frontend/js/modules/country-feature.js";
import {initializeTestTerritorialState,testCoreProject,executeTerritorialTestCommand,staticAutosaveProject} from '../helpers/timeline-project.mjs';

const polygon=(x=0,size=2)=>({type:'Polygon',coordinates:[[[x,0],[x,size],[x+size,size],[x+size,0],[x,0]]]});
const entity=(id,entityKind='general',options={})=>createTerritorialFeature({id,entityKind,name:id,geometry:polygon(),...options});
async function fixture(features=[entity('A','general',{geometry:polygon(0,12)}),entity('B','general',{geometry:polygon(0,12)}),entity('S','general',{parentId:'A'}),
  entity('T','general',{parentId:'S'}),entity('R','regional')]) {
  const events=[],state={territorialEntities:features};
  await initializeTestTerritorialState(state,null,{platformPorts:{onProjectChanged:event=>events.push(event)}});
  const owner=testCoreProject(state);
  return {state,owner,store:owner.entityStore,repo:owner.entityRepository,events,
    command:(commandId,payload)=>executeTerritorialTestCommand(state,commandId,payload),
    metadata:(id,field,value)=>executeTerritorialTestCommand(state,'territorial.metadata',
      {id,field,valuePresent:value!==undefined,...(value===undefined?{}:{value})})};
}

test('ID-only metadata, lock and removal preserve unrelated entity types',async()=>{
  const f=await fixture();
  for(const id of ['A','S','R']) {
    await f.metadata(id,'notes',`memo ${id}`);assert.equal(f.store.hasField(id,'notes'),true);
    assert.equal(f.repo.get(id).properties.notes,`memo ${id}`);
    await f.command('territorial.lock',{ids:[id],locked:true});assert.equal(f.store.isLocked(id),true);
    await f.command('territorial.lock',{ids:[id],locked:false});assert.equal(f.store.isLocked(id),false);
  }
  const before=f.repo.list();await assert.rejects(()=>f.metadata('missing','name','ignored'));
  assert.equal(f.repo.list(),before);
  const country=f.repo.get('A');await f.command('territorial.remove',{ids:['T','R']});
  assert.equal(f.repo.get('A'),country);assert.equal(f.repo.get('S').properties.parentId,'A');
  assert.equal(f.repo.get('T'),null);assert.equal(f.repo.get('R'),null);
});

test('partial changes retain unrelated row identity and full replacement restores exact membership',async()=>{
  const f=await fixture(),original=f.store.snapshot(),country=f.repo.get('A'),region=f.repo.get('R');
  await f.command('territorial.patch',{features:[{...f.repo.get('S'),geometry:polygon(1)}],removedIds:['T']});
  assert.equal(f.repo.get('A'),country);assert.equal(f.repo.get('R'),region);assert.equal(f.events.length,1);
  await f.command('territorial.replace',{features:original});assert.deepEqual(f.store.snapshot(),original);
  await f.command('territorial.replace',{features:[entity('only')]});assert.deepEqual(f.store.snapshot().map(row=>row.id),['only']);
});

test('country source boundary retains empty names and common styles',()=>{
  const source=entity('A','general',{name:''});source.properties.style={color:'#123456',opacity:0.4};
  source.properties.metadata.flagDataUrl='data:image/png;base64,eA==';
  const normalized=normalizeCountryFeature(source);assert.deepEqual(normalized.properties,source.properties);
  assert.deepEqual(normalized.geometry,source.geometry);
});

test('one C++ document stores metadata and geometry for both kinds and exposes no writable Store aliases',async()=>{
  const f=await fixture();
  for(const id of ['A','S','R']) {
    await f.metadata(id,'name',`renamed ${id}`);await f.metadata(id,'color','#ABCDEF');
    const identity=f.store.identities().find(row=>row.id===id);
    assert.equal(identity.geometry,null);assert.equal(identity.properties.name,`renamed ${id}`);
    assert.equal(identity.properties.style.color,'#abcdef');assert.ok(f.state.historyDirtyEntityIds.has(id));
    assert.equal(f.repo.get(id).properties.name,identity.properties.name);
  }
  assert.throws(()=>{f.store.snapshot()[0].properties.name='detached';},TypeError);
  assert.equal(f.repo.get('A').properties.name,'renamed A');
  for(const retired of ['readStorage','restoreStorage','countryOverride','rawEntity','setField','setLocked',
    'transaction','restoreProject','applyChanges','replaceEntities','appendEntities','removeEntities'])assert.equal(retired in f.store,false);
});

test('hierarchy root follows subtree reparenting and a rejected cycle is atomic',async()=>{
  const f=await fixture();assert.equal(f.repo.root('T').id,'A');
  await f.command('territorial.parent',{id:'S',parentId:'B'});assert.equal(f.repo.root('T').id,'B');assert.equal(f.repo.root('R').id,'R');
  const before=f.owner.project.snapshot(),clock=f.owner.client.state();
  await assert.rejects(()=>f.command('territorial.parent',{id:'S',parentId:'T'}));
  assert.equal(f.owner.project.snapshot(),before);assert.deepEqual(f.owner.client.state(),clock);
  assert.equal(f.repo.get('S').properties.parentId,'B');
  assert.ok(f.store.identities().every(row=>!Object.hasOwn(row.properties,'sovereignId')));
});

test('dependent reassignment and removal commit once while invalid partial results commit nothing',async()=>{
  const f=await fixture(),before=f.owner.project.snapshot();
  await assert.rejects(()=>f.command('territorial.remove',{ids:['A']}));assert.equal(f.owner.project.snapshot(),before);
  assert.equal(f.events.length,0);
  await f.command('territorial.patch',{features:[{...f.repo.get('S'),properties:{...f.repo.get('S').properties,parentId:'B'}}],removedIds:['A']});
  assert.equal(f.events.length,1);assert.equal(f.repo.get('A'),null);assert.equal(f.repo.root('T').id,'B');
  const accepted=f.owner.project.snapshot();
  await assert.rejects(()=>f.command('territorial.patch',{features:[entity('B'),entity('B','regional')]}));
  assert.equal(f.owner.project.snapshot(),accepted);assert.equal(f.events.length,1);
  assert.equal(await f.owner.project.undo(),true);assert.deepEqual(f.owner.project.snapshot(),before);
});

test('reparenting retains descendants in a single accepted command',async()=>{
  const f=await fixture();await f.command('territorial.patch',{features:[{...f.repo.get('A'),properties:{...f.repo.get('A').properties,parentId:'B'}}]});
  assert.equal(f.events.length,1);assert.equal(f.repo.get('A').properties.entityKind,'general');
  assert.equal(f.repo.get('T').properties.parentId,'S');assert.equal(f.repo.root('T').id,'B');
});

test('Undo/Redo restore metadata, geometry, parent records, archive and Core dirty IDs together',async()=>{
  const f=await fixture(),before=structuredClone(f.owner.project.snapshot()),geometry=f.repo.get('S').geometry;
  await f.command('territorial.patch',{features:[{...f.repo.get('S'),geometry:polygon(5),properties:{...f.repo.get('S').properties,parentId:'B',name:'moved'}},
    {...f.repo.get('T'),geometry:polygon(5)}]});
  await f.metadata('A','color','#123456');const after=structuredClone(f.owner.project.snapshot()),dirty=[...f.state.historyDirtyEntityIds];
  assert.equal(await f.owner.project.undo(),true);assert.equal(await f.owner.project.undo(),true);
  assert.deepEqual(f.owner.project.snapshot(),before);assert.deepEqual([...f.state.historyDirtyEntityIds],[]);
  assert.equal(f.repo.root('T').id,'A');assert.deepEqual(f.repo.get('S').geometry,geometry);
  assert.equal(await f.owner.project.undo(),false);assert.equal(await f.owner.project.redo(),true);assert.equal(await f.owner.project.redo(),true);
  assert.deepEqual(f.owner.project.snapshot(),after);assert.deepEqual([...f.state.historyDirtyEntityIds],dirty);
  assert.equal(f.repo.get('S').properties.name,'moved');assert.equal(f.repo.root('T').id,'B');
});

test('current document admission rejects retired fields and malformed parents without changing the owner',async()=>{
  const f=await fixture(),before=f.owner.project.snapshot();
  for(const mutate of [row=>{row.schemaVersion=6;},row=>{row.countryOverrides={};},
    row=>{row.timelineRecords.parentRelations[0].parentId='missing';}]) {
    const candidate=structuredClone(before);mutate(candidate);
    await assert.rejects(()=>f.owner.project.admit(candidate));assert.equal(f.owner.project.snapshot(),before);
  }
  assert.throws(()=>normalizeTerritorialEntities([entity('X','general',{parentId:'missing'})]));
  assert.throws(()=>normalizeTerritorialEntities([entity('X','regional',{parentId:'B'}),entity('B')]));
  assert.throws(()=>normalizeTerritorialEntities([entity('R','regional'),entity('X','general',{parentId:'R'})]));
});

test('bulk source admission creates every binding once with exact source coordinates',async()=>{
  const f=await fixture([]),features=Array.from({length:100},(_,index)=>entity(`speed-${index}`));
  await f.owner.project.admit(f.owner.project.snapshot(),{features,preserveCursor:true});
  const current=f.owner.project.snapshot();assert.equal(current.territorialEntities.length,100);
  assert.equal(current.geometries.length,100);assert.equal(current.timelineRecords.geometryBindings.length,100);
  for(const binding of current.timelineRecords.geometryBindings) {
    assert.equal(binding.geometryRef.id,`territorial-geometry:${binding.entityId}`);assert.equal(binding.geometryRef.version,1);
    assert.deepEqual(f.owner.documentModel.geometry(binding.geometryRef),polygon());
  }
});

test('bulk geometry edits allocate above unreferenced versions and preserve whole archive history',async()=>{
  const seed=structuredClone(staticAutosaveProject({},[entity('A'),entity('B')]));
  seed.geometries.push({id:'shared',version:2,geojson:polygon()},{id:'shared',version:8,geojson:polygon(8)},
    {id:'unused',version:9,geojson:polygon(9)});
  for(const binding of seed.timelineRecords.geometryBindings)binding.geometryRef={id:'shared',version:2};
  const f=await fixture([]);await f.owner.project.admit(seed);const before=structuredClone(f.owner.project.snapshot().geometries);
  await f.command('territorial.replace',{features:[entity('A','general',{geometry:polygon(1)}),entity('B','general',{geometry:polygon(3)})]});
  assert.deepEqual(f.state.timelineRecords.geometryBindings.map(row=>row.geometryRef),[{id:'shared',version:9},{id:'shared',version:10}]);
  for(const row of before)assert.deepEqual(f.owner.documentModel.geometry({id:row.id,version:row.version}),row.geojson);
  assert.deepEqual(f.owner.documentModel.geometry({id:'shared',version:9}),polygon(1));
  assert.deepEqual(f.owner.documentModel.geometry({id:'shared',version:10}),polygon(3));
});
