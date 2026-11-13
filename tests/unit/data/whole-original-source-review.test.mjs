import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {encodeTerritorialSource} from '../../../tools/data/territorial-source-codec.mjs';
import {assertHistoricalSourceStorageChanges} from '../../../tools/gis/historical-display-review.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex'),digest=g=>hash(JSON.stringify([g.type,g.coordinates])),base='assets/data/territorial-entities/source/',method='exact-original-current-batch';
function fixture(){
 const ring=[[0,0],[2,0],[2,2],[0,0]],geometry={type:'MultiPolygon',coordinates:[[ring]]};
 const previous={schemaVersion:2,entityId:'state:AAA',parentEntityId:'',instantiation:{mode:'independent'},names:{en:'A'},lifetime:{validFrom:'1900',validTo:null},sourceInfo:{geometryVersionId:'modern'},geometryVersions:[{versionId:'modern',validFrom:null,validTo:null,geometry:{type:'MultiPolygon',coordinates:[[[[0,0],[1,0],[1,1],[0,0]]]]},modernBoundarySupplement:{adoptionMode:'lossless-original-detached-component-append',wholeCountryRaw:false,caveat:'retain'}}]};
 const next=structuredClone(previous),v=next.geometryVersions[0];v.geometry=geometry;
 const archive=new Map(),put=(name,value)=>{const b=Buffer.from(JSON.stringify(value));archive.set(name,b);return {reference:name,sha256:hash(b)};};
 const encoded=encodeTerritorialSource(previous),target=base+'countries/state-AAA.json',pre=Buffer.from(JSON.stringify(encoded.descriptor));archive.set(target,pre);for(const [p,b]of encoded.geometries)archive.set(base+p,b);
 const wkb=Buffer.alloc(22+ring.length*16);wkb[0]=1;wkb.writeUInt32LE(6,1);wkb.writeUInt32LE(1,5);wkb[9]=1;wkb.writeUInt32LE(3,10);wkb.writeUInt32LE(1,14);wkb.writeUInt32LE(ring.length,18);ring.forEach(([x,y],i)=>{wkb.writeDoubleLE(x,22+i*16);wkb.writeDoubleLE(y,30+i*16);});const header=Buffer.alloc(40);header.set([71,80,0,3]);header.writeInt32LE(4326,4);[0,2,0,2].forEach((x,i)=>header.writeDoubleLE(x,8+i*8));const blob=Buffer.concat([header,wkb]);
 const source={schemaVersion:1,method:'exact-gpkg-original-feature',featureId:'1',properties:{WP_ID:'1',WP_PAR_ID:'1',GENC_3:'AAA',US_Recog:'Independent',Map_Disp:null,Show_Disp:null},sourcePath:'LSIB.gpkg',sourceFileReceipt:{gpkgSha256:hash('gpkg')},geometry,rawBlobBase64:blob.toString('base64'),rawBlobSha256:hash(blob),rawWkbSha256:hash(wkb)};
 const sourceRef=put('reports/source.json',source),resource=base+'geometries/sha256-'+hash(JSON.stringify(geometry)+'\n')+'.json',topology={status:'deferred-until-complete-modern-replacement',displayApproved:false};
 const batch={schemaVersion:1,method,topology,members:[{entityId:'state:AAA',descriptor:target,resource,previousDescriptorSha256:hash(pre)},{entityId:'state:BBB',descriptor:base+'countries/state-BBB.json',resource:base+'geometries/sha256-'+hash('BBB')+'.json',previousDescriptorSha256:hash('old BBB')}]};
 const proof={schemaVersion:1,method,status:'raw-source-only-not-display-approved',entityId:next.entityId,versionId:v.versionId,validFrom:null,validTo:null,previousDescriptorSha256:hash(pre),previousGeometrySha256:digest(previous.geometryVersions[0].geometry),geometrySha256:digest(geometry),rawCoordinateRoundtrip:true,wholeCountryRaw:true,topology,source:sourceRef,batch:put('reports/batch.json',batch)};
 v.modernBoundarySupplement={adoptionMode:method,status:proof.status,wholeCountryRaw:true,topology,priorPreparedAttribution:structuredClone(previous.geometryVersions[0].modernBoundarySupplement),rawSourceFile:source.sourcePath,rawSourceFileSha256:source.sourceFileReceipt.gpkgSha256,rawFeatureId:source.featureId,rawOriginalSource:sourceRef,geometrySha256:digest(geometry)};
 next.sourceInfo={...next.sourceInfo,geometrySha256:digest(geometry)};
 const refresh=()=>{proof.source=put('reports/source.json',source);v.modernBoundarySupplement.rawOriginalSource=proof.source;proof.batch=put('reports/batch.json',batch);v.modernBoundarySupplement.sourceAdoptionReview=put('reports/proof.json',proof);};refresh();
 return {next,previous,source,proof,batch,archive,refresh,prefixes:batch.members.flatMap(m=>[m.descriptor,m.resource]),readEvidence:p=>archive.get(p)};
}
test('whole original batch accepts a multi-entity exact scope with deferred topology',()=>{const f=fixture();assert.equal(assertHistoricalSourceStorageChanges(f.next,f.previous,f),1);});
for(const [name,mutate]of Object.entries({
 'identity':f=>{f.next.names.en='changed';},
 'dates':f=>{f.next.lifetime.validFrom='1801';},
 'preimage':f=>{f.proof.previousDescriptorSha256=hash('stale');},
 'raw WKB':f=>{f.source.rawWkbSha256=hash('wrong');},
 'ownership':f=>{f.source.properties.GENC_3='BBB';},
 'topology claim':f=>{f.proof.topology={status:'passed'};},
 'prior attribution':f=>{delete f.next.geometryVersions[0].modernBoundarySupplement.priorPreparedAttribution.caveat;},
 'broad scope':f=>{f.prefixes.push(base);},
 'batch preimage':f=>{f.batch.members[0].previousDescriptorSha256=hash('wrong');},
})){test('whole batch rejects '+name,()=>{const f=fixture();mutate(f);f.refresh();assert.throws(()=>assertHistoricalSourceStorageChanges(f.next,f.previous,f),/Whole original batch:/);});}
test('admitted receipt cannot be removed through old unchanged fastpath',()=>{const f=fixture(),changed=structuredClone(f.next);delete changed.geometryVersions[0].modernBoundarySupplement;assert.throws(()=>assertHistoricalSourceStorageChanges(changed,f.next,f),/Whole original batch:/);});
test('archived complete blob needs no unavailable whole-file receipt',()=>{const f=fixture();delete f.source.sourceFileReceipt;delete f.next.geometryVersions[0].modernBoundarySupplement.rawSourceFileSha256;f.refresh();assert.equal(assertHistoricalSourceStorageChanges(f.next,f.previous,f),1);});
test('whole-file hash cannot be invented without archived receipt',()=>{const f=fixture();delete f.source.sourceFileReceipt;f.refresh();assert.throws(()=>assertHistoricalSourceStorageChanges(f.next,f.previous,f),/file receipt mismatch/);});
test('supplied whole-file receipt must remain bound',()=>{const f=fixture();delete f.next.geometryVersions[0].modernBoundarySupplement.rawSourceFileSha256;f.refresh();assert.throws(()=>assertHistoricalSourceStorageChanges(f.next,f.previous,f),/file receipt mismatch/);});

test('complete original resource bounds include large originals without large test allocations',async()=>{
 const {assertWholeOriginalBlobSize}=await import('../../../tools/gis/whole-original-source-review.mjs');
 const mib=1024*1024;
 for(const size of [64*mib+1,70*mib,107*mib,221*mib,256*mib])assert.doesNotThrow(()=>assertWholeOriginalBlobSize(size,4*Math.ceil(size/3)));
 assert.doesNotThrow(()=>assertWholeOriginalBlobSize(0,360*mib));
 for(const [raw,encoded]of [[256*mib+1,0],[0,360*mib+1],[-1,0],[0,-1],[NaN,0],[0,Infinity],[1.5,0]])assert.throws(()=>assertWholeOriginalBlobSize(raw,encoded),/bounded original blob/);
});
