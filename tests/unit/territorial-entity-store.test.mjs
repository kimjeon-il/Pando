import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerritorialFeature, normalizeTerritorialEntities, territorialRootId } from '../../assets/js/modules/territorial-units.js';
import { createTerritorialEntityStore } from '../../assets/js/modules/territorial-entity-store.js';
import { createTerritorialEntityRepository } from '../../assets/js/modules/territorial-entity-repository.js';
import { createProjectSerializer, restoreEntitiesFromDelta } from '../../assets/js/modules/project-serializer.js';
import { assertCurrentProjectSchema } from '../../assets/js/modules/project-state.js';
import { createGeometrySnapshotPool } from '../../assets/js/modules/geometry-versions.js';
import { normalizeLayerPresentation } from '../../assets/js/modules/layer-presentation.js';
import { normalizeCountryFeature } from '../../assets/js/modules/country-feature.js';

const polygon = (x = 0) => ({ type: 'Polygon', coordinates: [[[x,0],[x,2],[x+2,2],[x+2,0],[x,0]]] });
const entity = (id, entityKind, options = {}) => createTerritorialFeature({ id, entityKind, name: id, geometry: polygon(), ...options });
function fixture() {
  const entities = [entity('A','general'), entity('B','general',{ geometry: polygon(5) }),
    entity('S','general',{ parentId:'A' }), entity('T','general',{ parentId:'S' }),
    entity('R','regional',{ })];
  const state = { territorialEntities: entities, stateRevision: 0, historyDirtyEntityIds: new Set() };
  const publications = [];
  const store = createTerritorialEntityStore({ getState: () => state, onEntitiesReplaced: (_entities, details) => publications.push(details) });
  const repo = createTerritorialEntityRepository({ entityStore: store });
  return { state, store, repo, publications };
}
function serializer(snapshot) {
  return createProjectSerializer({ appVersion: '0.35.0', baseDataset:'fixture', distributionModes:['territorial','geometry'], readSnapshot: () => ({ ...snapshot,
    projectFields: { layerPresentation: normalizeLayerPresentation({}), distributionSettings: { renderMode:'overlap',activeLayerId:'',boundaryVisible:true } } }) });
}

test('ID-only field, lock and removal operations preserve unrelated entity types', () => {
  const { store, repo } = fixture();
  for (const id of ['A', 'S', 'R']) {
    assert.equal(store.setField(id, 'notes', `memo ${id}`), true);
    assert.equal(store.hasField(id, 'notes'), true);
    assert.equal(repo.get(id).properties.notes, `memo ${id}`);
    store.setLocked(id, true);
    assert.equal(store.isLocked(id), true);
    store.setLocked(id, false);
    assert.equal(store.isLocked(id), false);
  }
  assert.equal(store.setField('missing', 'name', 'ignored'), false);
  const originalCountry = repo.get('A');
  assert.deepEqual(store.removeEntities(['T', 'R']).map(feature => feature.id), ['T', 'R']);
  assert.deepEqual(repo.get('A'), originalCountry);
  assert.equal(repo.get('S').properties.parentId, 'A');
  assert.equal(repo.get('T'), null);
  assert.equal(repo.get('R'), null);
});

test('partial changes preserve countries and regions while full replacement restores exact membership', () => {
  const { state, store, repo, publications } = fixture();
  const original = store.snapshot();
  const country = state.territorialEntities.find(feature => feature.id === 'A');
  const region = state.territorialEntities.find(feature => feature.id === 'R');
  store.applyChanges({ features: [{ ...repo.get('S'), geometry: polygon(1) }], removedIds: ['T'] });
  assert.equal(state.territorialEntities.find(feature => feature.id === 'A'), country);
  assert.equal(state.territorialEntities.find(feature => feature.id === 'R'), region);
  assert.equal(publications.length, 1);
  store.replaceEntities(original);
  assert.deepEqual(store.snapshot(), original);
  store.replaceEntities([entity('only', 'general')]);
  assert.deepEqual(store.snapshot().map(feature => feature.id), ['only']);
});

test('country source boundary retains canonical empty names and common styles', () => {
  const source = entity('A', 'general', { name: '' });
  source.properties.style = { color: '#123456', opacity: 0.4 };
  source.properties.metadata.flagDataUrl = 'data:image/png;base64,eA==';
  const normalized = normalizeCountryFeature(source);
  assert.deepEqual(normalized.properties, source.properties);
  assert.deepEqual(normalized.geometry, source.geometry);
});

test('one physical collection stores metadata and geometry for both kinds', () => {
  const { state,store,repo } = fixture();
  for (const id of ['A','S','R']) {
    store.setField(id,'name',`renamed ${id}`);
    store.setField(id,'color','#ABCDEF');
    const persisted = state.territorialEntities.find(entity => entity.id === id);
    assert.equal(persisted.properties.name,`renamed ${id}`);
    assert.equal(persisted.properties.style.color,'#abcdef');
    assert.equal(repo.get(id).properties.name,persisted.properties.name);
    assert.ok(state.historyDirtyEntityIds.has(id));
  }
  const projected = store.snapshot(); projected[0].properties.name = 'detached';
  assert.equal(state.territorialEntities[0].properties.name,'renamed A');
  for (const retired of ['readStorage','restoreStorage','countryOverride','rawEntity']) assert.equal(retired in store,false);
  for (const retired of ['countryOverrides','countriesData','territorialUnits']) assert.equal(retired in state,false);
});

test('hierarchy root follows subtree reparenting without persisted sovereignId', () => {
  const { store,repo } = fixture();
  assert.equal(repo.root('T').id,'A');
  store.setField('S','parentId','B');
  assert.equal(repo.root('T').id,'B');
  assert.equal(repo.root('R').id,'R');
  assert.ok(store.snapshot().every(entity => !Object.hasOwn(entity.properties,'sovereignId')));
  assert.throws(() => store.setField('S','parentId','T'),/순환/);
  assert.equal(repo.get('S').properties.parentId,'B');
});

test('multi-step removal and dependent reassignment publish once, invalid result publishes nothing', () => {
  const { state,store,repo,publications } = fixture();
  const original = state.territorialEntities;
  assert.throws(() => store.transaction(() => store.removeEntities(['A'])),/상위 단위|부모/);
  assert.equal(state.territorialEntities,original); assert.equal(publications.length,0);
  store.transaction(() => {
    store.removeEntities(['A']);
    assert.equal(state.territorialEntities,original);
    assert.equal(repo.root('T').id,'A');
    store.setField('S','parentId','B');
  });
  assert.equal(publications.length,1);
  assert.equal(repo.get('A'),null); assert.equal(repo.root('T').id,'B');
  const after = state.territorialEntities;
  assert.throws(() => store.applyChanges({features:[entity('B','general'),entity('B','regional')]}),/ID/);
  assert.equal(state.territorialEntities,after);
});

test('reparenting keeps identity and descendants in a single publication', () => {
  const { store,repo,publications } = fixture();
  const a=repo.get('A');
  store.transaction(() => {
    store.removeEntities(['A']);
    store.applyChanges({ features: [entity('A','general',{geometry:a.geometry,parentId:'B'})] });
  });
  assert.equal(publications.length,1);
  assert.equal(repo.get('A').properties.entityKind,'general');
  assert.equal(repo.get('T').properties.parentId,'S');
  assert.equal(repo.root('T').id,'B');
});

test('full project and autosave delta round-trip common metadata, relationships and geometry', () => {
  const { store,repo }=fixture();
  const base=store.snapshot();
  store.setField('A','notes','country memo');
  store.setField('A','flagDataUrl','data:image/png;base64,eA==');
  store.setField('S','parentId','B');
  store.setField('R','name','new region');
  store.applyChanges({features:[{...repo.get('T'),geometry:polygon(5)}]});
  const entities=store.snapshot();
  const full=serializer({territorialEntities:entities}).buildProject();
  assertCurrentProjectSchema(JSON.parse(JSON.stringify(full)));
  assert.deepEqual(full.territorialEntities,entities);
  assert.equal(full.territorialModel.storage,'territorialEntities');
  const removed=['A'];
  const changed=entities.filter(entity=>entity.id !== 'A');
  const delta=serializer({territorialEntities:changed,entityDelta:{changed,removedIds:removed},fullAutosave:false}).buildAutosave();
  assertCurrentProjectSchema(delta);
  const restored=restoreEntitiesFromDelta(JSON.parse(JSON.stringify(delta)),{base});
  assert.deepEqual(restored,changed);
  assert.equal(territorialRootId(restored.find(entity=>entity.id==='T'),id=>restored.find(entity=>entity.id===id)),'B');
  for(const retired of ['countriesData','countryOverrides','territorialUnits','countryDelta']) assert.equal(retired in full,false);
});

test('Undo snapshots restore metadata, geometry, parent chain and dirty IDs together', () => {
  const { state,store,repo }=fixture(); const copies=createGeometrySnapshotPool();
  const before=copies.clone(store.snapshot()); const originalGeometry=repo.get('S').geometry;
  store.applyChanges({features:[{...repo.get('S'),geometry:polygon(5),properties:{...repo.get('S').properties,parentId:'B',name:'moved'}}]});
  store.setField('A','color','#123456');
  const after=copies.clone(store.snapshot());
  store.replaceEntities(copies.restore(before,state.territorialEntities));
  assert.deepEqual(store.snapshot(),before);
  assert.equal(repo.root('T').id,'A');
  assert.deepEqual(repo.get('S').geometry,originalGeometry);
  store.replaceEntities(copies.restore(after,state.territorialEntities));
  assert.equal(repo.get('S').properties.name,'moved');
  assert.equal(repo.root('T').id,'B');
});

test('current schema rejects split storage, retired versions, malformed delta and dangling parents', () => {
  const {store}=fixture(); const full=serializer({territorialEntities:store.snapshot()}).buildProject();
  assert.throws(()=>assertCurrentProjectSchema({...full,schemaVersion:6}),/schemaVersion/);
  assert.throws(()=>assertCurrentProjectSchema({...full,countryOverrides:{}}),/countryOverrides/);
  assert.throws(()=>normalizeTerritorialEntities([entity('X','general',{parentId:'missing'})]),/상위 단위|부모/);
  assert.throws(()=>normalizeTerritorialEntities([entity('X','regional',{parentId:'B'}),entity('B','general')]),/부모/);
  assert.throws(()=>normalizeTerritorialEntities([entity('R','regional'),entity('X','general',{parentId:'R'})]),/일반객체/);
  assert.throws(()=>assertCurrentProjectSchema({...full,format:'pandolab-autosave-delta',entityDelta:{changed:full.territorialEntities,removedIds:['A']}}),/삭제 ID/);
});
