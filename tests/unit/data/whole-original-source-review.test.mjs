import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {encodeTerritorialSource} from '../../../tools/data/territorial-source-codec.mjs';
import {assertHistoricalSourceStorageChanges} from '../../../tools/gis/historical-display-review.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex'),digest=g=>hash(JSON.stringify([g.type,g.coordinates])),base='assets/data/territorial-entities/source/',method='exact-original-current-batch';
function fixture(code='AAA'){
 const ring=[[0,0],[2,0],[2,2],[0,0]],geometry={type:'MultiPolygon',coordinates:[[ring]]};
 const previous={schemaVersion:2,entityId:'state:'+code,parentEntityId:'',instantiation:{mode:'independent'},names:{en:'A'},lifetime:{validFrom:'1900',validTo:null},sourceInfo:{geometryVersionId:'modern'},geometryVersions:[{versionId:'modern',validFrom:null,validTo:null,geometry:{type:'MultiPolygon',coordinates:[[[[0,0],[1,0],[1,1],[0,0]]]]},modernBoundarySupplement:{adoptionMode:'lossless-original-detached-component-append',wholeCountryRaw:false,caveat:'retain'}}]};
 const next=structuredClone(previous),v=next.geometryVersions[0];v.geometry=geometry;
 const archive=new Map(),put=(name,value)=>{const b=Buffer.from(JSON.stringify(value));archive.set(name,b);return {reference:name,sha256:hash(b)};};
 const encoded=encodeTerritorialSource(previous),target=base+'countries/state-'+code+'.json',pre=Buffer.from(JSON.stringify(encoded.descriptor));archive.set(target,pre);for(const [p,b]of encoded.geometries)archive.set(base+p,b);
 const wkb=Buffer.alloc(22+ring.length*16);wkb[0]=1;wkb.writeUInt32LE(6,1);wkb.writeUInt32LE(1,5);wkb[9]=1;wkb.writeUInt32LE(3,10);wkb.writeUInt32LE(1,14);wkb.writeUInt32LE(ring.length,18);ring.forEach(([x,y],i)=>{wkb.writeDoubleLE(x,22+i*16);wkb.writeDoubleLE(y,30+i*16);});const header=Buffer.alloc(40);header.set([71,80,0,3]);header.writeInt32LE(4326,4);[0,2,0,2].forEach((x,i)=>header.writeDoubleLE(x,8+i*8));const blob=Buffer.concat([header,wkb]);
 const source={schemaVersion:1,method:'exact-gpkg-original-feature',featureId:'1',properties:{WP_ID:'1',WP_PAR_ID:'1',GENC_3:code,US_Recog:'Independent',Map_Disp:null,Show_Disp:null},sourcePath:'LSIB.gpkg',sourceFileReceipt:{gpkgSha256:hash('gpkg')},geometry,rawBlobBase64:blob.toString('base64'),rawBlobSha256:hash(blob),rawWkbSha256:hash(wkb)};
 const sourceRef=put('reports/source.json',source),resource=base+'geometries/sha256-'+hash(JSON.stringify(geometry)+'\n')+'.json',topology={status:'deferred-until-complete-modern-replacement',displayApproved:false};
 const batch={schemaVersion:1,method,topology,members:[{entityId:'state:'+code,descriptor:target,resource,previousDescriptorSha256:hash(pre)},{entityId:'state:BBB',descriptor:base+'countries/state-BBB.json',resource:base+'geometries/sha256-'+hash('BBB')+'.json',previousDescriptorSha256:hash('old BBB')}]};
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
function espFixture(){
 const f=fixture('ESP'),s=f.next.geometryVersions[0].modernBoundarySupplement;
 f.source.featureId=f.source.properties.WP_ID=f.source.properties.WP_PAR_ID=s.rawFeatureId='804cb3c1-195d-48d8-97e5-0439f624b231';
 f.source.properties.GENC_3=null;f.source.properties.MapTint_3='ESP';
 const descriptor=JSON.parse(f.archive.get(base+'countries/state-ESP.json'));
 f.mapping={rows:[{code:'ESP',versionId:f.proof.versionId,descriptorSha256:f.proof.previousDescriptorSha256,validFrom:null,validTo:null,resourcePath:base+descriptor.geometryVersions[0].geometryResource.file,resourceSha256:descriptor.geometryVersions[0].geometryResource.sha256,originalFeatures:[{WP_ID:f.source.featureId,GENC_3:null,US_Recog:'Independent',Map_Disp:null,blobSha256:f.source.rawBlobSha256,wkbSha256:f.source.rawWkbSha256}]}]};
 const refresh=f.refresh;f.refresh=()=>{const bytes=Buffer.from(JSON.stringify(f.mapping));f.archive.set('reports/existing-map.json',bytes);f.proof.identityFallback={method:'existing-esp-single-original-null-genc',mapping:{reference:'reports/existing-map.json',sha256:hash(bytes)}};refresh();};f.refresh();return f;
}
test('ESP null GENC uses exact existing archived preimage and single original binding',()=>{const f=espFixture();assert.equal(assertHistoricalSourceStorageChanges(f.next,f.previous,f),1);});
for(const [name,mutate]of Object.entries({
 'non-null conflicting GENC':f=>{f.source.properties.GENC_3='PRT';},
 'missing GENC rather than null':f=>{delete f.source.properties.GENC_3;},
 'MapTint mismatch':f=>{f.source.properties.MapTint_3='PRT';},
 'wrong original UUID':f=>{f.source.featureId=f.source.properties.WP_ID=f.source.properties.WP_PAR_ID=f.next.geometryVersions[0].modernBoundarySupplement.rawFeatureId='different';f.mapping.rows[0].originalFeatures[0].WP_ID='different';},
 'mapping blob mismatch':f=>{f.mapping.rows[0].originalFeatures[0].blobSha256=hash('wrong');},
 'mapping WKB mismatch':f=>{f.mapping.rows[0].originalFeatures[0].wkbSha256=hash('wrong');},
 'mapping stale descriptor':f=>{f.mapping.rows[0].descriptorSha256=hash('wrong');},
 'mapping stale resource':f=>{f.mapping.rows[0].resourceSha256=hash('wrong');},
 'mapping duplicate rows':f=>{f.mapping.rows.push(structuredClone(f.mapping.rows[0]));},
 'mapping multiple originals':f=>{f.mapping.rows[0].originalFeatures.push(structuredClone(f.mapping.rows[0].originalFeatures[0]));},
 'changed metadata':f=>{f.next.names.en='changed';},
 'changed lifetime':f=>{f.next.lifetime.validFrom='1801';},
 'changed parent':f=>{f.next.parentEntityId='state:PRT';},
 'non-self-parent source':f=>{f.source.properties.WP_PAR_ID='different';},
})){test('ESP fallback rejects '+name,()=>{const f=espFixture();mutate(f);f.refresh();assert.throws(()=>assertHistoricalSourceStorageChanges(f.next,f.previous,f),/Whole original batch:/);});}
test('other null-GENC countries cannot use MapTint only',()=>{const f=fixture();f.source.properties.GENC_3=null;f.source.properties.MapTint_3='AAA';f.refresh();assert.throws(()=>assertHistoricalSourceStorageChanges(f.next,f.previous,f),/identity mismatch/);});
test('ESP fallback requires archived mapping receipt',()=>{const f=espFixture();f.archive.delete('reports/existing-map.json');assert.throws(()=>assertHistoricalSourceStorageChanges(f.next,f.previous,f),/archive evidence hash mismatch/);});
const dependencyTuples={GIB:['GBR','9c6cbaf6-8bb7-48e9-8036-7429ad4154e0','4f9b1dfc-e287-4b05-abc0-27793984fa5c'],HKG:['CHN','f9c2b465-9fe6-46eb-9a56-5df0f4fb1f69','422131df-82bc-4f1b-9a1f-ee89cc970e19'],MAC:['CHN','942a1f06-0142-4010-bfc8-4f140ba2f7a3','422131df-82bc-4f1b-9a1f-ee89cc970e19']};
function dependencyFixture(code='GIB'){
 const f=fixture(code),[parent,id,parentId]=dependencyTuples[code],s=f.next.geometryVersions[0].modernBoundarySupplement;
 for(const e of [f.previous,f.next]){e.parentEntityId='state:'+parent;e.instantiation.countryUpdates={};}
 const encoded=encodeTerritorialSource(f.previous),pre=Buffer.from(JSON.stringify(encoded.descriptor));f.archive.set(base+'countries/state-'+code+'.json',pre);f.proof.previousDescriptorSha256=f.batch.members[0].previousDescriptorSha256=hash(pre);
 f.source.featureId=f.source.properties.WP_ID=s.rawFeatureId=id;f.source.properties.WP_PAR_ID=parentId;f.source.properties.US_Recog='Dependency or Area of Special Sovereignty';
 f.parent={entityId:'state:'+parent,parentEntityId:'',metadata:{sourceFeatureId:parent},geometryVersions:[{geometryResource:{file:'geometries/sha256-'+hash('parent geometry')+'.json'}}]};f.parentPath=base+'countries/state-'+parent+'.json';const pb=Buffer.from(JSON.stringify(f.parent));f.archive.set(f.parentPath,pb);
 f.mapping={rows:[{code,versionId:f.proof.versionId,descriptorSha256:hash('legitimately older baseline descriptor'),resourceSha256:hash('older geometry e.g. before GIB coast updates'),assembly:'single original feature',originalFeatures:[{WP_ID:id,GENC_3:code,US_Recog:f.source.properties.US_Recog,Map_Disp:null,blobSha256:f.source.rawBlobSha256,wkbSha256:f.source.rawWkbSha256}]}]};
 f.scope={method:'preserve-existing-dependent-parent',parentEntityId:'state:'+parent,parentOriginalWP_ID:parentId,parentDescriptorSha256:hash(pb)};
 const refresh=f.refresh;f.refresh=()=>{const bytes=Buffer.from(JSON.stringify(f.mapping));f.archive.set('reports/dependent-existing-map.json',bytes);f.scope.existingOriginalMapping={reference:'reports/dependent-existing-map.json',sha256:hash(bytes)};f.proof.dependencyScope=structuredClone(f.scope);s.dependencyScope=structuredClone(f.scope);refresh();};f.refresh();return f;
}
for(const code of ['GIB','HKG','MAC'])test(code+' exact existing dependent parent and original mapping accepted',()=>{const f=dependencyFixture(code);assert.equal(assertHistoricalSourceStorageChanges(f.next,f.previous,f),1);});
test('dependent old identity proof can predate current coast geometry but current preimage cannot',()=>{const f=dependencyFixture();assert.equal(assertHistoricalSourceStorageChanges(f.next,f.previous,f),1);f.proof.previousDescriptorSha256=hash('stale');f.refresh();assert.throws(()=>assertHistoricalSourceStorageChanges(f.next,f.previous,f),/preimage/);});
for(const [name,mutate]of Object.entries({
 'missing scope':f=>{f.scope.method='unknown';},
 'changed parent':f=>{f.next.parentEntityId='state:CHN';},
 'parent removed':f=>{f.next.parentEntityId='';},
 'non-independent operational mode':f=>{f.next.instantiation.mode='territory-replacement';},
 'parent update side effect':f=>{f.next.instantiation.countryUpdates={GBR:'replace'};},
 'wrong child raw UUID':f=>{f.source.featureId=f.source.properties.WP_ID='other';},
 'wrong raw parent UUID':f=>{f.source.properties.WP_PAR_ID='other';},
 'self parent child source':f=>{f.source.properties.WP_PAR_ID=f.source.featureId;},
 'wrong source recognition':f=>{f.source.properties.US_Recog='Independent';},
 'wrong child code':f=>{f.source.properties.GENC_3='MAC';},
 'wrong scope parent UUID':f=>{f.scope.parentOriginalWP_ID='other';},
 'stale parent descriptor':f=>{f.scope.parentDescriptorSha256=hash('stale');},
 'missing parent descriptor':f=>{f.archive.delete(f.parentPath);},
 'mapping duplicate':f=>{f.mapping.rows.push(structuredClone(f.mapping.rows[0]));},
 'mapping multiple original':f=>{f.mapping.rows[0].originalFeatures.push(structuredClone(f.mapping.rows[0].originalFeatures[0]));},
 'mapping bad blob':f=>{f.mapping.rows[0].originalFeatures[0].blobSha256=hash('bad');},
 'mapping bad WKB':f=>{f.mapping.rows[0].originalFeatures[0].wkbSha256=hash('bad');},
 'mapping different method':f=>{f.mapping.rows[0].assembly='union';},
 'display flag':f=>{f.source.properties.Map_Disp='disputed';},
 'dated dependency':f=>{f.next.geometryVersions[0].validFrom='1997-07-01';},
 'parent writes':f=>{f.batch.members.push({entityId:f.parent.entityId,descriptor:f.parentPath,resource:base+f.parent.geometryVersions[0].geometryResource.file,previousDescriptorSha256:f.scope.parentDescriptorSha256});f.prefixes.push(f.parentPath,base+f.parent.geometryVersions[0].geometryResource.file);},
})){test('dependent contract rejects '+name,()=>{const f=dependencyFixture();mutate(f);f.refresh();assert.throws(()=>assertHistoricalSourceStorageChanges(f.next,f.previous,f),/Whole original batch:/);});}
test('dependent scope cannot become generic independent or other dependency bypass',()=>{const f=fixture();f.proof.dependencyScope={method:'preserve-existing-dependent-parent'};f.refresh();assert.throws(()=>assertHistoricalSourceStorageChanges(f.next,f.previous,f),/dependent scope/);const g=fixture();g.next.parentEntityId=g.previous.parentEntityId='state:GBR';assert.throws(()=>assertHistoricalSourceStorageChanges(g.next,g.previous,g),/independent identity/);});
