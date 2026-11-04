import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readTerritorialSource} from '../../tools/territorial-entity-sources.mjs';
import {selectGeometryVersion} from '../../tools/gis/territorial-library.js';
import {scopedBuiltinProject} from '../helpers/builtin-world.mjs';
import {createGeometryVersionStore} from '../../shared/frontend/js/modules/geometry-version-store.js';
import {resolveWorld} from '../../shared/frontend/js/modules/timeline-resolver.js';
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
