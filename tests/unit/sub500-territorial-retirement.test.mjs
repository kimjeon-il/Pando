import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readTerritorialSource} from '../../tools/territorial-entity-sources.mjs';
import {selectGeometryVersion} from '../../tools/gis/territorial-library.js';
import {scopedBuiltinProject} from '../helpers/builtin-world.mjs';
import {createGeometryVersionStore} from '../../shared/frontend/js/modules/geometry-version-store.js';
import {resolveWorld} from '../../shared/frontend/js/modules/timeline-resolver.js';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const expected={
 RUS:['1622accbe95fcd708d980b0871b72a2d65dc471541371e1a0af193f44dc985be','ec4a51711dd7b654e21e4529fd60fbfae9ded094e95edcdbb7f69128472cad13'],
 KAZ:['0e22daa74dfe984e57a7cbe6bc2ef4c24b43fb33d6f73018c75154f6cca745c1','02ce3308bce584ea00619ed51051e1a8d090c67ee33127101ff9aa7b709da853'],
};
test('retired A–C events no longer split either country at the 2006 treaty date',()=>{
 for(const code of ['RUS','KAZ']){
  const source=readTerritorialSource('state:'+code);
  assert.equal(source.geometryVersions.length,2);
  assert.deepEqual(source.geometryVersions.map(v=>hash(v.geometry)),expected[code]);
  assert.equal(selectGeometryVersion(source,'2006-01-11').versionId,selectGeometryVersion(source,'2006-01-12').versionId);
  for(const version of source.geometryVersions)assert.equal(version.historicalProvenance.rusKazTreaty2006ABC,undefined);
 }
 const rus=readTerritorialSource('state:RUS'),kaz=readTerritorialSource('state:KAZ');
 assert.equal(selectGeometryVersion(rus,'1991-12-24'),null);
 assert.equal(selectGeometryVersion(kaz,'1991-12-15'),null);
 assert.equal(selectGeometryVersion(rus,'2014-03-17').geometry,rus.geometryVersions[0].geometry);
 assert.equal(selectGeometryVersion(rus,'2014-03-18').geometry,rus.geometryVersions[1].geometry);
 assert.equal(selectGeometryVersion(kaz,'1995-09-24').geometry,kaz.geometryVersions[0].geometry);
 assert.equal(selectGeometryVersion(kaz,'1995-09-25').geometry,kaz.geometryVersions[1].geometry);
 assert.equal(kaz.geometryVersions[1].modernBoundarySupplement.pairing.includes('KAB'),true);
});
test('actual selected runtime resolves the restored source on both sides of the retired event',async()=>{
 for(const month of ['2005-12','2006-01','2014-02','2014-03','2026-10']){
  const project=await scopedBuiltinProject(month,['RUS','KAZ']);
  const resolved=resolveWorld(project.territorialEntities,project.timelineRecords,createGeometryVersionStore(project.geometries),month);
  assert.deepEqual(resolved.entities.map(e=>e.id).sort(),['KAZ','RUS']);
  for(const entity of resolved.entities){
   const source=readTerritorialSource('state:'+entity.id),version=selectGeometryVersion(source,month);
   assert.equal(hash(entity.geometry),hash(version.geometry),entity.id+' '+month);
   assert.equal(entity.geometryRef.id,'historical-world:'+hash(version.geometry));
  }
 }
});

test('G remains absent from the runtime Chinese source and has no 2008 display split',()=>{
 const chn=readTerritorialSource('state:CHN');
 assert.equal(chn.geometryVersions.length,1);
 assert.equal(chn.metadata.representativeGeometryVersionId,'state:CHN:paektu-lsib-11.4');
 assert.equal(selectGeometryVersion(chn,'2008-10-13').versionId,selectGeometryVersion(chn,'2008-10-14').versionId);
 assert.equal(chn.geometryVersions[0].historicalProvenance.GAbagaitu2008,undefined);
});
