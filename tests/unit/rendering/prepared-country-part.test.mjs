import '../../helpers/spherical-core.mjs';
import '../../../src/rendering/workers/gpu-mesh-core.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createCountryMeshPreparation} from '../../../src/rendering/country-mesh-preparation.js';
import {prepareCountryStroke} from '../../../src/rendering/country-stroke-preparation.js';
import {prepareMeshSpatialBlocks} from '../../../src/rendering/mesh-spatial-blocks.js';
import {polygonGeometryDigest} from '../../../src/rendering/prepared-polygon-mesh.js';

const engine=globalThis.PandoLabGpuMeshCore;
const context={throwIfCancelled(){}};
const shape=(id,x=0)=>({id,geometry:{type:'Polygon',coordinates:[[[x,0],[x+0.1,0],[x+0.1,0.1],[x,0.1],[x,0]]]}});
const bake=features=>{
  const mesh=engine.buildGpuMeshFeatures(features,{validate:false});
  mesh.preparedStroke=prepareCountryStroke(mesh,features.map(f=>f.id));
  prepareMeshSpatialBlocks(mesh);return mesh;
};

test('offline country parts preserve exact triangles, border joins and BVH while rebinding current slots',async()=>{
  const features=[shape('A'),shape('B',2)],parts=new Map();
  for(const f of features)parts.set(await polygonGeometryDigest(f.geometry),bake([{...f,id:'0'}]));
  let fetches=0;
  const online={...engine,buildGpuMeshFeatures(){assert.fail('runtime triangulation executed');}};
  const owner=createCountryMeshPreparation({engine:online,requirePrepared:true,
    loadPreparedPart:async digest=>{fetches++;return parts.get(digest)||null;}});
  const actual=await owner.build(features,context),expected=bake(features);
  for(const key of ['positions','countryIndices','triangleIndices','lineIndices','strokeStartsEnds',
    'countryTriangleRanges','countryBoundaryRanges','countryBounds','countryBoundsFlags'])
    assert.deepEqual(actual[key],expected[key],key);
  assert.deepEqual(actual.preparedStroke.instances,expected.preparedStroke.instances);
  assert.deepEqual(actual.preparedStroke.nodes,expected.preparedStroke.nodes);
  assert.deepEqual(actual.preparedStroke.ownerRanges,expected.preparedStroke.ownerRanges);
  assert.deepEqual(actual.spatialBlocks,expected.spatialBlocks);
  assert.equal(actual.preparation.builtCount,0);assert.equal(actual.preparation.preparedCount,2);
  assert.equal(fetches,2);
  structuredClone(actual,{transfer:[actual.positions.buffer,actual.preparedStroke.instances.buffer]});
  const reverse=await owner.build([{...features[1],id:'renamed'},features[0]],context);
  assert.deepEqual(reverse.countryIds,['renamed','A']);assert.equal(fetches,2);
  assert.equal(reverse.preparation.builtCount,0);assert.equal(reverse.preparation.reusedCount,2);
  assert.ok(reverse.positions.length>0);
});

test('missing builtin packet fails closed instead of silently triangulating',async()=>{
  let builds=0;
  const owner=createCountryMeshPreparation({engine:{...engine,buildGpuMeshFeatures(){builds++;return bake([shape('A')]);}},
    requirePrepared:true,loadPreparedPart:async()=>null});
  await assert.rejects(owner.build([shape('A')],context),{code:'PL-MESH-PREPARED-MISSING'});
  assert.equal(builds,0);
});

test('cancelled prepared download cannot publish a mesh',async()=>{
  const part=bake([shape('0')]);let stale=false;
  const owner=createCountryMeshPreparation({engine,requirePrepared:true,
    loadPreparedPart:async()=>{stale=true;return part;}});
  await assert.rejects(owner.build([shape('A')],{throwIfCancelled(){if(stale)throw Object.assign(Error('superseded'),{name:'AbortError'});}}),{name:'AbortError'});
});
