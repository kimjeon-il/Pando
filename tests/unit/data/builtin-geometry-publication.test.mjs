import assert from 'node:assert/strict';
import test from 'node:test';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {factorBuiltinCountryGeometryStorage,indexBuiltinGeometryTypes} from '../../../tools/data/builtin-country-storage.mjs';
import {encodeBuiltinCountries,finalizeBuiltinWorldFiles,readBuiltinCountry} from '../../../tools/data/builtin-country-bytes.mjs';
const shape={type:'Polygon',coordinates:[[[0,0],[1.1234567890123457,0],[1,1],[0,0]]]};
const country=id=>({schemaVersion:2,entityId:id,identity:{id,properties:{name:id}},timelineRecords:{schemaVersion:3,lifetimes:[],geometryBindings:[{geometryRef:{id:'shared-logical',version:1}}],parentRelations:[],propertyBindings:[]},geometries:[{id:'shared-logical',version:1,geojson:shape}],sourceBindings:[]});
function publication(values){
 const index={schema:'pandolab-builtin-world',schemaVersion:2,entities:values.map(c=>({entityId:c.entityId}))},files=new Map();
 encodeBuiltinCountries(index,values,files);finalizeBuiltinWorldFiles(index,files);return {index,files};
}
test('runtime descriptors and immutable geometry payloads are independently addressable and exact',()=>{
 const values=[country('A'),country('B')],{index,files}=publication(values);
 assert.equal(index.storageLayout,'descriptor-geometries-v1');assert.equal(index.geometryAssets.length,1);
 assert.equal(index.geometryAssets[0].type,shape.type);
 const descriptors=index.entities.map(e=>JSON.parse(gunzipSync(files.get(e.file))));
 assert.equal(descriptors[0].schemaVersion,3);assert.equal(Object.hasOwn(descriptors[0],'geometries'),false);
 assert.deepEqual(descriptors[0].geometryRefs,[{id:'shared-logical',version:1}]);
 assert.deepEqual(readBuiltinCountry(index.entities[0],index,path=>files.get(path)),values[0]);
 assert.equal([...files.keys()].filter(p=>p.startsWith('geometries/')).length,1);
 const previousIndex=structuredClone(index);delete previousIndex.geometryAssets[0].type;
 const upgraded=indexBuiltinGeometryTypes({previousIndex,read:file=>files.get(file)});
 assert.deepEqual(upgraded.index,index);assert.deepEqual([...upgraded.files.keys()],['index.json']);
 assert.equal(upgraded.verifiedPayloads,1);
 assert.throws(()=>indexBuiltinGeometryTypes({previousIndex,read:()=>Buffer.from('corrupt')}),/transport/);
});
test('name-only publication writes no geometry bytes and preserves coordinate hashes and URLs',()=>{
 const before=publication([country('A')]),index=structuredClone(before.index),files=new Map();
 const descriptor=JSON.parse(gunzipSync(before.files.get(index.entities[0].file)));
 descriptor.identity.properties.name='new name';
 encodeBuiltinCountries(index,[descriptor],files);finalizeBuiltinWorldFiles(index,files,{previousIndex:before.index});
 assert.deepEqual(index.geometryAssets,before.index.geometryAssets);
 assert.equal([...files.keys()].some(p=>p.startsWith('geometries/')),false);
 const stored=new Map([...before.files,...files]);
 assert.deepEqual(readBuiltinCountry(index.entities[0],index,path=>stored.get(path)).geometries,country('A').geometries);
});
test('geometry payload corruption is rejected before returning a materialized country',()=>{
 const {index,files}=publication([country('A')]);files.set(index.geometryAssets[0].file,Buffer.from('corrupt'));
 assert.throws(()=>readBuiltinCountry(index.entities[0],index,path=>files.get(path)),/geometry|integrity|bytes|size/i);
});

test('explicit converter preserves every ordered country field without recomputing geometry',()=>{
 const countries=[country('A'),country('B')],oldFiles=new Map(),entries=[];
 for(const value of countries){
  const decoded=Buffer.from(JSON.stringify(value)+'\n'),stored=gzipSync(decoded),sha256=createHash('sha256').update(stored).digest('hex');
  const file='countries/'+value.entityId+'-sha256-'+sha256+'.json.gz';oldFiles.set(file,stored);
  entries.push({entityId:value.entityId,file,encoding:'gzip',sha256,compressedBytes:stored.length,decodedBytes:decoded.length});
 }
 const previousIndex={schema:'pandolab-builtin-world',schemaVersion:2,storageLayout:'country-files-v1',entities:entries};
 const before=JSON.stringify(previousIndex),result=factorBuiltinCountryGeometryStorage({previousIndex,read:file=>oldFiles.get(file)});
 assert.equal(JSON.stringify(previousIndex),before);assert.equal(result.verification.verifiedCountries,2);
 assert.equal(result.verification.exactOrderedDocument,true);assert.equal(result.verification.geometryPayloadFiles,1);
 for(let i=0;i<countries.length;i++)assert.equal(JSON.stringify(readBuiltinCountry(result.index.entities[i],result.index,p=>result.files.get(p))),JSON.stringify(countries[i]));
 oldFiles.set(entries[0].file,Buffer.from('corrupt'));
 assert.throws(()=>factorBuiltinCountryGeometryStorage({previousIndex,read:p=>oldFiles.get(p)}),/bytes|integrity|geometry/);
});
