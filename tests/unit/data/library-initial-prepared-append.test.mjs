import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {fixture as partialFixture,run,base,hash,json,gh,blob,wkb,multi,poly} from './library-detached-component-append.test.mjs';
import {assertHistoricalSourceStorageChanges} from '../../../tools/gis/historical-display-review.mjs';
export const INITIAL='initial-ordinary-prepared-source-append';
export function fixture(){
 const f=partialFixture(),old=f.before.geometryVersions[0],v=f.next.geometryVersions[0];
 f.root={schemaVersion:1,status:'source-topology-reviewed-conditional-on-coherent-pga-retirement',rows:[{entityId:f.before.entityId,versionId:old.versionId,validFrom:null,validTo:null,candidateGeometrySha256:gh(old.geometry),donorGeometrySha256:gh(old.geometry),exactDonorCoordinateCopy:true,periodPreserved:true,candidate:{valid:true,empty:false}}]};
 const rootRef={reference:'reports/initial-test/prepared-root.json',sha256:hash(json(f.root))};
 old.sourceId='approved-current-world-display-20261107';old.modernBoundarySupplement={sourceId:old.sourceId,status:'approved-prepared-current-source-adoption',sourceFile:'prepared-donor.geojson',sourceFileSha256:hash('actual donor file'),featureId:'AAA',geometrySha256:gh(old.geometry),geometryDigestFormat:'sha256(JSON.stringify([geometry.type, geometry.coordinates]))',adoptionMode:'complete-prepared-current-geometry; no additional simplification',historicalAccuracyVerified:false,effectiveDateEstablished:false,limitations:'Prepared proxy; not historical proof',upstream:{recordedSourceFileSha256:hash('actual prepared file'),sourceWP_IDs:[],sourceWP_IDsEvidence:null},sourceReview:rootRef};
 f.donor={type:'Feature',id:'AAA',properties:{name:'A'},geometry:structuredClone(old.geometry)};
 f.prepared={schemaVersion:1,method:'actual-recovered-prepared-feature',featureId:f.original.featureId,properties:structuredClone(f.original.properties),geometry:structuredClone(old.geometry),fileSha256:old.modernBoundarySupplement.upstream.recordedSourceFileSha256};
 f.updatePreparedBlob=()=>{f.prepared.rawBlobBase64=blob(f.prepared.geometry).toString('base64');f.prepared.blobSha256=hash(blob(f.prepared.geometry));f.prepared.wkbSha256=hash(wkb(f.prepared.geometry));};f.updatePreparedBlob();
 const m={schemaVersion:1,method:INITIAL,rawFeatureId:f.original.featureId,rawBlobSha256:f.original.rawBlobSha256};
 v.modernBoundarySupplement={...structuredClone(old.modernBoundarySupplement),sourceId:'raw-append',status:'raw-source-only-not-display-approved',adoptionMode:f.review.method,wholeCountryRaw:false,detachedComponentAppend:structuredClone(f.review.detachedComponentAppend),initialPreparedAppend:structuredClone(m),priorPreparedAttribution:structuredClone(old.modernBoundarySupplement)};f.review.initialPreparedAppend=structuredClone(m);
 f.proof={schemaVersion:1,method:INITIAL,preparedCorrespondence:old.geometry.coordinates.map((p,i)=>({currentComponent:i,preparedComponent:i,rings:p.map((_,j)=>({currentRing:j,preparedRing:j,offset:0,reverse:false}))}))};
 f.rebuildSources();const descriptorPath=base+'countries/state-AAA.json',descriptor=JSON.parse(f.sourceMap.get(descriptorPath)),shared={code:'AAA',versionId:old.versionId,validFrom:null,validTo:null,descriptorSha256:hash(f.sourceMap.get(descriptorPath)),resourceSha256:descriptor.geometryVersions[0].geometryResource.sha256};
 f.originalAnchor={rows:[{...shared,originalFeatures:[{WP_ID:f.original.featureId,GENC_3:'AAA',US_Recog:'Independent',Map_Disp:null,blobSha256:f.original.rawBlobSha256,wkbSha256:f.original.rawWkbSha256}]}]};
 f.preparedAnchor={rows:[{...shared,WP_ID:f.original.featureId,preparedBlobSha256:f.prepared.blobSha256,currentStrictArraysEqualDonor:true,currentEqualsDonorWhole:true,donorEqualsPreparedWhole:true,currentEqualsPreparedWhole:true}]};
 f.pinned=new Map([['reports/initial-test/original-scope.json',json(f.originalAnchor)],['reports/initial-test/prepared-scope.json',json(f.preparedAnchor)]]);
 f.authority.readPinnedEvidence=p=>f.pinned.get(p);
 const refresh=f.refresh;f.refresh=()=>{refresh();const put=(name,value)=>{const reference='reports/initial-test/'+name+'.json',bytes=json(value);f.evidence.set(reference,bytes);return {reference,sha256:hash(bytes)};};f.proof.originalSource=f.review.source;f.proof.originalScopeAnchor=put('original-scope',f.originalAnchor);f.proof.preparedScopeAnchor=put('prepared-scope',f.preparedAnchor);f.proof.preparedFeature=put('prepared-feature',f.prepared);f.proof.approvedDonorFeature=put('donor-feature',f.donor);f.proof.preparedAdoptionRoot=put('prepared-root',f.root);f.scope.initialPreparedSource=put('initial-proof',f.proof);f.review.detachedAppendScope=put('scope',f.scope);v.modernBoundarySupplement.sourceAdoptionReview=put('review',f.review);};f.refresh();return f;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
test('initial prepared append establishes only an audited partial raw anchor',()=>{const f=fixture();assert.equal(run(f),1);assert.equal(Object.hasOwn(f.before.geometryVersions[0].modernBoundarySupplement,'wholeCountryRaw'),false);assert.equal(f.next.geometryVersions[0].modernBoundarySupplement.wholeCountryRaw,false);assert.deepEqual(f.next.geometryVersions[0].geometry.coordinates.slice(0,2),f.before.geometryVersions[0].geometry.coordinates);});
const bad={
 'missing immutable pin reader':f=>{delete f.authority.readPinnedEvidence;},
 'new scope anchor absent from source pin':f=>{f.pinned.clear();},
 'original scope rewritten only in report HEAD':f=>{f.originalAnchor.rows[0].originalFeatures[0].blobSha256=hash('different');},
 'prepared scope rewritten only in report HEAD':f=>{f.preparedAnchor.rows[0].preparedBlobSha256=hash('different');},
 'all new raw bytes and new hashes replaced together':f=>{f.original.geometry.coordinates[1]=poly(30);f.original.rawBlobBase64=blob(f.original.geometry).toString('base64');f.original.rawBlobSha256=hash(blob(f.original.geometry));f.original.rawWkbSha256=hash(wkb(f.original.geometry));f.next.geometryVersions[0].geometry.coordinates[2]=poly(30);for(const m of [f.review.initialPreparedAppend,f.next.geometryVersions[0].modernBoundarySupplement.initialPreparedAppend])m.rawBlobSha256=f.original.rawBlobSha256;},
 'root forged and rehashed':f=>{f.root.rows[0].candidateGeometrySha256=hash('forged');},
 'prepared source file replaced':f=>{f.prepared.fileSha256=hash('other file');},
 'prepared UUID replaced':f=>{f.prepared.featureId='other';},
 'prepared political parent replaced':f=>{f.prepared.properties.WP_PAR_ID='other';},
 'prepared blob bytes forged':f=>{f.prepared.rawBlobBase64=Buffer.concat([blob(f.prepared.geometry),Buffer.from([0])]).toString('base64');},
 'prepared WKB hash forged':f=>{f.prepared.wkbSha256=hash('forged');},
 'donor geometry changed':f=>{f.donor.geometry.coordinates[0]=poly(-20);},
 'component mapping duplicated':f=>{f.proof.preparedCorrespondence[1].preparedComponent=0;},
 'component mapping omitted':f=>{f.proof.preparedCorrespondence.pop();},
 'ring offset wrong':f=>{f.proof.preparedCorrespondence[0].rings[0].offset=1;},
 'ring reversed without evidence':f=>{f.proof.preparedCorrespondence[0].rings[0].reverse=true;},
 'marker blob differs from original':f=>{f.next.geometryVersions[0].modernBoundarySupplement.initialPreparedAppend.rawBlobSha256=hash('bad');},
 'forged prior raw anchor added':f=>{f.next.geometryVersions[0].modernBoundarySupplement.pairedSourceReview={rawFeatureId:f.original.featureId,rawBlobSha256:f.original.rawBlobSha256};},
 'current dates changed':f=>{f.next.geometryVersions[0].validFrom='2000-01-01';},
 'current ownership changed':f=>{f.next.parentEntityId='state:BBB';},
 'prior caveat altered':f=>{f.next.geometryVersions[0].modernBoundarySupplement.limitations='removed';},
 'whole source claimed':f=>{f.next.geometryVersions[0].modernBoundarySupplement.wholeCountryRaw=true;},
 'old prefix moved':f=>{f.next.geometryVersions[0].geometry.coordinates[0][0][0][0]-=.1;},
 'current peer contact':f=>{f.peer.geometryVersions[0].geometry=multi([poly(10)]);f.rebuildSources();},
};
for(const [name,mutate]of Object.entries(bad))test('initial prepared append rejects '+name,()=>{const f=fixture();mutate(f);f.refresh();assert.throws(()=>run(f),/Raw source adoption:/);});
test('initial prepared append permits exact component permutation and cyclic rotation',()=>{const f=fixture(),ring=f.prepared.geometry.coordinates[0][0],open=ring.slice(0,-1);f.prepared.geometry.coordinates[0][0]=[...open.slice(2),...open.slice(0,2),open[2]];f.prepared.geometry.coordinates.reverse();f.updatePreparedBlob();f.proof.preparedCorrespondence[0].preparedComponent=1;f.proof.preparedCorrespondence[0].rings[0].offset=2;f.proof.preparedCorrespondence[1].preparedComponent=0;f.preparedAnchor.rows[0].preparedBlobSha256=f.prepared.blobSha256;f.pinned.set('reports/initial-test/prepared-scope.json',json(f.preparedAnchor));f.refresh();assert.equal(run(f),1);});
test('prepared correspondence may explicitly reverse only an exact existing ring',()=>{const f=fixture(),ring=f.prepared.geometry.coordinates[0][0],open=ring.slice(0,-1);f.prepared.geometry.coordinates[0][0]=[open[0],...open.slice(1).reverse(),open[0]];f.updatePreparedBlob();f.proof.preparedCorrespondence[0].rings[0].reverse=true;f.preparedAnchor.rows[0].preparedBlobSha256=f.prepared.blobSha256;f.pinned.set('reports/initial-test/prepared-scope.json',json(f.preparedAnchor));f.refresh();assert.equal(run(f),1);assert.deepEqual(f.next.geometryVersions[0].geometry.coordinates.slice(0,2),f.before.geometryVersions[0].geometry.coordinates);});
for(const [name,change]of Object.entries({
 'invalid candidate':root=>{root.rows[0].candidate.valid=false;},
 'unpreserved period':root=>{root.rows[0].periodPreserved=false;},
 'nonexact donor copy':root=>{root.rows[0].exactDonorCoordinateCopy=false;},
 'duplicate root row':root=>{root.rows.push(structuredClone(root.rows[0]));},
}))test('initial append rejects an immutably bound but unsuitable prepared root: '+name,()=>{const f=fixture();change(f.root);const p=f.before.geometryVersions[0].modernBoundarySupplement,s=f.next.geometryVersions[0].modernBoundarySupplement;p.sourceReview.sha256=hash(json(f.root));s.sourceReview=structuredClone(p.sourceReview);s.priorPreparedAttribution=structuredClone(p);f.rebuildSources();const d=hash(f.sourceMap.get(base+'countries/state-AAA.json'));for(const a of [f.originalAnchor,f.preparedAnchor])a.rows[0].descriptorSha256=d;f.pinned.set('reports/initial-test/original-scope.json',json(f.originalAnchor));f.pinned.set('reports/initial-test/prepared-scope.json',json(f.preparedAnchor));f.refresh();assert.throws(()=>run(f),/prepared adoption root row mismatch/);});
function followup(){const first=fixture();assert.equal(run(first),1);const f=partialFixture(),v=f.next.geometryVersions[0];f.before=structuredClone(first.next);Object.assign(f.next,structuredClone(f.before));f.next.geometryVersions=[v];Object.assign(v,structuredClone(f.before.geometryVersions[0]));v.geometry.coordinates.push(poly(20));v.modernBoundarySupplement.priorPreparedAttribution=structuredClone(f.before.geometryVersions[0].modernBoundarySupplement);f.scope.selectedRawIndexes=[2];f.rebuildSources();f.refresh();return f;}
test('admitted initial anchor permits a later ordinary append without fabricated paired review',()=>{const f=followup();assert.equal(run(f),1);assert.equal(f.next.geometryVersions[0].modernBoundarySupplement.pairedSourceReview,undefined);});
for(const [name,mutate]of Object.entries({
 'initial anchor removed':f=>{delete f.next.geometryVersions[0].modernBoundarySupplement.initialPreparedAppend;},
 'initial anchor replaced':f=>{f.next.geometryVersions[0].modernBoundarySupplement.initialPreparedAppend.rawBlobSha256=hash('other');},
 'initial receipt replayed against later preimage':f=>{f.review.initialPreparedAppend=structuredClone(f.next.geometryVersions[0].modernBoundarySupplement.initialPreparedAppend);},
 'initial source UUID changed with all raw hashes':f=>{f.original.featureId='new-uuid';f.original.properties.WP_ID=f.original.properties.WP_PAR_ID='new-uuid';},
}))test('follow-up append rejects '+name,()=>{const f=followup();mutate(f);f.refresh();assert.throws(()=>run(f),/Raw source adoption:/);});
for(const [name,mutate]of Object.entries({
 'unchanged geometry injection':f=>{f.next.geometryVersions[0].geometry=structuredClone(f.before.geometryVersions[0].geometry);},
 'marker-only no receipt escape':f=>{const s=f.next.geometryVersions[0].modernBoundarySupplement;delete s.sourceAdoptionReview;delete s.detachedComponentAppend;delete s.adoptionMode;},
 'marker-only disguised method':f=>{const s=f.next.geometryVersions[0].modernBoundarySupplement;delete s.detachedComponentAppend;s.adoptionMode=f.review.method='lossless-original-feature';},
 'unmarked initial proof':f=>{delete f.review.initialPreparedAppend;delete f.next.geometryVersions[0].modernBoundarySupplement.initialPreparedAppend;},
}))test('initial prepared append rejects '+name,()=>{const f=fixture();mutate(f);f.refresh();if(name==='marker-only no receipt escape')delete f.next.geometryVersions[0].modernBoundarySupplement.sourceAdoptionReview;assert.throws(()=>run(f),/Raw source adoption:/);});
test('admitted initial anchor cannot be removed in a metadata-only change',()=>{const f=fixture();assert.equal(run(f),1);const n=structuredClone(f.next);delete n.geometryVersions[0].modernBoundarySupplement.initialPreparedAppend;assert.throws(()=>assertHistoricalSourceStorageChanges(n,f.next,{prefixes:f.prefixes}),/detached-component append:/);});
test('pin reader is never asked for a non-report or traversal scope anchor',()=>{for(const reference of ['assets/data/private.json','reports/../private.json','reports/./scope.json','reports/a.json?revision=other']){const f=fixture();f.refresh();const proof=JSON.parse(f.evidence.get(f.scope.initialPreparedSource.reference));proof.originalScopeAnchor.reference=reference;const proofBytes=json(proof);f.evidence.set(f.scope.initialPreparedSource.reference,proofBytes);f.scope.initialPreparedSource.sha256=hash(proofBytes);const scopeBytes=json(f.scope);f.evidence.set(f.review.detachedAppendScope.reference,scopeBytes);f.review.detachedAppendScope.sha256=hash(scopeBytes);const reviewBytes=json(f.review),receipt=f.next.geometryVersions[0].modernBoundarySupplement.sourceAdoptionReview;f.evidence.set(receipt.reference,reviewBytes);receipt.sha256=hash(reviewBytes);let reads=0;f.authority.readPinnedEvidence=()=>{reads++;throw Error('unexpected read');};assert.throws(()=>run(f),/canonical pinned report path required/);assert.equal(reads,0);}});
}
