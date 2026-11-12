// RED draft for an explicitly marked partial-to-whole original completion path.
// Synthetic fixtures only unless PANDO_MCO_COMPLETION_DIR is supplied. No writes/store/pin.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {decodeTerritorialSource} from '../../../tools/data/territorial-source-codec.mjs';
import {assertHistoricalSourceStorageChanges,assertHistoricalDisplayChanges} from '../../../tools/gis/historical-display-review.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex'),digest=g=>hash(JSON.stringify([g.type,g.coordinates])),json=x=>Buffer.from(JSON.stringify(x)+'\n');
const base='assets/data/territorial-entities/source/',sourcePath='reports/completion/original.json',reviewPath='reports/completion/admission.json';
const marker=()=>({schemaVersion:1,method:'partial-to-whole-original-single-component'});
function wkb(g){
 const chunks=[],u=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);chunks.push(b);},header=t=>{chunks.push(Buffer.from([1]));u(t);};
 const polygon=rings=>{header(3);u(rings.length);for(const ring of rings){u(ring.length);for(const [x,y]of ring){const b=Buffer.alloc(16);b.writeDoubleLE(x,0);b.writeDoubleLE(y,8);chunks.push(b);}}};
 if(g.type==='Polygon')polygon(g.coordinates);else {header(6);u(g.coordinates.length);for(const p of g.coordinates)polygon(p);}return Buffer.concat(chunks);
}
function blob(g){const h=Buffer.alloc(40);h.write('GP');h[2]=0;h[3]=3;h.writeInt32LE(4326,4);const points=g.type==='Polygon'?g.coordinates.flat():g.coordinates.flat(2),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);[Math.min(...xs),Math.max(...xs),Math.min(...ys),Math.max(...ys)].forEach((v,i)=>h.writeDoubleLE(v,8+i*8));return Buffer.concat([h,wkb(g)]);}
function bindBlob(f,b){f.source.rawBlobBase64=b.toString('base64');f.source.rawBlobSha256=hash(b);f.source.rawWkbSha256=hash(b.subarray(40));}
function assemble(before,geometry,source){
 const next=structuredClone(before),old=before.geometryVersions[0],v=next.geometryVersions[0];v.geometry=geometry;v.sourceId='dos-world-polygons-11.4-beta-raw';
 v.modernBoundarySupplement={...old.modernBoundarySupplement,sourceId:v.sourceId,status:'raw-source-only-not-display-approved',geometrySha256:digest(geometry),adoptionMode:'lossless-original-feature',wholeCountryRaw:true,priorPreparedAttribution:structuredClone(old.modernBoundarySupplement),wholeFeatureCompletion:marker(),rawSourceFile:source.sourcePath,rawSourceFileSha256:source.sourceFileReceipt?.gpkgSha256,rawFeatureId:source.featureId,sourceFileRole:'Preserved prepared attribution; rawSourceFile identifies current original.'};
 next.sourceInfo={...before.sourceInfo,sourceId:v.sourceId,title:'Whole original',geometryVersionId:v.versionId,geometrySha256:digest(geometry)};
 const review={schemaVersion:1,status:'raw-source-only-not-display-approved',entityId:next.entityId,versionId:v.versionId,validFrom:null,validTo:null,method:'lossless-original-feature',wholeCountryRaw:true,wholeFeatureCompletion:marker(),rawCoordinateRoundtrip:true,sourceInfoGeometryDigestFormat:'sha256(JSON.stringify([geometry.type, geometry.coordinates]))',topology:{status:'passed',checks:['validity','shared-boundary','gaps-overlaps','holes-islands','ownership'],counterpartVersions:[{entityId:'state:BBB',versionId:'modern',geometrySha256:hash('fixed-peer')}]} };
 const f={before,next,source,review};f.refresh=()=>{review.previousGeometrySha256=digest(old.geometry);review.geometrySha256=digest(v.geometry);next.sourceInfo.geometrySha256=v.modernBoundarySupplement.geometrySha256=digest(v.geometry);f.sourceBytes=json(source);review.source={reference:sourcePath,sha256:hash(f.sourceBytes)};v.modernBoundarySupplement.rawOriginalSource=structuredClone(review.source);f.reviewBytes=json(review);v.modernBoundarySupplement.sourceAdoptionReview={reference:reviewPath,sha256:hash(f.reviewBytes)};f.prefixes=[base+'countries/'+next.entityId.replace(':','-')+'.json',base+'geometries/sha256-'+hash(json(v.geometry))+'.json'];};f.readEvidence=p=>p===sourcePath?f.sourceBytes:p===reviewPath?f.reviewBytes:undefined;f.refresh();return f;
}
function fixture({oldType='Polygon'}={}){
 const ring=[[0,0],[1,0],[1,1],[0,1],[0,0]],oldGeometry={type:oldType,coordinates:oldType==='Polygon'?[ring]:[[ring]]},geometry={type:'MultiPolygon',coordinates:[[[[0,0],[1.1,0],[1.1,1],[0,1],[0,0]]]]};
 const prior={sourceId:'mixed-prepared-and-original',status:'partial',wholeCountryRaw:false,sourceFile:'prepared.geojson',sourceFileSha256:hash('prepared'),featureId:'AAA-prepared',rawLayer:'older-layer',sourceWP_IDs:['older-evidence'],rawBlobSha256:hash('older-blob'),microstateSharedBoundaryReview:{scope:'Existing paired border, preserved'},politicalCaveat:'Unchanged'};
 const before={schemaVersion:2,entityId:'state:AAA',entityKind:'general',names:{en:'A'},parentEntityId:'',instantiation:{mode:'independent',countryUpdates:{}},lifetime:{validFrom:null,validTo:null},metadata:{representativeGeometryVersionId:'modern'},sourceInfo:{geometryVersionId:'modern',license:'preserved'},geometryVersions:[{versionId:'modern',validFrom:null,validTo:null,geometry:oldGeometry,historicalProvenance:{status:'provisional-modern-proxy',note:'not newly dated'},modernBoundarySupplement:prior}]};
 const source={sourcePath:'original.gpkg',sourceFileReceipt:{gpkgSha256:hash('original-fullfile')},schemaVersion:1,method:'exact-gpkg-original-feature',featureId:'original-AAA',properties:{WP_ID:'original-AAA',WP_PAR_ID:'original-AAA',GENC_3:'AAA',US_Recog:'Independent',Map_Disp:null,Show_Disp:null},geometry:structuredClone(geometry)};const f=assemble(before,geometry,source);bindBlob(f,blob(geometry));f.refresh();return f;
}
const run=f=>assertHistoricalSourceStorageChanges(f.next,f.before,{prefixes:f.prefixes,readEvidence:f.readEvidence});
for(const oldType of ['Polygon','MultiPolygon'])test('completion accepts exact original singleton from '+oldType,()=>{const f=fixture({oldType}),n=structuredClone(f.next),old=structuredClone(f.before);assert.equal(run(f),1);assert.deepEqual(f.next,n);assert.deepEqual(f.before,old);assert.throws(()=>assertHistoricalDisplayChanges(f.next,f.before),/Historical display review required/);});
test('legacy initial full-feature adoption remains admitted without completion marker',()=>{const f=fixture();delete f.before.geometryVersions[0].modernBoundarySupplement.wholeCountryRaw;delete f.next.geometryVersions[0].modernBoundarySupplement.priorPreparedAttribution.wholeCountryRaw;delete f.next.geometryVersions[0].modernBoundarySupplement.wholeFeatureCompletion;delete f.review.wholeFeatureCompletion;f.refresh();assert.equal(run(f),1);});
const cases={
 'missing candidate marker':f=>{delete f.next.geometryVersions[0].modernBoundarySupplement.wholeFeatureCompletion;},
 'missing review marker':f=>{delete f.review.wholeFeatureCompletion;},
 'unknown marker':f=>{f.review.wholeFeatureCompletion.method='generic';},
 'marker schema':f=>{f.review.wholeFeatureCompletion.schemaVersion=2;},
 'old flag missing':f=>{delete f.before.geometryVersions[0].modernBoundarySupplement.wholeCountryRaw;delete f.next.geometryVersions[0].modernBoundarySupplement.priorPreparedAttribution.wholeCountryRaw;},
 'old false stays false':f=>{f.next.geometryVersions[0].modernBoundarySupplement.wholeCountryRaw=false;f.review.wholeCountryRaw=false;},
 'old false to missing':f=>{delete f.next.geometryVersions[0].modernBoundarySupplement.wholeCountryRaw;},
 'old true to false':f=>{f.before.geometryVersions[0].modernBoundarySupplement.wholeCountryRaw=true;f.next.geometryVersions[0].modernBoundarySupplement.priorPreparedAttribution.wholeCountryRaw=true;f.next.geometryVersions[0].modernBoundarySupplement.wholeCountryRaw=false;},
 'review whole false':f=>{f.review.wholeCountryRaw=false;},
 'review whole missing':f=>{delete f.review.wholeCountryRaw;},
 'review wrong method':f=>{f.review.method='lossless-original-subgeometry';},
 'supplement wrong method':f=>{f.next.geometryVersions[0].modernBoundarySupplement.adoptionMode='lossless-original-subgeometry';},
 'date added':f=>{f.next.geometryVersions[0].validFrom='2000';},
 'existing dated current':f=>{f.before.geometryVersions[0].validFrom=f.next.geometryVersions[0].validFrom='2000';f.review.validFrom='2000';},
 'extra historical version':f=>{for(const e of [f.before,f.next])e.geometryVersions.push({versionId:'old',validFrom:'1900',validTo:'1999',geometry:structuredClone(f.before.geometryVersions[0].geometry)});},
 'two components':f=>{const g=f.next.geometryVersions[0].geometry;g.coordinates.push(structuredClone(g.coordinates[0]));f.source.geometry=structuredClone(g);bindBlob(f,blob(g));},
 'new hole':f=>{const g=f.next.geometryVersions[0].geometry;g.coordinates[0].push([[.1,.1],[.2,.1],[.2,.2],[.1,.1]]);f.source.geometry=structuredClone(g);bindBlob(f,blob(g));},
 'old hole':f=>{f.before.geometryVersions[0].geometry.coordinates.push([[.1,.1],[.2,.1],[.2,.2],[.1,.1]]);},
 'candidate Polygon not original singleton':f=>{const g=f.next.geometryVersions[0].geometry;g.type='Polygon';g.coordinates=g.coordinates[0];f.source.geometry=structuredClone(g);bindBlob(f,blob(g));},
 'moved candidate point':f=>{f.next.geometryVersions[0].geometry.coordinates[0][0][1][0]+=.01;},
 'rotated ring':f=>{const r=f.next.geometryVersions[0].geometry.coordinates[0][0];r.shift();r.push(structuredClone(r[0]));},
 'source geometry mismatch':f=>{f.source.geometry.coordinates[0][0][1][0]+=.01;},
 'negative-zero WKB changed':f=>{const g=f.next.geometryVersions[0].geometry;g.coordinates[0][0][0][0]=-0;f.source.geometry=structuredClone(g);},
 'open original ring':f=>{const g=f.next.geometryVersions[0].geometry;g.coordinates[0][0].pop();f.source.geometry=structuredClone(g);bindBlob(f,blob(g));},
 'out-of-bounds original':f=>{const g=f.next.geometryVersions[0].geometry;g.coordinates[0][0][1][0]=181;f.source.geometry=structuredClone(g);bindBlob(f,blob(g));},
 'unknown source method':f=>{f.source.method='claimed-original';},
 'wrong raw blob hash':f=>{f.source.rawBlobSha256=hash('wrong');},
 'wrong raw WKB hash':f=>{f.source.rawWkbSha256=hash('wrong');},
 'wrong new raw file':f=>{f.next.geometryVersions[0].modernBoundarySupplement.rawSourceFile='wrong';},
 'wrong new raw file hash':f=>{f.next.geometryVersions[0].modernBoundarySupplement.rawSourceFileSha256=hash('wrong');},
 'wrong new raw feature':f=>{f.next.geometryVersions[0].modernBoundarySupplement.rawFeatureId='wrong';},
 'missing original blob':f=>{delete f.source.rawBlobBase64;},
 'noncanonical base64':f=>{f.source.rawBlobBase64+='\n';},
 'trailing WKB byte':f=>{bindBlob(f,Buffer.concat([Buffer.from(f.source.rawBlobBase64,'base64'),Buffer.from([0])]));},
 'wrong header':f=>{const b=Buffer.from(f.source.rawBlobBase64,'base64');b[0]=0;bindBlob(f,b);},
 'wrong CRS':f=>{const b=Buffer.from(f.source.rawBlobBase64,'base64');b.writeInt32LE(3857,4);bindBlob(f,b);},
 'wrong version':f=>{const b=Buffer.from(f.source.rawBlobBase64,'base64');b[2]=1;bindBlob(f,b);},
 'empty flag':f=>{const b=Buffer.from(f.source.rawBlobBase64,'base64');b[3]|=16;bindBlob(f,b);},
 'extended flag':f=>{const b=Buffer.from(f.source.rawBlobBase64,'base64');b[3]|=32;bindBlob(f,b);},
 'reserved flag':f=>{const b=Buffer.from(f.source.rawBlobBase64,'base64');b[3]|=64;bindBlob(f,b);},
 'unsupported envelope':f=>{const b=Buffer.from(f.source.rawBlobBase64,'base64');b[3]=5;bindBlob(f,b);},
 'wrong envelope bounds':f=>{const b=Buffer.from(f.source.rawBlobBase64,'base64');b.writeDoubleLE(42,8);bindBlob(f,b);},
 'wrong raw GENC':f=>{f.source.properties.GENC_3='BBB';},
 'wrong raw identity':f=>{f.source.properties.WP_ID='other';},
 'raw parent different':f=>{f.source.properties.WP_PAR_ID='other';},
 'dependency instead of independent':f=>{f.source.properties.US_Recog='Dependency';},
 'disputed display':f=>{f.source.properties.Show_Disp='Yes';},
 'disputed membership':f=>{f.source.properties.Map_Disp='AAA,BBB';},
 'application dependent':f=>{f.before.instantiation.mode=f.next.instantiation.mode='dependent';},
 'existing application parent':f=>{f.before.parentEntityId=f.next.parentEntityId='state:BBB';},
 'changed parent':f=>{f.next.parentEntityId='state:BBB';},
 'changed historical caveat':f=>{f.next.geometryVersions[0].historicalProvenance.note='new';},
 'changed old prepared file':f=>{f.next.geometryVersions[0].modernBoundarySupplement.sourceFile='new';},
 'changed old prepared hash':f=>{f.next.geometryVersions[0].modernBoundarySupplement.sourceFileSha256=hash('new');},
 'changed old featureId':f=>{f.next.geometryVersions[0].modernBoundarySupplement.featureId='new';},
 'changed old rawLayer':f=>{f.next.geometryVersions[0].modernBoundarySupplement.rawLayer='new';},
 'changed old sourceWP_IDs':f=>{f.next.geometryVersions[0].modernBoundarySupplement.sourceWP_IDs=['new'];},
 'changed old rawBlobSha256':f=>{f.next.geometryVersions[0].modernBoundarySupplement.rawBlobSha256=hash('new');},
 'deleted old raw field':f=>{delete f.next.geometryVersions[0].modernBoundarySupplement.rawLayer;},
 'changed old microstate review':f=>{f.next.geometryVersions[0].modernBoundarySupplement.microstateSharedBoundaryReview.scope='new';},
 'changed prior attribution':f=>{f.next.geometryVersions[0].modernBoundarySupplement.priorPreparedAttribution.status='new';},
 'missing topology check':f=>{f.review.topology.checks=[];},
};
const completionSpecific=new Set(['old flag missing','old false stays false','review whole false','two components','new hole','old hole','candidate Polygon not original singleton','moved candidate point','rotated ring','negative-zero WKB changed','unknown source method','wrong raw blob hash','wrong raw WKB hash','wrong new raw file','wrong new raw file hash','wrong new raw feature','trailing WKB byte','wrong header','wrong CRS','wrong envelope bounds','wrong raw GENC','raw parent different','dependency instead of independent','disputed display','disputed membership','changed old prepared file','changed old rawLayer','changed old sourceWP_IDs','changed old rawBlobSha256','deleted old raw field']);
for(const [name,change]of Object.entries(cases))test('completion rejects '+name,()=>{const f=fixture();change(f);f.refresh();assert.throws(()=>run(f),completionSpecific.has(name)?/Raw source adoption: whole-feature completion:/:/Raw source adoption|completion|original/i);});
for(const name of ['missing source evidence','corrupt source bytes','missing receipt evidence'])test('completion rejects '+name,()=>{const f=fixture(),read=f.readEvidence;f.readEvidence=p=>name==='missing source evidence'&&p===sourcePath?undefined:name==='missing receipt evidence'&&p===reviewPath?undefined:name==='corrupt source bytes'&&p===sourcePath?Buffer.concat([read(p),Buffer.from(' ')]):read(p);assert.throws(()=>run(f),/Raw source adoption|completion|original/i);});
test('actual MCO original completion remains exact and peer-independent',{skip:!process.env.PANDO_MCO_COMPLETION_DIR},()=>{
 const dir=process.env.PANDO_MCO_COMPLETION_DIR,load=n=>JSON.parse(fs.readFileSync(path.join(dir,n))),snapshot=load('snapshot.json'),row=snapshot.rows.find(r=>r.code==='MCO'),before=decodeTerritorialSource(row.descriptor,()=>fs.readFileSync(path.join(dir,'MCO.geojson'))),g=load('MCO-original-candidate.geojson'),source=load('original-source.json'),f=assemble(before,g,source);
 assert.equal(source.properties.GENC_3,'MCO');assert.equal(g.coordinates[0][0].length,521);assert.equal(hash(wkb(g)),'a3dc209169ff6328f01b67ad5cbe87c2d527e483659a7d64896095d9342518da');assert.equal(run(f),1);assert(isDeepStrictEqual(f.next.geometryVersions[0].geometry,g));
});

for(const markerPresent of [true,false])test('completion cannot acquire attribution on unchanged geometry '+markerPresent,()=>{const f=fixture({oldType:'MultiPolygon'});f.next.geometryVersions[0].geometry=structuredClone(f.before.geometryVersions[0].geometry);if(!markerPresent)delete f.next.geometryVersions[0].modernBoundarySupplement.wholeFeatureCompletion;f.refresh();assert.throws(()=>run(f),/whole-feature completion/);});
test('completion cannot bypass source gate by deleting admission receipt',()=>{const f=fixture();delete f.next.geometryVersions[0].modernBoundarySupplement.sourceAdoptionReview;assert.throws(()=>run(f),/whole-feature completion/);});
test('already completed geometry cannot lose completion attribution',()=>{const f=fixture(),next=structuredClone(f.next);delete next.geometryVersions[0].modernBoundarySupplement.wholeFeatureCompletion;assert.throws(()=>assertHistoricalSourceStorageChanges(next,f.next,{prefixes:f.prefixes,readEvidence:f.readEvidence}),/whole-feature completion/);});
test('already completed unchanged source permits ordinary name edit without replay',()=>{const f=fixture(),next=structuredClone(f.next);next.names.en='Revised name';assert.equal(assertHistoricalSourceStorageChanges(next,f.next,{prefixes:[f.prefixes[0]]}),0);});

test('completion rejects extra source path scope',()=>{const f=fixture();f.prefixes.push(base+'countries/state-BBB.json');assert.throws(()=>run(f),/whole-feature completion: exact descriptor/);});
test('completion rejects substituted new raw source reference',()=>{const f=fixture();f.next.geometryVersions[0].modernBoundarySupplement.rawOriginalSource={reference:'reports/wrong.json',sha256:hash('wrong')};assert.throws(()=>run(f),/whole-feature completion: separate exact new raw attribution/);});

const immutableCompletedMutations={
 'source geometry hash':e=>{e.sourceInfo.geometrySha256=hash('other');},
 'source version binding':e=>{e.sourceInfo.geometryVersionId='other';},
 'parent':e=>{e.parentEntityId='state:BBB';},
 'instantiation':e=>{e.instantiation.mode='dependent';},
 'country updates':e=>{e.instantiation.countryUpdates={BBB:true};},
 'current date':e=>{e.geometryVersions[0].validFrom='2000';},
 'provenance':e=>{e.geometryVersions[0].historicalProvenance.status='replaced';},
 'representative version':e=>{e.metadata.representativeGeometryVersionId='other';},
 'lifetime':e=>{e.lifetime.validFrom='2000';},
 'source title':e=>{e.sourceInfo.title='Unreviewed';},
 'version source ID':e=>{e.geometryVersions[0].sourceId='other';},
 'geometry extra property':e=>{e.geometryVersions[0].geometry.extra='other';},
};
for(const [name,mutate]of Object.entries(immutableCompletedMutations))test('completed immutable metadata rejects '+name,()=>{const f=fixture();assert.equal(run(f),1);const next=structuredClone(f.next);mutate(next);assert.throws(()=>assertHistoricalSourceStorageChanges(next,f.next,{prefixes:[f.prefixes[0]]}),/whole-feature completion/);});
test('completion explicitly rejects missing prior supplement object',()=>{const f=fixture();delete f.before.geometryVersions[0].modernBoundarySupplement;delete f.next.geometryVersions[0].modernBoundarySupplement.priorPreparedAttribution;f.refresh();assert.throws(()=>run(f),/whole-feature completion: explicit false-to-true/);});

for(const [name,mutate]of Object.entries({empty:e=>{e.geometryVersions=[];},missing:e=>{delete e.geometryVersions;},renamed:e=>{e.geometryVersions[0].versionId='renamed';},markerRemoved:e=>{delete e.geometryVersions[0].modernBoundarySupplement.wholeFeatureCompletion;}}))test('completed version inventory rejects '+name,()=>{const f=fixture();assert.equal(run(f),1);const changed=structuredClone(f.next);mutate(changed);assert.throws(()=>assertHistoricalSourceStorageChanges(changed,f.next,{prefixes:[f.prefixes[0]]}),/whole-feature completion: (completed version inventory cannot change|unchanged geometry cannot alter completion attribution)/);});
