import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {FOUNDER_IDS,MEMBER_HASHES,MASTER,DISPLAY,USSR_ZIP_SHA,
 buildUSSRApprovedSnapshot,stageSnapshot}
  from '../../tools/gis/replay-ussr-1922-countries.mjs';

const poly=(w=0)=>({type:'MultiPolygon',coordinates:[
  [[[w,0],[w+1,0],[w+1,1],[w,0]]],
]});
const approved=()=>({type:'FeatureCollection',features:FOUNDER_IDS.map((id,i)=>({
 type:'Feature',id,geometry:poly(i*2),properties:{source:'reviewed-v2',founderId:id},
}))});
const old=id=>({
 schemaVersion:2,entityId:id,
 lifetime:{validFrom:'1918-01-01',validTo:'1991-12-25'},
 metadata:{representativeGeometryVersionId:id+':modern'},
 sourceInfo:{sourceId:'earlier-approved'},
 geometryVersions:[{versionId:id+':modern',validFrom:null,validTo:null,
  geometry:poly(),notes:'Prior.'}],
});
const before=()=>Object.fromEntries(FOUNDER_IDS.slice(0,4).map(id=>[id,old(id)]));
test('five approved identities become staged source objects and a separately founded TSFSR',()=>{
 const original=before(),copy=structuredClone(original);
 const result=buildUSSRApprovedSnapshot(approved(),original);
 assert.equal(result.mode,'staged-candidate');
 assert.equal(result.founders,5);
 assert.equal(result.changedFiles.length,7);
 assert.deepEqual(original,copy,'The source library must not be edited by a replay plan');
 const ussr=result.changes.get('assets/data/territorial-entities/source/countries/state-soviet-union.json');
 assert.equal(ussr.lifetime.validFrom,'1922-12-30');
 assert.equal(ussr.geometryVersions.length,2);
 assert.equal(ussr.geometryVersions[0].validFrom,'1925-05-13');
 assert.equal(ussr.geometryVersions[0].geometry.type,'MultiPolygon');
 assert.ok(ussr.geometryVersions.every(x=>!x.versionId.endsWith('before-reviewed-day')));
 assert.equal(ussr.geometryVersions[1].validTo,'1925-05-12');
 assert.equal(ussr.geometryVersions[1].constituentRepublicCount,4);
 assert.equal(ussr.geometryVersions[1].reviewedMasterSha256,MEMBER_HASHES[MASTER]);
 assert.equal(ussr.geometryVersions[1].displaySha256,MEMBER_HASHES[DISPLAY]);
 const tsfsr=result.changes.get(
  'assets/data/territorial-entities/source/countries/state-soviet-union-transcaucasian-sfsr.json');
 assert.equal(tsfsr.lifetime.validFrom,'1922-12-30');
 assert.equal(tsfsr.lifetime.validTo,'1936-12-04');
 assert.equal(tsfsr.parentEntityId,FOUNDER_IDS[0]);
 assert.equal(tsfsr.metadata.approximateGeometry,true);
 assert.equal(tsfsr.geometryVersions[0].sourceRights.includes('Mixed source-specific rights'),true);
 const snap=result.changes.get('assets/data/territorial-entities/source/snapshots/ussr-1922-12-30.json');
 assert.deepEqual(snap.entityRefs,FOUNDER_IDS);
});
test('already approved original country objects are compared unchanged and partial snapshots fail',()=>{
 const draft=buildUSSRApprovedSnapshot(approved(),before());
 const installed=Object.fromEntries(FOUNDER_IDS.map(id=>[id,
   draft.changes.get('assets/data/territorial-entities/source/countries/'+id.replace(':','-')+'.json')]));
 const same=buildUSSRApprovedSnapshot(approved(),installed);
 assert.equal(same.mode,'already-applied-verified');
 assert.equal(same.changedFiles.length,0);
 assert.equal(same.changes.size,0);
 const damaged=structuredClone(installed);
 damaged[FOUNDER_IDS[1]].geometryVersions.at(-1).geometry.coordinates[0][0][0][0]+=.001;
 assert.throws(()=>buildUSSRApprovedSnapshot(approved(),damaged),/differs/);
 const partial=structuredClone(installed);
 partial[FOUNDER_IDS[2]]=old(FOUNDER_IDS[2]);
 assert.throws(()=>buildUSSRApprovedSnapshot(approved(),partial),/Partially applied/);
});
test('missing old founder, unexpected source identity and changed provenance fail closed',()=>{
 const inputs=approved(),previous=before();
 delete previous[FOUNDER_IDS[0]];
 assert.throws(()=>buildUSSRApprovedSnapshot(inputs,previous),/source missing/);
 const p=approved();p.features[3].id='state:extra';
 assert.throws(()=>buildUSSRApprovedSnapshot(p,before()),/identities changed/);
 assert.match(USSR_ZIP_SHA,/^[a-f0-9]{64}$/);
});
test('staging writes an exclusive review candidate and never overwrites it',t=>{
 const scope=mkdtempSync(join(tmpdir(),'ussr-country-stage-'));
 t.after(()=>rmSync(scope,{recursive:true,force:true}));
 const target=join(scope,'private-stage'),draft=buildUSSRApprovedSnapshot(approved(),before());
 const list=stageSnapshot(draft,target);
 assert.equal(list.length,7);
 const plan=JSON.parse(readFileSync(join(target,'candidate-manifest.json'),'utf8'));
 assert.equal(plan.readyToOverwritePublishedLibrary,false);
 assert.ok(existsSync(join(target,
   'assets/data/territorial-entities/source/countries/state-soviet-union.json')));
 assert.throws(()=>stageSnapshot(draft,target),/must be new/);
});
