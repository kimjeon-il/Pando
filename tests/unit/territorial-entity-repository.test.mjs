import { describe as contractSuite } from 'node:test';
import "../../assets/js-vendor/polygon-clipping.min.js";
import "../../tools/build/load-spherical-core.mjs";
import * as __country_dep0 from "node:test";
import * as __country_dep1 from "../helpers/timeline-project.mjs";
import * as __country_dep2 from "node:assert/strict";
import * as __country_dep3 from "../../src/document/territorial-units.js";
import * as __country_dep4 from "../../src/document/territorial-entity-store.js";
import * as __country_dep5 from "../../src/document/territorial-entity-repository.js";
import * as __country_dep6 from "node:fs";
import * as __country_dep7 from "node:vm";
import * as __country_dep8 from "../../src/document/territorial-scope.js";
import * as __country_dep9 from "../../src/ui/color-adapter.js";
import * as __country_dep10 from "../../src/document/map-object-categories.js";
import * as __country_dep11 from "../../src/geometry/map-edit-geometry.js";
import * as __country_dep12 from "../../src/geometry/geometry-versions.js";
import * as __country_dep13 from "../../tools/gis/territorial-geometry.js";
import * as __country_dep14_context from "../../tools/data/library-context.mjs";
import * as __country_dep14_reports from "../../tools/data/library-reports.mjs";
import * as __country_dep14_runtime from "../../tools/data/library-runtime.mjs";
import * as __country_dep14_publication from "../../tools/data/library-report-publication.mjs";
import * as __country_dep14_store from "../../tools/data/library-store.mjs";
const __country_dep14={...__country_dep14_context,...__country_dep14_reports,...__country_dep14_runtime,...__country_dep14_publication,...__country_dep14_store};
import * as __country_dep15 from "node:path";
import * as __country_dep16 from "node:crypto";
import * as __country_dep17 from "../../tools/gis/territorial-entity-loader.js";
import * as __country_dep18 from "../../tools/data/territorial-entity-sources.mjs";
import * as __country_dep19 from "../../src/document/country-feature.js";
contractSuite("territorial-entity-repository", () => {
const { describe : contractSuite } = __country_dep0;
const __dep0 = __country_dep1;
const __dep1 = __country_dep0;
const __dep2 = __country_dep2;
const __dep3 = __country_dep3;
const __dep4 = __country_dep4;
const __dep5 = __country_dep5;
const __dep6 = __country_dep6;
const __dep7 = __country_dep7;
const __dep8 = __country_dep8;
const __dep9 = __country_dep9;
const __dep10 = __country_dep10;
const __dep11 = __country_dep11;
const __dep12 = __country_dep12;
const __dep13 = __country_dep13;
const __dep14 = __country_dep14;
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
vm.runInContext(fs.readFileSync(new URL("../../assets/js-vendor/polygon-clipping.min.js", import.meta.url), 'utf8'), context);
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
});
contractSuite("territorial-entity-loader", () => {
const assert = __country_dep2.default;
const fs = __country_dep6.default;
const path = __country_dep15.default;
const { createHash } = __country_dep16;
const test = __country_dep0.default;
const { createTerritorialEntityLoader } = __country_dep17;
const { territorialDataRoot } = __country_dep18;







const root=path.join(territorialDataRoot,'generated/v2');
function fixture(corrupt=false,wrongMetadata=false){
 let index=fs.readFileSync(path.join(root,'index.json'));let calls=0;
 if(wrongMetadata){const raw=JSON.parse(index);raw.entities.find(e=>e.entityId==='state:KOR').lineageId='france';raw.lineages.find(l=>l.lineageId==='korea').entityRefs=raw.lineages.find(l=>l.lineageId==='korea').entityRefs.filter(id=>id!=='state:KOR');raw.lineages.find(l=>l.lineageId==='france').entityRefs.push('state:KOR');index=Buffer.from(JSON.stringify(raw));}
 const service=createTerritorialEntityLoader({indexUrl:'https://test/index.json',dataRevision:'test',indexSpec:{encoding:'identity',compressedBytes:index.length,decodedBytes:index.length,sha256:createHash('sha256').update(index).digest('hex')},cacheStorage:null,
 fetchFn:async url=>{calls++;const name=new URL(url).pathname.split('/').at(-1);return new Response(name==='index.json'?index:corrupt?new Uint8Array([1,2,3]):fs.readFileSync(path.join(root,name)));}});
 return {service,calls:()=>calls};
}
test('lazy loader fetches index once and one gzip once for concurrent requests and dated selection',async()=>{
 const f=fixture();const [a,b]=await Promise.all([f.service.loadEntity('state:KOR'),f.service.loadEntity('state:KOR')]);
 assert.equal(a,b);assert.equal(f.calls(),2);assert.equal(f.service.peek('state:KOR'),a);
 assert.equal((await f.service.loadGeometryVersion('state:KOR','2026-10-06')).versionId,'state:KOR:armistice-1953');
 assert.equal(f.calls(),2);await assert.rejects(f.service.loadEntity('state:missing'),/Unknown/);
});

test('valid index integrity cannot publish a chunk with mismatching lineage metadata',async()=>{
 const f=fixture(false,true);await assert.rejects(f.service.loadEntity('state:KOR'),/metadata mismatch/);
 assert.equal(f.service.peek('state:KOR'),null);
});
test('stored hash mismatch never publishes an entity and failed requests can retry',async()=>{
 const f=fixture(true);await assert.rejects(f.service.loadEntity('state:KOR'),/크기|무결성/);
 assert.equal(f.service.peek('state:KOR'),null);const calls=f.calls();await assert.rejects(f.service.loadEntity('state:KOR'));assert.ok(f.calls()>calls);
});
});
contractSuite("territorial-entity-store", () => {
const test = __country_dep0.default;
const assert = __country_dep2.default;
const { createTerritorialFeature, normalizeTerritorialEntities } = __country_dep3;
const { normalizeCountryFeature } = __country_dep19;
const { initializeTestTerritorialState, testCoreProject, executeTerritorialTestCommand, staticAutosaveProject } = __country_dep1;






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
  assert.deepEqual(current.timelineRecords.geometryBindings.map(binding=>binding.objectRef),
    features.map(feature=>({domain:'territorial',id:feature.id})));
  for(const binding of current.timelineRecords.geometryBindings) {
    assert.equal(Object.hasOwn(binding,'entityId'),false);
    assert.equal(binding.geometryRef.id,`territorial-geometry:${binding.objectRef.id}`);assert.equal(binding.geometryRef.version,1);
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
});
