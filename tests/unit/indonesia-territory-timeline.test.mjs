import assert from 'node:assert/strict';
import test from 'node:test';
import {readTerritorialSources} from '../../tools/territorial-entity-sources.mjs';
import {selectGeometryVersion, territorialEntityExistsAt} from "../../apps/editor/frontend/js/modules/territorial-library.js";
import {createRingHitTester} from "../../shared/frontend/js/modules/ring-hit-test.js";
import {builtinProject} from '../helpers/builtin-world.mjs';
import {createGeometryVersionStore} from "../../shared/frontend/js/modules/geometry-version-store.js";
import {resolvedTimelineViews} from "../../shared/frontend/js/modules/timeline-resolver.js";

const pointTester=createRingHitTester(ring=>ring);
const pointInside=(geo,p)=>{
 if(!geo)return false;
 const polys=geo.type==='Polygon'?[geo.coordinates]:geo.coordinates;
 return polys.some(poly=>pointTester.contains(p,poly[0])&&poly.slice(1).every(ring=>!pointTester.contains(p,ring)));
};
const papua=[138,-4],timor=[125.57,-8.56],java=[106.82,-6.18];
const entities=()=>new Map(readTerritorialSources().filter(e=>e.entityId==='state:IDN'||e.entityId==='state:TLS').map(e=>[e.entityId,e]));

test('Indonesia has exact 1963 Papua inclusion and 1975/1999 East Timor control transitions',()=>{
 const entitiesById=entities(),idn=entitiesById.get('state:IDN'),tls=entitiesById.get('state:TLS');
 assert.equal(idn.geometryVersions.length,5);
 assert.equal(tls.geometryVersions.length,2);
 const source=idn.geometryVersions;
 const epochs=[
  ['1963-04-30',source[0].versionId],
  ['1963-05-01',source[1].versionId],
  ['1975-12-06',source[1].versionId],
  ['1975-12-07',source[2].versionId],
  ['1999-10-24',source[2].versionId],
  ['1999-10-25',source[3].versionId],
  ['2026-10-05',source[3].versionId],
  ['2026-10-06',source[4].versionId]
 ];
 for(const [date,expected] of epochs) assert.equal(selectGeometryVersion(idn,date)?.versionId,expected,date);
 assert.equal(selectGeometryVersion(idn,'1963-04')?.versionId,source[0].versionId);
 assert.equal(selectGeometryVersion(idn,'1963-05')?.versionId,source[1].versionId);
 assert.equal(selectGeometryVersion(idn,'1975-11')?.versionId,source[1].versionId);
 assert.equal(selectGeometryVersion(idn,'1975-12')?.versionId,source[2].versionId);
 assert.equal(selectGeometryVersion(idn,'1999-09')?.versionId,source[2].versionId);
 assert.equal(selectGeometryVersion(idn,'1999-10')?.versionId,source[3].versionId);
 for (const version of source) assert.ok(pointInside(version.geometry,java),'Java always Indonesian: '+version.versionId);
 assert.equal(pointInside(source[0].geometry,papua),false);
 for(const version of source.slice(1))assert.ok(pointInside(version.geometry,papua),'West New Guinea after 1963');
 assert.equal(pointInside(source[0].geometry,timor),false);
 assert.equal(pointInside(source[1].geometry,timor),false);
 assert.ok(pointInside(source[2].geometry,timor));
 assert.equal(pointInside(source[3].geometry,timor),false);
 assert.equal(pointInside(source[4].geometry,timor),false);
 assert.equal(territorialEntityExistsAt(tls,'2002-05-19'),false);
 assert.equal(selectGeometryVersion(tls,'2002-05-19'),null);
 assert.ok(territorialEntityExistsAt(tls,'2002-05-20'));
 assert.equal(selectGeometryVersion(tls,'2002-05')?.versionId,'state:TLS:2002-2026-independence-r1');
 for (const v of tls.geometryVersions)assert.ok(pointInside(v.geometry,timor));
 assert.equal(source[2].certainty,'low','Full Timor inclusion beginning with 1975 invasion is approximate only');
 assert.equal(source[0].historicalProvenance.maskSelectedComponents.length,25);
 assert.equal(source[0].historicalProvenance.verifiedHistoricalGeometry,false);
});

test('Web and native common history publication preserves Indonesia identity and Timor independence',()=>{
 const active=(month,id)=>{const project=builtinProject(month);return resolvedTimelineViews(project.territorialEntities,project.timelineRecords,createGeometryVersionStore(project.geometries),month).find(row=>row.id===id);};
 const checks=[
  ['1945-11',false,false],
  ['1963-04',false,false],
  ['1963-05',true,false],
  ['1975-11',true,false],
  ['1975-12',true,true],
  ['1999-09',true,true],
  ['1999-10',true,false],
  ['2002-04',true,false],
  ['2002-05',true,false],
  ['2012-10',true,false],
 ];
 for(const [date,papuaExpected,timorExpected] of checks){
   const indonesia=active(date,'IDN');
   assert.ok(indonesia,'IDN must remain one logical entity: '+date);
   assert.equal(pointInside(indonesia.geometry,papua),papuaExpected,'West Papua owner in '+date);
   assert.equal(pointInside(indonesia.geometry,timor),timorExpected,'East Timor owner in '+date);
   assert.equal(Boolean(active(date,'TLS')),date>='2002-05','TLS independent status: '+date);
   if(active(date,'TLS'))assert.ok(pointInside(active(date,'TLS').geometry,timor));
 }
 const current=active('2026-10','IDN');
 assert.ok(current);
 assert.ok(active('2026-10','TLS'));
 assert.equal(pointInside(current.geometry,timor),false);
});
