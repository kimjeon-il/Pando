import assert from 'node:assert/strict';
import test from 'node:test';
import { createGeometryVersionStore } from '../../assets/js/modules/geometry-version-store.js';

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
