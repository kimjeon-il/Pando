import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeTerritorialLibraryEntity,selectGeometryVersion,territorialEntityExistsAt} from '../../assets/js/modules/territorial-library.js';
import {selectBuiltinCountries,assembleBuiltinWorld} from '../../assets/js/modules/builtin-world-loader.js';
import {gunzipSync} from 'node:zlib';

const root=new URL('../../assets/data/territorial-entities/source/countries/',import.meta.url);
const ids=['state:soviet-union','state:soviet-union-russian-sfsr','state:soviet-union-ukrainian-ssr','state:soviet-union-byelorussian-ssr','state:soviet-union-transcaucasian-sfsr'];
const entities=ids.map(id=>normalizeTerritorialLibraryEntity(JSON.parse(readFileSync(new URL(id.replace(':','-')+'.json',root)))));
test('reviewed reference date and December month end select all four founders without overwriting later geometry',()=>{
 for(const entity of entities){
  for(const date of ['1922-12-30','1922-12-31','1923-01-01','1925-05-12'])assert.equal(selectGeometryVersion(entity,date)?.versionId,entity.entityId+':1922-12-30-reviewed-v2');
  assert.notEqual(selectGeometryVersion(entity,'1925-05-13')?.versionId,entity.entityId+':1922-12-30-reviewed-v2');
  if(entity.entityId==='state:soviet-union')assert.ok(selectGeometryVersion(entity,'1925-05-13'));
  else if(!entity.entityId.endsWith('transcaucasian-sfsr'))assert.ok(selectGeometryVersion(entity,'1991-01-01'));
 }
 const tsfsr=entities.at(-1);
 assert.equal(territorialEntityExistsAt(tsfsr,'1922-12-29'),false);
 assert.equal(territorialEntityExistsAt(tsfsr,'1936-12-04'),true);
 assert.equal(territorialEntityExistsAt(tsfsr,'1936-12-05'),false);
 assert.equal(selectGeometryVersion(tsfsr,'1930-01-01'),null);
});
test('published December world includes founders with the reviewed source versions and parent links',()=>{
 const base=new URL('../../assets/data/builtin-world/generated/v1/',import.meta.url),index=JSON.parse(readFileSync(new URL('index.json',base)));
 const selected=selectBuiltinCountries(index,'1922-12').filter(row=>ids.includes(row.entityId));
 assert.equal(selected.length,5);
 const project=assembleBuiltinWorld({...index,entities:selected},selected.map(row=>JSON.parse(gunzipSync(readFileSync(new URL(row.file,base))))),'1922-12');
 for(const entity of project.territorialEntities)assert.equal(entity.properties.sourceGeometryVersion,entity.id+':1922-12-30-reviewed-v2');
 for(const id of ids.slice(1))assert.equal(project.timelineRecords.parentRelations.find(row=>row.entityId===id).parentId,ids[0]);
});
