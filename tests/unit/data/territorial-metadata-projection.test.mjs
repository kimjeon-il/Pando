import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {metadataOnlyTerritorialProjection,selectTerritorialChunkSource} from '../../../tools/data/territorial-metadata-projection.mjs';
import {selectTerritorialChunkBytes} from '../../../tools/data/territorial-chunk-compression.mjs';
import {territorialIndexEntry} from '../../../tools/gis/territorial-index-entry.js';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const content=Buffer.from('{"type":"Polygon","coordinates":[[[1,2],[3,4],[1,2]]]}\n');
const resource={logicalRef:{id:'state:T:2026',version:1},role:'source',type:'Polygon',
 file:'geometries/sha256-'+sha(content)+'.json',sha256:sha(content),bytes:content.length};
const descriptor=(name,ref=resource)=>({schemaVersion:2,entityId:'state:T',entityKind:'general',lineageId:'t',
 names:{ko:name},alternateNames:[],lifetime:{validFrom:null,validTo:null},parentEntityId:'',
 geometryVersions:[{versionId:'2026',validFrom:null,validTo:null,certainty:'high',geometryResource:ref}],
 instantiation:{mode:'independent',countryUpdates:{}},metadata:{},sourceInfo:{sourceId:'test',title:'Test',license:'CC0'},
 storageLayout:'geometry-resources-v1'});
const previous=()=>({entityId:'state:T',storageLayout:'geometry-resources-v1',
 bbox:[1,2,3,4],geometryVersions:descriptor('Old').geometryVersions});
test('name-only metadata projection does not materialize or repackage original coordinates',()=>{
 const current=descriptor('New'),old=previous(),projected=metadataOnlyTerritorialProjection(current,old);
 assert.ok(projected);
 assert.deepEqual(projected.bbox,[1,2,3,4]);
 const raw=Buffer.from(JSON.stringify(current)+'\n');
 const {stored,changed}=selectTerritorialChunkBytes(raw);
 assert.equal(changed,true);assert.deepEqual(gunzipSync(stored),raw);
 const index=territorialIndexEntry(projected.entity,{sha256:sha(stored),
   compressedBytes:stored.length,decodedBytes:raw.length,
   storageLayout:'geometry-resources-v1',verifiedGeometryBounds:projected.bbox});
 assert.equal(index.names.ko,'New');assert.deepEqual(index.bbox,old.bbox);
 assert.deepEqual(index.geometryVersions[0].geometryResource,resource);
 assert.ok(!('geometry' in index.geometryVersions[0]));
 assert.equal('storageLayout' in projected.entity,false);
});
test('identical metadata preserves existing compressed chunk bytes',()=>{
 const raw=Buffer.from(JSON.stringify(descriptor('Old'))+'\n');
 const original=gzipSync(raw,{level:6,mtime:0});
 const result=selectTerritorialChunkBytes(raw,original);
 assert.equal(result.changed,false);assert.strictEqual(result.stored,original);
});
test('changed resource identity refuses metadata-only path and requires ordinary GIS generation',()=>{
 const old=previous();
 assert.equal(metadataOnlyTerritorialProjection(descriptor('New',{...resource,sha256:'f'.repeat(64),
   file:'geometries/sha256-'+'f'.repeat(64)+'.json'}),old),null);
 assert.equal(metadataOnlyTerritorialProjection({...descriptor('New'),geometryVersions:[]},old),null);
 assert.equal(metadataOnlyTerritorialProjection(descriptor('New'),{...old,bbox:[NaN,0,1,1]}),null);
});

test('production chunk selector never decodes coordinates on metadata-only changes',()=>{
 let reads=0;
 const selected=selectTerritorialChunkSource(descriptor('New'),previous(),()=>{
  reads++;throw Error('No geometry source can be read for a metadata-only edit');
 });
 assert.equal(reads,0);assert.equal(selected.readsGeometry,false);
 assert.equal(selected.descriptor.names.ko,'New');
 assert.deepEqual(selected.verifiedGeometryBounds,[1,2,3,4]);
 const moved=descriptor('New',{...resource,sha256:'e'.repeat(64),
   file:'geometries/sha256-'+'e'.repeat(64)+'.json'});
 const rebuilt=selectTerritorialChunkSource(moved,previous(),()=>{
  reads++;return {entity:{...moved,geometryVersions:[{versionId:'2026',
   geometry:{type:'Polygon',coordinates:[[[0,0],[1,1],[0,0]]]}}]},
   descriptor:moved};
 });
 assert.equal(reads,1);assert.equal(rebuilt.readsGeometry,true);
 assert.equal(rebuilt.verifiedGeometryBounds,null);
});
