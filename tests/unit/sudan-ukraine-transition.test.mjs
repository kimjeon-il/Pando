import assert from 'node:assert/strict';
import test from 'node:test';
import {readTerritorialSource} from '../../tools/territorial-entity-sources.mjs';
import {selectGeometryVersion} from "../../apps/editor/frontend/js/modules/territorial-library.js";
import {scopedBuiltinProject} from '../helpers/builtin-world.mjs';
import {createGeometryVersionStore} from "../../shared/frontend/js/modules/geometry-version-store.js";
import {resolvedTimelineViews} from "../../shared/frontend/js/modules/timeline-resolver.js";
import {createRingHitTester} from "../../shared/frontend/js/modules/ring-hit-test.js";

const ids=['state:SDN','state:SDS','state:UKR'];
const read=()=>new Map(ids.map(id=>[id,readTerritorialSource(id)]));
const rings=createRingHitTester(ring=>ring);
function covers(geometry,point){
 if(!geometry)return false;
 const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
 return polygons.some(p=>rings.contains(point,p[0]) && p.slice(1).every(h=>!rings.contains(point,h)));
}

test('monthly end and exact day selection keep Sudan, South Sudan and Ukraine as single identities',()=>{
 const entries=read(),sdn=entries.get('state:SDN'),sds=entries.get('state:SDS'),ukr=entries.get('state:UKR');
 assert.equal(selectGeometryVersion(sdn,'2011-07-08')?.versionId,'state:sudan:1956-2011-r1');
 assert.equal(selectGeometryVersion(sdn,'2011-07-09')?.versionId,'state:SDN:2011-07-09-post-secession-r1');
 assert.equal(selectGeometryVersion(sdn,'2011-06')?.versionId,'state:sudan:1956-2011-r1');
 assert.equal(selectGeometryVersion(sdn,'2011-07')?.versionId,'state:SDN:2011-07-09-post-secession-r1');
 assert.equal(selectGeometryVersion(sds,'2011-07-08'),null);
 assert.equal(selectGeometryVersion(sds,'2011-07-09')?.versionId,'state:SDS:2011-07-09-independence-r1');
 assert.equal(selectGeometryVersion(sds,'2011-07')?.versionId,'state:SDS:2011-07-09-independence-r1');
 assert.equal(selectGeometryVersion(ukr,'2014-03-17')?.versionId,'state:ukraine:1991-2014-r1');
 assert.equal(selectGeometryVersion(ukr,'2014-03-18')?.versionId,'state:UKR:2014-03-18-post-crimea-r1');
 assert.equal(selectGeometryVersion(ukr,'2014-02')?.versionId,'state:ukraine:1991-2014-r1');
 assert.equal(selectGeometryVersion(ukr,'2014-03')?.versionId,'state:UKR:2014-03-18-post-crimea-r1');
 for(const [entity,modernId] of [[sdn,'state:SDN:natural-earth-5.1.1'],[sds,'state:SDS:natural-earth-5.1.1'],[ukr,'state:UKR:natural-earth-5.1.1']]){
  assert.equal(selectGeometryVersion(entity,'2026-10-05')?.certainty,'low');
  assert.equal(selectGeometryVersion(entity,'2026-10-06')?.versionId,modernId);
 }
 const khartoum=[32.56,15.5],juba=[31.58,4.85],kyiv=[30.52,50.45],crimea=[34.1,44.95];
 assert.ok(covers(selectGeometryVersion(sdn,'2011-06').geometry,juba));
 assert.ok(!covers(selectGeometryVersion(sdn,'2011-07').geometry,juba));
 assert.ok(covers(selectGeometryVersion(sds,'2011-07').geometry,juba));
 assert.ok(covers(selectGeometryVersion(sdn,'2011-06').geometry,khartoum));
 assert.ok(covers(selectGeometryVersion(sdn,'2011-07').geometry,khartoum));
 assert.ok(covers(selectGeometryVersion(ukr,'2014-02').geometry,crimea));
 assert.ok(!covers(selectGeometryVersion(ukr,'2014-03').geometry,crimea));
 assert.ok(covers(selectGeometryVersion(ukr,'2014-02').geometry,kyiv));
 assert.ok(covers(selectGeometryVersion(ukr,'2014-03').geometry,kyiv));
});

test('built Web/native historical-project input has the same post-transition geographical ownership',async()=>{
 const months=['2011-06','2011-07','2014-02','2014-03','2015-10','2020-10'],worlds=new Map();
 for(const month of months){
  const project=await scopedBuiltinProject(month,['SDN','SDS','UKR','RUS']);
  assert.deepEqual(project.territorialEntities.map(entity=>entity.id),
   month==='2011-06'?['RUS','SDN','UKR']:['RUS','SDN','SDS','UKR']);
  worlds.set(month,resolvedTimelineViews(project.territorialEntities,project.timelineRecords,createGeometryVersionStore(project.geometries),month));
 }
 const at=(month,id)=>worlds.get(month).find(entity=>entity.id===id);
 const khartoum=[32.56,15.5],juba=[31.58,4.85],kyiv=[30.52,50.45],crimea=[34.1,44.95];
 assert.ok(covers(at('2011-06','SDN')?.geometry,juba));
 assert.equal(at('2011-06','SDS'),undefined);
 assert.ok(covers(at('2011-07','SDN')?.geometry,khartoum));
 assert.equal(covers(at('2011-07','SDN')?.geometry,juba),false);
 assert.ok(covers(at('2011-07','SDS')?.geometry,juba));
 assert.ok(covers(at('2014-02','UKR')?.geometry,crimea));
 assert.ok(covers(at('2014-02','UKR')?.geometry,kyiv));
 assert.equal(covers(at('2014-03','UKR')?.geometry,crimea),false);
 assert.ok(covers(at('2014-03','UKR')?.geometry,kyiv));
 assert.ok(at('2015-10','UKR'));
 assert.ok(at('2020-10','SDN'));
 assert.ok(at('2020-10','SDS'));
 const russia=at('2014-03','RUS');
 assert.ok(russia,'the accepted catalog includes RUS after 1991-12-25');
 assert.equal(russia.properties.sourceGeometryVersion,'state:RUS:natural-earth-5.1.1');
 assert.ok(covers(russia.geometry,crimea),'the pinned RUS geometry applies from 2014-03-18');
 assert.ok(covers(russia.geometry,[37.62,55.75]),'the same record retains Moscow');
 assert.equal(covers(russia.geometry,kyiv),false);
});
