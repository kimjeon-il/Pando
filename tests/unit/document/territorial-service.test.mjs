import { describe as contractSuite } from 'node:test';
import * as __country_dep0 from "../../helpers/timeline-project.mjs";
import * as __country_dep1 from "node:assert/strict";
import * as __country_dep2 from "node:test";
import * as __country_dep3 from "../../../src/document/territorial-units.js";
import * as __country_dep4 from "../../../src/document/territorial-entity-store.js";
import * as __country_dep5 from "../../../src/document/territorial-entity-repository.js";
import * as __country_dep6 from "../../helpers/core-command-services/territorial-service.mjs";
import * as __country_dep7 from "../../../src/geometry/spatial-index.js";
import * as __country_dep8 from "../../../src/rendering/country-mesh-content-key.js";
import * as __country_dep9 from "../../../src/ui/country-flags.js";
import * as __country_dep10 from "../../../src/rendering/map-render-coordinator.js";
contractSuite("territorial-service", () => {
const { testCoreProject, initializeTestTerritorialState, executeTerritorialTestCommand } = __country_dep0;
const assert = __country_dep1.default;
const test = __country_dep2.default;
const { createTerritorialFeature } = __country_dep3;
const { createTerritorialEntityStore } = __country_dep4;
const { createTerritorialEntityRepository } = __country_dep5;
const { createTerritorialApplicationService } = __country_dep6;









async function fixture() {
  const state = {
    territorialEntities:[createTerritorialFeature({id:'country-a',entityKind: 'general',name:'A',geometry:{type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[1,0],[0,0]]]}}),createTerritorialFeature({id:'unit-a',entityKind: 'regional',name:'Region',geometry:{type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[1,0],[0,0]]]}})],
    countryIndex: new Map([['country-a', 0]]),
  };
  const transactions = [];
  await initializeTestTerritorialState(state,null,{platformPorts:{onProjectChanged:event=>transactions.push(event)}});
const entityStore = createTerritorialEntityStore({ documentModel:testCoreProject(state).documentModel,commandOwner:testCoreProject(state).client });
  const entityRepository = createTerritorialEntityRepository({ entityStore: entityStore });
  const service = createTerritorialApplicationService({ createId: () => globalThis.crypto.randomUUID(),
    entityRepository,
    commandOwner:testCoreProject(state).project,
  });
  return {
    service,
    entityRepository,
    entityStore,
    transactions,
    units: () => state.territorialEntities,
    state,
  };
}

test('territorial service exposes commands without transaction or validation forwarding aliases', async () => {
  const { service } = await fixture();
  assert.equal(Object.hasOwn(service, 'runGeometryTransaction'), false);
  assert.equal(Object.hasOwn(service, 'validateRelations'), false);
});

test('country date editing respects the activation guard locks and normalized no-ops', async () => {
  const { service, state, transactions } = await fixture();
  assert.equal((await service.updateMetadata('country-a', 'validFrom', '')).changed, false);
  assert.equal((await service.updateMetadata('country-a', 'validFrom', '1900')).code, 'TIMELINE_ACTIVATION');
  assert.equal(state.territorialEntities[0].properties.validFrom, null);
  assert.deepEqual([...state.historyDirtyEntityIds], []);
  const count = transactions.length;
  assert.equal((await service.updateMetadata('country-a', 'validFrom', null)).changed, false);
  assert.equal((await service.updateMetadata('country-a', 'validTo', '0')).code, 'invalid-temporal');
  assert.equal(transactions.length, count);
  (await service.setLocked('country-a', true));
  assert.equal((await service.updateMetadata('country-a', 'validFrom', '1910')).code, 'locked');
  assert.equal(state.territorialEntities[0].properties.validFrom, null);
});

test('one info period command validates both endpoints and preserves the activation boundary atomically', async () => {
  const { service, state, transactions } = await fixture();
  const before = state.territorialEntities;
  for (const value of [
    { validFrom: '1871-01-18', validTo: '1918-11-09' },
    { validFrom: '1871-01-18', validTo: null },
    { validFrom: null, validTo: '1918-11-09' },
  ]) {
    assert.equal((await service.updateMetadata('country-a', 'validity', value)).code, 'TIMELINE_ACTIVATION');
    assert.equal(state.territorialEntities, before);
    assert.equal(transactions.length, 0);
  }
  for (const value of [
    null, {}, { validFrom: null }, '1900 ~ 1901',
    { validFrom: '1900-02-29', validTo: null },
    { validFrom: '1918', validTo: '1871' },
    { validFrom: null, validTo: '0000' },
  ]) assert.equal((await service.updateMetadata('country-a', 'validity', value)).code, 'invalid-temporal');
  assert.deepEqual([...state.historyDirtyEntityIds], []);
  assert.equal(transactions.length, 0);
  assert.equal((await service.updateMetadata('country-a', 'validity', { validFrom: null, validTo: null })).changed, false);
  (await service.setLocked('country-a', true));
  assert.equal((await service.updateMetadata('country-a', 'validity', { validFrom: null, validTo: null })).code, 'locked');
});

test('common flag fields distinguish custom, hidden and default for countries and units', async () => {
  const { service, entityRepository, transactions } = await fixture();
  for (const id of ['country-a', 'unit-a']) {
    assert.equal((await service.updateMetadata(id, 'flagDataUrl', undefined)).changed, false);
    assert.equal((await service.updateMetadata(id, 'flagDataUrl', 'data:image/svg+xml,test')).changed, true);
    assert.equal(entityRepository.get(id).properties.metadata.flagDataUrl, 'data:image/svg+xml,test');
    const count = transactions.length;
    assert.equal((await service.updateMetadata(id, 'flagDataUrl', 'data:image/svg+xml,test')).changed, false);
    assert.equal(transactions.length, count);
    assert.equal((await service.updateMetadata(id, 'flagDataUrl', null)).changed, true);
    assert.equal(entityRepository.get(id).properties.metadata.flagDataUrl, null);
    assert.equal((await service.updateMetadata(id, 'flagDataUrl', undefined)).changed, true);
    assert.equal(Object.hasOwn(entityRepository.get(id).properties.metadata, 'flagDataUrl'), false);
    assert.equal((await service.updateMetadata(id, 'flagDataUrl', '')).code, 'invalid-flag');
  }
});

test('country name reset and territorial color reset remove explicit fields and repeated resets do nothing', async () => {
  const { service, entityRepository, transactions } = await fixture();
  assert.equal((await service.updateMetadata('country-a', 'name', 'A')).changed, false);
  (await service.updateMetadata('country-a', 'name', ' Custom '));
  assert.equal(entityRepository.get('country-a').properties.name, 'Custom');
  (await service.updateMetadata('country-a', 'name', ''));
  assert.equal(entityRepository.get('country-a').properties.name, '');
  for (const id of ['country-a', 'unit-a']) {
    (await service.updateMetadata(id, 'color', '#123456'));
    (await service.updateMetadata(id, 'color', ''));
    assert.equal(Object.hasOwn(entityRepository.get(id).properties.style, 'color'), false);
    const count = transactions.length;
    assert.equal((await service.updateMetadata(id, 'color', '')).changed, false);
    assert.equal(transactions.length, count);
  }
});

test('territorial deletion preflight shares lock and child rules across entity types', async () => {
  const { service, entityStore, state } = await fixture();

  assert.equal(service.canDelete('unit-a').ok, true);
  (await service.setLocked('unit-a', true));
  assert.equal(service.canDelete('unit-a').code, 'locked');
  (await service.setLocked('unit-a', false));

  await executeTerritorialTestCommand(state,'territorial.replace',{features:[
    ...entityStore.snapshot().filter(entity => entity.properties.entityKind === 'general' && !entity.properties.parentId),
    createTerritorialFeature({id:'parent',entityKind: 'general',parentId:'country-a',geometry:{type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[1,0],[0,0]]]}}),
    createTerritorialFeature({id:'child',entityKind: 'general',parentId:'parent',geometry:{type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[1,0],[0,0]]]}}),
  ]});
  const parent = service.canDelete('parent');
  assert.equal(parent.code, 'has-children');
  assert.deepEqual(parent.children.map(item => item.id), ['child']);

  const country = service.canDelete('country-a');
  assert.equal(country.code, 'has-children');
  assert.deepEqual(country.children.map(item => item.id), ['parent']);
});

test('territorial service owns metadata transaction and lock enforcement', async () => {
  const { service, entityRepository, transactions } = await fixture();
  assert.equal(entityRepository.get('country-a')?.id, 'country-a');
  assert.deepEqual(entityRepository.list({ kind: 'regional' }).map(item => item.id), ['unit-a']);
  assert.equal((await service.updateMetadata('unit-a', 'name', 'Changed')).ok, true);
  assert.equal(entityRepository.get('unit-a').properties.name, 'Changed');
  assert.equal((await service.setLocked('unit-a', true)).changed, true);
  assert.deepEqual((await service.updateMetadata('unit-a', 'name', 'Blocked')), {
    ok: false, code: 'locked', unit: entityRepository.get('unit-a'),
  });
  assert.equal(entityRepository.get('unit-a').properties.name, 'Changed');
  assert.deepEqual(transactions.map(item => item.reason), ['territorial.metadata', 'territorial.lock']);
});

test('batch color command updates countries and units in one document mutation', async () => {
  const { service, entityRepository, transactions } = await fixture();
  const result = (await service.setColorBatch([
    { type: 'country', id: 'country-a' },
    { type: 'region', id: 'unit-a' },
  ], '#123456', {
    history: { type: 'batch-color', description: '2개 객체 색상 변경' },
  }));

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(entityRepository.get('country-a').properties.style.color, '#123456');
  assert.equal(entityRepository.get('unit-a').properties.style.color, '#123456');
  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].reason,'territorial.color');

  const count = transactions.length;
  assert.equal((await service.setColorBatch([
    { type: 'country', id: 'country-a' },
    { type: 'region', id: 'unit-a' },
  ], '#123456')).changed, false);
  assert.equal(transactions.length, count);
});

test('batch lock command updates countries and units in one document mutation', async () => {
  const { service, entityRepository, transactions } = await fixture();
  const result = (await service.setLockedBatch([
    { type: 'country', id: 'country-a' },
    { type: 'region', id: 'unit-a' },
  ], true, {
    history: { type: 'batch-lock', description: '2개 객체 잠금' },
  }));

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(service.isLocked('country-a'), true);
  assert.equal(entityRepository.get('unit-a').properties.locked, true);
  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].reason,'territorial.lock');

  const count = transactions.length;
  assert.equal((await service.setLockedBatch([
    { type: 'country', id: 'country-a' },
    { type: 'region', id: 'unit-a' },
  ], true)).changed, false);
  assert.equal(transactions.length, count);
});

test('simple unit metadata writes publish the common collection without mutating the old one', async () => {
  const { service, entityRepository, transactions, units } = await fixture();
  const before = units();

  assert.equal((await service.updateMetadata('unit-a', 'name', 'Renamed')).changed, true);
  assert.equal((await service.updateMetadata('unit-a', 'notes', 'Memo')).changed, true);
  assert.equal((await service.updateMetadata('unit-a', 'color', '#123456')).changed, true);

  assert.notEqual(units(), before);
  assert.equal(entityRepository.get('unit-a').properties.name, 'Renamed');
  assert.equal(entityRepository.get('unit-a').properties.notes, 'Memo');
  assert.equal(entityRepository.get('unit-a').properties.style.color, '#123456');
  assert.deepEqual(transactions.map(item => item.reason), [
    'territorial.metadata',
    'territorial.metadata',
    'territorial.metadata',
  ]);
});

test('temporal unit metadata is normalized and rejected before mutation when invalid', async () => {
  const { service, entityRepository, transactions, units } = await fixture();
  const before = units();

  assert.equal((await service.updateMetadata('unit-a', 'validFrom', '1900')).code, 'TIMELINE_ACTIVATION');
  assert.equal(entityRepository.get('unit-a').properties.validFrom, null);

  const count = transactions.length;
  const invalid = (await service.updateMetadata('unit-a', 'validTo', '0'));
  assert.equal(invalid.ok, false);
  assert.equal(invalid.code, 'invalid-temporal');
  assert.equal(transactions.length, count);
  assert.equal(entityRepository.get('unit-a').properties.validTo, null);

  assert.equal((await service.updateMetadata('unit-a', 'validFrom', '')).changed, false);
  assert.equal(entityRepository.get('unit-a').properties.validFrom, null);
  assert.equal(units(), before);
});



test('administrative parent changes use the explicit relation command and validate cycles', async () => {
  const { service, entityStore, entityRepository, transactions, state } = await fixture();
  await executeTerritorialTestCommand(state,'territorial.replace',{features:[
    ...entityStore.snapshot().filter(entity => entity.properties.entityKind === 'general' && !entity.properties.parentId),
    createTerritorialFeature({id:'p',entityKind: 'general',parentId:'country-a',geometry:{type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[1,0],[0,0]]]}}),
    createTerritorialFeature({id:'s',entityKind: 'general',parentId:'p',geometry:{type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[1,0],[0,0]]]}}),
  ]});
  const count = transactions.length;

  const cycle = (await service.changeAdministrativeParent('p', 's'));
  assert.equal(cycle.ok, false);
  assert.equal(cycle.code, 'invalid-parent');
  assert.equal(transactions.length, count);

  const rejectedByGeometry = (await service.changeAdministrativeParent('s', 'country-a', {
    validateCandidate: () => ({ ok: false, issues: ['outside-parent'] }),
  }));
  assert.equal(rejectedByGeometry.code, 'invalid-parent-geometry');
  assert.equal(transactions.length, count);

  const changed = (await service.changeAdministrativeParent('s', 'country-a'));
  assert.equal(changed.changed, true);
  assert.equal(entityRepository.get('s').properties.parentId, 'country-a');
  assert.equal(transactions.at(-1).reason,'territorial.parent');
});



test('unit metadata service also rejects administrative relation fields, including no-op values', async () => {
  const { service, entityRepository, transactions } = await fixture();
  assert.equal(entityRepository.get('unit-a').properties.parentId,'');
  for (const [field, value] of [['parentId', ''], ['entityKind', 'regional']]) {
    const result = (await service.updateMetadata('unit-a', field, value));
    assert.equal(result.ok, false);
    assert.equal(result.code, 'unsupported-relation-field');
  }
  assert.equal(transactions.length, 0);
});

test('country metadata service does not accept administrative or political relation fields', async () => {
  const { service, entityRepository, transactions } = await fixture();
  for (const field of ['parentId', 'entityKind']) {
    const result = (await service.updateMetadata('country-a', field, 'other'));
    assert.equal(result.ok, false);
    assert.equal(result.code, 'unsupported-relation-field');
  }
  assert.equal(transactions.length, 0);
  assert.equal(entityRepository.get('country-a').properties.parentId, '');
});

test('independent regional objects reject administrative parents', async () => {
  const { service, entityRepository, transactions } = await fixture();
  assert.equal((await service.changeAdministrativeParent('unit-a', 'country-a')).code, 'unsupported-parent-type');
  assert.equal(entityRepository.get('unit-a').properties.parentId, '');
  assert.equal(transactions.length, 0);
  assert.equal('changeAdministrativeCountry' in service, false);
});


test('country-specific metadata uses the common entity metadata surface for no-op detection', async () => {
  const { service, entityRepository, transactions } = await fixture();
  assert.equal((await service.updateMetadata('country-a', 'capital', 'Capital')).changed, true);
  assert.equal(entityRepository.get('country-a').properties.metadata.capital, 'Capital');
  const count = transactions.length;
  assert.equal((await service.updateMetadata('country-a', 'capital', 'Capital')).changed, false);
  assert.equal(transactions.length, count);

  assert.equal((await service.updateMetadata('country-a', 'flagDataUrl', null)).changed, true);
  const flagCount = transactions.length;
  assert.equal((await service.updateMetadata('country-a', 'flagDataUrl', null)).changed, false);
  assert.equal(transactions.length, flagCount);
});
});
contractSuite("territorial-property-only-p4-3", () => {
const test = __country_dep2.default;
const assert = __country_dep1.default;
const { classifyTerritorialPropertyOnly, createTerritorialEntityStore } = __country_dep4;
const { createSpatialIndex } = __country_dep7;
const { countryMeshContentKey } = __country_dep8;
const { effectiveTerritorialFlagUrl } = __country_dep9;
const { MAP_RENDER_DIRTY, MAP_RENDER_MASKS } = __country_dep10;








const geo=(x=0)=>({type:'Polygon',coordinates:[[[x,0],[x+2,0],[x+2,2],[x,2],[x,0]]]});
function country(id,x=0){
  return {id,type:'Feature',geometry:geo(x),properties:{
    entityKind:'general',parentId:'',name:id,
    style:{color:'#112233',opacity:1},metadata:{flagDataUrl:'data:image/png;base64,eA=='},
  }};
}
const clone=rows=>structuredClone(rows);

test('P4-3 changed name, flag and color retain exact canonical mesh but update presentation data',async()=>{
  const before=[country('A'),country('B',5)],after=clone(before);
  after[0].properties.name='Renamed A';
  after[0].properties.metadata.flagDataUrl='data:image/png;base64,Zg==';
  after[0].properties.style.color='#445566';
  const diff=classifyTerritorialPropertyOnly(before,after);
  assert.deepEqual(diff?.paintChangedIds,['A']);
  assert.deepEqual(diff?.labelChangedIds,['A']);
  assert.equal(await countryMeshContentKey(before),await countryMeshContentKey(after));
  assert.equal(effectiveTerritorialFlagUrl(after[0]),'data:image/png;base64,Zg==');
  assert.notEqual(before[0].properties.name,after[0].properties.name);
  assert.ok(MAP_RENDER_MASKS.PROJECT&MAP_RENDER_DIRTY.PROJECT,
    'full project invalidation retains neighboring label collision layout');
});

test('P4-3 geometry, country membership/order and hierarchy changes use the conservative path',async()=>{
  const before=[country('A'),country('B',5)];
  const mutations=[
    rows=>{rows[0].geometry.coordinates[0][1][0]+=0.00000001;},
    rows=>{rows[0].geometry.coordinates.push([[0.3,0.3],[0.8,0.3],[0.8,0.8],[0.3,0.8],[0.3,0.3]]);},
    rows=>{rows[0].properties.parentId='B';},
    rows=>{rows[0].properties.entityKind='regional';},
    rows=>{rows[0].properties.metadata.sourceGeometryVersion='new';},
    rows=>{rows[0].properties.style.opacity=0.8;},
    rows=>{rows.reverse();},
    rows=>{rows.pop();},
    rows=>{rows[1].id='other';},
  ];
  for(const mutate of mutations){
    const after=clone(before);mutate(after);
    assert.equal(classifyTerritorialPropertyOnly(before,after),null,'unverified changes must not reuse spatial geometry');
  }
  const altered=clone(before);altered[0].geometry.coordinates[0][1][0]+=0.00000001;
  assert.notEqual(await countryMeshContentKey(before),await countryMeshContentKey(altered));
});

test('P4-3 Core projection event distinguishes property-only from spatial changes',()=>{
  let rows=[country('A')],notify;
  const published=[];
  const store=createTerritorialEntityStore({
    documentModel:{territorialViews:()=>rows,list:()=>[],world:()=>({}),projectWorld:()=>({})},
    commandOwner:{state:()=>({}),resolveWorld:async()=>({}),setTimelineCursor:async()=>({state:{timelineCursor:'1953-12'}}),
      subscribeTransitions:handler=>{notify=handler;return ()=>{};}},
    onEntitiesReplaced:(_,state)=>published.push(state),
  });
  rows=clone(rows);rows[0].properties.name='new';
  notify();
  assert.equal(published[0].propertyOnly,true);
  assert.equal(published[0].rootGeometryChanged,false);
  assert.deepEqual(published[0].labelChangedIds,['A']);
  assert.deepEqual(published[0].paintChangedIds,[]);
  rows=clone(rows);rows[0].geometry.coordinates[0][1][0]+=0.2;
  notify();
  assert.equal(published[1].propertyOnly,false);
  assert.equal(published[1].rootGeometryChanged,true);
  store.dispose();
});

test('P4-3 spatial records keep exact bounds and IDs after an attribute-only source retarget',()=>{
  let rows=[country('A')],upserts=0,clears=0;
  const spatialRecords=new Map(),distributionRows=[];
  const index={clearDomain:domain=>{clears++;for(const [key,entry] of spatialRecords)if(entry.domain===domain)spatialRecords.delete(key);},
    upsert:item=>{upserts++;spatialRecords.set(item.key,item);}};
  const state={labels:[],genericFeatures:[],hydroEdits:[],size:{width:800,height:600},projection:'globe'};
  const spatial=createSpatialIndex();
  spatial.connect({
    spatialFactories:{createMapObjectSpatialIndex:()=>index},
    projectState:{state},territorialModel:{entityRepository:{list:()=>rows}},
    domains:{renderingDomain:{getDistributionRenderRows:()=>distributionRows}},
    cutGeometry:{coordinateBounds:()=>[0,0,2,2]},
  });
  spatial.initializeGeometryBoundsCache();
  spatial.initializeMapObjectSpatialIndex();
  spatial.rebuildMapObjectSpatialIndex();
  const initial={upserts,clears,records:[...spatialRecords.values()].map(x=>({...x}))};
  rows=clone(rows);rows[0].properties.name='Renamed A';
  assert.ok(classifyTerritorialPropertyOnly([country('A')],rows));
  assert.equal(spatial.retainTerritorialSpatialIndex(rows),true);
  spatial.rebuildMapObjectSpatialIndex();
  assert.equal(upserts,initial.upserts);
  assert.equal(clears,initial.clears);
  assert.deepEqual([...spatialRecords.values()],initial.records);
  rows=clone(rows);rows[0].geometry.coordinates[0][1][0]+=0.25;
  spatial.mapObjectGeometryRevisions.territorial++;
  spatial.rebuildMapObjectSpatialIndex();
  assert.ok(upserts>initial.upserts);
});

test('P4-3 a mass snapshot clone preserves the existing full validation path',()=>{
  const before=Array.from({length:25},(_,i)=>country(String(i),i*3));
  const after=clone(before);
  for(const feature of after)feature.properties.name='renamed '+feature.id;
  assert.equal(classifyTerritorialPropertyOnly(before,after),null,
    'a mass clone must never add a second unbounded geometry scan before canonical digest');
});

test('P4-3 skipped property-only contract never includes unsupported fields',()=>{
  const before=[country('A')],after=clone(before);
  after[0].properties.notes='not a paint property';
  assert.equal(classifyTerritorialPropertyOnly(before,after),null);
  const same=clone(before);
  assert.deepEqual(classifyTerritorialPropertyOnly(before,same)?.paintChangedIds,[]);
  same[0].geometry=before[0].geometry;
  // A borrowed mutable geometry cannot prove unchanged coordinates.
  assert.equal(classifyTerritorialPropertyOnly(before,same),null);
  Object.freeze(before[0].geometry); // Shallow freezing is not provenance.
  assert.equal(classifyTerritorialPropertyOnly(before,same),null);
});
});
