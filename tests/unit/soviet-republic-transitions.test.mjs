import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {temporalContains} from '../../assets/js/modules/temporal.js';
import {selectBuiltinCountries} from '../../assets/js/modules/builtin-world-loader.js';
import {normalizeTerritorialLibraryEntity,selectGeometryVersion,territorialEntityExistsAt} from '../../assets/js/modules/territorial-library.js';

const transitions=[
 ['RUS','russian-sfsr','1991-12-25'],['UKR','ukrainian-ssr','1991-08-24'],
 ['BLR','byelorussian-ssr','1991-08-25'],['MDA','moldavian-ssr','1991-08-27'],
 ['EST','estonian-ssr','1991-08-20'],['LVA','latvian-ssr','1991-08-21'],
 ['LTU','lithuanian-ssr','1990-03-11'],['GEO','georgian-ssr','1991-04-09'],
 ['ARM','armenian-ssr','1991-09-23'],['AZE','azerbaijan-ssr','1991-10-18'],
 ['KAZ','kazakh-ssr','1991-12-16'],['KGZ','kirghiz-ssr','1991-08-31'],
 ['TJK','tajik-ssr','1991-09-09'],['TKM','turkmen-ssr','1991-10-27'],
 ['UZB','uzbek-ssr','1991-08-31'],
];
const root=new URL('../../assets/data/territorial-entities/source/countries/',import.meta.url);
const read=id=>normalizeTerritorialLibraryEntity(JSON.parse(readFileSync(new URL(id.replace(':','-')+'.json',root))));
test('all fifteen transitions select the republic before and the independent phase on the approved day',()=>{
 for(const [code,suffix,day] of transitions){
  const before=new Date(day+'T00:00:00Z');before.setUTCDate(before.getUTCDate()-1);const previous=before.toISOString().slice(0,10);
  const republic=read('state:soviet-union-'+suffix),independent=read('state:'+code);
  assert.equal(republic.lifetime.validTo,previous,code);
  assert.equal(independent.lifetime.validFrom,day,code);
  for(const [date,oldExists,newExists] of [[previous,true,false],[day,false,true]]){
   assert.equal(territorialEntityExistsAt(republic,date),oldExists,code+' '+date);
   assert.equal(territorialEntityExistsAt(independent,date),newExists,code+' '+date);
   assert.equal(Boolean(selectGeometryVersion(republic,date)),oldExists,code+' geometry '+date);
   assert.equal(Boolean(selectGeometryVersion(independent,date)),newExists,code+' geometry '+date);
  }
  assert.equal(republic.parentEntityId,'state:soviet-union');assert.equal(independent.parentEntityId,'');
 }
 assert.deepEqual(read('state:soviet-union').lifetime,{validFrom:'1922',validTo:'1991'});
});

test('published intervals and month-end selection preserve all fifteen political transitions',()=>{
 const directory=new URL('../../assets/data/builtin-world/generated/v1/',import.meta.url);
 const index=JSON.parse(readFileSync(new URL('index.json',directory)));
 assert.equal(index.schemaVersion,2);
 const projectId=source=>index.sourceIdentities.find(row=>row.sourceEntityIds.includes(source)).projectEntityId;
 const cache=new Map();
 const country=source=>{const id=projectId(source);if(!cache.has(id))cache.set(id,JSON.parse(gunzipSync(readFileSync(new URL(index.entities.find(row=>row.entityId===id).file,directory)))));return cache.get(id);};
 const active=(rows,day)=>rows.filter(row=>temporalContains(row,day));
 for(const [code,suffix,day] of transitions){
  const end=new Date(day+'T00:00:00Z');end.setUTCDate(end.getUTCDate()-1);const previous=end.toISOString().slice(0,10);
  const oldId='state:soviet-union-'+suffix,newId='state:'+code;
  for(const [date,oldExists,newExists] of [[previous,true,false],[day,false,true]])for(const [source,exists] of [[oldId,oldExists],[newId,newExists]]){
   const row=country(source),selected=active(row.timelineRecords.geometryBindings,date);
   assert.equal(active(row.timelineRecords.lifetimes,date).length,Number(exists),source+' lifetime '+date);
   assert.equal(selected.length,Number(exists),source+' geometry '+date);
   if(exists)assert.equal(active(row.timelineRecords.parentRelations,date)[0].parentId,source===oldId?projectId('state:soviet-union'):'');
  }
  const selected=new Set(selectBuiltinCountries(index,day.slice(0,7)).map(row=>row.entityId));
  assert.ok(selected.has(projectId(newId)),code+' month-end independent phase');
  assert.ok(!selected.has(projectId(oldId)),code+' month-end republic departure');
 }
 for(const source of ['state:soviet-union','state:soviet-union-russian-sfsr','state:soviet-union-ukrainian-ssr','state:soviet-union-byelorussian-ssr','state:soviet-union-transcaucasian-sfsr']){
  const binding=active(country(source).sourceBindings,'1922-12-30');
  assert.equal(binding.length,1,source);assert.match(binding[0].sourceVersionId,/1922-12-30-reviewed-v2$/);
 }
});

test('existing Russian and Kazakh outlines bridge only the researched display transitions',()=>{
 for(const [code,suffix,event] of [['RUS','russian-sfsr','2014-03-18'],['KAZ','kazakh-ssr','1995-09-25']]){
  const source=read('state:'+code),republic=read('state:soviet-union-'+suffix);
  const previous=new Date(event+'T00:00:00Z');previous.setUTCDate(previous.getUTCDate()-1);
  const before=selectGeometryVersion(source,previous.toISOString().slice(0,10)),after=selectGeometryVersion(source,event);
  assert.equal(before.versionId,'state:'+code+':post-soviet-existing-coordinates');
  assert.equal(after.versionId,source.metadata.representativeGeometryVersionId);
  assert.deepEqual(before.geometry,republic.geometryVersions.find(row=>row.versionId.endsWith(':1991-r1')).geometry);
 }
 const lease=read('state:KAB');assert.equal(selectGeometryVersion(lease,'1995-09-24'),null);assert.ok(selectGeometryVersion(lease,'1995-09-25'));
});
