import { describe as contractSuite } from 'node:test';
import * as __dep0 from "node:assert/strict";
import * as __dep1 from "node:test";
import * as __dep2 from "../../shared/frontend/js/modules/gpu-country-geometry-revisions.js";
import * as __dep3 from "../../shared/frontend/js/modules/geometry-version-store.js";
import * as __dep4 from "../../tools/gis/country-import-identity.js";
contractSuite("country-geometry-revision", () => {
const assert = __dep0.default;
const test = __dep1.default;
const { createCountryGeometryRevisionTracker } = __dep2;


test('a stale geometry result cannot clear a newer pending country revision', () => {
  const tracker = createCountryGeometryRevisionTracker();
  const first = tracker.beginCommit(['A', 'B']);
  const second = tracker.beginCommit(['A']);

  assert.equal(tracker.isCurrent(first.token, first.revision), false);
  assert.equal(tracker.isCurrent(second.token, second.revision), true);
  assert.deepEqual(tracker.markDisplayed(first.ids, first.revision), []);
  assert.deepEqual(new Set(tracker.pendingIds()), new Set(['A', 'B']));

  assert.deepEqual(tracker.markDisplayed(second.ids, second.revision), ['A']);
  assert.deepEqual(tracker.pendingIds(), ['B']);
  assert.equal(tracker.displayedRevision(), second.revision);
});

test('a full rebuild task atomically settles every pending country at its current revision', () => {
  const tracker = createCountryGeometryRevisionTracker();
  const commit = tracker.beginCommit(['SOURCE', 'TARGET']);
  const rebuild = tracker.beginTask(commit.revision);

  assert.equal(tracker.isCurrent(commit.token, commit.revision), false);
  assert.equal(tracker.isCurrent(rebuild.token, rebuild.revision), true);
  assert.deepEqual(
    new Set(tracker.markDisplayed(tracker.pendingIds(), rebuild.revision)),
    new Set(['SOURCE', 'TARGET']),
  );
  assert.deepEqual(tracker.pendingIds(), []);
  assert.equal(tracker.displayedRevision(), tracker.committedRevision());
});

test('reset invalidates outstanding render tasks and preserves monotonic revisions', () => {
  const tracker = createCountryGeometryRevisionTracker();
  const commit = tracker.beginCommit(['A']);
  const resetRevision = tracker.reset();

  assert.ok(resetRevision > commit.revision);
  assert.equal(tracker.isCurrent(commit.token, commit.revision), false);
  assert.deepEqual(tracker.pendingIds(), []);
});
});
contractSuite("geometry-version-store", () => {
const assert = __dep0.default;
const test = __dep1.default;
const { createGeometryVersionStore } = __dep3;

const shape = () => ({type:'Polygon',coordinates:[[[0,0],[0,2],[2,2],[2,0],[0,0]]]});
const ref = (version = 1, id = 'shape-a') => ({id,version});

test('versions are append-only and exact coordinates survive snapshots', () => {
  const store = createGeometryVersionStore();
  const first = shape(), second = shape(); second.coordinates[0][2][0] = 1.2345678901234567;
  store.insert(ref(), first); const before = store.snapshot();
  store.insert(ref(2), second);
  assert.deepEqual(store.get(ref()), first); assert.deepEqual(store.get(ref(2)), second);
  assert.equal(before.length, 1); assert.equal(store.snapshot().length, 2);
  assert.throws(() => store.insert(ref(), second), {code:'DUPLICATE_ID'});
  assert.deepEqual(store.get(ref()), first);
  const restored = createGeometryVersionStore(JSON.parse(JSON.stringify(store.snapshot())));
  assert.deepEqual(restored.snapshot(), store.snapshot());
});
test('input, snapshots and restored candidates never expose mutable coordinates', () => {
  const original = shape(); const store = createGeometryVersionStore(); store.insert(ref(), original);
  original.coordinates[0][1][1] = 999;
  assert.equal(store.get(ref()).coordinates[0][1][1], 2);
  assert.throws(() => {store.get(ref()).coordinates[0][1][1] = 88;}, TypeError);
  const snapshot = store.snapshot();
  assert.throws(() => {snapshot[0].version=42;}, TypeError);
  assert.throws(() => snapshot.push({}), TypeError);
  const fork = createGeometryVersionStore(snapshot); fork.insert(ref(2), shape());
  assert.equal(store.snapshot().length, 1); assert.equal(fork.snapshot().length, 2);
});
test('missing refs return null; IDs and numeric versions are distinct', () => {
  const store = createGeometryVersionStore();
  assert.equal(store.get(ref()), null);
  store.insert(ref(1,'a:1'), shape()); store.insert(ref(11,'a'), shape());
  store.insert(ref(4294967295), shape());
  assert.equal(store.snapshot().length,3); assert.ok(store.get(ref(4294967295)));
  assert.throws(() => store.get({id:'a',version:'11'}), {code:'INVALID_GEOMETRY'});
});
for (const version of [0,-1,1.5,4294967296,NaN,Infinity,'1',null]) {
  test(`reject invalid version ${String(version)} without mutation`, () => {
    const store = createGeometryVersionStore(); store.insert(ref(), shape()); const before = store.snapshot();
    assert.throws(() => store.insert(ref(version),shape()),{code:'INVALID_GEOMETRY'});
    assert.deepEqual(store.snapshot(),before);
  });
}
for (const [name, change] of [
  ['open ring',g=>{g.coordinates[0].pop();}],
  ['short ring',g=>{g.coordinates[0]=[[0,0],[0,1],[0,0]];}],
  ['degenerate ring',g=>{g.coordinates[0]=[[0,0],[1,1],[2,2],[0,0]];}],
  ['longitude',g=>{g.coordinates[0][1][0]=181;}],
  ['latitude',g=>{g.coordinates[0][1][1]=-91;}],
  ['NaN',g=>{g.coordinates[0][1][1]=NaN;}],
  ['infinity',g=>{g.coordinates[0][1][1]=Infinity;}],
  ['numeric string',g=>{g.coordinates[0][1][1]='2';}],
  ['third ordinate',g=>{g.coordinates[0][1].push(100);}],
  ['empty polygon',g=>{g.coordinates=[];}],
  ['unsupported type',g=>{g.type='GeometryCollection';}],
  ['unknown field',g=>{g.bbox=[0,0,2,2];}],
]) test(`reject ${name} without publishing a partial version`, () => {
  const store=createGeometryVersionStore(); store.insert(ref(),shape()); const before=store.snapshot();
  const bad=shape();change(bad);assert.throws(()=>store.insert(ref(2),bad));
  assert.deepEqual(store.snapshot(),before);assert.equal(store.get(ref(2)),null);
});
test('all canonical feature geometry types and dateline coordinates are preserved', () => {
  const values = [
    {type:'Point',coordinates:[180,90]},
    {type:'MultiPoint',coordinates:[[-180,-90],[0,0]]},
    {type:'LineString',coordinates:[[179,5],[-179,6]]},
    {type:'MultiLineString',coordinates:[[[0,0],[1,1]],[[2,2],[3,3]]]},
    shape(),
    {type:'MultiPolygon',coordinates:[shape().coordinates,[[[179,0],[179,1],[-179,1],[-179,0],[179,0]]]]},
  ];
  const store=createGeometryVersionStore();values.forEach((value,i)=>store.insert(ref(i+1),value));
  assert.deepEqual(store.snapshot().map(row=>row.geojson),values);
});
test('holes, islands and winding are not edited by storage', () => {
  const value={type:'MultiPolygon',coordinates:[[
    [[0,0],[0,5],[5,5],[5,0],[0,0]],
    [[1,1],[2,1],[2,2],[1,2],[1,1]],
  ], [[[10,10],[11,10],[11,11],[10,11],[10,10]]]]};
  const store=createGeometryVersionStore([{...ref(),geojson:value}]);
  assert.deepEqual(store.get(ref()),value);
});
test('failed restore cannot change the existing store or input', () => {
  const store=createGeometryVersionStore();store.insert(ref(),shape());
  const input=structuredClone(store.snapshot());input.push({...ref(),geojson:shape()});
  const before=structuredClone(input);
  assert.throws(()=>createGeometryVersionStore(input),{code:'DUPLICATE_ID'});
  assert.deepEqual(input,before);assert.equal(store.snapshot().length,1);
});
test('malformed archive/reference fields are rejected, not silently dropped', () => {
  assert.throws(()=>createGeometryVersionStore(null));
  for(const row of [{...ref(),geojson:shape(),extra:1},{...ref()},null,{}])
    assert.throws(()=>createGeometryVersionStore([row]));
  const store=createGeometryVersionStore();
  for(const r of [{id:'',version:1},{id:2,version:1},{...ref(),extra:1}])
    assert.throws(()=>store.insert(r,shape()));
});


test('isolated registries share only validated immutable values and still reject frozen malformed inputs', () => {
  const store=createGeometryVersionStore([{...ref(),geojson:shape()}]);
  const fork=createGeometryVersionStore(store.snapshot());
  assert.equal(fork.get(ref()),store.get(ref()));
  fork.insert(ref(2),shape()); assert.equal(store.snapshot().length,1);
  const malformed=Object.freeze({type:'Point',coordinates:Object.freeze([999,0])});
  assert.throws(()=>createGeometryVersionStore([{...ref(),geojson:malformed}]),{code:'INVALID_GEOMETRY'});
});
});
contractSuite("country-import-identity", () => {
const assert = __dep0.default;
const test = __dep1.default;
const { countryImportIdentityKey, materializeResolvedCountries, resolveCountryIdentities } = __dep4;


function country(id, name = id, properties = {}) {
  return {
    type: 'Feature', id,
    properties: { name, ...properties },
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
  };
}

function imported(sourceNamespace, sourceIdField, sourceId, name = sourceId, extraProperties = {}) {
  return {
    type: 'Feature', id: sourceId,
    properties: { name, ...extraProperties },
    importIdentity: { sourceNamespace, sourceIdField, sourceId },
    geometry: { type: 'Polygon', coordinates: [[[10, 0], [11, 0], [11, 1], [10, 0]]] },
  };
}

test('official DEU source identity resolves to the canonical DEU without assigning an early UUID', () => {
  const current = [country('DEU', '독일')];
  const incoming = imported('natural-earth', 'ADM0_A3', 'DEU', 'Germany');
  const [resolution] = resolveCountryIdentities([incoming], current);
  assert.equal(resolution.status, 'existing');
  assert.equal(resolution.editorId, 'DEU');
  assert.equal(resolution.resolutionReason, 'official-id');
  const [materialized] = materializeResolvedCountries([resolution], { createId: () => 'must-not-be-used' });
  assert.equal(materialized.id, 'DEU');
  assert.deepEqual(materialized.properties, { name: '독일' });
  assert.deepEqual(materialized.geometry, incoming.geometry);
  assert.equal('importIdentity' in materialized, false);
});

test('only trusted IDs auto-match; names and arbitrary source aliases do not', () => {
  const current = [country('DEU', '독일')];
  const official = imported('custom-atlas', 'ISO_A3', 'DEU', 'Germany');
  const sameName = imported('custom-atlas', 'custom_id', 'GERMANY-OLD', '독일');
  const resolutions = resolveCountryIdentities([official, sameName], current);
  assert.deepEqual(resolutions.map(row => row.status), ['existing', 'unresolved']);
  assert.equal(resolutions[0].resolutionReason, 'official-id');
});

test('manual new identities are not persisted and do not auto-match on a later import', () => {
  const incoming = imported('custom', 'code', 'X1', '새 국가', { color: '#ff0000', arbitrary: 'discard' });
  const sourceKey = countryImportIdentityKey(incoming);
  const unresolved = resolveCountryIdentities([incoming], []);
  assert.throws(() => materializeResolvedCountries(unresolved), /모두 확인/);
  const manuallyNew = resolveCountryIdentities([incoming], [], { manualMappings: { [sourceKey]: 'new' } });
  const [created] = materializeResolvedCountries(manuallyNew, { createId: () => 'NEW-ID' });
  assert.equal(created.id, 'NEW-ID');
  assert.deepEqual(created.properties, { name: '새 국가' });
  assert.equal('importIdentity' in created, false);
  const [repeat] = resolveCountryIdentities([incoming], [created]);
  assert.equal(repeat.status, 'unresolved');
});

test('manual existing-country mapping preserves only canonical ID name dates and incoming geometry', () => {
  const current = country('DEU', '독일', { validFrom: '1949-05-23', ignored: true });
  const incoming = imported('custom', 'code', 'GER', 'Germany', { validTo: '1990-10-02', editor_color: '#ff0000' });
  const sourceKey = countryImportIdentityKey(incoming);
  const resolutions = resolveCountryIdentities([incoming], [current], { manualMappings: { [sourceKey]: 'existing:DEU' } });
  const [materialized] = materializeResolvedCountries(resolutions);
  assert.equal(materialized.id, 'DEU');
  assert.deepEqual(materialized.properties, { name: '독일', validFrom: '1949-05-23', validTo: '1990-10-02' });
});

test('replacement preserves trusted official PandoLab and GeoJSON IDs while FIDs receive UUIDs', () => {
  const official = imported('natural-earth', 'ADM0_A3', 'DEU', 'Germany');
  const pandolab = imported('pandolab', 'pandolab_id', 'PL-DEU', '독일');
  pandolab.importIdentity.pandolabId = 'PL-DEU';
  const featureId = imported('geojson', '__feature_id__', 'HIST-DEU', '역사 독일');
  const fid = imported('vector', '__fid__', '7', '새 국가');
  const resolved = resolveCountryIdentities([official, pandolab, featureId, fid], [], { allowImplicitNew: true });
  const generated = ['NEW-FID'];
  const materialized = materializeResolvedCountries(resolved, { createId: () => generated.shift() });
  assert.deepEqual(materialized.map(feature => feature.id), ['DEU', 'PL-DEU', 'HIST-DEU', 'NEW-FID']);
});
});
