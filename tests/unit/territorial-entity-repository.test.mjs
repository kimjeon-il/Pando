import "../../shared/frontend/js/vendor/polygon-clipping.min.js";
import "../../tools/load-spherical-core.mjs";
import { describe as contractSuite } from 'node:test';
import * as __dep0 from "../helpers/timeline-project.mjs";
import * as __dep1 from "node:test";
import * as __dep2 from "node:assert/strict";
import * as __dep3 from "../../shared/frontend/js/modules/territorial-units.js";
import * as __dep4 from "../../shared/frontend/js/modules/territorial-entity-store.js";
import * as __dep5 from "../../shared/frontend/js/modules/territorial-entity-repository.js";
import * as __dep6 from "node:fs";
import * as __dep7 from "node:vm";
import * as __dep8 from "../../shared/frontend/js/modules/territorial-scope.js";
import * as __dep9 from "../../shared/frontend/js/modules/color-adapter.js";
import * as __dep10 from "../../shared/frontend/js/modules/map-object-categories.js";
import * as __dep11 from "../../shared/frontend/js/modules/map-edit-geometry.js";
import * as __dep12 from "../../shared/frontend/js/modules/geometry-versions.js";
import * as __dep13 from "../../tools/gis/territorial-geometry.js";
import * as __dep14 from "../../tools/library-data.mjs";

// Original feature contract: territorial-entity-repository.test.mjs
contractSuite("territorial-entity-repository", () => {
const { executeTerritorialTestCommand, testCoreProject, initializeTestTerritorialState } = __dep0;
const test = __dep1.default;
const assert = __dep2.default;
const { createTerritorialFeature } = __dep3;
const { createTerritorialEntityStore } = __dep4;
const { createTerritorialEntityRepository } = __dep5;
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
});

// Original feature contract: territorial-hierarchy-model.test.mjs
contractSuite("territorial-hierarchy-model", () => {
const { testCoreProject, initializeTestTerritorialState, executeTerritorialTestCommand } = __dep0;
const { createTerritorialEntityStore } = __dep4;
const assert = __dep2.default;
const test = __dep1.default;
const fs = __dep6.default;
const vm = __dep7.default;
const { createTerritorialFeature, normalizeTerritorialEntities, TERRITORIAL_ENTITY_KINDS } = __dep3;
const { createTerritorialScopeResolver } = __dep8;
const { createTerritorialEntityRepository } = __dep5;
const { resolveTerritorialColor } = __dep9;
const { MAP_OBJECT_TYPES } = __dep10;

const context = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL("../../shared/frontend/js/vendor/polygon-clipping.min.js", import.meta.url), 'utf8'), context);
const engine = context.polygonClipping;
const geometry = (x = 0) => ({ type: 'Polygon', coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]]] });
const unit = (id, parentId = 'DNK', extra = {}) => createTerritorialFeature({ id, entityKind: 'general', parentId, coverageMode: 'explicit', geometry: geometry(4), ...extra });

test('public territorial model and object registry contain only the current kinds and one ref type', () => {
  assert.deepEqual(Object.values(TERRITORIAL_ENTITY_KINDS), ['general', 'regional']);
  assert.deepEqual(Object.values(MAP_OBJECT_TYPES).filter(item => item.domain === 'territorial').map(item => item.type), ['entity']);
  for (const entityKind of ['country', 'subunit', 'region']) assert.throws(() => createTerritorialFeature({ id: entityKind, entityKind, geometry: geometry() }));
});









test('the canonical hierarchy rejects regional parents and cycles', () => {
  const roots = ['DNK', 'SWE'].map(id => createTerritorialFeature({ id, entityKind: 'general', geometry: geometry() }));
  const parent = unit('p'), child = unit('c', 'p', { locked: true });
  assert.throws(() => normalizeTerritorialEntities([...roots, { ...parent, properties: { ...parent.properties, entityKind: 'regional', parentId: '' } }, child]), /상위|일반/);
  assert.throws(() => normalizeTerritorialEntities([...roots, { ...parent, properties: { ...parent.properties, parentId: 'c' } }, child]), /순환/);
});

test('rank is discarded while nested general objects and cycle checks remain available', () => {
  const parent = unit('p'), child = unit('c', 'p', { adminLevel: 8 });
  assert.equal(parent.properties.adminLevel, undefined);
  assert.equal(normalizeTerritorialEntities([parent, child],{getEntity:id=>id==='DNK'?createTerritorialFeature({id,entityKind:'general',geometry:geometry()}):null})[1].properties.adminLevel, undefined);
  parent.properties.parentId = 'c';
  assert.throws(() => normalizeTerritorialEntities([parent, child]), /순환/);
});

test('country extent includes detached descendants once and caches geometry work', async () => {
  const country = { type: 'Feature', id: 'DNK', properties: {}, geometry: geometry() };
  let unions = 0;
  const units = [unit('p'), unit('c', 'p', { geometry: geometry(4.5), color: '#ee8800' })];
  const before = structuredClone({ country, units });
  const state={territorialEntities:[createTerritorialFeature({id:'DNK',entityKind:'general',geometry:country.geometry}),...units]};
  await initializeTestTerritorialState(state);
  const repository=createTerritorialEntityRepository({entityStore:createTerritorialEntityStore({ documentModel:testCoreProject(state).documentModel,commandOwner:testCoreProject(state).client })});
  const resolver = createTerritorialScopeResolver({
    entityRepository: repository,
    clipper: () => ({ difference: engine.difference, union: (...args) => { unions++; return engine.union(...args); } }),
  });
  const first = resolver.scope('DNK');
  assert.deepEqual(first.members.map(item => item.id), ['p', 'c']);
  assert.equal(first.extent.geometry.coordinates.length, 2);
  assert.ok(first.extra.geometry.coordinates.length);
  assert.equal(resolver.scope('DNK'), first);
  assert.equal(unions, 1);
  assert.equal(resolveTerritorialColor(units[0], { entityRepository: repository, countryColor: () => '#123456' }), '#123456');
  assert.equal(resolveTerritorialColor(units[1], { entityRepository: repository, countryColor: () => '#123456' }), '#ee8800');
  await executeTerritorialTestCommand(state,'territorial.metadata',{id:'DNK',field:'notes',valuePresent:true,value:'new revision'});
  const updated=resolver.scope('DNK');
  assert.notStrictEqual(updated,first);assert.equal(updated.entity.properties.notes,'new revision');
  assert.strictEqual(updated.extent.geometry,first.extent.geometry);
  assert.strictEqual(updated.extra.geometry,first.extra.geometry);assert.equal(unions,1);
  await executeTerritorialTestCommand(state,'territorial.geometry',{id:'DNK',geometry:{type:'Polygon',coordinates:[[[0,0],[6,0],[6,1],[0,1],[0,0]]]}});
  assert.notStrictEqual(resolver.scope('DNK').extent.geometry,first.extent.geometry);assert.equal(unions,2);
  assert.deepEqual({ country, units }, before);
});

test('parent style inheritance stops at explicit style without changing country palette', async () => {
  const units = [unit('p', 'DNK', { color: '#ff9900' }), unit('c', 'p')];
  const state = { territorialEntities: [createTerritorialFeature({ id:'DNK',entityKind:'general',geometry:geometry() }), ...units] };
  await initializeTestTerritorialState(state);
  const repository = createTerritorialEntityRepository({ entityStore: createTerritorialEntityStore({ documentModel:testCoreProject(state).documentModel,commandOwner:testCoreProject(state).client }) });
  assert.equal(resolveTerritorialColor(units[1], { entityRepository: repository, countryColor: () => '#112233' }), '#ff9900');
});
});

// Original feature contract: territorial-scope.test.mjs
contractSuite("territorial-scope", () => {
const { executeTerritorialTestCommand, testCoreProject, initializeTestTerritorialState } = __dep0;
const test = __dep1.default;
const assert = __dep2.default;
const { createTerritorialEntityStore } = __dep4;
const { createTerritorialEntityRepository } = __dep5;
const { createTerritorialScopeResolver } = __dep8;
const { createTerritorialFeature } = __dep3;
const { hasCanonicalPolygonWinding, area } = __dep11;
const { touchGeometry } = __dep12;
const square = (x0, x1) => ({ type: 'Polygon', coordinates: [[[x0,0],[x0,2],[x1,2],[x1,0],[x0,0]]] });

test('every general hierarchy level has an immutable canonical display extent; independent regions retain their own shape', async () => {
  const make = (id, parentId, x0, x1, entityKind = 'general') => createTerritorialFeature({ id, entityKind, parentId, geometry: square(x0,x1) });
  const state = { territorialEntities: [make('A','',0,2),make('B','A',1,3),make('C','B',2,4),make('D','',5,7),make('R','',0,10,'regional')] };
  await initializeTestTerritorialState(state);
const store = createTerritorialEntityStore({ documentModel:testCoreProject(state).documentModel,commandOwner:testCoreProject(state).client });
  const repo = createTerritorialEntityRepository({ entityStore: store });
  const scope = createTerritorialScopeResolver({ entityRepository: repo, getState: () => state, clipper: () => globalThis.polygonClipping });
  const before = structuredClone(state.territorialEntities);
  const first = scope.scope('A');
  assert.strictEqual(scope.scope('A'), first);
  assert.deepEqual(first.members.map(entity=>entity.id), ['B','C']);
  assert.equal(first.extent.id, 'A');
  assert.equal(area(first.extent.geometry), 8);
  assert.equal(area(scope.scope('B').extent.geometry), 6);
  assert.equal(area(scope.scope('B').extra.geometry), 2);
  assert.equal(hasCanonicalPolygonWinding(first.extent.geometry), true);
  const region = scope.scope('R');
  assert.strictEqual(region.extent, repo.get('R'));
  assert.deepEqual(region.members, []);
  assert.deepEqual(state.territorialEntities, before);
  const owner=testCoreProject(state),documentBefore=owner.project.snapshot(),clockBefore=owner.client.state();
  await assert.rejects(()=>executeTerritorialTestCommand(state,'territorial.patch',{
    features:[{...repo.get('B'),properties:{...repo.get('B').properties,parentId:'D'}}],
  }),{code:'GEOMETRY_OUTSIDE_PARENT'});
  assert.strictEqual(owner.project.snapshot(),documentBefore);assert.deepEqual(owner.client.state(),clockBefore);
  assert.strictEqual(scope.scope('A'),first);assert.equal(repo.root('C').id,'A');
  // Preserve the display-extent scenario while making the new spatial parent
  // contain B. The original disjoint D component and C extension stay intact.
  await executeTerritorialTestCommand(state,'territorial.geometry',{id:'D',geometry:{
    type:'MultiPolygon',coordinates:[square(1,3).coordinates,square(5,7).coordinates],
  }});
  await executeTerritorialTestCommand(state,'territorial.patch',{ features: [{ ...repo.get('B'), properties: { ...repo.get('B').properties, parentId: 'D' } }] });
  assert.equal(area(scope.scope('A').extent.geometry), 4);
  assert.notStrictEqual(scope.scope('A'), first);
  assert.equal(repo.root('C').id, 'D');
  assert.equal(area(scope.scope('D').extent.geometry), 10);
  assert.deepEqual(scope.scope('R').extent.geometry, region.extent.geometry);
});

test('month and style metadata reuse prepared extent; geometry edits invalidate it', () => {
  let rows = [createTerritorialFeature({ id: 'A', entityKind: 'general', geometry: square(0, 2) }),
    createTerritorialFeature({ id: 'B', entityKind: 'general', parentId: 'A', geometry: square(1, 3) })];
  const repository = { list: () => rows, get: id => rows.find(row => row.id === id), descendants: id => rows.filter(row => row.properties.parentId === id) };
  let unions = 0;
  const scope = createTerritorialScopeResolver({ entityRepository: repository, clipper: () => ({
    union: (...args) => { unions++; return globalThis.polygonClipping.union(...args); },
    difference: globalThis.polygonClipping.difference,
  }) });
  const first = scope.scope('A');
  rows = rows.map(row => ({ ...row, properties: { ...row.properties, color: '#ff0000', name: 'new month' } }));
  const next = scope.scope('A');
  assert.strictEqual(next.extent.geometry, first.extent.geometry);
  assert.strictEqual(next.extra.geometry, first.extra.geometry);
  assert.strictEqual(next.entity, rows[0]);
  assert.equal(unions, 1);
  rows[1].geometry.coordinates[0][2][0] = 4;
  touchGeometry(rows[1].geometry);
  assert.notStrictEqual(scope.scope('A').extent.geometry, first.extent.geometry);
  assert.equal(unions, 2);
});
});

// Original feature contract: territorial-geometry.test.mjs
contractSuite("territorial-geometry", () => {
const test = __dep1.default;
const assert = __dep2.default;
const { snapLineEndpointsToBoundary } = __dep13;








test('cut-line endpoint snapping uses screen distance and preserves intermediate points', () => {
  const geometry = {
    type: 'Polygon',
    coordinates: [
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
    ],
  };
  const result = snapLineEndpointsToBoundary([
    [0.8, 5],
    [5, 7],
    [9.2, 5],
  ], geometry, {
    project: ([x, y]) => [x * 10, y * 10],
    maxDistance: 10,
  });

  assert.deepEqual(result.line, [[0, 5], [5, 7], [10, 5]]);
  assert.equal(result.snaps.start.distance, 8);
  assert.equal(result.snaps.end.distance, 8);
});

test('cut-line endpoint snapping ignores holes and points outside the pixel tolerance', () => {
  const geometry = {
    type: 'Polygon',
    coordinates: [
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
    ],
  };
  const result = snapLineEndpointsToBoundary([[4.2, 5], [12, 5]], geometry, {
    project: coordinate => coordinate,
    maxDistance: 1,
  });

  assert.deepEqual(result.line, [[4.2, 5], [12, 5]]);
  assert.equal(result.snaps.start, null);
  assert.equal(result.snaps.end, null);
});
});

// Original feature contract: scoped-territorial-registration.test.mjs
contractSuite("scoped-territorial-registration", () => {
const test = __dep1.default;
const assert = __dep2.default;
const { assertTerritorialStorageScope } = __dep14;
const base='assets/data/territorial-entities';
const old={entities:[{entityId:'state:kept',lineageId:'a',file:'state-kept.json.gz',sha256:'same'}],lineages:[{schemaVersion:2,lineageId:'a',names:{en:'A'},entityRefs:['state:kept'],relations:[]}]};
function fixture(){const next=structuredClone(old);next.entities.push({entityId:'state:new',lineageId:'a',file:'state-new.json.gz',sha256:'new'});next.lineages[0].entityRefs.push('state:new');return{next,paths:[base+'/generated/v2/index.json',base+'/generated/v2/state-new.json.gz',base+'/source/countries/state-new.json',base+'/source/lineages/a.json']};}
const options=next=>({readLineage:id=>structuredClone(next.lineages.find(row=>row.lineageId===id))});
test('scoped registration requires the new source, chunk, index and exact lineage source together',()=>{
 const{next,paths}=fixture();assert.doesNotThrow(()=>assertTerritorialStorageScope(paths,next,old,options(next)));
 for(let i=0;i<paths.length;i++)assert.throws(()=>assertTerritorialStorageScope(paths.filter((_,j)=>i!==j),next,old,options(next)));
 assert.throws(()=>assertTerritorialStorageScope(paths,next,old,{readLineage:()=>old.lineages[0]}),/lineage/i);
});
test('scoped registration preserves existing membership and rejects orphan, duplicate or unselected edits',()=>{
 const{next,paths}=fixture();
 for(const mutate of [n=>n.entities.shift(),n=>n.entities.push(n.entities[1]),n=>n.lineages[0].entityRefs.pop(),n=>n.lineages[0].entityRefs.push('state:new'),n=>n.entities[0].sha256='changed']){
  const bad=structuredClone(next);mutate(bad);assert.throws(()=>assertTerritorialStorageScope(paths,bad,old,options(bad)));
 }
});
});
