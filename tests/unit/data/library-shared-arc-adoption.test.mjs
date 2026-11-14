import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {assertHistoricalSourceStorageChanges as validate,assertHistoricalDisplayChanges,assertHistoricalCompiledChanges} from '../../../tools/gis/historical-display-review.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex'),digest=g=>hash(JSON.stringify([g.type,g.coordinates])),chainHash=c=>hash(JSON.stringify(c));
const base='assets/data/territorial-entities/source/',method='lossless-original-shared-arc';
const resource=g=>hash(JSON.stringify(g)+'\n');
function fixture(previous){
 const geometry={type:'MultiPolygon',coordinates:[[[[0,0],[2,0],[2,2],[0,2],[0,0]]],[[[9,9],[10,9],[10,10],[9,9]]]]};
 const before=previous?structuredClone(previous.next):{entityId:'state:AAA',parentEntityId:'',names:{en:'A'},lifetime:{validFrom:'1900',validTo:null},metadata:{representativeGeometryVersionId:'modern'},sourceInfo:{geometryVersionId:'modern',license:'retained'},geometryVersions:[{versionId:'modern',validFrom:null,validTo:null,sourceId:'prepared',geometry,historicalProvenance:{status:'provisional-modern-proxy',displayDetailReview:{status:'old-display-only',geometrySha256:digest(geometry)}}}]};
 const evidence=new Map(previous?.evidence||[]),put=(name,value)=>{const bytes=Buffer.from(JSON.stringify(value));evidence.set(name,bytes);return {reference:name,sha256:hash(bytes)};};
 let old=before.geometryVersions[0],priorPreparedSourceReview=previous?.proof.priorPreparedSourceReview;
 if(!previous){
  const prior={schemaVersion:1,status:'source-topology-reviewed-conditional-on-coherent-pga-retirement',rows:[{entityId:before.entityId,versionId:'modern',validFrom:null,validTo:null,candidateGeometrySha256:digest(geometry),donorGeometrySha256:digest(geometry),exactDonorCoordinateCopy:true,periodPreserved:true,candidate:{valid:true,empty:false}}]};
  priorPreparedSourceReview=put('reports/borders/prepared.json',prior);old.historicalProvenance.currentGeometrySource={status:'approved-prepared-current-source-adoption',geometrySha256:digest(geometry),sourceReview:priorPreparedSourceReview};old.modernBoundarySupplement={status:'prepared',politicalCaveat:'do not reallocate'};
 }
 const next=structuredClone(before),v=next.geometryVersions[0],start=previous?2:0,end=start+1,oldChain=old.geometry.coordinates[0][0].slice(start,end+1),newChain=[oldChain[0],previous?[2,1]:[1,-0.1],oldChain[1]];
 v.geometry.coordinates[0][0].splice(start,2,...newChain);
 const original={featureId:'original-A',blobSha256:hash('gpkg-feature-blob'),polygonIndex:0,ringIndex:0,startIndex:10,endIndex:12,coordinates:newChain,coordinatesSha256:chainHash(newChain)};
 const raw={schemaVersion:1,method:'exact-gpkg-wkb-chain-extraction',sourcePath:'original.gpkg',rows:[{code:'AAA',WP_ID:original.featureId,rawBlobSha256:original.blobSha256,rawPolygon:0,rawRing:0,rawRange:[10,12],coordinates:structuredClone(newChain),coordinatesSha256:chainHash(newChain),candidateExactOriginal:true}]};
 const source=put('reports/borders/raw-'+(previous?'second':'first')+'.json',raw);
 const cp={entityId:'state:BBB',versionId:'current',previousGeometrySha256:hash('peer-before'),geometrySha256:hash('peer-after'),geometryResourceSha256:hash('peer-resource'),previousCoordinates:[...oldChain].reverse(),coordinates:[...newChain].reverse(),previousCoordinatesSha256:chainHash([...oldChain].reverse()),coordinatesSha256:chainHash([...newChain].reverse())};
 const proof={schemaVersion:1,status:'raw-source-only-not-display-approved',method,entityId:before.entityId,versionId:'modern',validFrom:null,validTo:null,wholeCountryRaw:false,rawCoordinateRoundtrip:true,previousGeometrySha256:digest(old.geometry),geometrySha256:digest(v.geometry),source,priorPreparedSourceReview,sourceInfoGeometryDigestFormat:'sha256(JSON.stringify([geometry.type, geometry.coordinates]))',topology:{status:'passed',checks:['validity','shared-boundary','gaps-overlaps','holes-islands','ownership'],counterpartVersions:[{entityId:cp.entityId,versionId:cp.versionId,geometrySha256:cp.geometrySha256,geometryResourceSha256:cp.geometryResourceSha256}]},sharedArcChanges:[{target:{polygonIndex:0,ringIndex:0,startIndex:start,endIndex:end},previousCoordinatesSha256:chainHash(oldChain),coordinatesSha256:chainHash(newChain),original,counterpartVersion:cp}]};
 if(previous)proof.previousSharedArcReview=structuredClone(old.modernBoundarySupplement.sourceAdoptionReview);
 v.sourceId='partial-original';v.modernBoundarySupplement={...old.modernBoundarySupplement,status:'partial-original-shared-arcs-not-display-approved',adoptionMode:method,wholeCountryRaw:false,geometrySha256:digest(v.geometry),priorPreparedAttribution:structuredClone(old.modernBoundarySupplement)};
 next.sourceInfo.geometrySha256=digest(v.geometry);
 const f={before,next,proof,raw,evidence,readEvidence:n=>evidence.get(n),refresh(){proof.geometrySha256=digest(v.geometry);proof.sourceScope=[{entityId:next.entityId,versionId:v.versionId,geometrySha256:digest(v.geometry),geometryResourceSha256:resource(v.geometry)},...proof.topology.counterpartVersions];f.prefixes=proof.sourceScope.flatMap(r=>[base+'countries/'+r.entityId.replace(':','-')+'.json',base+'geometries/sha256-'+r.geometryResourceSha256+'.json']);v.modernBoundarySupplement.sourceAdoptionReview=put('reports/borders/arc-'+(previous?'second':'first')+'.json',proof);}};f.refresh();return f;
}
test('explicit undated shared-arc receipt admits exact first and consecutive second splice only',()=>{const f=fixture(),snapshot=structuredClone(f.next);assert.equal(validate(f.next,f.before,f),1);assert.deepEqual(f.next,snapshot);const second=fixture(f);assert.equal(validate(second.next,second.before,second),1);assert.deepEqual(second.next.geometryVersions[0].historicalProvenance,f.before.geometryVersions[0].historicalProvenance);});
test('shared-arc source receipt never approves historical display or compiled derivatives',()=>{const f=fixture(),v=f.next.geometryVersions[0];assert.throws(()=>assertHistoricalDisplayChanges(f.next,f.before));const compiled={entityId:f.next.entityId,identity:{properties:{metadata:{historicalTimeline:{geometryVersions:[v]}}}},geometries:[{id:'g',version:1,geojson:v.geometry}],sourceBindings:[{sourceVersionId:v.versionId,geometryRef:{id:'g',version:1},validFrom:null,validTo:null}]};assert.throws(()=>assertHistoricalCompiledChanges(compiled,null));});
const mutations={
 'missing receipt':f=>f.evidence.delete(f.next.geometryVersions[0].modernBoundarySupplement.sourceAdoptionReview.reference),
 'corrupt receipt':f=>f.evidence.set(f.next.geometryVersions[0].modernBoundarySupplement.sourceAdoptionReview.reference,Buffer.from('{}')),
 'missing source':f=>f.evidence.delete(f.proof.source.reference),
 'corrupt source':f=>f.evidence.set(f.proof.source.reference,Buffer.from('{}')),
 'missing prepared':f=>f.evidence.delete(f.proof.priorPreparedSourceReview.reference),
 'compiled scope':f=>f.prefixes.push('assets/data/territorial-entities/compiled/state-AAA.json'),
 'unrelated source scope':f=>f.prefixes.push(base+'countries/state-OTHER.json'),
 'duplicate scope':f=>f.prefixes.push(f.prefixes[0]),
};
for(const [name,mutate] of Object.entries(mutations))test('shared arc rejects '+name,()=>{const f=fixture();mutate(f);assert.throws(()=>validate(f.next,f.before,f));});
const proofMutations={
 'stale previous':f=>f.proof.previousGeometrySha256=hash('stale'),
 'stale identity':f=>f.proof.entityId='state:OTHER',
 'dated receipt':f=>f.proof.validFrom='1900',
 'whole-feature claim':f=>f.proof.wholeCountryRaw=true,
 'wrong method':f=>f.proof.method='lossless-original-feature',
 'missing arcs':f=>delete f.proof.sharedArcChanges,
 'empty arcs':f=>f.proof.sharedArcChanges=[],
 'invalid range':f=>f.proof.sharedArcChanges[0].target.endIndex=999,
 'negative index':f=>f.proof.sharedArcChanges[0].target.startIndex=-1,
 'fractional index':f=>f.proof.sharedArcChanges[0].target.startIndex=0.5,
 'wrapped range':f=>{f.proof.sharedArcChanges[0].target.startIndex=3;f.proof.sharedArcChanges[0].target.endIndex=1;},
 'hole index':f=>f.proof.sharedArcChanges[0].target.ringIndex=1,
 'duplicate arc':f=>f.proof.sharedArcChanges.push(structuredClone(f.proof.sharedArcChanges[0])),
 'overlapping arc':f=>{const c=structuredClone(f.proof.sharedArcChanges[0]);c.target.endIndex=2;f.proof.sharedArcChanges.push(c);},
 'wrong old chain hash':f=>f.proof.sharedArcChanges[0].previousCoordinatesSha256=hash('bad'),
 'wrong new chain hash':f=>f.proof.sharedArcChanges[0].coordinatesSha256=hash('bad'),
 'wrong source feature':f=>f.proof.sharedArcChanges[0].original.featureId='other',
 'wrong source blob':f=>f.proof.sharedArcChanges[0].original.blobSha256=hash('bad'),
 'wrong source range':f=>f.proof.sharedArcChanges[0].original.endIndex=99,
 'wrong source coordinates':f=>{const o=f.proof.sharedArcChanges[0].original;o.coordinates[1]=[1,0.1];o.coordinatesSha256=chainHash(o.coordinates);},
 'moved endpoint':f=>f.proof.sharedArcChanges[0].original.coordinates[0]=[0.1,0],
 'missing counterpart':f=>delete f.proof.sharedArcChanges[0].counterpartVersion,
 'self counterpart':f=>f.proof.sharedArcChanges[0].counterpartVersion.entityId=f.next.entityId,
 'wrong counterpart version':f=>f.proof.sharedArcChanges[0].counterpartVersion.versionId='wrong',
 'wrong counterpart geometry':f=>f.proof.sharedArcChanges[0].counterpartVersion.geometrySha256=hash('bad'),
 'wrong counterpart prior hash':f=>f.proof.sharedArcChanges[0].counterpartVersion.previousCoordinatesSha256=hash('bad'),
 'wrong counterpart chain':f=>f.proof.sharedArcChanges[0].counterpartVersion.coordinates.reverse(),
 'missing topology':f=>f.proof.topology.checks=[],
 'outside coordinate':f=>f.next.geometryVersions[0].geometry.coordinates[0][0][4]=[0,3],
 'island change':f=>f.next.geometryVersions[0].geometry.coordinates[1][0][1]=[11,9],
 'open closure':f=>f.next.geometryVersions[0].geometry.coordinates[0][0].pop(),
 'geometry metadata':f=>f.next.geometryVersions[0].geometry.bbox=[0,0,10,10],
 'provenance change':f=>f.next.geometryVersions[0].historicalProvenance.status='verified',
 'display receipt digest rewrite':f=>f.next.geometryVersions[0].historicalProvenance.displayDetailReview.geometrySha256=f.proof.geometrySha256,
 'ownership change':f=>f.next.parentEntityId='state:OTHER',
 'period change':f=>f.next.geometryVersions[0].validFrom='1900',
 'dated source':f=>{f.before.geometryVersions[0].validFrom='1900';f.next.geometryVersions[0].validFrom='1900';},
 'multiple versions':f=>{f.before.geometryVersions.push({...structuredClone(f.before.geometryVersions[0]),versionId:'second'});f.next.geometryVersions.push({...structuredClone(f.before.geometryVersions[1])});},
 'prior caveat changed':f=>f.next.geometryVersions[0].modernBoundarySupplement.politicalCaveat='changed',
 'partial attribution removed':f=>delete f.next.geometryVersions[0].modernBoundarySupplement.adoptionMode,
 'whole attribution':f=>f.next.geometryVersions[0].modernBoundarySupplement.wholeCountryRaw=true,
 'source digest stale':f=>f.next.sourceInfo.geometrySha256=hash('bad'),
};
for(const [name,mutate] of Object.entries(proofMutations))test('shared arc rejects bound '+name,()=>{const f=fixture();mutate(f);f.refresh();assert.throws(()=>validate(f.next,f.before,f));});
for(const kind of ['missing previous','wrong previous receipt','prior candidate mismatch','root prepared mismatch'])test('shared arc rejects broken second-admission lineage '+kind,()=>{const first=fixture(),f=fixture(first);if(kind==='missing previous')delete f.proof.previousSharedArcReview;if(kind==='wrong previous receipt')f.proof.previousSharedArcReview={...f.proof.priorPreparedSourceReview};if(kind==='prior candidate mismatch'){const ref=f.proof.previousSharedArcReview.reference,p=JSON.parse(f.evidence.get(ref));p.geometrySha256=hash('wrong');f.evidence.set(ref,Buffer.from(JSON.stringify(p)));}if(kind==='root prepared mismatch')f.proof.priorPreparedSourceReview.sha256=hash('wrong');f.refresh();assert.throws(()=>validate(f.next,f.before,f));});

function seal(f){const r=f.next.geometryVersions[0].modernBoundarySupplement.sourceAdoptionReview,b=Buffer.from(JSON.stringify(f.proof));f.evidence.set(r.reference,b);r.sha256=hash(b);}
function bindGeometry(f){const v=f.next.geometryVersions[0];v.modernBoundarySupplement.geometrySha256=f.next.sourceInfo.geometrySha256=digest(v.geometry);f.refresh();}
test('new shared-arc no-op receipt cannot bypass validation through unchanged geometry',()=>{const f=fixture();f.next.geometryVersions[0].geometry=structuredClone(f.before.geometryVersions[0].geometry);bindGeometry(f);assert.throws(()=>validate(f.next,f.before,f));});
test('adjacent indexed arcs sharing only an unchanged endpoint preserve exact exterior and islands',()=>{
 const f=fixture(),v=f.next.geometryVersions[0],old=f.before.geometryVersions[0].geometry.coordinates[0][0],coordinates=[[2,0],[2.1,1],[2,2]],previousCoordinates=old.slice(1,3),c=structuredClone(f.proof.sharedArcChanges[0]);
 c.target={polygonIndex:0,ringIndex:0,startIndex:1,endIndex:2};c.original={...c.original,startIndex:20,endIndex:22,coordinates,coordinatesSha256:chainHash(coordinates)};c.previousCoordinatesSha256=chainHash(previousCoordinates);c.coordinatesSha256=chainHash(coordinates);c.counterpartVersion={...c.counterpartVersion,previousCoordinates:[...previousCoordinates].reverse(),coordinates:[...coordinates].reverse(),previousCoordinatesSha256:chainHash([...previousCoordinates].reverse()),coordinatesSha256:chainHash([...coordinates].reverse())};f.proof.sharedArcChanges.push(c);
 f.raw.rows.push({...structuredClone(f.raw.rows[0]),rawRange:[20,22],coordinates,coordinatesSha256:chainHash(coordinates)});const b=Buffer.from(JSON.stringify(f.raw));f.evidence.set(f.proof.source.reference,b);f.proof.source.sha256=hash(b);
 v.geometry.coordinates[0][0]=[[0,0],[1,-0.1],[2,0],[2.1,1],[2,2],[0,2],[0,0]];bindGeometry(f);assert.equal(validate(f.next,f.before,f),1);
});
for(const name of ['outside coordinate','island change','open closure','geometry metadata'])test('exact reconstruction rejects fully rebound '+name,()=>{const f=fixture();proofMutations[name](f);bindGeometry(f);assert.throws(()=>validate(f.next,f.before,f),/outside selected shared arcs|closure/);});
for(const kind of ['stale prepared row','false copy','wrong source row coordinates','wrong root digest','unrelated declared row','partial source scope','counterpart previous digest missing','nonfinite original','original closed loop'])test('shared arc rejects additional bound '+kind,()=>{
 const f=fixture();
 if(kind==='stale prepared row'||kind==='false copy'){const ref=f.proof.priorPreparedSourceReview.reference,p=JSON.parse(f.evidence.get(ref));if(kind==='stale prepared row')p.rows[0].candidateGeometrySha256=hash('stale');else p.rows[0].exactDonorCoordinateCopy=false;const b=Buffer.from(JSON.stringify(p));f.evidence.set(ref,b);const sha=hash(b);f.proof.priorPreparedSourceReview.sha256=sha;for(const e of [f.before,f.next])e.geometryVersions[0].historicalProvenance.currentGeometrySource.sourceReview.sha256=sha;}
 if(kind==='wrong source row coordinates'){f.raw.rows[0].coordinates[1]=[1,0.2];const b=Buffer.from(JSON.stringify(f.raw));f.evidence.set(f.proof.source.reference,b);f.proof.source.sha256=hash(b);}
 if(kind==='wrong root digest')for(const e of [f.before,f.next])e.geometryVersions[0].historicalProvenance.currentGeometrySource.geometrySha256=hash('other');
 if(kind==='unrelated declared row')f.proof.sourceScope.push({entityId:'state:OTHER',versionId:'current',geometrySha256:hash('other'),geometryResourceSha256:hash('other-resource')});
 if(kind==='partial source scope')f.proof.sourceScope.shift();
 if(kind==='counterpart previous digest missing')delete f.proof.sharedArcChanges[0].counterpartVersion.previousGeometrySha256;
 if(kind==='nonfinite original')f.proof.sharedArcChanges[0].original.coordinates[1]=[Infinity,0];
 if(kind==='original closed loop')f.proof.sharedArcChanges[0].original.coordinates.at(-1)[0]=0;
 seal(f);assert.throws(()=>validate(f.next,f.before,f));
});

test('partial arc cannot relabel original source evidence allowed by whole-feature attribution',()=>{const f=fixture();for(const e of [f.before,f.next])e.geometryVersions[0].modernBoundarySupplement.sourceFile='preserved.gpkg';f.next.geometryVersions[0].modernBoundarySupplement.priorPreparedAttribution.sourceFile='preserved.gpkg';f.next.geometryVersions[0].modernBoundarySupplement.sourceFile='unrelated.gpkg';assert.throws(()=>validate(f.next,f.before,f),/prior source evidence/);});
test('already admitted shared-arc metadata-only save retains the existing receipt without revalidation',()=>{const f=fixture(),next=structuredClone(f.next);next.names.en='Updated name';assert.equal(validate(next,f.next,{prefixes:[base+'countries/state-AAA.json']}),0);});

test('rehashed previous receipt must still reach the immutable prepared root',()=>{const f=fixture(fixture()),ref=f.proof.previousSharedArcReview.reference,p=JSON.parse(f.evidence.get(ref));p.previousGeometrySha256=hash('different-root');const b=Buffer.from(JSON.stringify(p));f.evidence.set(ref,b);for(const r of [f.proof.previousSharedArcReview,f.before.geometryVersions[0].modernBoundarySupplement.sourceAdoptionReview,f.next.geometryVersions[0].modernBoundarySupplement.priorPreparedAttribution.sourceAdoptionReview])r.sha256=hash(b);seal(f);assert.throws(()=>validate(f.next,f.before,f),/does not reach prepared source/);});
test('rehashed source and counterpart cannot authorize moved splice endpoints',()=>{const f=fixture(),c=f.proof.sharedArcChanges[0],v=f.next.geometryVersions[0];c.original.coordinates[0]=[0.1,0];c.coordinatesSha256=c.original.coordinatesSha256=chainHash(c.original.coordinates);c.counterpartVersion.coordinates=[...c.original.coordinates].reverse();c.counterpartVersion.coordinatesSha256=chainHash(c.counterpartVersion.coordinates);f.raw.rows[0].coordinates=structuredClone(c.original.coordinates);f.raw.rows[0].coordinatesSha256=c.coordinatesSha256;const b=Buffer.from(JSON.stringify(f.raw));f.evidence.set(f.proof.source.reference,b);f.proof.source.sha256=hash(b);v.geometry.coordinates[0][0][0]=[0.1,0];v.geometry.coordinates[0][0][v.geometry.coordinates[0][0].length-1]=[0.1,0];bindGeometry(f);assert.throws(()=>validate(f.next,f.before,f),/exact endpoints/);});

for(const overwrite of [false,true])test('second shared-arc admission '+(overwrite?'rejects overwritten':'preserves existing')+' paired-source caveat',()=>{
 const first=fixture();first.next.geometryVersions[0].modernBoundarySupplement.pairedSourceReview={wholeCountryRaw:false,method:'exact-original-shared-arc-splice',group:['AAA','BBB'],proofReference:'reports/borders/first-pair.json',proofSha256:hash('first pair evidence'),arcs:[{pair:['AAA','BBB'],inputRange:[0,1],vertices:3}],scope:'Only the first paired frontier; all other allocations preserved.'};
 const second=fixture(first),v=second.next.geometryVersions[0];
 if(overwrite){v.modernBoundarySupplement.pairedSourceReview={...v.modernBoundarySupplement.pairedSourceReview,proofReference:'reports/borders/second-pair.json',proofSha256:hash('second pair evidence'),arcs:[{pair:['AAA','BBB'],inputRange:[2,3],vertices:3}]};assert.throws(()=>validate(second.next,second.before,second),/source caveat changed: pairedSourceReview/);}
 else{const prior=structuredClone(first.next.geometryVersions[0].modernBoundarySupplement.pairedSourceReview);assert.equal(validate(second.next,second.before,second),1);assert.deepEqual(v.modernBoundarySupplement.pairedSourceReview,prior);assert.deepEqual(v.historicalProvenance,first.next.geometryVersions[0].historicalProvenance);}
});
