// Isolated actual-store integration. All repositories, writes and commits are test-owned OS temp fixtures.
// No production data checkout, source, pin, reports or common code is modified.
// Self-contained typed fixture mirrors the restoration unit contract, not its registered tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {encodeTerritorialSource,decodeTerritorialSource} from '../../../tools/data/territorial-source-codec.mjs';
import {assertHistoricalSourceStorageChanges} from '../../../tools/gis/historical-display-review.mjs';
import {prepareLibraryData,withLibraryWrite} from '../../../tools/data/library-runtime.mjs';
import {storeLibraryData} from '../../../tools/data/library-store.mjs';
import {decodeArchiveEntry,libraryCheckout} from '../../../tools/data/library-context.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex'),json=x=>Buffer.from(JSON.stringify(x)+'\n'),gh=g=>hash(JSON.stringify([g.type,g.coordinates])),base='assets/data/territorial-entities/source/',R='reports/restoration-test/',marker=()=>({schemaVersion:1,method:'restore-omitted-original-components'});
function wkb(g){const chunks=[],u=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);chunks.push(b);},header=t=>{chunks.push(Buffer.from([1]));u(t);};header(6);u(g.coordinates.length);for(const p of g.coordinates){header(3);u(p.length);for(const r of p){u(r.length);for(const [x,y]of r){const b=Buffer.alloc(16);b.writeDoubleLE(x,0);b.writeDoubleLE(y,8);chunks.push(b);}}}return Buffer.concat(chunks);}
function blob(g){const h=Buffer.alloc(40);h.write('GP');h[3]=3;h.writeInt32LE(4326,4);const a=g.coordinates.flat(2),xs=a.map(x=>x[0]),ys=a.map(x=>x[1]);[Math.min(...xs),Math.max(...xs),Math.min(...ys),Math.max(...ys)].forEach((v,i)=>h.writeDoubleLE(v,8+i*8));return Buffer.concat([h,wkb(g)]);}
const poly=x=>[[[x,0],[x+1,0],[x+1,1],[x,1],[x,0]]],multi=coordinates=>({type:'MultiPolygon',coordinates}),componentHash=c=>hash(wkb(multi([c])).subarray(9));
function fixture(REV='a'.repeat(40)){
 const raw=multi([poly(0),poly(10),poly(20)]),old=multi([poly(20),poly(0)]),properties={WP_ID:'uuid-AAA',WP_PAR_ID:'uuid-AAA',GENC_3:'AAA',US_Recog:'Independent',Map_Disp:null,Show_Disp:null},donorFileHash=hash('approved donor file'),preparedFileHash=hash('recovered prepared file'),originalFileHash=hash('original file');
 const rootReport={schemaVersion:1,status:'source-topology-reviewed-conditional-on-coherent-pga-retirement',rows:[{entityId:'state:AAA',versionId:'modern',validFrom:null,validTo:null,candidateGeometrySha256:gh(old),donorGeometrySha256:gh(old),exactDonorCoordinateCopy:true,periodPreserved:true,candidate:{valid:true,empty:false}}]},rootRef={reference:R+'root.json',sha256:hash(json(rootReport))};
 const root={sourceId:'approved-current-world-display-20261107',status:'approved-prepared-current-source-adoption',sourceFile:'approved.geojson',sourceFileSha256:donorFileHash,featureId:'AAA',geometrySha256:gh(old),sourceReview:rootRef,upstream:{recordedSourceFileSha256:preparedFileHash}};
 const supplement={...root,sourceId:'mixed-prepared-and-original-lsib-components',status:'partial-original-existing-components-not-all-raw-not-runtime-approved',wholeCountryRaw:false,existingComponentSourceReview:{previousGeometrySha256:gh(old),geometrySha256:gh(old),rawFeatureIds:[properties.WP_ID],rawBlobSha256:[hash(blob(raw))],components:[{currentComponent:0,rawComponent:2,WP_ID:properties.WP_ID,rawBlobSha256:hash(blob(raw))},{currentComponent:1,rawComponent:0,WP_ID:properties.WP_ID,rawBlobSha256:hash(blob(raw))}],scope:'Preimage-only indexed evidence'},priorPreparedAttribution:structuredClone(root)};
 const before={schemaVersion:2,entityId:'state:AAA',entityKind:'general',names:{en:'A'},parentEntityId:'',instantiation:{mode:'independent',countryUpdates:{}},lifetime:{validFrom:null,validTo:null},metadata:{representativeGeometryVersionId:'modern'},sourceInfo:{geometryVersionId:'modern',license:'unchanged'},geometryVersions:[{versionId:'modern',validFrom:null,validTo:null,sourceId:supplement.sourceId,geometry:old,modernBoundarySupplement:supplement}]};
 const next=structuredClone(before),v=next.geometryVersions[0];v.geometry=raw;v.sourceId='dos-world-polygons-11.4-beta-raw';v.modernBoundarySupplement={...supplement,sourceId:v.sourceId,status:'raw-source-only-not-display-approved',adoptionMode:'lossless-original-feature',wholeCountryRaw:true,wholeFeatureCompletion:marker(),priorPreparedAttribution:structuredClone(supplement),rawSourceFile:'original.gpkg',rawSourceFileSha256:originalFileHash,rawFeatureId:'uuid-AAA',sourceFileRole:'Preserved prepared source, new original attribution is separate.'};next.sourceInfo={...before.sourceInfo,sourceId:v.sourceId,title:'Complete original',geometryVersionId:v.versionId,geometrySha256:gh(raw)};
 const original={schemaVersion:1,method:'exact-gpkg-original-feature',sourcePath:'original.gpkg',featureId:'uuid-AAA',properties,geometry:structuredClone(raw),rawBlobBase64:blob(raw).toString('base64'),rawBlobSha256:hash(blob(raw)),rawWkbSha256:hash(wkb(raw)),sourceFileReceipt:{gpkgSha256:originalFileHash}};
 const prepared={schemaVersion:1,method:'actual-recovered-prepared-feature',featureId:'uuid-AAA',properties:structuredClone(properties),fileSha256:preparedFileHash,geometry:structuredClone(old),rawBlobBase64:blob(old).toString('base64'),blobSha256:hash(blob(old)),wkbSha256:hash(wkb(old))},donor={type:'Feature',id:'AAA',properties:{},geometry:structuredClone(old)};
 const enc=encodeTerritorialSource(before),beforeBytes=json(enc.descriptor),oldResource=[...enc.geometries][0],sourceMap=new Map([[base+'countries/state-AAA.json',beforeBytes],[base+oldResource[0],oldResource[1]]]);
 const peer=structuredClone(before);peer.entityId='state:BBB';peer.geometryVersions[0].versionId='peer-current';peer.geometryVersions[0].geometry=multi([poly(100)]);peer.names={en:'Synthetic peer'};peer.metadata.representativeGeometryVersionId='peer-current';peer.sourceInfo={sourceId:'test-peer-source',title:'Synthetic peer only',license:'unchanged',geometryVersionId:'peer-current',geometrySha256:gh(peer.geometryVersions[0].geometry)};peer.geometryVersions[0].sourceId='test-peer-source';delete peer.geometryVersions[0].modernBoundarySupplement;const pe=encodeTerritorialSource(peer),peerBytes=json(pe.descriptor),peerResource=[...pe.geometries][0];sourceMap.set(base+'countries/state-BBB.json',peerBytes);sourceMap.set(base+peerResource[0],peerResource[1]);
 const universe={schemaVersion:1,revision:REV,countries:[{path:base+'countries/state-AAA.json',entityId:'state:AAA',descriptorSha256:hash(beforeBytes),openEndedCount:1,allVersions:[{versionId:'modern',validFrom:null,validTo:null}]},{path:base+'countries/state-BBB.json',entityId:'state:BBB',descriptorSha256:hash(peerBytes),openEndedCount:1,allVersions:[{versionId:'peer-current',validFrom:null,validTo:null}]}],versions:[{entityId:'state:AAA',versionId:'modern',validFrom:null,validTo:null,descriptorPath:base+'countries/state-AAA.json',descriptorSha256:hash(beforeBytes),resourcePath:base+oldResource[0],resourceSha256:hash(oldResource[1]),bounds:[0,0,21,1],addedEnvelopeHits:[1]},{entityId:'state:BBB',versionId:'peer-current',validFrom:null,validTo:null,descriptorPath:base+'countries/state-BBB.json',descriptorSha256:hash(peerBytes),resourcePath:base+peerResource[0],resourceSha256:hash(peerResource[1]),bounds:[100,0,101,1],addedEnvelopeHits:[]}],duplicateCurrentKeys:0,multipleCurrent:[],zeroCurrent:[]};
 const map={schemaVersion:1,revision:REV,previousResourceSha256:hash(oldResource[1]),candidateSha256:hash(json(raw)),rawBlobSha256:original.rawBlobSha256,rawWkbSha256:original.rawWkbSha256,oldComponentCount:2,newComponentCount:3,deletedComponents:0,existingCoordinateMoves:0,pairs:[{oldIndex:0,newOriginalIndex:2,oldComponentWkbSha256:componentHash(old.coordinates[0]),originalComponentWkbSha256:componentHash(raw.coordinates[2]),coordinatesStrictEqual:true,componentWkbByteEqual:true},{oldIndex:1,newOriginalIndex:0,oldComponentWkbSha256:componentHash(old.coordinates[1]),originalComponentWkbSha256:componentHash(raw.coordinates[0]),coordinatesStrictEqual:true,componentWkbByteEqual:true}],addedComplement:[{originalIndex:1,componentWkbSha256:componentHash(raw.coordinates[1]),bounds:[10,0,11,1],holes:0,points:5,absentFromPreparedAndApproved:true}],oldIndexInterpretation:'Old reviews remain previousGeometry-bound evidence, never new-index claims.'};
 const bridge={schemaVersion:1,status:'scope-bridge-verified-pending-independent-review',revision:REV,entityId:'state:AAA',versionId:'modern',validFrom:null,validTo:null,descriptorSha256:hash(beforeBytes),previousResourceSha256:hash(oldResource[1]),original:{featureId:'uuid-AAA',blobSha256:original.rawBlobSha256,wkbSha256:original.rawWkbSha256,components:3},prepared:{featureId:'uuid-AAA',fileSha256:preparedFileHash,blobSha256:prepared.blobSha256,components:2},approvedDonor:{fileSha256:donorFileHash,featureId:'AAA',components:2,equalsPrepared:true,preparedMinusDonorEmpty:true,donorMinusPreparedEmpty:true,strictArraysEqual:true},politicalAttributesExactExceptFid:true,current14StrictOriginalSubset:true,uncertainty:'Synthetic fixture only, no political assignment or production approval.'};
 const lineage={schemaVersion:1,status:'ordinary-source-lineage-and-current-resource-bindings-verified',revision:REV,historicalProvenancePresent:false,synthesizedHistoricalRoot:false,entityId:'state:AAA',versionId:'modern',previousDescriptorSha256:hash(beforeBytes),previousResourceSha256:hash(oldResource[1]),previousGeometrySha256:gh(old),previousSupplementSha256:hash(JSON.stringify(supplement)),preparedSourceRoot:{attributionDepth:1,attribution:root,actualReviewSha256:rootRef.sha256,candidateGeometrySha256:gh(old),approvedDonorGeometrySha256:gh(old)}};
 const contacts={schemaVersion:1,status:'all-current-country-added-component-contacts-empty',revision:REV,countryDescriptorCount:2,currentVersionCount:2,zeroCurrentCount:0,multipleCurrent:[],bboxCandidateVersions:1,checks:[{entityId:'state:AAA',versionId:'modern',validFrom:null,validTo:null,descriptorSha256:hash(beforeBytes),resourceSha256:hash(oldResource[1]),checks:[{originalComponent:1,intersectionEmpty:true,intersectionArea:0}]}],nonemptyContacts:[]};
 const scope={schemaVersion:1,status:'typed-evidence-ready-pending-independent-review-no-source-admission',proposedMethod:'restore-omitted-original-components',revision:REV,target:{entityId:'state:AAA',versionId:'modern',validFrom:null,validTo:null,previousDescriptorSha256:hash(beforeBytes),previousResourceSha256:hash(oldResource[1]),previousGeometrySha256:gh(old),previousSupplementSha256:hash(JSON.stringify(supplement))},oldComponentCount:2,newComponentCount:3,oldHoles:0,newHoles:0,addedOriginalIndexes:[1],existingCoordinateMoves:0,deletedComponents:0,sourceScopeIdentityUnchanged:true,oldIndexMeaning:'Exact preimage-bound old indexes, new indexes only through explicit map.',uncertainty:bridge.uncertainty,approvalClaimed:false};
 const review={schemaVersion:1,status:'raw-source-only-not-display-approved',entityId:'state:AAA',versionId:'modern',validFrom:null,validTo:null,method:'lossless-original-feature',wholeFeatureCompletion:marker(),wholeCountryRaw:true,rawCoordinateRoundtrip:true,sourceInfoGeometryDigestFormat:'sha256(JSON.stringify([geometry.type, geometry.coordinates]))',topology:{status:'passed',checks:['validity','shared-boundary','gaps-overlaps','holes-islands','ownership'],counterpartVersions:[{entityId:'state:BBB',versionId:'peer-current',geometrySha256:gh(peer.geometryVersions[0].geometry)}]}};
 const docs={'original.json':original,'prepared.json':prepared,'donor.json':donor,'root.json':rootReport,'map.json':map,'bridge.json':bridge,'lineage.json':lineage,'universe.json':universe,'contacts.json':contacts,'scope.json':scope,'review.json':review},f={before,next,original,prepared,donor,rootReport,map,bridge,lineage,universe,contacts,scope,review,docs,sourceMap,authority:{archiveRevision:REV,sourcePin:REV,countryDescriptorPaths:universe.countries.map(c=>c.path)}};
 f.refresh=()=>{const store=new Map(),put=(n,x)=>{const b=json(x);store.set(R+n,b);return {reference:R+n,sha256:hash(b)};};const refs={originalSource:put('original.json',original),preparedFeature:put('prepared.json',prepared),approvedDonorFeature:put('donor.json',donor),preparedAdoptionRoot:put('root.json',rootReport)};Object.assign(bridge.original,{evidenceSha256:refs.originalSource.sha256});Object.assign(bridge.prepared,{evidenceSha256:refs.preparedFeature.sha256});Object.assign(bridge.approvedDonor,{evidenceSha256:refs.approvedDonorFeature.sha256});refs.componentMap=put('map.json',map);bridge.componentMapSha256=refs.componentMap.sha256;refs.scopeBridge=put('bridge.json',bridge);refs.currentPeerUniverse=put('universe.json',universe);contacts.universeSha256=refs.currentPeerUniverse.sha256;contacts.componentMapSha256=refs.componentMap.sha256;refs.currentPeerContacts=put('contacts.json',contacts);lineage.scopeBridgeSha256=refs.scopeBridge.sha256;lineage.componentMapSha256=refs.componentMap.sha256;lineage.universeSha256=refs.currentPeerUniverse.sha256;refs.ordinaryLineage=put('lineage.json',lineage);Object.assign(scope,refs);review.restorationScope=put('scope.json',scope);review.source=refs.originalSource;review.previousGeometrySha256=gh(before.geometryVersions[0].geometry);review.geometrySha256=gh(v.geometry);next.sourceInfo.geometrySha256=v.modernBoundarySupplement.geometrySha256=gh(v.geometry);v.modernBoundarySupplement.rawOriginalSource=refs.originalSource;v.modernBoundarySupplement.sourceAdoptionReview=put('review.json',review);f.evidence=store;f.prefixes=[base+'countries/state-AAA.json',base+'geometries/sha256-'+hash(json(v.geometry))+'.json'];};
 f.readEvidence=p=>f.evidence.get(p)||sourceMap.get(p);f.getSourceSnapshot=()=>f.authority;f.refresh();return f;
}
const GENERATED=base.replace('/source/','/generated/v2/')+'index.json';
const SOURCE=base+'countries/state-AAA.json';
const SENTINEL='assets/data/restoration-local-sentinel.json';
const put=(root,p,b)=>{const f=path.join(root,p);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,b);};
const git=(root,...args)=>execFileSync('git',['-c','core.autocrlf=false',...args],{cwd:root,encoding:'utf8',stdio:'pipe'}).trim();
function isolatedStore(t,{mutateEvidence,mutateHead,mutateSeed,nonSource=false}={}){
 for(const name of ['PANDOLAB_LIBRARY_DATA_ROOT','GIT_DIR','GIT_WORK_TREE','GIT_INDEX_FILE'])assert(!process.env[name], 'Isolated integration requires unset '+name);
 const parent=fs.mkdtempSync(path.join(tmpdir(),'pando-omitted-store-')),root=path.join(parent,'app'),data=path.join(root,'.library-data/repository');
 t.after(()=>{const actual=path.resolve(parent),allowed=path.resolve(tmpdir())+path.sep;assert(actual.startsWith(allowed));assert(path.basename(actual).startsWith('pando-omitted-store-'));fs.rmSync(actual,{recursive:true,force:true});});
 for(const dir of [root,data]){fs.mkdirSync(dir,{recursive:true});git(dir,'init','-q');git(dir,'config','core.longpaths','true');git(dir,'config','user.name','Fixture');git(dir,'config','user.email','fixture@example.invalid');}
 assert.equal(path.resolve(libraryCheckout(root)),path.resolve(data),'fixture must never resolve to production data');
 let files={};const add=(p,b)=>{put(data,p,b);files[p]={stored:p,encoding:'identity',sha256:hash(b),bytes:b.length};};
 const seed=fixture();for(const[p,b]of seed.sourceMap)add(p,b);add(GENERATED,json({entities:[]}));add(SENTINEL,json({value:0}));mutateSeed?.({add});
 const commit=label=>{put(data,'archive/index.json',json({schema:'pando-library-archive-v1',files}));git(data,'add','.');git(data,'commit','-qm',label);return git(data,'rev-parse','HEAD');};
 const pin=commit('isolated source seed'),f=fixture(pin);
 for(const[p,b]of f.sourceMap)assert.deepEqual(b,seed.sourceMap.get(p),'revision must not change source seed bytes');
 mutateEvidence?.(f);f.refresh();for(const[p,b]of f.evidence)add(p,b);
 const reportHead=commit('isolated fixed evidence report-only descendant');assert.notEqual(reportHead,pin);
 put(root,'config/library-data.json',json({repository:'fixture/data',revision:pin,mounts:['assets/data','reports']}));put(root,'.gitignore','.library-data/\nassets/data/\nreports/\n');git(root,'add','.');git(root,'commit','-qm','isolated app configuration');
 const env={parent,root,data,pin,f,add,commit,get files(){return files;},reportHead};
 // Advance the isolated archive before preparation makes its checkout sparse.
 // This gives the store a clean real descendant, not an uncommitted-file rejection.
 mutateHead?.(env);
 const beforeHead=git(data,'rev-parse','HEAD');
 prepareLibraryData({root,fetch:false,purpose:'gis',prefixes:nonSource?[SENTINEL]:[base+'countries',base+'geometries',GENERATED,SENTINEL]});
 assert.equal(git(data,'rev-parse','HEAD'),beforeHead,'preparation must retain the isolated archive descendant');
 assert.equal(git(data,'status','--porcelain'),'','fixture archive must be clean before testing admission');
 const candidate=encodeTerritorialSource(f.next);
 const writeCandidate=()=>withLibraryWrite({root,prefixes:f.prefixes},()=>{put(root,SOURCE,json(candidate.descriptor));for(const[p,b]of candidate.geometries)put(root,base+p,b);});
 const sourceBefore=JSON.parse(git(data,'show',beforeHead+':archive/index.json'));
 return {...env,candidate,beforeHead,sourceBefore,writeCandidate,store:()=>storeLibraryData({root,prefixes:f.prefixes,push:false}),read:(p,revision)=>{const index=JSON.parse(git(data,'show',revision+':archive/index.json'));return decodeArchiveEntry(data,index.files[p],revision,{fetch:false});}};
}
function rejectsWithoutArchiveMutation(s,pattern){
 s.writeCandidate();assert.throws(s.store,pattern);assert.equal(git(s.data,'rev-parse','HEAD'),s.beforeHead);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(s.data,'archive/index.json'))),s.sourceBefore);
}

test('isolated restoration actual store accepts report-only HEAD beyond source pin and preserves generated/evidence inputs',t=>{
 const s=isolatedStore(t);s.writeCandidate();const revision=s.store();assert.notEqual(revision,s.beforeHead);
 const index=JSON.parse(fs.readFileSync(path.join(s.data,'archive/index.json')));
 assert.deepEqual(index.files[GENERATED],s.sourceBefore.files[GENERATED]);assert.deepEqual(index.files[SENTINEL],s.sourceBefore.files[SENTINEL]);
 for(const[p]of s.f.evidence)assert.deepEqual(index.files[p],s.sourceBefore.files[p]);
 const stored=decodeTerritorialSource(JSON.parse(s.read(SOURCE,revision)),p=>s.read(base+p,revision));assert.deepEqual(stored,s.f.next);
 assert.deepEqual(JSON.parse(s.read(R+'review.json',revision)),s.f.review);
 for(const[p,b]of s.f.sourceMap)assert.deepEqual(s.read(p,s.pin),b,'original pinned fixture preimage remains byte-identical');
 assert.equal(assertHistoricalSourceStorageChanges(stored,s.f.before,{prefixes:s.f.prefixes,readEvidence:p=>s.read(p,s.beforeHead),getSourceSnapshot:()=>({archiveRevision:s.beforeHead,sourcePin:s.pin,countryDescriptorPaths:s.f.universe.countries.map(c=>c.path)})}),1);
 assert.deepEqual(stored.geometryVersions[0].geometry.coordinates[2],s.f.before.geometryVersions[0].geometry.coordinates[0]);
 assert.equal(stored.geometryVersions[0].geometry.coordinates.length,3);
 assert.equal(JSON.parse(fs.readFileSync(path.join(s.root,'config/library-data.json'))).revision,revision);
});

test('isolated restoration actual store refuses authoritative source descriptor drift after the reviewed source pin',t=>{
 const s=isolatedStore(t,{mutateHead:e=>{const p=base+'countries/state-BBB.json',d=JSON.parse(e.f.sourceMap.get(p));d.names.en='Unreviewed peer descriptor';e.add(p,json(d));e.commit('isolated source descriptor drift');}});
 rejectsWithoutArchiveMutation(s,/source|snapshot|pin|review|restor|changed/i);
});

test('isolated restoration actual store refuses a new country hidden from the reviewed census',t=>{
 const s=isolatedStore(t,{mutateHead:e=>{const d=JSON.parse(e.f.sourceMap.get(base+'countries/state-BBB.json'));d.entityId='state:CCC';d.geometryVersions[0].versionId='new-current';d.metadata.representativeGeometryVersionId='new-current';d.sourceInfo.geometryVersionId='new-current';e.add(base+'countries/state-CCC.json',json(d));e.commit('isolated hidden country');}});
 rejectsWithoutArchiveMutation(s,/source|snapshot|pin|census|country|restor|changed/i);
});

test('isolated restoration actual store refuses false census bounds even when booleans and evidence hashes are refreshed',t=>{
 const s=isolatedStore(t,{mutateEvidence:f=>{f.universe.versions[1].bounds=[200,0,201,1];}});
 rejectsWithoutArchiveMutation(s,/restor|bounds|bbox|census|snapshot/i);
});

test('isolated restoration actual store refuses omission of an authoritative country and its current version',t=>{
 const s=isolatedStore(t,{mutateEvidence:f=>{f.universe.countries.pop();f.universe.versions.pop();f.contacts.countryDescriptorCount=1;f.contacts.currentVersionCount=1;}});
 rejectsWithoutArchiveMutation(s,/restor|country|census|snapshot/i);
});

test('restoration gate cannot be called without authoritative store snapshot context',()=>{
 const f=fixture();assert.throws(()=>assertHistoricalSourceStorageChanges(f.next,f.before,{prefixes:f.prefixes,readEvidence:f.readEvidence}),/snapshot|context|restor/i);
});

test('isolated restoration actual store refuses a valid but non-ancestor source pin',t=>{
 const s=isolatedStore(t),tree=git(s.data,'rev-parse',s.pin+'^{tree}'),unrelated=git(s.data,'commit-tree',tree,'-m','isolated nonancestor source pin');
 const config=JSON.parse(fs.readFileSync(path.join(s.root,'config/library-data.json')));config.revision=unrelated;put(s.root,'config/library-data.json',json(config));
 rejectsWithoutArchiveMutation(s,/ancestor|history|integrate|pin|restor/i);
});

test('non-source actual store stays lazy and does not parse unrelated malformed source descriptors',t=>{
 const s=isolatedStore(t,{nonSource:true,mutateSeed:e=>{e.add(base+'countries/state-UNREAD.json',Buffer.from('not JSON; non-source store must not inspect this'));}});
 withLibraryWrite({root:s.root,prefixes:[SENTINEL]},()=>put(s.root,SENTINEL,json({value:1})));
 const revision=storeLibraryData({root:s.root,prefixes:[SENTINEL],push:false});assert.notEqual(revision,s.beforeHead);
 assert.deepEqual(JSON.parse(s.read(SENTINEL,revision)),{value:1});
 const index=JSON.parse(fs.readFileSync(path.join(s.data,'archive/index.json')));assert.deepEqual(index.files[base+'countries/state-UNREAD.json'],s.sourceBefore.files[base+'countries/state-UNREAD.json']);assert.deepEqual(index.files[SOURCE],s.sourceBefore.files[SOURCE]);
});




test('isolated restoration cannot replace the added raw component by rehashing every new proof past the immutable old full-blob anchor',t=>{
 let anchored;
 const s=isolatedStore(t,{mutateEvidence:f=>{
  anchored=f.before.geometryVersions[0].modernBoundarySupplement.existingComponentSourceReview.rawBlobSha256[0];
  f.next.geometryVersions[0].geometry.coordinates[1]=poly(11);
  const geometry=f.next.geometryVersions[0].geometry,bytes=blob(geometry),rawHash=hash(bytes),rawWkbHash=hash(wkb(geometry));
  f.original.geometry=structuredClone(geometry);f.original.rawBlobBase64=bytes.toString('base64');f.original.rawBlobSha256=rawHash;f.original.rawWkbSha256=rawWkbHash;
  Object.assign(f.map,{candidateSha256:hash(json(geometry)),rawBlobSha256:rawHash,rawWkbSha256:rawWkbHash});
  Object.assign(f.map.addedComplement[0],{componentWkbSha256:componentHash(geometry.coordinates[1]),bounds:[11,0,12,1]});
  Object.assign(f.bridge.original,{blobSha256:rawHash,wkbSha256:rawWkbHash});
  assert.notEqual(rawHash,anchored);
  assert.equal(f.before.geometryVersions[0].modernBoundarySupplement.existingComponentSourceReview.rawBlobSha256[0],anchored);
  // refresh() in isolatedStore rebuilds every new evidence reference/hash, never the old source preimage.
 }});
 assert.equal(s.f.before.geometryVersions[0].modernBoundarySupplement.existingComponentSourceReview.rawBlobSha256[0],anchored);
 rejectsWithoutArchiveMutation(s,/raw|original|identity|anchor|restor/i);
});



test('isolated restoration actual store refuses referenced peer resource drift with unchanged descriptor entries',t=>{
 const s=isolatedStore(t,{mutateHead:e=>{
  const resource=e.f.universe.versions.find(v=>v.entityId==='state:BBB').resourcePath;
  e.add(resource,json(multi([poly(101)])));e.commit('isolated referenced source resource drift');
 }});
 rejectsWithoutArchiveMutation(s,/source|snapshot|pin|resource|hash|changed|restor/i);
});


function rejectCompletedVersionChange(t, change, expected){
 const s=isolatedStore(t);s.writeCandidate();const completedRevision=s.store();
 assert.notEqual(completedRevision,s.beforeHead);
 const completed=decodeTerritorialSource(JSON.parse(s.read(SOURCE,completedRevision)),p=>s.read(base+p,completedRevision));
 assert.deepEqual(completed,s.f.next,'first actual store must archive the successful completion');
 const indexBefore=fs.readFileSync(path.join(s.data,'archive/index.json'));
 const pinBefore=fs.readFileSync(path.join(s.root,'config/library-data.json'));
 assert.equal(JSON.parse(pinBefore).revision,completedRevision);
 const next=structuredClone(completed);change(next);
 const encoded=encodeTerritorialSource(next),prefixes=[SOURCE];
 // Geometry payload stays identical and archived. Descriptor-only second store must
 // obtain the completed preimage from the archive, not the old fixture source.
 withLibraryWrite({root:s.root,prefixes},()=>put(s.root,SOURCE,json(encoded.descriptor)));
 assert.throws(()=>storeLibraryData({root:s.root,prefixes,push:false}),expected);
 assert.equal(git(s.data,'rev-parse','HEAD'),completedRevision);
 assert.deepEqual(fs.readFileSync(path.join(s.data,'archive/index.json')),indexBefore);
 assert.deepEqual(fs.readFileSync(path.join(s.root,'config/library-data.json')),pinBefore);
 assert.deepEqual(decodeTerritorialSource(JSON.parse(s.read(SOURCE,completedRevision)),p=>s.read(base+p,completedRevision)),completed);
 for(const[p,b]of s.f.sourceMap)assert.deepEqual(s.read(p,s.pin),b,'initial pinned source preimage remains unchanged');
 for(const[p]of s.f.evidence)assert.deepEqual(s.read(p,completedRevision),s.read(p,s.beforeHead),'completion evidence remains unchanged');
}

test('isolated second actual store rejects deleting the already completed version',t=>{
 rejectCompletedVersionChange(t,next=>{next.geometryVersions=[];},/version|geometry|completion|representative/i);
});

test('isolated second actual store rejects a schema-consistent unmarked replacement for the completed version',t=>{
 rejectCompletedVersionChange(t,next=>{
  const version=next.geometryVersions[0];version.versionId='replacement-current';
  delete version.modernBoundarySupplement;
  next.metadata.representativeGeometryVersionId=version.versionId;
  next.sourceInfo.geometryVersionId=version.versionId;
  assert.equal(next.sourceInfo.geometrySha256,gh(version.geometry));
 },/whole-feature completion: completed version inventory cannot change/);
});
