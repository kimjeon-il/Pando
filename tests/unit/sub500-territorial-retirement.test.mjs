import { describe as contractSuite } from 'node:test';
import * as __dep0 from "node:assert/strict";
import * as __dep1 from "node:test";
import * as __dep2 from "node:crypto";
import * as __dep3 from "../../tools/territorial-entity-sources.mjs";
import * as __dep4 from "../../tools/gis/territorial-library.js";
import * as __dep5 from "../helpers/builtin-world.mjs";
import * as __dep6 from "../../src/geometry/geometry-version-store.js";
import * as __dep7 from "../../src/document/timeline-resolver.js";

// Original feature contract: sub500-territorial-retirement.test.mjs
contractSuite("sub500-territorial-retirement", () => {
const assert = __dep0.default;
const test = __dep1.default;
const { createHash } = __dep2;
const { readTerritorialSource } = __dep3;
const { selectGeometryVersion } = __dep4;
const { scopedBuiltinProject } = __dep5;
const { createGeometryVersionStore } = __dep6;
const { resolveWorld } = __dep7;
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
});

// Original feature contract: sub500-sarakhs-retirement.test.mjs
contractSuite("sub500-sarakhs-retirement", () => {
const assert = __dep0.default;
const test = __dep1.default;
const { createHash } = __dep2;
const { readTerritorialSource } = __dep3;
const { selectGeometryVersion } = __dep4;
const { scopedBuiltinProject } = __dep5;
const { createGeometryVersionStore } = __dep6;
const { resolveWorld } = __dep7;
const hash=g=>createHash('sha256').update(JSON.stringify(g)).digest('hex');
const expected=[
 ['state:soviet-union','state:soviet-union','state:soviet-union:1922-12-30-reviewed-v2','3f3c46a1c6c29e276a86f5107fc7f3b1a85a0b356ddbab037c128245513ce97e','historical-world:b3771029e96ccf0dacfe3a0b67b5aaee9b1219f62267afe7edcbd953b3840b38'],
 ['state:soviet-union-russian-sfsr','state:soviet-union-russian-sfsr','state:soviet-union-russian-sfsr:1922-12-30-reviewed-v2','9ca5f71621b3900f0a31867826fcd8b2f808e9f2d69a967f7d68641a359f4fb8','historical-world:47b5f865796b33d4d68533e23868c104a3521b1b0fbadae7dadb93424b18072c'],
 ['state:IRN','IRN','state:IRN:natural-earth-5.1.1:caspian-1922-12-30','aca1c701ae22829815e086e80a7325e0246e800b300a46991c15878a8d481a7c','historical-world:6f53b93634c46d58385d25188cca362e89581a4a9d3513fc4f2db365b5277362'],
];
test('Sarakhs restores the prior shared border in the existing reviewed period only',()=>{
 for(const [id,,versionId,digest]of expected){
  const source=readTerritorialSource(id),version=source.geometryVersions.find(v=>v.versionId===versionId);
  assert.equal(hash(version.geometry),digest,id);
  assert.equal(version.validFrom,'1922-12-30');assert.equal(version.validTo,'1925-05-12');
  assert.equal(version.historicalProvenance.sarakhsSmallEventRetirement.record,'S15');
  assert.equal(selectGeometryVersion(source,'1922-12-30').versionId,versionId);
  assert.equal(selectGeometryVersion(source,'1925-05-12').versionId,versionId);
  for(const date of['1922-12-29','1925-05-13','1991-01-01'])assert.notEqual(selectGeometryVersion(source,date)?.versionId,versionId);
  for(const v of source.geometryVersions.filter(v=>v.versionId!==versionId))assert.equal(v.historicalProvenance?.sarakhsSmallEventRetirement,undefined);
 }
});
test('actual scoped runtime resolves all three restored counterparts without changing the May transition',async()=>{
 const ids=expected.map(([,id])=>id);
 for(const month of['1922-12','1925-04','1925-05','1925-06']){
  const project=await scopedBuiltinProject(month,ids),world=resolveWorld(project.territorialEntities,project.timelineRecords,createGeometryVersionStore(project.geometries),month);
  const inside=['1922-12','1925-04'].includes(month);
  // RSFSR has no published geometry between the reviewed window and 1991.
  assert.deepEqual(world.entities.map(r=>r.id).sort(),inside?ids.slice().sort():['IRN','state:soviet-union']);
  for(const row of world.entities){const spec=expected.find(([,id])=>id===row.id);if(['1922-12','1925-04'].includes(month))assert.equal(row.geometryRef.id,spec[4]);else assert.notEqual(row.geometryRef.id,spec[4]);}
 }
});
});
