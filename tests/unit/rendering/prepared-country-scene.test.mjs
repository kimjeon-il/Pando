import test from 'node:test';
import assert from 'node:assert/strict';
import * as codec from '../../../src/rendering/country-mesh-codec.js';
import { prepareCountryStroke } from '../../../src/rendering/country-stroke-preparation.js';
import { prepareMeshSpatialBlocks } from '../../../src/rendering/mesh-spatial-blocks.js';

function fixture() {
  const mesh = {
    positions: Int32Array.from([0,0,1e6,0,0,1e6,10e6,0,11e6,0,10e6,1e6]),
    countryIndices: Uint16Array.from([0,0,0,1,1,1]),
    triangleIndices: Uint32Array.from([0,1,2,3,4,5]),
    lineIndices: Uint32Array.from([0,1,1,2,2,0,3,4,4,5,5,3]),
    countryTriangleRanges: Uint32Array.from([0,3,3,3]),
    countryBoundaryRanges: Uint32Array.from([0,6,6,6]),
    countryBounds: Int32Array.from([0,0,1e6,1e6,10e6,0,11e6,1e6]),
    countryBoundsFlags: Uint32Array.from([0,0]),
  };
  return mesh;
}
const api = name => {
  assert.equal(typeof codec[name], 'function', `prepared scene requires ${name}`);
  return codec[name];
};
const ids = ['A','B'];
const identity = { fills: [['A','a'.repeat(64)],['B','b'.repeat(64)]],
  boundaries: [['A','a'.repeat(64),'A','','general'],['B','b'.repeat(64),'B','','general']] };

function packageFixture() {
  const mesh = fixture(), preparedStroke = prepareCountryStroke(mesh, ids);
  prepareMeshSpatialBlocks(mesh);
  const empty = () => ({segments:[],ownerIds:[],startsEnds:new Float32Array(),chainPhase:new Float32Array(),
    ownerRanges:{},preparedGeometry:prepareCountryStroke({positions:new Int32Array(),countryIndices:new Uint16Array(),lineIndices:new Uint32Array()},[])});
  return { identity, countryIds:ids, meshBuffer: api('encodeCountryMesh')(mesh,ids,6), preparedStroke,
    spatialBlocks:mesh.spatialBlocks, boundaryPacket:{...empty(),ownerIds:ids,internalOwners:{},outlineOwnerIds:ids,outlineOverrides:{...empty(),internalOwners:{}}} };
}

test('packed country slots are extracted with exact vertices, indices and owner remapping', () => {
  const input = fixture(), raw = api('encodeCountryMesh')(input,ids,6);
  const decoded = codec.decodeCountryMesh(raw,ids).mesh;
  assert.deepEqual(decoded.positions,input.positions);
  const part = api('extractCountryMeshSlot')(decoded,1);
  assert.deepEqual(part.positions,Int32Array.from([10e6,0,11e6,0,10e6,1e6]));
  assert.deepEqual(part.countryIndices,Uint16Array.from([0,0,0]));
  assert.deepEqual(part.triangleIndices,Uint32Array.from([0,1,2]));
  assert.deepEqual(part.countryTriangleRanges,Uint32Array.from([0,3]));
  assert.deepEqual(part.countryBounds,input.countryBounds.slice(4));
  assert.equal(part.strokeStartsEnds.length,12);
  assert.throws(()=>codec.extractCountryMeshSlot(decoded,2),/slot/i);
  decoded.countryIndices[3]=0;
  assert.throws(()=>codec.extractCountryMeshSlot(decoded,1),/slot|owner/i);
});

test('scene identity is order independent but includes exact geometry and hierarchy', () => {
  const key=api('preparedCountrySceneKey');
  assert.equal(key(identity),key({fills:[...identity.fills].reverse(),boundaries:[...identity.boundaries].reverse()}));
  for (const next of [
    {...identity,fills:[['X','a'.repeat(64)],identity.fills[1]]},
    {...identity,fills:[['A','c'.repeat(64)],identity.fills[1]]},
    {...identity,boundaries:[['A','a'.repeat(64),'B','B','general'],identity.boundaries[1]]},
  ]) assert.notEqual(key(identity),key(next));
  assert.throws(()=>key({...identity,fills:[identity.fills[0],identity.fills[0]]}),/identity|duplicate/i);
});

test('prepared scene roundtrip retains slot order, binary stroke data and spatial trees', () => {
  const scene=packageFixture();
  const raw=api('encodePreparedCountryScene')(scene);
  const read=api('decodePreparedCountryScene')(raw,identity);
  assert.deepEqual(read.identity.countryIds,ids);
  assert.deepEqual(read.meshBuffer,scene.meshBuffer);
  assert.deepEqual(read.preparedStroke,scene.preparedStroke);
  assert.deepEqual(read.spatialBlocks,scene.spatialBlocks);
  assert.deepEqual(read.boundaryPacket,scene.boundaryPacket);
  const wrong={...identity,fills:[['X','a'.repeat(64)],identity.fills[1]]};
  assert.throws(()=>codec.decodePreparedCountryScene(raw,wrong),/identity/i);
  assert.throws(()=>codec.decodePreparedCountryScene(raw.slice(0,-1),identity),/size|length/i);
  const bad=raw.slice(0);new Uint32Array(bad)[1]=99;
  assert.throws(()=>codec.decodePreparedCountryScene(bad,identity),/format|version/i);
});

test('prepared scene rejects spatial/slot corruption and never silently rebuilds it', () => {
  const scene=packageFixture();
  scene.spatialBlocks.triangle.roots[0]=99;
  assert.throws(()=>api('encodePreparedCountryScene')(scene),/spatial/i);
  const wrong=packageFixture();
  wrong.identity={...identity,fills:[...identity.fills].reverse()};
  assert.throws(()=>api('encodePreparedCountryScene')(wrong),/slot|identity/i);
});

test('scene artifact identity rejects empty owners and preserves hierarchy in the key', () => {
  const key=api('preparedCountrySceneKey');
  const changed=structuredClone(identity);changed.boundaries[0][4]='regional';
  assert.notEqual(key(identity),key(changed));
  assert.throws(()=>key({...identity,fills:[['','a'.repeat(64)]]}),/identity/);
});

test('boundary coordinates and repeated ownership are binary without changing exact native rows',()=>{
  const scene=packageFixture(),n=1000,part=scene.boundaryPacket;
  part.segments=Array.from({length:n},(_,i)=>({start:[0.123456789012345+i*1e-9,0],end:[0.5,1],ownerIds:['A']}));
  part.startsEnds=Float32Array.from(part.segments.flatMap(row=>[...row.start,...row.end]));
  part.chainPhase=new Float32Array(n);
  const raw=codec.encodePreparedCountryScene(scene);
  assert.ok(new Uint32Array(raw)[2]<16000,'coordinate rows must not be copied into JSON metadata');
  assert.deepEqual(codec.decodePreparedCountryScene(raw,identity).boundaryPacket.segments,part.segments);
  part.segments[0].start[0]=NaN;
  assert.throws(()=>codec.encodePreparedCountryScene(scene),/boundary segment|coordinate/i);
});

// Baked and dynamic country meshes must use the same slot-ordered source
// content identity, or returning to a previous date could admit stale pixels.
test('prepared scene fill identity equals canonical mesh content key', async () => {
  const { countrySceneIdentity, countryMeshContentKey } = await import('../../../src/rendering/country-mesh-content-key.js');
  const {resourceKey} = await import('../../../src/rendering/resource-update-policy.js');
  const triangle=offset=>({type:'Polygon',coordinates:[[[offset,0],[offset+1,0],[offset,1],[offset,0]]]});
  const features=[{id:'A',geometry:triangle(0)},{id:'B',geometry:triangle(10)}];
  const baked=await countrySceneIdentity(features,features);
  assert.equal(resourceKey(baked.fills),await countryMeshContentKey(features));
  assert.notEqual(resourceKey(baked.fills),await countryMeshContentKey([...features].reverse()));
  assert.notEqual(resourceKey(baked.fills),await countryMeshContentKey([features[0],{id:'B',geometry:triangle(11)}]));
});
