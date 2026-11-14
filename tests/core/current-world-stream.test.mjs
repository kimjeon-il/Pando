import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCurrentWorld,visitCurrentWorldFeatures} from '../../tools/data/territorial-current-world.mjs';
import {streamCurrentWorldJson} from '../../tools/data/current-world-json-stream.mjs';

function source(id,featureId,geometry) {
  return {
    entityId:id,entityKind:'general',
    sourceInfo:{featureId,featureProperties:{native:'한글',metadata:{old:'value'}}},
    geometryVersions:[{versionId:'modern',geometry}],
    names:{ko:'한국어 이름',en:'English name'},metadata:{defaultFlagDataUrl:'flags/flag.svg'},
  };
}
const collection={type:'FeatureCollection',name:'world source',bbox:[-180,-90,180,90]};
const view={schemaVersion:1,sourceInfo:{collectionMetadata:collection},selections:[
  {entityId:'entity:a',geometryVersionId:'modern'},
  {entityId:'entity:b',geometryVersionId:'modern'},
]};

test('current world stream is byte-identical to the original collection and records genuine duplicate geometries',()=>{
  const largeRing=Array.from({length:6000},(_,i)=>[i/1000,-20+i/10000]);
  largeRing.push(largeRing[0]);
  const geometry={type:'Polygon',coordinates:[largeRing,[[1,1],[1,2],[2,2],[1,1]]]};
  const entities=[source('entity:a','A',geometry),source('entity:b','B',geometry)];
  const canonical=buildCurrentWorld({entities,view});
  const pieces=[];
  const {bbox,...metadata}=collection;
  const stats=streamCurrentWorldJson({
    metadata,bbox,
    visitFeatures:accept=>visitCurrentWorldFeatures({
      entities,view,cloneGeometry:false,visit:accept,
    }),
  },part=>pieces.push(part));
  const output=pieces.join('');
  assert.equal(output,JSON.stringify(canonical)+'\n','public GeoJSON byte format must remain unchanged');
  assert.deepEqual(JSON.parse(output),canonical);
  assert.equal(stats.featureCount,2);
  assert.equal(stats.bytes,Buffer.byteLength(output));
  assert.equal(stats.duplicateGeometryCount,1,'duplicate geometry is reported, not silently removed');
  assert.equal(stats.uniqueGeometryCount,1);
  assert.equal(stats.duplicateGeometries[0].duplicate,'B');
  assert.ok(stats.maxChunkBytes<100000,'no enormous JSON.stringify allocation for one coordinate ring');
  assert.equal(canonical.features[0].properties.metadata.flagDataUrl,'flags/flag.svg');
});

test('current world feature selection rejects duplicate canonical IDs without rewriting geometry',()=>{
  const geometry={type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]};
  const entities=[source('entity:a','SAME',geometry),source('entity:b','SAME',geometry)];
  assert.throws(()=>buildCurrentWorld({entities,view}),/duplicate canonical feature/);
  const unique=[source('entity:a','A',geometry),source('entity:b','B',geometry)];
  assert.throws(()=>visitCurrentWorldFeatures({
    entities:unique,view:{...view,selections:[view.selections[0],view.selections[0]]},
    visit:()=>{},
  }),/Invalid world view/);
});
