import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import test from 'node:test';
import {archiveSourceBytes,historicSourceRecord,compareHistoricSourcePins,ENTITY}
  from '../../tools/gis/check-historical-source-provenance.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const revision='a'.repeat(40),revision2='b'.repeat(40);
const geo={type:'MultiPolygon',coordinates:[[[[22,54],[23,54],[23,55],[22,54]]]]};
const source=()=>({entityId:'state:east-prussia',
 metadata:{geometrySha256:hash(Buffer.from(JSON.stringify(geo))),artifactSha256:'b'.repeat(64)},
 geometryVersions:[{versionId:'ostpreussen-1878-1920-r3',geometry:geo}]});
function archive(data){
 const bytes=Buffer.from(JSON.stringify(data));
 const stored=gzipSync(bytes);
 const entry={bytes:bytes.length,encoding:'gzip',sha256:hash(bytes),
   stored:'archive/blobs/'+hash(bytes)+'.gz'};
 return {index:{files:{[ENTITY]:entry}},bytes,stored,entry};
}
test('archival SHA is checked after decompression, before interpreting the entity',()=>{
 const fixture=archive(source());
 assert.deepEqual(archiveSourceBytes(fixture.index,ENTITY,fixture.stored).bytes,fixture.bytes);
 assert.throws(()=>archiveSourceBytes(fixture.index,ENTITY,Buffer.from('bad')),
   /incorrect header|invalid|unexpected/i);
 const changed=structuredClone(fixture.index);changed.files[ENTITY].sha256='0'.repeat(64);
 assert.throws(()=>archiveSourceBytes(changed,ENTITY,fixture.stored),/archive bytes differ/);
});
test('historic record preserves original coordinate ordering and independent metadata digest',()=>{
 const f=archive(source());
 const output=historicSourceRecord(f.bytes,revision);
 assert.equal(output.coordinateCount,4);
 assert.equal(output.geometrySha256,hash(Buffer.from(JSON.stringify(geo))));
 assert.equal(output.reviewedMetadataSha256,output.geometrySha256);
});
test('separate immutable pins are compared without any source mutation',async()=>{
 const old=archive(source());
 const changed=source();
 changed.geometryVersions[0].geometry.coordinates[0][0][1][0]=23.001;
 const fresh=archive(changed);
 const fake=async url=>{
   const isNew=url.includes('/'+revision2+'/');
   return Buffer.from(url.endsWith('archive/index.json')?
     JSON.stringify((isNew?fresh:old).index):(isNew?fresh:old).stored);
 };
 const compared=await compareHistoricSourcePins(revision,revision2,{getBytes:fake});
 assert.equal(compared.exactGeometrySameAcrossPins,false);
 assert.equal(compared.metadataMatchesCurrentGeometry,false);
 assert.equal(compared.readyToUpdateReviewedGeometry,false);
});
